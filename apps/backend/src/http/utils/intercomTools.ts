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
      query: searchQuerySchema,
      pagination: paginationSchema.optional(),
    })
    .strict();

  return tool({
    description:
      "Search Intercom contacts using the Intercom search query format. Example query: {\"operator\":\"AND\",\"value\":[{\"field\":\"email\",\"operator\":\"=\",\"value\":\"alice@example.com\"}]}",
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

        const result = await intercomClient.searchContacts(
          workspaceId,
          serverId,
          {
            query: parsed.data.query,
            pagination: parsed.data.pagination,
          }
        );
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
      query: searchQuerySchema,
      pagination: paginationSchema.optional(),
    })
    .strict();

  return tool({
    description:
      "Search Intercom conversations using the Intercom search query format. Example query: {\"operator\":\"AND\",\"value\":[{\"field\":\"id\",\"operator\":\"=\",\"value\":\"123456\"}]}",
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

        const result = await intercomClient.searchConversations(
          workspaceId,
          serverId,
          {
            query: parsed.data.query,
            pagination: parsed.data.pagination,
          }
        );
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
