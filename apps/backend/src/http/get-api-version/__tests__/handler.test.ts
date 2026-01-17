import { describe, it, expect, vi } from "vitest";

import packageJson from "../../../../../../package.json";
// eslint-disable-next-line import/order
import {
  createAPIGatewayEventV2,
  createMockCallback,
  createMockContext,
} from "../../utils/__tests__/test-helpers";

vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

import { handler } from "../index";

describe("get-api-version handler", () => {
  const mockContext = createMockContext();
  const mockCallback = createMockCallback();

  it("should return the current product version", async () => {
    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/version",
      rawPath: "/api/version",
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });

    const body = JSON.parse(result.body || "{}");
    expect(body).toEqual({
      version: packageJson.version || "0.0.0",
    });
  });
});
