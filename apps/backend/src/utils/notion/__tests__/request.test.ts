import { describe, it, expect, beforeEach, vi } from "vitest";

import * as oauth from "../../googleApi/oauth";
import { makeNotionApiRequest } from "../request";

// Mock fetch
global.fetch = vi.fn();

// Mock oauth module
vi.mock("../../googleApi/oauth", () => ({
  getOAuthTokens: vi.fn(),
  ensureValidToken: vi.fn(),
  updateOAuthTokens: vi.fn(),
}));

// Mock refresh token function
vi.mock("../../oauth/mcp/notion", () => ({
  refreshNotionToken: vi.fn(),
}));

describe("Notion API Request Utility", () => {
  const mockRefreshTokenFn = vi.fn();
  const config = {
    workspaceId: "workspace-1",
    serverId: "server-1",
    url: "https://api.notion.com/v1/test",
    refreshTokenFn: mockRefreshTokenFn,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(oauth.getOAuthTokens).mockResolvedValue({
      accessToken: "notion-access-token",
      refreshToken: "notion-refresh-token",
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    });
    vi.mocked(oauth.ensureValidToken).mockResolvedValue("notion-access-token");
  });

  describe("successful requests", () => {
    it("should make successful request and return JSON", async () => {
      const mockResponse = { object: "page", id: "page-123" };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: vi.fn().mockResolvedValue(mockResponse),
      } as Partial<Response> as Response);

      const result = await makeNotionApiRequest(config);

      expect(fetch).toHaveBeenCalledWith(
        config.url,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer notion-access-token",
            "Notion-Version": "2025-09-03",
            "Content-Type": "application/json",
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("should include custom headers", async () => {
      const mockResponse = { object: "page", id: "page-123" };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: vi.fn().mockResolvedValue(mockResponse),
      } as Partial<Response> as Response);

      await makeNotionApiRequest({
        ...config,
        options: {
          headers: {
            "Custom-Header": "value",
          },
        },
      });

      expect(fetch).toHaveBeenCalledWith(
        config.url,
        expect.objectContaining({
          headers: expect.objectContaining({
            "Custom-Header": "value",
            "Notion-Version": "2025-09-03",
          }),
        })
      );
    });

    it("should handle text response type", async () => {
      const mockText = "text response";
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: vi.fn().mockResolvedValue(mockText),
      } as Partial<Response> as Response);

      const result = await makeNotionApiRequest({
        ...config,
        responseType: "text",
      });

      expect(result).toBe(mockText);
    });
  });

  describe("retry on recoverable errors", () => {
    it("should retry on 429 (Too Many Requests) with exponential backoff", async () => {
      const mockResponse = { object: "page", id: "page-123" };
      let callCount = 0;

      vi.mocked(fetch).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
          } as Partial<Response> as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: vi.fn().mockResolvedValue(mockResponse),
        } as Partial<Response> as Response);
      });

      const result = await makeNotionApiRequest(config);

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockResponse);
    });

    it("should retry on 503 (Service Unavailable)", async () => {
      const mockResponse = { object: "page", id: "page-123" };
      let callCount = 0;

      vi.mocked(fetch).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 503,
            statusText: "Service Unavailable",
          } as Partial<Response> as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: vi.fn().mockResolvedValue(mockResponse),
        } as Partial<Response> as Response);
      });

      const result = await makeNotionApiRequest(config);

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockResponse);
    });

    it("should throw error after max retries", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      } as Partial<Response> as Response);

      await expect(
        makeNotionApiRequest({ ...config, maxRetries: 2 })
      ).rejects.toThrow("Request failed after 2 retries");
    });
  });

  describe("authentication errors", () => {
    it("should refresh token and retry on 401", async () => {
      const mockResponse = { object: "page", id: "page-123" };
      let callCount = 0;

      vi.mocked(fetch).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 401,
            statusText: "Unauthorized",
          } as Partial<Response> as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: vi.fn().mockResolvedValue(mockResponse),
        } as Partial<Response> as Response);
      });

      mockRefreshTokenFn.mockResolvedValue({
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      });

      vi.mocked(oauth.getOAuthTokens).mockResolvedValueOnce({
        accessToken: "notion-access-token",
        refreshToken: "notion-refresh-token",
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      });

      const result = await makeNotionApiRequest(config);

      expect(mockRefreshTokenFn).toHaveBeenCalledWith("notion-refresh-token");
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockResponse);
    });

    it("should throw error if token refresh fails", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      } as Partial<Response> as Response);

      mockRefreshTokenFn.mockRejectedValue(new Error("Token refresh failed"));

      await expect(makeNotionApiRequest(config)).rejects.toThrow(
        "Authentication failed and token refresh failed"
      );
    });
  });

  describe("error handling", () => {
    it("should handle timeout errors", async () => {
      const controller = new AbortController();
      vi.mocked(fetch).mockImplementation(() => {
        controller.abort();
        return Promise.reject(new Error("AbortError"));
      });

      // Mock AbortError
      const abortError = new Error("AbortError");
      abortError.name = "AbortError";
      vi.mocked(fetch).mockRejectedValue(abortError);

      await expect(
        makeNotionApiRequest({ ...config, requestTimeoutMs: 100 })
      ).rejects.toThrow("Request timeout");
    });

    it("should handle Notion API error responses", async () => {
      const errorResponse = {
        object: "error",
        status: 404,
        code: "object_not_found",
        message: "Page not found",
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: vi.fn().mockResolvedValue(errorResponse),
      } as Partial<Response> as Response);

      await expect(makeNotionApiRequest(config)).rejects.toThrow(
        "Notion API error: Page not found"
      );
    });
  });
});
