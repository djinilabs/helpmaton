// Streaming Lambda handler for test agent endpoint
// Uses awslambda.streamifyResponse for Lambda Function URLs with RESPONSE_STREAM mode
// Includes mock implementation for local sandbox development

import {
  badRequest,
  boomify,
  forbidden,
  notAcceptable,
  unauthorized,
} from "@hapi/boom";
import type { ModelMessage } from "ai";
import { convertToModelMessages, streamText } from "ai";
import type { Context } from "aws-lambda";

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

import { database } from "../../tables";
import { isUserAuthorized } from "../../tables/permissions";
import { PERMISSION_LEVELS } from "../../tables/schema";
import {
  updateConversation,
  buildConversationErrorInfo,
  type GenerateTextResultWithTotalUsage,
  type StreamTextResultWithResolvedUsage,
} from "../../utils/conversationLogger";
import { isAuthenticationError } from "../../utils/handlingErrors";
import {
  transformLambdaUrlToHttpV2Event,
  type LambdaUrlEvent,
} from "../../utils/httpEventAdapter";
import { flushPostHog } from "../../utils/posthog";
import {
  Sentry,
  initSentry,
  flushSentry,
  ensureError,
} from "../../utils/sentry";
import { verifyAccessToken } from "../../utils/tokenUtils";
import {
  getContextFromRequestId,
  augmentContextWithCreditTransactions,
  setCurrentHTTPContext,
  clearCurrentHTTPContext,
} from "../../utils/workspaceCreditContext";
import { setupAgentAndTools } from "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/agentSetup";
import { convertAiSdkUIMessagesToUIMessages } from "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/messageConversion";
import {
  formatToolCallMessage,
  formatToolResultMessage,
} from "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/toolFormatting";
import type { UIMessage } from "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/types";
import { MODEL_NAME } from "../utils/agentUtils";
import {
  adjustCreditsAfterLLMCall,
  cleanupReservationOnError,
  cleanupReservationWithoutTokenUsage,
  enqueueCostVerificationIfNeeded,
  validateAndReserveCredits,
} from "../utils/generationCreditManagement";
import {
  isByokAuthenticationError,
  normalizeByokError,
  logErrorDetails,
  handleCreditErrors,
} from "../utils/generationErrorHandling";
import { prepareLLMCall } from "../utils/generationLLMSetup";
import {
  validateSubscriptionAndLimits,
  trackSuccessfulRequest,
} from "../utils/generationRequestTracking";
import { extractTokenUsageAndCosts } from "../utils/generationTokenExtraction";
import { userRef } from "../utils/session";

import { getDefined } from "@/utils";

// Initialize Sentry when this module is loaded (before any handlers are called)
initSentry();

/**
 * Path parameters extracted from the request
 */
interface PathParameters {
  workspaceId: string;
  agentId: string;
}

/**
 * Request context for processing the stream
 */
interface TestAgentRequestContext {
  workspaceId: string;
  agentId: string;
  conversationId: string;
  userId: string;
  subscriptionId: string | undefined;
  db: Awaited<ReturnType<typeof database>>;
  convertedMessages: UIMessage[];
  modelMessages: ModelMessage[];
  agent: Awaited<ReturnType<typeof setupAgentAndTools>>["agent"];
  model: Awaited<ReturnType<typeof setupAgentAndTools>>["model"];
  tools: Awaited<ReturnType<typeof setupAgentAndTools>>["tools"];
  usesByok: boolean;
  reservationId: string | undefined;
  finalModelName: string;
  awsRequestId?: string;
}

const DEFAULT_CONTENT_TYPE = "text/event-stream; charset=utf-8";

/**
 * Get CORS headers using FRONTEND_URL
 */
function getResponseHeaders(origin?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": DEFAULT_CONTENT_TYPE,
  };

  const frontendUrl = process.env.FRONTEND_URL;

  // Always set Access-Control-Allow-Origin to FRONTEND_URL
  if (frontendUrl) {
    headers["Access-Control-Allow-Origin"] = frontendUrl;
  } else {
    // Fallback to origin if FRONTEND_URL not set
    headers["Access-Control-Allow-Origin"] = origin || "*";
  }

  headers["Access-Control-Allow-Methods"] =
    "GET, POST, PUT, DELETE, PATCH, OPTIONS";
  headers["Access-Control-Allow-Headers"] =
    "Content-Type, Authorization, X-Requested-With, Origin, Accept, X-Conversation-Id";

  return headers;
}

/**
 * Extracts path parameters from the Lambda URL event
 */
