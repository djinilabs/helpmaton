import type { HttpRequest } from "@architect/functions/types/http";
import { describe, it, expect, beforeEach } from "vitest";

// eslint-disable-next-line import/order
import { createMockContext } from "../../utils/__tests__/test-helpers";

// Import the handler
import { handler } from "../index";

describe("post-api-webhook-000userId-000key handler", () => {
  const mockContext = createMockContext();

  beforeEach(() => {
    // No mocks to clear
  });

  function createHttpRequest(overrides?: Partial<HttpRequest>): HttpRequest {
    return {
      method: "POST",
      path: "/api/webhook/user-123/key-456",
      pathParameters: {
        userId: "user-123",
        key: "key-456",
      },
      body: "test body",
      headers: {},
      query: {},
      ...overrides,
    } as HttpRequest;
  }

  it("should successfully process webhook and return 200", async () => {
    const req = createHttpRequest();

    const result = await handler(req, mockContext);

    expect(result).toEqual({
      statusCode: 200,
      headers: {
        "content-type": "application/json",
      },
      body: expect.stringContaining("Webhook received successfully"),
    });

    const body = JSON.parse(result?.body || "{}");
    expect(body.message).toBe("Webhook received successfully");
    expect(body.requestId).toBeUndefined();
  });

  it("should throw badRequest when userId is missing", async () => {
    const req = createHttpRequest({
      pathParameters: {
        key: "key-456",
      },
    });

    const result = await handler(req, mockContext);

    expect(result?.statusCode).toBe(400);
    const body = JSON.parse(result?.body || "{}");
    expect(body.message).toContain("userId and key are required");
  });

  it("should throw badRequest when key is missing", async () => {
    const req = createHttpRequest({
      pathParameters: {
        userId: "user-123",
      },
    });

    const result = await handler(req, mockContext);

    expect(result?.statusCode).toBe(400);
    const body = JSON.parse(result?.body || "{}");
    expect(body.message).toContain("userId and key are required");
  });
});
