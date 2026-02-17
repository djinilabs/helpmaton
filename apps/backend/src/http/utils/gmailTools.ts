import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import * as gmailClient from "../../utils/gmail/client";

import { validateToolArgs } from "./toolValidation";

/**
 * Check if MCP server has OAuth connection
 */
async function hasOAuthConnection(
  workspaceId: string,
  serverId: string
): Promise<boolean> {
  const db = await database();
  const pk = `mcp-servers/${workspaceId}/${serverId}`;
  const server = await db["mcp-server"].get(pk, "server");

  if (!server || server.authType !== "oauth") {
    return false;
  }

  const config = server.config as {
    accessToken?: string;
  };

  return !!config.accessToken;
}

/**
 * Create Gmail list messages tool
 */
export function createGmailListTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      query: z
        .string()
        .optional()
        .describe(
          "Optional Gmail search query to filter messages (e.g., 'from:example@gmail.com', 'subject:meeting', 'is:unread')"
        ),
      pageToken: z
        .string()
        .optional()
        .describe(
          "Optional page token for pagination (from previous list response)"
        ),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(50)
        .describe(
          "Maximum number of messages to return (default: 50, max: 500)"
        ),
    })
    .strict();

  return tool({
    description:
      "List emails in Gmail. Returns up to 50 messages per page with full metadata (id, threadId, from, subject, date, snippet). Use maxResults and pageToken to paginate; use the next page token from the response for the next page.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Gmail is not connected. Please connect your Gmail account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const maxResults = parsed.data.maxResults ?? 50;
        const result = await gmailClient.listMessages(
          workspaceId,
          serverId,
          parsed.data.query,
          parsed.data.pageToken,
          maxResults
        );

        // Get message details for each message ID (cap to avoid timeouts/rate limits)
        const MAX_MESSAGE_DETAILS_TO_FETCH = 50;
        const messages = [];
        if (result.messages) {
          for (const msg of result.messages.slice(0, MAX_MESSAGE_DETAILS_TO_FETCH)) {
            try {
              const message = await gmailClient.getMessage(
                workspaceId,
                serverId,
                msg.id
              );
              const headers = message.payload?.headers || [];
              const fromHeader = headers.find((h) => h.name.toLowerCase() === "from");
              const subjectHeader = headers.find((h) => h.name.toLowerCase() === "subject");
              const dateHeader = headers.find((h) => h.name.toLowerCase() === "date");

              messages.push({
                id: message.id,
                threadId: message.threadId,
                from: fromHeader?.value || "Unknown",
                subject: subjectHeader?.value || "(No subject)",
                date: dateHeader?.value || message.internalDate || "Unknown",
                snippet: message.snippet || "",
              });
            } catch (error) {
              // If we can't get message details, just include the ID
              messages.push({
                id: msg.id,
                threadId: msg.threadId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }

        return JSON.stringify(
          {
            messages,
            nextPageToken: result.nextPageToken,
            resultSizeEstimate: result.resultSizeEstimate,
            hasMore: !!result.nextPageToken,
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Gmail list tool:", error);
        return `Error listing Gmail messages: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create Gmail search messages tool
 */
export function createGmailSearchTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      query: z
        .string()
        .min(1, "Search query cannot be empty")
        .describe(
          "REQUIRED: Gmail search query string. Examples: 'from:example@gmail.com', 'subject:meeting', 'is:unread', 'has:attachment', 'after:2024/1/1'"
        ),
      pageToken: z
        .string()
        .optional()
        .describe("Optional page token for pagination (from previous search response)"),
    })
    .strict();

  return tool({
    description:
      "Search for emails in Gmail using Gmail search syntax. Returns a list of matching messages with their metadata. REQUIRES a 'query' parameter with the search term. Examples: 'from:example@gmail.com', 'subject:meeting', 'is:unread', 'has:attachment'.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Gmail is not connected. Please connect your Gmail account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const pageToken = parsed.data.pageToken;

        // Log tool call for debugging
        console.log("[Tool Call] gmail_search", {
          toolName: "gmail_search",
          arguments: { query: parsed.data.query, pageToken },
          workspaceId,
          serverId,
        });

        const result = await gmailClient.searchMessages(
          workspaceId,
          serverId,
          parsed.data.query,
          pageToken
        );

        // Get message details for each message ID
        const messages = [];
        if (result.messages) {
          for (const msg of result.messages.slice(0, 50)) {
            // Limit to 50 messages to avoid too many API calls
            try {
              const message = await gmailClient.getMessage(
                workspaceId,
                serverId,
                msg.id
              );
              const headers = message.payload?.headers || [];
              const fromHeader = headers.find((h) => h.name.toLowerCase() === "from");
              const subjectHeader = headers.find((h) => h.name.toLowerCase() === "subject");
              const dateHeader = headers.find((h) => h.name.toLowerCase() === "date");

              messages.push({
                id: message.id,
                threadId: message.threadId,
                from: fromHeader?.value || "Unknown",
                subject: subjectHeader?.value || "(No subject)",
                date: dateHeader?.value || message.internalDate || "Unknown",
                snippet: message.snippet || "",
              });
            } catch (error) {
              // If we can't get message details, just include the ID
              messages.push({
                id: msg.id,
                threadId: msg.threadId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }

        return JSON.stringify(
          {
            messages,
            nextPageToken: result.nextPageToken,
            resultSizeEstimate: result.resultSizeEstimate,
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Gmail search tool:", error);
        return `Error searching Gmail messages: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create Gmail read message tool
 */
export function createGmailReadTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      messageId: z.string().optional().describe("The Gmail message ID to read"),
      message_id: z.string().optional().describe("Alias for messageId"),
    })
    .strict()
    .refine((data) => data.messageId || data.message_id, {
      message:
        "messageId parameter is required and must be a non-empty string. Provide the message ID as 'messageId'.",
      path: ["messageId"],
    });

  return tool({
    description:
      "Read the full content of an email from Gmail. Returns the complete email with headers, body (text and HTML), and attachment information. Use gmail_list or gmail_search first to get the messageId.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Gmail is not connected. Please connect your Gmail account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        // Extract messageId - handle both camelCase and snake_case
        const messageId = parsed.data.messageId || parsed.data.message_id;
        if (!messageId || typeof messageId !== "string" || messageId.trim().length === 0) {
          console.error("[Gmail Read Tool] Missing or invalid messageId:", {
            args: parsed.data,
            messageId,
            hasMessageId: !!parsed.data.messageId,
            hasMessage_id: !!parsed.data.message_id,
          });
          return "Error: messageId parameter is required and must be a non-empty string. Provide the message ID as 'messageId' or 'message_id'.";
        }

        // Log tool call for debugging
        console.log("[Tool Call] gmail_read", {
          toolName: "gmail_read",
          arguments: { messageId },
          workspaceId,
          serverId,
        });

        // Read full message content
        const message = await gmailClient.readMessage(
          workspaceId,
          serverId,
          messageId
        );

        return JSON.stringify(
          {
            message: {
              id: message.id,
              threadId: message.threadId,
              headers: message.headers,
              snippet: message.snippet,
              body: message.body,
              attachments: message.attachments,
            },
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Gmail read tool:", error);
        return `Error reading Gmail message: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}
