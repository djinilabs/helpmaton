/**
 * Google Calendar API types
 */

export interface GoogleCalendarErrorResponse {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

export interface GoogleCalendarDateTime {
  date?: string; // Date only (YYYY-MM-DD)
  dateTime?: string; // ISO 8601 datetime
  timeZone?: string; // IANA timezone (e.g., "America/New_York")
}

export interface GoogleCalendarAttendee {
  email: string;
  displayName?: string;
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
  organizer?: boolean;
  self?: boolean;
}

export interface GoogleCalendarEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleCalendarDateTime;
  end?: GoogleCalendarDateTime;
  attendees?: GoogleCalendarAttendee[];
  organizer?: {
    email?: string;
    displayName?: string;
    self?: boolean;
  };
  created?: string;
  updated?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  htmlLink?: string;
  iCalUID?: string;
  recurrence?: string[];
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{
      method: "email" | "popup";
      minutes: number;
    }>;
  };
  colorId?: string;
  visibility?: "default" | "public" | "private" | "confidential";
  transparency?: "opaque" | "transparent";
}

export interface GoogleCalendarEventListResponse {
  kind: "calendar#events";
  etag: string;
  summary?: string;
  description?: string;
  updated: string;
  timeZone?: string;
  accessRole?: string;
  defaultReminders?: Array<{
    method: string;
    minutes: number;
  }>;
  nextPageToken?: string;
  nextSyncToken?: string;
  items?: GoogleCalendarEvent[];
}
