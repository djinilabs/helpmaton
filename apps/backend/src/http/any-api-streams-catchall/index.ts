// Removed unused imports: Readable and pipeline
// We now use direct write() and end() on ResponseStream
// Using AWS's native streamifyResponse for Lambda Function URLs with RESPONSE_STREAM mode

import {
  badRequest,
  boomify,
  forbidden,
  notAcceptable,
  unauthorized,
} from "@hapi/boom";
import type { ModelMessage } from "ai";
import { convertToModelMessages, streamText } from "ai";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
} from "aws-lambda";

// Declare global awslambda for Lambda Function URL streaming
// With RESPONSE_STREAM mode, awslambda.streamifyResponse provides the HttpResponseStream directly
declare const awslambda:
  | {
      streamifyResponse: <TEvent, TStream extends HttpResponseStream>(
        handler: (event: TEvent, responseStream: TStream) => Promise<void>
      ) => (event: TEvent, responseStream: TStream) => Promise<void>;
      HttpResponseStream: {
        from(
          underlyingStream: unknown,
          metadata: Record<string, unknown>
        ): HttpResponseStream;
      };
    }
  | undefined;

// Type for AWS Lambda HttpResponseStream (available in RESPONSE_STREAM mode)
interface HttpResponseStream {
  write(chunk: string | Uint8Array, callback?: (error?: Error) => void): void;
  end(callback?: (error?: Error) => void): void;
}

import { MODEL_NAME } from "../../http/utils/agentUtils";
import {
  adjustCreditsAfterLLMCall,
  cleanupReservationOnError,
  enqueueCostVerificationIfNeeded,
  validateAndReserveCredits,
} from "../../http/utils/generationCreditManagement";
import {
  isByokAuthenticationError,
  normalizeByokError,
  logErrorDetails,
  handleCreditErrors,
} from "../../http/utils/generationErrorHandling";
import { prepareLLMCall } from "../../http/utils/generationLLMSetup";
import {
  validateSubscriptionAndLimits,
  trackSuccessfulRequest,
} from "../../http/utils/generationRequestTracking";
import { extractTokenUsageAndCosts } from "../../http/utils/generationTokenExtraction";
import { database } from "../../tables";
import { isUserAuthorized } from "../../tables/permissions";
import {
  updateConversation,
  buildConversationErrorInfo,
  type StreamTextResultWithResolvedUsage,
  type TokenUsage,
} from "../../utils/conversationLogger";
import {
  adaptHttpHandler,
  transformLambdaUrlToHttpV2Event,
  type LambdaUrlEvent,
} from "../../utils/httpEventAdapter";
import { extractAllOpenRouterGenerationIds } from "../../utils/openrouterUtils";
import { flushPostHog } from "../../utils/posthog";
import {
  initSentry,
  Sentry,
  flushSentry,
  ensureError,
} from "../../utils/sentry";
import {
  getAllowedOrigins,
  validateSecret,
} from "../../utils/streamServerUtils";
import { verifyAccessToken } from "../../utils/tokenUtils";
import {
  getContextFromRequestId,
  augmentContextWithCreditTransactions,
  setCurrentHTTPContext,
  clearCurrentHTTPContext,
} from "../../utils/workspaceCreditContext";
import { setupAgentAndTools } from "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/agentSetup";
import {
  convertAiSdkUIMessagesToUIMessages,
  convertTextToUIMessage,
  convertUIMessagesToModelMessages,
} from "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/messageConversion";
import {
  formatToolCallMessage,
  formatToolResultMessage,
} from "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/toolFormatting";
import type { UIMessage } from "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/types";

import { getDefined } from "@/utils";

// Initialize Sentry when this module is loaded (before any handlers are called)
initSentry();

/**
 * Endpoint type: test (JWT auth) or stream (secret auth)
 */
type EndpointType = "test" | "stream";

/**
 * Path parameters extracted from the request
 */
interface PathParameters {
  workspaceId: string;
  agentId: string;
  secret?: string; // Optional for test endpoint
  endpointType: EndpointType;
}

/**
 * Request context for processing the stream
 */
interface StreamRequestContext {
  workspaceId: string;
  agentId: string;
  secret?: string; // Optional for test endpoint
  endpointType: EndpointType;
  conversationId: string;
  origin: string | undefined;
  allowedOrigins: string[] | null;
  subscriptionId: string | undefined;
  db: Awaited<ReturnType<typeof database>>;
  uiMessage: UIMessage;
  convertedMessages: UIMessage[];
  modelMessages: ModelMessage[];
  agent: Awaited<ReturnType<typeof setupAgentAndTools>>["agent"];
  model: Awaited<ReturnType<typeof setupAgentAndTools>>["model"];
  tools: Awaited<ReturnType<typeof setupAgentAndTools>>["tools"];
  usesByok: boolean;
  reservationId: string | undefined;
  finalModelName: string;
  awsRequestId?: string;
  userId?: string; // For test endpoint
}

async function persistConversationError(
  context: StreamRequestContext | undefined,
  error: unknown
): Promise<void> {
  if (!context) return;

  try {
    // Log error structure before extraction (especially for BYOK)
    if (context.usesByok) {
      type ErrorWithCustomFields = Error & {
        data?: { error?: { message?: string } };
        statusCode?: number;
        response?: { data?: { error?: { message?: string } } };
      };
      const errorAny =
        error instanceof Error ? (error as ErrorWithCustomFields) : undefined;

      const causeAny =
        error instanceof Error && error.cause instanceof Error
          ? (error.cause as ErrorWithCustomFields)
          : undefined;
      console.log("[Stream Handler] BYOK error before extraction:", {
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        errorName: error instanceof Error ? error.name : "N/A",
        errorMessage: error instanceof Error ? error.message : String(error),
        hasData: !!errorAny?.data,
        dataError: errorAny?.data?.error,
        dataErrorMessage: errorAny?.data?.error?.message,
        hasCause: error instanceof Error && !!error.cause,
        causeType:
          error instanceof Error && error.cause instanceof Error
            ? error.cause.constructor.name
            : undefined,
        causeMessage:
          error instanceof Error && error.cause instanceof Error
            ? error.cause.message
            : undefined,
        causeData: causeAny?.data?.error?.message,
      });
    }

    const errorInfo = buildConversationErrorInfo(error, {
      provider: "openrouter",
      modelName: context.finalModelName,
      endpoint: context.endpointType,
      metadata: {
        usesByok: context.usesByok,
      },
    });

    // Log extracted error info (especially for BYOK)
    if (context.usesByok) {
      console.log("[Stream Handler] BYOK error after extraction:", {
        message: errorInfo.message,
        name: errorInfo.name,
        code: errorInfo.code,
        statusCode: errorInfo.statusCode,
      });
    }

    await updateConversation(
      context.db,
      context.workspaceId,
      context.agentId,
      context.conversationId,
      context.convertedMessages ?? [],
      undefined,
      context.usesByok,
      errorInfo,
      context.awsRequestId,
      context.endpointType
    );
  } catch (logError) {
    console.error("[Stream Handler] Failed to persist conversation error:", {
      originalError: error instanceof Error ? error.message : String(error),
      logError: logError instanceof Error ? logError.message : String(logError),
      workspaceId: context.workspaceId,
      agentId: context.agentId,
      conversationId: context.conversationId,
    });
  }
}

const DEFAULT_CONTENT_TYPE = "text/event-stream; charset=utf-8";

/**
 * Detects if handler is invoked via Lambda Function URL
 */
function isLambdaFunctionUrlInvocation(): boolean {
  return (
    typeof awslambda !== "undefined" &&
    typeof awslambda.streamifyResponse === "function"
  );
}

/**
 * Detects endpoint type based on path pattern
 */
function detectEndpointType(path: string): EndpointType {
  // Pattern: /api/streams/{workspaceId}/{agentId}/test
  if (path.match(/^\/api\/streams\/[^/]+\/[^/]+\/test$/)) {
    return "test";
  }
  // Pattern: /api/streams/{workspaceId}/{agentId}/{secret}
  return "stream";
}

/**
 * Get CORS headers based on endpoint type and allowed origins
 */
