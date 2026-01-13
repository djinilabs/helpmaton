import { database } from "../../tables";
import {
  calculateBackoffDelay,
  isAuthenticationError,
  isRecoverableError,
  sleep,
} from "../googleDrive/errors";
import { refreshGmailToken } from "../oauth/mcp/gmail";

import type {
  GmailErrorResponse,
  GmailMessage,
  GmailMessageHeader,
  GmailMessageListResponse,
  GmailMessagePart,
} from "./types";

const GMAIL_API_BASE = "https://www.googleapis.com/gmail/v1";
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
      const refreshed = await refreshGmailToken(tokens.refreshToken);

      // Update tokens in database
      await updateOAuthTokens(workspaceId, serverId, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
      });

      return refreshed.accessToken;
    } catch (error) {
      throw new Error(
        `Failed to refresh Gmail token: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return tokens.accessToken;
}

/**
 * Make a request to Gmail API with error handling and retry logic
 */
async function makeGmailRequest<T>(
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
          const refreshed = await refreshGmailToken(tokens.refreshToken);
          await updateOAuthTokens(workspaceId, serverId, {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: refreshed.expiresAt,
          });

          // Retry with new token
          tokens = await getOAuthTokens(workspaceId, serverId);
          return makeGmailRequest<T>(
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
              `Gmail access has been revoked. Please reconnect your Gmail account in the MCP server settings.`
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
          const errorData = (await response.json()) as GmailErrorResponse;
          if (errorData.error?.message) {
            errorDetails = errorData.error.message;
          }
        } catch {
          // Ignore JSON parse errors
        }
        
        throw new Error(
          `Authentication failed: ${errorDetails}. Please reconnect your Gmail account if the issue persists.`
        );
      }
    }

    // Handle recoverable errors with exponential backoff
    if (isRecoverableError(response.status)) {
      if (retryAttempt < MAX_RETRIES) {
        const delay = calculateBackoffDelay(retryAttempt);
        await sleep(delay);
        return makeGmailRequest<T>(
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
        const errorData = (await response.json()) as GmailErrorResponse;
        errorMessage = errorData.error?.message || errorMessage;
      } catch {
        // Ignore JSON parse errors
      }
      throw new Error(`Gmail API error: ${errorMessage}`);
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
 * Decode base64url encoded string
 */
function decodeBase64Url(str: string): string {
  // Convert base64url to base64
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding if needed
  while (base64.length % 4) {
    base64 += "=";
  }
  // Decode
  return Buffer.from(base64, "base64").toString("utf-8");
}

/**
 * Extract email body from message parts
 */
function extractEmailBody(parts: GmailMessagePart[] | undefined): {
  text?: string;
  html?: string;
} {
  const result: { text?: string; html?: string } = {};

  if (!parts) {
    return result;
  }

  for (const part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      result.text = decodeBase64Url(part.body.data);
    } else if (part.mimeType === "text/html" && part.body?.data) {
      result.html = decodeBase64Url(part.body.data);
    } else if (part.parts) {
      // Recursively check nested parts
      const nested = extractEmailBody(part.parts);
      if (nested.text && !result.text) {
        result.text = nested.text;
      }
      if (nested.html && !result.html) {
        result.html = nested.html;
      }
    }
  }

  return result;
}

/**
 * Extract headers from message
 */
function extractHeaders(
  headers: GmailMessageHeader[] | undefined
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) {
    return result;
  }
  for (const header of headers) {
    result[header.name.toLowerCase()] = header.value;
  }
  return result;
}

/**
 * List messages in Gmail
 */
export async function listMessages(
  workspaceId: string,
  serverId: string,
  query?: string,
  pageToken?: string
): Promise<GmailMessageListResponse> {
  const params = new URLSearchParams({
    maxResults: "100",
  });

  if (query) {
    params.append("q", query);
  }

  if (pageToken) {
    params.append("pageToken", pageToken);
  }

  const url = `${GMAIL_API_BASE}/users/me/messages?${params.toString()}`;
  return makeGmailRequest<GmailMessageListResponse>(workspaceId, serverId, url);
}

/**
 * Get message metadata from Gmail
 */
export async function getMessage(
  workspaceId: string,
  serverId: string,
  messageId: string
): Promise<GmailMessage> {
  const params = new URLSearchParams({
    format: "metadata",
    metadataHeaders: "From,To,Subject,Date",
  });

  const url = `${GMAIL_API_BASE}/users/me/messages/${messageId}?${params.toString()}`;
  return makeGmailRequest<GmailMessage>(workspaceId, serverId, url);
}

/**
 * Read full message content from Gmail
 */
export async function readMessage(
  workspaceId: string,
  serverId: string,
  messageId: string
): Promise<{
  id: string;
  threadId: string;
  headers: Record<string, string>;
  snippet?: string;
  body: {
    text?: string;
    html?: string;
  };
  attachments?: Array<{
    attachmentId: string;
    filename?: string;
    mimeType: string;
    size?: number;
  }>;
}> {
  const params = new URLSearchParams({
    format: "full",
  });

  const url = `${GMAIL_API_BASE}/users/me/messages/${messageId}?${params.toString()}`;
  const message = await makeGmailRequest<GmailMessage>(workspaceId, serverId, url);

  const headers = extractHeaders(message.payload?.headers);
  const bodyParts = message.payload?.parts || (message.payload ? [message.payload] : []);
  const body = extractEmailBody(bodyParts);

  // Extract attachments
  const attachments: Array<{
    attachmentId: string;
    filename?: string;
    mimeType: string;
    size?: number;
  }> = [];

  function extractAttachments(parts: GmailMessagePart[] | undefined): void {
    if (!parts) {
      return;
    }
    for (const part of parts) {
      if (part.body?.attachmentId) {
        attachments.push({
          attachmentId: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType,
          size: part.body.size,
        });
      }
      if (part.parts) {
        extractAttachments(part.parts);
      }
    }
  }

  const attachmentParts = message.payload?.parts || (message.payload ? [message.payload] : []);
  extractAttachments(attachmentParts);

  return {
    id: message.id,
    threadId: message.threadId,
    headers,
    snippet: message.snippet,
    body,
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

/**
 * Search messages in Gmail
 */
export async function searchMessages(
  workspaceId: string,
  serverId: string,
  query: string,
  pageToken?: string
): Promise<GmailMessageListResponse> {
  // Validate query parameter
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    throw new Error("Search query is required and must be a non-empty string");
  }

  return listMessages(workspaceId, serverId, query.trim(), pageToken);
}
