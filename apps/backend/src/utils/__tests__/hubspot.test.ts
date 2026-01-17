import { describe, it, expect, beforeEach, vi } from "vitest";

import * as hubspotClient from "../hubspot/client";

// Mock fetch
global.fetch = vi.fn();

vi.mock("../googleApi/oauth", () => ({
  getOAuthTokens: vi.fn().mockResolvedValue({
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  }),
  ensureValidToken: vi.fn().mockResolvedValue("test-access-token"),
  updateOAuthTokens: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../oauth/mcp/hubspot", () => ({
  refreshHubspotToken: vi.fn().mockResolvedValue({
    accessToken: "refreshed-token",
    refreshToken: "refreshed-token",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  }),
}));

describe("HubSpot API Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listContacts", () => {
    it("should list contacts", async () => {
      const mockResponse = { results: [] };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as Partial<Response> as Response);

      const result = await hubspotClient.listContacts("workspace-1", "server-1");

      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.hubapi.com/crm/v3/objects/contacts",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-access-token",
          }),
        })
      );
    });
  });

  describe("searchDeals", () => {
    it("should search deals", async () => {
      const mockResponse = { results: [] };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as Partial<Response> as Response);

      const result = await hubspotClient.searchDeals("workspace-1", "server-1", {
        query: "enterprise",
      });

      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.hubapi.com/crm/v3/objects/deals/search",
        expect.objectContaining({
          method: "POST",
        })
      );
    });
  });

  describe("getOwner", () => {
    it("should get owner details", async () => {
      const mockResponse = { id: "123", email: "owner@example.com" };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as Partial<Response> as Response);

      const result = await hubspotClient.getOwner(
        "workspace-1",
        "server-1",
        "123"
      );

      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.hubapi.com/crm/v3/owners/123",
        expect.anything()
      );
    });
  });
});
