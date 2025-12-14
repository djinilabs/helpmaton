// Removed unused imports: Readable and pipeline
// We now use direct write() and end() on ResponseStream
// Using AWS's native streamifyResponse for Lambda Function URLs with RESPONSE_STREAM mode

import { boomify, notAcceptable, unauthorized } from "@hapi/boom";
import type { ModelMessage } from "ai";
import { convertToModelMessages, streamText } from "ai";

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

import {
  MODEL_NAME,
  buildGenerateTextOptions,
} from "../../http/utils/agentUtils";
import { database } from "../../tables";
import {
  extractTokenUsage,
  startConversation,
  updateConversation,
  type TokenUsage,
} from "../../utils/conversationLogger";
import {
  InsufficientCreditsError,
  SpendingLimitExceededError,
} from "../../utils/creditErrors";
import {
  adjustCreditReservation,
  refundReservation,
} from "../../utils/creditManagement";
import { validateCreditsAndLimitsAndReserve } from "../../utils/creditValidation";
import { isCreditDeductionEnabled } from "../../utils/featureFlags";
import {
  transformLambdaUrlToHttpV2Event,
  type LambdaUrlEvent,
} from "../../utils/httpEventAdapter";
import { flushPostHog } from "../../utils/posthog";
import {
  checkDailyRequestLimit,
  incrementRequestBucket,
} from "../../utils/requestTracking";
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
import {
  checkFreePlanExpiration,
  getWorkspaceSubscription,
} from "../../utils/subscriptionUtils";
import {
  logToolDefinitions,
  setupAgentAndTools,
} from "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/agentSetup";
import {
  convertTextToUIMessage,
  convertUIMessagesToModelMessages,
} from "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/messageConversion";
import type { UIMessage } from "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/types";

import { getDefined } from "@/utils";

// Initialize Sentry when this module is loaded (before any handlers are called)
initSentry();

/**
 * Path parameters extracted from the request
 */
interface PathParameters {
  workspaceId: string;
  agentId: string;
  secret: string;
}

/**
 * Request context for processing the stream
 */
interface StreamRequestContext {
  workspaceId: string;
  agentId: string;
  secret: string;
  origin: string | undefined;
  allowedOrigins: string[] | null;
  subscriptionId: string | undefined;
  db: Awaited<ReturnType<typeof database>>;
  uiMessage: UIMessage;
  allMessages: UIMessage[];
  modelMessages: ModelMessage[];
  agent: Awaited<ReturnType<typeof setupAgentAndTools>>["agent"];
  model: Awaited<ReturnType<typeof setupAgentAndTools>>["model"];
  tools: Awaited<ReturnType<typeof setupAgentAndTools>>["tools"];
  usesByok: boolean;
  reservationId: string | undefined;
  finalModelName: string;
  conversationId: string | undefined;
}

const DEFAULT_CONTENT_TYPE = "text/event-stream; charset=utf-8";

/**
 * Get CORS headers based on allowed origins
 */
function getResponseHeaders(
  origin: string | undefined,
  allowedOrigins: string[] | null
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": DEFAULT_CONTENT_TYPE,
  };

  if (!allowedOrigins || allowedOrigins.length === 0) {
    // No CORS configuration - allow all origins (default permissive behavior)
    headers["Access-Control-Allow-Origin"] = "*";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] =
      "Content-Type, Authorization, X-Requested-With, Origin, Accept";
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
    "Content-Type, Authorization, X-Requested-With, Origin, Accept";

  console.log("[Stream Handler] Response headers:", headers);
  return headers;
}

/**
 * Extracts path parameters from the Lambda URL event
 */
