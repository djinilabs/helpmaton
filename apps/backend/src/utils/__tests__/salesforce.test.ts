import { describe, it, expect, beforeEach, vi } from "vitest";

import { database } from "../../tables";
import * as salesforceClient from "../salesforce/client";

// Mock fetch
global.fetch = vi.fn();

vi.mock("../../tables", () => ({
  database: vi.fn(),
}));

vi.mock("../oauth/mcp/salesforce", () => ({
  refreshSalesforceToken: vi.fn().mockResolvedValue({
    accessToken: "refreshed-token",
    refreshToken: "refreshed-refresh-token",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    instanceUrl: "https://na2.salesforce.com",
  }),
}));

describe("Salesforce API Client", () => {
  const workspaceId = "workspace-1";
  const serverId = "server-1";
  const mockDb = {
    "mcp-server": {
      get: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(database).mockResolvedValue(mockDb as never);
  });

  it("should list objects using the instance URL", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: {
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        instanceUrl: "https://na1.salesforce.com",
      },
    });

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ sobjects: [] }),
    } as Partial<Response> as Response);

    const result = await salesforceClient.listObjects(workspaceId, serverId);

    expect(result).toEqual({ sobjects: [] });
    expect(fetch).toHaveBeenCalledWith(
      "https://na1.salesforce.com/services/data/v60.0/sobjects/",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-access-token",
        }),
      })
    );
  });

  it("should refresh token on 401 and retry request", async () => {
    mockDb["mcp-server"].get
      .mockResolvedValueOnce({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "expired-token",
          refreshToken: "refresh-token",
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          instanceUrl: "https://na1.salesforce.com",
        },
      })
      .mockResolvedValueOnce({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "refreshed-token",
          refreshToken: "refreshed-refresh-token",
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          instanceUrl: "https://na2.salesforce.com",
        },
      });

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: vi.fn().mockResolvedValue([{ message: "invalid session" }]),
      } as Partial<Response> as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ sobjects: [] }),
      } as Partial<Response> as Response);

    await salesforceClient.listObjects(workspaceId, serverId);

    expect(mockDb["mcp-server"].update).toHaveBeenCalled();
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://na2.salesforce.com/services/data/v60.0/sobjects/",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer refreshed-token",
        }),
      })
    );
  });
});
