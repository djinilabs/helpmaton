import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import {
  searchZendeskTickets,
  getZendeskTicketComments,
  draftZendeskTicketComment,
  searchZendeskHelpCenter,
} from "../../utils/zendesk/client";

import { validateToolArgs } from "./toolValidation";

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

  const config = server.config as { accessToken?: string; subdomain?: string };
  return !!config.accessToken && !!config.subdomain;
}

export function createZendeskSearchTicketsTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      query: z
        .string()
        .min(1)
        .describe(
          "Zendesk search query. Example: 'type:ticket status:open requester:alice@example.com'"
        ),
    })
    .strict();

  return tool({
    description:
      "Searches for tickets using Zendesk's query syntax. Can filter by status, requester, tags, or description.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Zendesk is not connected. Please connect your Zendesk account first.";
        }
        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }
        const { query } = parsed.data;
        const result = await searchZendeskTickets(workspaceId, serverId, query);
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Zendesk search tickets tool:", error);
        return `Error searching Zendesk tickets: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createZendeskGetTicketDetailsTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      ticketId: z
        .union([z.string(), z.number().int()])
        .describe("Zendesk ticket ID"),
    })
    .strict();

  return tool({
    description:
      "Retrieves the full conversation history (comments) for a specific ticket ID.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Zendesk is not connected. Please connect your Zendesk account first.";
        }
        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }
        const { ticketId } = parsed.data;
        const result = await getZendeskTicketComments(
          workspaceId,
          serverId,
          String(ticketId)
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Zendesk get ticket details tool:", error);
        return `Error getting Zendesk ticket details: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createZendeskDraftCommentTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      ticketId: z
        .union([z.string(), z.number().int()])
        .describe("Zendesk ticket ID"),
      body: z
        .string()
        .min(1)
        .describe("Draft reply body to add as a private note"),
    })
    .strict();

  return tool({
    description:
      "Adds a private internal note to a ticket (draft reply for human review).",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Zendesk is not connected. Please connect your Zendesk account first.";
        }
        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }
        const { ticketId, body } = parsed.data;
        const result = await draftZendeskTicketComment(
          workspaceId,
          serverId,
          String(ticketId),
          body
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Zendesk draft comment tool:", error);
        return `Error drafting Zendesk comment: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createZendeskSearchHelpCenterTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      query: z
        .string()
        .min(1)
        .describe("Search query for Zendesk Help Center articles"),
    })
    .strict();

  return tool({
    description:
      "Searches the Zendesk Help Center (Guide) for articles to answer user questions.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Zendesk is not connected. Please connect your Zendesk account first.";
        }
        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }
        const { query } = parsed.data;
        const result = await searchZendeskHelpCenter(
          workspaceId,
          serverId,
          query
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Zendesk search help center tool:", error);
        return `Error searching Zendesk Help Center: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}
