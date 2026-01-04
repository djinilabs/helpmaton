import { randomUUID } from "crypto";

import { queues } from "@architect/functions";
import { resourceGone } from "@hapi/boom";
import type { ModelMessage } from "ai";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import { extractTokenUsage, trackDelegation } from "../../utils/conversationLogger";
import {
  adjustCreditReservation,
  refundReservation,
} from "../../utils/creditManagement";
import { validateCreditsAndLimitsAndReserve } from "../../utils/creditValidation";
import { searchDocuments } from "../../utils/documentSearch";
import { isCreditDeductionEnabled } from "../../utils/featureFlags";
import { sendNotification } from "../../utils/notifications";
import { Sentry, ensureError } from "../../utils/sentry";
import { extractTokenUsageAndCosts } from "../utils/generationTokenExtraction";

import { createMcpServerTools } from "./mcpUtils";
import { createModel } from "./modelFactory";
import type { Provider } from "./modelFactory";

export const MODEL_NAME = "google/gemini-2.5-flash";

/**
 * Cache for agent metadata to avoid repeated database queries
 * Key: `${workspaceId}:${agentId}`, Value: { agent, timestamp }
 * TTL: 5 minutes
 */
type CachedAgent = {
  pk: string;
  name: string;
  systemPrompt: string;
  modelName?: string;
  provider?: string;
  enableSearchDocuments?: boolean;
  enableMemorySearch?: boolean;
  searchWebProvider?: "tavily" | "jina" | null;
  fetchWebProvider?: "tavily" | "jina" | "scrape" | null;
  enableSendEmail?: boolean;
  notificationChannelId?: string;
  enabledMcpServerIds?: string[];
  clientTools?: Array<{ name: string }>;
  [key: string]: unknown;
};

const agentMetadataCache = new Map<
  string,
  { agent: CachedAgent; timestamp: number }
>();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // Clean up at most once per minute to avoid excessive cleanup

// Track last cleanup time to throttle cleanup frequency
let lastCleanupTimestamp = 0;
// Track periodic cleanup interval handle for singleton pattern
let periodicCleanupInterval: NodeJS.Timeout | undefined;

/**
 * Clean up expired cache entries
 * This prevents memory leaks in high-traffic scenarios
 * Always removes expired entries regardless of cache size
 */
function cleanupExpiredCacheEntries(force: boolean = false): void {
  const now = Date.now();

  // Throttle cleanup: only run if forced, cache is large, or enough time has passed
  // This prevents excessive cleanup on every set operation while ensuring expired entries are removed
  if (
    !force &&
    agentMetadataCache.size < 50 &&
    now - lastCleanupTimestamp < CLEANUP_INTERVAL_MS
  ) {
    return; // Skip cleanup if cache is small and cleanup ran recently
  }

  let cleaned = 0;
  for (const [key, cached] of agentMetadataCache.entries()) {
    if (now - cached.timestamp >= CACHE_TTL_MS) {
      agentMetadataCache.delete(key);
      cleaned++;
    }
  }

  lastCleanupTimestamp = now;

  if (cleaned > 0) {
    console.log(
      `[Agent Cache] Cleaned up ${cleaned} expired entries (cache size: ${agentMetadataCache.size})`
    );
  }
}

/**
 * Initialize periodic cleanup to catch expired entries even when cache operations are infrequent
 * Uses singleton pattern to avoid creating multiple intervals
 */
function initializePeriodicCleanup(): void {
  // Only create interval if it doesn't exist (singleton pattern)
  if (periodicCleanupInterval !== undefined) {
    return;
  }

  // Run cleanup every TTL period to ensure expired entries are removed
  periodicCleanupInterval = setInterval(() => {
    cleanupExpiredCacheEntries(true); // Force cleanup on periodic runs
  }, CACHE_TTL_MS);

  // Clear interval on process exit (though Lambda handles this automatically)
  if (typeof process !== "undefined" && process.on) {
    process.on("SIGTERM", () => {
      if (periodicCleanupInterval) {
        clearInterval(periodicCleanupInterval);
        periodicCleanupInterval = undefined;
      }
    });
  }
}

function getCachedAgent(
  workspaceId: string,
  agentId: string
): CachedAgent | null {
  const key = `${workspaceId}:${agentId}`;
  const cached = agentMetadataCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.agent;
  }
  // Remove expired entry
  if (cached) {
    agentMetadataCache.delete(key);
  }
  return null;
}

function setCachedAgent(
  workspaceId: string,
  agentId: string,
  agent: CachedAgent
): void {
  const key = `${workspaceId}:${agentId}`;
  agentMetadataCache.set(key, { agent, timestamp: Date.now() });
  // Initialize periodic cleanup on first cache write
  initializePeriodicCleanup();
  // Clean up expired entries to prevent memory leaks (throttled to avoid excessive cleanup)
  cleanupExpiredCacheEntries();
}

export interface WorkspaceAndAgent {
  workspace: {
    pk: string;
    [key: string]: unknown;
  };
  agent: {
    pk: string;
    systemPrompt: string;
    notificationChannelId?: string;
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    maxToolRoundtrips?: number;
    [key: string]: unknown;
  };
}

/**
 * Get workspace API key if it exists for OpenRouter
 * Only OpenRouter keys are supported for BYOK (Bring Your Own Key)
 * BYOK is only available for paid plans (Starter and Pro)
 */
export async function getWorkspaceApiKey(
  workspaceId: string,
  provider: Provider = "openrouter"
): Promise<string | null> {
  // Only check for OpenRouter keys
  if (provider !== "openrouter") {
    return null;
  }

  const db = await database();
  const sk = "key";
  const pk = `workspace-api-keys/${workspaceId}/openrouter`;

  try {
    const workspaceKey = await db["workspace-api-key"].get(pk, sk);
    if (workspaceKey?.key) {
      // Check subscription plan - BYOK is only available for paid plans
      const { getWorkspaceSubscription } = await import(
        "../../utils/subscriptionUtils"
      );
      const subscription = await getWorkspaceSubscription(workspaceId);
      if (!subscription || subscription.plan === "free") {
        // Return null for free plans even if key exists
        return null;
      }
      return workspaceKey.key;
    }
  } catch {
    // Key doesn't exist
  }

  return null;
}

/**
 * Create an AI model instance (OpenRouter by default, Google for backward compatibility)
 */
export async function createAgentModel(
  referer: string = "http://localhost:3000/api/webhook",
  apiKey?: string,
  modelName?: string,
  workspaceId?: string,
  agentId?: string,
  usesByok?: boolean,
  userId?: string,
  provider: Provider = "openrouter"
) {
  // Use provided modelName or fall back to default MODEL_NAME
  const finalModelName = modelName || MODEL_NAME;

  // Use createModel from modelFactory which handles OpenRouter and Google
  return createModel(provider, finalModelName, workspaceId, referer, userId);
}

/**
 * Build generateText options from agent configuration
 */
export function buildGenerateTextOptions(agent: {
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
  maxOutputTokens?: number | null;
  stopSequences?: string[] | null;
  maxToolRoundtrips?: number | null;
  [key: string]: unknown;
}) {
  const options: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxTokens?: number;
    stopSequences?: string[];
    stopWhen?: ReturnType<typeof stepCountIs>;
  } = {};

  // Handle null/undefined values - only use defined, non-null values
  if (agent.temperature !== undefined && agent.temperature !== null) {
    options.temperature = agent.temperature;
  }
  if (agent.topP !== undefined && agent.topP !== null) {
    options.topP = agent.topP;
  }
  if (agent.topK !== undefined && agent.topK !== null) {
    options.topK = agent.topK;
  }
  if (agent.maxOutputTokens !== undefined && agent.maxOutputTokens !== null) {
    options.maxTokens = agent.maxOutputTokens;
  }
  if (
    agent.stopSequences !== undefined &&
    agent.stopSequences !== null &&
    agent.stopSequences.length > 0
  ) {
    options.stopSequences = agent.stopSequences;
  }
  if (
    agent.maxToolRoundtrips !== undefined &&
    agent.maxToolRoundtrips !== null
  ) {
    options.stopWhen = stepCountIs(agent.maxToolRoundtrips);
  } else {
    options.stopWhen = stepCountIs(5); // Default
  }

  // Log all model parameters before execution
  const maxToolRoundtrips = agent.maxToolRoundtrips ?? 5;
  console.log("[Model Configuration] Generated options:", {
    temperature: options.temperature ?? "default",
    topP: options.topP ?? "default",
    topK: options.topK ?? "default",
    maxTokens: options.maxTokens ?? "default",
    stopSequences: options.stopSequences ?? "none",
    maxToolRoundtrips,
    stopWhen: `stepCountIs(${maxToolRoundtrips})`,
    agentConfig: {
      temperature: agent.temperature,
      topP: agent.topP,
      topK: agent.topK,
      maxOutputTokens: agent.maxOutputTokens,
      stopSequences: agent.stopSequences,
      maxToolRoundtrips: agent.maxToolRoundtrips,
    },
  });

  return options;
}

