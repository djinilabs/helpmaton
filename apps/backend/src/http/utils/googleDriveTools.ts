import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import * as googleDriveClient from "../../utils/googleDrive/client";

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
 * Create Google Drive list files tool
 */
export function createGoogleDriveListTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
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
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(100)
        .describe(
          "Maximum number of files to return per page (default: 100, max: 1000)"
        ),
    })
    .strict();

  return tool({
    description:
      "List files in Google Drive. Returns a list of files with their metadata (id, name, mimeType, size, etc.). Supports pagination with pageToken.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Google Drive is not connected. Please connect your Google Drive account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const result = await googleDriveClient.listFiles(
          workspaceId,
          serverId,
          parsed.data.query,
          parsed.data.pageToken,
          parsed.data.pageSize
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
            hasMore: !!result.nextPageToken,
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
  const schema = z
    .object({
      fileId: z.string().optional().describe("The Google Drive file ID to read"),
      file_id: z.string().optional().describe("Alias for fileId"),
      mimeType: z
        .string()
        .optional()
        .describe(
          "Optional MIME type for export. Defaults: text/plain for Google Docs and Slides, text/csv for Google Sheets. For other files, uses the file's MIME type."
        ),
    })
    .strict()
    .refine((data) => data.fileId || data.file_id, {
      message:
        "fileId parameter is required and must be a non-empty string. Provide the file ID as 'fileId'.",
      path: ["fileId"],
    });

  return tool({
    description:
      "Read the content of a file from Google Drive. Supports text files, Google Docs (exports as plain text), Google Sheets (exports as CSV), and Google Slides (exports as plain text). Use google_drive_list or google_drive_search first to get the fileId.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Google Drive is not connected. Please connect your Google Drive account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        // Extract fileId - handle both camelCase and snake_case
        const fileId = parsed.data.fileId || parsed.data.file_id;
        if (!fileId || typeof fileId !== "string" || fileId.trim().length === 0) {
          console.error("[Google Drive Read Tool] Missing or invalid fileId:", {
            args: parsed.data,
            fileId,
            hasFileId: !!parsed.data.fileId,
            hasFile_id: !!parsed.data.file_id,
          });
          return "Error: fileId parameter is required and must be a non-empty string. Provide the file ID as 'fileId' or 'file_id'.";
        }

        // Log tool call for debugging
        console.log("[Tool Call] google_drive_read", {
          toolName: "google_drive_read",
          arguments: { fileId, mimeType: parsed.data.mimeType },
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
          parsed.data.mimeType
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
  const schema = z
    .object({
      query: z
        .string()
        .min(1, "Search query cannot be empty")
        .describe(
          "REQUIRED: Search query string to find files by name or content. Example: 'budget report' or 'meeting notes'"
        ),
      pageToken: z
        .string()
        .optional()
        .describe("Optional page token for pagination (from previous search response)"),
    })
    .strict();

  return tool({
    description:
      "Search for files in Google Drive by name or content. Returns a list of matching files with their metadata. REQUIRES a 'query' parameter with the search term.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Google Drive is not connected. Please connect your Google Drive account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const pageToken = parsed.data.pageToken;

        // Log tool call for debugging
        console.log("[Tool Call] google_drive_search", {
          toolName: "google_drive_search",
          arguments: { query: parsed.data.query, pageToken },
          workspaceId,
          serverId,
        });

        const result = await googleDriveClient.searchFiles(
          workspaceId,
          serverId,
          parsed.data.query,
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