function extractPathParameters(event: LambdaUrlEvent): PathParameters | null {
  const httpV2Event = transformLambdaUrlToHttpV2Event(event);

  let workspaceId = httpV2Event.pathParameters?.workspaceId;
  let agentId = httpV2Event.pathParameters?.agentId;

  // Fallback: extract from rawPath if pathParameters not populated
  if (!workspaceId || !agentId) {
    // Normalize path by removing leading slashes and handling double slashes
    const normalizedPath = (event.rawPath || "").replace(/^\/+/, "/");
    // Match: /api/workspaces/{workspaceId}/agents/{agentId}/test
    const pathMatch = normalizedPath.match(
      /^\/api\/workspaces\/([^/]+)\/agents\/([^/]+)\/test$/
    );
    if (pathMatch) {
      workspaceId = pathMatch[1];
      agentId = pathMatch[2];
    } else {
      // Log for debugging
      console.log("[Test Agent Handler] Path extraction failed:", {
        rawPath: event.rawPath,
        normalizedPath,
        pathParameters: httpV2Event.pathParameters,
      });
    }
  }

  if (!workspaceId || !agentId) {
    return null;
  }

  return { workspaceId, agentId };
}

/**
 * Extracts Bearer token from Lambda URL event headers
 */
function extractBearerToken(event: LambdaUrlEvent): string | null {
  const authHeader =
    event.headers["authorization"] ||
    event.headers["Authorization"] ||
    event.headers["AUTHORIZATION"];

  if (!authHeader || typeof authHeader !== "string") {
    return null;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  return match[1];
}

/**
 * Authenticates the request by verifying the Bearer token
 */
async function authenticateRequest(
  event: LambdaUrlEvent
): Promise<{ userId: string; email: string }> {
  const bearerToken = extractBearerToken(event);
  if (!bearerToken) {
    throw unauthorized("Bearer token required");
  }

  // Verify JWT access token (throws unauthorized if invalid)
  const tokenPayload = await verifyAccessToken(bearerToken);

  return {
    userId: tokenPayload.userId,
    email: tokenPayload.email,
  };
}

/**
 * Authorizes the request by checking workspace permissions
 */
async function authorizeRequest(
  userId: string,
  workspaceId: string,
  minimumLevel: number
): Promise<void> {
  const userRefValue = userRef(userId);
  const resource = `workspaces/${workspaceId}`;

  const [authorized] = await isUserAuthorized(
    userRefValue,
    resource,
    minimumLevel
  );

  if (!authorized) {
    throw forbidden(
      `Insufficient permissions. Required level: ${minimumLevel}`
    );
  }
}

/**
 * Extracts and decodes the request body
 */
function extractRequestBody(event: LambdaUrlEvent): string {
  if (!event.body) {
    return "";
  }

  const decodedBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString()
    : event.body;

  return decodedBody.trim();
}

/**
 * Writes a chunk to the response stream
 * Returns a Promise that resolves when the chunk is written
 */
function writeChunkToStream(
  responseStream: HttpResponseStream,
  chunk: string | Uint8Array
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    responseStream.write(chunk, (error) => {
      if (error) {
        console.error("[Test Agent Handler] Error writing chunk:", {
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
 * Writes an error response to the stream in SSE format
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

  console.log("[Test Agent Handler] Writing error response:", {
    errorMessage,
    errorChunk,
    errorChunkLength: errorChunk.length,
  });

  try {
    await writeChunkToStream(responseStream, errorChunk);
    try {
      responseStream.end();
      console.log(
        "[Test Agent Handler] Error response written and stream ended"
      );
    } catch (endError) {
      console.warn(
        "[Test Agent Handler] Stream already ended when trying to end after error:",
        {
          error:
            endError instanceof Error ? endError.message : String(endError),
          originalError: errorMessage,
        }
      );
    }
  } catch (writeError) {
    console.error(
      "[Test Agent Handler] Error writing error response (stream may already be ended):",
      {
        writeError:
          writeError instanceof Error ? writeError.message : String(writeError),
        writeErrorType: writeError?.constructor?.name,
        originalError: errorMessage,
      }
    );
    try {
      responseStream.end();
    } catch (endError) {
      console.warn(
        "[Test Agent Handler] Stream already ended when trying to end after write failure:",
        {
          endError:
            endError instanceof Error ? endError.message : String(endError),
          originalError: errorMessage,
        }
      );
    }
  }
}

async function persistConversationError(
  context: TestAgentRequestContext | undefined,
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
      console.log("[Test Agent Handler] BYOK error before extraction:", {
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
      endpoint: "test",
      metadata: {
        usesByok: context.usesByok,
      },
    });

    // Log extracted error info (especially for BYOK)
    if (context.usesByok) {
      console.log("[Test Agent Handler] BYOK error after extraction:", {
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
      "test"
    );
  } catch (logError) {
    console.error(
      "[Test Agent Handler] Failed to persist conversation error:",
      {
        originalError: error instanceof Error ? error.message : String(error),
        logError:
          logError instanceof Error ? logError.message : String(logError),
        workspaceId: context.workspaceId,
        agentId: context.agentId,
        conversationId: context.conversationId,
      }
    );
  }
}

/**
 * Streams the AI response to the client using toUIMessageStreamResponse() format
 */
async function streamAIResponse(
  agent: Awaited<ReturnType<typeof setupAgentAndTools>>["agent"],
  model: Awaited<ReturnType<typeof setupAgentAndTools>>["model"],
  modelMessages: ModelMessage[],
  tools: Awaited<ReturnType<typeof setupAgentAndTools>>["tools"],
  responseStream: HttpResponseStream,
  onTextChunk: (text: string) => void,
  usesByok: boolean
): Promise<Awaited<ReturnType<typeof streamText>>> {
  // Prepare LLM call (logging and generate options)
  const generateOptions = prepareLLMCall(
    agent,
    tools,
    modelMessages,
    "test",
    "test",
    "test"
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
  let streamResponse: Response;
  try {
    streamResponse = streamResult.toUIMessageStreamResponse();
  } catch (streamError) {
    // Check if this is a BYOK authentication error
    if (usesByok && isAuthenticationError(streamError)) {
      console.log(
        "[Test Agent Handler] BYOK authentication error detected when getting stream response:",
        {
          error:
            streamError instanceof Error
              ? streamError.message
              : String(streamError),
          errorType:
            streamError instanceof Error
              ? streamError.constructor.name
              : typeof streamError,
        }
      );
      throw streamError;
    }
    throw streamError;
  }

  // Read from the stream and write chunks to responseStream immediately as they arrive
  const reader = streamResponse.body?.getReader();
  if (!reader) {
    throw new Error("Stream response body is null");
  }

  const decoder = new TextDecoder();
  let textBuffer = ""; // Buffer for extracting text deltas (for logging/tracking only)
  let streamBuffer = ""; // Buffer for checking error messages in stream (for BYOK)
  let streamCompletedSuccessfully = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        // Write the raw chunk immediately to responseStream for true streaming
        await writeChunkToStream(responseStream, value);

        // Also decode for text extraction (for tracking purposes only)
        const chunk = decoder.decode(value, { stream: true });
        textBuffer += chunk;
        streamBuffer += chunk;

        // Check for error messages in the stream (for BYOK errors)
        if (usesByok) {
          // Check if we have a complete line with an error
          if (streamBuffer.includes("\n")) {
            const lines = streamBuffer.split("\n");
            streamBuffer = lines.pop() || ""; // Keep incomplete line

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const jsonStr = line.substring(6);
                  const parsed = JSON.parse(jsonStr);
                  // Check for error messages in the stream
                  if (parsed.type === "error" || parsed.error) {
                    const errorMessage = parsed.error || parsed.message;
                    if (errorMessage && typeof errorMessage === "string") {
                      // Check if it's an authentication error
                      if (
                        errorMessage.toLowerCase().includes("api key") ||
                        errorMessage.toLowerCase().includes("authentication") ||
                        errorMessage.toLowerCase().includes("unauthorized") ||
                        errorMessage.toLowerCase().includes("cookie auth")
                      ) {
                        console.log(
                          "[Test Agent Handler] Found authentication error in stream body:",
                          errorMessage
                        );
                        // This will be handled by the outer error handler
                        // We'll throw an error that will be caught and processed
                        const streamError = new Error(errorMessage);
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (streamError as any).data = {
                          error: {
                            message: errorMessage,
                            code: parsed.code || 401,
                          },
                        };
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (streamError as any).statusCode = parsed.code || 401;
                        throw streamError;
                      }
                    }
                  }
                } catch (parseError) {
                  // Not JSON or parsing failed, continue
                  // But if it's an authentication error we threw, re-throw it
                  if (
                    parseError instanceof Error &&
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (parseError as any).statusCode
                  ) {
                    throw parseError;
                  }
                }
              }
            }
          }
        }

        // Try to extract text deltas from complete lines for tracking
        if (chunk.includes("\n")) {
          const lines = textBuffer.split("\n");
          textBuffer = lines.pop() || ""; // Keep incomplete line

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const jsonStr = line.substring(6);
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

    streamCompletedSuccessfully = true;
    console.log("[Test Agent Handler] All chunks written, ending stream");
    responseStream.end();
  } catch (streamError) {
    reader.releaseLock();
    throw streamError;
  } finally {
    reader.releaseLock();
    if (streamCompletedSuccessfully) {
      try {
        responseStream.end();
      } catch (endError) {
        console.warn(
          "[Test Agent Handler] Stream already ended (expected in normal flow):",
          {
            error:
              endError instanceof Error ? endError.message : String(endError),
          }
        );
      }
    }
  }

  return streamResult;
}

/**
 * Builds the complete request context for processing the request
 */
async function buildRequestContext(
  event: LambdaUrlEvent,
  pathParams: PathParameters,
  userId: string
): Promise<TestAgentRequestContext> {
  const { workspaceId, agentId } = pathParams;

  // Read and validate X-Conversation-Id header
  const conversationId =
    event.headers["x-conversation-id"] || event.headers["X-Conversation-Id"];
  if (!conversationId || typeof conversationId !== "string") {
    throw badRequest("X-Conversation-Id header is required");
  }

  // Validate subscription and limits
  const subscriptionId = await validateSubscriptionAndLimits(
    workspaceId,
    "test"
  );

  // Setup database connection
  const db = await database();

  // Get context for workspace credit transactions
  const awsRequestId = event.requestContext?.requestId;
  const lambdaContext = getContextFromRequestId(awsRequestId);
  if (!lambdaContext) {
    throw new Error("Context not available for workspace credit transactions");
  }

  // Extract and convert request body
  const bodyText = extractRequestBody(event);
  if (!bodyText) {
    throw badRequest("Request body is required");
  }

  let messages: UIMessage[] | null = null;
  try {
    const parsed = JSON.parse(bodyText);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const firstMessage = parsed[0];
      if (
        typeof firstMessage === "object" &&
        firstMessage !== null &&
        "role" in firstMessage &&
        "content" in firstMessage
      ) {
        messages = parsed as UIMessage[];
      }
    } else if (
      typeof parsed === "object" &&
      parsed !== null &&
      "messages" in parsed &&
      Array.isArray(parsed.messages) &&
      parsed.messages.length > 0
    ) {
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
    throw badRequest("Invalid JSON in request body");
  }

  if (!messages || messages.length === 0) {
    throw badRequest("messages array is required and must not be empty");
  }

  // Check if messages are in ai-sdk format (have 'parts' property)
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

  // Convert messages to ModelMessage format
  let modelMessages: ModelMessage[];
  try {
    if (isAiSdkFormat) {
      modelMessages = convertToModelMessages(
        messages as unknown as Array<Omit<import("ai").UIMessage, "id">>
      );
    } else {
      // Use local converter for our format
      const { convertUIMessagesToModelMessages } = await import(
        "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/messageConversion"
      );
      modelMessages = convertUIMessagesToModelMessages(convertedMessages);
    }
  } catch (error) {
    console.error("[Test Agent Handler] Error converting messages:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }

  // Setup agent, model, and tools
  const { agent, model, tools, usesByok } = await setupAgentAndTools(
    workspaceId,
    agentId,
    messages,
    {
      callDepth: 0,
      maxDelegationDepth: 3,
      userId,
      context: lambdaContext,
      conversationId,
    }
  );

  // Derive the model name from the agent's modelName if set, otherwise use default
  const finalModelName =
    typeof agent.modelName === "string" ? agent.modelName : MODEL_NAME;

  // Validate credits, spending limits, and reserve credits before LLM call
  const reservationId = await validateAndReserveCredits(
    db,
    workspaceId,
    agentId,
    "openrouter",
    finalModelName,
    modelMessages,
    agent.systemPrompt,
    tools,
    usesByok,
    "test",
    lambdaContext,
    conversationId
  );

  return {
    workspaceId,
    agentId,
    conversationId,
    userId,
    subscriptionId,
    db,
    convertedMessages,
    modelMessages,
    agent,
    model,
    tools,
    usesByok,
    reservationId,
    finalModelName,
    awsRequestId,
  };
}

/**
 * Creates a mock awslambda implementation for local sandbox development
 * Buffers all chunks and returns complete response at end
 */
function createMockAwslambda(): {
  streamifyResponse: <TEvent, TStream extends HttpResponseStream>(
    handler: (event: TEvent, responseStream: TStream) => Promise<void>
  ) => (
    event: TEvent,
    responseStream: TStream
  ) => Promise<{
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  }>;
  HttpResponseStream: {
    from(
      underlyingStream: unknown,
      metadata: Record<string, unknown>
    ): HttpResponseStream;
  };
} {
  // Mock HttpResponseStream that buffers chunks
  class MockHttpResponseStream implements HttpResponseStream {
    private chunks: (string | Uint8Array)[] = [];
    private metadata: Record<string, unknown>;
    private ended = false;

    constructor(metadata: Record<string, unknown>) {
      this.metadata = metadata;
    }

    write(
      chunk: string | Uint8Array,
      callback?: (error?: Error) => void
    ): void {
      if (this.ended) {
        if (callback) {
          callback(new Error("Stream already ended"));
        }
        return;
      }
      this.chunks.push(chunk);
      if (callback) {
        callback();
      }
    }

    end(callback?: (error?: Error) => void): void {
      this.ended = true;
      if (callback) {
        callback();
      }
    }

    getBody(): string {
      // Concatenate all chunks into a single string
      const bodyParts: string[] = [];
      for (const chunk of this.chunks) {
        if (typeof chunk === "string") {
          bodyParts.push(chunk);
        } else {
          bodyParts.push(new TextDecoder().decode(chunk));
        }
      }
      return bodyParts.join("");
    }

    getHeaders(): Record<string, string> {
      return (this.metadata.headers as Record<string, string>) || {};
    }

    getStatusCode(): number {
      return (this.metadata.statusCode as number) || 200;
    }
  }

  // Create a mutable object to track the mock stream instance
  const streamTracker: { instance: MockHttpResponseStream | undefined } = {
    instance: undefined,
  };

  const mockHttpResponseStream = {
    from(
      underlyingStream: unknown,
      metadata: Record<string, unknown>
    ): HttpResponseStream {
      const instance = new MockHttpResponseStream(metadata);
      streamTracker.instance = instance;
      return instance;
    },
  };

  return {
    streamifyResponse: <TEvent, TStream extends HttpResponseStream>(
      handler: (event: TEvent, responseStream: TStream) => Promise<void>
    ) => {
      return async (
        event: TEvent,
        responseStream: TStream
      ): Promise<{
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      }> => {
        // Reset the tracked instance for this request
        streamTracker.instance = undefined;

        // Call the handler - it will call HttpResponseStream.from() which creates our mock stream
        await handler(event, responseStream as TStream);

        // Get the buffered body and metadata from the tracked instance
        if (!streamTracker.instance) {
          throw new Error(
            "Mock stream instance was not created - HttpResponseStream.from() was not called"
          );
        }

        // TypeScript needs explicit type assertion here because of closure inference
        const mockInstance: MockHttpResponseStream = streamTracker.instance;
        const body = mockInstance.getBody();
        const headers = mockInstance.getHeaders();
        const statusCode = mockInstance.getStatusCode();

        return {
          statusCode,
          headers,
          body,
        };
      };
    },
    HttpResponseStream: mockHttpResponseStream,
  };
}

/**
 * Internal handler function that processes the request
 * This is wrapped by awslambda.streamifyResponse for streaming support
 * @param awslambdaInstance - The awslambda instance to use (mock or real)
 */
const createInternalHandler =
  (awslambdaInstance: typeof awslambda) =>
  async (
    event: LambdaUrlEvent,
    responseStream: HttpResponseStream
  ): Promise<void> => {
    const pathParams = extractPathParameters(event);
    if (!pathParams) {
      throw notAcceptable("Invalid path parameters");
    }

    let context: TestAgentRequestContext | undefined;

    // Extract requestId from event for context setup
    const awsRequestId = event.requestContext?.requestId;

    // Create synthetic Lambda context for workspace credit transactions
    if (awsRequestId) {
      const syntheticContext: Context = {
        callbackWaitsForEmptyEventLoop: false,
        awsRequestId,
        functionName:
          process.env.AWS_LAMBDA_FUNCTION_NAME || "test-agent-handler",
        functionVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION || "$LATEST",
        invokedFunctionArn: process.env.AWS_LAMBDA_FUNCTION_ARN || "",
        memoryLimitInMB: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE || "512",
        getRemainingTimeInMillis: () => {
          return 300000; // 5 minutes default
        },
        logGroupName: process.env.AWS_LAMBDA_LOG_GROUP_NAME || "",
        logStreamName: process.env.AWS_LAMBDA_LOG_STREAM_NAME || "",
        done: () => {},
        fail: () => {},
        succeed: () => {},
      };

      const augmentedContext =
        augmentContextWithCreditTransactions(syntheticContext);

      setCurrentHTTPContext(awsRequestId, augmentedContext);
    }

    // Build CORS headers
    const origin = event.headers["origin"] || event.headers["Origin"];
    const responseHeaders = getResponseHeaders(origin);

    // Set up response stream with headers
    // Use the provided awslambda instance (mock or real)
    responseStream = getDefined(
      awslambdaInstance,
      "awslambda instance is not defined"
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

      // Authenticate request
      const { userId } = await authenticateRequest(event);

      // Authorize request (check workspace permissions)
      await authorizeRequest(
        userId,
        pathParams.workspaceId,
        PERMISSION_LEVELS.READ
      );

      console.log("[Test Agent Handler] Building request context...");
      context = await buildRequestContext(event, pathParams, userId);
      console.log("[Test Agent Handler] Request context built successfully");

      // Stream the AI response
      let fullStreamedText = "";
      let llmCallAttempted = false;
      let streamResult: Awaited<ReturnType<typeof streamText>> | undefined;

      let generationStartTime: number | undefined;
      let generationTimeMs: number | undefined;
      try {
        console.log("[Test Agent Handler] Starting AI stream...");
        generationStartTime = Date.now();
        streamResult = await streamAIResponse(
          context.agent,
          context.model,
          context.modelMessages,
          context.tools,
          responseStream,
          (textDelta) => {
            fullStreamedText += textDelta;
          },
          context.usesByok
        );
        if (generationStartTime !== undefined) {
          generationTimeMs = Date.now() - generationStartTime;
        }
        llmCallAttempted = true;
        console.log("[Test Agent Handler] AI stream completed");
      } catch (error) {
        // Comprehensive error logging for debugging
        logErrorDetails(error, {
          workspaceId: context.workspaceId,
          agentId: context.agentId,
          usesByok: context.usesByok,
          endpoint: "test",
        });

        const errorToLog = normalizeByokError(error);

        // Check if this is a BYOK authentication error FIRST
        if (isByokAuthenticationError(error, context.usesByok)) {
          await persistConversationError(context, errorToLog);
          await writeErrorResponse(
            responseStream,
            new Error(
              "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions."
            )
          );
          return;
        }

        // Handle credit errors
        const creditErrorResult = await handleCreditErrors(
          error,
          context.workspaceId,
          "test"
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
            await writeErrorResponse(responseStream, new Error(body.error));
            return;
          }
        }

        // Error after reservation but before or during LLM call
        if (context.reservationId && context.reservationId !== "byok") {
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
              "test",
              lambdaContext
            );
          }
        }

        await persistConversationError(context, errorToLog);
        throw error;
      }

      // If we get here, the LLM call succeeded
      if (!streamResult) {
        throw new Error("LLM call succeeded but result is undefined");
      }

      // Track successful LLM request
      await trackSuccessfulRequest(
        context.subscriptionId,
        context.workspaceId,
        context.agentId,
        "test"
      );

      // Extract text, tool calls, tool results, and usage from streamText result
      let responseText: string;
      let toolCallsFromResult: unknown[];
      let toolResultsFromResult: unknown[];
      let usage: unknown;

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resultAny = streamResult as any;
        const results = await Promise.allSettled([
          Promise.resolve(streamResult.text).then((t) => t || ""),
          Promise.resolve(streamResult.toolCalls).then((tc) => tc || []),
          Promise.resolve(streamResult.toolResults).then((tr) => tr || []),
          Promise.resolve(streamResult.usage),
          Promise.resolve(resultAny._steps?.status?.value).then((s) => s || []),
        ]);

        const rejected = results.find((r) => r.status === "rejected");
        if (rejected && rejected.status === "rejected") {
          throw rejected.reason;
        }

        responseText =
          results[0].status === "fulfilled" ? results[0].value : "";
        const toolCallsFromResultRaw =
          results[1].status === "fulfilled" ? results[1].value : [];
        const toolResultsFromResultRaw =
          results[2].status === "fulfilled" ? results[2].value : [];
        usage =
          results[3].status === "fulfilled" ? results[3].value : undefined;
        const stepsValue =
          results[4].status === "fulfilled" ? results[4].value : [];

        // Extract tool calls and results from _steps
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
                    toolCallsFromSteps.push({
                      toolCallId: contentItem.toolCallId,
                      toolName: contentItem.toolName,
                      args: contentItem.input || contentItem.args || {},
                    });
                  } else if (contentItem.type === "tool-result") {
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

        if (toolCallsFromSteps.length > 0) {
          toolCallsFromResult = toolCallsFromSteps;
        } else {
          toolCallsFromResult = Array.isArray(toolCallsFromResultRaw)
            ? toolCallsFromResultRaw
            : [];
        }

        if (toolResultsFromSteps.length > 0) {
          toolResultsFromResult = toolResultsFromSteps;
        } else {
          toolResultsFromResult = Array.isArray(toolResultsFromResultRaw)
            ? toolResultsFromResultRaw
            : [];
        }

        // If tool calls are missing but tool results exist, reconstruct tool calls from results
        if (
          toolCallsFromResult.length === 0 &&
          toolResultsFromResult.length > 0
        ) {
          console.log(
            "[Test Agent Handler] Tool calls missing but tool results exist, reconstructing tool calls from results"
          );
          const { reconstructToolCallsFromResults } = await import(
            "../utils/generationToolReconstruction"
          );
          toolCallsFromResult = reconstructToolCallsFromResults(
            toolResultsFromResult,
            "Test Agent Handler"
          ) as unknown as typeof toolCallsFromResult;
        }

        // Check if result object has error information before accessing properties (for BYOK)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resultAnyForErrorCheck = streamResult as any;
        if (context.usesByok && resultAnyForErrorCheck) {
          // Check _steps array for errors (AI SDK stores errors in steps)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let foundError: any = undefined;
          if (Array.isArray(resultAnyForErrorCheck._steps)) {
            for (const step of resultAnyForErrorCheck._steps) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const stepAny = step as any;
              if (stepAny?.error && isAuthenticationError(stepAny.error)) {
                foundError = stepAny.error;
                break;
              }
            }
          }

          // Also check direct error property
          if (
            !foundError &&
            resultAnyForErrorCheck.error &&
            isAuthenticationError(resultAnyForErrorCheck.error)
          ) {
            foundError = resultAnyForErrorCheck.error;
          }

          // Check baseStream for errors
          if (!foundError && resultAnyForErrorCheck.baseStream) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const baseStreamAny = resultAnyForErrorCheck.baseStream as any;
            if (
              baseStreamAny?.error &&
              isAuthenticationError(baseStreamAny.error)
            ) {
              foundError = baseStreamAny.error;
            }
          }

          // Check output for errors
          if (!foundError && resultAnyForErrorCheck.output) {
            type OutputWithError = {
              error?: Error;
              [key: string]: unknown;
            };
            const outputAny = resultAnyForErrorCheck.output as OutputWithError;
            if (outputAny?.error && isAuthenticationError(outputAny.error)) {
              foundError = outputAny.error;
            }
          }

          // If we find an error in the result object or its steps, use it
          if (foundError) {
            console.log(
              "[Test Agent Handler] Found authentication error in result object/steps, logging it"
            );
            await persistConversationError(context, foundError);
            await writeErrorResponse(
              responseStream,
              new Error(
                "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions."
              )
            );
            return;
          }
        }
      } catch (resultError) {
        // Check if this is a BYOK authentication error
        if (isByokAuthenticationError(resultError, context.usesByok)) {
          const errorToLog = normalizeByokError(resultError);
          await persistConversationError(context, errorToLog);
          await writeErrorResponse(
            responseStream,
            new Error(
              "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions."
            )
          );
          return;
        }
        await persistConversationError(context, resultError);
        throw resultError;
      }

      // Extract token usage, generation IDs, and costs
      const {
        tokenUsage,
        openrouterGenerationId,
        openrouterGenerationIds,
        provisionalCostUsd,
      } = extractTokenUsageAndCosts(
        streamResult as unknown as
          | GenerateTextResultWithTotalUsage
          | StreamTextResultWithResolvedUsage,
        usage,
        context.finalModelName,
        "test"
      );

      // Adjust credit reservation based on actual cost
      await adjustCreditsAfterLLMCall(
        context.db,
        context.workspaceId,
        context.agentId,
        context.reservationId,
        "openrouter",
        context.finalModelName,
        tokenUsage,
        context.usesByok,
        openrouterGenerationId,
        openrouterGenerationIds,
        "test",
        getContextFromRequestId(context.awsRequestId)!,
        context.conversationId
      );

      // Handle case where no token usage is available
      if (
        context.reservationId &&
        context.reservationId !== "byok" &&
        (!tokenUsage ||
          (tokenUsage.promptTokens === 0 && tokenUsage.completionTokens === 0))
      ) {
        await cleanupReservationWithoutTokenUsage(
          context.db,
          context.reservationId,
          context.workspaceId,
          context.agentId,
          "test"
        );
      }

      // Format tool calls and results as UI messages
      const toolCallMessages = toolCallsFromResult.map(formatToolCallMessage);
      const toolResultMessages = toolResultsFromResult.map(
        formatToolResultMessage
      );

      // Build assistant response message
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

      for (const toolCallMsg of toolCallMessages) {
        if (Array.isArray(toolCallMsg.content)) {
          assistantContent.push(...toolCallMsg.content);
        }
      }

      for (const toolResultMsg of toolResultMessages) {
        if (Array.isArray(toolResultMsg.content)) {
          assistantContent.push(...toolResultMsg.content);
        }
      }

      if (responseText && responseText.trim().length > 0) {
        assistantContent.push({ type: "text", text: responseText });
      }

      const assistantMessage: UIMessage = {
        role: "assistant",
        content: assistantContent.length > 0 ? assistantContent : responseText,
        ...(tokenUsage && { tokenUsage }),
        modelName: context.finalModelName,
        provider: "openrouter",
        ...(openrouterGenerationId && { openrouterGenerationId }),
        ...(provisionalCostUsd !== undefined && { provisionalCostUsd }),
        ...(generationTimeMs !== undefined && { generationTimeMs }),
      };

      // Combine messages for logging
      const messagesForLogging: UIMessage[] = [
        ...context.convertedMessages,
        assistantMessage,
      ];

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

      // Log conversation (non-blocking)
      try {
        await updateConversation(
          context.db,
          context.workspaceId,
          context.agentId,
          context.conversationId,
          validMessages,
          tokenUsage,
          context.usesByok,
          undefined,
          typeof context.awsRequestId === "string"
            ? context.awsRequestId
            : undefined,
          "test"
        );

        // Enqueue cost verification if we have generation IDs
        await enqueueCostVerificationIfNeeded(
          openrouterGenerationId,
          openrouterGenerationIds,
          context.workspaceId,
          context.reservationId,
          context.conversationId,
          context.agentId,
          "test"
        );
      } catch (error) {
        console.error("[Test Agent Handler] Error logging conversation:", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          workspaceId: context.workspaceId,
          agentId: context.agentId,
        });
        Sentry.captureException(ensureError(error), {
          tags: {
            endpoint: "test",
            operation: "conversation_logging",
          },
          extra: {
            workspaceId: context.workspaceId,
            agentId: context.agentId,
          },
        });
      }
    } catch (error) {
      const boomed = boomify(error as Error);
      console.error("[Test Agent Handler] Unhandled error:", boomed);
      if (boomed.isServer) {
        console.error("[Test Agent Handler] Server error details:", boomed);
        Sentry.captureException(ensureError(error), {
          tags: {
            handler: "Test Agent Handler",
            statusCode: boomed.output.statusCode,
          },
        });
      } else {
        console.error("[Test Agent Handler] Client error:", boomed);
      }

      const errorToLog = context ? normalizeByokError(error) : error;
      if (context) {
        await persistConversationError(context, errorToLog);
      }
      try {
        await writeErrorResponse(responseStream, error);
        responseStream.end();
      } catch (writeError) {
        console.error("[Test Agent Handler] Failed to write error response:", {
          error:
            writeError instanceof Error
              ? writeError.message
              : String(writeError),
        });
        Sentry.captureException(ensureError(writeError), {
          tags: {
            context: "test-agent-handler",
            operation: "write-error-response",
          },
        });
      }
    } finally {
      // Clean up context from module-level map
      if (awsRequestId) {
        clearCurrentHTTPContext(awsRequestId);
      }

      // Flush Sentry and PostHog events before Lambda terminates
      await Promise.all([flushPostHog(), flushSentry()]).catch(
        (flushErrors) => {
          console.error("[PostHog/Sentry] Error flushing events:", flushErrors);
        }
      );
    }
  };

/**
 * Streaming Lambda handler for test agent endpoint
 * Wrapped with awslambda.streamifyResponse for Lambda Function URLs with RESPONSE_STREAM mode
 * Includes mock implementation for local sandbox development
 */
export const handler = (() => {
  // Check if we're in local sandbox (awslambda is undefined)
  const isLocalSandbox =
    typeof awslambda === "undefined" || process.env.ARC_ENV === "testing";

  if (isLocalSandbox) {
    console.log(
      "[Test Agent Handler] Local sandbox detected, using mock awslambda implementation"
    );
    const mockAwslambda = createMockAwslambda();
    return mockAwslambda.streamifyResponse(
      createInternalHandler(mockAwslambda as unknown as typeof awslambda)
    );
  }

  // Production: use real awslambda
  return getDefined(awslambda, "awslambda is not defined").streamifyResponse(
    createInternalHandler(awslambda)
  );
})();