/**
 * Validate that a workspace and agent exist and belong together
 */
export async function validateWorkspaceAndAgent(
  workspaceId: string,
  agentId: string
): Promise<WorkspaceAndAgent> {
  const db = await database();

  // Validate workspace exists
  const workspacePk = `workspaces/${workspaceId}`;
  const workspace = await db.workspace.get(workspacePk, "workspace");
  if (!workspace) {
    throw resourceGone("Workspace not found");
  }

  // Validate agent exists and belongs to workspace
  const agentPk = `agents/${workspaceId}/${agentId}`;
  const agent = await db.agent.get(agentPk, "agent");
  if (!agent) {
    throw resourceGone("Agent not found");
  }

  return { workspace, agent };
}

/**
 * Create the search_documents tool with customizable options
 */
export function createSearchDocumentsTool(
  workspaceId: string,
  options?: {
    description?: string;
    queryDescription?: string;
    formatResults?: (
      results: Array<{
        snippet: string;
        documentName: string;
        documentId: string;
        folderPath: string;
        similarity: number;
      }>
    ) => string;
    messages?: unknown[];
  }
) {
  const searchDocumentsParamsSchema = z.object({
    query: z
      .string()
      .min(1, "Query parameter is required and cannot be empty")
      .describe(
        options?.queryDescription ||
          "MANDATORY: The search terms to look for in the documents. Extract this directly from the user's request. If user says 'search for X', use query='X'. If user says 'find Y', use query='Y'. Always use the exact terms or keywords the user mentioned. This parameter is REQUIRED - you must always provide it when calling this tool."
      ),
    topN: z
      .number()
      .optional()
      .default(5)
      .describe("Number of top results to return (default: 5)"),
  });

  type SearchDocumentsArgs = z.infer<typeof searchDocumentsParamsSchema>;

  const defaultDescription =
    "Search workspace documents using semantic vector search. YOU MUST ALWAYS provide a 'query' parameter with the search terms. When the user asks to search for something, extract the search terms from their message and pass them as the 'query' parameter. Example: User says 'search for helpmaton' → call with {query: 'helpmaton'}. User says 'find information about scheduling' → call with {query: 'scheduling'}. User says 'look up API documentation' → call with {query: 'API documentation'}. The query parameter is MANDATORY and must contain the search terms the user wants to find.";

  const defaultFormatResults = (
    results: Array<{
      snippet: string;
      documentName: string;
      documentId: string;
      folderPath: string;
      similarity: number;
    }>
  ) => {
    return results.map((result) => result.snippet).join("\n\n---\n\n");
  };

  const formatResults = options?.formatResults || defaultFormatResults;

  return tool({
    description: options?.description || defaultDescription,
    parameters: searchDocumentsParamsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      const typedArgs = args as SearchDocumentsArgs;
      let query: string | undefined = typedArgs.query;
      const topN = typedArgs.topN ?? 5;

      // Log tool call with arguments
      console.log("[Tool Call] search_documents", {
        toolName: "search_documents",
        arguments: { query: typedArgs.query, topN: typedArgs.topN },
        workspaceId,
      });

      // Validate query
      if (!query || typeof query !== "string" || query.trim().length === 0) {
        // Try to extract query from the last user message as a fallback
        if (
          options?.messages &&
          Array.isArray(options.messages) &&
          options.messages.length > 0
        ) {
          const lastMessage = options.messages[options.messages.length - 1];
          if (lastMessage) {
            const messageText =
              typeof lastMessage === "object" && "content" in lastMessage
                ? String(lastMessage.content)
                : typeof lastMessage === "string"
                ? lastMessage
                : "";

            if (messageText) {
              // Try to extract search terms from the message
              const searchMatch = messageText.match(
                /(?:search|find|look).*?(?:for|about)\s+(.+?)(?:\s|$|and|tell)/i
              );
              if (searchMatch && searchMatch[1]) {
                query = searchMatch[1].trim();
              } else {
                // Try to get the main topic from the message
                const words = messageText
                  .split(/\s+/)
                  .filter((w) => w.length > 3);
                if (words.length > 0) {
                  query = words.slice(0, 3).join(" ");
                }
              }
            }
          }
        }

        // If still no query, return error
        if (!query || query.trim().length === 0) {
          return `Error: The search_documents tool requires a 'query' parameter with the search terms. Please call this tool with query='<search terms>' where <search terms> are the keywords you want to search for. For example, if the user asks to "search for timeclout", use query='timeclout'.`;
        }
      }

      try {
        const results = await searchDocuments(workspaceId, query, topN);

        let result: string;
        if (results.length === 0) {
          result = "No relevant documents found for the query.";
        } else {
          const formattedResults = formatResults(results);
          result = `Found ${results.length} relevant document snippet(s):\n\n${formattedResults}`;
        }

        // Log tool result
        console.log("[Tool Result] search_documents", {
          toolName: "search_documents",
          result,
          resultLength: result.length,
        });

        return result;
      } catch (error) {
        const errorMessage = `Error searching documents: ${
          error instanceof Error ? error.message : String(error)
        }`;
        console.error("[Tool Error] search_documents", {
          toolName: "search_documents",
          error: error instanceof Error ? error.message : String(error),
          arguments: { query: typedArgs.query, topN: typedArgs.topN },
        });
        return errorMessage;
      }
    },
  });
}

/**
 * Create the send_notification tool for sending notifications to configured channels
 */
export function createSendNotificationTool(
  workspaceId: string,
  channelId: string
) {
  const sendNotificationParamsSchema = z.object({
    content: z
      .string()
      .min(1, "Content parameter is required and cannot be empty")
      .describe(
        "REQUIRED: The notification message text to send. This MUST be a non-empty string containing the actual message content. This is the ONLY parameter required. The channel is pre-configured - you do NOT need and CANNOT provide a channel ID. Just put the message text here. Example: If user wants to send 'hello world', use content='hello world'. The message will be sent to the pre-configured channel automatically. NEVER call this tool with an empty string or without the content parameter."
      ),
  });

  type SendNotificationArgs = z.infer<typeof sendNotificationParamsSchema>;

  const description =
    "Send a notification message to the pre-configured channel. CRITICAL REQUIREMENTS: (1) The notification channel is already pre-configured - you NEVER need to ask the user for a channel ID or channel name. (2) You MUST provide a 'content' parameter with a non-empty string containing the actual message text. (3) Do NOT call this tool if the user hasn't specified what message to send - ask them what message they want to send first. (4) Do NOT ask the user for any channel information. When the user asks you to send a notification or message, IMMEDIATELY call this tool with the 'content' parameter containing the message text. Example: If user says 'send hello world', immediately call send_notification with content='hello world'. The channel is automatically configured and you cannot change it. If the user just says 'notify' without specifying what to send, ask them what message they want to send before calling this tool.";

  return tool({
    description,
    parameters: sendNotificationParamsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      const typedArgs = args as SendNotificationArgs;
      const content = typedArgs?.content;

      // Log tool call with arguments
      console.log("[Tool Call] send_notification", {
        toolName: "send_notification",
        arguments: {
          content: content
            ? `${content.substring(0, 100)}${content.length > 100 ? "..." : ""}`
            : undefined,
        },
        workspaceId,
        channelId,
      });

      // Validate content parameter
      if (!args || typeof args !== "object") {
        console.error("[send_notification] Invalid args object:", args);
        return "Error: The send_notification tool received invalid arguments. The 'content' parameter is required and must be a non-empty string containing the notification message.";
      }

      if (!("content" in args)) {
        console.error(
          "[send_notification] Missing 'content' parameter in args:",
          args
        );
        return "Error: The send_notification tool requires a 'content' parameter with the notification message. Please provide the message text in the 'content' parameter. Example: { content: 'Your message here' }";
      }

      if (
        !content ||
        typeof content !== "string" ||
        content.trim().length === 0
      ) {
        console.error("[send_notification] Invalid or empty content:", {
          content,
          type: typeof content,
          length: typeof content === "string" ? content.length : "N/A",
        });
        return "Error: The send_notification tool requires a 'content' parameter with a non-empty string containing the notification message. The content cannot be empty. Please provide the actual message text you want to send.";
      }

      try {
        const db = await database();
        const channelPk = `output-channels/${workspaceId}/${channelId}`;
        const channel = await db["output_channel"].get(channelPk, "channel");

        if (!channel) {
          const errorMessage = `Error: Notification channel not found. The configured channel may have been deleted.`;
          console.error("[Tool Error] send_notification", {
            toolName: "send_notification",
            error: "Channel not found",
            arguments: {
              content: content
                ? `${content.substring(0, 100)}${
                    content.length > 100 ? "..." : ""
                  }`
                : undefined,
            },
          });
          return errorMessage;
        }

        await sendNotification(channel, content.trim());

        const result = `✅ Notification successfully sent to ${channel.name} (${channel.type}). The message has been delivered to the configured notification channel.`;

        // Log tool result
        console.log("[Tool Result] send_notification", {
          toolName: "send_notification",
          result,
          channelName: channel.name,
          channelType: channel.type,
        });

        return result;
      } catch (error) {
        const errorMessage = `Error sending notification: ${
          error instanceof Error ? error.message : String(error)
        }`;
        console.error("[Tool Error] send_notification", {
          toolName: "send_notification",
          error: error instanceof Error ? error.message : String(error),
          arguments: {
            content: content
              ? `${content.substring(0, 100)}${
                  content.length > 100 ? "..." : ""
                }`
              : undefined,
          },
        });
        return errorMessage;
      }
    },
  });
}

