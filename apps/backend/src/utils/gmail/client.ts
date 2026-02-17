import { makeGoogleApiRequest } from "../googleApi/request";
import { refreshGmailToken } from "../oauth/mcp/gmail";

import type {
  GmailMessage,
  GmailMessageHeader,
  GmailMessageListResponse,
  GmailMessagePart,
} from "./types";

const GMAIL_API_BASE = "https://www.googleapis.com/gmail/v1";

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
 * @param maxResults - Max 500, default 100 if not provided
 */
export async function listMessages(
  workspaceId: string,
  serverId: string,
  query?: string,
  pageToken?: string,
  maxResults?: number
): Promise<GmailMessageListResponse> {
  const params = new URLSearchParams({
    maxResults: String(
      maxResults !== undefined && maxResults >= 1 && maxResults <= 500
        ? maxResults
        : 100
    ),
  });

  if (query) {
    params.append("q", query);
  }

  if (pageToken) {
    params.append("pageToken", pageToken);
  }

  const url = `${GMAIL_API_BASE}/users/me/messages?${params.toString()}`;
  return makeGoogleApiRequest<GmailMessageListResponse>({
    workspaceId,
    serverId,
    url,
    refreshTokenFn: refreshGmailToken,
  });
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
  return makeGoogleApiRequest<GmailMessage>({
    workspaceId,
    serverId,
    url,
    refreshTokenFn: refreshGmailToken,
  });
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
  const message = await makeGoogleApiRequest<GmailMessage>({
    workspaceId,
    serverId,
    url,
    refreshTokenFn: refreshGmailToken,
  });

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
