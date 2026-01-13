import { describe, it, expect, beforeEach, vi } from "vitest";

import * as googleApiRequest from "../../googleApi/request";
import {
  listEvents,
  getEvent,
  readEvent,
  searchEvents,
  createEvent,
  updateEvent,
  deleteEvent,
} from "../client";

// Mock the shared request utility
vi.mock("../../googleApi/request", () => ({
  makeGoogleApiRequest: vi.fn(),
}));

describe("Google Calendar Client", () => {
  const workspaceId = "workspace-1";
  const serverId = "server-1";
  const calendarId = "primary";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listEvents", () => {
    it("should list events from calendar", async () => {
      const mockResponse = {
        items: [
          {
            id: "event1",
            summary: "Meeting",
            start: { dateTime: "2024-01-01T10:00:00Z" },
          },
        ],
        nextPageToken: "token123",
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockResponse
      );

      const result = await listEvents(workspaceId, serverId, calendarId);

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          serverId,
          url: expect.stringContaining(`/calendars/${encodeURIComponent(calendarId)}/events`),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("should list events with time range", async () => {
      const mockResponse = {
        items: [],
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockResponse
      );

      const timeMin = "2024-01-01T00:00:00Z";
      const timeMax = "2024-01-31T23:59:59Z";

      await listEvents(workspaceId, serverId, calendarId, {
        timeMin,
        timeMax,
      });

      const callUrl = vi.mocked(googleApiRequest.makeGoogleApiRequest).mock.calls[0][0].url;
      expect(callUrl).toContain(`timeMin=${encodeURIComponent(timeMin)}`);
      expect(callUrl).toContain(`timeMax=${encodeURIComponent(timeMax)}`);
    });

    it("should use default calendar (primary) when not specified", async () => {
      const mockResponse = {
        items: [],
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockResponse
      );

      await listEvents(workspaceId, serverId);

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining("/calendars/primary/events"),
        })
      );
    });
  });

  describe("getEvent", () => {
    it("should get event metadata", async () => {
      const eventId = "event123";
      const mockEvent = {
        id: eventId,
        summary: "Test Event",
        start: { dateTime: "2024-01-01T10:00:00Z" },
        end: { dateTime: "2024-01-01T11:00:00Z" },
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockEvent
      );

      const result = await getEvent(workspaceId, serverId, calendarId, eventId);

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          serverId,
          url: expect.stringContaining(`/events/${encodeURIComponent(eventId)}`),
        })
      );
      expect(result).toEqual(mockEvent);
    });
  });

  describe("readEvent", () => {
    it("should read full event details", async () => {
      const eventId = "event123";
      const mockEvent = {
        id: eventId,
        summary: "Test Event",
        description: "Event description",
        start: { dateTime: "2024-01-01T10:00:00Z" },
        end: { dateTime: "2024-01-01T11:00:00Z" },
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockEvent
      );

      const result = await readEvent(workspaceId, serverId, calendarId, eventId);

      expect(result).toEqual(mockEvent);
    });
  });

  describe("searchEvents", () => {
    it("should search events with query", async () => {
      const mockResponse = {
        items: [
          {
            id: "event1",
            summary: "Meeting",
          },
        ],
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockResponse
      );

      const result = await searchEvents(workspaceId, serverId, "meeting", calendarId);

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining("q=meeting"),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("should trim query string", async () => {
      const mockResponse = {
        items: [],
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockResponse
      );

      await searchEvents(workspaceId, serverId, "  meeting  ", calendarId);

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining("q=meeting"),
        })
      );
    });

    it("should throw error for empty query", async () => {
      await expect(
        searchEvents(workspaceId, serverId, "", calendarId)
      ).rejects.toThrow("Search query is required");
    });

    it("should throw error for whitespace-only query", async () => {
      await expect(
        searchEvents(workspaceId, serverId, "   ", calendarId)
      ).rejects.toThrow("Search query is required");
    });
  });

  describe("createEvent", () => {
    it("should create new event", async () => {
      const eventData = {
        summary: "New Event",
        start: { dateTime: "2024-01-01T10:00:00Z" },
        end: { dateTime: "2024-01-01T11:00:00Z" },
      };
      const mockEvent = {
        id: "event123",
        ...eventData,
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockEvent
      );

      const result = await createEvent(workspaceId, serverId, calendarId, eventData);

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          serverId,
          url: expect.stringContaining(`/calendars/${encodeURIComponent(calendarId)}/events`),
          options: expect.objectContaining({
            method: "POST",
            body: JSON.stringify(eventData),
          }),
        })
      );
      expect(result).toEqual(mockEvent);
    });

    it("should use default calendar (primary) when not specified", async () => {
      const eventData = {
        summary: "New Event",
        start: { dateTime: "2024-01-01T10:00:00Z" },
        end: { dateTime: "2024-01-01T11:00:00Z" },
      };
      const mockEvent = {
        id: "event123",
        ...eventData,
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockEvent
      );

      await createEvent(workspaceId, serverId, undefined, eventData);

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining("/calendars/primary/events"),
        })
      );
    });
  });

  describe("updateEvent", () => {
    it("should update existing event", async () => {
      const eventId = "event123";
      const eventData = {
        summary: "Updated Event",
      };
      const mockEvent = {
        id: eventId,
        ...eventData,
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockEvent
      );

      const result = await updateEvent(
        workspaceId,
        serverId,
        calendarId,
        eventId,
        eventData
      );

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          serverId,
          url: expect.stringContaining(`/events/${encodeURIComponent(eventId)}`),
          options: expect.objectContaining({
            method: "PUT",
            body: JSON.stringify(eventData),
          }),
        })
      );
      expect(result).toEqual(mockEvent);
    });
  });

  describe("deleteEvent", () => {
    it("should delete event", async () => {
      const eventId = "event123";

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        undefined as void
      );

      await deleteEvent(workspaceId, serverId, calendarId, eventId);

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          serverId,
          url: expect.stringContaining(`/events/${encodeURIComponent(eventId)}`),
          options: expect.objectContaining({
            method: "DELETE",
          }),
        })
      );
    });
  });

  describe("error handling", () => {
    it("should propagate errors from request utility", async () => {
      const error = new Error("Request failed");
      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockRejectedValue(error);

      await expect(
        listEvents(workspaceId, serverId, calendarId)
      ).rejects.toThrow("Request failed");
    });
  });
});