/**
 * Create the send_email tool for sending emails via workspace email connection
 */
export function createSendEmailTool(workspaceId: string) {
  const sendEmailParamsSchema = z.object({
    to: z
      .string()
      .email("to must be a valid email address")
      .describe(
        "REQUIRED: The recipient email address. This MUST be a valid email address. Example: 'user@example.com'"
      ),
    subject: z
      .string()
      .min(1, "subject is required and cannot be empty")
      .describe(
        "REQUIRED: The email subject line. This MUST be a non-empty string. Example: 'Hello from Helpmaton'"
      ),
    text: z
      .string()
      .min(1, "text is required and cannot be empty")
      .describe(
        "REQUIRED: The plain text email body. This MUST be a non-empty string containing the email message content."
      ),
    html: z
      .string()
      .optional()
      .describe(
        "OPTIONAL: The HTML email body. If provided, this will be used instead of the plain text version for email clients that support HTML."
      ),
    from: z
      .string()
      .email("from must be a valid email address")
      .optional()
      .describe(
        "OPTIONAL: The sender email address. If not provided, the email connection's default sender will be used."
      ),
  });

  type SendEmailArgs = z.infer<typeof sendEmailParamsSchema>;

  const description =
    "Send an email message via the workspace's email connection. CRITICAL REQUIREMENTS: (1) The email connection is already pre-configured for the workspace - you NEVER need to ask the user for connection details. (2) You MUST provide 'to', 'subject', and 'text' parameters. (3) The 'to' parameter must be a valid email address. (4) The 'subject' and 'text' parameters must be non-empty strings. (5) When the user asks you to send an email, IMMEDIATELY call this tool with the required parameters. Example: If user says 'send an email to john@example.com with subject Hello and body Hi there', call send_email with {to: 'john@example.com', subject: 'Hello', text: 'Hi there'}. Do NOT ask the user for email connection information - it's already configured.";

  return tool({
    description,
    parameters: sendEmailParamsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      const typedArgs = args as SendEmailArgs;
      const { to, subject, text, html, from } = typedArgs;

      // Log tool call with arguments
      console.log("[Tool Call] send_email", {
        toolName: "send_email",
        arguments: {
          to,
          subject: `${subject.substring(0, 50)}${
            subject.length > 50 ? "..." : ""
          }`,
          text: `${text.substring(0, 100)}${text.length > 100 ? "..." : ""}`,
          hasHtml: !!html,
          from,
        },
        workspaceId,
      });

      try {
        const { sendEmailViaConnection } = await import("../../utils/email");
        await sendEmailViaConnection(workspaceId, {
          to: to.trim(),
          subject: subject.trim(),
          text: text.trim(),
          html: html?.trim(),
          from: from?.trim(),
        });

        const result = `✅ Email successfully sent to ${to}. The email has been delivered via the workspace's email connection.`;

        // Log tool result
        console.log("[Tool Result] send_email", {
          toolName: "send_email",
          result,
          to,
        });

        return result;
      } catch (error) {
        const errorMessage = `Error sending email: ${
          error instanceof Error ? error.message : String(error)
        }`;
        console.error("[Tool Error] send_email", {
          toolName: "send_email",
          error: error instanceof Error ? error.message : String(error),
          arguments: {
            to,
            subject: `${subject.substring(0, 50)}${
              subject.length > 50 ? "..." : ""
            }`,
          },
        });
        return errorMessage;
      }
    },
  });
}

/**
 * Internal function to call an agent with a message
 * Used for agent delegation
 * Exported for use in queue processors
 */