function extractPathParameters(event: LambdaUrlEvent): PathParameters | null {
  const httpV2Event = transformLambdaUrlToHttpV2Event(event);

  let workspaceId = httpV2Event.pathParameters?.workspaceId;
  let agentId = httpV2Event.pathParameters?.agentId;
  let secret = httpV2Event.pathParameters?.secret;

  // Fallback: extract from rawPath if pathParameters not populated
  // Handle both /api/streams/... and //api/streams/... (double slash)
  // Note: secret can contain slashes, so we need to match everything after agentId
  if (!workspaceId || !agentId || !secret) {
    // Normalize path by removing leading slashes and handling double slashes
    const normalizedPath = (event.rawPath || "").replace(/^\/+/, "/");
    // Match: /api/streams/{workspaceId}/{agentId}/{secret}
    // Secret can contain slashes, so we match everything after agentId/
    const pathMatch = normalizedPath.match(
      /^\/api\/streams\/([^/]+)\/([^/]+)\/(.+)$/
    );
    if (pathMatch) {
      workspaceId = pathMatch[1];
      agentId = pathMatch[2];
      secret = pathMatch[3]; // This can contain slashes
    } else {
      // Log for debugging
      console.log("[Stream Handler] Path extraction failed:", {
        rawPath: event.rawPath,
        normalizedPath,
        pathParameters: httpV2Event.pathParameters,
      });
    }
  }

  if (!workspaceId || !agentId || !secret) {
    return null;
  }

  return { workspaceId, agentId, secret };
}

/**
 * Validates the request secret against the stored secret
 */
async function validateRequestSecret(
  workspaceId: string,
  agentId: string,
  secret: string
): Promise<boolean> {
  return await validateSecret(workspaceId, agentId, secret);
}

/**
 * Validates subscription and plan limits
 */
async function validateSubscriptionAndLimits(
  workspaceId: string
): Promise<string | undefined> {
  await checkFreePlanExpiration(workspaceId);

  const subscription = await getWorkspaceSubscription(workspaceId);
  const subscriptionId = subscription
    ? subscription.pk.replace("subscriptions/", "")
    : undefined;

  if (subscriptionId) {
    await checkDailyRequestLimit(subscriptionId);
  }

  return subscriptionId;
}

/**
 * Sets up the agent, model, and tools for the request
 */