function getResponseHeaders(
  endpointType: EndpointType,
  origin: string | undefined,
  allowedOrigins: string[] | null
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": DEFAULT_CONTENT_TYPE,
  };

  if (endpointType === "test") {
    // Test endpoint: Always use FRONTEND_URL
    const frontendUrl = process.env.FRONTEND_URL;
    headers["Access-Control-Allow-Origin"] = frontendUrl || "*";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] =
      "Content-Type, Authorization, X-Requested-With, Origin, Accept, X-Conversation-Id";
    if (frontendUrl) {
      headers["Access-Control-Allow-Credentials"] = "true";
    }
    return headers;
  }

  // Stream endpoint: Use agent streaming server configuration
  if (!allowedOrigins || allowedOrigins.length === 0) {
    // No CORS configuration - allow all origins (default permissive behavior)
    headers["Access-Control-Allow-Origin"] = "*";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] =
      "Content-Type, Authorization, X-Requested-With, Origin, Accept, X-Conversation-Id";
    return headers;
  }

  // Check if wildcard is allowed
  if (allowedOrigins.includes("*")) {
    headers["Access-Control-Allow-Origin"] = "*";
  } else if (origin && allowedOrigins.includes(origin)) {
    // Only allow if origin is explicitly in the allowed list
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  // If origin doesn't match and no wildcard, no Access-Control-Allow-Origin header is set
  // This will cause the browser to reject the CORS request

  headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
  headers["Access-Control-Allow-Headers"] =
    "Content-Type, Authorization, X-Requested-With, Origin, Accept, X-Conversation-Id";

  console.log("[Stream Handler] Response headers:", headers);
  return headers;
}

/**
 * Extracts path parameters from the event (supports both Lambda Function URL and API Gateway)
 */
function extractPathParameters(
  event: LambdaUrlEvent | APIGatewayProxyEventV2
): PathParameters | null {
  // Normalize to HTTP v2 event format
  const httpV2Event =
    "rawPath" in event && "requestContext" in event
      ? transformLambdaUrlToHttpV2Event(event as LambdaUrlEvent)
      : (event as APIGatewayProxyEventV2);

  const rawPath = httpV2Event.rawPath || "";
  const normalizedPath = rawPath.replace(/^\/+/, "/");

  // Detect endpoint type
  const endpointType = detectEndpointType(normalizedPath);

  let workspaceId = httpV2Event.pathParameters?.workspaceId;
  let agentId = httpV2Event.pathParameters?.agentId;
  let secret: string | undefined;

  // Extract based on endpoint type
  if (endpointType === "test") {
    // Pattern: /api/streams/{workspaceId}/{agentId}/test
    const testMatch = normalizedPath.match(
      /^\/api\/streams\/([^/]+)\/([^/]+)\/test$/
    );
    if (testMatch) {
      workspaceId = testMatch[1];
      agentId = testMatch[2];
    }
  } else {
    // Pattern: /api/streams/{workspaceId}/{agentId}/{secret}
    // Secret can contain slashes, so we match everything after agentId
    secret = httpV2Event.pathParameters?.secret;
    if (!workspaceId || !agentId || !secret) {
      const streamMatch = normalizedPath.match(
        /^\/api\/streams\/([^/]+)\/([^/]+)\/(.+)$/
      );
      if (streamMatch) {
        workspaceId = streamMatch[1];
        agentId = streamMatch[2];
        secret = streamMatch[3]; // This can contain slashes
      }
    }
  }

  if (!workspaceId || !agentId) {
    console.log("[Stream Handler] Path extraction failed:", {
      rawPath,
      normalizedPath,
      pathParameters: httpV2Event.pathParameters,
      endpointType,
    });
    return null;
  }

  // For stream endpoint, secret is required
  if (endpointType === "stream" && !secret) {
    console.log("[Stream Handler] Secret missing for stream endpoint:", {
      rawPath,
      normalizedPath,
      pathParameters: httpV2Event.pathParameters,
    });
    return null;
  }

  return { workspaceId, agentId, secret, endpointType };
}

/**
 * Authenticates request based on endpoint type
 * Test endpoint: JWT Bearer token authentication
 * Stream endpoint: Secret validation
 */
async function authenticateRequest(
  endpointType: EndpointType,
  event: LambdaUrlEvent | APIGatewayProxyEventV2,
  workspaceId: string,
  agentId: string,
  secret?: string
): Promise<{ authenticated: boolean; userId?: string }> {
  if (endpointType === "test") {
    // Extract and verify JWT token
    const authHeader =
      event.headers["authorization"] || event.headers["Authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      throw unauthorized("Missing or invalid Authorization header");
    }
    const token = authHeader.substring(7);
    // Verify token
    const tokenPayload = await verifyAccessToken(token);

    // Verify workspace access (similar to Express middleware)
    const userRef = `users/${tokenPayload.userId}`;
    const resource = `workspaces/${workspaceId}`;
    const [authorized] = await isUserAuthorized(userRef, resource, 1); // READ permission

    if (!authorized) {
      throw forbidden("Insufficient permissions to access this workspace");
    }

    return { authenticated: true, userId: tokenPayload.userId };
  } else {
    // Validate secret
    if (!secret) {
      throw unauthorized("Missing secret");
    }
    const isValid = await validateSecret(workspaceId, agentId, secret);
    if (!isValid) {
      throw unauthorized("Invalid secret");
    }
    return { authenticated: true };
  }
}

/**
 * Validates subscription and plan limits
 * Note: This is a wrapper around the shared utility for backward compatibility
 */
async function validateSubscriptionAndLimitsStream(
  workspaceId: string,
  endpointType: EndpointType = "stream"
): Promise<string | undefined> {
  return await validateSubscriptionAndLimits(workspaceId, endpointType);
}

/**
 * Sets up the agent, model, and tools for the request
 */
async function setupAgentContext(
  workspaceId: string,
  agentId: string,
  modelReferer: string,
  context?: Awaited<ReturnType<typeof getContextFromRequestId>>,
  conversationId?: string
): Promise<{
  agent: Awaited<ReturnType<typeof setupAgentAndTools>>["agent"];
  model: Awaited<ReturnType<typeof setupAgentAndTools>>["model"];
  tools: Awaited<ReturnType<typeof setupAgentAndTools>>["tools"];
  usesByok: boolean;
}> {
  const result = await setupAgentAndTools(
    workspaceId,
    agentId,
    [], // No conversation history for streaming endpoint
    {
      modelReferer,
      callDepth: 0,
      maxDelegationDepth: 3,
      context,
      conversationId,
      searchDocumentsOptions: {
        description:
          "Search workspace documents using semantic vector search. Returns the most relevant document snippets based on the query.",
        queryDescription:
          "The search query or prompt to find relevant document snippets",
        formatResults: (results) => {
          return results
            .map(
              (result, index) =>
                `[${index + 1}] Document: ${result.documentName}${
                  result.folderPath ? ` (${result.folderPath})` : ""
                }\nSimilarity: ${(result.similarity * 100).toFixed(
                  1
                )}%\nContent:\n${result.snippet}\n`
            )
            .join("\n---\n\n");
        },
      },
    }
  );

  return {
    agent: result.agent,
    model: result.model,
    tools: result.tools,
    usesByok: result.usesByok,
  };
}

/**
 * Extracts and decodes the request body
 */
function extractRequestBody(
  event: LambdaUrlEvent | APIGatewayProxyEventV2
): string {
  if (!event.body) {
    return "";
  }

  const decodedBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString()
    : event.body;

  return decodedBody.trim();
}

/**
 * Converts the request body to model messages
 * Supports both plain text and JSON message arrays (for tool results)
 * When messages are from useChat, they are in ai-sdk UIMessage format
 */
