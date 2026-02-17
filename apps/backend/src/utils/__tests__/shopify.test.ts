import { describe, it, expect, beforeEach, vi } from "vitest";

import { database } from "../../tables";
import * as shopifyClient from "../shopify/client";

// Mock fetch
global.fetch = vi.fn();

vi.mock("../googleApi/oauth", () => ({
  getOAuthTokens: vi.fn().mockResolvedValue({
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  }),
  ensureValidToken: vi.fn().mockResolvedValue("test-access-token"),
}));

vi.mock("../../tables", () => ({
  database: vi.fn(),
}));

describe("Shopify API Client", () => {
  const mockDb = {
    "mcp-server": {
      get: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(database).mockResolvedValue(mockDb as never);
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: "mcp-servers/workspace-1/server-1",
      sk: "server",
      authType: "oauth",
      serviceType: "shopify",
      config: {
        shopDomain: "cool-store.myshopify.com",
      },
    });
  });

  it("should fetch an order by number", async () => {
    const mockResponse = { orders: [] };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(mockResponse),
      headers: new Headers({ "content-type": "application/json" }),
    } as Partial<Response> as Response);

    const result = await shopifyClient.getOrderByNumber(
      "workspace-1",
      "server-1",
      "#1001"
    );

    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      "https://cool-store.myshopify.com/admin/api/2024-01/orders.json?name=1001&status=any",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Shopify-Access-Token": "test-access-token",
        }),
      })
    );
  });

  it("should search products by title", async () => {
    const mockResponse = { data: { products: { nodes: [] } } };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(mockResponse),
      headers: new Headers({ "content-type": "application/json" }),
    } as Partial<Response> as Response);

    const result = await shopifyClient.searchProductsByTitle(
      "workspace-1",
      "server-1",
      "Hoodie"
    );

    expect(result).toEqual({
      products: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://cool-store.myshopify.com/admin/api/2024-01/graphql.json",
      expect.objectContaining({
        method: "POST",
      })
    );

    const [, requestInit] = vi.mocked(fetch).mock.calls[0] ?? [];
    const payload = JSON.parse(String(requestInit?.body ?? "{}"));
    expect(payload.variables?.query).toContain("status:active");
    expect(payload.variables?.query).toContain("published_status:published");
  });

  it("should compute sales report totals", async () => {
    const mockCountResponse = { count: 2 };
    const mockOrdersResponse = {
      orders: [
        { total_price: "10.50", currency: "USD" },
        { total_price: "5.25", currency: "USD" },
      ],
    };

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockCountResponse),
        headers: new Headers({ "content-type": "application/json" }),
      } as Partial<Response> as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockOrdersResponse),
        headers: new Headers({ "content-type": "application/json" }),
      } as Partial<Response> as Response);

    const result = await shopifyClient.getSalesReport("workspace-1", "server-1", {
      startDate: "2024-01-01T00:00:00.000Z",
      endDate: "2024-01-02T00:00:00.000Z",
    });

    expect(result).toEqual({
      count: 2,
      grossSales: 15.75,
      currency: "USD",
      ordersFetched: 2,
    });
  });
});