async function setupAgentContext(
  workspaceId: string,
  agentId: string,
  modelReferer: string
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
 * Converts the request body to model messages
 * Supports both plain text and JSON message arrays (for tool results)
 * When messages are from useChat, they are in ai-sdk UIMessage format
 * Also extracts conversationId if present in the request body
 */
function convertRequestBodyToMessages(bodyText: string): {
  uiMessage: UIMessage;
  allMessages: UIMessage[];
  modelMessages: ModelMessage[];
  conversationId?: string;
} {
  // Try to parse as JSON first (for messages with tool results)
  let messages: UIMessage[] | null = null;
  let conversationId: string | undefined;
  try {
    const parsed = JSON.parse(bodyText);
    // Check if it's an object with messages array and optional conversationId
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "messages" in parsed &&
      Array.isArray(parsed.messages) &&
      parsed.messages.length > 0
    ) {
      // Validate that it looks like UIMessage array
      // Messages can be in ai-sdk format (with 'parts') or our format (with 'content')
      const firstMessage = parsed.messages[0];
      if (
        typeof firstMessage === "object" &&
        firstMessage !== null &&
        "role" in firstMessage &&
        ("content" in firstMessage || "parts" in firstMessage)
      ) {
        messages = parsed.messages as UIMessage[];
        // Extract conversationId if present
        if (
          "conversationId" in parsed &&
          typeof parsed.conversationId === "string"
        ) {
          conversationId = parsed.conversationId;
        }
      }
    } else if (Array.isArray(parsed) && parsed.length > 0) {
      // Check if it's an array of messages (from useChat)
      // Validate that it looks like UIMessage array
      // Messages can be in ai-sdk format (with 'parts') or our format (with 'content')
      const firstMessage = parsed[0];
      if (
        typeof firstMessage === "object" &&
        firstMessage !== null &&
        "role" in firstMessage &&
        ("content" in firstMessage || "parts" in firstMessage)
      ) {
        messages = parsed as UIMessage[];
      }
    }
  } catch {
    // Not JSON, treat as plain text
  }

  // If we have parsed messages, use them; otherwise treat as plain text
  if (messages && messages.length > 0) {
    // Get the last user message for uiMessage (for logging)
    const lastUserMessage = messages
      .slice()
      .reverse()
      .find((msg) => msg.role === "user");
    const uiMessage: UIMessage =
      lastUserMessage ||
      (messages[messages.length - 1] as UIMessage) ||
      convertTextToUIMessage(bodyText);

    // Check if messages are in ai-sdk format (have 'parts' property)
    // Messages from useChat will have 'parts', our local format has 'content'
    const firstMsg = messages[0];
    const isAiSdkFormat =
      firstMsg &&
      typeof firstMsg === "object" &&
      "parts" in firstMsg &&
      Array.isArray(firstMsg.parts);

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
        // Use our local converter
        modelMessages = convertUIMessagesToModelMessages(messages);
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

    // Convert ai-sdk format messages (with 'parts') to our format (with 'content') for logging
    // This ensures allMessages are in a consistent format for storage
    const convertedMessages: UIMessage[] = messages.map((msg) => {
      // If message has 'parts' but no 'content', convert it
      if (
        msg &&
        typeof msg === "object" &&
        "parts" in msg &&
        !("content" in msg)
      ) {
        const msgObj = msg as {
          parts?: unknown[];
          role: string;
          [key: string]: unknown;
        };
        const parts = msgObj.parts;
        if (Array.isArray(parts) && parts.length > 0) {
          // Extract text from parts
          const textParts = parts
            .filter(
              (part) =>
                part &&
                typeof part === "object" &&
                "type" in part &&
                part.type === "text" &&
                "text" in part
            )
            .map((part) => (part as { text: string }).text)
            .join("");
          // Create new message with content, preserving role and other properties
          const converted: UIMessage = {
            role: msgObj.role,
            content: textParts || "",
          } as UIMessage;
          return converted;
        }
        // If parts array is empty or doesn't have text, create empty content
        const converted: UIMessage = {
          role: msgObj.role,
          content: "",
        } as UIMessage;
        return converted;
      }
      return msg as UIMessage;
    });

    return {
      uiMessage,
      allMessages: convertedMessages,
      modelMessages,
      conversationId,
    };
  }

  // Fallback to plain text handling
  const uiMessage = convertTextToUIMessage(bodyText);
  const allMessages = [uiMessage];
  // For plain text, use our local converter since it's in our UIMessage format
  const modelMessages: ModelMessage[] = convertUIMessagesToModelMessages([
    uiMessage,
  ]);

  return { uiMessage, allMessages, modelMessages, conversationId };
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
  usesByok: boolean
): Promise<string | undefined> {
  // Derive the model name from the agent's modelName if set, otherwise use default
  const finalModelName =
    typeof agent.modelName === "string" ? agent.modelName : MODEL_NAME;

  const toolDefinitions = tools
    ? Object.entries(tools).map(([name, tool]) => {
        const typedTool = tool as {
          description?: string;
          inputSchema?: unknown;
        };
        return {
          name,
          description: typedTool.description || "",
          parameters: typedTool.inputSchema || {},
        };
      })
    : undefined;

  const reservation = await validateCreditsAndLimitsAndReserve(
    db,
    workspaceId,
    agentId,
    "google", // provider
    finalModelName,
    modelMessages,
    agent.systemPrompt,
    toolDefinitions,
    usesByok
  );

  if (reservation) {
    console.log("[Stream Handler] Credits reserved:", {
      workspaceId,
      reservationId: reservation.reservationId,
      reservedAmount: reservation.reservedAmount,
    });
    return reservation.reservationId;
  }

  return undefined;
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
  const generateOptions = buildGenerateTextOptions(agent);
  const finalModelName =
    typeof agent.modelName === "string" ? agent.modelName : MODEL_NAME;
  console.log("[Stream Handler] Executing streamText with parameters:", {
    workspaceId: "stream",
    agentId: "stream",
    model: finalModelName,
    systemPromptLength: agent.systemPrompt.length,
    messagesCount: modelMessages.length,
    toolsCount: tools ? Object.keys(tools).length : 0,
    ...generateOptions,
  });
  // Log tool definitions before LLM call
  if (tools) {
    logToolDefinitions(tools, "Stream Handler", agent);
  }

  const streamResult = streamText({
    model: model as unknown as Parameters<typeof streamText>[0]["model"],
    system: agent.systemPrompt,
    messages: modelMessages,
    tools,
    ...generateOptions,
  });

  // Get the UI message stream response from streamText result
  // This returns SSE format (Server-Sent Events) that useChat expects
  const streamResponse = streamResult.toUIMessageStreamResponse();

  // Read from the stream and write chunks to responseStream immediately as they arrive
  // This ensures true streaming without buffering
  const reader = streamResponse.body?.getReader();
  if (!reader) {
    throw new Error("Stream response body is null");
  }

  const decoder = new TextDecoder();
  let textBuffer = ""; // Buffer for extracting text deltas (for logging/tracking only)

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
                if (jsonStr === "[DONE]") {
                  continue;
                }
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

    // Process any remaining buffered text before closing
    if (textBuffer) {
      // Try to extract any remaining text from the buffer
      const lines = textBuffer.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const jsonStr = line.substring(6);
            if (jsonStr === "[DONE]") {
              continue;
            }
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
      // Write any remaining buffered text to stream
      const remainingBytes = new TextEncoder().encode(textBuffer);
      await writeChunkToStream(responseStream, remainingBytes);
    }
  } finally {
    reader.releaseLock();
  }

  // End the stream after all chunks are written
  console.log("[Stream Handler] All chunks written, ending stream");
  responseStream.end();

  // Flush PostHog events before returning (critical for Lambda)
  try {
    await flushPostHog();
  } catch (flushError) {
    console.error("[PostHog] Error flushing events:", flushError);
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
  usesByok: boolean
): Promise<void> {
  // TEMPORARY: This can be disabled via ENABLE_CREDIT_DEDUCTION env var
  if (
    !isCreditDeductionEnabled() ||
    !reservationId ||
    reservationId === "byok" ||
    !tokenUsage ||
    (tokenUsage.promptTokens === 0 && tokenUsage.completionTokens === 0)
  ) {
    if (!isCreditDeductionEnabled()) {
      console.log(
        "[Stream Handler] Credit deduction disabled via feature flag, skipping adjustment:",
        {
          workspaceId,
          agentId,
          reservationId,
          tokenUsage,
        }
      );
    } else if (!reservationId || reservationId === "byok") {
      console.log(
        "[Stream Handler] No reservation (BYOK), skipping adjustment:",
        {
          workspaceId,
          agentId,
          reservationId,
        }
      );
    }
    return;
  }

  try {
    console.log("[Stream Handler] Adjusting credit reservation:", {
      workspaceId,
      reservationId,
      provider: "google",
      modelName: finalModelName,
      tokenUsage,
    });
    await adjustCreditReservation(
      db,
      reservationId,
      workspaceId,
      "google", // provider
      finalModelName,
      tokenUsage,
      3, // maxRetries
      usesByok
    );
    console.log("[Stream Handler] Credit reservation adjusted successfully");
  } catch (error) {
    // Log error but don't fail the request (stream already sent)
    console.error("[Stream Handler] Error adjusting credit reservation:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      workspaceId,
      agentId,
      reservationId,
      tokenUsage,
    });
  }
}

