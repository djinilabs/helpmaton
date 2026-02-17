import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import * as googleCalendarClient from "../../utils/googleCalendar/client";

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
 * Create Google Calendar list events tool
 */
export function createGoogleCalendarListTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      calendarId: z
        .string()
        .optional()
        .default("primary")
        .describe("Calendar ID (default: 'primary' for user's primary calendar)"),
      timeMin: z
        .string()
        .optional()
        .describe(
          "Lower bound (exclusive) for an event's start time in RFC3339 format (e.g., '2024-01-01T00:00:00Z')"
        ),
      timeMax: z
        .string()
        .optional()
        .describe(
          "Upper bound (exclusive) for an event's end time in RFC3339 format (e.g., '2024-12-31T23:59:59Z')"
        ),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(2500)
        .default(100)
        .describe("Maximum number of events to return (default: 100, max: 2500)"),
      pageToken: z
        .string()
        .optional()
        .describe(
          "Token specifying which result page to return (from previous list response)"
        ),
      orderBy: z
        .enum(["startTime", "updated"])
        .optional()
        .describe(
          "Order of events returned (default: 'startTime' if timeMin is set, otherwise 'updated')"
        ),
      singleEvents: z
        .boolean()
        .optional()
        .describe(
          "Whether to expand recurring events into instances (default: false)"
        ),
    })
    .strict();

  return tool({
    description:
      "List events from Google Calendar. Returns a list of events with their metadata (id, summary, start, end, etc.). Supports pagination with pageToken and optional time range filtering.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Google Calendar is not connected. Please connect your Google Calendar account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const result = await googleCalendarClient.listEvents(
          workspaceId,
          serverId,
          parsed.data.calendarId || "primary",
          {
            timeMin: parsed.data.timeMin,
            timeMax: parsed.data.timeMax,
            maxResults: parsed.data.maxResults,
            pageToken: parsed.data.pageToken,
            orderBy: parsed.data.orderBy,
            singleEvents: parsed.data.singleEvents,
          }
        );

        return JSON.stringify(
          {
            events: result.items || [],
            nextPageToken: result.nextPageToken,
            summary: result.summary,
            timeZone: result.timeZone,
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Google Calendar list tool:", error);
        return `Error listing Google Calendar events: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create Google Calendar read event tool
 */
export function createGoogleCalendarReadTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      eventId: z.string().optional().describe("The Google Calendar event ID to read"),
      event_id: z.string().optional().describe("Alias for eventId"),
      calendarId: z
        .string()
        .optional()
        .default("primary")
        .describe("Calendar ID (default: 'primary' for user's primary calendar)"),
    })
    .strict()
    .refine((data) => data.eventId || data.event_id, {
      message:
        "eventId parameter is required and must be a non-empty string. Provide the event ID as 'eventId'.",
      path: ["eventId"],
    });

  return tool({
    description:
      "Read the full details of an event from Google Calendar. Returns the complete event with all metadata including summary, description, start/end times, attendees, location, etc. Use google_calendar_list or google_calendar_search to find the eventId.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Google Calendar is not connected. Please connect your Google Calendar account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        // Extract eventId - handle both camelCase and snake_case
        const eventId = parsed.data.eventId || parsed.data.event_id;
        if (!eventId || typeof eventId !== "string" || eventId.trim().length === 0) {
          console.error("[Google Calendar Read Tool] Missing or invalid eventId:", {
            args: parsed.data,
            eventId,
            hasEventId: !!parsed.data.eventId,
            hasEvent_id: !!parsed.data.event_id,
          });
          return "Error: eventId parameter is required and must be a non-empty string. Provide the event ID as 'eventId' or 'event_id'.";
        }

        // Log tool call for debugging
        console.log("[Tool Call] google_calendar_read", {
          toolName: "google_calendar_read",
          arguments: {
            eventId,
            calendarId: parsed.data.calendarId || "primary",
          },
          workspaceId,
          serverId,
        });

        // Read full event content
        const event = await googleCalendarClient.readEvent(
          workspaceId,
          serverId,
          parsed.data.calendarId || "primary",
          eventId
        );

        return JSON.stringify(
          {
            event,
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Google Calendar read tool:", error);
        return `Error reading Google Calendar event: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create Google Calendar search events tool
 */
export function createGoogleCalendarSearchTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      query: z
        .string()
        .min(1, "Search query cannot be empty")
        .describe(
          "REQUIRED: Search query string to find events by summary, description, or location. Example: 'meeting' or 'project review'"
        ),
      calendarId: z
        .string()
        .optional()
        .default("primary")
        .describe("Calendar ID (default: 'primary' for user's primary calendar)"),
      timeMin: z
        .string()
        .optional()
        .describe(
          "Lower bound (exclusive) for an event's start time in RFC3339 format (e.g., '2024-01-01T00:00:00Z')"
        ),
      timeMax: z
        .string()
        .optional()
        .describe(
          "Upper bound (exclusive) for an event's end time in RFC3339 format (e.g., '2024-12-31T23:59:59Z')"
        ),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(2500)
        .default(100)
        .describe("Maximum number of events to return (default: 100, max: 2500)"),
      pageToken: z
        .string()
        .optional()
        .describe(
          "Token specifying which result page to return (from previous search response)"
        ),
      orderBy: z
        .enum(["startTime", "updated"])
        .optional()
        .describe(
          "Order of events returned (default: 'startTime' if timeMin is set, otherwise 'updated')"
        ),
      singleEvents: z
        .boolean()
        .optional()
        .describe(
          "Whether to expand recurring events into instances (default: false)"
        ),
    })
    .strict();

  return tool({
    description:
      "Search for events in Google Calendar by query string. Returns a list of matching events with their metadata. REQUIRES a 'query' parameter with the search term. The query searches in event summary, description, and location fields.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Google Calendar is not connected. Please connect your Google Calendar account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        // Log tool call for debugging
        console.log("[Tool Call] google_calendar_search", {
          toolName: "google_calendar_search",
          arguments: {
            query: parsed.data.query,
            calendarId: parsed.data.calendarId || "primary",
          },
          workspaceId,
          serverId,
        });

        const result = await googleCalendarClient.searchEvents(
          workspaceId,
          serverId,
          parsed.data.query,
          parsed.data.calendarId || "primary",
          {
            timeMin: parsed.data.timeMin,
            timeMax: parsed.data.timeMax,
            maxResults: parsed.data.maxResults,
            pageToken: parsed.data.pageToken,
            orderBy: parsed.data.orderBy,
            singleEvents: parsed.data.singleEvents,
          }
        );

        return JSON.stringify(
          {
            events: result.items || [],
            nextPageToken: result.nextPageToken,
            summary: result.summary,
            timeZone: result.timeZone,
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Google Calendar search tool:", error);
        return `Error searching Google Calendar events: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create Google Calendar create event tool
 */
export function createGoogleCalendarCreateTool(
  workspaceId: string,
  serverId: string
) {
  const eventTimeSchema = z
    .object({
      dateTime: z
        .string()
        .optional()
        .describe("Start time in RFC3339 format (e.g., '2024-01-01T10:00:00Z')"),
      date: z
        .string()
        .optional()
        .describe("Start date in YYYY-MM-DD format (for all-day events)"),
      timeZone: z
        .string()
        .optional()
        .describe("IANA timezone (e.g., 'America/New_York')"),
    })
    .strict();

  const attendeeSchema = z
    .object({
      email: z.string().email().describe("Attendee email address"),
      displayName: z.string().optional().describe("Attendee display name"),
    })
    .strict();

  const schema = z
    .object({
      calendarId: z
        .string()
        .optional()
        .default("primary")
        .describe("Calendar ID (default: 'primary' for user's primary calendar)"),
      summary: z
        .string()
        .min(1, "Summary cannot be empty")
        .describe("REQUIRED: Event title/summary"),
      description: z.string().optional().describe("Event description"),
      location: z.string().optional().describe("Event location"),
      start: eventTimeSchema.describe("REQUIRED: Event start time"),
      end: eventTimeSchema.describe("REQUIRED: Event end time"),
      attendees: z.array(attendeeSchema).optional().describe("List of event attendees"),
    })
    .strict();

  return tool({
    description:
      "Create a new event in Google Calendar. Returns the created event with all metadata including the event ID. Example: {\"summary\":\"Team sync\",\"start\":{\"dateTime\":\"2024-06-01T10:00:00-07:00\",\"timeZone\":\"America/Los_Angeles\"},\"end\":{\"dateTime\":\"2024-06-01T10:30:00-07:00\",\"timeZone\":\"America/Los_Angeles\"}}",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Google Calendar is not connected. Please connect your Google Calendar account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        // Log tool call for debugging
        console.log("[Tool Call] google_calendar_create", {
          toolName: "google_calendar_create",
          arguments: {
            summary: parsed.data.summary,
            calendarId: parsed.data.calendarId || "primary",
          },
          workspaceId,
          serverId,
        });

        const event = await googleCalendarClient.createEvent(
          workspaceId,
          serverId,
          parsed.data.calendarId || "primary",
          {
            summary: parsed.data.summary,
            description: parsed.data.description,
            location: parsed.data.location,
            start: parsed.data.start,
            end: parsed.data.end,
            attendees: parsed.data.attendees,
          }
        );

        return JSON.stringify(
          {
            event,
            message: "Event created successfully",
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Google Calendar create tool:", error);
        return `Error creating Google Calendar event: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create Google Calendar update event tool
 */
export function createGoogleCalendarUpdateTool(
  workspaceId: string,
  serverId: string
) {
  const eventTimeSchema = z
    .object({
      dateTime: z
        .string()
        .optional()
        .describe("Start time in RFC3339 format (e.g., '2024-01-01T10:00:00Z')"),
      date: z
        .string()
        .optional()
        .describe("Start date in YYYY-MM-DD format (for all-day events)"),
      timeZone: z
        .string()
        .optional()
        .describe("IANA timezone (e.g., 'America/New_York')"),
    })
    .strict();

  const attendeeSchema = z
    .object({
      email: z.string().email().describe("Attendee email address"),
      displayName: z.string().optional().describe("Attendee display name"),
    })
    .strict();

  const schema = z
    .object({
      eventId: z
        .string()
        .optional()
        .describe("REQUIRED: The Google Calendar event ID to update"),
      event_id: z.string().optional().describe("Alias for eventId"),
      calendarId: z
        .string()
        .optional()
        .default("primary")
        .describe("Calendar ID (default: 'primary' for user's primary calendar)"),
      summary: z.string().optional().describe("Event title/summary"),
      description: z.string().optional().describe("Event description"),
      location: z.string().optional().describe("Event location"),
      start: eventTimeSchema.optional().describe("Event start time"),
      end: eventTimeSchema.optional().describe("Event end time"),
      attendees: z.array(attendeeSchema).optional().describe("List of event attendees"),
    })
    .strict()
    .refine((data) => data.eventId || data.event_id, {
      message:
        "eventId parameter is required and must be a non-empty string. Provide the event ID as 'eventId'.",
      path: ["eventId"],
    });

  return tool({
    description:
      "Update an existing event in Google Calendar. Returns the updated event with all metadata. Only provide fields that should be updated. Example: {\"eventId\":\"EVENT_ID\",\"start\":{\"dateTime\":\"2024-06-01T11:00:00-07:00\",\"timeZone\":\"America/Los_Angeles\"},\"end\":{\"dateTime\":\"2024-06-01T11:30:00-07:00\",\"timeZone\":\"America/Los_Angeles\"}}",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Google Calendar is not connected. Please connect your Google Calendar account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        // Extract eventId - handle both camelCase and snake_case
        const eventId = parsed.data.eventId || parsed.data.event_id;
        if (!eventId || typeof eventId !== "string" || eventId.trim().length === 0) {
          console.error("[Google Calendar Update Tool] Missing or invalid eventId:", {
            args: parsed.data,
            eventId,
            hasEventId: !!parsed.data.eventId,
            hasEvent_id: !!parsed.data.event_id,
          });
          return "Error: eventId parameter is required and must be a non-empty string. Provide the event ID as 'eventId' or 'event_id'.";
        }

        // Log tool call for debugging
        console.log("[Tool Call] google_calendar_update", {
          toolName: "google_calendar_update",
          arguments: { eventId, calendarId: parsed.data.calendarId || "primary" },
          workspaceId,
          serverId,
        });

        // Build update object with only provided fields
        const updateData: Record<string, unknown> = {};
        if (parsed.data.summary !== undefined) updateData.summary = parsed.data.summary;
        if (parsed.data.description !== undefined)
          updateData.description = parsed.data.description;
        if (parsed.data.location !== undefined) updateData.location = parsed.data.location;
        if (parsed.data.start !== undefined) updateData.start = parsed.data.start;
        if (parsed.data.end !== undefined) updateData.end = parsed.data.end;
        if (parsed.data.attendees !== undefined)
          updateData.attendees = parsed.data.attendees;

        const event = await googleCalendarClient.updateEvent(
          workspaceId,
          serverId,
          parsed.data.calendarId || "primary",
          eventId,
          updateData
        );

        return JSON.stringify(
          {
            event,
            message: "Event updated successfully",
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Google Calendar update tool:", error);
        return `Error updating Google Calendar event: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create Google Calendar delete event tool
 */
export function createGoogleCalendarDeleteTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      eventId: z
        .string()
        .optional()
        .describe("REQUIRED: The Google Calendar event ID to delete"),
      event_id: z.string().optional().describe("Alias for eventId"),
      calendarId: z
        .string()
        .optional()
        .default("primary")
        .describe("Calendar ID (default: 'primary' for user's primary calendar)"),
    })
    .strict()
    .refine((data) => data.eventId || data.event_id, {
      message:
        "eventId parameter is required and must be a non-empty string. Provide the event ID as 'eventId'.",
      path: ["eventId"],
    });

  return tool({
    description:
      "Delete an event from Google Calendar. Returns a success message if the event was deleted.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Google Calendar is not connected. Please connect your Google Calendar account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        // Extract eventId - handle both camelCase and snake_case
        const eventId = parsed.data.eventId || parsed.data.event_id;
        if (!eventId || typeof eventId !== "string" || eventId.trim().length === 0) {
          console.error("[Google Calendar Delete Tool] Missing or invalid eventId:", {
            args: parsed.data,
            eventId,
            hasEventId: !!parsed.data.eventId,
            hasEvent_id: !!parsed.data.event_id,
          });
          return "Error: eventId parameter is required and must be a non-empty string. Provide the event ID as 'eventId' or 'event_id'.";
        }

        // Log tool call for debugging
        console.log("[Tool Call] google_calendar_delete", {
          toolName: "google_calendar_delete",
          arguments: { eventId, calendarId: parsed.data.calendarId || "primary" },
          workspaceId,
          serverId,
        });

        await googleCalendarClient.deleteEvent(
          workspaceId,
          serverId,
          parsed.data.calendarId || "primary",
          eventId
        );

        return JSON.stringify(
          {
            message: "Event deleted successfully",
            eventId,
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Google Calendar delete tool:", error);
        return `Error deleting Google Calendar event: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}
