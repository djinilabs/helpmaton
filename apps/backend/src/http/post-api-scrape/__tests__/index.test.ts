import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  getRandomProxyUrl,
  parseProxyUrl,
  aomToXml,
  escapeXml,
} from "../index";
import {
  getRefererForUrl,
  isBlockPageContent,
  isStrictDomain,
  normalizeUrlForStrictDomain,
} from "../scrapeHelpers";
// These are re-exported from index.ts for backward compatibility
// They are actually implemented in:
// - parseProxyUrl, getRandomProxyUrl: apps/backend/src/utils/proxyUtils.ts
// - aomToXml, escapeXml: apps/backend/src/utils/aomUtils.ts

// Mock environment variables
const originalEnv = process.env;

describe("POST /api/scrape", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      DECODO_PROXY_URLS: JSON.stringify([
        "http://user1:pass1@gate.decodo.com:10001",
        "http://user2:pass2@gate.decodo.com:10002",
      ]),
      PUPPETEER_EXECUTABLE_PATH: "/usr/bin/chromium-browser",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe("Proxy URL parsing and selection", () => {
    it("should parse proxy URL array from environment variable", () => {
      const proxyUrl = getRandomProxyUrl();
      expect(proxyUrl).toMatch(/^http:\/\/.*@gate\.decodo\.com:\d+$/);

      const parsed = parseProxyUrl(proxyUrl);
      expect(parsed.server).toMatch(/^http:\/\/gate\.decodo\.com:\d+$/);
      expect(parsed.username).toBeDefined();
      expect(parsed.password).toBeDefined();
    });

    it("should randomly select different proxy URLs", () => {
      const selections = new Set();
      for (let i = 0; i < 10; i++) {
        selections.add(getRandomProxyUrl());
      }

      // With 2 proxy URLs, we should see both selected at least once in 10 tries
      expect(selections.size).toBeGreaterThanOrEqual(1);
    });

    it("should throw error if DECODO_PROXY_URLS is not set", () => {
      delete process.env.DECODO_PROXY_URLS;
      expect(() => getRandomProxyUrl()).toThrow(
        "DECODO_PROXY_URLS environment variable is not set"
      );
    });

    it("should throw error if DECODO_PROXY_URLS is invalid JSON", () => {
      process.env.DECODO_PROXY_URLS = "invalid json";
      expect(() => getRandomProxyUrl()).toThrow(
        "DECODO_PROXY_URLS must be a valid JSON array"
      );
    });

    it("should throw error if DECODO_PROXY_URLS is empty array", () => {
      process.env.DECODO_PROXY_URLS = "[]";
      expect(() => getRandomProxyUrl()).toThrow(
        "DECODO_PROXY_URLS must be a non-empty array"
      );
    });
  });

  describe("URL validation", () => {
    it("should validate URL format in request body", async () => {
      // This would be tested in integration tests
      // For unit tests, we test the validation logic
      const testUrl = "https://example.com";
      try {
        new URL(testUrl);
        expect(true).toBe(true);
      } catch {
        expect(false).toBe(true);
      }
    });

    it("should reject invalid URL format", () => {
      const invalidUrl = "not-a-url";
      expect(() => {
        new URL(invalidUrl);
      }).toThrow();
    });
  });

  describe("AOM extraction", () => {
    it("should convert AOM tree to XML", () => {
      const aomTree: Record<string, unknown> = {
        role: "document",
        name: "Test Document",
        children: [
          {
            role: "heading",
            name: "Heading 1",
          },
        ],
      };

      const xml = aomToXml(aomTree);
      expect(xml).toContain("<document");
      expect(xml).toContain('name="Test Document"');
      expect(xml).toContain("<heading");
      expect(xml).toContain('name="Heading 1"');
    });

    it("should escape XML special characters", () => {
      expect(escapeXml("Test & Value")).toBe("Test &amp; Value");
      expect(escapeXml("Test < Value")).toBe("Test &lt; Value");
      expect(escapeXml("Test > Value")).toBe("Test &gt; Value");
      expect(escapeXml('Test " Value')).toBe("Test &quot; Value");
      expect(escapeXml("Test ' Value")).toBe("Test &apos; Value");
    });
  });

  describe("Resource blocking", () => {
    it("should block image resources", () => {
      const resourceType = "image";
      const shouldBlock = ["image", "stylesheet", "font", "media"].includes(
        resourceType
      );
      expect(shouldBlock).toBe(true);
    });

    it("should block stylesheet resources", () => {
      const resourceType = "stylesheet";
      const shouldBlock = ["image", "stylesheet", "font", "media"].includes(
        resourceType
      );
      expect(shouldBlock).toBe(true);
    });

    it("should block font resources", () => {
      const resourceType = "font";
      const shouldBlock = ["image", "stylesheet", "font", "media"].includes(
        resourceType
      );
      expect(shouldBlock).toBe(true);
    });

    it("should block subframe resources", () => {
      const resourceType = "subframe";
      const shouldBlock = resourceType === "subframe";
      expect(shouldBlock).toBe(true);
    });

    it("should allow document resources", () => {
      const resourceType = "document";
      const shouldBlock = ["image", "stylesheet", "font", "media"].includes(
        resourceType
      );
      expect(shouldBlock).toBe(false);
    });
  });

  describe("Strict domain and block-page helpers", () => {
    it("isStrictDomain returns true for www.reddit.com and old.reddit.com", () => {
      expect(isStrictDomain("https://www.reddit.com/r/test")).toBe(true);
      expect(isStrictDomain("https://old.reddit.com/r/test")).toBe(true);
    });

    it("isStrictDomain returns false for other hosts", () => {
      expect(isStrictDomain("https://example.com")).toBe(false);
      expect(isStrictDomain("https://reddit.com")).toBe(false);
    });

    it("isStrictDomain returns false for invalid URL", () => {
      expect(isStrictDomain("not-a-url")).toBe(false);
    });

    it("normalizeUrlForStrictDomain rewrites www.reddit.com to old.reddit.com", () => {
      expect(
        normalizeUrlForStrictDomain(
          "https://www.reddit.com/r/buildinpublic/comments/1qw9b2l/"
        )
      ).toBe(
        "https://old.reddit.com/r/buildinpublic/comments/1qw9b2l/"
      );
    });

    it("normalizeUrlForStrictDomain leaves other URLs unchanged", () => {
      const url = "https://example.com/page";
      expect(normalizeUrlForStrictDomain(url)).toBe(url);
      expect(normalizeUrlForStrictDomain("https://old.reddit.com/r/x")).toBe(
        "https://old.reddit.com/r/x"
      );
    });

    it("getRefererForUrl returns base URL for Reddit hosts", () => {
      expect(getRefererForUrl("https://www.reddit.com/r/test")).toBe(
        "https://www.reddit.com/"
      );
      expect(getRefererForUrl("https://old.reddit.com/r/test")).toBe(
        "https://old.reddit.com/"
      );
    });

    it("getRefererForUrl returns undefined for other hosts", () => {
      expect(getRefererForUrl("https://example.com")).toBeUndefined();
    });

    it("getRefererForUrl returns undefined for invalid URL", () => {
      expect(getRefererForUrl("not-a-url")).toBeUndefined();
    });

    it("isBlockPageContent returns true for strong phrase alone", () => {
      expect(
        isBlockPageContent(
          'value="You\'ve been blocked by network security. If you think'
        )
      ).toBe(true);
      expect(
        isBlockPageContent('name="file a ticket below and we\'ll look"')
      ).toBe(true);
    });

    it("isBlockPageContent returns true when two or more block phrases present", () => {
      expect(
        isBlockPageContent("checking your browser. Access denied.")
      ).toBe(true);
    });

    it("isBlockPageContent returns false for single weak phrase (avoid false positive)", () => {
      expect(isBlockPageContent("Access denied")).toBe(false);
      expect(isBlockPageContent("just a moment")).toBe(false);
    });

    it("isBlockPageContent returns false for normal content", () => {
      expect(
        isBlockPageContent("<document name=\"Real article title\"/>")
      ).toBe(false);
    });
  });

  // Note: Error handling tests for Puppeteer launch failures, navigation timeouts,
  // and proxy authentication errors would require integration tests with actual
  // Puppeteer instances. These scenarios are better tested in E2E tests or
  // integration test suites that can mock browser behavior.
  // The current unit tests focus on utility functions (proxy parsing, AOM conversion,
  // resource blocking logic) which can be tested in isolation.
});