function convertRequestBodyToMessages(bodyText: string): {
  uiMessage: UIMessage;
  modelMessages: ModelMessage[];
  convertedMessages: UIMessage[];
} {
  // Try to parse as JSON first (for messages with tool results)
  let messages: UIMessage[] | null = null;
  try {
    const parsed = JSON.parse(bodyText);

    // Check if it's an array of messages (from useChat)
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Validate that it looks like UIMessage array
      const firstMessage = parsed[0];
      if (
        typeof firstMessage === "object" &&
        firstMessage !== null &&
        "role" in firstMessage &&
        "content" in firstMessage
      ) {
        messages = parsed as UIMessage[];
      }
    }
    // Check if it's an object with a 'messages' property (from useChat with full state)
    else if (
      typeof parsed === "object" &&
      parsed !== null &&
      "messages" in parsed &&
      Array.isArray(parsed.messages) &&
      parsed.messages.length > 0
    ) {
      // Extract the messages array from the object
      const messagesArray = parsed.messages;
      const firstMessage = messagesArray[0];
      if (
        typeof firstMessage === "object" &&
        firstMessage !== null &&
        "role" in firstMessage
      ) {
        messages = messagesArray as UIMessage[];
      }
    }
  } catch {
    // Not JSON, treat as plain text
  }

  // If we have parsed messages, use them; otherwise treat as plain text
  if (messages && messages.length > 0) {
    // Check if messages are in ai-sdk format (have 'parts' property)
    // Messages from useChat will have 'parts', our local format has 'content'
    const firstMsg = messages[0];
    const isAiSdkFormat =
      firstMsg &&
      typeof firstMsg === "object" &&
      "parts" in firstMsg &&
      Array.isArray(firstMsg.parts);

    // Convert all messages from AI SDK format to our format if needed
    let convertedMessages: UIMessage[] = messages;
    if (isAiSdkFormat) {
      convertedMessages = convertAiSdkUIMessagesToUIMessages(messages);
    }

    // Get the last user message for uiMessage (for logging)
    // Use converted messages to ensure proper format
    const lastUserMessage = convertedMessages
      .slice()
      .reverse()
      .find((msg) => msg.role === "user");
    const uiMessage: UIMessage =
      lastUserMessage ||
      convertedMessages[convertedMessages.length - 1] ||
      convertTextToUIMessage(bodyText);

    let modelMessages: ModelMessage[];
    try {
      if (isAiSdkFormat) {
        // Messages from useChat are in ai-sdk UIMessage format with 'parts'
        // Use convertToModelMessages from ai-sdk
        modelMessages = convertToModelMessages(
          messages as unknown as Array<Omit<import("ai").UIMessage, "id">>
        );
      } else {
        // Messages are in our local UIMessage format with 'content'
        // Use our local converter with converted messages
        modelMessages = convertUIMessagesToModelMessages(convertedMessages);
      }
    } catch (error) {
      console.error("[Stream Handler] Error converting messages:", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        isAiSdkFormat,
        messageCount: messages.length,
        firstMessageKeys:
          firstMsg && typeof firstMsg === "object"
            ? Object.keys(firstMsg)
            : "N/A",
      });
      throw error;
    }

    return { uiMessage, modelMessages, convertedMessages };
  }

  // Fallback to plain text handling
  const uiMessage = convertTextToUIMessage(bodyText);
  // For plain text, use our local converter since it's in our UIMessage format
  const modelMessages: ModelMessage[] = convertUIMessagesToModelMessages([
    uiMessage,
  ]);

  return { uiMessage, modelMessages, convertedMessages: [uiMessage] };
}

/**
 * Validates credits, spending limits, and reserves credits before the LLM call
 * Returns the reservation ID if credits were reserved
 */
async function validateCreditsAndReserveBeforeLLM(
  db: Awaited<ReturnType<typeof database>>,
  workspaceId: string,
  agentId: string,
  agent: Awaited<ReturnType<typeof setupAgentAndTools>>["agent"],
  modelMessages: ModelMessage[],
  tools: Awaited<ReturnType<typeof setupAgentAndTools>>["tools"],
  usesByok: boolean,
  endpointType: EndpointType,
  context?: Awaited<ReturnType<typeof getContextFromRequestId>>,
  conversationId?: string
): Promise<string | undefined> {
  // Derive the model name from the agent's modelName if set, otherwise use default
  const finalModelName =
    typeof agent.modelName === "string" ? agent.modelName : MODEL_NAME;

  return await validateAndReserveCredits(
    db,
    workspaceId,
    agentId,
    "openrouter", // provider
    finalModelName,
    modelMessages,
    agent.systemPrompt,
    tools,
    usesByok,
    endpointType,
    context,
    conversationId
  );
}

/**
 * Writes a chunk to the response stream
 * Returns a Promise that resolves when the chunk is written
 * Accepts both string and Uint8Array for flexibility
 */
function writeChunkToStream(
  responseStream: HttpResponseStream,
  chunk: string | Uint8Array
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    responseStream.write(chunk, (error) => {
      if (error) {
        console.error("[Stream Handler] Error writing chunk:", {
          error: error instanceof Error ? error.message : String(error),
        });
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Streams the AI response to the client using toUIMessageStreamResponse() format
 * Reads from the UI message stream and writes chunks to responseStream as they arrive
 */
async function streamAIResponse(
  agent: Awaited<ReturnType<typeof setupAgentAndTools>>["agent"],
  model: Awaited<ReturnType<typeof setupAgentAndTools>>["model"],
  modelMessages: ModelMessage[],
  tools: Awaited<ReturnType<typeof setupAgentAndTools>>["tools"],
  responseStream: HttpResponseStream,
  onTextChunk: (text: string) => void
): Promise<Awaited<ReturnType<typeof streamText>>> {
  // Prepare LLM call (logging and generate options)
  const generateOptions = prepareLLMCall(
    agent,
    tools,
    modelMessages,
    "stream",
    "stream",
    "stream"
  );

  const streamResult = streamText({
    model: model as unknown as Parameters<typeof streamText>[0]["model"],
    system: agent.systemPrompt,
    messages: modelMessages,
    tools,
    ...generateOptions,
  });

  // Get the UI message stream response from streamText result
  // This might throw NoOutputGeneratedError if there was an error during streaming
  // This returns SSE format (Server-Sent Events) that useChat expects
  // Errors will be caught by the outer handler which has access to usesByok
  const streamResponse = streamResult.toUIMessageStreamResponse();

  // Read from the stream and write chunks to responseStream immediately as they arrive
  // This ensures true streaming without buffering
  const reader = streamResponse.body?.getReader();
  if (!reader) {
    throw new Error("Stream response body is null");
  }

  const decoder = new TextDecoder();
  let textBuffer = ""; // Buffer for extracting text deltas (for logging/tracking only)
  let streamCompletedSuccessfully = false; // Track if stream completed without error

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        // Write the raw chunk immediately to responseStream for true streaming
        // Don't buffer - write as soon as we receive it
        await writeChunkToStream(responseStream, value);

        // Also decode for text extraction (for tracking purposes only)
        // This doesn't affect streaming performance
        const chunk = decoder.decode(value, { stream: true });
        textBuffer += chunk;

        // Try to extract text deltas from complete lines for tracking
        // Only process if we have complete lines (ending with \n)
        if (chunk.includes("\n")) {
          const lines = textBuffer.split("\n");
          textBuffer = lines.pop() || ""; // Keep incomplete line

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const jsonStr = line.substring(6); // Remove "data: " prefix
                const parsed = JSON.parse(jsonStr);
                if (parsed.type === "text-delta" && parsed.textDelta) {
                  onTextChunk(parsed.textDelta);
                } else if (parsed.type === "text" && parsed.text) {
                  onTextChunk(parsed.text);
                }
              } catch {
                // Not JSON or parsing failed, skip text extraction
              }
            }
          }
        }
      }
    }

    // Write any remaining buffered text (should be minimal)
    if (textBuffer) {
      const remainingBytes = new TextEncoder().encode(textBuffer);
      await writeChunkToStream(responseStream, remainingBytes);
    }

    // Mark as successfully completed before ending stream
    streamCompletedSuccessfully = true;

    // End the stream after all chunks are written successfully
    console.log("[Stream Handler] All chunks written, ending stream");
    responseStream.end();
  } catch (streamError) {
    // Release the reader lock before re-throwing
    reader.releaseLock();
    // Don't end the stream here - let the outer error handler do it
    // Re-throw to let outer handler catch it (which has access to usesByok and responseStream)
    throw streamError;
  } finally {
    reader.releaseLock();
    // Only end stream here if it completed successfully but wasn't ended above
    // (This is a safety net for edge cases)
    if (streamCompletedSuccessfully) {
      try {
        // Check if stream is still writable before ending
        // If it's already ended, this will throw, which we'll catch and ignore
        responseStream.end();
      } catch (endError) {
        // Stream might already be ended, ignore
        console.warn(
          "[Stream Handler] Stream already ended (expected in normal flow):",
          {
            error:
              endError instanceof Error ? endError.message : String(endError),
          }
        );
      }
    }
    // If streamCompletedSuccessfully is false, there was an error - don't end stream here
    // Let the error handler do it
  }

  return streamResult;
}

