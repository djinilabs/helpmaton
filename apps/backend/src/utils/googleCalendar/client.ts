import { database } from "../../tables";
import {
  calculateBackoffDelay,
  isAuthenticationError,
  isRecoverableError,
  sleep,
} from "../googleDrive/errors";
import { refreshGoogleCalendarToken } from "../oauth/mcp/google-calendar";

import type {
  GoogleCalendarErrorResponse,
  GoogleCalendarEvent,
  GoogleCalendarEventListResponse,
} from "./types";

const GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
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
      const refreshed = await refreshGoogleCalendarToken(tokens.refreshToken);

      // Update tokens in database
      await updateOAuthTokens(workspaceId, serverId, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
      });

      return refreshed.accessToken;
    } catch (error) {
      throw new Error(
        `Failed to refresh Google Calendar token: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return tokens.accessToken;
}

/**
 * Make a request to Google Calendar API with error handling and retry logic
 */
async function makeCalendarRequest<T>(
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
          const refreshed = await refreshGoogleCalendarToken(tokens.refreshToken);
          await updateOAuthTokens(workspaceId, serverId, {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: refreshed.expiresAt,
          });

          // Retry with new token
          tokens = await getOAuthTokens(workspaceId, serverId);
          return makeCalendarRequest<T>(
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
              `Google Calendar access has been revoked. Please reconnect your Google Calendar account in the MCP server settings.`
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
          const errorData = (await response.json()) as GoogleCalendarErrorResponse;
          if (errorData.error?.message) {
            errorDetails = errorData.error.message;
          }
        } catch {
          // Ignore JSON parse errors
        }
        
        throw new Error(
          `Authentication failed: ${errorDetails}. Please reconnect your Google Calendar account if the issue persists.`
        );
      }
    }

    // Handle recoverable errors with exponential backoff
    if (isRecoverableError(response.status)) {
      if (retryAttempt < MAX_RETRIES) {
        const delay = calculateBackoffDelay(retryAttempt);
        await sleep(delay);
        return makeCalendarRequest<T>(
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
        const errorData = (await response.json()) as GoogleCalendarErrorResponse;
        errorMessage = errorData.error?.message || errorMessage;
      } catch {
        // Ignore JSON parse errors
      }
      throw new Error(`Google Calendar API error: ${errorMessage}`);
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
 * List events from a calendar
 */
export async function listEvents(
  workspaceId: string,
  serverId: string,
  calendarId: string = "primary",
  options?: {
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
    pageToken?: string;
    q?: string;
    orderBy?: "startTime" | "updated";
    singleEvents?: boolean;
  }
): Promise<GoogleCalendarEventListResponse> {
  const params = new URLSearchParams({
    calendarId,
  });

  if (options?.timeMin) {
    params.append("timeMin", options.timeMin);
  }
  if (options?.timeMax) {
    params.append("timeMax", options.timeMax);
  }
  if (options?.maxResults) {
    params.append("maxResults", String(options.maxResults));
  } else {
    params.append("maxResults", "100");
  }
  if (options?.pageToken) {
    params.append("pageToken", options.pageToken);
  }
  if (options?.q) {
    params.append("q", options.q);
  }
  if (options?.orderBy) {
    params.append("orderBy", options.orderBy);
  }
  if (options?.singleEvents !== undefined) {
    params.append("singleEvents", String(options.singleEvents));
  }

  const url = `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
  return makeCalendarRequest<GoogleCalendarEventListResponse>(
    workspaceId,
    serverId,
    url
  );
}

/**
 * Get event metadata from Google Calendar
 */
export async function getEvent(
  workspaceId: string,
  serverId: string,
  calendarId: string,
  eventId: string
): Promise<GoogleCalendarEvent> {
  const url = `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  return makeCalendarRequest<GoogleCalendarEvent>(workspaceId, serverId, url);
}

/**
 * Read full event details from Google Calendar
 */
export async function readEvent(
  workspaceId: string,
  serverId: string,
  calendarId: string = "primary",
  eventId: string
): Promise<GoogleCalendarEvent> {
  return getEvent(workspaceId, serverId, calendarId, eventId);
}

/**
 * Search events in Google Calendar
 */
export async function searchEvents(
  workspaceId: string,
  serverId: string,
  query: string,
  calendarId: string = "primary",
  options?: {
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
    pageToken?: string;
    orderBy?: "startTime" | "updated";
    singleEvents?: boolean;
  }
): Promise<GoogleCalendarEventListResponse> {
  // Validate query parameter
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    throw new Error("Search query is required and must be a non-empty string");
  }

  return listEvents(workspaceId, serverId, calendarId, {
    ...options,
    q: query.trim(),
  });
}

/**
 * Create a new event in Google Calendar
 */
export async function createEvent(
  workspaceId: string,
  serverId: string,
  calendarId: string = "primary",
  event: Partial<GoogleCalendarEvent>
): Promise<GoogleCalendarEvent> {
  const url = `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
  
  return makeCalendarRequest<GoogleCalendarEvent>(
    workspaceId,
    serverId,
    url,
    {
      method: "POST",
      body: JSON.stringify(event),
    }
  );
}

/**
 * Update an existing event in Google Calendar
 */
export async function updateEvent(
  workspaceId: string,
  serverId: string,
  calendarId: string,
  eventId: string,
  event: Partial<GoogleCalendarEvent>
): Promise<GoogleCalendarEvent> {
  const url = `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  
  return makeCalendarRequest<GoogleCalendarEvent>(
    workspaceId,
    serverId,
    url,
    {
      method: "PUT",
      body: JSON.stringify(event),
    }
  );
}

/**
 * Delete an event from Google Calendar
 */
export async function deleteEvent(
  workspaceId: string,
  serverId: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const url = `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  
  await makeCalendarRequest<void>(
    workspaceId,
    serverId,
    url,
    {
      method: "DELETE",
    }
  );
}
