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
      "Read the content of a file from Google Drive. Supports text files, Google Docs (exports as plain text), Google Sheets (exports as CSV), and Google Slides (exports as plain text).",
    parameters: z.object({
      fileId: z.string().describe("The Google Drive file ID to read"),
      mimeType: z
        .string()
        .optional()
        .describe(
          "Optional MIME type for export. Defaults: text/plain for Google Docs and Slides, text/csv for Google Sheets. For other files, uses the file's MIME type."
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

        // Extract fileId - handle both camelCase and snake_case
        const fileId = args.fileId || args.file_id;
        if (!fileId || typeof fileId !== "string" || fileId.trim().length === 0) {
          console.error("[Google Drive Read Tool] Missing or invalid fileId:", {
            args,
            fileId,
            hasFileId: !!args.fileId,
            hasFile_id: !!args.file_id,
          });
          return "Error: fileId parameter is required and must be a non-empty string. Please provide the file ID as 'fileId' (not 'file_id').";
        }

        // Log tool call for debugging
        console.log("[Tool Call] google_drive_read", {
          toolName: "google_drive_read",
          arguments: { fileId, mimeType: args.mimeType },
          workspaceId,
          serverId,
        });

        // First get file metadata
        const file = await googleDriveClient.getFile(
          workspaceId,
          serverId,
          fileId
        );

        // Read file content
        const content = await googleDriveClient.readFile(
          workspaceId,
          serverId,
          fileId,
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
      "Search for files in Google Drive by name or content. Returns a list of matching files with their metadata. REQUIRES a 'query' parameter with the search term.",
    parameters: z.object({
      query: z
        .string()
        .min(1, "Search query cannot be empty")
        .describe("REQUIRED: Search query string to find files by name or content. Example: 'budget report' or 'meeting notes'"),
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

        // Validate args structure
        if (!args || typeof args !== "object") {
          return "Error: Search requires a 'query' parameter. Please provide a search query string.";
        }

        // Extract and validate query parameter
        const query = args.query;
        if (!query || typeof query !== "string" || query.trim().length === 0) {
          return "Error: Search requires a non-empty 'query' parameter. Please provide a search query string. Example: {query: 'my document'}";
        }

        const pageToken = args.pageToken;

        // Log tool call for debugging
        console.log("[Tool Call] google_drive_search", {
          toolName: "google_drive_search",
          arguments: { query, pageToken },
          workspaceId,
          serverId,
        });

        const result = await googleDriveClient.searchFiles(
          workspaceId,
          serverId,
          query,
          pageToken
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