/**
 * Adjusts credit reservation after the stream completes
 * Uses adjustCreditReservation instead of direct debit
 */
async function adjustCreditsAfterStream(
  db: Awaited<ReturnType<typeof database>>,
  workspaceId: string,
  agentId: string,
  reservationId: string | undefined,
  finalModelName: string,
  tokenUsage: TokenUsage | undefined,
  usesByok: boolean,
  streamResult?: Awaited<ReturnType<typeof streamText>>,
  conversationId?: string,
  awsRequestId?: string,
  endpointType: EndpointType = "stream"
): Promise<void> {
  // Extract all OpenRouter generation IDs for cost verification
  const openrouterGenerationIds = streamResult
    ? extractAllOpenRouterGenerationIds(streamResult)
    : [];
  const openrouterGenerationId =
    openrouterGenerationIds.length > 0 ? openrouterGenerationIds[0] : undefined;

  // Get context for workspace credit transactions
  const lambdaContext = getContextFromRequestId(awsRequestId);
  if (!lambdaContext) {
    throw new Error("Context not available for workspace credit transactions");
  }

  // Adjust credits using shared utility
  await adjustCreditsAfterLLMCall(
    db,
    workspaceId,
    agentId,
    reservationId,
    "openrouter",
    finalModelName,
    tokenUsage,
    usesByok,
    openrouterGenerationId,
    openrouterGenerationIds, // New parameter
    endpointType,
    lambdaContext,
    conversationId
  );

  // Enqueue cost verification (Step 3) if we have generation IDs
  await enqueueCostVerificationIfNeeded(
    openrouterGenerationId, // Keep for backward compat
    openrouterGenerationIds, // New parameter
    workspaceId,
    reservationId,
    conversationId,
    agentId,
    endpointType
  );
}

/**
 * Tracks the successful LLM request
 * Note: This is a wrapper around the shared utility for backward compatibility
 */
async function trackRequestUsage(
  subscriptionId: string | undefined,
  workspaceId: string,
  agentId: string,
  endpointType: EndpointType = "stream"
): Promise<void> {
  // Track successful request using shared utility
  await trackSuccessfulRequest(
    subscriptionId,
    workspaceId,
    agentId,
    endpointType
  );
}

/**
 * Logs the conversation
 */
