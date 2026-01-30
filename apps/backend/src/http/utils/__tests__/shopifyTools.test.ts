/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { database } from "../../../tables";
import * as shopifyClient from "../../../utils/shopify/client";
import {
  createShopifyGetOrderTool,
  createShopifySearchProductsTool,
  createShopifySalesReportTool,
} from "../shopifyTools";

vi.mock("../../../tables", () => ({
  database: vi.fn(),
}));

vi.mock("../../../utils/shopify/client", () => ({
  getOrderByNumber: vi.fn(),
  searchProductsByTitle: vi.fn(),
  getSalesReport: vi.fn(),
}));

describe("Shopify Tools", () => {
  const workspaceId = "workspace-1";
  const serverId = "server-1";
  const mockDb = {
    "mcp-server": {
      get: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(database).mockResolvedValue(mockDb as any);
  });

  it("should fetch an order when connected", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: { accessToken: "token-123", shopDomain: "cool-store.myshopify.com" },
    });

    vi.mocked(shopifyClient.getOrderByNumber).mockResolvedValue({
      orders: [{ id: 1 }],
    });

    const tool = createShopifyGetOrderTool(workspaceId, serverId);
    const result = await (tool as any).execute({ orderNumber: "#1001" });

    expect(shopifyClient.getOrderByNumber).toHaveBeenCalledWith(
      workspaceId,
      serverId,
      "#1001"
    );
    expect(result).toContain("orders");
  });

  it("should search products when connected", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: { accessToken: "token-123", shopDomain: "cool-store.myshopify.com" },
    });

    vi.mocked(shopifyClient.searchProductsByTitle).mockResolvedValue({
      products: [],
    });

    const tool = createShopifySearchProductsTool(workspaceId, serverId);
    const result = await (tool as any).execute({ query: "Hoodie" });

    expect(shopifyClient.searchProductsByTitle).toHaveBeenCalledWith(
      workspaceId,
      serverId,
      "Hoodie"
    );
    expect(result).toContain("products");
  });

  it("should return validation error when product query is missing", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: { accessToken: "token-123", shopDomain: "cool-store.myshopify.com" },
    });

    const tool = createShopifySearchProductsTool(workspaceId, serverId);
    const result = await (tool as any).execute({});

    expect(result).toContain("Invalid tool arguments");
    expect(shopifyClient.searchProductsByTitle).not.toHaveBeenCalled();
  });

  it("should return error if not connected", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: {},
    });

    const tool = createShopifyGetOrderTool(workspaceId, serverId);
    const result = await (tool as any).execute({ orderNumber: "1001" });

    expect(result).toContain("Shopify is not connected");
    expect(shopifyClient.getOrderByNumber).not.toHaveBeenCalled();
  });

  it("should validate date range for sales report", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: { accessToken: "token-123", shopDomain: "cool-store.myshopify.com" },
    });

    const tool = createShopifySalesReportTool(workspaceId, serverId);
    const result = await (tool as any).execute({
      startDate: "2024-01-02T00:00:00.000Z",
      endDate: "2024-01-01T00:00:00.000Z",
    });

    expect(result).toContain("startDate must be before endDate");
    expect(shopifyClient.getSalesReport).not.toHaveBeenCalled();
  });
});
