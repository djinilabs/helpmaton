import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import * as googleCalendarClient from "../../utils/googleCalendar/client";

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
  return tool({
    description:
      "List events from Google Calendar. Returns a list of events with their metadata (id, summary, start, end, etc.). Supports pagination with pageToken and optional time range filtering.",
    parameters: z.object({
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
        .optional()
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
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Google Calendar is not connected. Please connect your Google Calendar account first.";
        }

        const result = await googleCalendarClient.listEvents(
          workspaceId,
          serverId,
          args.calendarId || "primary",
          {
            timeMin: args.timeMin,
            timeMax: args.timeMax,
            maxResults: args.maxResults,
            pageToken: args.pageToken,
            orderBy: args.orderBy,
            singleEvents: args.singleEvents,
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
  return tool({
    description:
      "Read the full details of an event from Google Calendar. Returns the complete event with all metadata including summary, description, start/end times, attendees, location, etc.",
    parameters: z.object({
      eventId: z.string().describe("The Google Calendar event ID to read"),
      calendarId: z
        .string()
        .optional()
        .default("primary")
        .describe("Calendar ID (default: 'primary' for user's primary calendar)"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Google Calendar is not connected. Please connect your Google Calendar account first.";
        }

        // Extract eventId - handle both camelCase and snake_case
        const eventId = args.eventId || args.event_id;
        if (!eventId || typeof eventId !== "string" || eventId.trim().length === 0) {
          console.error("[Google Calendar Read Tool] Missing or invalid eventId:", {
            args,
            eventId,
            hasEventId: !!args.eventId,
            hasEvent_id: !!args.event_id,
          });
          return "Error: eventId parameter is required and must be a non-empty string. Please provide the event ID as 'eventId' (not 'event_id').";
        }

        // Log tool call for debugging
        console.log("[Tool Call] google_calendar_read", {
          toolName: "google_calendar_read",
          arguments: { eventId, calendarId: args.calendarId || "primary" },
          workspaceId,
          serverId,
        });

        // Read full event content
        const event = await googleCalendarClient.readEvent(
          workspaceId,
          serverId,
          args.calendarId || "primary",
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
  return tool({
    description:
      "Search for events in Google Calendar by query string. Returns a list of matching events with their metadata. REQUIRES a 'query' parameter with the search term. The query searches in event summary, description, and location fields.",
    parameters: z.object({
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
        .optional()
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
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Google Calendar is not connected. Please connect your Google Calendar account first.";
        }

        // Validate args structure
        if (!args || typeof args !== "object") {
          return "Error: Search requires a 'query' parameter. Please provide a search query string.";
        }

        // Extract and validate query parameter
        const query = args.query;
        if (!query || typeof query !== "string" || query.trim().length === 0) {
          return "Error: Search requires a non-empty 'query' parameter. Please provide a search query string. Example: {query: 'meeting'}";
        }

        // Log tool call for debugging
        console.log("[Tool Call] google_calendar_search", {
          toolName: "google_calendar_search",
          arguments: { query, calendarId: args.calendarId || "primary" },
          workspaceId,
          serverId,
        });

        const result = await googleCalendarClient.searchEvents(
          workspaceId,
          serverId,
          query,
          args.calendarId || "primary",
          {
            timeMin: args.timeMin,
            timeMax: args.timeMax,
            maxResults: args.maxResults,
            pageToken: args.pageToken,
            orderBy: args.orderBy,
            singleEvents: args.singleEvents,
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
  return tool({
    description:
      "Create a new event in Google Calendar. Returns the created event with all metadata including the event ID.",
    parameters: z.object({
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
      start: z
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
        .describe("REQUIRED: Event start time"),
      end: z
        .object({
          dateTime: z
            .string()
            .optional()
            .describe("End time in RFC3339 format (e.g., '2024-01-01T11:00:00Z')"),
          date: z
            .string()
            .optional()
            .describe("End date in YYYY-MM-DD format (for all-day events)"),
          timeZone: z
            .string()
            .optional()
            .describe("IANA timezone (e.g., 'America/New_York')"),
        })
        .describe("REQUIRED: Event end time"),
      attendees: z
        .array(
          z.object({
            email: z.string().email().describe("Attendee email address"),
            displayName: z.string().optional().describe("Attendee display name"),
          })
        )
        .optional()
        .describe("List of event attendees"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Google Calendar is not connected. Please connect your Google Calendar account first.";
        }

        // Validate required fields
        if (!args.summary || typeof args.summary !== "string" || args.summary.trim().length === 0) {
          return "Error: 'summary' parameter is required and must be a non-empty string.";
        }

        if (!args.start || !args.end) {
          return "Error: Both 'start' and 'end' parameters are required.";
        }

        // Log tool call for debugging
        console.log("[Tool Call] google_calendar_create", {
          toolName: "google_calendar_create",
          arguments: { summary: args.summary, calendarId: args.calendarId || "primary" },
          workspaceId,
          serverId,
        });

        const event = await googleCalendarClient.createEvent(
          workspaceId,
          serverId,
          args.calendarId || "primary",
          {
            summary: args.summary,
            description: args.description,
            location: args.location,
            start: args.start,
            end: args.end,
            attendees: args.attendees,
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
  return tool({
    description:
      "Update an existing event in Google Calendar. Returns the updated event with all metadata. Only provide fields that should be updated.",
    parameters: z.object({
      eventId: z.string().describe("REQUIRED: The Google Calendar event ID to update"),
      calendarId: z
        .string()
        .optional()
        .default("primary")
        .describe("Calendar ID (default: 'primary' for user's primary calendar)"),
      summary: z.string().optional().describe("Event title/summary"),
      description: z.string().optional().describe("Event description"),
      location: z.string().optional().describe("Event location"),
      start: z
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
        .optional()
        .describe("Event start time"),
      end: z
        .object({
          dateTime: z
            .string()
            .optional()
            .describe("End time in RFC3339 format (e.g., '2024-01-01T11:00:00Z')"),
          date: z
            .string()
            .optional()
            .describe("End date in YYYY-MM-DD format (for all-day events)"),
          timeZone: z
            .string()
            .optional()
            .describe("IANA timezone (e.g., 'America/New_York')"),
        })
        .optional()
        .describe("Event end time"),
      attendees: z
        .array(
          z.object({
            email: z.string().email().describe("Attendee email address"),
            displayName: z.string().optional().describe("Attendee display name"),
          })
        )
        .optional()
        .describe("List of event attendees"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Google Calendar is not connected. Please connect your Google Calendar account first.";
        }

        // Extract eventId - handle both camelCase and snake_case
        const eventId = args.eventId || args.event_id;
        if (!eventId || typeof eventId !== "string" || eventId.trim().length === 0) {
          console.error("[Google Calendar Update Tool] Missing or invalid eventId:", {
            args,
            eventId,
            hasEventId: !!args.eventId,
            hasEvent_id: !!args.event_id,
          });
          return "Error: eventId parameter is required and must be a non-empty string. Please provide the event ID as 'eventId' (not 'event_id').";
        }

        // Log tool call for debugging
        console.log("[Tool Call] google_calendar_update", {
          toolName: "google_calendar_update",
          arguments: { eventId, calendarId: args.calendarId || "primary" },
          workspaceId,
          serverId,
        });

        // Build update object with only provided fields
        const updateData: Record<string, unknown> = {};
        if (args.summary !== undefined) updateData.summary = args.summary;
        if (args.description !== undefined) updateData.description = args.description;
        if (args.location !== undefined) updateData.location = args.location;
        if (args.start !== undefined) updateData.start = args.start;
        if (args.end !== undefined) updateData.end = args.end;
        if (args.attendees !== undefined) updateData.attendees = args.attendees;

        const event = await googleCalendarClient.updateEvent(
          workspaceId,
          serverId,
          args.calendarId || "primary",
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
  return tool({
    description:
      "Delete an event from Google Calendar. Returns a success message if the event was deleted.",
    parameters: z.object({
      eventId: z.string().describe("REQUIRED: The Google Calendar event ID to delete"),
      calendarId: z
        .string()
        .optional()
        .default("primary")
        .describe("Calendar ID (default: 'primary' for user's primary calendar)"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Google Calendar is not connected. Please connect your Google Calendar account first.";
        }

        // Extract eventId - handle both camelCase and snake_case
        const eventId = args.eventId || args.event_id;
        if (!eventId || typeof eventId !== "string" || eventId.trim().length === 0) {
          console.error("[Google Calendar Delete Tool] Missing or invalid eventId:", {
            args,
            eventId,
            hasEventId: !!args.eventId,
            hasEvent_id: !!args.event_id,
          });
          return "Error: eventId parameter is required and must be a non-empty string. Please provide the event ID as 'eventId' (not 'event_id').";
        }

        // Log tool call for debugging
        console.log("[Tool Call] google_calendar_delete", {
          toolName: "google_calendar_delete",
          arguments: { eventId, calendarId: args.calendarId || "primary" },
          workspaceId,
          serverId,
        });

        await googleCalendarClient.deleteEvent(
          workspaceId,
          serverId,
          args.calendarId || "primary",
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