async function logConversation(
  db: Awaited<ReturnType<typeof database>>,
  workspaceId: string,
  agentId: string,
  conversationId: string,
  convertedMessages: UIMessage[],
  finalResponseText: string,
  tokenUsage: TokenUsage | undefined,
  usesByok: boolean,
  finalModelName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- streamText result type is complex
  streamResult: any,
  awsRequestId?: string,
  generationTimeMs?: number,
  endpointType: EndpointType = "stream"
): Promise<void> {
  if (!tokenUsage) {
    return Promise.resolve();
  }

  try {
    // Extract tool calls and tool results from streamText result
    // streamText result properties are promises that need to be awaited
    // For streamText, tool calls/results may be in _steps array or directly on result
    const [toolCallsFromResultRaw, toolResultsFromResultRaw, stepsValue] =
      await Promise.all([
        Promise.resolve(streamResult?.toolCalls).then((tc) => tc || []),
        Promise.resolve(streamResult?.toolResults).then((tr) => tr || []),
        Promise.resolve(streamResult?._steps?.status?.value).then(
          (s) => s || []
        ),
      ]);

    // Extract tool calls and results from _steps if they exist
    const toolCallsFromSteps: unknown[] = [];
    const toolResultsFromSteps: unknown[] = [];

    if (Array.isArray(stepsValue)) {
      for (const step of stepsValue) {
        if (step?.content && Array.isArray(step.content)) {
          for (const contentItem of step.content) {
            if (
              typeof contentItem === "object" &&
              contentItem !== null &&
              "type" in contentItem
            ) {
              if (contentItem.type === "tool-call") {
                // Convert AI SDK tool-call format to our format
                toolCallsFromSteps.push({
                  toolCallId: contentItem.toolCallId,
                  toolName: contentItem.toolName,
                  args: contentItem.input || contentItem.args || {},
                });
              } else if (contentItem.type === "tool-result") {
                // Convert AI SDK tool-result format to our format
                toolResultsFromSteps.push({
                  toolCallId: contentItem.toolCallId,
                  toolName: contentItem.toolName,
                  output:
                    contentItem.output?.value ||
                    contentItem.output ||
                    contentItem.result,
                  result:
                    contentItem.output?.value ||
                    contentItem.output ||
                    contentItem.result,
                });
              }
            }
          }
        }
      }
    }

    // Use tool calls/results from _steps if available, otherwise fall back to direct properties
    // Ensure toolCalls and toolResults are always arrays
    let toolCallsFromResult = Array.isArray(toolCallsFromResultRaw)
      ? toolCallsFromResultRaw
      : [];
    let toolResultsFromResult = Array.isArray(toolResultsFromResultRaw)
      ? toolResultsFromResultRaw
      : [];

    // Prefer tool calls/results from _steps if we found any
    if (toolCallsFromSteps.length > 0) {
      toolCallsFromResult = toolCallsFromSteps;
    }
    if (toolResultsFromSteps.length > 0) {
      toolResultsFromResult = toolResultsFromSteps;
    }

    // DIAGNOSTIC: Log tool calls and results extracted from stream result
    console.log("[Stream Handler] Tool calls extracted from stream result:", {
      toolCallsCount: toolCallsFromResult.length,
      toolCalls: toolCallsFromResult,
      toolResultsCount: toolResultsFromResult.length,
      toolResults: toolResultsFromResult,
      toolCallsFromStepsCount: toolCallsFromSteps.length,
      toolResultsFromStepsCount: toolResultsFromSteps.length,
      streamResultKeys: streamResult ? Object.keys(streamResult) : [],
      hasToolCalls: streamResult && "toolCalls" in streamResult,
      hasToolResults: streamResult && "toolResults" in streamResult,
      hasSteps: streamResult && "_steps" in streamResult,
      stepsCount: Array.isArray(stepsValue) ? stepsValue.length : 0,
    });

    // FIX: If tool calls are missing but tool results exist, reconstruct tool calls from results
    // This can happen when tools execute synchronously and the AI SDK doesn't populate toolCalls
    if (toolCallsFromResult.length === 0 && toolResultsFromResult.length > 0) {
      console.log(
        "[Stream Handler] Tool calls missing but tool results exist, reconstructing tool calls from results"
      );
      // Reconstruct tool calls from tool results - cast to any since we're creating a compatible structure
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool result types vary
      toolCallsFromResult = toolResultsFromResult.map((toolResult: any) => ({
        toolCallId:
          toolResult.toolCallId ||
          `call-${Math.random().toString(36).substring(7)}`,
        toolName: toolResult.toolName || "unknown",
        args: toolResult.args || toolResult.input || {},
      })) as unknown as typeof toolCallsFromResult;
      console.log(
        "[Stream Handler] Reconstructed tool calls:",
        toolCallsFromResult
      );
    }

    // Format tool calls and results as UI messages
    const toolCallMessages = toolCallsFromResult.map(formatToolCallMessage);
    const toolResultMessages = toolResultsFromResult.map(
      formatToolResultMessage
    );

    // Build assistant response message with tool calls, results, and text
    const assistantContent: Array<
      | { type: "text"; text: string }
      | {
          type: "tool-call";
          toolCallId: string;
          toolName: string;
          args: unknown;
        }
      | {
          type: "tool-result";
          toolCallId: string;
          toolName: string;
          result: unknown;
        }
    > = [];

    // Add tool calls
    for (const toolCallMsg of toolCallMessages) {
      if (Array.isArray(toolCallMsg.content)) {
        assistantContent.push(...toolCallMsg.content);
      }
    }

    // Add tool results
    for (const toolResultMsg of toolResultMessages) {
      if (Array.isArray(toolResultMsg.content)) {
        assistantContent.push(...toolResultMsg.content);
      }
    }

    // Add text response if present
    // finalResponseText includes the complete final response including continuation responses after tool execution
    if (finalResponseText && finalResponseText.trim().length > 0) {
      assistantContent.push({ type: "text", text: finalResponseText });
    }

    // Extract token usage, generation ID, and costs
    // streamResult.totalUsage is a Promise, so we need to await it
    const totalUsage = await streamResult.totalUsage;
    // Pass totalUsage directly - extractTokenUsage handles field name variations
    // (LanguageModelV2Usage may use different field names than our LanguageModelUsage)
    const {
      openrouterGenerationId,
      provisionalCostUsd: extractedProvisionalCostUsd,
    } = extractTokenUsageAndCosts(
      { totalUsage } as unknown as StreamTextResultWithResolvedUsage,
      undefined,
      finalModelName,
      "stream"
    );
    const provisionalCostUsd = extractedProvisionalCostUsd;

    // Create assistant message with token usage, modelName, provider, costs, and generation time
    const assistantMessage: UIMessage = {
      role: "assistant",
      content:
        assistantContent.length > 0 ? assistantContent : finalResponseText,
      ...(tokenUsage && { tokenUsage }),
      modelName: finalModelName,
      provider: "openrouter",
      ...(openrouterGenerationId && { openrouterGenerationId }),
      ...(provisionalCostUsd !== undefined && { provisionalCostUsd }),
      ...(generationTimeMs !== undefined && { generationTimeMs }),
    };

    // DIAGNOSTIC: Log assistant message structure
    console.log("[Stream Handler] Assistant message created:", {
      role: assistantMessage.role,
      contentType: typeof assistantMessage.content,
      isArray: Array.isArray(assistantMessage.content),
      contentLength: Array.isArray(assistantMessage.content)
        ? assistantMessage.content.length
        : "N/A",
      content: Array.isArray(assistantMessage.content)
        ? assistantMessage.content
        : assistantMessage.content,
      hasToolCallsInContent: Array.isArray(assistantMessage.content)
        ? assistantMessage.content.some(
            (item) =>
              typeof item === "object" &&
              item !== null &&
              "type" in item &&
              item.type === "tool-call"
          )
        : false,
      hasToolResultsInContent: Array.isArray(assistantMessage.content)
        ? assistantMessage.content.some(
            (item) =>
              typeof item === "object" &&
              item !== null &&
              "type" in item &&
              item.type === "tool-result"
          )
        : false,
      toolCallsInContent: Array.isArray(assistantMessage.content)
        ? assistantMessage.content.filter(
            (item) =>
              typeof item === "object" &&
              item !== null &&
              "type" in item &&
              item.type === "tool-call"
          )
        : [],
      toolResultsInContent: Array.isArray(assistantMessage.content)
        ? assistantMessage.content.filter(
            (item) =>
              typeof item === "object" &&
              item !== null &&
              "type" in item &&
              item.type === "tool-result"
          )
        : [],
    });

    // Combine all converted messages and assistant message for logging
    // Deduplication will happen in updateConversation (same as test endpoint)
    const messagesForLogging: UIMessage[] = [
      ...convertedMessages,
      assistantMessage,
    ];

    // Get valid messages for logging (filter out any invalid ones, but keep empty messages)
    const validMessages: UIMessage[] = messagesForLogging.filter(
      (msg): msg is UIMessage =>
        msg != null &&
        typeof msg === "object" &&
        "role" in msg &&
        typeof msg.role === "string" &&
        (msg.role === "user" ||
          msg.role === "assistant" ||
          msg.role === "system" ||
          msg.role === "tool") &&
        "content" in msg
    );

    // DIAGNOSTIC: Log messages being passed to updateConversation
    console.log(
      "[Stream Handler] Messages being passed to updateConversation:",
      {
        messagesForLoggingCount: messagesForLogging.length,
        validMessagesCount: validMessages.length,
        assistantMessageInValid: validMessages.some(
          (msg) => msg.role === "assistant"
        ),
        messages: validMessages.map((msg) => ({
          role: msg.role,
          contentType: typeof msg.content,
          isArray: Array.isArray(msg.content),
          contentLength: Array.isArray(msg.content)
            ? msg.content.length
            : "N/A",
          hasToolCalls: Array.isArray(msg.content)
            ? msg.content.some(
                (item) =>
                  typeof item === "object" &&
                  item !== null &&
                  "type" in item &&
                  item.type === "tool-call"
              )
            : false,
          hasToolResults: Array.isArray(msg.content)
            ? msg.content.some(
                (item) =>
                  typeof item === "object" &&
                  item !== null &&
                  "type" in item &&
                  item.type === "tool-result"
              )
            : false,
        })),
      }
    );

    // Update existing conversation
    await updateConversation(
      db,
      workspaceId,
      agentId,
      conversationId,
      validMessages,
      tokenUsage,
      usesByok,
      undefined,
      awsRequestId,
      endpointType
    ).catch((error) => {
      // Log error but don't fail the request
      console.error("[Stream Handler] Error logging conversation:", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        workspaceId,
        agentId,
      });
      // Report to Sentry
      Sentry.captureException(ensureError(error), {
        tags: {
          endpoint: endpointType,
          operation: "conversation_logging",
        },
        extra: {
          workspaceId,
          agentId,
        },
      });
    });
  } catch (error) {
    // Log error but don't fail the request
    console.error("[Stream Handler] Error preparing conversation log:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      workspaceId,
      agentId,
    });
    // Report to Sentry
    Sentry.captureException(ensureError(error), {
      tags: {
        endpoint: endpointType,
        operation: "conversation_logging",
      },
      extra: {
        workspaceId,
        agentId,
      },
    });
  }
}

/**
 * Writes an error response to the stream in SSE format
 * Uses direct write/end methods on the HttpResponseStream
 * Format: "data: {...}\n\n" (SSE format)
 */
async function writeErrorResponse(
  responseStream: HttpResponseStream,
  error: unknown
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  // Use SSE format: data: {...}\n\n
  const errorChunk = `data: ${JSON.stringify({
    type: "error",
    error: errorMessage,
  })}\n\n`;

  console.log("[Stream Handler] Writing error response:", {
    errorMessage,
    errorChunk,
    errorChunkLength: errorChunk.length,
  });

  try {
    // Write error body directly to the original stream
    // Check if stream is writable before writing
    await writeChunkToStream(responseStream, errorChunk);

    // End the stream only if it's not already ended
    try {
      responseStream.end();
      console.log("[Stream Handler] Error response written and stream ended");
    } catch (endError) {
      // Stream might already be ended, log but don't throw
      console.warn(
        "[Stream Handler] Stream already ended when trying to end after error:",
        {
          error:
            endError instanceof Error ? endError.message : String(endError),
          originalError: errorMessage,
        }
      );
    }
  } catch (writeError) {
    // If we can't write to the stream (e.g., already ended), just log the error
    // Don't throw - the original error is more important
    console.error(
      "[Stream Handler] Error writing error response (stream may already be ended):",
      {
        writeError:
          writeError instanceof Error ? writeError.message : String(writeError),
        writeErrorType: writeError?.constructor?.name,
        originalError: errorMessage,
        isStreamWriteAfterEnd:
          writeError instanceof Error &&
          writeError.message.includes("write after end"),
      }
    );
    // Try to end the stream even if write failed, but don't throw if it fails
    try {
      responseStream.end();
    } catch (endError) {
      // Stream already ended or in error state - this is expected, just log
      console.warn(
        "[Stream Handler] Stream already ended when trying to end after write failure:",
        {
          endError:
            endError instanceof Error ? endError.message : String(endError),
          originalError: errorMessage,
        }
      );
    }
    // Don't re-throw writeError - we want the original error to be logged, not the stream error
  }
}

