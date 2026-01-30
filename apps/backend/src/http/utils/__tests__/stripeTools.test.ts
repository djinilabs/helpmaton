/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { database } from "../../../tables";
import * as stripeClient from "../../../utils/stripe/client";
import {
  createStripeSearchChargesTool,
  createStripeGetMetricsTool,
} from "../stripeTools";

vi.mock("../../../tables", () => ({
  database: vi.fn(),
}));

vi.mock("../../../utils/stripe/client", () => ({
  searchCharges: vi.fn(),
  getBalance: vi.fn(),
  listRefunds: vi.fn(),
}));

describe("Stripe Tools", () => {
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

  describe("createStripeSearchChargesTool", () => {
    it("should search charges with email and query", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: { accessToken: "token-123" },
      });

      vi.mocked(stripeClient.searchCharges).mockResolvedValue({ data: [] });

      const tool = createStripeSearchChargesTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        query: "status:'succeeded'",
        email: "bob@example.com",
      });

      expect(stripeClient.searchCharges).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        "(status:'succeeded') AND email:'bob@example.com'"
      );
      expect(result).toContain("data");
    });

    it("should return error if not connected", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {},
      });

      const tool = createStripeSearchChargesTool(workspaceId, serverId);
      const result = await (tool as any).execute({ query: "status:'succeeded'" });

      expect(result).toContain("Stripe is not connected");
      expect(stripeClient.searchCharges).not.toHaveBeenCalled();
    });
  });

  describe("createStripeGetMetricsTool", () => {
    it("should return error for invalid date range", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: { accessToken: "token-123" },
      });

      const tool = createStripeGetMetricsTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        startDate: "2025-02-02T00:00:00Z",
        endDate: "2025-01-01T00:00:00Z",
      });

      expect(result).toContain("startDate must be before endDate");
      expect(stripeClient.getBalance).not.toHaveBeenCalled();
    });

    it("should return validation error when startDate is missing", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: { accessToken: "token-123" },
      });

      const tool = createStripeGetMetricsTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        endDate: "2025-01-01T00:00:00Z",
      });

      expect(result).toContain("Invalid tool arguments");
      expect(stripeClient.getBalance).not.toHaveBeenCalled();
    });

    it("should return balance and refunds for date range", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: { accessToken: "token-123" },
      });

      vi.mocked(stripeClient.getBalance).mockResolvedValue({ available: [] });
      vi.mocked(stripeClient.listRefunds).mockResolvedValue({ data: [] });

      const tool = createStripeGetMetricsTool(workspaceId, serverId);
      const startDate = "2025-01-01T00:00:00Z";
      const endDate = "2025-01-31T00:00:00Z";

      const result = await (tool as any).execute({
        startDate,
        endDate,
        limit: 10,
      });

      const startTimestamp = Math.floor(Date.parse(startDate) / 1000);
      const endTimestamp = Math.floor(Date.parse(endDate) / 1000);

      expect(stripeClient.getBalance).toHaveBeenCalledWith(
        workspaceId,
        serverId
      );
      expect(stripeClient.listRefunds).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        {
          createdGte: startTimestamp,
          createdLte: endTimestamp,
          limit: 10,
        }
      );
      expect(result).toContain("balance");
      expect(result).toContain("refunds");
    });
  });
});
