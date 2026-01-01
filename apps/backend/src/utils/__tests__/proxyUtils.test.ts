import { badRequest, internal } from "@hapi/boom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { parseProxyUrl, getRandomProxyUrl } from "../proxyUtils";

describe("proxyUtils", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      DECODO_PROXY_URLS: JSON.stringify([
        "http://user1:pass1@gate.decodo.com:10001",
        "http://user2:pass2@gate.decodo.com:10002",
      ]),
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe("parseProxyUrl", () => {
    it("should parse proxy URL with username and password", () => {
      const proxyUrl = "http://user1:pass1@gate.decodo.com:10001";
      const parsed = parseProxyUrl(proxyUrl);
      expect(parsed.server).toBe("http://gate.decodo.com:10001");
      expect(parsed.username).toBe("user1");
      expect(parsed.password).toBe("pass1");
    });

    it("should parse proxy URL without credentials", () => {
      const proxyUrl = "http://gate.decodo.com:10001";
      const parsed = parseProxyUrl(proxyUrl);
      expect(parsed.server).toBe("http://gate.decodo.com:10001");
      expect(parsed.username).toBeUndefined();
      expect(parsed.password).toBeUndefined();
    });

    it("should parse proxy URL with only username", () => {
      const proxyUrl = "http://user1@gate.decodo.com:10001";
      const parsed = parseProxyUrl(proxyUrl);
      expect(parsed.server).toBe("http://gate.decodo.com:10001");
      expect(parsed.username).toBe("user1");
      expect(parsed.password).toBeUndefined();
    });

    it("should handle HTTPS proxy URLs", () => {
      const proxyUrl = "https://user1:pass1@gate.decodo.com:10001";
      const parsed = parseProxyUrl(proxyUrl);
      expect(parsed.server).toBe("https://gate.decodo.com:10001");
      expect(parsed.username).toBe("user1");
      expect(parsed.password).toBe("pass1");
    });

    it("should throw error for invalid URL format", () => {
      const invalidUrl = "not-a-url";
      expect(() => parseProxyUrl(invalidUrl)).toThrow(
        badRequest(`Invalid proxy URL format: ${invalidUrl}`)
      );
    });
  });

  describe("getRandomProxyUrl", () => {
    it("should return a valid proxy URL from environment variable", () => {
      const proxyUrl = getRandomProxyUrl();
      expect(proxyUrl).toMatch(/^http:\/\/.*@gate\.decodo\.com:\d+$/);
    });

    it("should randomly select different proxy URLs", () => {
      const selections = new Set<string>();
      for (let i = 0; i < 10; i++) {
        selections.add(getRandomProxyUrl());
      }

      // With 2 proxy URLs, we should see both selected at least once in 10 tries
      expect(selections.size).toBeGreaterThanOrEqual(1);
    });

    it("should throw error if DECODO_PROXY_URLS is not set", () => {
      delete process.env.DECODO_PROXY_URLS;
      expect(() => getRandomProxyUrl()).toThrow(
        internal("DECODO_PROXY_URLS environment variable is not set")
      );
    });

    it("should throw error if DECODO_PROXY_URLS is invalid JSON", () => {
      process.env.DECODO_PROXY_URLS = "invalid json";
      expect(() => getRandomProxyUrl()).toThrow(
        internal("DECODO_PROXY_URLS must be a valid JSON array of strings")
      );
    });

    it("should throw error if DECODO_PROXY_URLS is empty array", () => {
      process.env.DECODO_PROXY_URLS = "[]";
      expect(() => getRandomProxyUrl()).toThrow(
        internal("DECODO_PROXY_URLS must be a non-empty array")
      );
    });

    it("should throw error if DECODO_PROXY_URLS contains non-string items", () => {
      process.env.DECODO_PROXY_URLS = JSON.stringify([
        "http://user1:pass1@gate.decodo.com:10001",
        123, // Invalid: not a string
      ]);
      expect(() => getRandomProxyUrl()).toThrow(
        internal("All items in DECODO_PROXY_URLS must be strings")
      );
    });
  });
});