/**
 * Builds the complete request context for processing the stream
 */
async function buildRequestContext(
  event: LambdaUrlEvent | APIGatewayProxyEventV2,
  pathParams: PathParameters,
  authResult: { authenticated: boolean; userId?: string }
): Promise<StreamRequestContext> {
  const { workspaceId, agentId, secret, endpointType } = pathParams;

  // Read and validate X-Conversation-Id header
  const conversationId =
    event.headers["x-conversation-id"] || event.headers["X-Conversation-Id"];
  if (!conversationId || typeof conversationId !== "string") {
    throw badRequest("X-Conversation-Id header is required");
  }

  // Get allowed origins for CORS (only for stream endpoint)
  let allowedOrigins: string[] | null = null;
  if (endpointType === "stream") {
    allowedOrigins = await getAllowedOrigins(workspaceId, agentId);
  }
  const origin = event.headers["origin"] || event.headers["Origin"];

  // Validate subscription and limits
  const subscriptionId = await validateSubscriptionAndLimitsStream(
    workspaceId,
    endpointType
  );

  // Setup database connection
  const db = await database();

  // Get context for workspace credit transactions
  const awsRequestId = event.requestContext?.requestId;
  const lambdaContext = getContextFromRequestId(awsRequestId);
  if (!lambdaContext) {
    throw new Error("Context not available for workspace credit transactions");
  }

  // Setup agent context
  // Always use "https://app.helpmaton.com" as the Referer header for LLM provider calls
  const modelReferer = "https://app.helpmaton.com";
  const { agent, model, tools, usesByok } = await setupAgentContext(
    workspaceId,
    agentId,
    modelReferer,
    lambdaContext,
    conversationId
  );

  // Extract and convert request body
  const bodyText = extractRequestBody(event);
  if (!bodyText) {
    throw new Error("Request body is required");
  }

  const { uiMessage, modelMessages, convertedMessages } =
    convertRequestBodyToMessages(bodyText);

  // Derive the model name from the agent's modelName if set, otherwise use default
  const finalModelName =
    typeof agent.modelName === "string" ? agent.modelName : MODEL_NAME;

  // Log client-side tool results if present
  // Get list of client-side tool names from agent configuration
  const clientToolNames = new Set<string>();
  if (
    agent.clientTools &&
    Array.isArray(agent.clientTools) &&
    agent.clientTools.length > 0
  ) {
    for (const clientTool of agent.clientTools) {
      if (clientTool.name) {
        clientToolNames.add(clientTool.name);
      }
    }
  }

  // Check for tool result messages (role: "tool")
  for (const msg of modelMessages) {
    if (
      msg &&
      typeof msg === "object" &&
      "role" in msg &&
      msg.role === "tool" &&
      "toolCallId" in msg &&
      "toolName" in msg
    ) {
      const toolName = (msg as { toolName?: string }).toolName;
      const toolCallId = (msg as { toolCallId?: string }).toolCallId;
      const toolResult = (msg as { result?: unknown }).result;

      if (toolName && clientToolNames.has(toolName)) {
        console.log("[Stream Handler] Client-side tool result received:", {
          toolName,
          toolCallId,
          result: toolResult,
        });
      }
    }
  }

  // Validate credits, spending limits, and reserve credits before LLM call
  const reservationId = await validateCreditsAndReserveBeforeLLM(
    db,
    workspaceId,
    agentId,
    agent,
    modelMessages,
    tools,
    usesByok,
    endpointType,
    lambdaContext,
    conversationId
  );

  // Extract request ID from event (for context access)
  const requestIdForContext = event.requestContext?.requestId;

  return {
    workspaceId,
    agentId,
    secret,
    endpointType,
    conversationId,
    origin,
    allowedOrigins,
    subscriptionId,
    db,
    uiMessage,
    convertedMessages,
    modelMessages,
    agent,
    model,
    tools,
    usesByok,
    reservationId,
    finalModelName,
    awsRequestId: requestIdForContext,
    userId: authResult.userId,
  };
}

/**
 * Internal handler function that processes the request for Lambda Function URL streaming
 * This is wrapped by awslambda.streamifyResponse for streaming support
 * With RESPONSE_STREAM mode, responseStream is already an HttpResponseStream
 */
