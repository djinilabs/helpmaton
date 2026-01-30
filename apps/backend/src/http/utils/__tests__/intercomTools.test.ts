/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { database } from "../../../tables";
import * as intercomClient from "../../../utils/intercom/client";
import {
  createIntercomListContactsTool,
  createIntercomReplyConversationTool,
} from "../intercomTools";

vi.mock("../../../tables", () => ({
  database: vi.fn(),
}));

vi.mock("../../../utils/intercom/client", () => ({
  listContacts: vi.fn(),
  replyConversation: vi.fn(),
  getCurrentAdmin: vi.fn(),
}));

describe("Intercom Tools", () => {
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

  describe("createIntercomListContactsTool", () => {
    it("should list contacts successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: { accessToken: "token-123" },
      });

      vi.mocked(intercomClient.listContacts).mockResolvedValue({
        data: [{ id: "contact-1" }],
      });

      const tool = createIntercomListContactsTool(workspaceId, serverId);
      const result = await (tool as any).execute({ perPage: 25 });

      expect(intercomClient.listContacts).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        { perPage: 25, startingAfter: undefined }
      );
      expect(result).toContain("contact-1");
    });

    it("should return error if not connected", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {},
      });

      const tool = createIntercomListContactsTool(workspaceId, serverId);
      const result = await (tool as any).execute({});

      expect(result).toContain("Intercom is not connected");
      expect(intercomClient.listContacts).not.toHaveBeenCalled();
    });
  });

  describe("createIntercomReplyConversationTool", () => {
    it("should reply using stored admin ID", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: { accessToken: "token-123", adminId: "admin-1" },
      });

      vi.mocked(intercomClient.replyConversation).mockResolvedValue({
        id: "conv-1",
      });

      const tool = createIntercomReplyConversationTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        conversationId: "conv-1",
        body: "Hello",
      });

      expect(intercomClient.replyConversation).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        "conv-1",
        expect.objectContaining({
          admin_id: "admin-1",
          message_type: "comment",
          body: "Hello",
        })
      );
      expect(result).toContain("conv-1");
    });

    it("should return validation error when conversationId is missing", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: { accessToken: "token-123", adminId: "admin-1" },
      });

      const tool = createIntercomReplyConversationTool(workspaceId, serverId);
      const result = await (tool as any).execute({ body: "Hello" });

      expect(result).toContain("Invalid tool arguments");
      expect(intercomClient.replyConversation).not.toHaveBeenCalled();
    });

    it("should return error if admin ID is missing", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: { accessToken: "token-123" },
      });

      vi.mocked(intercomClient.getCurrentAdmin).mockResolvedValue({});

      const tool = createIntercomReplyConversationTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        conversationId: "conv-1",
        body: "Hello",
      });

      expect(result).toContain("Intercom admin ID is missing");
      expect(intercomClient.replyConversation).not.toHaveBeenCalled();
    });
  });
});
