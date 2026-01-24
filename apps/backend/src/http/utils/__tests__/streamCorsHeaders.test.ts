import { describe, expect, it, beforeEach } from "vitest";

import {
  computeCorsHeaders,
  handleOptionsRequest,
} from "../streamCorsHeaders";

describe("streamCorsHeaders", () => {
  beforeEach(() => {
    delete process.env.FRONTEND_URL;
  });

  describe("computeCorsHeaders", () => {
    it("should compute headers for 'test' endpoint with FRONTEND_URL", () => {
      process.env.FRONTEND_URL = "https://app.example.com";
      const headers = computeCorsHeaders("test", undefined, null);
      expect(headers["Content-Type"]).toBe("text/event-stream; charset=utf-8");
      expect(headers["Access-Control-Allow-Origin"]).toBe(
        "https://app.example.com"
      );
      expect(headers["Access-Control-Allow-Methods"]).toBe("GET, POST, OPTIONS");
      expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
    });

    it("should prefer request origin for 'test' endpoint", () => {
      process.env.FRONTEND_URL = "https://app.example.com";
      const headers = computeCorsHeaders(
        "test",
        "https://preview.example.com",
        null
      );
      expect(headers["Access-Control-Allow-Origin"]).toBe(
        "https://preview.example.com"
      );
      expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
    });

    it("should compute headers for 'stream' endpoint with no allowed origins", () => {
      const headers = computeCorsHeaders("stream", "https://example.com", null);
      expect(headers["Access-Control-Allow-Origin"]).toBe("*");
      expect(headers["Access-Control-Allow-Methods"]).toBe("GET, POST, OPTIONS");
    });

    it("should compute headers for 'stream' endpoint with wildcard allowed origins", () => {
      const headers = computeCorsHeaders("stream", "https://example.com", ["*"]);
      expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    });

    it("should compute headers for 'stream' endpoint with matching origin", () => {
      const headers = computeCorsHeaders(
        "stream",
        "https://example.com",
        ["https://example.com", "https://other.com"]
      );
      expect(headers["Access-Control-Allow-Origin"]).toBe("https://example.com");
      expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
    });

    it("should not set Access-Control-Allow-Origin for non-matching origin", () => {
      const headers = computeCorsHeaders(
        "stream",
        "https://example.com",
        ["https://other.com"]
      );
      expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    });

    it("should include X-Conversation-Id in allowed headers", () => {
      const headers = computeCorsHeaders("stream", undefined, null);
      expect(headers["Access-Control-Allow-Headers"]).toContain(
        "X-Conversation-Id"
      );
    });
  });

  describe("handleOptionsRequest", () => {
    it("should return 200 with provided headers", () => {
      const headers = {
        "Content-Type": "text/event-stream",
        "Access-Control-Allow-Origin": "*",
      };
      const result = handleOptionsRequest(headers);
      expect(result).toEqual({
        statusCode: 200,
        headers,
        body: "",
      });
    });
  });
});