export async function callAgentInternal(
  workspaceId: string,
  targetAgentId: string,
  message: string,
  callDepth: number,
  maxDepth: number,
  context?: Awaited<
    ReturnType<
      typeof import("../../utils/workspaceCreditContext").getContextFromRequestId
    >
  >,
  timeoutMs: number = 60000 // Default 60 seconds
): Promise<string> {
  // Check depth limit
  if (callDepth >= maxDepth) {
    return `Error: Maximum delegation depth (${maxDepth}) reached. Cannot delegate further.`;
  }

  const db = await database();

  // Validate and get target agent
  const targetAgentPk = `agents/${workspaceId}/${targetAgentId}`;
  const targetAgent = await db.agent.get(targetAgentPk, "agent");
  if (!targetAgent) {
    return `Error: Target agent ${targetAgentId} not found.`;
  }

  if (targetAgent.workspaceId !== workspaceId) {
    return `Error: Target agent ${targetAgentId} does not belong to this workspace.`;
  }

  // Get workspace API key if it exists (OpenRouter provider)
  const agentProvider: Provider = "openrouter";
  const workspaceApiKey = await getWorkspaceApiKey(workspaceId, agentProvider);
  const usesByok = workspaceApiKey !== null;

  // Use target agent's modelName if set, otherwise use default
  const modelName =
    typeof targetAgent.modelName === "string"
      ? targetAgent.modelName
      : undefined;

  // Create model
  const model = await createAgentModel(
    "http://localhost:3000/api/agent-delegation",
    workspaceApiKey || undefined,
    modelName,
    workspaceId,
    targetAgentId,
    usesByok,
    undefined, // userId
    agentProvider
  );

  // Extract agentId from targetAgent.pk (format: "agents/{workspaceId}/{agentId}")
  const extractedTargetAgentId = targetAgent.pk.replace(
    `agents/${workspaceId}/`,
    ""
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tools have varying types
  const tools: Record<string, any> = {};

  // Add document search tool if enabled
  if (targetAgent.enableSearchDocuments === true) {
    const searchDocumentsTool = createSearchDocumentsTool(workspaceId, {
      messages: [{ role: "user", content: message }],
    });
    tools.search_documents = searchDocumentsTool;
  }

  // Add memory search tool if enabled
  if (targetAgent.enableMemorySearch === true) {
    const { createSearchMemoryTool } = await import("./memorySearchTool");
    tools.search_memory = createSearchMemoryTool(
      extractedTargetAgentId,
      workspaceId
    );
  }

  // Add web search tool if enabled (based on provider selection)
  if (targetAgent.searchWebProvider === "tavily") {
    const { createTavilySearchTool } = await import("./tavilyTools");
    tools.search_web = createTavilySearchTool(
      workspaceId,
      context,
      targetAgentId
    );
  } else if (targetAgent.searchWebProvider === "jina") {
    const { createJinaSearchTool } = await import("./tavilyTools");
    tools.search_web = createJinaSearchTool(workspaceId, targetAgentId);
  }

  // Add web fetch tool if enabled (based on provider selection)
  if (targetAgent.fetchWebProvider === "tavily") {
    const { createTavilyFetchTool } = await import("./tavilyTools");
    tools.fetch_url = createTavilyFetchTool(
      workspaceId,
      context,
      targetAgentId
    );
  } else if (targetAgent.fetchWebProvider === "jina") {
    const { createJinaFetchTool } = await import("./tavilyTools");
    tools.fetch_url = createJinaFetchTool(workspaceId, targetAgentId);
  } else if (targetAgent.fetchWebProvider === "scrape") {
    // Scrape-based fetch relies on a conversationId for authentication.
    // In the agent delegation context, conversationId is not available, so
    // the tool will return an error if called. This is intentional - scrape
    // requires conversation context for authentication. If scrape support is
    // needed for delegated agents, the authentication mechanism must be updated
    // to work without conversationId.
    // Note: Tavily and Jina fetch tools work without conversationId and are
    // available for delegated agents.
    const { createScrapeFetchTool } = await import("./tavilyTools");
    tools.fetch_url = createScrapeFetchTool(
      workspaceId,
      context,
      targetAgentId,
      undefined // conversationId not available in agent delegation context
    );
  }

  // Add Exa.ai search tool if enabled
  if (targetAgent.enableExaSearch === true) {
    const { createExaSearchTool } = await import("./exaTools");
    tools.search = createExaSearchTool(
      workspaceId,
      context,
      targetAgentId
    );
  }

  if (targetAgent.notificationChannelId) {
    tools.send_notification = createSendNotificationTool(
      workspaceId,
      targetAgent.notificationChannelId
    );
  }

  // Add email tool if enabled and workspace has email connection
  if (targetAgent.enableSendEmail === true) {
    const emailConnectionPk = `email-connections/${workspaceId}`;
    const emailConnection = await db["email-connection"].get(
      emailConnectionPk,
      "connection"
    );
    if (emailConnection) {
      tools.send_email = createSendEmailTool(workspaceId);
    }
  }

  // Add MCP server tools if target agent has enabled MCP servers
  if (
    targetAgent.enabledMcpServerIds &&
    Array.isArray(targetAgent.enabledMcpServerIds) &&
    targetAgent.enabledMcpServerIds.length > 0
  ) {
    const mcpTools = await createMcpServerTools(
      workspaceId,
      targetAgent.enabledMcpServerIds
    );
    // Merge MCP tools into tools object
    Object.assign(tools, mcpTools);
  }

  // Add client-side tools if target agent has client tools configured
  if (
    targetAgent.clientTools &&
    Array.isArray(targetAgent.clientTools) &&
    targetAgent.clientTools.length > 0
  ) {
    // Import createClientTools dynamically to avoid circular dependency
    const { createClientTools } = await import("./agentSetup");
    const clientTools = createClientTools(targetAgent.clientTools);
    // Merge client tools into tools object
    Object.assign(tools, clientTools);
  }

  // Add delegation tools if target agent has delegatable agents
  if (
    targetAgent.delegatableAgentIds &&
    Array.isArray(targetAgent.delegatableAgentIds) &&
    targetAgent.delegatableAgentIds.length > 0
  ) {
    tools.list_agents = createListAgentsTool(
      workspaceId,
      targetAgent.delegatableAgentIds
    );
    tools.call_agent = createCallAgentTool(
      workspaceId,
      targetAgent.delegatableAgentIds,
      targetAgentId,
      callDepth + 1,
      maxDepth,
      context
    );
    tools.call_agent_async = createCallAgentAsyncTool(
      workspaceId,
      targetAgent.delegatableAgentIds,
      targetAgentId,
      callDepth + 1,
      maxDepth,
      context
    );
    tools.check_delegation_status = createCheckDelegationStatusTool(workspaceId);
    tools.cancel_delegation = createCancelDelegationTool(workspaceId);
  }

  // Convert message to ModelMessage format
  const modelMessages: ModelMessage[] = [
    {
      role: "user",
      content: message,
    },
  ];

  let reservationId: string | undefined;
  let llmCallAttempted = false;
  let result: Awaited<ReturnType<typeof generateText>> | undefined;
  let tokenUsage: ReturnType<typeof extractTokenUsage> | undefined;

  try {
    // Reserve credits before LLM call
    const toolDefinitions =
      Object.keys(tools).length > 0
        ? Object.entries(tools).map(([name, tool]) => ({
            name,
            description: (tool as { description?: string }).description || "",
            parameters: (tool as { inputSchema?: unknown }).inputSchema || {},
          }))
        : undefined;

    const reservation = await validateCreditsAndLimitsAndReserve(
      db,
      workspaceId,
      targetAgentId,
      agentProvider, // provider
      modelName || MODEL_NAME,
      modelMessages,
      targetAgent.systemPrompt,
      toolDefinitions,
      false // usesByok - delegated calls use workspace API key if available
    );

    if (reservation) {
      reservationId = reservation.reservationId;
      console.log("[Agent Delegation] Credits reserved:", {
        workspaceId,
        targetAgentId,
        reservationId,
        reservedAmount: reservation.reservedAmount,
      });
    }

    // Generate response
    const generateOptions = buildGenerateTextOptions(targetAgent);
    console.log("[Agent Delegation] Executing generateText with parameters:", {
      workspaceId,
      targetAgentId,
      model: MODEL_NAME,
      systemPromptLength: targetAgent.systemPrompt.length,
      messagesCount: modelMessages.length,
      toolsCount: tools ? Object.keys(tools).length : 0,
      ...generateOptions,
    });
    // Log tool definitions before LLM call
    if (tools) {
      const { logToolDefinitions } = await import("./agentSetup");
      logToolDefinitions(tools, "Agent Delegation", targetAgent);
    }
    // Create timeout promise with handle for cleanup
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Delegation timeout: Agent call exceeded ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      // Race between generateText and timeout
      result = await Promise.race([
        generateText({
          model: model as unknown as Parameters<typeof generateText>[0]["model"],
          system: targetAgent.systemPrompt,
          messages: modelMessages,
          tools,
          ...generateOptions,
        }),
        timeoutPromise,
      ]);
    } finally {
      // Clear timeout to prevent memory leak if generateText completed first
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
    
    // LLM call succeeded - mark as attempted
    llmCallAttempted = true;

    // Extract token usage, generation IDs, and costs for credit adjustment
    const extractionResult = extractTokenUsageAndCosts(
      result,
      undefined,
      modelName || MODEL_NAME,
      "test" // Use "test" endpoint type for agent delegation
    );
    tokenUsage = extractionResult.tokenUsage;
    const openrouterGenerationId = extractionResult.openrouterGenerationId;
    const openrouterGenerationIds = extractionResult.openrouterGenerationIds;
    if (
      isCreditDeductionEnabled() &&
      reservationId &&
      reservationId !== "byok" &&
      tokenUsage &&
      (tokenUsage.promptTokens > 0 || tokenUsage.completionTokens > 0)
    ) {
      try {
        if (context) {
          await adjustCreditReservation(
            db,
            reservationId,
            workspaceId,
            agentProvider, // provider
            modelName || MODEL_NAME,
            tokenUsage,
            context,
            3, // maxRetries
            false, // usesByok - delegated calls use workspace API key if available
            openrouterGenerationId,
            openrouterGenerationIds,
            targetAgentId
          );
        } else {
          console.warn(
            "[callAgentInternal] Context not available, skipping credit adjustment"
          );
        }
        console.log(
          "[Agent Delegation] Credit reservation adjusted successfully"
        );
      } catch (error) {
        // Log error but don't fail the delegation call
        console.error(
          "[callAgentInternal] Error adjusting credit reservation:",
          {
            error: error instanceof Error ? error.message : String(error),
            workspaceId,
            targetAgentId,
            reservationId,
            tokenUsage,
          }
        );
      }
    } else if (
      reservationId &&
      reservationId !== "byok" &&
      (!tokenUsage ||
        (tokenUsage.promptTokens === 0 && tokenUsage.completionTokens === 0))
    ) {
      // No token usage after successful call - keep estimated cost (delete reservation)
      // This keeps the estimated cost deducted, which is correct since we can't determine actual cost
      console.warn(
        "[callAgentInternal] No token usage available after successful call, keeping estimated cost:",
        {
          workspaceId,
          targetAgentId,
          reservationId,
        }
      );
      // Delete reservation without refund (estimated cost remains deducted)
      try {
        const reservationPk = `credit-reservations/${reservationId}`;
        await db["credit-reservations"].delete(reservationPk);
      } catch (deleteError) {
        console.warn(
          "[callAgentInternal] Error deleting reservation:",
          deleteError
        );
        Sentry.captureException(ensureError(deleteError), {
          tags: {
            context: "credit-management",
            operation: "delete-reservation",
          },
        });
      }
    }

    if (!result) {
      throw new Error("LLM call succeeded but result is undefined");
    }

    return result.text;
  } catch (error) {
    // Handle errors based on when they occurred
    if (reservationId && reservationId !== "byok") {
      if (!llmCallAttempted) {
        // Error before LLM call - refund reservation
        try {
          console.log(
            "[callAgentInternal] Error before LLM call, refunding reservation:",
            {
              workspaceId,
              targetAgentId,
              reservationId,
              error: error instanceof Error ? error.message : String(error),
            }
          );
          if (context) {
            await refundReservation(db, reservationId, context);
          } else {
            console.warn(
              "[callAgentInternal] Context not available, skipping refund transaction"
            );
          }
        } catch (refundError) {
          // Log but don't fail - refund is best effort
          console.error("[callAgentInternal] Error refunding reservation:", {
            reservationId,
            error:
              refundError instanceof Error
                ? refundError.message
                : String(refundError),
          });
          Sentry.captureException(ensureError(refundError), {
            tags: {
              context: "credit-management",
              operation: "refund-credits",
            },
          });
        }
      } else {
        // Error after LLM call - try to get token usage from error if available
        // If model error without token usage, assume reserved credits were consumed
        let errorTokenUsage: ReturnType<typeof extractTokenUsage> | undefined;
        try {
          // Try to extract token usage from error if it has a result property
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
          try {
            if (context) {
              await adjustCreditReservation(
                db,
                reservationId,
                workspaceId,
                agentProvider,
                modelName || MODEL_NAME,
                errorTokenUsage,
                context,
                3,
                false, // usesByok
                undefined, // openrouterGenerationId
                undefined, // openrouterGenerationIds
                targetAgentId
              );
            } else {
              console.warn(
                "[callAgentInternal] Context not available, skipping credit adjustment"
              );
            }
          } catch (adjustError) {
            console.error(
              "[callAgentInternal] Error adjusting reservation after error:",
              adjustError
            );
          }
        } else {
          // No token usage available - assume reserved credits were consumed
          console.warn(
            "[callAgentInternal] Model error without token usage, assuming reserved credits consumed:",
            {
              workspaceId,
              targetAgentId,
              reservationId,
              error: error instanceof Error ? error.message : String(error),
            }
          );
          // Delete reservation without refund
          try {
            const reservationPk = `credit-reservations/${reservationId}`;
            await db["credit-reservations"].delete(reservationPk);
          } catch (deleteError) {
            console.warn(
              "[callAgentInternal] Error deleting reservation:",
              deleteError
            );
          }
        }
      }
    }

    console.error(
      `[callAgentInternal] Error calling agent ${targetAgentId}:`,
      error
    );
    return `Error calling agent: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

/**
 * Minimum score threshold for accepting an agent match.
 *
 * Scoring model:
 * - Individual similarity checks (see `calculateStringSimilarity`) return a value in [0.0, 1.0].
 * - The overall agent match score is an aggregate of several such similarity signals
 *   (e.g. agent name, description, and capability keywords), so the combined score
 *   can be greater than 1.0. In the current heuristic, a "perfect" match across
 *   all signals is roughly in the 3.0 range.
 *
 * Rationale for 2.0:
 * - 2.0 effectively requires a strong match on at least two independent signals
 *   (or an extremely strong match on one plus supporting evidence from others).
 * - This was empirically tuned to allow reasonably lenient matching while still
 *   filtering out most false positives in typical queries.
 *
 * Tuning guidance:
 * - Lower values (< 2.0) will increase recall (more agents considered matches)
 *   but can introduce more false positives.
 * - Higher values (> 2.0) will increase precision (fewer, more exact matches)
 *   but may cause relevant agents to be missed.
 */
const MATCH_THRESHOLD = 2.0;

/**
 * Calculate a simple similarity score between two strings
 * Returns a value between 0 and 1 based on how much of the query appears in the target
 */
function calculateStringSimilarity(query: string, target: string): number {
  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  // Exact match
  if (targetLower === queryLower) {
    return 1.0;
  }

  // Contains full query
  if (targetLower.includes(queryLower)) {
    return 0.8;
  }

  // Token-based matching
  const queryTokens = queryLower.split(/\s+/).filter((t) => t.length > 0);
  const targetTokens = targetLower.split(/\s+|_/).filter((t) => t.length > 0);

  if (queryTokens.length === 0) {
    return 0;
  }

  let matchedTokens = 0;
  for (const queryToken of queryTokens) {
    // Check if any target token contains this query token (or vice versa)
    for (const targetToken of targetTokens) {
      if (targetToken.includes(queryToken) || queryToken.includes(targetToken)) {
        matchedTokens++;
        break; // Count each query token only once
      }
    }
  }

  return (matchedTokens / queryTokens.length) * 0.6; // Partial credit for token matches
}

/**
 * Expanded keyword mapping with synonyms and variations
 * Maps common keywords to related capabilities
 */
function getCapabilityKeywords(): Record<string, string[]> {
  return {
    // Document search variations
    document: ["search_documents", "documents", "doc", "file", "content"],
    doc: ["search_documents", "documents", "document"],
    file: ["search_documents", "documents", "document"],
    content: ["search_documents", "documents", "document"],

    // Memory search variations
    memory: ["search_memory", "memory", "remember", "recall", "past"],
    remember: ["search_memory", "memory"],
    recall: ["search_memory", "memory"],
    past: ["search_memory", "memory"],
    history: ["search_memory", "memory"],

    // Web search variations
    web: ["search_web", "fetch_url", "web", "internet", "online", "browse"],
    internet: ["search_web", "fetch_url", "web"],
    online: ["search_web", "fetch_url", "web"],
    browse: ["search_web", "fetch_url", "web"],
    url: ["fetch_url", "search_web"],
    link: ["fetch_url", "search_web"],

    // Email variations
    email: ["send_email", "email", "mail", "send", "message"],
    mail: ["send_email", "email"],
    send: ["send_email", "email"],

    // Notification variations
    notification: ["send_notification", "notification", "notify", "alert"],
    notify: ["send_notification", "notification"],
    alert: ["send_notification", "notification"],

    // Search variations (general)
    search: ["search_web", "search_documents", "search_memory", "search"],
    find: ["search_web", "search_documents", "search_memory", "search"],
    lookup: ["search_web", "search_documents", "search_memory"],
  };
}

/**
 * Build a list of agent capabilities from agent configuration
 */
function buildAgentCapabilities(agent: CachedAgent): string[] {
  const capabilities: string[] = [];

  if (agent.enableSearchDocuments === true) {
    capabilities.push("search_documents");
  }

  if (agent.enableMemorySearch === true) {
    capabilities.push("search_memory");
  }

  if (agent.searchWebProvider === "tavily" || agent.searchWebProvider === "jina") {
    capabilities.push("search_web");
  }

  if (agent.fetchWebProvider === "tavily" || agent.fetchWebProvider === "jina") {
    capabilities.push("fetch_url");
  }

  if (agent.enableSendEmail === true) {
    capabilities.push("send_email");
  }

  if (agent.notificationChannelId) {
    capabilities.push("send_notification");
  }

  if (agent.enabledMcpServerIds && agent.enabledMcpServerIds.length > 0) {
    capabilities.push(`mcp_tools (${agent.enabledMcpServerIds.length} servers)`);
  }

  if (agent.clientTools && agent.clientTools.length > 0) {
    capabilities.push(`client_tools (${agent.clientTools.length} tools)`);
  }

  return capabilities;
}

/**
 * Find an agent by semantic query using fuzzy keyword matching
 * Matches against agent name, system prompt, and capabilities with lenient scoring
 * Exported for use in async tools
 */
export async function findAgentByQuery(
  workspaceId: string,
  query: string,
  delegatableAgentIds: string[]
): Promise<{ agentId: string; agentName: string; score: number } | null> {
  const db = await database();
  const queryLower = query.toLowerCase().trim();

  // Early return for empty or whitespace-only queries
  if (queryLower.length === 0) {
    return null;
  }

  // Get all delegatable agents (with caching)
  const agents = await Promise.all(
    delegatableAgentIds.map((agentId) =>
      fetchAndCacheAgent(db, workspaceId, agentId)
    )
  );

  const validAgents = agents.filter(
    (agent): agent is CachedAgent => agent !== null
  );

  if (validAgents.length === 0) {
    return null;
  }

  // Scoring weights for agent matching
  // These weights determine the relative importance of each matching signal
  const SCORE_WEIGHTS = {
    NAME_SIMILARITY: 15, // Agent name matches are most important
    PROMPT_SIMILARITY: 8, // System prompt matches are moderately important
    TOKEN_MATCH: 1.5, // Individual token matches in prompt add small increments
    CAPABILITIES_SIMILARITY: 10, // Overall capabilities similarity is important
    KEYWORD_CAPABILITY_MATCH: 4, // Keyword-to-capability mapping matches
    DIRECT_CAPABILITY_MATCH: 3, // Direct capability name matches
  } as const;

  // Score each agent based on fuzzy keyword matches
  const scoredAgents = validAgents.map((agent) => {
    const agentId = agent.pk.replace(`agents/${workspaceId}/`, "");
    let score = 0;

    // 1. Fuzzy match against agent name (weighted heavily)
    const nameSimilarity = calculateStringSimilarity(queryLower, agent.name);
    score += nameSimilarity * SCORE_WEIGHTS.NAME_SIMILARITY;

    // 2. Fuzzy match against system prompt (first 500 chars for performance)
    const promptLower = agent.systemPrompt.substring(0, 500).toLowerCase();
    const promptSimilarity = calculateStringSimilarity(queryLower, promptLower);
    score += promptSimilarity * SCORE_WEIGHTS.PROMPT_SIMILARITY;

    // Also count individual token matches in prompt
    const queryTokens = queryLower.split(/\s+/).filter((t) => t.length > 2);
    for (const token of queryTokens) {
      const tokenMatches = (promptLower.match(new RegExp(token, "g")) || [])
        .length;
      score += tokenMatches * SCORE_WEIGHTS.TOKEN_MATCH;
    }

    // 3. Match against capabilities with fuzzy matching
    const capabilities = buildAgentCapabilities(agent);
    const capabilitiesStr = capabilities.join(" ").toLowerCase();
    const capabilitiesSimilarity = calculateStringSimilarity(
      queryLower,
      capabilitiesStr
    );
    score += capabilitiesSimilarity * SCORE_WEIGHTS.CAPABILITIES_SIMILARITY;

    // 4. Expanded keyword mapping with fuzzy matching
    const capabilityKeywords = getCapabilityKeywords();
    const queryTokensForKeywords = queryLower
      .split(/\s+/)
      .filter((t) => t.length > 0);

    for (const queryToken of queryTokensForKeywords) {
      // Check exact keyword matches
      for (const [keyword, relatedCapabilities] of Object.entries(
        capabilityKeywords
      )) {
        if (
          queryToken === keyword ||
          queryToken.includes(keyword) ||
          keyword.includes(queryToken)
        ) {
          for (const cap of relatedCapabilities) {
            if (capabilitiesStr.includes(cap)) {
              score += SCORE_WEIGHTS.KEYWORD_CAPABILITY_MATCH;
            }
          }
        }
      }

      // Also check if query token partially matches capability names
      for (const cap of capabilities) {
        const capLower = cap.toLowerCase();
        if (
          capLower.includes(queryToken) ||
          queryToken.includes(capLower.replace(/_/g, " "))
        ) {
          score += SCORE_WEIGHTS.DIRECT_CAPABILITY_MATCH;
        }
      }
    }

    return { agent, agentId, score };
  });

  // Sort by score (highest first) and return best match
  scoredAgents.sort((a, b) => b.score - a.score);

  const bestMatch = scoredAgents[0];
  // Apply threshold - only return match if score meets minimum threshold
  if (bestMatch.score >= MATCH_THRESHOLD) {
    const agentName = bestMatch.agent.name;
    return { agentId: bestMatch.agentId, agentName, score: bestMatch.score };
  }

  return null;
}

/**
 * Format a list of agents into a consistent string format
 * Reusable in both list_agents tool and error messages
 */
function formatAgentList(
  agents: CachedAgent[],
  workspaceId: string
): string {
  if (agents.length === 0) {
    return "No delegatable agents found.";
  }

  const agentList = agents
    .map((agent) => {
      const agentId = agent.pk.replace(`agents/${workspaceId}/`, "");
      const capabilities = buildAgentCapabilities(agent);
      const description =
        agent.systemPrompt.length > 200
          ? `${agent.systemPrompt.substring(0, 200)}...`
          : agent.systemPrompt;
      const modelInfo = agent.modelName ? `${agent.modelName}` : "default";
      const providerInfo = agent.provider || "openrouter";

      let agentInfo = `- ${agent.name} (ID: ${agentId})\n  Description: ${description}\n  Model: ${modelInfo} (${providerInfo})`;

      if (capabilities.length > 0) {
        agentInfo += `\n  Capabilities: ${capabilities.join(", ")}`;
      } else {
        agentInfo += `\n  Capabilities: none`;
      }

      return agentInfo;
    })
    .join("\n\n");

  return `Available agents for delegation (${agents.length}):\n\n${agentList}`;
}

/**
 * Fetch and cache a single agent by ID
 * Shared helper to avoid code duplication
 */
async function fetchAndCacheAgent(
  db: Awaited<ReturnType<typeof database>>,
  workspaceId: string,
  agentId: string
): Promise<CachedAgent | null> {
  // Check cache first
  const cached = getCachedAgent(workspaceId, agentId);
  if (cached) {
    return cached;
  }

  // Fetch from database
  const agentPk = `agents/${workspaceId}/${agentId}`;
  const agent = await db.agent.get(agentPk, "agent");

  // Cache if found
  if (agent) {
    const cachedAgent: CachedAgent = {
      pk: agent.pk,
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      modelName: agent.modelName,
      provider: agent.provider,
      enableSearchDocuments: agent.enableSearchDocuments,
      enableMemorySearch: agent.enableMemorySearch,
      searchWebProvider: agent.searchWebProvider,
      fetchWebProvider: agent.fetchWebProvider,
      enableSendEmail: agent.enableSendEmail,
      notificationChannelId: agent.notificationChannelId,
      enabledMcpServerIds: agent.enabledMcpServerIds,
      clientTools: agent.clientTools,
    };
    setCachedAgent(workspaceId, agentId, cachedAgent);
    return cachedAgent;
  }

  return null;
}

/**
 * Helper function to fetch all delegatable agents (with caching)
 * Reusable in both list_agents tool and error handling
 */
async function fetchDelegatableAgents(
  workspaceId: string,
  delegatableAgentIds: string[]
): Promise<CachedAgent[]> {
  const db = await database();

  // Get all delegatable agents (with caching)
  const agents = await Promise.all(
    delegatableAgentIds.map((agentId) =>
      fetchAndCacheAgent(db, workspaceId, agentId)
    )
  );

  // Filter out any null results (agents that don't exist)
  return agents.filter((agent): agent is CachedAgent => agent !== null);
}

/**
 * Create the list_agents tool for listing delegatable agents
 */
export function createListAgentsTool(
  workspaceId: string,
  delegatableAgentIds: string[]
) {
  const listAgentsParamsSchema = z.object({});

  const description =
    "List all agents in the workspace that this agent can delegate to. Returns the name and ID of each delegatable agent. IMPORTANT: You MUST call this tool FIRST before calling call_agent, as you need to know the exact agent IDs to delegate to. Do not attempt to call_agent without first listing the available agents.";

  return tool({
    description,
    parameters: listAgentsParamsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime

    execute: async () => {
      try {
        const validAgents = await fetchDelegatableAgents(
          workspaceId,
          delegatableAgentIds
        );

        return formatAgentList(validAgents, workspaceId);
      } catch (error) {
        console.error("Error in list_agents tool:", error);
        return `Error listing agents: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create the call_agent tool for delegating to another agent
 */
export function createCallAgentTool(
  workspaceId: string,
  delegatableAgentIds: string[],
  currentAgentId: string,
  callDepth: number,
  maxDepth: number = 3,
  context?: Awaited<
    ReturnType<
      typeof import("../../utils/workspaceCreditContext").getContextFromRequestId
    >
  >,
  conversationId?: string
) {
  const callAgentParamsSchema = z
    .object({
      agentId: z
        .string()
        .min(1, "agentId parameter is required")
        .optional()
        .describe(
          "The exact agent ID to delegate to. You can get this by calling list_agents first, or use the query parameter to find an agent by description."
        ),
      agent_id: z
        .string()
        .min(1, "agent_id parameter is required")
        .optional()
        .describe(
          "The exact agent ID to delegate to (alternative to agentId). You can get this by calling list_agents first, or use the query parameter to find an agent by description."
        ),
      query: z
        .string()
        .min(1, "query parameter is required")
        .optional()
        .describe(
          "Semantic query to find an agent (e.g., 'find an agent that can search documents' or 'agent that handles email'). Mutually exclusive with agentId/agent_id. The system will match your query against agent names, descriptions, and capabilities."
        ),
      message: z
        .string()
        .min(1, "message parameter is required")
        .describe(
          "The message or query to send to the delegated agent. This should be the specific task or question you want the other agent to handle."
        ),
    })
    .refine(
      (data) => data.agentId || data.agent_id || data.query,
      {
        message:
          "Must provide either agentId/agent_id or query parameter to identify the target agent.",
      }
    )
    .refine(
      (data) => !((data.agentId || data.agent_id) && data.query),
      {
        message:
          "Cannot provide both agentId/agent_id and query - use one or the other.",
      }
    );

  type CallAgentArgs = z.infer<typeof callAgentParamsSchema>;

  const description =
    "Delegate a task to another agent in the workspace. You can identify the target agent in two ways: (1) Provide the exact agentId/agent_id (get this by calling list_agents first), or (2) Use the query parameter to describe what kind of agent you need (e.g., 'agent that can search documents'). The system will automatically find the best matching agent. The delegated agent will process your message and return a response. Example: call_agent({query: 'agent that searches documents', message: 'Find information about X'}) or call_agent({agentId: 'agent-123', message: 'Your question here'}).";

  return tool({
    description,
    parameters: callAgentParamsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      const typedArgs = args as CallAgentArgs;
      // Normalize: accept both agentId and agent_id, prefer agentId
      let agentId = typedArgs.agentId || typedArgs.agent_id;
      const { message, query } = typedArgs;
      let matchedAgentName: string | undefined;

      // Log tool call with arguments
      console.log("[Tool Call] call_agent", {
        toolName: "call_agent",
        arguments: {
          ...typedArgs,
          agentId, // Normalized agentId (from either agentId or agent_id)
          query,
          message: message
            ? `${message.substring(0, 100)}${message.length > 100 ? "..." : ""}`
            : undefined,
        },
        workspaceId,
        currentAgentId,
        callDepth,
        maxDepth,
      });

      // If query provided, resolve agentId using semantic matching
      if (query && typeof query === "string" && query.trim().length > 0) {
        try {
          const match = await findAgentByQuery(
            workspaceId,
            query,
            delegatableAgentIds
          );
          if (match) {
            agentId = match.agentId;
            matchedAgentName = match.agentName;
            console.log("[Tool Call] call_agent - Query matched", {
              query,
              matchedAgentId: agentId,
              matchedAgentName,
              score: match.score,
            });
          } else {
            // No match found above threshold - fetch and include agent list in error
            const validAgents = await fetchDelegatableAgents(
              workspaceId,
              delegatableAgentIds
            );
            const formattedAgentList = formatAgentList(validAgents, workspaceId);
            const errorMessage = `Error: No agent found matching query "${query}" with sufficient confidence. Available agents:\n\n${formattedAgentList}\n\nPlease use an agentId from the list above or try a more specific query.`;
            console.error("[Tool Error] call_agent", {
              toolName: "call_agent",
              error: "No agent matched query",
              query,
            });
            return errorMessage;
          }
        } catch (error) {
          const errorMessage = `Error finding agent by query: ${
            error instanceof Error ? error.message : String(error)
          }`;
          console.error("[Tool Error] call_agent", {
            toolName: "call_agent",
            error: "Query matching failed",
            query,
            errorMessage,
          });
          return errorMessage;
        }
      }

      // Validate agentId is a string
      if (!agentId || typeof agentId !== "string") {
        const errorMessage =
          agentId === undefined || agentId === null
            ? "Error: This tool call requires you to pass either the agentId/agent_id parameter or the query parameter. Use query to find an agent by description, or call list_agents first to get exact agent IDs."
            : `Error: The agentId/agent_id parameter must be a non-empty string. Received: ${
                typeof agentId === "object"
                  ? JSON.stringify(agentId)
                  : String(agentId)
              }. Use list_agents to see available agents and their IDs, or use the query parameter.`;
        console.error("[Tool Error] call_agent", {
          toolName: "call_agent",
          error:
            agentId === undefined || agentId === null
              ? "Missing agentId"
              : "Invalid agentId type",
          arguments: {
            agentId,
            query,
            message: message
              ? `${message.substring(0, 100)}${
                  message.length > 100 ? "..." : ""
                }`
              : undefined,
          },
        });
        return errorMessage;
      }

      // Validate agentId is in the allowed list
      if (!delegatableAgentIds.includes(agentId)) {
        const errorMessage = `Error: Agent ID "${agentId}" is not in the list of delegatable agents. You must call list_agents FIRST to see which agents are available and get their exact IDs. Do not guess agent IDs - always call list_agents before calling call_agent.`;
        console.error("[Tool Error] call_agent", {
          toolName: "call_agent",
          error: "Agent not in delegatable list",
          arguments: {
            agentId,
            message: message
              ? `${message.substring(0, 100)}${
                  message.length > 100 ? "..." : ""
                }`
              : undefined,
          },
        });
        return errorMessage;
      }

      // Validate message
      if (
        !message ||
        typeof message !== "string" ||
        message.trim().length === 0
      ) {
        const errorMessage =
          "Error: The message parameter is required and must be a non-empty string.";
        console.error("[Tool Error] call_agent", {
          toolName: "call_agent",
          error: "Empty message",
          arguments: { agentId, message },
        });
        return errorMessage;
      }

      try {
        // Get target agent name for response formatting
        const db = await database();
        const targetAgentPk = `agents/${workspaceId}/${agentId}`;
        const targetAgent = await db.agent.get(targetAgentPk, "agent");

        if (!targetAgent) {
          const errorMessage = `Error: Target agent ${agentId} not found.`;
          console.error("[Tool Error] call_agent", {
            toolName: "call_agent",
            error: "Target agent not found",
            arguments: {
              agentId,
              message: `${message.substring(0, 100)}${
                message.length > 100 ? "..." : ""
              }`,
            },
          });
          return errorMessage;
        }

        const targetAgentName = targetAgent.name;

        // Call the agent internally
        const response = await callAgentInternal(
          workspaceId,
          agentId,
          message.trim(),
          callDepth,
          maxDepth,
          context
        );

        // Wrap response with metadata
        let result = `Agent ${targetAgentName} responded: ${response}`;
        if (matchedAgentName && query) {
          result = `Matched query "${query}" to agent ${targetAgentName} (ID: ${agentId}). ${result}`;
        }

        // Log tool result
        console.log("[Tool Result] call_agent", {
          toolName: "call_agent",
          result:
            result.length > 500 ? `${result.substring(0, 500)}...` : result,
          resultLength: result.length,
          targetAgentId: agentId,
          targetAgentName,
        });

        // Log delegation metrics
        console.log("[Delegation Metrics]", {
          type: "sync",
          workspaceId,
          callingAgentId: currentAgentId,
          targetAgentId: agentId,
          callDepth,
          status: "completed",
          timestamp: new Date().toISOString(),
        });

        // Track delegation in conversation metadata
        if (conversationId) {
          await trackDelegation(db, workspaceId, currentAgentId, conversationId, {
            callingAgentId: currentAgentId,
            targetAgentId: agentId,
            status: "completed",
          });
        }

        return result;
      } catch (error) {
        const errorMessage = `Error calling agent: ${
          error instanceof Error ? error.message : String(error)
        }`;
        console.error("[Tool Error] call_agent", {
          toolName: "call_agent",
          error: error instanceof Error ? error.message : String(error),
          arguments: {
            agentId,
            message: message
              ? `${message.substring(0, 100)}${
                  message.length > 100 ? "..." : ""
                }`
              : undefined,
          },
        });

        // Log delegation metrics (failed)
        // Note: agentId is guaranteed to be a non-empty string at this point
        // (validated before the try block)
        console.log("[Delegation Metrics]", {
          type: "sync",
          workspaceId,
          callingAgentId: currentAgentId,
          targetAgentId: agentId,
          callDepth,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        });

        // Track failed delegation
        if (conversationId) {
          const db = await database();
          await trackDelegation(db, workspaceId, currentAgentId, conversationId, {
            callingAgentId: currentAgentId,
            targetAgentId: agentId,
            status: "failed",
          });
        }

        return errorMessage;
      }
    },
  });
}

/**
 * Create the call_agent_async tool for async delegation
 */
export function createCallAgentAsyncTool(
  workspaceId: string,
  delegatableAgentIds: string[],
  currentAgentId: string,
  callDepth: number,
  maxDepth: number = 3,
  context?: Awaited<
    ReturnType<
      typeof import("../../utils/workspaceCreditContext").getContextFromRequestId
    >
  >,
  conversationId?: string
) {
  const callAgentAsyncParamsSchema = z
    .object({
      agentId: z.string().optional(),
      agent_id: z.string().optional(),
      query: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Semantic query to find an agent (e.g., 'find an agent that can search documents'). Mutually exclusive with agentId/agent_id."
        ),
      message: z
        .string()
        .min(1, "message parameter is required")
        .describe(
          "The message or query to send to the delegated agent. This will be processed asynchronously."
        ),
    })
    .refine(
      (data) => data.agentId || data.agent_id || data.query,
      {
        message:
          "Must provide either agentId/agent_id or query parameter to identify the target agent.",
      }
    )
    .refine(
      (data) => !((data.agentId || data.agent_id) && data.query),
      {
        message:
          "Cannot provide both agentId/agent_id and query - use one or the other.",
      }
    );

  type CallAgentAsyncArgs = z.infer<typeof callAgentAsyncParamsSchema>;

  const description =
    "Delegate a task to another agent asynchronously (fire-and-forget). Returns immediately with a taskId that you can use to check status later. Use this when you don't need an immediate response. You can identify the target agent by agentId/agent_id or by query (semantic description). Example: call_agent_async({query: 'agent that searches documents', message: 'Find information about X'}) returns a taskId immediately.";

  return tool({
    description,
    parameters: callAgentAsyncParamsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      const typedArgs = args as CallAgentAsyncArgs;
      let agentId = typedArgs.agentId || typedArgs.agent_id;
      const { message, query } = typedArgs;

      // If query provided, resolve agentId using semantic matching
      if (query && typeof query === "string" && query.trim().length > 0) {
        try {
          const match = await findAgentByQuery(
            workspaceId,
            query,
            delegatableAgentIds
          );
          if (match) {
            agentId = match.agentId;
            console.log("[Tool Call] call_agent_async - Query matched", {
              query,
              matchedAgentId: agentId,
              score: match.score,
            });
          } else {
            // No match found above threshold - fetch and include agent list in error
            const validAgents = await fetchDelegatableAgents(
              workspaceId,
              delegatableAgentIds
            );
            const formattedAgentList = formatAgentList(validAgents, workspaceId);
            return `Error: No agent found matching query "${query}" with sufficient confidence. Available agents:\n\n${formattedAgentList}\n\nPlease use an agentId from the list above or try a more specific query.`;
          }
        } catch (error) {
          return `Error finding agent by query: ${
            error instanceof Error ? error.message : String(error)
          }`;
        }
      }

      if (!agentId || typeof agentId !== "string") {
        return "Error: Must provide either agentId/agent_id or query parameter.";
      }

      if (!delegatableAgentIds.includes(agentId)) {
        return `Error: Agent ID "${agentId}" is not in the list of delegatable agents.`;
      }

      if (
        !message ||
        typeof message !== "string" ||
        message.trim().length === 0
      ) {
        return "Error: The message parameter is required and must be a non-empty string.";
      }

      try {
        const db = await database();
        const taskId = randomUUID();

        // Calculate TTL (4 days from now, aligned with default SQS message retention)
        // SQS default message retention is 4 days, so tasks should expire around the same time
        const ttl = Math.floor(Date.now() / 1000) + 4 * 24 * 60 * 60;

        // Create task record
        const taskPk = `delegation-tasks/${taskId}`;
        const gsi1pk = `workspace/${workspaceId}/agent/${currentAgentId}`;
        const gsi1sk = new Date().toISOString();

        // createdAt is automatically set by the table API
        await db["agent-delegation-tasks"].create({
          pk: taskPk,
          sk: "task",
          workspaceId,
          callingAgentId: currentAgentId,
          targetAgentId: agentId,
          message: message.trim(),
          status: "pending",
          ttl,
          gsi1pk,
          gsi1sk,
        });

        // Enqueue to delegation queue
        const queueName = "agent-delegation-queue";
        await queues.publish({
          name: queueName,
          payload: {
            taskId,
            workspaceId,
            callingAgentId: currentAgentId,
            targetAgentId: agentId,
            message: message.trim(),
            callDepth,
            maxDepth,
            ...(conversationId && { conversationId }),
          },
        });

        console.log("[Tool Call] call_agent_async - Task created", {
          taskId,
          workspaceId,
          callingAgentId: currentAgentId,
          targetAgentId: agentId,
        });

        // Log delegation metrics
        console.log("[Delegation Metrics]", {
          type: "async",
          workspaceId,
          callingAgentId: currentAgentId,
          targetAgentId: agentId,
          taskId,
          callDepth,
          status: "pending",
          timestamp: new Date().toISOString(),
        });

        // Note: Delegation tracking will be handled by queue processor when task completes/fails
        // We don't track "pending" status since trackDelegation only supports "completed", "failed", "cancelled"

        return `Delegation task created successfully. Task ID: ${taskId}. Use check_delegation_status(${taskId}) to check the status and get results when ready.`;
      } catch (error) {
        const errorMessage = `Error creating async delegation task: ${
          error instanceof Error ? error.message : String(error)
        }`;
        console.error("[Tool Error] call_agent_async", {
          error: error instanceof Error ? error.message : String(error),
          arguments: { agentId, query, message },
        });
        return errorMessage;
      }
    },
  });
}

