// Removed unused imports: Readable and pipeline
// We now use direct write() and end() on ResponseStream
// Using AWS's native streamifyResponse for Lambda Function URLs with RESPONSE_STREAM mode

import { badRequest, boomify, notAcceptable, unauthorized } from "@hapi/boom";
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
import { sendAgentErrorNotification } from "../../utils/agentErrorNotifications";
import {
  extractTokenUsage,
  isMessageContentEmpty,
  updateConversation,
} from "../../utils/conversationLogger";
import {
  InsufficientCreditsError,
  SpendingLimitExceededError,
} from "../../utils/creditErrors";
import {
  adjustCreditReservation,
  enqueueCostVerification,
  refundReservation,
} from "../../utils/creditManagement";
import { validateCreditsAndLimitsAndReserve } from "../../utils/creditValidation";
import { isCreditDeductionEnabled } from "../../utils/featureFlags";
import { isAuthenticationError } from "../../utils/handlingErrors";
import {
  transformLambdaUrlToHttpV2Event,
  type LambdaUrlEvent,
} from "../../utils/httpEventAdapter";
import {
  extractOpenRouterCost,
  extractOpenRouterGenerationId,
} from "../../utils/openrouterUtils";
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
import { calculateConversationCosts } from "../../utils/tokenAccounting";
import {
  logToolDefinitions,
  setupAgentAndTools,
} from "../post-api-workspaces-000workspaceId-agents-000agentId-test/utils/agentSetup";
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
    "openrouter", // provider
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

  // Log that no reservation was created (reason should be in validateCreditsAndLimitsAndReserve logs above)
  console.log(
    "[Stream Handler] No credit reservation created (see validateCreditsAndLimitsAndReserve logs above for reason):",
    {
      workspaceId,
      agentId,
      usesByok,
      note: "This is expected if BYOK is used or credit validation is disabled. Cost verification will still run but won't finalize a reservation.",
    }
  );

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
  } finally {
    reader.releaseLock();
  }

  // End the stream after all chunks are written
  console.log("[Stream Handler] All chunks written, ending stream");
  responseStream.end();

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
  tokenUsage: ReturnType<typeof extractTokenUsage>,
  usesByok: boolean,
  streamResult?: Awaited<ReturnType<typeof streamText>>,
  conversationId?: string
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

  // Log full result before extraction for debugging
  if (streamResult) {
    console.log(
      "[Stream Handler] Full streamResult structure before generation ID extraction:",
      {
        streamResult: JSON.stringify(streamResult, null, 2),
      }
    );
  }

  // Extract OpenRouter generation ID for cost verification
  const openrouterGenerationId = streamResult
    ? extractOpenRouterGenerationId(streamResult)
    : undefined;
  // TODO: Use openrouterCost from providerMetadata when available instead of calculating
  // const openrouterCost = streamResult ? extractOpenRouterCost(streamResult) : undefined;

  console.log("[Stream Handler] Step 2: Adjusting credit reservation:", {
    workspaceId,
    reservationId,
    provider: "openrouter",
    modelName: finalModelName,
    tokenUsage,
    openrouterGenerationId,
  });
  await adjustCreditReservation(
    db,
    reservationId,
    workspaceId,
    "openrouter", // provider
    finalModelName,
    tokenUsage,
    3, // maxRetries
    usesByok,
    openrouterGenerationId
  );
  console.log(
    "[Stream Handler] Step 2: Credit reservation adjusted successfully"
  );

  // Enqueue cost verification (Step 3) if we have a generation ID
  // Always enqueue when we have a generation ID, regardless of reservationId or BYOK status
  if (openrouterGenerationId && conversationId) {
    try {
      await enqueueCostVerification(
        openrouterGenerationId,
        workspaceId,
        reservationId && reservationId !== "byok" ? reservationId : undefined,
        conversationId,
        agentId
      );
      console.log("[Stream Handler] Step 3: Cost verification enqueued", {
        openrouterGenerationId,
        reservationId:
          reservationId && reservationId !== "byok" ? reservationId : undefined,
        hasReservation: !!(reservationId && reservationId !== "byok"),
      });
    } catch (error) {
      // Log error but don't fail the request
      console.error("[Stream Handler] Error enqueueing cost verification:", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  } else if (!openrouterGenerationId) {
    console.warn(
      "[Stream Handler] No OpenRouter generation ID found, skipping cost verification"
    );
  } else if (!conversationId) {
    console.warn(
      "[Stream Handler] No conversation ID, skipping cost verification"
    );
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
    // Report to Sentry
    Sentry.captureException(ensureError(error), {
      tags: {
        endpoint: "stream",
        operation: "request_tracking",
      },
      extra: {
        workspaceId,
        agentId,
        subscriptionId,
      },
    });
  }
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
  tokenUsage: ReturnType<typeof extractTokenUsage>,
  usesByok: boolean,
  finalModelName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- streamText result type is complex
  streamResult: any
): Promise<void> {
  if (!tokenUsage) {
    return Promise.resolve();
  }

  try {
    // Extract tool calls and tool results from streamText result
    // streamText result properties are promises that need to be awaited
    // (same as test endpoint)
    const [toolCallsFromResultRaw, toolResultsFromResultRaw] =
      await Promise.all([
        Promise.resolve(streamResult?.toolCalls).then((tc) => tc || []),
        Promise.resolve(streamResult?.toolResults).then((tr) => tr || []),
      ]);

    // Ensure toolCalls and toolResults are always arrays
    let toolCallsFromResult = Array.isArray(toolCallsFromResultRaw)
      ? toolCallsFromResultRaw
      : [];
    const toolResultsFromResult = Array.isArray(toolResultsFromResultRaw)
      ? toolResultsFromResultRaw
      : [];

    // DIAGNOSTIC: Log tool calls and results extracted from stream result
    console.log("[Stream Handler] Tool calls extracted from stream result:", {
      toolCallsCount: toolCallsFromResult.length,
      toolCalls: toolCallsFromResult,
      toolResultsCount: toolResultsFromResult.length,
      toolResults: toolResultsFromResult,
      streamResultKeys: streamResult ? Object.keys(streamResult) : [],
      hasToolCalls: streamResult && "toolCalls" in streamResult,
      hasToolResults: streamResult && "toolResults" in streamResult,
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

    // Log full result before extraction for debugging
    if (streamResult) {
      console.log(
        "[Stream Handler] Full streamResult structure before generation ID extraction (message creation):",
        {
          streamResult: JSON.stringify(streamResult, null, 2),
        }
      );
    }

    // Extract OpenRouter generation ID for cost verification
    const openrouterGenerationId = streamResult
      ? extractOpenRouterGenerationId(streamResult)
      : undefined;

    // Extract cost from LLM response for provisional cost
    const openrouterCostUsd = streamResult
      ? extractOpenRouterCost(streamResult)
      : undefined;
    let provisionalCostUsd: number | undefined;
    if (openrouterCostUsd !== undefined && openrouterCostUsd >= 0) {
      // Convert from USD to millionths with 5.5% markup
      // Math.ceil ensures we never undercharge
      provisionalCostUsd = Math.ceil(openrouterCostUsd * 1_000_000 * 1.055);
      console.log("[Stream Handler] Extracted cost from response:", {
        openrouterCostUsd,
        provisionalCostUsd,
      });
    } else if (tokenUsage && finalModelName) {
      // Fallback to calculated cost from tokenUsage if not available in response
      const calculatedCosts = calculateConversationCosts(
        "openrouter",
        finalModelName,
        tokenUsage
      );
      provisionalCostUsd = calculatedCosts.usd;
      console.log(
        "[Stream Handler] Cost not in response, using calculated cost:",
        {
          provisionalCostUsd,
          tokenUsage,
        }
      );
    }

    // Create assistant message with token usage, modelName, provider, and costs
    const assistantMessage: UIMessage = {
      role: "assistant",
      content:
        assistantContent.length > 0 ? assistantContent : finalResponseText,
      ...(tokenUsage && { tokenUsage }),
      modelName: finalModelName,
      provider: "openrouter",
      ...(openrouterGenerationId && { openrouterGenerationId }),
      ...(provisionalCostUsd !== undefined && { provisionalCostUsd }),
    };

    // DIAGNOSTIC: Log assistant message structure
    console.log("[Stream Handler] Assistant message created:", {
      role: assistantMessage.role,
      contentType: typeof assistantMessage.content,
      isArray: Array.isArray(assistantMessage.content),
      contentLength: Array.isArray(assistantMessage.content)
        ? assistantMessage.content.length
        : "N/A",
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
    });

    // Combine all converted messages and assistant message for logging
    // Deduplication will happen in updateConversation (same as test endpoint)
    const messagesForLogging: UIMessage[] = [
      ...convertedMessages,
      assistantMessage,
    ];

    // Get valid messages for logging (filter out any invalid ones and empty messages)
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
        "content" in msg &&
        !isMessageContentEmpty(msg)
    );

    // Update existing conversation
    await updateConversation(
      db,
      workspaceId,
      agentId,
      conversationId,
      validMessages,
      tokenUsage,
      usesByok
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
          endpoint: "stream",
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
        endpoint: "stream",
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

  // Read and validate X-Conversation-Id header
  const conversationId =
    event.headers["x-conversation-id"] || event.headers["X-Conversation-Id"];
  if (!conversationId || typeof conversationId !== "string") {
    throw badRequest("X-Conversation-Id header is required");
  }

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
    usesByok
  );

  return {
    workspaceId,
    agentId,
    secret,
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
      // Comprehensive error logging for debugging
      console.error("[Stream Handler] Error caught:", {
        workspaceId: context.workspaceId,
        agentId: context.agentId,
        usesByok: context.usesByok,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorKeys: error && typeof error === "object" ? Object.keys(error) : [],
        errorStringified: error && typeof error === "object" 
          ? JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
          : String(error),
        isAuthenticationError: isAuthenticationError(error),
        errorStatus: error && typeof error === "object" && "statusCode" in error 
          ? (error as { statusCode?: number }).statusCode 
          : error && typeof error === "object" && "status" in error
          ? (error as { status?: number }).status
          : undefined,
        errorCause: error instanceof Error && error.cause 
          ? (error.cause instanceof Error ? error.cause.message : String(error.cause))
          : undefined,
      });

      // Check if this is a BYOK authentication error FIRST
      // This should be checked before credit errors since BYOK doesn't use credits
      if (context.usesByok && isAuthenticationError(error)) {
        console.log(
          "[Stream Handler] BYOK authentication error detected:",
          {
            workspaceId: context.workspaceId,
            agentId: context.agentId,
            error: error instanceof Error ? error.message : String(error),
            errorType: error instanceof Error ? error.constructor.name : typeof error,
            errorStringified: JSON.stringify(error, Object.getOwnPropertyNames(error)),
          }
        );

        // Write specific error message for BYOK authentication issues
        const errorChunk = `data: ${JSON.stringify({
          type: "error",
          error:
            "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions.",
        })}\n\n`;
        await writeChunkToStream(responseStream, errorChunk);
        responseStream.end();
        return;
      }

      // Handle errors based on when they occurred
      if (error instanceof InsufficientCreditsError) {
        // Send email notification (non-blocking)
        try {
          await sendAgentErrorNotification(
            context.workspaceId,
            "credit",
            error
          );
        } catch (emailError) {
          console.error(
            "[Stream Handler] Failed to send error notification:",
            emailError
          );
        }

        // Write sanitized error in SSE format
        const errorChunk = `data: ${JSON.stringify({
          type: "error",
          error:
            "Request could not be completed due to service limits. Please contact your workspace administrator.",
        })}\n\n`;
        await writeChunkToStream(responseStream, errorChunk);
        responseStream.end();
        return;
      }
      if (error instanceof SpendingLimitExceededError) {
        // Send email notification (non-blocking)
        try {
          await sendAgentErrorNotification(
            context.workspaceId,
            "spendingLimit",
            error
          );
        } catch (emailError) {
          console.error(
            "[Stream Handler] Failed to send error notification:",
            emailError
          );
        }

        // Write sanitized error in SSE format
        const errorChunk = `data: ${JSON.stringify({
          type: "error",
          error:
            "Request could not be completed due to service limits. Please contact your workspace administrator.",
        })}\n\n`;
        await writeChunkToStream(responseStream, errorChunk);
        responseStream.end();
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
          let errorTokenUsage: ReturnType<typeof extractTokenUsage> | undefined;
          try {
            if (
              error &&
              typeof error === "object" &&
              "result" in error &&
              error.result
            ) {
              errorTokenUsage = extractTokenUsage(error.result);
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
            // Best effort cleanup - don't mask original error
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
            } catch (cleanupError) {
              // Log cleanup failure but don't mask original error
              console.error(
                "[Stream Handler] Error adjusting reservation during error cleanup:",
                {
                  reservationId: context.reservationId,
                  workspaceId: context.workspaceId,
                  originalError:
                    error instanceof Error ? error.message : String(error),
                  cleanupError:
                    cleanupError instanceof Error
                      ? cleanupError.message
                      : String(cleanupError),
                }
              );
              // Report cleanup failure to Sentry but continue to re-throw original error
              Sentry.captureException(
                cleanupError instanceof Error
                  ? cleanupError
                  : new Error(String(cleanupError)),
                {
                  tags: {
                    context: "error_cleanup",
                    operation: "adjustCreditReservation",
                  },
                  extra: {
                    reservationId: context.reservationId,
                    workspaceId: context.workspaceId,
                    originalError:
                      error instanceof Error ? error.message : String(error),
                  },
                }
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
            // Best effort cleanup - don't mask original error
            try {
              const reservationPk = `credit-reservations/${context.reservationId}`;
              await context.db["credit-reservations"].delete(reservationPk);
            } catch (cleanupError) {
              // Log cleanup failure but don't mask original error
              console.error(
                "[Stream Handler] Error deleting reservation during error cleanup:",
                {
                  reservationId: context.reservationId,
                  workspaceId: context.workspaceId,
                  originalError:
                    error instanceof Error ? error.message : String(error),
                  cleanupError:
                    cleanupError instanceof Error
                      ? cleanupError.message
                      : String(cleanupError),
                }
              );
              // Report cleanup failure to Sentry but continue to re-throw original error
              Sentry.captureException(
                cleanupError instanceof Error
                  ? cleanupError
                  : new Error(String(cleanupError)),
                {
                  tags: {
                    context: "error_cleanup",
                    operation: "deleteReservation",
                  },
                  extra: {
                    reservationId: context.reservationId,
                    workspaceId: context.workspaceId,
                    originalError:
                      error instanceof Error ? error.message : String(error),
                  },
                }
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

    // Extract text, tool calls, tool results, and usage from streamText result
    // streamText result properties are promises that need to be awaited
    // (same as test endpoint)
    // streamResult.text includes the complete final response including continuation responses after tool execution
    const [responseText, usage] = await Promise.all([
      Promise.resolve(streamResult.text).then((t) => t || ""),
      Promise.resolve(streamResult.usage),
    ]);

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

    const tokenUsage = extractTokenUsage({ ...streamResult, usage });

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
        context.conversationId
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
          endpoint: "stream",
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
      context.agentId
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
      streamResult
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

    try {
      await writeErrorResponse(responseStream, error);
      responseStream.end();
    } catch (writeError) {
      console.error("[Stream Handler] Failed to write error response:", {
        error:
          writeError instanceof Error ? writeError.message : String(writeError),
      });
    }
  } finally {
    // Flush Sentry and PostHog events before Lambda terminates (critical for Lambda)
    // This ensures flushing happens on both success and error paths
    await Promise.all([flushPostHog(), flushSentry()]).catch((flushErrors) => {
      console.error("[PostHog/Sentry] Error flushing events:", flushErrors);
    });
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
