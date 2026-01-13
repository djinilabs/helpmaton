import { describe, it, expect, beforeEach, vi } from "vitest";

import * as oauth from "../oauth";
import { makeGoogleApiRequest } from "../request";

// Mock fetch
global.fetch = vi.fn();

// Mock oauth module
vi.mock("../oauth", () => ({
  getOAuthTokens: vi.fn(),
  ensureValidToken: vi.fn(),
  updateOAuthTokens: vi.fn(),
}));

describe("Google API Request Utility", () => {
  const mockRefreshTokenFn = vi.fn();
  const config = {
    workspaceId: "workspace-1",
    serverId: "server-1",
    url: "https://www.googleapis.com/test",
    refreshTokenFn: mockRefreshTokenFn,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(oauth.getOAuthTokens).mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    });
    vi.mocked(oauth.ensureValidToken).mockResolvedValue("access-token");
  });

  describe("successful requests", () => {
    it("should make successful request and return JSON", async () => {
      const mockResponse = { data: "test" };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: vi.fn().mockResolvedValue(mockResponse),
      } as Partial<Response> as Response);

      const result = await makeGoogleApiRequest(config);

      expect(fetch).toHaveBeenCalledWith(
        config.url,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer access-token",
            "Content-Type": "application/json",
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("should include custom headers", async () => {
      const mockResponse = { data: "test" };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: vi.fn().mockResolvedValue(mockResponse),
      } as Partial<Response> as Response);

      await makeGoogleApiRequest({
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
          }),
        })
      );
    });
  });

  describe("retry on recoverable errors", () => {
    it("should retry on 429 (Too Many Requests) with exponential backoff", async () => {
      const mockResponse = { data: "success" };
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

      // Mock sleep to avoid actual delays
      vi.spyOn(await import("../errors"), "sleep").mockResolvedValue(undefined);

      const result = await makeGoogleApiRequest(config);

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockResponse);
    });

    it("should retry on 500 (Internal Server Error)", async () => {
      const mockResponse = { data: "success" };
      let callCount = 0;

      vi.mocked(fetch).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
          } as Partial<Response> as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: vi.fn().mockResolvedValue(mockResponse),
        } as Partial<Response> as Response);
      });

      vi.spyOn(await import("../errors"), "sleep").mockResolvedValue(undefined);

      const result = await makeGoogleApiRequest(config);

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockResponse);
    });

    it("should retry on 502, 503, 504", async () => {
      const statusCodes = [502, 503, 504];

      for (const statusCode of statusCodes) {
        vi.clearAllMocks();
        const mockResponse = { data: "success" };
        let callCount = 0;

        vi.mocked(fetch).mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({
              ok: false,
              status: statusCode,
              statusText: "Error",
            } as Partial<Response> as Response);
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: "OK",
            json: vi.fn().mockResolvedValue(mockResponse),
          } as Partial<Response> as Response);
        });

        vi.spyOn(await import("../errors"), "sleep").mockResolvedValue(
          undefined
        );

        const result = await makeGoogleApiRequest(config);

        expect(fetch).toHaveBeenCalledTimes(2);
        expect(result).toEqual(mockResponse);
      }
    });

    it("should throw error after max retries exceeded", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      } as Partial<Response> as Response);

      vi.spyOn(await import("../errors"), "sleep").mockResolvedValue(undefined);

      await expect(
        makeGoogleApiRequest({ ...config, maxRetries: 2 })
      ).rejects.toThrow("Request failed after 2 retries");
    });
  });

  describe("authentication errors", () => {
    it("should refresh token and retry on 401", async () => {
      const mockResponse = { data: "success" };
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
        refreshToken: "refresh-token",
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      });

      vi.mocked(oauth.getOAuthTokens)
        .mockResolvedValueOnce({
          accessToken: "old-token",
          refreshToken: "refresh-token",
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        })
        .mockResolvedValueOnce({
          accessToken: "new-access-token",
          refreshToken: "refresh-token",
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        });

      const result = await makeGoogleApiRequest(config);

      expect(mockRefreshTokenFn).toHaveBeenCalledWith("refresh-token");
      expect(oauth.updateOAuthTokens).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockResponse);
    });

    it("should throw user-friendly error on token revocation", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      } as Partial<Response> as Response);

      mockRefreshTokenFn.mockRejectedValue(
        new Error("invalid_grant: Token has been expired or revoked")
      );

      await expect(makeGoogleApiRequest(config)).rejects.toThrow(
        "Google API access has been revoked"
      );
    });

    it("should throw error if authentication fails after retry", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: vi.fn().mockResolvedValue({
          error: { message: "Invalid credentials" },
        }),
      } as Partial<Response> as Response);

      mockRefreshTokenFn.mockResolvedValue({
        accessToken: "new-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      });

      vi.mocked(oauth.getOAuthTokens)
        .mockResolvedValueOnce({
          accessToken: "old-token",
          refreshToken: "refresh-token",
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        })
        .mockResolvedValueOnce({
          accessToken: "new-token",
          refreshToken: "refresh-token",
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        });

      await expect(makeGoogleApiRequest(config)).rejects.toThrow(
        "Authentication failed"
      );
    });
  });

  describe("non-retryable errors", () => {
    it("should throw immediately on 400 (Bad Request)", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: vi.fn().mockResolvedValue({
          error: { message: "Invalid request" },
        }),
      } as Partial<Response> as Response);

      await expect(makeGoogleApiRequest(config)).rejects.toThrow(
        "Google API error: Invalid request"
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("should throw immediately on 404 (Not Found)", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as Partial<Response> as Response);

      await expect(makeGoogleApiRequest(config)).rejects.toThrow(
        "Google API error"
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("timeout handling", () => {
    it("should throw error on timeout", async () => {
      const controller = new AbortController();
      vi.mocked(fetch).mockImplementation(() => {
        controller.abort();
        return Promise.reject(new DOMException("Aborted", "AbortError"));
      });

      await expect(makeGoogleApiRequest(config)).rejects.toThrow(
        "Request timeout"
      );
    });
  });

  describe("custom configuration", () => {
    it("should use custom max retries", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      } as Partial<Response> as Response);

      vi.spyOn(await import("../errors"), "sleep").mockResolvedValue(undefined);

      await expect(
        makeGoogleApiRequest({ ...config, maxRetries: 3 })
      ).rejects.toThrow("Request failed after 3 retries");
    });

    it("should use custom timeout", async () => {
      const controller = new AbortController();
      vi.mocked(fetch).mockImplementation(() => {
        controller.abort();
        return Promise.reject(new DOMException("Aborted", "AbortError"));
      });

      await expect(
        makeGoogleApiRequest({ ...config, requestTimeoutMs: 5000 })
      ).rejects.toThrow("Request timeout");
    });
  });
});
