import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import * as googleDriveClient from "../../utils/googleDrive/client";

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
 * Create Google Drive list files tool
 */
export function createGoogleDriveListTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "List files in Google Drive. Returns a list of files with their metadata (id, name, mimeType, size, etc.). Supports pagination with pageToken.",
    parameters: z.object({
      query: z
        .string()
        .optional()
        .describe(
          "Optional query string to filter files (e.g., 'mimeType=\"application/pdf\"')"
        ),
      pageToken: z
        .string()
        .optional()
        .describe(
          "Optional page token for pagination (from previous list response)"
        ),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Google Drive is not connected. Please connect your Google Drive account first.";
        }

        const result = await googleDriveClient.listFiles(
          workspaceId,
          serverId,
          args.query,
          args.pageToken
        );

        return JSON.stringify(
          {
            files: result.files.map((file) => ({
              id: file.id,
              name: file.name,
              mimeType: file.mimeType,
              size: file.size,
              modifiedTime: file.modifiedTime,
              createdTime: file.createdTime,
              webViewLink: file.webViewLink,
            })),
            nextPageToken: result.nextPageToken,
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Google Drive list tool:", error);
        return `Error listing Google Drive files: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create Google Drive read file tool
 */
export function createGoogleDriveReadTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "Read the content of a file from Google Drive. Supports text files and Google Docs (exports as plain text).",
    parameters: z.object({
      fileId: z.string().describe("The Google Drive file ID to read"),
      mimeType: z
        .string()
        .optional()
        .describe(
          "Optional MIME type for export (defaults to text/plain for Google Docs)"
        ),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Google Drive is not connected. Please connect your Google Drive account first.";
        }

        // First get file metadata
        const file = await googleDriveClient.getFile(
          workspaceId,
          serverId,
          args.fileId
        );

        // Read file content
        const content = await googleDriveClient.readFile(
          workspaceId,
          serverId,
          args.fileId,
          args.mimeType
        );

        return JSON.stringify(
          {
            file: {
              id: file.id,
              name: file.name,
              mimeType: file.mimeType,
              size: file.size,
              modifiedTime: file.modifiedTime,
            },
            content,
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Google Drive read tool:", error);
        return `Error reading Google Drive file: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create Google Drive search files tool
 */
export function createGoogleDriveSearchTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "Search for files in Google Drive by name or content. Returns a list of matching files with their metadata.",
    parameters: z.object({
      query: z
        .string()
        .describe("Search query to find files by name or content"),
      pageToken: z
        .string()
        .optional()
        .describe(
          "Optional page token for pagination (from previous search response)"
        ),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Google Drive is not connected. Please connect your Google Drive account first.";
        }

        const result = await googleDriveClient.searchFiles(
          workspaceId,
          serverId,
          args.query,
          args.pageToken
        );

        return JSON.stringify(
          {
            files: result.files.map((file) => ({
              id: file.id,
              name: file.name,
              mimeType: file.mimeType,
              size: file.size,
              modifiedTime: file.modifiedTime,
              createdTime: file.createdTime,
              webViewLink: file.webViewLink,
            })),
            nextPageToken: result.nextPageToken,
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Google Drive search tool:", error);
        return `Error searching Google Drive files: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}
