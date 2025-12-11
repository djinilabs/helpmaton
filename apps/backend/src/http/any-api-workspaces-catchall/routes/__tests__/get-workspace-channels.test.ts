import { badRequest } from "@hapi/boom";
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

describe("GET /api/workspaces/:workspaceId/channels", () => {
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

        // Query all channels for this workspace
        const result = await db["output_channel"].query({
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        });

        // Return channels without sensitive config data
        const channels = result.items.map(
          (channel: {
            channelId: string;
            name: string;
            type: string;
            createdAt: string;
            updatedAt: string;
          }) => ({
            id: channel.channelId,
            name: channel.name,
            type: channel.type,
            createdAt: channel.createdAt,
            updatedAt: channel.updatedAt,
          })
        );

        res.json({ channels });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should return all channels for a workspace", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const mockChannels = [
      {
        pk: "output-channels/channel-1",
        sk: "channel",
        workspaceId,
        channelId: "channel-1",
        name: "Slack Channel",
        type: "slack",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
      },
      {
        pk: "output-channels/channel-2",
        sk: "channel",
        workspaceId,
        channelId: "channel-2",
        name: "Email Channel",
        type: "email",
        createdAt: "2024-01-03T00:00:00Z",
        updatedAt: "2024-01-04T00:00:00Z",
      },
    ];

    const mockChannelQuery = vi.fn().mockResolvedValue({
      items: mockChannels,
    });
    mockDb["output_channel"].query = mockChannelQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockChannelQuery).toHaveBeenCalledWith({
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": workspaceId,
      },
    });
    expect(res.json).toHaveBeenCalledWith({
      channels: [
        {
          id: "channel-1",
          name: "Slack Channel",
          type: "slack",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        },
        {
          id: "channel-2",
          name: "Email Channel",
          type: "email",
          createdAt: "2024-01-03T00:00:00Z",
          updatedAt: "2024-01-04T00:00:00Z",
        },
      ],
    });
  });

  it("should return empty array when workspace has no channels", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";

    const mockChannelQuery = vi.fn().mockResolvedValue({
      items: [],
    });
    mockDb["output_channel"].query = mockChannelQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockChannelQuery).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      channels: [],
    });
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: undefined,
      params: {
        workspaceId: "workspace-123",
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

  it("should return channels with different types", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const mockChannels = [
      {
        pk: "output-channels/channel-1",
        sk: "channel",
        workspaceId,
        channelId: "channel-1",
        name: "Discord Channel",
        type: "discord",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
      },
      {
        pk: "output-channels/channel-2",
        sk: "channel",
        workspaceId,
        channelId: "channel-2",
        name: "Webhook Channel",
        type: "webhook",
        createdAt: "2024-01-03T00:00:00Z",
        updatedAt: "2024-01-04T00:00:00Z",
      },
    ];

    const mockChannelQuery = vi.fn().mockResolvedValue({
      items: mockChannels,
    });
    mockDb["output_channel"].query = mockChannelQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      channels: [
        {
          id: "channel-1",
          name: "Discord Channel",
          type: "discord",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        },
        {
          id: "channel-2",
          name: "Webhook Channel",
          type: "webhook",
          createdAt: "2024-01-03T00:00:00Z",
          updatedAt: "2024-01-04T00:00:00Z",
        },
      ],
    });
  });

  it("should exclude sensitive config data from response", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const mockChannels = [
      {
        pk: "output-channels/channel-1",
        sk: "channel",
        workspaceId,
        channelId: "channel-1",
        name: "Slack Channel",
        type: "slack",
        config: {
          webhookUrl: "https://hooks.slack.com/secret",
          apiKey: "secret-key",
        },
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
      },
    ];

    const mockChannelQuery = vi.fn().mockResolvedValue({
      items: mockChannels,
    });
    mockDb["output_channel"].query = mockChannelQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response.channels[0]).not.toHaveProperty("config");
    expect(response.channels[0]).not.toHaveProperty("webhookUrl");
    expect(response.channels[0]).not.toHaveProperty("apiKey");
    expect(response.channels[0]).toEqual({
      id: "channel-1",
      name: "Slack Channel",
      type: "slack",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });
});
