import { database } from "../../tables";
import { refreshGoogleDriveToken } from "../oauth/mcp/google-drive";

import {
  calculateBackoffDelay,
  isAuthenticationError,
  isRecoverableError,
  sleep,
} from "./errors";
import type {
  GoogleDriveErrorResponse,
  GoogleDriveFile,
  GoogleDriveFileListResponse,
} from "./types";

const GOOGLE_DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const MAX_RETRIES = 5;
const REQUEST_TIMEOUT_MS = 30000; // 30 seconds

/**
 * OAuth token information from mcp-server config
 */
interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

/**
 * Get OAuth tokens from mcp-server config
 */
async function getOAuthTokens(
  workspaceId: string,
  serverId: string
): Promise<OAuthTokens> {
  const db = await database();
  const pk = `mcp-servers/${workspaceId}/${serverId}`;
  const server = await db["mcp-server"].get(pk, "server");

  if (!server) {
    throw new Error(`MCP server ${serverId} not found`);
  }

  if (server.authType !== "oauth") {
    throw new Error(`MCP server ${serverId} is not an OAuth server`);
  }

  const config = server.config as {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: string;
  };

  if (!config.accessToken || !config.refreshToken) {
    throw new Error(`OAuth tokens not found for MCP server ${serverId}`);
  }

  return {
    accessToken: config.accessToken,
    refreshToken: config.refreshToken,
    expiresAt: config.expiresAt || new Date().toISOString(),
  };
}

/**
 * Update OAuth tokens in mcp-server config
 */
