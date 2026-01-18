/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { database } from "../../../tables";
import * as slackClient from "../../../utils/slackClient";
import {
  createSlackListChannelsTool,
  createSlackGetChannelHistoryTool,
  createSlackPostMessageTool,
} from "../slackTools";

// Mock database
vi.mock("../../../tables", () => ({
  database: vi.fn(),
}));

// Mock Slack client
vi.mock("../../../utils/slackClient", () => ({
  listChannels: vi.fn(),
  getChannelHistory: vi.fn(),
  postMessage: vi.fn(),
}));

describe("Slack Tools", () => {
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

  describe("createSlackListChannelsTool", () => {
    it("should list channels successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: { accessToken: "token-123" },
      });

      vi.mocked(slackClient.listChannels).mockResolvedValue({
        channels: [{ id: "C123", name: "general", isPrivate: false }],
        nextCursor: undefined,
      });

      const tool = createSlackListChannelsTool(workspaceId, serverId);
      const result = await (tool as any).execute({});

      expect(slackClient.listChannels).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        { limit: undefined, cursor: undefined }
      );
      expect(result).toContain("general");
    });

    it("should return error if not connected", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {},
      });

      const tool = createSlackListChannelsTool(workspaceId, serverId);
      const result = await (tool as any).execute({});

      expect(result).toContain("Slack is not connected");
      expect(slackClient.listChannels).not.toHaveBeenCalled();
    });
  });

  describe("createSlackGetChannelHistoryTool", () => {
    it("should read channel history successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: { accessToken: "token-123" },
      });

      vi.mocked(slackClient.getChannelHistory).mockResolvedValue({
        channelId: "C123",
        messages: [{ text: "Hello", user: "U1", ts: "1" }],
        hasMore: false,
      });

      const tool = createSlackGetChannelHistoryTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        channel_id: "C123",
        limit: 5,
      });

      expect(slackClient.getChannelHistory).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        "C123",
        { limit: 5, cursor: undefined }
      );
      expect(result).toContain("Hello");
    });

    it("should return error if channel_id is missing", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: { accessToken: "token-123" },
      });

      const tool = createSlackGetChannelHistoryTool(workspaceId, serverId);
      const result = await (tool as any).execute({});

      expect(result).toContain("channel_id parameter is required");
      expect(slackClient.getChannelHistory).not.toHaveBeenCalled();
    });
  });

  describe("createSlackPostMessageTool", () => {
    it("should post a message successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: { accessToken: "token-123" },
      });

      vi.mocked(slackClient.postMessage).mockResolvedValue({
        channel: "C123",
        ts: "123",
        text: "Hello",
      });

      const tool = createSlackPostMessageTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        channel_id: "C123",
        text: "Hello",
      });

      expect(slackClient.postMessage).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        "C123",
        "Hello"
      );
      expect(result).toContain("Hello");
    });

    it("should return error if text is missing", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: { accessToken: "token-123" },
      });

      const tool = createSlackPostMessageTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        channel_id: "C123",
      });

      expect(result).toContain("text parameter is required");
      expect(slackClient.postMessage).not.toHaveBeenCalled();
    });
  });
});
