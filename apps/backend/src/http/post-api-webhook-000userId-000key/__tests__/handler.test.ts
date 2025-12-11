import type { HttpRequest } from "@architect/functions/types/http";
import { describe, it, expect, vi, beforeEach } from "vitest";

// eslint-disable-next-line import/order
import {
  createMockContext,
  createMockDatabase,
} from "../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../../tables", () => ({
  database: mockDatabase,
}));

// Import the handler after mocks are set up
import { handler } from "../index";

describe("post-api-webhook-000userId-000key handler", () => {
  const mockContext = createMockContext();

  beforeEach(() => {
    vi.clearAllMocks();
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

  it("should successfully log webhook and return 200", async () => {
    const mockDb = createMockDatabase();
    mockDb["webhook-logs"].create = vi.fn().mockResolvedValue({
      pk: "request-id-123",
      userId: "user-123",
      key: "key-456",
      body: "test body",
      expires: expect.any(Number),
    });
    mockDatabase.mockResolvedValue(mockDb);

    const req = createHttpRequest({
      body: "test body",
    });

    const result = await handler(req, mockContext);

    expect(result).toEqual({
      statusCode: 200,
      headers: {
        "content-type": "application/json",
      },
      body: expect.stringContaining("Webhook received and logged successfully"),
    });

    const body = JSON.parse(result?.body || "{}");
    expect(body.message).toBe("Webhook received and logged successfully");
    expect(body.requestId).toBeDefined();

    expect(mockDatabase).toHaveBeenCalledTimes(1);
    expect(mockDb["webhook-logs"].create).toHaveBeenCalledWith({
      pk: body.requestId,
      userId: "user-123",
      key: "key-456",
      body: "test body",
      expires: expect.any(Number),
    });
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
    expect(mockDatabase).not.toHaveBeenCalled();
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
    expect(mockDatabase).not.toHaveBeenCalled();
  });

  it("should handle string body", async () => {
    const mockDb = createMockDatabase();
    mockDb["webhook-logs"].create = vi.fn().mockResolvedValue({});
    mockDatabase.mockResolvedValue(mockDb);

    const req = createHttpRequest({
      body: "string body content",
    });

    const result = await handler(req, mockContext);

    expect(result?.statusCode).toBe(200);
    expect(mockDb["webhook-logs"].create).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "string body content",
      })
    );
  });

  it("should handle Buffer body", async () => {
    const mockDb = createMockDatabase();
    mockDb["webhook-logs"].create = vi.fn().mockResolvedValue({});
    mockDatabase.mockResolvedValue(mockDb);

    const bufferBody = Buffer.from("buffer content", "utf-8");
    const req = createHttpRequest({
      body: bufferBody,
    });

    const result = await handler(req, mockContext);

    expect(result?.statusCode).toBe(200);
    expect(mockDb["webhook-logs"].create).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "buffer content",
      })
    );
  });

  it("should handle object body by stringifying", async () => {
    const mockDb = createMockDatabase();
    mockDb["webhook-logs"].create = vi.fn().mockResolvedValue({});
    mockDatabase.mockResolvedValue(mockDb);

    const objectBody = { key: "value", nested: { data: 123 } };
    const req = createHttpRequest({
      body: objectBody,
    });

    const result = await handler(req, mockContext);

    expect(result?.statusCode).toBe(200);
    expect(mockDb["webhook-logs"].create).toHaveBeenCalledWith(
      expect.objectContaining({
        body: JSON.stringify(objectBody),
      })
    );
  });

  it("should handle empty body", async () => {
    const mockDb = createMockDatabase();
    mockDb["webhook-logs"].create = vi.fn().mockResolvedValue({});
    mockDatabase.mockResolvedValue(mockDb);

    const req = createHttpRequest({
      body: undefined,
    });

    const result = await handler(req, mockContext);

    expect(result?.statusCode).toBe(200);
    expect(mockDb["webhook-logs"].create).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "",
      })
    );
  });

  it("should calculate expires timestamp correctly (30 days)", async () => {
    const mockDb = createMockDatabase();
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    mockDb["webhook-logs"].create = vi.fn().mockResolvedValue({});
    mockDatabase.mockResolvedValue(mockDb);

    const req = createHttpRequest();

    await handler(req, mockContext);

    const expectedExpires = Math.floor(now / 1000) + 30 * 24 * 60 * 60;
    expect(mockDb["webhook-logs"].create).toHaveBeenCalledWith(
      expect.objectContaining({
        expires: expectedExpires,
      })
    );

    vi.restoreAllMocks();
  });

  it("should handle database errors", async () => {
    const mockDb = createMockDatabase();
    const dbError = new Error("Database connection failed");
    mockDb["webhook-logs"].create = vi.fn().mockRejectedValue(dbError);
    mockDatabase.mockResolvedValue(mockDb);

    const req = createHttpRequest();

    const result = await handler(req, mockContext);

    expect(result?.statusCode).toBe(500);
    const body = JSON.parse(result?.body || "{}");
    expect(body.message).toBeDefined();
  });
});