/**
 * Create the check_delegation_status tool
 */
export function createCheckDelegationStatusTool(workspaceId: string) {
  const checkStatusParamsSchema = z.object({
    taskId: z
      .string()
      .min(1, "taskId parameter is required")
      .describe("The task ID returned by call_agent_async"),
  });

  const description =
    "Check the status of an async delegation task. Returns the current status (pending, running, completed, failed, cancelled) and the result if completed, or error message if failed.";

  return tool({
    description,
    parameters: checkStatusParamsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      const { taskId } = args as z.infer<typeof checkStatusParamsSchema>;

      try {
        const db = await database();
        const taskPk = `delegation-tasks/${taskId}`;
        const task = await db["agent-delegation-tasks"].get(taskPk, "task");

        if (!task) {
          return `Error: Task ${taskId} not found. Make sure you're using the correct task ID.`;
        }

        // Verify task belongs to this workspace
        if (task.workspaceId !== workspaceId) {
          return `Error: Task ${taskId} does not belong to this workspace.`;
        }

        let statusMessage = `Task ${taskId} status: ${task.status}`;

        if (task.status === "completed" && task.result) {
          statusMessage += `\n\nResult: ${task.result}`;
        } else if (task.status === "failed" && task.error) {
          statusMessage += `\n\nError: ${task.error}`;
        } else if (task.status === "cancelled") {
          statusMessage += "\n\nTask was cancelled.";
        } else if (task.status === "pending" || task.status === "running") {
          statusMessage += "\n\nTask is still processing. Check again later.";
        }

        if (task.completedAt) {
          statusMessage += `\nCompleted at: ${task.completedAt}`;
        }

        return statusMessage;
      } catch (error) {
        return `Error checking task status: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create the cancel_delegation tool
 */
export function createCancelDelegationTool(workspaceId: string) {
  const cancelDelegationParamsSchema = z.object({
    taskId: z
      .string()
      .min(1, "taskId parameter is required")
      .describe("The task ID returned by call_agent_async"),
  });

  const description =
    "Cancel a pending or running async delegation task. Tasks that are already completed or failed cannot be cancelled.";

  return tool({
    description,
    parameters: cancelDelegationParamsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      const { taskId } = args as z.infer<typeof cancelDelegationParamsSchema>;

      try {
        const db = await database();
        const taskPk = `delegation-tasks/${taskId}`;
        const task = await db["agent-delegation-tasks"].get(taskPk, "task");

        if (!task) {
          return `Error: Task ${taskId} not found.`;
        }

        // Verify task belongs to this workspace
        if (task.workspaceId !== workspaceId) {
          return `Error: Task ${taskId} does not belong to this workspace.`;
        }

        if (task.status === "completed" || task.status === "failed") {
          return `Error: Cannot cancel task ${taskId} - it is already ${task.status}.`;
        }

        if (task.status === "cancelled") {
          return `Task ${taskId} is already cancelled.`;
        }

        // Update status to cancelled
        await db["agent-delegation-tasks"].update({
          ...task,
          status: "cancelled",
          completedAt: new Date().toISOString(),
        });

        console.log("[Tool Call] cancel_delegation - Task cancelled", {
          taskId,
        });

        return `Task ${taskId} has been cancelled successfully.`;
      } catch (error) {
        return `Error cancelling task: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