/**
 * Tracks the successful LLM request
 */
async function trackRequestUsage(
  subscriptionId: string | undefined,
  workspaceId: string,
  agentId: string
): Promise<void> {
  if (!subscriptionId) {
    return;
  }

  try {
    await incrementRequestBucket(subscriptionId);
  } catch (error) {
    // Log error but don't fail the request
    console.error("[Stream Handler] Error incrementing request bucket:", {
      error: error instanceof Error ? error.message : String(error),
      workspaceId,
      agentId,
      subscriptionId,
    });
  }
}

/**
 * Logs the conversation asynchronously
 */
async function logConversationAsync(
  db: Awaited<ReturnType<typeof database>>,
  workspaceId: string,
  agentId: string,
  allMessages: UIMessage[],
  fullStreamedText: string,
  tokenUsage: TokenUsage | undefined,
  usesByok: boolean,
  finalModelName: string,
  conversationId?: string
): Promise<void> {
  if (!tokenUsage) {
    return Promise.resolve();
  }

  try {
    // Start with all messages from the request, preserving original order
    const validMessages: UIMessage[] = [...allMessages];

    // Add assistant's response at the end if we extracted any text
    if (
      fullStreamedText &&
      typeof fullStreamedText === "string" &&
      fullStreamedText.trim().length > 0
    ) {
      const assistantMessage: UIMessage = {
        role: "assistant",
        content: fullStreamedText,
      };
      validMessages.push(assistantMessage);
    }

    // Filter to ensure all messages are valid
    const filteredMessages = validMessages.filter(
      (msg): msg is UIMessage =>
        msg != null &&
        typeof msg === "object" &&
        "role" in msg &&
        typeof msg.role === "string" &&
        (msg.role === "user" ||
          msg.role === "assistant" ||
          msg.role === "system" ||
          msg.role === "tool") &&
        "content" in msg &&
        (typeof msg.content === "string" || Array.isArray(msg.content))
    );

    // Run this asynchronously without blocking
    if (
      conversationId &&
      typeof conversationId === "string" &&
      conversationId.trim().length > 0
    ) {
      // Update existing conversation
      await updateConversation(
        db,
        workspaceId,
        agentId,
        conversationId,
        filteredMessages,
        tokenUsage,
        finalModelName,
        "google",
        usesByok
      ).catch((error) => {
        // Log error but don't fail the request
        console.error("[Stream Handler] Error logging conversation:", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          workspaceId,
          agentId,
          conversationId,
        });
      });
    } else {
      // Start new conversation
      await startConversation(db, {
        workspaceId,
        agentId,
        conversationType: "stream", // Use 'stream' type for streaming endpoint
        messages: filteredMessages,
        tokenUsage,
        modelName: finalModelName,
        provider: "google",
        usesByok,
      }).catch((error) => {
        // Log error but don't fail the request
        console.error("[Stream Handler] Error logging conversation:", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          workspaceId,
          agentId,
        });
      });
    }
  } catch (error) {
    // Log error but don't fail the request
    console.error("[Stream Handler] Error preparing conversation log:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      workspaceId,
      agentId,
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
    await writeChunkToStream(responseStream, errorChunk);

    // End the stream
    responseStream.end();
    console.log("[Stream Handler] Error response written and stream ended");
  } catch (writeError) {
    // If we can't write to the stream, just log the error
    console.error("[Stream Handler] Error writing error response:", {
      error:
        writeError instanceof Error ? writeError.message : String(writeError),
      stack: writeError instanceof Error ? writeError.stack : undefined,
      writeErrorType: writeError?.constructor?.name,
    });
    // Try to end the stream even if write failed
    try {
      responseStream.end();
    } catch (endError) {
      console.error(
        "[Stream Handler] Error ending stream after write failure:",
        {
          error:
            endError instanceof Error ? endError.message : String(endError),
        }
      );
    }
    throw writeError;
  }
}

