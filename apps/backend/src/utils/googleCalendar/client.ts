import { makeGoogleApiRequest } from "../googleApi/request";
import { refreshGoogleCalendarToken } from "../oauth/mcp/google-calendar";

import type {
  GoogleCalendarEvent,
  GoogleCalendarEventListResponse,
} from "./types";

const GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

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
  return makeGoogleApiRequest<GoogleCalendarEventListResponse>({
    workspaceId,
    serverId,
    url,
    refreshTokenFn: refreshGoogleCalendarToken,
  });
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
  return makeGoogleApiRequest<GoogleCalendarEvent>({
    workspaceId,
    serverId,
    url,
    refreshTokenFn: refreshGoogleCalendarToken,
  });
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
  
  return makeGoogleApiRequest<GoogleCalendarEvent>({
    workspaceId,
    serverId,
    url,
    options: {
      method: "POST",
      body: JSON.stringify(event),
    },
    refreshTokenFn: refreshGoogleCalendarToken,
  });
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
  
  return makeGoogleApiRequest<GoogleCalendarEvent>({
    workspaceId,
    serverId,
    url,
    options: {
      method: "PUT",
      body: JSON.stringify(event),
    },
    refreshTokenFn: refreshGoogleCalendarToken,
  });
}

/**
 * Delete an event from Google Calendar
 */
export async function deleteEvent(
  workspaceId: string,
  serverId: string,
  calendarId: string,
  eventId: string
): Promise<string> {
  const url = `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  
  // Google returns an empty response body for deletes; capture text for diagnostics.
  const response = await makeGoogleApiRequest<string>({
    workspaceId,
    serverId,
    url,
    options: {
      method: "DELETE",
    },
    responseType: "text",
    refreshTokenFn: refreshGoogleCalendarToken,
  });
  return response;
}