async function updateOAuthTokens(
  workspaceId: string,
  serverId: string,
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  }
): Promise<void> {
  const db = await database();
  const pk = `mcp-servers/${workspaceId}/${serverId}`;
  const server = await db["mcp-server"].get(pk, "server");

  if (!server) {
    throw new Error(`MCP server ${serverId} not found`);
  }

  // Update config with new tokens
  const updatedConfig = {
    ...(server.config as Record<string, unknown>),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
  };

  await db["mcp-server"].update({
    pk,
    sk: "server",
    config: updatedConfig,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Check if token is expired or about to expire (within 1 minute)
 */
function isTokenExpired(expiresAt: string): boolean {
  const expirationTime = new Date(expiresAt).getTime();
  const now = Date.now();
  const bufferMs = 60 * 1000; // 1 minute buffer
  return now >= expirationTime - bufferMs;
}

/**
 * Refresh access token if expired
 */
async function ensureValidToken(
  workspaceId: string,
  serverId: string,
  tokens: OAuthTokens
): Promise<string> {
  // Check if token is expired
  if (isTokenExpired(tokens.expiresAt)) {
    try {
      // Refresh the token
      const refreshed = await refreshGoogleDriveToken(tokens.refreshToken);

      // Update tokens in database
      await updateOAuthTokens(workspaceId, serverId, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
      });

      return refreshed.accessToken;
    } catch (error) {
      throw new Error(
        `Failed to refresh Google Drive token: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return tokens.accessToken;
}

/**
 * Make a request to Google Drive API with error handling and retry logic
 */
async function makeGoogleDriveRequest<T>(
  workspaceId: string,
  serverId: string,
  url: string,
  options: RequestInit = {},
  retryAttempt: number = 0
): Promise<T> {
  // Get OAuth tokens
  let tokens = await getOAuthTokens(workspaceId, serverId);

  // Ensure token is valid (refresh if needed)
  const accessToken = await ensureValidToken(workspaceId, serverId, tokens);

  // Create abort signal for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Handle authentication errors
    if (isAuthenticationError(response.status)) {
      // Try to refresh token and retry once
      if (retryAttempt === 0) {
        try {
          const refreshed = await refreshGoogleDriveToken(tokens.refreshToken);
          await updateOAuthTokens(workspaceId, serverId, {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: refreshed.expiresAt,
          });

          // Retry with new token
          tokens = await getOAuthTokens(workspaceId, serverId);
          return makeGoogleDriveRequest<T>(
            workspaceId,
            serverId,
            url,
            options,
            retryAttempt + 1
          );
        } catch (refreshError) {
          // Check if it's a token revocation error
          const errorMessage =
            refreshError instanceof Error
              ? refreshError.message
              : String(refreshError);
          
          if (
            errorMessage.includes("invalid_grant") ||
            errorMessage.includes("token has been revoked") ||
            errorMessage.includes("Token has been expired or revoked")
          ) {
            throw new Error(
              `Google Drive access has been revoked. Please reconnect your Google Drive account in the MCP server settings.`
            );
          }
          
          throw new Error(
            `Authentication failed and token refresh failed: ${errorMessage}`
          );
        }
      } else {
        // Get more details from the error response
        let errorDetails = `${response.status} ${response.statusText}`;
        try {
          const errorData = (await response.json()) as GoogleDriveErrorResponse;
          if (errorData.error?.message) {
            errorDetails = errorData.error.message;
          }
        } catch {
          // Ignore JSON parse errors
        }
        
        throw new Error(
          `Authentication failed: ${errorDetails}. Please reconnect your Google Drive account if the issue persists.`
        );
      }
    }

    // Handle recoverable errors with exponential backoff
    if (isRecoverableError(response.status)) {
      if (retryAttempt < MAX_RETRIES) {
        const delay = calculateBackoffDelay(retryAttempt);
        await sleep(delay);
        return makeGoogleDriveRequest<T>(
          workspaceId,
          serverId,
          url,
          options,
          retryAttempt + 1
        );
      } else {
        throw new Error(
          `Request failed after ${MAX_RETRIES} retries: ${response.status} ${response.statusText}`
        );
      }
    }

    // Handle other errors
    if (!response.ok) {
      let errorMessage = `${response.status} ${response.statusText}`;
      try {
        const errorData = (await response.json()) as GoogleDriveErrorResponse;
        errorMessage = errorData.error?.message || errorMessage;
      } catch {
        // Ignore JSON parse errors
      }
      throw new Error(`Google Drive API error: ${errorMessage}`);
    }

    return (await response.json()) as T;
  } catch (error) {
    clearTimeout(timeoutId);

    // Handle abort (timeout)
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Request timeout");
    }

    // Re-throw if it's already an Error
    if (error instanceof Error) {
      throw error;
    }

    throw new Error(`Unexpected error: ${String(error)}`);
  }
}

/**
 * List files in Google Drive
 */
export async function listFiles(
  workspaceId: string,
  serverId: string,
  query?: string,
  pageToken?: string
): Promise<GoogleDriveFileListResponse> {
  const params = new URLSearchParams({
    pageSize: "100",
    fields: "nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,size,webViewLink,parents)",
  });

  if (query) {
    params.append("q", query);
  }

  if (pageToken) {
    params.append("pageToken", pageToken);
  }

  const url = `${GOOGLE_DRIVE_API_BASE}/files?${params.toString()}`;
  return makeGoogleDriveRequest<GoogleDriveFileListResponse>(
    workspaceId,
    serverId,
    url
  );
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
  return makeGoogleDriveRequest<GoogleDriveFile>(workspaceId, serverId, url);
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
  const tokens = await getOAuthTokens(workspaceId, serverId);
  const accessToken = await ensureValidToken(workspaceId, serverId, tokens);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Handle authentication errors
      if (isAuthenticationError(response.status)) {
        try {
          const refreshed = await refreshGoogleDriveToken(tokens.refreshToken);
          await updateOAuthTokens(workspaceId, serverId, {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: refreshed.expiresAt,
          });

          // Retry with new token
          const newTokens = await getOAuthTokens(workspaceId, serverId);
          const newAccessToken = await ensureValidToken(
            workspaceId,
            serverId,
            newTokens
          );

          const retryResponse = await fetch(url, {
            headers: {
              Authorization: `Bearer ${newAccessToken}`,
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });

          if (!retryResponse.ok) {
            throw new Error(
              `Failed to read file: ${retryResponse.status} ${retryResponse.statusText}`
            );
          }

          return await retryResponse.text();
        } catch (refreshError) {
          throw new Error(
            `Authentication failed and token refresh failed: ${
              refreshError instanceof Error
                ? refreshError.message
                : String(refreshError)
            }`
          );
        }
      }

      // Handle recoverable errors
      if (isRecoverableError(response.status)) {
        // Retry with exponential backoff
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          const delay = calculateBackoffDelay(attempt);
          await sleep(delay);

          const retryResponse = await fetch(url, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });

          if (retryResponse.ok) {
            return await retryResponse.text();
          }

          if (!isRecoverableError(retryResponse.status)) {
            throw new Error(
              `Failed to read file: ${retryResponse.status} ${retryResponse.statusText}`
            );
          }
        }

        throw new Error(
          `Failed to read file after ${MAX_RETRIES} retries: ${response.status} ${response.statusText}`
        );
      }

      throw new Error(
        `Failed to read file: ${response.status} ${response.statusText}`
      );
    }

    return await response.text();
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Request timeout");
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(`Unexpected error: ${String(error)}`);
  }
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
  // Build search query
  const searchQuery = `name contains '${query.replace(/'/g, "\\'")}' or fullText contains '${query.replace(/'/g, "\\'")}'`;

  return listFiles(workspaceId, serverId, searchQuery, pageToken);
}