/**
 * Builds the complete request context for processing the stream
 */
async function buildRequestContext(
  event: LambdaUrlEvent,
  pathParams: PathParameters
): Promise<StreamRequestContext> {
  const { workspaceId, agentId, secret } = pathParams;

  // Get allowed origins for CORS
  const allowedOrigins = await getAllowedOrigins(workspaceId, agentId);
  const origin = event.headers["origin"] || event.headers["Origin"];

  // Validate subscription and limits
  const subscriptionId = await validateSubscriptionAndLimits(workspaceId);

  // Setup database connection
  const db = await database();

  // Setup agent context
  // Always use "https://app.helpmaton.com" as the Referer header for LLM provider calls
  const modelReferer = "https://app.helpmaton.com";
  const { agent, model, tools, usesByok } = await setupAgentContext(
    workspaceId,
    agentId,
    modelReferer
  );

  // Extract and convert request body
  const bodyText = extractRequestBody(event);
  if (!bodyText) {
    throw new Error("Request body is required");
  }

  const { uiMessage, allMessages, modelMessages, conversationId } =
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
    usesByok
  );

  return {
    workspaceId,
    agentId,
    secret,
    origin,
    allowedOrigins,
    subscriptionId,
    db,
    uiMessage,
    allMessages,
    modelMessages,
    agent,
    model,
    tools,
    usesByok,
    reservationId,
    finalModelName,
    conversationId,
  };
}

