import { describe, it, expect, beforeEach, vi } from "vitest";

import * as googleApiRequest from "../../googleApi/request";
import {
  listMessages,
  getMessage,
  readMessage,
  searchMessages,
} from "../client";

// Mock the shared request utility
vi.mock("../../googleApi/request", () => ({
  makeGoogleApiRequest: vi.fn(),
}));

describe("Gmail Client", () => {
  const workspaceId = "workspace-1";
  const serverId = "server-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listMessages", () => {
    it("should list messages without query", async () => {
      const mockResponse = {
        messages: [{ id: "msg1" }, { id: "msg2" }],
        nextPageToken: "token123",
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockResponse
      );

      const result = await listMessages(workspaceId, serverId);

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          serverId,
          url: expect.stringContaining("/users/me/messages"),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("should list messages with query", async () => {
      const mockResponse = {
        messages: [{ id: "msg1" }],
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockResponse
      );

      const result = await listMessages(workspaceId, serverId, "from:test@example.com");

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining("q=from%3Atest%40example.com"),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("should list messages with page token", async () => {
      const mockResponse = {
        messages: [{ id: "msg3" }],
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockResponse
      );

      const result = await listMessages(workspaceId, serverId, undefined, "token123");

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining("pageToken=token123"),
        })
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("getMessage", () => {
    it("should get message metadata", async () => {
      const messageId = "msg123";
      const mockMessage = {
        id: messageId,
        threadId: "thread1",
        snippet: "Test snippet",
        payload: {
          headers: [
            { name: "From", value: "test@example.com" },
            { name: "Subject", value: "Test" },
          ],
        },
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockMessage
      );

      const result = await getMessage(workspaceId, serverId, messageId);

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          serverId,
          url: expect.stringContaining(`/messages/${messageId}`),
        })
      );
      expect(result).toEqual(mockMessage);
    });
  });

  describe("readMessage", () => {
    it("should read full message content", async () => {
      const messageId = "msg123";
      const mockMessage = {
        id: messageId,
        threadId: "thread1",
        snippet: "Test snippet",
        payload: {
          headers: [
            { name: "From", value: "test@example.com" },
            { name: "To", value: "recipient@example.com" },
            { name: "Subject", value: "Test" },
            { name: "Date", value: "Mon, 1 Jan 2024 00:00:00 +0000" },
          ],
          parts: [
            {
              mimeType: "text/plain",
              body: {
                data: "SGVsbG8gV29ybGQ=", // "Hello World" in base64url
              },
            },
          ],
        },
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockMessage
      );

      const result = await readMessage(workspaceId, serverId, messageId);

      expect(result.id).toBe(messageId);
      expect(result.threadId).toBe("thread1");
      expect(result.headers.from).toBe("test@example.com");
      expect(result.headers.to).toBe("recipient@example.com");
      expect(result.body.text).toBe("Hello World");
    });

    it("should extract HTML body", async () => {
      const mockMessage = {
        id: "msg123",
        threadId: "thread1",
        payload: {
          parts: [
            {
              mimeType: "text/html",
              body: {
                data: "PGgxPkhlbGxvPC9oMT4=", // "<h1>Hello</h1>" in base64url
              },
            },
          ],
        },
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockMessage
      );

      const result = await readMessage(workspaceId, serverId, "msg123");

      expect(result.body.html).toBe("<h1>Hello</h1>");
    });

    it("should extract attachments", async () => {
      const mockMessage = {
        id: "msg123",
        threadId: "thread1",
        payload: {
          parts: [
            {
              mimeType: "text/plain",
              body: { data: "SGVsbG8=" },
            },
            {
              mimeType: "application/pdf",
              filename: "document.pdf",
              body: {
                attachmentId: "att123",
                size: 1024,
              },
            },
          ],
        },
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockMessage
      );

      const result = await readMessage(workspaceId, serverId, "msg123");

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments?.[0]).toEqual({
        attachmentId: "att123",
        filename: "document.pdf",
        mimeType: "application/pdf",
        size: 1024,
      });
    });
  });

  describe("searchMessages", () => {
    it("should search messages with query", async () => {
      const mockResponse = {
        messages: [{ id: "msg1" }],
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockResponse
      );

      const result = await searchMessages(workspaceId, serverId, "test query");

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining("q=test+query"),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("should trim query string", async () => {
      const mockResponse = {
        messages: [],
      };

      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockResolvedValue(
        mockResponse
      );

      await searchMessages(workspaceId, serverId, "  test query  ");

      expect(googleApiRequest.makeGoogleApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining("q=test+query"),
        })
      );
    });

    it("should throw error for empty query", async () => {
      await expect(
        searchMessages(workspaceId, serverId, "")
      ).rejects.toThrow("Search query is required");
    });

    it("should throw error for whitespace-only query", async () => {
      await expect(
        searchMessages(workspaceId, serverId, "   ")
      ).rejects.toThrow("Search query is required");
    });
  });

  describe("error handling", () => {
    it("should propagate errors from request utility", async () => {
      const error = new Error("Request failed");
      vi.mocked(googleApiRequest.makeGoogleApiRequest).mockRejectedValue(error);

      await expect(
        listMessages(workspaceId, serverId)
      ).rejects.toThrow("Request failed");
    });
  });
});
