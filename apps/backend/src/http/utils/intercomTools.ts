import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import * as intercomClient from "../../utils/intercom/client";

import { validateToolArgs } from "./toolValidation";

async function getIntercomConfig(
  workspaceId: string,
  serverId: string
): Promise<{ accessToken?: string; adminId?: string } | null> {
  const db = await database();
  const pk = `mcp-servers/${workspaceId}/${serverId}`;
  const server = await db["mcp-server"].get(pk, "server");

  if (!server || server.authType !== "oauth") {
    return null;
  }

  return server.config as { accessToken?: string; adminId?: string };
}

async function hasOAuthConnection(
  workspaceId: string,
  serverId: string
): Promise<boolean> {
  const config = await getIntercomConfig(workspaceId, serverId);
  return !!config?.accessToken;
}

const paginationSchema = z
  .object({
    perPage: z
      .number()
      .int()
      .min(1)
      .max(150)
      .optional()
      .describe("Number of results to return per page (default: 20, max: 150)"),
    startingAfter: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous response"),
  })
  .strict();

const searchQuerySchema = z
  .record(z.string(), z.unknown())
  .describe(
    "Intercom search query object. Example: {\"operator\":\"AND\",\"value\":[{\"field\":\"email\",\"operator\":\"=\",\"value\":\"alice@example.com\"}]}",
  );

type IntercomSearchFilter = {
  field: string;
  operator: string;
  value: unknown;
};

function buildSearchQuery(filters: IntercomSearchFilter[]) {
  if (filters.length === 1) {
    return filters[0];
  }
  return { operator: "AND", value: filters };
}

function buildContactSearchQuery(data: {
  email?: string;
  name?: string;
  externalId?: string;
}) {
  const filters: IntercomSearchFilter[] = [];
  if (data.email) {
    filters.push({ field: "email", operator: "=", value: data.email });
  }
  if (data.name) {
    filters.push({ field: "name", operator: "=", value: data.name });
  }
  if (data.externalId) {
    filters.push({ field: "external_id", operator: "=", value: data.externalId });
  }
  if (filters.length === 0) {
    return null;
  }
  return buildSearchQuery(filters);
}

function buildConversationSearchQuery(data: {
  conversationId?: string;
  contactId?: string;
  contactIds?: string[];
  state?: string;
  createdAfter?: number;
  updatedAfter?: number;
}) {
  const filters: IntercomSearchFilter[] = [];
  if (data.conversationId) {
    filters.push({ field: "id", operator: "=", value: data.conversationId });
  }
  if (data.contactIds?.length) {
    filters.push({ field: "contact_ids", operator: "IN", value: data.contactIds });
  } else if (data.contactId) {
    filters.push({ field: "contact_ids", operator: "=", value: data.contactId });
  }
  if (data.state) {
    filters.push({ field: "state", operator: "=", value: data.state });
  }
  if (typeof data.createdAfter === "number") {
    filters.push({ field: "created_at", operator: ">", value: data.createdAfter });
  }
  if (typeof data.updatedAfter === "number") {
    filters.push({ field: "updated_at", operator: ">", value: data.updatedAfter });
  }
  if (filters.length === 0) {
    return null;
  }
  return buildSearchQuery(filters);
}