/**
 * Internal handler function that processes the request
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
  let allowedOrigins: string[] | null = null;

  // Fetch allowed origins from database based on stream server configuration
  allowedOrigins = await getAllowedOrigins(
    pathParams.workspaceId,
    pathParams.agentId
  );
  console.log("[Stream Handler] OPTIONS request - fetched allowed origins:", {
    workspaceId: pathParams.workspaceId,
    agentId: pathParams.agentId,
    allowedOrigins,
  });

  // Build CORS headers based on database configuration (or default if not available)
  const origin = event.headers["origin"] || event.headers["Origin"];
  const responseHeaders = getResponseHeaders(origin, allowedOrigins);

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
      // Flush PostHog events before returning (critical for Lambda)
      try {
        await flushPostHog();
      } catch (flushError) {
        console.error("[PostHog] Error flushing events:", flushError);
      }
      return;
    }

    // Extract and validate path parameters
    // Log the path for debugging
    console.log("[Stream Handler] Path extraction:", {
      rawPath: event.rawPath,
      path: event.requestContext?.http?.path,
      method: event.requestContext?.http?.method,
    });

    const context = await buildRequestContext(event, pathParams);

    // Set status code and headers directly
    // Validate secret
    const isValidSecret = await validateRequestSecret(
      pathParams.workspaceId,
      pathParams.agentId,
      pathParams.secret
    );
    if (!isValidSecret) {
      throw unauthorized("Invalid secret");
    }

    console.log("[Stream Handler] Building request context...");
    console.log("[Stream Handler] Request context built successfully");

    // Stream the AI response
    // Always write to the original responseStream passed to this function
    let fullStreamedText = "";
    let llmCallAttempted = false;
    let streamResult: Awaited<ReturnType<typeof streamText>> | undefined;

    try {
      console.log("[Stream Handler] Starting AI stream...");
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
      // LLM call succeeded - mark as attempted
      llmCallAttempted = true;
      console.log("[Stream Handler] AI stream completed");
    } catch (error) {
      // Handle errors based on when they occurred
      if (error instanceof InsufficientCreditsError) {
        // Write error in SSE format
        const errorChunk = `data: ${JSON.stringify({
          type: "error",
          error: error.message,
          workspaceId: error.workspaceId,
          required: error.required,
          available: error.available,
          currency: error.currency,
        })}\n\n`;
        await writeChunkToStream(responseStream, errorChunk);
        responseStream.end();
        // Flush PostHog events before returning (critical for Lambda)
        try {
          await flushPostHog();
        } catch (flushError) {
          console.error("[PostHog] Error flushing events:", flushError);
        }
        return;
      }
      if (error instanceof SpendingLimitExceededError) {
        // Write error in SSE format
        const errorChunk = `data: ${JSON.stringify({
          type: "error",
          error: error.message,
          failedLimits: error.failedLimits,
        })}\n\n`;
        await writeChunkToStream(responseStream, errorChunk);
        responseStream.end();
        // Flush PostHog events before returning (critical for Lambda)
        try {
          await flushPostHog();
        } catch (flushError) {
          console.error("[PostHog] Error flushing events:", flushError);
        }
        return;
      }

      // Error after reservation but before or during LLM call
      if (context.reservationId && context.reservationId !== "byok") {
        if (!llmCallAttempted) {
          // Error before LLM call - refund reservation
          try {
            console.log(
              "[Stream Handler] Error before LLM call, refunding reservation:",
              {
                workspaceId: context.workspaceId,
                reservationId: context.reservationId,
                error: error instanceof Error ? error.message : String(error),
              }
            );
            await refundReservation(context.db, context.reservationId);
          } catch (refundError) {
            // Log but don't fail - refund is best effort
            console.error("[Stream Handler] Error refunding reservation:", {
              reservationId: context.reservationId,
              error:
                refundError instanceof Error
                  ? refundError.message
                  : String(refundError),
            });
          }
        } else {
          // Error after LLM call - try to get token usage from error if available
          let errorTokenUsage: TokenUsage | undefined;
          try {
            if (
              error &&
              typeof error === "object" &&
              "result" in error &&
              error.result
            ) {
              errorTokenUsage = await extractTokenUsage(error.result);
            }
          } catch {
            // Ignore extraction errors
          }

          if (
            isCreditDeductionEnabled() &&
            errorTokenUsage &&
            (errorTokenUsage.promptTokens > 0 ||
              errorTokenUsage.completionTokens > 0)
          ) {
            // We have token usage - adjust reservation
            try {
              await adjustCreditReservation(
                context.db,
                context.reservationId,
                context.workspaceId,
                "google",
                context.finalModelName,
                errorTokenUsage,
                3,
                context.usesByok
              );
            } catch (adjustError) {
              console.error(
                "[Stream Handler] Error adjusting reservation after error:",
                adjustError
              );
            }
          } else {
            // No token usage available - assume reserved credits were consumed
            console.warn(
              "[Stream Handler] Model error without token usage, assuming reserved credits consumed:",
              {
                workspaceId: context.workspaceId,
                reservationId: context.reservationId,
                error: error instanceof Error ? error.message : String(error),
              }
            );
            // Delete reservation without refund
            try {
              const reservationPk = `credit-reservations/${context.reservationId}`;
              await context.db["credit-reservations"].delete(reservationPk);
            } catch (deleteError) {
              console.warn(
                "[Stream Handler] Error deleting reservation:",
                deleteError
              );
            }
          }
        }
      }

      // Re-throw error to be handled by error handler
      throw error;
    }

    // If we get here, the LLM call succeeded
    if (!streamResult) {
      throw new Error("LLM call succeeded but result is undefined");
    }

    // Extract token usage from stream result
    const tokenUsage = await extractTokenUsage(streamResult);

    // Post-processing: adjust credit reservation, track usage, log conversation
    await adjustCreditsAfterStream(
      context.db,
      context.workspaceId,
      context.agentId,
      context.reservationId,
      context.finalModelName,
      tokenUsage,
      context.usesByok
    );

    await trackRequestUsage(
      context.subscriptionId,
      context.workspaceId,
      context.agentId
    );

    await logConversationAsync(
      context.db,
      context.workspaceId,
      context.agentId,
      context.allMessages,
      fullStreamedText,
      tokenUsage,
      context.usesByok,
      context.finalModelName,
      context.conversationId
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

      // Flush Sentry events before returning (critical for Lambda)
      await flushSentry();
    } else {
      console.error("[Stream Handler] Client error:", boomed);
    }

    // Flush PostHog events before returning (critical for Lambda)
    try {
      await flushPostHog();
    } catch (flushError) {
      console.error("[PostHog] Error flushing events:", flushError);
    }

    try {
      await writeErrorResponse(responseStream, error);
      responseStream.end();
    } catch (writeError) {
      console.error("[Stream Handler] Failed to write error response:", {
        error:
          writeError instanceof Error ? writeError.message : String(writeError),
      });
    }
  }
};

/**
 * Streaming Lambda handler for agent interactions
 * Wrapped with awslambda.streamifyResponse for Lambda Function URLs with RESPONSE_STREAM mode
 */
/**
 * Streaming Lambda handler for agent interactions
 * Wrapped with awslambda.streamifyResponse for Lambda Function URLs with RESPONSE_STREAM mode
 */
export const handler = getDefined(
  awslambda,
  "awslambda is not defined"
).streamifyResponse(internalHandler);
