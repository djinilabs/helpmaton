import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import * as slackClient from "../../utils/slackClient";

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

  const config = server.config as { accessToken?: string };
  return !!config.accessToken;
}

const listChannelsSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(100)
      .describe("Number of channels to return (default: 100)"),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous response"),
  })
  .strict();

const channelIdSchema = z
  .object({
    channelId: z
      .string()
      .optional()
      .describe("Slack channel ID (e.g., C12345)"),
    channel_id: z
      .string()
      .optional()
      .describe("Alias for channelId"),
    channel: z.string().optional().describe("Alias for channelId"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(100)
      .describe("Number of messages to return (default: 100)"),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous response"),
  })
  .strict()
  .refine((data) => data.channelId || data.channel_id || data.channel, {
    message:
      "One of channelId, channel_id, or channel must be provided as the Slack channel identifier.",
    path: ["channelId"],
  });

const postMessageSchema = z
  .object({
    channelId: z.string().optional().describe("Slack channel ID (e.g., C12345)"),
    channel_id: z.string().optional().describe("Alias for channelId"),
    channel: z.string().optional().describe("Alias for channelId"),
    text: z.string().min(1).describe("Message text to post"),
  })
  .strict()
  .refine((data) => data.channelId || data.channel_id || data.channel, {
    message: "At least one of channelId, channel_id, or channel is required.",
    path: ["channel_id"],
  });

export function createSlackListChannelsTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "List Slack public and private channels with IDs, names, and metadata. Use this to find a channel ID for follow-up actions.",
    parameters: listChannelsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Slack is not connected. Please connect your Slack account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof listChannelsSchema>>(
          listChannelsSchema,
          args
        );
        if (!parsed.ok) {
          return parsed.error;
        }

        const result = await slackClient.listChannels(workspaceId, serverId, {
          limit: parsed.data.limit,
          cursor: parsed.data.cursor,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Slack list channels tool:", error);
        return `Error listing Slack channels: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createSlackGetChannelHistoryTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "Read the most recent messages in a Slack channel. Returns a plain-text summary of messages with timestamps and user IDs.",
    parameters: channelIdSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Slack is not connected. Please connect your Slack account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof channelIdSchema>>(
          channelIdSchema,
          args
        );
        if (!parsed.ok) {
          return parsed.error;
        }

        const channelId =
          parsed.data.channelId || parsed.data.channel_id || parsed.data.channel;
        if (!channelId || typeof channelId !== "string") {
          return "Error: channel_id parameter is required. Please provide the Slack channel ID as 'channel_id'.";
        }

        const result = await slackClient.getChannelHistory(
          workspaceId,
          serverId,
          channelId,
          {
            limit: parsed.data.limit,
            cursor: parsed.data.cursor,
          }
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Slack get channel history tool:", error);
        return `Error reading Slack channel history: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createSlackPostMessageTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "Post a message to a Slack channel. Provide the channel ID and message text.",
    parameters: postMessageSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Slack is not connected. Please connect your Slack account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof postMessageSchema>>(
          postMessageSchema,
          args
        );
        if (!parsed.ok) {
          return parsed.error;
        }

        const channelId =
          parsed.data.channelId || parsed.data.channel_id || parsed.data.channel;
        if (!channelId || typeof channelId !== "string") {
          return "Error: channel_id parameter is required. Please provide the Slack channel ID as 'channel_id'.";
        }
        if (!parsed.data.text || typeof parsed.data.text !== "string") {
          return "Error: text parameter is required and must be a string.";
        }

        const result = await slackClient.postMessage(
          workspaceId,
          serverId,
          channelId,
          parsed.data.text
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Slack post message tool:", error);
        return `Error posting Slack message: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}
