import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  generateGithubAuthUrl,
  exchangeGithubCode,
  refreshGithubToken,
  GitHubReconnectError,
} from "../github";

// Mock fetch
global.fetch = vi.fn();

// Mock environment variables
const originalEnv = process.env;

describe("GitHub OAuth Utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      GH_APP_ID: "123456",
      GH_APP_CLIENT_ID: "Iv1.8a61f9b3a7aba766",
      GH_APP_CLIENT_SECRET: "github-client-secret-123",
      GH_APP_PRIVATE_KEY:
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAzIsntbwyfPPFxR/u4U13UXCZkIeDGYMAizz7KixY1S8te0rM\nVeEr41ko+vm0qgopBxT/LoM0CjAfYnIEJKjmKt0BDH9YF92/trHq/jFd6y7+qaoH\ntfeOpeOSsKeZofIxP5+He/JUAQe11KCJV6xxaBmDp2uHSRTmpOXnwyoe3EL7FOBn\nxbx2WnQdqsAdHszVx0GcIssjxYkqoFJXVvGvGufCrs8gbLJ6anuCtRInjpgeEqoS\n2mbqgtleFqrDQzzY+Djadhy2uD/qlkoP+kUYSdEjqK/uCxZqiPZeT9NeIj1QnHI5\n/wk/REuWrjBbFkabsJ3gOFdqAkrc67RHIz7JjQIDAQABAoIBAEKHME9H+xPxJe5L\nyKK3U4vFgxwjN1zg4xhmqTq6WdpdEen8FiIIrwGvSkj3Vu/Hhjird6RlQFQUBWE7\nvGVAGjzuzRyHftukYGrHy6sJ24ZXLrV4fDGPZ3JFZrzWhn3KDIKpHKQP2YrMJmMW\nJBXEHM7DHbMiokn5shsIPC2aUZdKDQADm9Ka9MTnFUSChcgHG728f0OwKp0/ZSTh\nQpOrJJ6EATAWIyN2u+i2oaOwWynlAqU/+kUCXf5CO9kLkLMqE00GA/JrnIJnNyDX\nnYV4/AN58YafdolySQJDz7LSAZRtAUPrglGwqnr1xOigPSI4bmKQuI/BnPwm3PrX\nBgmgrXECgYEA6uYjtAwXg/OFMhfefo7qNaeT2Bj1zEDRnGRW6B08kq/14Gljh7UY\njsUzkWSrzPKUpIqR0Hv9cGumftyQaRhBL7xge9GrSf7XXqzq8OjJ4Ts+wx+aUIUt\nwYHayesq0/ee3VhVd9d7vPuVTnVZRXh3ZKPcMNpHrQ6uro7AhtCN2x8CgYEA3ury\nXRWOwqcpyj1TilrjNGj7xOagqdcgu3vYX1yD3hdZdadhRwgXmR8HisVZ1FyA/oZJ\nKzO+5vzSk5L7cTGgjKlPcmGT+kVlvetnf/MvxqPahQnRMZ3SiGcUckD+MEGZPeIz\nEdY8IPYhREEKg1spFrtLCgLnwr49lCMpQZaV8dMCgYAWHkOAYZ8ZOqXxGJRHwHdH\nRBdEwtzqNbRHEJ+qTY51lYIGdoX7sk60qtb3Os5+htz+PVoLkpFDs69CxMwISVNi\nBk/jeNOzLP7kmE2rD5Bq1+RKBUDHkjLDxNFwL+ehe/CGkRnDJhQtsFbXw277fqNn\nY5KJOxSCtB44q5JvX1XsKwKBgCwqzvSEhfGpX01T006RbXz/5AqCS4j7N+ANzLQw\nR2xkofP+wvZo8wwCquLi8UZzQZeskai+qu9nXm2g7LLjy1SzYytdjA1FXMBBeRNP\n4sJvyqcbZ9h11bXy/okYuYRkKvGo9Mdu9CDvw22bmXKnSD/ZwidspfDe8qJ8SPtW\n08TDAoGBALafIqFLV7CIylVpdmIKw+aELhspXcagzR+bsawUre5nI6EicWL+X2rX\n2syRgjQU0vXNplrIwEZCDFF9NQ6K1ppRwxmTNF0+l9toZkiNL8F66MjSK7swbwKw\nxayVtM5F1AAFD2cX5kVeuwI3P0+/u5ft4nSXc1nKzxXuz1kjhbUa\n-----END RSA PRIVATE KEY-----",
      OAUTH_REDIRECT_BASE_URL: "https://app.helpmaton.com",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("generateGithubAuthUrl", () => {
    it("should generate authorization URL with correct parameters", () => {
      const workspaceId = "workspace-1";
      const serverId = "server-1";

      const authUrl = generateGithubAuthUrl(workspaceId, serverId);

      expect(authUrl).toContain("https://github.com/login/oauth/authorize");
      expect(authUrl).toContain("client_id=Iv1.8a61f9b3a7aba766");
      expect(authUrl).toContain("scope=public_repo");
      expect(authUrl).toContain("redirect_uri=");
      expect(authUrl).toContain("state=");
    });

    it("should use provided state token if given", () => {
      const workspaceId = "workspace-1";
      const serverId = "server-1";
      const customState = "custom-state-token";

      const authUrl = generateGithubAuthUrl(workspaceId, serverId, customState);

      expect(authUrl).toContain(`state=${customState}`);
    });

    it("should throw error if GH_APP_ID and GH_APP_CLIENT_ID are not set", () => {
      delete process.env.GH_APP_ID;
      delete process.env.GH_APP_CLIENT_ID;

      expect(() => {
        generateGithubAuthUrl("workspace-1", "server-1");
      }).toThrow("GH_APP_CLIENT_ID or GH_APP_ID is not set");
    });
  });

  describe("exchangeGithubCode", () => {
    it("should exchange authorization code for tokens with refresh token", async () => {
      const code = "auth-code-123";
      const mockTokenResponse = {
        access_token: "github-access-token",
        token_type: "bearer",
        scope: "repo",
        refresh_token: "github-refresh-token",
        expires_in: 3600,
      };

      const mockUserResponse = {
        login: "testuser",
        email: "user@example.com",
      };

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(mockTokenResponse),
        } as Partial<Response> as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(mockUserResponse),
        } as Partial<Response> as Response);

      const result = await exchangeGithubCode(code);

      expect(fetch).toHaveBeenCalledWith(
        "https://github.com/login/oauth/access_token",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Accept: "application/json",
            "Content-Type": "application/json",
          }),
          body: expect.stringContaining("client_id"),
        })
      );

      // Verify client_secret is in the body, not JWT in Authorization header
      const callArgs = vi.mocked(fetch).mock.calls[0];
      const headers = callArgs[1]?.headers as HeadersInit;
      expect(headers).not.toHaveProperty("Authorization");
      const body = JSON.parse(callArgs[1]?.body as string);
      expect(body).toHaveProperty("client_secret", "github-client-secret-123");
      expect(body).toHaveProperty("client_id", "Iv1.8a61f9b3a7aba766");

      expect(result.accessToken).toBe("github-access-token");
      expect(result.refreshToken).toBe("github-refresh-token");
      expect(result.expiresAt).toBeDefined();
      expect(result.email).toBe("user@example.com");
    });

    it("should handle tokens without refresh token (backward compatibility)", async () => {
      const code = "auth-code-123";
      const mockTokenResponse = {
        access_token: "github-access-token",
        token_type: "bearer",
        scope: "repo",
        // No refresh_token or expires_in
      };

      const mockUserResponse = {
        login: "testuser",
        email: "user@example.com",
      };

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(mockTokenResponse),
        } as Partial<Response> as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(mockUserResponse),
        } as Partial<Response> as Response);

      const result = await exchangeGithubCode(code);

      expect(result.accessToken).toBe("github-access-token");
      expect(result.refreshToken).toBe("github-access-token"); // Falls back to access token
      expect(result.expiresAt).toBeDefined();
    });

    it("should handle tokens with expiration time", async () => {
      const code = "auth-code-123";
      const mockTokenResponse = {
        access_token: "github-access-token",
        token_type: "bearer",
        scope: "repo",
        refresh_token: "github-refresh-token",
        expires_in: 7200, // 2 hours
      };

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(mockTokenResponse),
        } as Partial<Response> as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ login: "testuser" }),
        } as Partial<Response> as Response);

      const result = await exchangeGithubCode(code);
      const expiresAtTime = new Date(result.expiresAt).getTime();
      const now = Date.now();
      const expectedExpiresAt = now + 7200 * 1000;

      // Allow 5 second tolerance for test execution time
      expect(Math.abs(expiresAtTime - expectedExpiresAt)).toBeLessThan(5000);
    });

    it("should handle missing email from user info", async () => {
      const code = "auth-code-123";
      const mockTokenResponse = {
        access_token: "github-access-token",
        token_type: "bearer",
        scope: "repo",
      };

      const mockUserResponse = {
        login: "testuser",
      };

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(mockTokenResponse),
        } as Partial<Response> as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(mockUserResponse),
        } as Partial<Response> as Response);

      const result = await exchangeGithubCode(code);

      expect(result.email).toBe("testuser"); // Falls back to login
    });

    it("should handle user info fetch failure gracefully", async () => {
      const code = "auth-code-123";
      const mockTokenResponse = {
        access_token: "github-access-token",
        token_type: "bearer",
        scope: "repo",
      };

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(mockTokenResponse),
        } as Partial<Response> as Response)
        .mockRejectedValueOnce(new Error("User info fetch failed"));

      const result = await exchangeGithubCode(code);

      expect(result.accessToken).toBe("github-access-token");
      expect(result.email).toBeUndefined();
    });

    it("should throw error if GH_APP_ID and GH_APP_CLIENT_ID are not set", async () => {
      delete process.env.GH_APP_ID;
      delete process.env.GH_APP_CLIENT_ID;

      await expect(exchangeGithubCode("code")).rejects.toThrow(
        "GH_APP_CLIENT_ID or GH_APP_ID is not set"
      );
    });

    it("should throw error if both GH_APP_ID and GH_APP_CLIENT_ID are not set", async () => {
      delete process.env.GH_APP_ID;
      delete process.env.GH_APP_CLIENT_ID;

      await expect(exchangeGithubCode("code")).rejects.toThrow(
        "GH_APP_CLIENT_ID or GH_APP_ID is not set"
      );
    });

    it("should throw error if GH_APP_CLIENT_SECRET is not set", async () => {
      delete process.env.GH_APP_CLIENT_SECRET;

      await expect(exchangeGithubCode("code")).rejects.toThrow(
        "GH_APP_CLIENT_SECRET is not set"
      );
    });

    it("should throw error if token exchange fails", async () => {
      const code = "auth-code-123";

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: vi.fn().mockResolvedValue("Bad Request"),
      } as Partial<Response> as Response);

      await expect(exchangeGithubCode(code)).rejects.toThrow(
        "Failed to exchange GitHub code"
      );
    });

    it("should throw error if access token is missing", async () => {
      const code = "auth-code-123";
      const mockTokenResponse = {
        token_type: "bearer",
        scope: "repo",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockTokenResponse),
      } as Partial<Response> as Response);

      await expect(exchangeGithubCode(code)).rejects.toThrow(
        "No access token received from GitHub"
      );
    });
  });

  describe("refreshGithubToken", () => {
    it("should refresh token using refresh token", async () => {
      const refreshToken = "github-refresh-token";
      const mockRefreshResponse = {
        access_token: "new-github-access-token",
        token_type: "bearer",
        scope: "repo",
        refresh_token: "new-github-refresh-token",
        expires_in: 3600,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockRefreshResponse),
      } as Partial<Response> as Response);

      const result = await refreshGithubToken(refreshToken);

      expect(fetch).toHaveBeenCalledWith(
        "https://github.com/login/oauth/access_token",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Accept: "application/json",
            "Content-Type": "application/json",
          }),
          body: expect.stringContaining("refresh_token"),
        })
      );

      expect(result.accessToken).toBe("new-github-access-token");
      expect(result.refreshToken).toBe("new-github-refresh-token");
      expect(result.expiresAt).toBeDefined();

      // Verify client_secret is in the body, not JWT in Authorization header
      const callArgs = vi.mocked(fetch).mock.calls[0];
      const headers = callArgs[1]?.headers as HeadersInit;
      expect(headers).not.toHaveProperty("Authorization");
      const body = JSON.parse(callArgs[1]?.body as string);
      expect(body).toHaveProperty("client_secret", "github-client-secret-123");
      expect(body).toHaveProperty("client_id", "Iv1.8a61f9b3a7aba766");
      expect(body).toHaveProperty("grant_type", "refresh_token");
    });

    it("should handle refresh token that doesn't return new refresh token", async () => {
      const refreshToken = "github-refresh-token";
      const mockRefreshResponse = {
        access_token: "new-github-access-token",
        token_type: "bearer",
        scope: "repo",
        expires_in: 3600,
        // No refresh_token in response
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockRefreshResponse),
      } as Partial<Response> as Response);

      const result = await refreshGithubToken(refreshToken);

      expect(result.accessToken).toBe("new-github-access-token");
      expect(result.refreshToken).toBe(refreshToken); // Keeps existing refresh token
    });

    it("should throw error if refresh token is invalid", async () => {
      const refreshToken = "invalid-refresh-token";

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({
          error: "invalid_grant",
          error_description: "The refresh token is invalid or expired",
        }),
      } as Partial<Response> as Response);

      await expect(refreshGithubToken(refreshToken)).rejects.toThrow(
        GitHubReconnectError
      );
    });

    it("should throw error if GH_APP_ID and GH_APP_CLIENT_ID are not set", async () => {
      delete process.env.GH_APP_ID;
      delete process.env.GH_APP_CLIENT_ID;

      await expect(refreshGithubToken("token")).rejects.toThrow(
        "GH_APP_CLIENT_ID or GH_APP_ID is not set"
      );
    });

    it("should throw error if GH_APP_CLIENT_SECRET is not set", async () => {
      delete process.env.GH_APP_CLIENT_SECRET;

      await expect(refreshGithubToken("token")).rejects.toThrow(
        "GH_APP_CLIENT_SECRET is not set"
      );
    });
  });
});
