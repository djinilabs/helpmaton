import { makeGoogleApiRequest } from "../googleApi/request";
import { refreshGoogleDriveToken } from "../oauth/mcp/google-drive";

import type {
  GoogleDriveFile,
  GoogleDriveFileListResponse,
} from "./types";

const GOOGLE_DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

/**
 * List files in Google Drive
 * @param pageSize - Max 1000, default 100 if not provided
 */
export async function listFiles(
  workspaceId: string,
  serverId: string,
  query?: string,
  pageToken?: string,
  pageSize?: number
): Promise<GoogleDriveFileListResponse> {
  const size =
    pageSize !== undefined && pageSize >= 1 && pageSize <= 1000
      ? pageSize
      : 100;
  const params = new URLSearchParams({
    pageSize: String(size),
    fields:
      "nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,size,webViewLink,parents)",
  });

  if (query) {
    params.append("q", query);
  }

  if (pageToken) {
    params.append("pageToken", pageToken);
  }

  const url = `${GOOGLE_DRIVE_API_BASE}/files?${params.toString()}`;
  return makeGoogleApiRequest<GoogleDriveFileListResponse>({
    workspaceId,
    serverId,
    url,
    refreshTokenFn: refreshGoogleDriveToken,
  });
}

/**
 * Get file metadata from Google Drive
 */
export async function getFile(
  workspaceId: string,
  serverId: string,
  fileId: string
): Promise<GoogleDriveFile> {
  const params = new URLSearchParams({
    fields: "id,name,mimeType,modifiedTime,createdTime,size,webViewLink,parents",
  });

  const url = `${GOOGLE_DRIVE_API_BASE}/files/${fileId}?${params.toString()}`;
  return makeGoogleApiRequest<GoogleDriveFile>({
    workspaceId,
    serverId,
    url,
    refreshTokenFn: refreshGoogleDriveToken,
  });
}

/**
 * Read file content from Google Drive
 * Supports text files and Google Docs (exports as plain text)
 */
export async function readFile(
  workspaceId: string,
  serverId: string,
  fileId: string,
  mimeType?: string
): Promise<string> {
  // First get file metadata to determine mime type
  const file = await getFile(workspaceId, serverId, fileId);

  // Determine export mime type for Google Docs
  let exportMimeType = mimeType;
  if (!exportMimeType) {
    if (file.mimeType === "application/vnd.google-apps.document") {
      exportMimeType = "text/plain";
    } else if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
      exportMimeType = "text/csv";
    } else if (file.mimeType === "application/vnd.google-apps.presentation") {
      exportMimeType = "text/plain";
    } else {
      // For other files, try to read directly
      exportMimeType = file.mimeType;
    }
  }

  // Build URL - use export for Google Workspace files, otherwise use files endpoint
  let url: string;
  if (file.mimeType.startsWith("application/vnd.google-apps.")) {
    url = `${GOOGLE_DRIVE_API_BASE}/files/${fileId}/export?mimeType=${encodeURIComponent(exportMimeType)}`;
  } else {
    url = `${GOOGLE_DRIVE_API_BASE}/files/${fileId}?alt=media`;
  }

  // For file content, we need to get the response as text
  // Remove Content-Type header for binary/text responses
  return makeGoogleApiRequest<string>({
    workspaceId,
    serverId,
    url,
    options: {
      headers: {}, // Don't set Content-Type for file downloads
    },
    refreshTokenFn: refreshGoogleDriveToken,
    responseType: "text",
  });
}

/**
 * Search files in Google Drive
 */
export async function searchFiles(
  workspaceId: string,
  serverId: string,
  query: string,
  pageToken?: string
): Promise<GoogleDriveFileListResponse> {
  // Validate query parameter
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    throw new Error("Search query is required and must be a non-empty string");
  }

  // Build search query - escape single quotes in the query string
  const escapedQuery = query.replace(/'/g, "\\'");
  const searchQuery = `name contains '${escapedQuery}' or fullText contains '${escapedQuery}'`;

  return listFiles(workspaceId, serverId, searchQuery, pageToken);
}
