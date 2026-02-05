import { badRequest } from "@hapi/boom";
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

import { getWorkspaceApiKey } from "./agent-keys";
import { createAgentModel } from "./agent-model";
import { setupAgentConfigTools } from "./agentConfigTools";
import { MODEL_NAME , validateWorkspaceAndAgent } from "./agentUtils";
import { validateAndReserveCredits } from "./generationCreditManagement";
import { validateSubscriptionAndLimits } from "./generationRequestTracking";
import { createLlmObserver, type LlmObserver } from "./llmObserver";
import { getDefaultModel } from "./modelFactory";
import { streamRequestSchema } from "./schemas/requestSchemas";
import type { EndpointType } from "./streamEndpointDetection";
import { WORKSPACE_AGENT_ID } from "./streamEndpointDetection";
import type { PathParameters } from "./streamPathExtraction";
import { setupWorkspaceAgentAndTools } from "./workspaceAgentTools";

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
  llmObserver: LlmObserver;
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
  conversationId?: string,
  llmObserver?: LlmObserver
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
      llmObserver,
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
    // Check ALL messages, not just the first one, since the first message might be
    // an assistant message from a previous turn, and the new user message with files
    // might be later in the array
    const hasAnyMessageWithParts = messages.some(
      (msg) =>
        msg &&
        typeof msg === "object" &&
        "parts" in msg &&
        Array.isArray(msg.parts) &&
        msg.parts.length > 0
    );

    // Log for debugging file attachment issues
    if (hasAnyMessageWithParts) {
      console.log("[Stream Handler] Detected AI SDK format with parts:", {
        messageCount: messages.length,
        messagesWithParts: messages
          .map((msg, idx) => ({
            index: idx,
            role: msg?.role,
            hasParts: !!(
              msg &&
              typeof msg === "object" &&
              "parts" in msg &&
              Array.isArray(msg.parts)
            ),
            partsCount:
              msg &&
              typeof msg === "object" &&
              "parts" in msg &&
              Array.isArray(msg.parts)
                ? msg.parts.length
                : 0,
          }))
          .filter((m) => m.hasParts),
      });
    }

    // Convert all messages from AI SDK format to our format if needed
    let convertedMessages: UIMessage[] = messages;
    if (hasAnyMessageWithParts) {
      convertedMessages = convertAiSdkUIMessagesToUIMessages(messages);

      // Log converted messages to verify file parts are preserved
      const convertedMessagesWithFiles = convertedMessages.filter(
        (msg) =>
          msg.role === "user" &&
          Array.isArray(msg.content) &&
          msg.content.some(
            (part) =>
              part &&
              typeof part === "object" &&
              "type" in part &&
              part.type === "file"
          )
      );
      if (convertedMessagesWithFiles.length > 0) {
        console.log("[Stream Handler] Converted messages with file parts:", {
          count: convertedMessagesWithFiles.length,
          files: convertedMessagesWithFiles.map((msg) => ({
            role: msg.role,
            fileParts: Array.isArray(msg.content)
              ? msg.content.filter(
                  (part) =>
                    part &&
                    typeof part === "object" &&
                    "type" in part &&
                    part.type === "file"
                )
              : [],
          })),
        });
      }
    }

    // Validate file parts contain URLs, not base64/data URLs
    for (const msg of convertedMessages) {
      if (msg.role === "user" && Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part && typeof part === "object" && "type" in part) {
            const partType = part.type;
            // Validate file type
            if (partType === "file" && "file" in part) {
              const filePart = part as { type: "file"; file: unknown };
              const fileUrl = filePart.file;
              if (typeof fileUrl === "string") {
                // Reject base64/data URLs
                if (
                  fileUrl.startsWith("data:") ||
                  fileUrl.startsWith("data;")
                ) {
                  throw badRequest(
                    "Inline file data (base64/data URLs) is not allowed. Files must be uploaded to S3 first."
                  );
                }
                // Ensure it's a valid URL
                if (
                  !fileUrl.startsWith("http://") &&
                  !fileUrl.startsWith("https://")
                ) {
                  throw badRequest("File URL must be a valid HTTP/HTTPS URL");
                }
              }
            }
            // Validate image type (schema also allows type: "image" with "image" property)
            else if ("image" in part && typeof part.image === "string") {
              const imagePart = part as { type: string; image: string };
              const imageUrl = imagePart.image;
              // Reject base64/data URLs
              if (
                imageUrl.startsWith("data:") ||
                imageUrl.startsWith("data;")
              ) {
                throw badRequest(
                  "Inline image data (base64/data URLs) is not allowed. Images must be uploaded to S3 first."
                );
              }
              // Ensure it's a valid URL
              if (
                !imageUrl.startsWith("http://") &&
                !imageUrl.startsWith("https://")
              ) {
                throw badRequest("Image URL must be a valid HTTP/HTTPS URL");
              }
            }
          }
        }
      }
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
      // Always use our own converter which properly handles file parts
      // Even if messages come in AI SDK format with 'parts', we convert them to our format first
      // then use our converter which we know handles file parts correctly
      // The AI SDK's convertToModelMessages might not preserve image parts from conversation history
      modelMessages = convertUIMessagesToModelMessages(convertedMessages);

      // Log to verify file parts are in model messages
      const modelMessagesWithFiles = modelMessages.filter(
        (msg) =>
          msg.role === "user" &&
          Array.isArray(msg.content) &&
          msg.content.some(
            (part: unknown) =>
              part &&
              typeof part === "object" &&
              "type" in part &&
              (part.type === "image" || part.type === "file")
          )
      );
      if (modelMessagesWithFiles.length > 0) {
        console.log("[Stream Handler] Model messages with file parts:", {
          count: modelMessagesWithFiles.length,
          messageIndices: modelMessages
            .map((msg, idx) => ({
              index: idx,
              role: msg.role,
              hasFiles:
                msg.role === "user" &&
                Array.isArray(msg.content) &&
                msg.content.some(
                  (part: unknown) =>
                    part &&
                    typeof part === "object" &&
                    "type" in part &&
                    (part.type === "image" || part.type === "file")
                ),
            }))
            .filter((m) => m.hasFiles),
        });
      } else if (hasAnyMessageWithParts) {
        // Log if we had parts but they didn't make it to model messages
        console.warn(
          "[Stream Handler] Had parts in request but no file parts in model messages:",
          {
            convertedMessagesWithFiles: convertedMessages.filter(
              (msg) =>
                msg.role === "user" &&
                Array.isArray(msg.content) &&
                msg.content.some(
                  (part) =>
                    part &&
                    typeof part === "object" &&
                    "type" in part &&
                    part.type === "file"
                )
            ).length,
            modelMessageCount: modelMessages.length,
            convertedMessageCount: convertedMessages.length,
          }
        );
      }
    } catch (error) {
      console.error("[Stream Handler] Error converting messages:", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        hasAnyMessageWithParts,
        messageCount: messages.length,
        firstMessageKeys:
          messages[0] && typeof messages[0] === "object"
            ? Object.keys(messages[0])
            : "N/A",
        messagesWithParts: messages
          .map((msg, idx) => ({
            index: idx,
            role: msg?.role,
            hasParts: !!(msg && typeof msg === "object" && "parts" in msg),
          }))
          .filter((m) => m.hasParts),
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

const requireConversationId = (
  event: LambdaUrlEvent | APIGatewayProxyEventV2
): string => {
  const conversationId =
    event.headers["x-conversation-id"] || event.headers["X-Conversation-Id"];
  if (!conversationId || typeof conversationId !== "string") {
    throw badRequest("X-Conversation-Id header is required");
  }
  return conversationId;
};

const resolveCorsOrigins = async (
  workspaceId: string,
  agentId: string,
  endpointType: EndpointType,
  event: LambdaUrlEvent | APIGatewayProxyEventV2
): Promise<{ allowedOrigins: string[] | null; origin: string | undefined }> => {
  const allowedOrigins =
    endpointType === "stream" ? await getAllowedOrigins(workspaceId, agentId) : null;
  const origin = event.headers["origin"] || event.headers["Origin"];
  return { allowedOrigins, origin };
};

const requireLambdaContext = (
  event: LambdaUrlEvent | APIGatewayProxyEventV2
) => {
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

  return { awsRequestId, lambdaContext };
};

const logBodyPartsPreview = (bodyText: string) => {
  try {
    const bodyPreview =
      bodyText.length > 1000 ? bodyText.substring(0, 1000) + "..." : bodyText;
    const parsedBody = JSON.parse(bodyText);
    const hasPartsInBody = Array.isArray(parsedBody)
      ? parsedBody.some(
          (msg: unknown) =>
            msg &&
            typeof msg === "object" &&
            "parts" in msg &&
            Array.isArray(msg.parts) &&
            msg.parts.length > 0
        )
      : parsedBody &&
        typeof parsedBody === "object" &&
        "messages" in parsedBody &&
        Array.isArray(parsedBody.messages) &&
        parsedBody.messages.some(
          (msg: unknown) =>
            msg &&
            typeof msg === "object" &&
            "parts" in msg &&
            Array.isArray(msg.parts) &&
            msg.parts.length > 0
        );

    if (hasPartsInBody) {
      console.log("[Stream Handler] Request body contains parts:", {
        bodyPreview,
        isArray: Array.isArray(parsedBody),
        messageCount: Array.isArray(parsedBody)
          ? parsedBody.length
          : parsedBody?.messages?.length || 0,
      });
    }
  } catch {
    // Ignore parsing errors for logging
  }
};

const addMessageTimestamps = (params: {
  uiMessage: UIMessage;
  convertedMessages: UIMessage[];
}) => {
  const now = new Date().toISOString();
  const convertedMessagesWithTimestamps = params.convertedMessages.map((msg) => {
    if (msg.role === "user" && !msg.generationStartedAt) {
      return {
        ...msg,
        generationStartedAt: now,
        generationEndedAt: now,
      };
    }
    if (msg.role === "system" && !msg.generationStartedAt) {
      return {
        ...msg,
        generationStartedAt: now,
        generationEndedAt: now,
      };
    }
    return msg;
  });

  const uiMessageWithTimestamps =
    params.uiMessage.role === "user" && !params.uiMessage.generationStartedAt
      ? {
          ...params.uiMessage,
          generationStartedAt: now,
          generationEndedAt: now,
        }
      : params.uiMessage;

  return { convertedMessagesWithTimestamps, uiMessageWithTimestamps };
};

const fetchExistingConversationMessages = async (params: {
  db: Awaited<ReturnType<typeof database>>;
  workspaceId: string;
  agentId: string;
  conversationId: string;
}): Promise<UIMessage[] | undefined> => {
  try {
    const conversationPk = `conversations/${params.workspaceId}/${params.agentId}/${params.conversationId}`;
    const existingConversation = await params.db["agent-conversations"].get(
      conversationPk
    );
    if (existingConversation && existingConversation.messages) {
      return existingConversation.messages as UIMessage[];
    }
  } catch (error) {
    console.log(
      "[buildStreamRequestContext] Could not fetch existing conversation messages:",
      error instanceof Error ? error.message : String(error)
    );
  }
  return undefined;
};

const buildInsertionMessages = (params: {
  rerankingRequestMessage?: UIMessage;
  rerankingResultMessage?: UIMessage;
  knowledgeInjectionMessage?: UIMessage | null;
}): UIMessage[] => {
  const messagesToInsert: UIMessage[] = [];
  if (params.rerankingRequestMessage) {
    messagesToInsert.push(params.rerankingRequestMessage);
  }
  if (params.rerankingResultMessage) {
    messagesToInsert.push(params.rerankingResultMessage);
  }
  if (params.knowledgeInjectionMessage) {
    messagesToInsert.push(params.knowledgeInjectionMessage);
  }
  return messagesToInsert;
};

const insertMessagesBeforeFirstUser = (
  convertedMessages: UIMessage[],
  messagesToInsert: UIMessage[]
): UIMessage[] => {
  if (messagesToInsert.length === 0) {
    return convertedMessages;
  }
  const userMessageIndex = convertedMessages.findIndex(
    (msg) => msg.role === "user"
  );
  if (userMessageIndex === -1) {
    return [...messagesToInsert, ...convertedMessages];
  }
  const updatedConvertedMessages = [...convertedMessages];
  updatedConvertedMessages.splice(userMessageIndex, 0, ...messagesToInsert);
  return updatedConvertedMessages;
};

const logClientToolResults = (
  agent: Awaited<ReturnType<typeof setupAgentAndTools>>["agent"],
  modelMessages: ModelMessage[]
) => {
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
};

/**
 * Builds the complete request context for processing the stream
 */
export async function buildStreamRequestContext(
  event: LambdaUrlEvent | APIGatewayProxyEventV2,
  pathParams: PathParameters,
  authResult: { authenticated: boolean; userId?: string }
): Promise<StreamRequestContext> {
  const { workspaceId, agentId, secret, endpointType } = pathParams;

  const conversationId = requireConversationId(event);
  const { allowedOrigins, origin } = await resolveCorsOrigins(
    workspaceId,
    agentId,
    endpointType,
    event
  );

  // Validate subscription and limits
  const subscriptionId = await validateSubscriptionAndLimitsStream(
    workspaceId,
    endpointType
  );

  // Setup database connection
  const db = await database();

  const { awsRequestId, lambdaContext } = requireLambdaContext(event);

  // Setup agent context
  const modelReferer = "https://app.helpmaton.com";
  const llmObserver = createLlmObserver();

  let agent: Awaited<ReturnType<typeof setupAgentAndTools>>["agent"];
  let model: Awaited<ReturnType<typeof setupAgentAndTools>>["model"];
  let tools: Awaited<ReturnType<typeof setupAgentAndTools>>["tools"];
  let usesByok: boolean;

  if (agentId === WORKSPACE_AGENT_ID) {
    const workspaceSetup = await setupWorkspaceAgentAndTools(workspaceId, {
      modelReferer,
      userId: authResult.userId,
      context: lambdaContext,
      conversationId,
      llmObserver,
    });
    agent = workspaceSetup.agent as Awaited<
      ReturnType<typeof setupAgentAndTools>
    >["agent"];
    model = workspaceSetup.model;
    tools = workspaceSetup.tools;
    usesByok = workspaceSetup.usesByok;
  } else if (endpointType === "config-test") {
    if (agentId === WORKSPACE_AGENT_ID || agentId === "workspace") {
      throw badRequest(
        "Cannot use config-test for the workspace agent; use the workspace agent chat or a specific agent ID."
      );
    }
    const { agent: loadedAgent } = await validateWorkspaceAndAgent(
      workspaceId,
      agentId
    );
    const workspaceApiKey = await getWorkspaceApiKey(workspaceId, "openrouter");
    usesByok = workspaceApiKey !== null;
    const configSetup = setupAgentConfigTools(
      workspaceId,
      agentId,
      loadedAgent as Parameters<typeof setupAgentConfigTools>[2],
      { llmObserver, userId: authResult.userId }
    );
    const modelName =
      typeof loadedAgent.modelName === "string"
        ? loadedAgent.modelName
        : undefined;
    const resolvedModelName = modelName || getDefaultModel();
    model = await createAgentModel(
      modelReferer,
      workspaceApiKey ?? undefined,
      resolvedModelName,
      workspaceId,
      agentId,
      usesByok,
      authResult.userId,
      "openrouter",
      {
        temperature: loadedAgent.temperature,
        topP: loadedAgent.topP,
        topK: loadedAgent.topK,
        maxOutputTokens: loadedAgent.maxOutputTokens,
        stopSequences: loadedAgent.stopSequences,
      },
      llmObserver
    );
    tools = configSetup.tools;
    agent = {
      ...loadedAgent,
      systemPrompt: configSetup.systemPrompt,
      enableKnowledgeInjection: false,
      enableKnowledgeReranking: false,
    } as Awaited<ReturnType<typeof setupAgentAndTools>>["agent"];
  } else {
    const normalSetup = await setupAgentContext(
      workspaceId,
      agentId,
      modelReferer,
      lambdaContext,
      conversationId,
      llmObserver
    );
    agent = normalSetup.agent;
    model = normalSetup.model;
    tools = normalSetup.tools;
    usesByok = normalSetup.usesByok;
  }

  // Extract and convert request body
  const bodyText = extractRequestBody(event);
  if (!bodyText) {
    throw new Error("Request body is required");
  }

  // Log raw request body for debugging file attachment issues (only first 1000 chars to avoid log spam)
  logBodyPartsPreview(bodyText);

  const { uiMessage, modelMessages, convertedMessages } =
    await convertRequestBodyToMessages(bodyText);

  const { convertedMessagesWithTimestamps, uiMessageWithTimestamps } =
    addMessageTimestamps({ uiMessage, convertedMessages });

  // Fetch existing conversation messages to check for existing knowledge injection
  const existingConversationMessages = await fetchExistingConversationMessages({
    db,
    workspaceId,
    agentId,
    conversationId,
  });

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

  const messagesToInsert = buildInsertionMessages({
    rerankingRequestMessage,
    rerankingResultMessage,
    knowledgeInjectionMessage,
  });
  const updatedConvertedMessages = insertMessagesBeforeFirstUser(
    convertedMessagesWithTimestamps,
    messagesToInsert
  );

  llmObserver.recordInputMessages(updatedConvertedMessages);

  // Derive the model name from the agent's modelName if set, otherwise use default
  const finalModelName =
    typeof agent.modelName === "string" ? agent.modelName : MODEL_NAME;

  logClientToolResults(agent, modelMessagesWithKnowledge);

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
    llmObserver,
    usesByok,
    reservationId,
    finalModelName,
    awsRequestId,
    userId: authResult.userId,
  };
}
