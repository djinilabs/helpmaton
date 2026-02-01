import { describe, it, expect, vi, beforeEach } from "vitest";

// eslint-disable-next-line import/order
import {
  createAPIGatewayEventV2,
  createMockCallback,
  createMockContext,
} from "../../utils/__tests__/test-helpers";

const HEALTHCHECK_BUCKET_PK =
  "request-buckets/healthcheck/llm/1970-01-01T00:00:00.000Z";

const { mockDatabase, mockRequestBucketGet } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockRequestBucketGet: vi.fn(),
  };
});

vi.mock("../../../tables/database", () => ({
  database: mockDatabase,
}));

import { handler } from "../index";

describe("get-api-health handler", () => {
  const mockContext = createMockContext();
  const mockCallback = createMockCallback();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabase.mockResolvedValue({
      "request-buckets": {
        get: mockRequestBucketGet,
      },
    });
    mockRequestBucketGet.mockResolvedValue(undefined);
  });

  it("should return ok and perform a harmless database read", async () => {
    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/health",
      rawPath: "/api/health",
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(mockDatabase).toHaveBeenCalledTimes(1);
    expect(mockRequestBucketGet).toHaveBeenCalledWith(HEALTHCHECK_BUCKET_PK);
    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    expect(JSON.parse(result.body)).toEqual({
      ok: true,
      dbOk: true,
    });
  });
});
