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

const zendeskPaginationSchema = z
  .object({
    per_page: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .describe("Number of results per page (default: 25, max: 100)"),
    page: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Page number (1-based). Omit for first page."),
  })
  .strict();

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
      per_page: zendeskPaginationSchema.shape.per_page,
      page: zendeskPaginationSchema.shape.page,
    })
    .strict();

  return tool({
    description:
      "Searches for tickets using Zendesk's query syntax. Can filter by status, requester, tags, or description. Use per_page and page to paginate.",
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
        const { query, per_page, page } = parsed.data;
        const result = (await searchZendeskTickets(
          workspaceId,
          serverId,
          query,
          { per_page, page: page ?? 1 }
        )) as { results?: unknown[]; next_page?: string | null };
        const results = result.results ?? [];
        const hasMore = results.length === (per_page ?? 25);
        const currentPage = page ?? 1;
        return JSON.stringify(
          {
            results,
            hasMore,
            nextPage: hasMore ? currentPage + 1 : undefined,
          },
          null,
          2
        );
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
      per_page: zendeskPaginationSchema.shape.per_page,
      page: zendeskPaginationSchema.shape.page,
    })
    .strict();

  return tool({
    description:
      "Retrieves the full conversation history (comments) for a specific ticket ID. Use per_page and page to paginate.",
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
        const { ticketId, per_page, page } = parsed.data;
        const result = (await getZendeskTicketComments(
          workspaceId,
          serverId,
          String(ticketId),
          { per_page, page: page ?? 1 }
        )) as { comments?: unknown[]; next_page?: string | null };
        const comments = Array.isArray(result) ? result : result.comments ?? [];
        const hasMore = comments.length === (per_page ?? 25);
        const currentPage = page ?? 1;
        return JSON.stringify(
          {
            comments,
            hasMore,
            nextPage: hasMore ? currentPage + 1 : undefined,
          },
          null,
          2
        );
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
      per_page: zendeskPaginationSchema.shape.per_page,
      page: zendeskPaginationSchema.shape.page,
    })
    .strict();

  return tool({
    description:
      "Searches the Zendesk Help Center (Guide) for articles to answer user questions. Use per_page and page to paginate.",
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
        const { query, per_page, page } = parsed.data;
        const result = (await searchZendeskHelpCenter(
          workspaceId,
          serverId,
          query,
          { per_page, page: page ?? 1 }
        )) as { results?: unknown[] };
        const results = result.results ?? [];
        const hasMore = results.length === (per_page ?? 25);
        const currentPage = page ?? 1;
        return JSON.stringify(
          {
            results,
            hasMore,
            nextPage: hasMore ? currentPage + 1 : undefined,
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Zendesk search help center tool:", error);
        return `Error searching Zendesk Help Center: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}
