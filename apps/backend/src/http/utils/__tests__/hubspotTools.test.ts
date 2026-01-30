/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { database } from "../../../tables";
import * as hubspotClient from "../../../utils/hubspot/client";
import {
  createHubspotListContactsTool,
  createHubspotGetContactTool,
} from "../hubspotTools";

vi.mock("../../../tables", () => ({
  database: vi.fn(),
}));

vi.mock("../../../utils/hubspot/client", () => ({
  listContacts: vi.fn(),
  getContact: vi.fn(),
}));

describe("HubSpot Tools", () => {
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

  describe("createHubspotListContactsTool", () => {
    it("should list contacts successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      vi.mocked(hubspotClient.listContacts).mockResolvedValue({
        results: [{ id: "1" }],
      });

      const tool = createHubspotListContactsTool(workspaceId, serverId);
      const result = await (tool as any).execute({});

      expect(hubspotClient.listContacts).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        expect.any(Object)
      );
      expect(result).toContain("results");
    });

    it("should return error if not connected", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {},
      });

      const tool = createHubspotListContactsTool(workspaceId, serverId);
      const result = await (tool as any).execute({});

      expect(result).toContain("HubSpot is not connected");
      expect(hubspotClient.listContacts).not.toHaveBeenCalled();
    });
  });

  describe("createHubspotGetContactTool", () => {
    it("should return error when contactId is missing", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const tool = createHubspotGetContactTool(workspaceId, serverId);
      const result = await (tool as any).execute({});

      expect(result).toContain("Invalid tool arguments");
      expect(result).toContain("contactId parameter is required");
      expect(hubspotClient.getContact).not.toHaveBeenCalled();
    });
  });
});