export function createIntercomListContactsTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "List Intercom contacts with optional pagination. Returns contacts with basic profile data.",
    parameters: paginationSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Intercom is not connected. Please connect your Intercom account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof paginationSchema>>(
          paginationSchema,
          args
        );
        if (!parsed.ok) {
          return parsed.error;
        }

        const result = await intercomClient.listContacts(
          workspaceId,
          serverId,
          {
            perPage: parsed.data.perPage,
            startingAfter: parsed.data.startingAfter,
          }
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Intercom list contacts tool:", error);
        return `Error listing Intercom contacts: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createIntercomGetContactTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      contactId: z.string().optional().describe("Contact ID to retrieve"),
      id: z.string().optional().describe("Alias for contactId"),
      contact_id: z.string().optional().describe("Alias for contactId"),
    })
    .strict()
    .refine((data) => data.contactId || data.id || data.contact_id, {
      message: "contactId parameter is required.",
      path: ["contactId"],
    });

  return tool({
    description: "Get an Intercom contact by ID.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Intercom is not connected. Please connect your Intercom account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const contactId = parsed.data.contactId || parsed.data.id || parsed.data.contact_id;
        if (!contactId || typeof contactId !== "string") {
          return "Error: contactId parameter is required. Please provide the Intercom contact ID as 'contactId'.";
        }

        const result = await intercomClient.getContact(
          workspaceId,
          serverId,
          contactId
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Intercom get contact tool:", error);
        return `Error getting Intercom contact: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createIntercomSearchContactsTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      query: searchQuerySchema
        .optional()
        .describe(
          "Intercom search query object. If provided, shortcut filters are ignored."
        ),
      email: z.string().optional().describe("Shortcut: search by contact email"),
      name: z.string().optional().describe("Shortcut: search by contact name"),
      externalId: z
        .string()
        .optional()
        .describe("Shortcut: search by contact external_id"),
      pagination: paginationSchema.optional(),
    })
    .strict()
    .refine((data) => data.query || data.email || data.name || data.externalId, {
      message: "Provide query or at least one of email, name, or externalId.",
      path: ["query"],
    });

  return tool({
    description:
      "Search Intercom contacts. Provide a query object, or use shortcuts (email, name, externalId). If query is provided, shortcuts are ignored.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Intercom is not connected. Please connect your Intercom account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const query =
          parsed.data.query ??
          buildContactSearchQuery({
            email: parsed.data.email,
            name: parsed.data.name,
            externalId: parsed.data.externalId,
          });
        if (!query) {
          return "Error: Provide query or at least one of email, name, or externalId.";
        }

        const result = await intercomClient.searchContacts(workspaceId, serverId, {
          query,
          pagination: parsed.data.pagination,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Intercom search contacts tool:", error);
        return `Error searching Intercom contacts: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createIntercomUpdateContactTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      contactId: z.string().optional().describe("Contact ID to update"),
      id: z.string().optional().describe("Alias for contactId"),
      contact_id: z.string().optional().describe("Alias for contactId"),
      updates: z.record(z.string(), z.unknown()).describe("Fields to update on the contact"),
    })
    .strict()
    .refine((data) => data.contactId || data.id || data.contact_id, {
      message: "contactId parameter is required.",
      path: ["contactId"],
    });

  return tool({
    description:
      "Update an Intercom contact by ID with the provided fields.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Intercom is not connected. Please connect your Intercom account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const contactId = parsed.data.contactId || parsed.data.id || parsed.data.contact_id;
        if (!contactId || typeof contactId !== "string") {
          return "Error: contactId parameter is required. Please provide the Intercom contact ID as 'contactId'.";
        }

        const result = await intercomClient.updateContact(
          workspaceId,
          serverId,
          contactId,
          parsed.data.updates
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Intercom update contact tool:", error);
        return `Error updating Intercom contact: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createIntercomListConversationsTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "List Intercom conversations with optional pagination.",
    parameters: paginationSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Intercom is not connected. Please connect your Intercom account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof paginationSchema>>(
          paginationSchema,
          args
        );
        if (!parsed.ok) {
          return parsed.error;
        }

        const result = await intercomClient.listConversations(
          workspaceId,
          serverId,
          {
            perPage: parsed.data.perPage,
            startingAfter: parsed.data.startingAfter,
          }
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Intercom list conversations tool:", error);
        return `Error listing Intercom conversations: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createIntercomGetConversationTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      conversationId: z
        .string()
        .optional()
        .describe("Conversation ID to retrieve"),
      id: z.string().optional().describe("Alias for conversationId"),
      conversation_id: z.string().optional().describe("Alias for conversationId"),
    })
    .strict()
    .refine((data) => data.conversationId || data.id || data.conversation_id, {
      message: "conversationId parameter is required.",
      path: ["conversationId"],
    });

  return tool({
    description: "Get an Intercom conversation by ID.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Intercom is not connected. Please connect your Intercom account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const conversationId =
          parsed.data.conversationId || parsed.data.id || parsed.data.conversation_id;
        if (!conversationId || typeof conversationId !== "string") {
          return "Error: conversationId parameter is required. Please provide the Intercom conversation ID as 'conversationId'.";
        }

        const result = await intercomClient.getConversation(
          workspaceId,
          serverId,
          conversationId
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Intercom get conversation tool:", error);
        return `Error getting Intercom conversation: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createIntercomSearchConversationsTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      query: searchQuerySchema
        .optional()
        .describe(
          "Intercom search query object. If provided, shortcut filters are ignored."
        ),
      conversationId: z
        .string()
        .optional()
        .describe("Shortcut: search by conversation ID"),
      id: z.string().optional().describe("Alias for conversationId"),
      conversation_id: z.string().optional().describe("Alias for conversationId"),
      contactId: z
        .string()
        .optional()
        .describe("Shortcut: search by contact ID (maps to contact_ids)"),
      contact_id: z.string().optional().describe("Alias for contactId"),
      contactIds: z
        .array(z.string())
        .min(1)
        .optional()
        .describe("Shortcut: search by multiple contact IDs (contact_ids IN)"),
      contact_ids: z
        .array(z.string())
        .min(1)
        .optional()
        .describe("Alias for contactIds"),
      state: z
        .string()
        .optional()
        .describe("Shortcut: search by conversation state"),
      createdAfter: z
        .number()
        .int()
        .optional()
        .describe("Shortcut: created_at > (UNIX timestamp)"),
      updatedAfter: z
        .number()
        .int()
        .optional()
        .describe("Shortcut: updated_at > (UNIX timestamp)"),
      pagination: paginationSchema.optional(),
    })
    .strict()
    .refine(
      (data) =>
        !(
          (data.contactId || data.contact_id) &&
          (data.contactIds || data.contact_ids)
        ),
      {
        message: "Provide either contactId or contactIds, not both.",
        path: ["contactId"],
      }
    )
    .refine(
      (data) =>
        data.query ||
        data.conversationId ||
        data.id ||
        data.conversation_id ||
        data.contactId ||
        data.contact_id ||
        data.contactIds ||
        data.contact_ids ||
        data.state ||
        typeof data.createdAfter === "number" ||
        typeof data.updatedAfter === "number",
      {
        message:
          "Provide query or at least one shortcut (conversationId, contactId(s), state, createdAfter, updatedAfter).",
        path: ["query"],
      }
    );

  return tool({
    description:
      "Search Intercom conversations. Provide a query object, or use shortcuts (conversationId, contactId(s), state, createdAfter, updatedAfter). If query is provided, shortcuts are ignored.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Intercom is not connected. Please connect your Intercom account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const conversationId =
          parsed.data.conversationId || parsed.data.id || parsed.data.conversation_id;
        const contactId = parsed.data.contactId || parsed.data.contact_id;
        const contactIds = parsed.data.contactIds || parsed.data.contact_ids;
        const query =
          parsed.data.query ??
          buildConversationSearchQuery({
            conversationId,
            contactId,
            contactIds,
            state: parsed.data.state,
            createdAfter: parsed.data.createdAfter,
            updatedAfter: parsed.data.updatedAfter,
          });
        if (!query) {
          return "Error: Provide query or at least one shortcut (conversationId, contactId(s), state, createdAfter, updatedAfter).";
        }

        const result = await intercomClient.searchConversations(workspaceId, serverId, {
          query,
          pagination: parsed.data.pagination,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Intercom search conversations tool:", error);
        return `Error searching Intercom conversations: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createIntercomReplyConversationTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      conversationId: z
        .string()
        .optional()
        .describe("Conversation ID to reply to"),
      id: z.string().optional().describe("Alias for conversationId"),
      conversation_id: z.string().optional().describe("Alias for conversationId"),
      messageType: z
        .enum(["comment", "note", "open", "close", "assignment"])
        .optional()
        .describe("Reply action type (default: comment)"),
      message_type: z
        .enum(["comment", "note", "open", "close", "assignment"])
        .optional()
        .describe("Alias for messageType"),
      body: z
        .string()
        .optional()
        .describe("Message body for comment or note replies"),
      adminId: z.string().optional().describe("Admin ID to send as"),
      admin_id: z.string().optional().describe("Alias for adminId"),
      assigneeId: z.string().optional().describe("Admin ID to assign to"),
      assignee_id: z.string().optional().describe("Alias for assigneeId"),
    })
    .strict()
    .refine((data) => data.conversationId || data.id || data.conversation_id, {
      message: "conversationId parameter is required.",
      path: ["conversationId"],
    });

  return tool({
    description:
      "Reply to an Intercom conversation as an admin. Supports comment, note, open, close, or assignment actions.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Intercom is not connected. Please connect your Intercom account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const conversationId =
          parsed.data.conversationId || parsed.data.id || parsed.data.conversation_id;
        if (!conversationId || typeof conversationId !== "string") {
          return "Error: conversationId parameter is required. Please provide the Intercom conversation ID as 'conversationId'.";
        }

        const messageType =
          parsed.data.messageType || parsed.data.message_type || "comment";
        const body = parsed.data.body;

        if (
          (messageType === "comment" || messageType === "note") &&
          (!body || typeof body !== "string")
        ) {
          return "Error: body parameter is required for comment or note replies.";
        }

        const assigneeId = parsed.data.assigneeId || parsed.data.assignee_id;
        if (messageType === "assignment" && !assigneeId) {
          return "Error: assigneeId parameter is required for assignment replies.";
        }

        const config = await getIntercomConfig(workspaceId, serverId);
        let adminId = parsed.data.adminId || parsed.data.admin_id || config?.adminId;

        if (!adminId) {
          const admin = await intercomClient.getCurrentAdmin(
            workspaceId,
            serverId
          );
          adminId = admin.id;
        }

        if (!adminId) {
          return "Error: Intercom admin ID is missing. Please reconnect your Intercom account.";
        }

        const payload: Record<string, unknown> = {
          type: "admin",
          admin_id: adminId,
          message_type: messageType,
        };

        if (body) {
          payload.body = body;
        }
        if (assigneeId) {
          payload.assignee_id = assigneeId;
        }

        const result = await intercomClient.replyConversation(
          workspaceId,
          serverId,
          conversationId,
          payload
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Intercom reply conversation tool:", error);
        return `Error replying to Intercom conversation: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}
