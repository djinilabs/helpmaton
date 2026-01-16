import { describe, it, expect, beforeEach, vi } from "vitest";

import * as githubClient from "../github/client";
import { refreshGithubToken } from "../oauth/mcp/github";

// Mock fetch
global.fetch = vi.fn();

// Mock OAuth utilities
vi.mock("../googleApi/oauth", () => ({
  getOAuthTokens: vi.fn().mockResolvedValue({
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  }),
  ensureValidToken: vi.fn().mockResolvedValue("test-access-token"),
  updateOAuthTokens: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../oauth/mcp/github", () => ({
  refreshGithubToken: vi.fn().mockResolvedValue({
    accessToken: "refreshed-token",
    refreshToken: "refreshed-token",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  }),
}));

describe("GitHub API Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getAuthenticatedUser", () => {
    it("should get authenticated user info", async () => {
      const mockUser = {
        login: "testuser",
        id: 12345,
        name: "Test User",
        email: "test@example.com",
        avatar_url: "https://avatar.url",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockUser),
        headers: new Headers(),
      } as Partial<Response> as Response);

      const result = await githubClient.getAuthenticatedUser(
        "workspace-1",
        "server-1"
      );

      expect(result).toEqual(mockUser);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.github.com/user",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-access-token",
            Accept: "application/vnd.github.v3+json",
          }),
        })
      );
    });
  });

  describe("listRepositories", () => {
    it("should list repositories", async () => {
      const mockRepos = [
        {
          id: 1,
          name: "repo1",
          full_name: "owner/repo1",
          private: false,
          html_url: "https://github.com/owner/repo1",
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockRepos),
        headers: new Headers(),
      } as Partial<Response> as Response);

      const result = await githubClient.listRepositories(
        "workspace-1",
        "server-1"
      );

      expect(result).toEqual(mockRepos);
    });
  });

  describe("getRepository", () => {
    it("should get repository details", async () => {
      const mockRepo = {
        id: 1,
        name: "repo1",
        full_name: "owner/repo1",
        private: false,
        html_url: "https://github.com/owner/repo1",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockRepo),
        headers: new Headers(),
      } as Partial<Response> as Response);

      const result = await githubClient.getRepository(
        "workspace-1",
        "server-1",
        "owner",
        "repo1"
      );

      expect(result).toEqual(mockRepo);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/owner/repo1",
        expect.anything()
      );
    });
  });

  describe("listIssues", () => {
    it("should list repository issues", async () => {
      const mockIssues = [
        {
          id: 1,
          number: 1,
          title: "Test Issue",
          state: "open",
          html_url: "https://github.com/owner/repo/issues/1",
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockIssues),
        headers: new Headers(),
      } as Partial<Response> as Response);

      const result = await githubClient.listIssues(
        "workspace-1",
        "server-1",
        "owner",
        "repo"
      );

      expect(result).toEqual(mockIssues);
    });
  });

  describe("getFileContents", () => {
    it("should get file contents and decode base64", async () => {
      const mockFile = {
        name: "README.md",
        path: "README.md",
        sha: "abc123",
        size: 100,
        type: "file",
        content: Buffer.from("Hello World").toString("base64"),
        encoding: "base64",
        html_url: "https://github.com/owner/repo/blob/main/README.md",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockFile),
        headers: new Headers(),
      } as Partial<Response> as Response);

      const result = await githubClient.getFileContents(
        "workspace-1",
        "server-1",
        "owner",
        "repo",
        "README.md"
      );

      expect(result.content).toBe("Hello World");
      expect(result.encoding).toBe("base64");
    });

    it("should correctly encode paths with subdirectories", async () => {
      const mockFile = {
        name: "index.ts",
        path: "src/index.ts",
        sha: "abc123",
        size: 100,
        type: "file",
        content: Buffer.from("export const x = 1;").toString("base64"),
        encoding: "base64",
        html_url: "https://github.com/owner/repo/blob/main/src/index.ts",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockFile),
        headers: new Headers(),
      } as Partial<Response> as Response);

      const result = await githubClient.getFileContents(
        "workspace-1",
        "server-1",
        "owner",
        "repo",
        "src/index.ts"
      );

      // Verify the URL was constructed correctly (slashes preserved, not encoded)
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/repos/owner/repo/contents/src/index.ts"),
        expect.anything()
      );
      // Verify it does NOT contain encoded slashes
      const callArgs = vi.mocked(fetch).mock.calls[0];
      const url = callArgs[0] as string;
      expect(url).not.toContain("%2F");
      expect(url).toContain("src/index.ts");

      expect(result.content).toBe("export const x = 1;");
      expect(result.encoding).toBe("base64");
    });
  });

  describe("error handling", () => {
    it("should handle 401 errors with token refresh", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          headers: new Headers(),
        } as Partial<Response> as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ login: "testuser" }),
          headers: new Headers(),
        } as Partial<Response> as Response);

      const { updateOAuthTokens } = await import("../googleApi/oauth");

      const result = await githubClient.getAuthenticatedUser(
        "workspace-1",
        "server-1"
      );

      expect(refreshGithubToken).toHaveBeenCalled();
      expect(updateOAuthTokens).toHaveBeenCalled();
      expect(result.login).toBe("testuser");
    });

    it("should handle 429 rate limiting with retry", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          headers: new Headers([["Retry-After", "1"]]),
        } as Partial<Response> as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ login: "testuser" }),
          headers: new Headers(),
        } as Partial<Response> as Response);

      const result = await githubClient.getAuthenticatedUser(
        "workspace-1",
        "server-1"
      );

      expect(result.login).toBe("testuser");
      expect(fetch).toHaveBeenCalledTimes(2); // Initial + 1 retry
    });

    it("should throw error after max retries for 429 rate limiting", async () => {
      // Mock 4 consecutive 429 responses (MAX_RETRIES = 3, so 1 initial + 3 retries = 4 total)
      vi.mocked(fetch)
        .mockResolvedValue({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          headers: new Headers([["Retry-After", "1"]]),
        } as Partial<Response> as Response);

      await expect(
        githubClient.getAuthenticatedUser("workspace-1", "server-1")
      ).rejects.toThrow("GitHub API rate limit exceeded after");

      // Should have attempted MAX_RETRIES + 1 times (4 total: initial + 3 retries)
      expect(fetch).toHaveBeenCalledTimes(4);
    });

    it("should handle 403 forbidden errors", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: vi.fn().mockResolvedValue({
          message: "API rate limit exceeded",
        }),
        headers: new Headers(),
      } as Partial<Response> as Response);

      await expect(
        githubClient.getAuthenticatedUser("workspace-1", "server-1")
      ).rejects.toThrow("GitHub API access forbidden");
    });

    it("should handle 404 not found errors", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: vi.fn().mockResolvedValue({
          message: "Not Found",
        }),
        headers: new Headers(),
      } as Partial<Response> as Response);

      await expect(
        githubClient.getRepository("workspace-1", "server-1", "owner", "repo")
      ).rejects.toThrow("GitHub resource not found");
    });
  });
});
