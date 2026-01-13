import { badRequest } from "@hapi/boom";
import { convertToModelMessages } from "ai";
import type { ModelMessage } from "ai";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { z } from "zod";

import { setupAgentAndTools } from "../../http/utils/agentSetup";
import {
  convertAiSdkUIMessagesToUIMessages,
  convertTextToUIMessage,
  convertUIMessagesToModelMessages,
} from "../../http/utils/messageConversion";
import { database } from "../../tables";
import type { LambdaUrlEvent } from "../../utils/httpEventAdapter";
import type { UIMessage } from "../../utils/messageTypes";
import { getAllowedOrigins } from "../../utils/streamServerUtils";
import { getContextFromRequestId } from "../../utils/workspaceCreditContext";

import { MODEL_NAME } from "./agentUtils";
import { validateAndReserveCredits } from "./generationCreditManagement";
import { validateSubscriptionAndLimits } from "./generationRequestTracking";
import { streamRequestSchema } from "./schemas/requestSchemas";
import type { EndpointType } from "./streamEndpointDetection";
import type { PathParameters } from "./streamPathExtraction";

/**
 * Request context for processing the stream
 */
export interface StreamRequestContext {
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
 * JSON bodies are strictly validated with Zod schemas
 */
async function convertRequestBodyToMessages(bodyText: string): Promise<{
  uiMessage: UIMessage;
  modelMessages: ModelMessage[];
  convertedMessages: UIMessage[];
}> {
  // Try to parse as JSON first (for messages with tool results)
  let messages: UIMessage[] | null = null;
  let parsed: unknown = null;
  let isJson = false;

  try {
    parsed = JSON.parse(bodyText);
    isJson = true;
  } catch {
    // Not JSON, treat as plain text
  }

  // If it's JSON, validate it strictly
  if (isJson && parsed !== null) {
    // Check if it's an array of messages (from useChat)
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Validate that it looks like UIMessage array
      const firstMessage = parsed[0];
      if (
        typeof firstMessage === "object" &&
        firstMessage !== null &&
        "role" in firstMessage
      ) {
        // For array format (ai-sdk), validate core structure
        // Note: ai-sdk messages have 'parts' and other fields, so we validate
        // the structure but allow extra fields (ai-sdk format compatibility)
        const arraySchema = z
          .array(
            z
              .object({
                role: z.enum(["user", "assistant", "system", "tool"]),
                // Allow content or parts (ai-sdk uses parts)
                content: z.union([z.string(), z.array(z.unknown())]).optional(),
                parts: z.array(z.unknown()).optional(),
              })
              .passthrough() // Allow extra fields for ai-sdk format compatibility
              .refine(
                (data) =>
                  data.content !== undefined || data.parts !== undefined,
                { message: "Message must have either 'content' or 'parts'" }
              )
          )
          .min(1);
        // Use parse (not strict) for ai-sdk compatibility, but validate structure
        const validated = arraySchema.parse(parsed);
        messages = validated as UIMessage[];
      } else {
        throw badRequest(
          "Invalid message array format: each message must have a 'role' property"
        );
      }
    }
    // Check if it's an object with a 'messages' property (from useChat with full state)
    else if (
      typeof parsed === "object" &&
      parsed !== null &&
      "messages" in parsed
    ) {
      // Validate with streamRequestSchema (strict) - this is our own format
      try {
        const validated = streamRequestSchema.parse(parsed);
        messages = validated.messages as UIMessage[];
      } catch (error) {
        // Re-throw validation errors
        throw badRequest(
          error instanceof z.ZodError
            ? `Validation failed: ${error.issues
                .map((e) => `${e.path.join(".")}: ${e.message}`)
                .join("; ")}`
            : "Invalid request body format"
        );
      }
    } else {
      // Invalid JSON structure - throw validation error
      throw badRequest(
        "Request body must be either plain text, an array of messages, or an object with a 'messages' property"
      );
    }
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
        modelMessages = await convertToModelMessages(
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
 * Validates subscription and plan limits
 */
async function validateSubscriptionAndLimitsStream(
  workspaceId: string,
  endpointType: EndpointType
): Promise<string | undefined> {
  return await validateSubscriptionAndLimits(workspaceId, endpointType);
}

/**
 * Builds the complete request context for processing the stream
 */
export async function buildStreamRequestContext(
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
  // The requestId should have been set in handleApiGatewayStreaming or internalHandler
  // before this function is called. If it's missing or empty, that's an error.
  const awsRequestId = event.requestContext?.requestId;

  if (!awsRequestId || awsRequestId.trim() === "") {
    console.error(
      "[buildStreamRequestContext] Request ID is missing or empty:",
      {
        hasRequestContext: !!event.requestContext,
        requestIdInEvent: event.requestContext?.requestId,
      }
    );
    throw new Error(
      "Request ID is missing from event. Context setup should have set this before calling buildStreamRequestContext."
    );
  }

  const lambdaContext = getContextFromRequestId(awsRequestId);
  if (!lambdaContext) {
    // Log detailed error information for debugging
    console.error(
      "[buildStreamRequestContext] Context not found for requestId:",
      {
        awsRequestId,
        hasRequestContext: !!event.requestContext,
        requestIdInEvent: event.requestContext?.requestId,
      }
    );
    throw new Error(
      `Context not available for workspace credit transactions. RequestId: ${awsRequestId}`
    );
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
    await convertRequestBodyToMessages(bodyText);

  // Add timestamps to user messages that don't have them
  const now = new Date().toISOString();
  const convertedMessagesWithTimestamps = convertedMessages.map((msg) => {
    if (msg.role === "user" && !msg.generationStartedAt) {
      return {
        ...msg,
        generationStartedAt: now,
        generationEndedAt: now, // User messages are instantaneous
      };
    }
    if (msg.role === "system" && !msg.generationStartedAt) {
      return {
        ...msg,
        generationStartedAt: now,
        generationEndedAt: now, // System messages are instantaneous
      };
    }
    return msg;
  });

  // Update uiMessage if it's a user message without timestamps
  const uiMessageWithTimestamps =
    uiMessage.role === "user" && !uiMessage.generationStartedAt
      ? {
          ...uiMessage,
          generationStartedAt: now,
          generationEndedAt: now,
        }
      : uiMessage;

  // Fetch existing conversation messages to check for existing knowledge injection
  let existingConversationMessages: UIMessage[] | undefined;
  try {
    const conversationPk = `conversations/${workspaceId}/${agentId}/${conversationId}`;
    const existingConversation = await db["agent-conversations"].get(
      conversationPk
    );
    if (existingConversation && existingConversation.messages) {
      existingConversationMessages =
        existingConversation.messages as UIMessage[];
    }
  } catch (error) {
    // If conversation doesn't exist yet or fetch fails, that's okay - we'll create new knowledge injection
    console.log(
      "[buildStreamRequestContext] Could not fetch existing conversation messages:",
      error instanceof Error ? error.message : String(error)
    );
  }

  // Inject knowledge from workspace documents if enabled
  const { injectKnowledgeIntoMessages } = await import(
    "../../utils/knowledgeInjection"
  );
  const knowledgeInjectionResult = await injectKnowledgeIntoMessages(
    workspaceId,
    agent,
    modelMessages,
    db,
    lambdaContext,
    agentId,
    conversationId,
    usesByok,
    existingConversationMessages
  );

  const modelMessagesWithKnowledge = knowledgeInjectionResult.modelMessages;
  const knowledgeInjectionMessage =
    knowledgeInjectionResult.knowledgeInjectionMessage;
  const rerankingRequestMessage =
    knowledgeInjectionResult.rerankingRequestMessage;
  const rerankingResultMessage =
    knowledgeInjectionResult.rerankingResultMessage;

  // Add re-ranking and knowledge injection messages to convertedMessages if they exist
  let updatedConvertedMessages = convertedMessagesWithTimestamps;

  // Find insertion point (before first user message)
  const userMessageIndex = convertedMessagesWithTimestamps.findIndex(
    (msg) => msg.role === "user"
  );

  // Build array of messages to insert (in order: reranking request, reranking result, knowledge injection)
  const messagesToInsert: typeof convertedMessages = [];
  if (rerankingRequestMessage) {
    messagesToInsert.push(rerankingRequestMessage);
  }
  if (rerankingResultMessage) {
    messagesToInsert.push(rerankingResultMessage);
  }
  if (knowledgeInjectionMessage) {
    messagesToInsert.push(knowledgeInjectionMessage);
  }

  if (messagesToInsert.length > 0) {
    if (userMessageIndex === -1) {
      // No user message found, prepend all messages
      updatedConvertedMessages = [...messagesToInsert, ...convertedMessagesWithTimestamps];
    } else {
      // Insert before first user message
      updatedConvertedMessages = [...convertedMessagesWithTimestamps];
      updatedConvertedMessages.splice(userMessageIndex, 0, ...messagesToInsert);
    }
  }

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
  for (const msg of modelMessagesWithKnowledge) {
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
    modelMessagesWithKnowledge,
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
    uiMessage: uiMessageWithTimestamps,
    convertedMessages: updatedConvertedMessages,
    modelMessages: modelMessagesWithKnowledge,
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
