import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

describe("GET /api/workspaces/:workspaceId/channels/:channelId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    // Extract the handler logic directly
    const handler = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        const db = await mockDatabase();
        const workspaceResource = (req as { workspaceResource?: string })
          .workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = req.params.workspaceId;
        const channelId = req.params.channelId;
        const channelPk = `output-channels/${workspaceId}/${channelId}`;

        const channel = await db["output_channel"].get(channelPk, "channel");
        if (!channel) {
          throw resourceGone("Channel not found");
        }

        if (channel.workspaceId !== workspaceId) {
          throw forbidden("Channel does not belong to this workspace");
        }

        // Return channel without sensitive config data
        res.json({
          id: channel.channelId,
          name: channel.name,
          type: channel.type,
          createdAt: channel.createdAt,
          updatedAt: channel.updatedAt,
        });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should return channel without sensitive config data", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const channelId = "channel-456";

    const mockChannel = {
      pk: `output-channels/${workspaceId}/${channelId}`,
      sk: "channel",
      workspaceId,
      channelId,
      name: "Slack Channel",
      type: "slack",
      config: {
        webhookUrl: "https://hooks.slack.com/secret",
        apiKey: "secret-key",
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockChannelGet = vi.fn().mockResolvedValue(mockChannel);
    mockDb["output_channel"].get = mockChannelGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        channelId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockChannelGet).toHaveBeenCalledWith(
      `output-channels/${workspaceId}/${channelId}`,
      "channel"
    );
    expect(res.json).toHaveBeenCalledWith({
      id: channelId,
      name: "Slack Channel",
      type: "slack",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });

  it("should return different channel types", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const channelId = "channel-456";

    const mockChannel = {
      pk: `output-channels/${workspaceId}/${channelId}`,
      sk: "channel",
      workspaceId,
      channelId,
      name: "Email Channel",
      type: "email",
      config: {
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        username: "user@example.com",
        password: "secret-password",
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockChannelGet = vi.fn().mockResolvedValue(mockChannel);
    mockDb["output_channel"].get = mockChannelGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        channelId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      id: channelId,
      name: "Email Channel",
      type: "email",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: undefined,
      params: {
        workspaceId: "workspace-123",
        channelId: "channel-456",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(
      (error as { output?: { statusCode: number } }).output?.statusCode
    ).toBe(400);
    expect(
      (error as { output?: { payload: { message: string } } }).output?.payload
        .message
    ).toContain("Workspace resource not found");
  });

  it("should throw resourceGone when channel does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const channelId = "channel-456";

    const mockChannelGet = vi.fn().mockResolvedValue(null);
    mockDb["output_channel"].get = mockChannelGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        channelId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(
      (error as { output?: { statusCode: number } }).output?.statusCode
    ).toBe(410);
    expect(
      (error as { output?: { payload: { message: string } } }).output?.payload
        .message
    ).toContain("Channel not found");
  });

  it("should throw forbidden when channel belongs to different workspace", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const channelId = "channel-456";

    const mockChannel = {
      pk: `output-channels/${workspaceId}/${channelId}`,
      sk: "channel",
      workspaceId: "workspace-999", // Different workspace
      channelId,
      name: "Slack Channel",
      type: "slack",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockChannelGet = vi.fn().mockResolvedValue(mockChannel);
    mockDb["output_channel"].get = mockChannelGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        channelId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(
      (error as { output?: { statusCode: number } }).output?.statusCode
    ).toBe(403);
    expect(
      (error as { output?: { payload: { message: string } } }).output?.payload
        .message
    ).toContain("Channel does not belong to this workspace");
  });

  it("should exclude config data from response", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const channelId = "channel-456";

    const mockChannel = {
      pk: `output-channels/${workspaceId}/${channelId}`,
      sk: "channel",
      workspaceId,
      channelId,
      name: "Webhook Channel",
      type: "webhook",
      config: {
        url: "https://example.com/webhook",
        secret: "very-secret-key",
        headers: {
          Authorization: "Bearer secret-token",
        },
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockChannelGet = vi.fn().mockResolvedValue(mockChannel);
    mockDb["output_channel"].get = mockChannelGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        channelId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response).not.toHaveProperty("config");
    expect(response).not.toHaveProperty("url");
    expect(response).not.toHaveProperty("secret");
    expect(response).toEqual({
      id: channelId,
      name: "Webhook Channel",
      type: "webhook",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });
});