const internalHandler = async (
  event: LambdaUrlEvent,
  responseStream: HttpResponseStream
): Promise<void> => {
  const pathParams = extractPathParameters(event);
  if (!pathParams) {
    throw notAcceptable("Invalid path parameters");
  }
  let context: StreamRequestContext | undefined;

  // Extract requestId from event for context setup
  const awsRequestId = event.requestContext?.requestId;

  // Create synthetic Lambda context for workspace credit transactions
  // streamifyResponse doesn't provide Context, so we create one
  if (awsRequestId) {
    const syntheticContext: Context = {
      callbackWaitsForEmptyEventLoop: false,
      awsRequestId,
      functionName: process.env.AWS_LAMBDA_FUNCTION_NAME || "stream-handler",
      functionVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION || "$LATEST",
      invokedFunctionArn: process.env.AWS_LAMBDA_FUNCTION_ARN || "",
      memoryLimitInMB: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE || "512",
      getRemainingTimeInMillis: () => {
        // Return a large value since we don't have access to actual remaining time
        // This is only used for logging/debugging, not for actual timeout logic
        return 300000; // 5 minutes default
      },
      logGroupName: process.env.AWS_LAMBDA_LOG_GROUP_NAME || "",
      logStreamName: process.env.AWS_LAMBDA_LOG_STREAM_NAME || "",
      done: () => {},
      fail: () => {},
      succeed: () => {},
    };

    // Augment context with workspace credit transaction capability
    const augmentedContext =
      augmentContextWithCreditTransactions(syntheticContext);

    // Store context in module-level map so buildRequestContext can retrieve it
    setCurrentHTTPContext(awsRequestId, augmentedContext);
  }

  // Get allowed origins for CORS (only for stream endpoint)
  let allowedOrigins: string[] | null = null;
  if (pathParams.endpointType === "stream") {
    allowedOrigins = await getAllowedOrigins(
      pathParams.workspaceId,
      pathParams.agentId
    );
  }

  // Build CORS headers based on endpoint type
  const origin = event.headers["origin"] || event.headers["Origin"];
  const responseHeaders = getResponseHeaders(
    pathParams.endpointType,
    origin,
    allowedOrigins
  );

  responseStream = getDefined(
    awslambda,
    "awslambda is not defined"
  ).HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: responseHeaders,
  });

  try {
    // Handle OPTIONS preflight request
    if (event.requestContext.http.method === "OPTIONS") {
      responseStream.write("");
      responseStream.end();
      return;
    }

    // Extract and validate path parameters
    // Log the path for debugging
    console.log("[Stream Handler] Path extraction:", {
      rawPath: event.rawPath,
      path: event.requestContext?.http?.path,
      method: event.requestContext?.http?.method,
      endpointType: pathParams.endpointType,
    });

    // Authenticate request based on endpoint type
    const authResult = await authenticateRequest(
      pathParams.endpointType,
      event,
      pathParams.workspaceId,
      pathParams.agentId,
      pathParams.secret
    );

    // Build request context
    context = await buildRequestContext(event, pathParams, authResult);

    console.log("[Stream Handler] Building request context...");
    console.log("[Stream Handler] Request context built successfully");

    // Stream the AI response
    // Always write to the original responseStream passed to this function
    let fullStreamedText = "";
    let llmCallAttempted = false;
    let streamResult: Awaited<ReturnType<typeof streamText>> | undefined;

    let generationStartTime: number | undefined;
    let generationTimeMs: number | undefined;
    try {
      console.log("[Stream Handler] Starting AI stream...");
      generationStartTime = Date.now();
      streamResult = await streamAIResponse(
        context.agent,
        context.model,
        context.modelMessages,
        context.tools,
        responseStream, // Use original stream
        (textDelta) => {
          fullStreamedText += textDelta;
        }
      );
      // Calculate generation time when stream completes
      if (generationStartTime !== undefined) {
        generationTimeMs = Date.now() - generationStartTime;
      }
      // LLM call succeeded - mark as attempted
      llmCallAttempted = true;
      console.log("[Stream Handler] AI stream completed");
    } catch (error) {
      // Comprehensive error logging for debugging
      logErrorDetails(error, {
        workspaceId: context.workspaceId,
        agentId: context.agentId,
        usesByok: context.usesByok,
        endpoint: context.endpointType,
      });

      // Normalize BYOK error if needed
      const errorToLog = normalizeByokError(error);

      // Check if this is a BYOK authentication error FIRST
      if (isByokAuthenticationError(error, context.usesByok)) {
        await persistConversationError(context, errorToLog);
        // Use writeErrorResponse which handles stream state properly
        await writeErrorResponse(
          responseStream,
          new Error(
            "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions."
          )
        );
        return;
      }

      // Handle credit errors (for streaming, we write SSE format)
      const creditErrorResult = await handleCreditErrors(
        error,
        context.workspaceId,
        context.endpointType
      );
      if (creditErrorResult.handled && creditErrorResult.response) {
        await persistConversationError(context, error);
        const response = creditErrorResult.response;
        if (
          typeof response === "object" &&
          response !== null &&
          "body" in response
        ) {
          const body = JSON.parse((response as { body: string }).body);
          // Use writeErrorResponse which handles stream state properly
          await writeErrorResponse(responseStream, new Error(body.error));
          return;
        }
      }

      // Error after reservation but before or during LLM call
      if (context.reservationId && context.reservationId !== "byok") {
        // Get context for workspace credit transactions
        const lambdaContext = getContextFromRequestId(context.awsRequestId);
        if (lambdaContext) {
          await cleanupReservationOnError(
            context.db,
            context.reservationId,
            context.workspaceId,
            context.agentId,
            "openrouter",
            context.finalModelName,
            error,
            llmCallAttempted,
            context.usesByok,
            context.endpointType,
            lambdaContext
          );
        } else {
          console.warn(
            "[Stream Handler] Context not available for cleanup, skipping transaction creation"
          );
        }
      }

      // Re-throw error to be handled by error handler
      throw error;
    }

    // If we get here, the LLM call succeeded
    if (!streamResult) {
      throw new Error("LLM call succeeded but result is undefined");
    }

    // Extract text, tool calls, tool results, and usage from streamText result
    // streamText result properties are promises that need to be awaited
    // (same as test endpoint)
    // streamResult.text includes the complete final response including continuation responses after tool execution
    // These might throw NoOutputGeneratedError if there was an error during streaming
    let responseText: string;
    let usage: unknown;

    try {
      [responseText, usage] = await Promise.all([
        Promise.resolve(streamResult.text).then((t) => t || ""),
        Promise.resolve(streamResult.usage),
      ]);
    } catch (resultError) {
      // Check if this is a BYOK authentication error
      if (isByokAuthenticationError(resultError, context.usesByok)) {
        const errorToLog = normalizeByokError(resultError);
        await persistConversationError(context, errorToLog);
        // Use writeErrorResponse which handles stream state properly
        await writeErrorResponse(
          responseStream,
          new Error(
            "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions."
          )
        );
        return;
      }
      // For non-authentication errors when accessing result properties, still log the conversation
      await persistConversationError(context, resultError);
      throw resultError;
    }

    // Use responseText (complete final text) instead of fullStreamedText
    // responseText includes continuation responses after tool execution
    const finalResponseText = responseText || fullStreamedText;

    // DIAGNOSTIC: Log text extraction
    console.log("[Stream Handler] Extracted response text:", {
      responseTextLength: responseText?.length || 0,
      fullStreamedTextLength: fullStreamedText.length,
      usingResponseText: !!responseText && responseText.length > 0,
      responseTextPreview: responseText?.substring(0, 100),
    });

    // Extract token usage, generation ID, and costs
    // streamResult.totalUsage is a Promise, so we need to await it
    const totalUsage = await streamResult.totalUsage;
    // Pass totalUsage directly - extractTokenUsage handles field name variations
    // (LanguageModelV2Usage may use different field names than our LanguageModelUsage)
    const { tokenUsage } = extractTokenUsageAndCosts(
      { totalUsage } as unknown as StreamTextResultWithResolvedUsage,
      usage,
      context.finalModelName,
      context.endpointType
    );

    // DIAGNOSTIC: Log token usage extraction
    console.log("[Stream Handler] Extracted token usage:", {
      tokenUsage,
      usage,
      hasUsage: !!usage,
      streamResultKeys: streamResult ? Object.keys(streamResult) : [],
    });

    // Post-processing: adjust credit reservation, track usage, log conversation
    try {
      await adjustCreditsAfterStream(
        context.db,
        context.workspaceId,
        context.agentId,
        context.reservationId,
        context.finalModelName,
        tokenUsage,
        context.usesByok,
        streamResult,
        context.conversationId,
        context.awsRequestId,
        context.endpointType
      );
    } catch (error) {
      // Log error but don't fail the request
      console.error(
        "[Stream Handler] Error adjusting credit reservation after stream:",
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          workspaceId: context.workspaceId,
          agentId: context.agentId,
          reservationId: context.reservationId,
          tokenUsage,
        }
      );
      // Report to Sentry
      Sentry.captureException(ensureError(error), {
        tags: {
          endpoint: context.endpointType,
          operation: "credit_adjustment",
        },
        extra: {
          workspaceId: context.workspaceId,
          agentId: context.agentId,
          reservationId: context.reservationId,
          tokenUsage,
        },
      });
    }

    await trackRequestUsage(
      context.subscriptionId,
      context.workspaceId,
      context.agentId,
      context.endpointType
    );

    await logConversation(
      context.db,
      context.workspaceId,
      context.agentId,
      context.conversationId,
      context.convertedMessages,
      finalResponseText,
      tokenUsage,
      context.usesByok,
      context.finalModelName,
      streamResult,
      context.awsRequestId,
      generationTimeMs,
      context.endpointType
    );
  } catch (error) {
    const boomed = boomify(error as Error);
    // Handle errors that occur before streaming starts
    console.error("[Stream Handler] Unhandled error:", boomed);
    if (boomed.isServer) {
      // Report 500 errors to Sentry
      console.error("[Stream Handler] Server error details:", boomed);
      Sentry.captureException(ensureError(error), {
        tags: {
          handler: "Stream Handler",
          statusCode: boomed.output.statusCode,
        },
      });
    } else {
      console.error("[Stream Handler] Client error:", boomed);
    }

    // Normalize BYOK error if needed
    const errorToLog = context ? normalizeByokError(error) : error;
    if (context) {
      await persistConversationError(context, errorToLog);
    }
    try {
      await writeErrorResponse(responseStream, error);
      responseStream.end();
    } catch (writeError) {
      console.error("[Stream Handler] Failed to write error response:", {
        error:
          writeError instanceof Error ? writeError.message : String(writeError),
      });
      Sentry.captureException(ensureError(writeError), {
        tags: {
          context: "stream-handler",
          operation: "write-error-response",
        },
      });
    }
  } finally {
    // Clean up context from module-level map
    if (awsRequestId) {
      clearCurrentHTTPContext(awsRequestId);
    }

    // Flush Sentry and PostHog events before Lambda terminates (critical for Lambda)
    // This ensures flushing happens on both success and error paths
    await Promise.all([flushPostHog(), flushSentry()]).catch((flushErrors) => {
      console.error("[PostHog/Sentry] Error flushing events:", flushErrors);
    });
  }
};

/**
 * Handles streaming for API Gateway (buffered approach)
 * Buffers all stream chunks and returns complete response
 */
