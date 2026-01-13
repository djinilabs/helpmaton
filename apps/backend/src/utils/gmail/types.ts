/**
 * Gmail API message representation
 */
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
  sizeEstimate?: number;
}

/**
 * Gmail API message part (for multipart messages)
 */
export interface GmailMessagePart {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: GmailMessageHeader[];
  body?: GmailMessageBody;
  parts?: GmailMessagePart[];
}

/**
 * Gmail API message header
 */
export interface GmailMessageHeader {
  name: string;
  value: string;
}

/**
 * Gmail API message body
 */
export interface GmailMessageBody {
  attachmentId?: string;
  size?: number;
  data?: string; // base64url encoded
}

/**
 * Gmail API message list response
 */
export interface GmailMessageListResponse {
  messages?: Array<{
    id: string;
    threadId: string;
  }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

/**
 * Gmail API error response
 */
export interface GmailErrorResponse {
  error: {
    code: number;
    message: string;
    errors?: Array<{
      domain?: string;
      reason?: string;
      message?: string;
      locationType?: string;
      location?: string;
    }>;
  };
}
