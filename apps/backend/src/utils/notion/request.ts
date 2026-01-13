import {
  calculateBackoffDelay,
  isAuthenticationError,
  isRecoverableError,
  sleep,
} from "../googleApi/errors";
import type { OAuthTokens, RefreshTokenFunction } from "../googleApi/oauth";
import { refreshNotionToken } from "../oauth/mcp/notion";

export interface NotionApiRequestConfig {
  workspaceId: string;
  serverId: string;
  url: string;
  options?: RequestInit;
  refreshTokenFn?: RefreshTokenFunction;
  maxRetries?: number;
  requestTimeoutMs?: number;
  responseType?: "json" | "text";
}

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000; // 30 seconds
const NOTION_API_VERSION = "2025-09-03";

/**
 * Make a request to Notion API with error handling and retry logic
 */
export async function makeNotionApiRequest<T>(
  config: NotionApiRequestConfig
): Promise<T> {
  const {
    workspaceId,
    serverId,
    url,
    options = {},
    refreshTokenFn = refreshNotionToken,
    maxRetries = DEFAULT_MAX_RETRIES,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    responseType = "json",
  } = config;

  return makeRequestWithRetry<T>(
    workspaceId,
    serverId,
    url,
    options,
    refreshTokenFn,
    maxRetries,
    requestTimeoutMs,
    0,
    responseType
  );
}

async function makeRequestWithRetry<T>(
  workspaceId: string,
  serverId: string,
  url: string,
  options: RequestInit,
  refreshTokenFn: RefreshTokenFunction,
  maxRetries: number,
  requestTimeoutMs: number,
  retryAttempt: number,
  responseType: "json" | "text" = "json"
): Promise<T> {
  // Import here to avoid circular dependency
  const { getOAuthTokens, ensureValidToken, updateOAuthTokens } = await import("../googleApi/oauth");

  // Get OAuth tokens
  let tokens: OAuthTokens = await getOAuthTokens(workspaceId, serverId);

  // Ensure token is valid (refresh if needed)
  const accessToken = await ensureValidToken(
    workspaceId,
    serverId,
    tokens,
    refreshTokenFn
  );

  // Create abort signal for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Notion-Version": NOTION_API_VERSION,
        ...(responseType === "json" && { "Content-Type": "application/json" }),
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
          const refreshed = await refreshTokenFn(tokens.refreshToken);
          await updateOAuthTokens(workspaceId, serverId, {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: refreshed.expiresAt,
          });

          // Retry with new token
          tokens = await getOAuthTokens(workspaceId, serverId);
          return makeRequestWithRetry<T>(
            workspaceId,
            serverId,
            url,
            options,
            refreshTokenFn,
            maxRetries,
            requestTimeoutMs,
            retryAttempt + 1,
            responseType
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
              `Notion API access has been revoked. Please reconnect your account in the MCP server settings.`
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
          const errorData = (await response.json()) as {
            code?: string;
            message?: string;
          };
          if (errorData.message) {
            errorDetails = errorData.message;
          } else if (errorData.code) {
            errorDetails = errorData.code;
          }
        } catch {
          // Ignore JSON parse errors
        }

        throw new Error(
          `Authentication failed: ${errorDetails}. Please reconnect your account if the issue persists.`
        );
      }
    }

    // Handle recoverable errors with exponential backoff
    if (isRecoverableError(response.status)) {
      if (retryAttempt < maxRetries) {
        const delay = calculateBackoffDelay(retryAttempt);
        await sleep(delay);
        return makeRequestWithRetry<T>(
          workspaceId,
          serverId,
          url,
          options,
          refreshTokenFn,
          maxRetries,
          requestTimeoutMs,
          retryAttempt + 1,
          responseType
        );
      } else {
        throw new Error(
          `Request failed after ${maxRetries} retries: ${response.status} ${response.statusText}`
        );
      }
    }

    // Handle other errors
    if (!response.ok) {
      let errorMessage = `${response.status} ${response.statusText}`;
      try {
        const errorData = (await response.json()) as {
          code?: string;
          message?: string;
        };
        if (errorData.message) {
          errorMessage = errorData.message;
        } else if (errorData.code) {
          errorMessage = errorData.code;
        }
      } catch {
        // Ignore JSON parse errors
      }
      throw new Error(`Notion API error: ${errorMessage}`);
    }

    // Handle response based on type
    if (responseType === "text") {
      return (await response.text()) as T;
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