async function handleApiGatewayStreaming(
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> {
  const pathParams = extractPathParameters(event);
  if (!pathParams) {
    return {
      statusCode: 406,
      body: JSON.stringify({ error: "Invalid path parameters" }),
    };
  }

  // Extract requestId from event for context setup
  const awsRequestId = event.requestContext?.requestId;

  // Store context in module-level map so buildRequestContext can retrieve it
  if (awsRequestId) {
    const augmentedContext = augmentContextWithCreditTransactions(context);
    setCurrentHTTPContext(awsRequestId, augmentedContext);
  }

  // Get allowed origins for CORS (only for stream endpoint)
  let allowedOrigins: string[] | null = null;
  if (pathParams.endpointType === "stream") {
    allowedOrigins = await getAllowedOrigins(
      pathParams.workspaceId,
      pathParams.agentId
    );
  }

  // Build CORS headers based on endpoint type
  const origin = event.headers["origin"] || event.headers["Origin"];
  const responseHeaders = getResponseHeaders(
    pathParams.endpointType,
    origin,
    allowedOrigins
  );

  try {
    // Handle OPTIONS preflight request
    if (event.requestContext.http.method === "OPTIONS") {
      return {
        statusCode: 200,
        headers: responseHeaders,
        body: "",
      };
    }

    // Authenticate request based on endpoint type
    const authResult = await authenticateRequest(
      pathParams.endpointType,
      event,
      pathParams.workspaceId,
      pathParams.agentId,
      pathParams.secret
    );

    // Build request context
    const streamContext = await buildRequestContext(
      event,
      pathParams,
      authResult
    );

    // Buffer stream chunks
    const chunks: Uint8Array[] = [];
    let fullStreamedText = "";
    let llmCallAttempted = false;
    let streamResult: Awaited<ReturnType<typeof streamText>> | undefined;

    // Create a mock response stream that collects chunks
    const mockStream: HttpResponseStream = {
      write: (
        chunk: string | Uint8Array,
        callback?: (error?: Error) => void
      ) => {
        const bytes =
          typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
        chunks.push(bytes);
        if (typeof chunk === "string") {
          fullStreamedText += chunk;
        }
        if (callback) {
          callback();
        }
      },
      end: (callback?: (error?: Error) => void) => {
        if (callback) {
          callback();
        }
      },
    };

    let generationStartTime: number | undefined;
    let generationTimeMs: number | undefined;

    try {
      console.log("[Stream Handler] Starting AI stream (API Gateway)...");
      generationStartTime = Date.now();
      streamResult = await streamAIResponse(
        streamContext.agent,
        streamContext.model,
        streamContext.modelMessages,
        streamContext.tools,
        mockStream,
        (textDelta) => {
          fullStreamedText += textDelta;
        }
      );
      if (generationStartTime !== undefined) {
        generationTimeMs = Date.now() - generationStartTime;
      }
      llmCallAttempted = true;
      console.log("[Stream Handler] AI stream completed (API Gateway)");
    } catch (error) {
      logErrorDetails(error, {
        workspaceId: streamContext.workspaceId,
        agentId: streamContext.agentId,
        usesByok: streamContext.usesByok,
        endpoint: pathParams.endpointType,
      });

      const errorToLog = normalizeByokError(error);

      if (isByokAuthenticationError(error, streamContext.usesByok)) {
        await persistConversationError(streamContext, errorToLog);
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            error:
              "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions.",
          }),
        };
      }

      const creditErrorResult = await handleCreditErrors(
        error,
        streamContext.workspaceId,
        pathParams.endpointType
      );
      if (creditErrorResult.handled && creditErrorResult.response) {
        await persistConversationError(streamContext, error);
        const response = creditErrorResult.response;
        if (
          typeof response === "object" &&
          response !== null &&
          "body" in response
        ) {
          return {
            statusCode: (response as { statusCode?: number }).statusCode || 400,
            headers: responseHeaders,
            body: (response as { body: string }).body,
          };
        }
      }

      if (
        streamContext.reservationId &&
        streamContext.reservationId !== "byok"
      ) {
        const lambdaContext = getContextFromRequestId(
          streamContext.awsRequestId
        );
        if (lambdaContext) {
          await cleanupReservationOnError(
            streamContext.db,
            streamContext.reservationId,
            streamContext.workspaceId,
            streamContext.agentId,
            "openrouter",
            streamContext.finalModelName,
            error,
            llmCallAttempted,
            streamContext.usesByok,
            pathParams.endpointType,
            lambdaContext
          );
        }
      }

      throw error;
    }

    if (!streamResult) {
      throw new Error("LLM call succeeded but result is undefined");
    }

    // Extract text and usage
    let responseText: string;
    let usage: unknown;

    try {
      [responseText, usage] = await Promise.all([
        Promise.resolve(streamResult.text).then((t) => t || ""),
        Promise.resolve(streamResult.usage),
      ]);
    } catch (resultError) {
      if (isByokAuthenticationError(resultError, streamContext.usesByok)) {
        const errorToLog = normalizeByokError(resultError);
        await persistConversationError(streamContext, errorToLog);
        return {
          statusCode: 400,
          headers: responseHeaders,
          body: JSON.stringify({
            error:
              "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions.",
          }),
        };
      }
      await persistConversationError(streamContext, resultError);
      throw resultError;
    }

    const finalResponseText = responseText || fullStreamedText;

    // Extract token usage
    const totalUsage = await streamResult.totalUsage;
    const { tokenUsage } = extractTokenUsageAndCosts(
      { totalUsage } as unknown as StreamTextResultWithResolvedUsage,
      usage,
      streamContext.finalModelName,
      pathParams.endpointType
    );

    // Post-processing
    try {
      await adjustCreditsAfterStream(
        streamContext.db,
        streamContext.workspaceId,
        streamContext.agentId,
        streamContext.reservationId,
        streamContext.finalModelName,
        tokenUsage,
        streamContext.usesByok,
        streamResult,
        streamContext.conversationId,
        streamContext.awsRequestId,
        pathParams.endpointType
      );
    } catch (error) {
      console.error(
        "[Stream Handler] Error adjusting credit reservation after stream:",
        {
          error: error instanceof Error ? error.message : String(error),
          workspaceId: streamContext.workspaceId,
          agentId: streamContext.agentId,
        }
      );
      Sentry.captureException(ensureError(error), {
        tags: {
          endpoint: pathParams.endpointType,
          operation: "credit_adjustment",
        },
      });
    }

    await trackRequestUsage(
      streamContext.subscriptionId,
      streamContext.workspaceId,
      streamContext.agentId,
      pathParams.endpointType
    );

    await logConversation(
      streamContext.db,
      streamContext.workspaceId,
      streamContext.agentId,
      streamContext.conversationId,
      streamContext.convertedMessages,
      finalResponseText,
      tokenUsage,
      streamContext.usesByok,
      streamContext.finalModelName,
      streamResult,
      streamContext.awsRequestId,
      generationTimeMs,
      pathParams.endpointType
    );

    // Combine chunks and return as complete response
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    const body = new TextDecoder().decode(combined);

    return {
      statusCode: 200,
      headers: responseHeaders,
      body,
    };
  } catch (error) {
    const boomed = boomify(error as Error);
    console.error("[Stream Handler] Unhandled error (API Gateway):", boomed);
    if (boomed.isServer) {
      Sentry.captureException(ensureError(error), {
        tags: {
          handler: "Stream Handler (API Gateway)",
          statusCode: boomed.output.statusCode,
        },
      });
    }

    return {
      statusCode: boomed.output.statusCode,
      headers: responseHeaders,
      body: JSON.stringify({
        error: boomed.message,
      }),
    };
  } finally {
    // Clean up context
    if (awsRequestId) {
      clearCurrentHTTPContext(awsRequestId);
    }

    await Promise.all([flushPostHog(), flushSentry()]).catch((flushErrors) => {
      console.error("[PostHog/Sentry] Error flushing events:", flushErrors);
    });
  }
}

/**
 * Dual handler wrapper that supports both Lambda Function URL and API Gateway
 */
const createHandler = () => {
  // Detect if awslambda is available (Lambda Function URL)
  if (isLambdaFunctionUrlInvocation()) {
    // Lambda Function URL: Use streaming wrapper
    return getDefined(awslambda, "awslambda is not defined").streamifyResponse(
      internalHandler
    );
  } else {
    // API Gateway: Use standard handler with buffering
    return adaptHttpHandler(handleApiGatewayStreaming);
  }
};

/**
 * Streaming Lambda handler for agent interactions
 * Supports both Lambda Function URL (true streaming) and API Gateway (buffered)
 */
export const handler = createHandler();
