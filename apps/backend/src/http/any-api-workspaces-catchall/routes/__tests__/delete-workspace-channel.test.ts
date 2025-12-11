import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

describe("DELETE /api/workspaces/:workspaceId/channels/:channelId", () => {
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

        // Check if any agents are using this channel
        const agentsResult = await db.agent.query({
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        });

        const agentsUsingChannel = agentsResult.items.filter(
          (agent: { notificationChannelId?: string | null }) =>
            agent.notificationChannelId === channelId
        );

        if (agentsUsingChannel.length > 0) {
          const agentNames = agentsUsingChannel
            .map((a: { name: string }) => a.name)
            .join(", ");
          throw badRequest(
            `Cannot delete channel: it is being used by ${agentsUsingChannel.length} agent(s): ${agentNames}. Please remove the channel from these agents first.`
          );
        }

        // Delete channel
        await db["output_channel"].delete(channelPk, "channel");

        res.status(204).send();
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should delete channel successfully when not in use", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const channelId = "channel-abc-123";
    const channelPk = `output-channels/${workspaceId}/${channelId}`;

    const mockChannel = {
      pk: channelPk,
      sk: "channel",
      workspaceId,
      channelId,
      type: "discord",
      name: "My Channel",
      config: {},
    };

    const mockChannelGet = vi.fn().mockResolvedValue(mockChannel);
    mockDb["output_channel"].get = mockChannelGet;

    const mockChannelDelete = vi.fn().mockResolvedValue(undefined);
    mockDb["output_channel"].delete = mockChannelDelete;

    // Mock agents query - no agents using this channel
    const mockAgentsQuery = vi.fn().mockResolvedValue({
      items: [
        {
          agentId: "agent-1",
          name: "Agent 1",
          notificationChannelId: "different-channel",
        },
        {
          agentId: "agent-2",
          name: "Agent 2",
          notificationChannelId: null,
        },
      ],
    });
    mockDb.agent.query = mockAgentsQuery;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-456",
      params: {
        workspaceId,
        channelId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockChannelGet).toHaveBeenCalledWith(channelPk, "channel");
    expect(mockAgentsQuery).toHaveBeenCalledWith({
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": workspaceId,
      },
    });
    expect(mockChannelDelete).toHaveBeenCalledWith(channelPk, "channel");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: undefined,
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
        channelId: "channel-abc-123",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining("Workspace resource not found"),
          }),
        }),
      })
    );
  });

  it("should throw resourceGone when channel does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const channelId = "channel-abc-123";
    const channelPk = `output-channels/${workspaceId}/${channelId}`;

    const mockChannelGet = vi.fn().mockResolvedValue(null);
    mockDb["output_channel"].get = mockChannelGet;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-456",
      params: {
        workspaceId,
        channelId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockChannelGet).toHaveBeenCalledWith(channelPk, "channel");
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 410,
          payload: expect.objectContaining({
            message: expect.stringContaining("Channel not found"),
          }),
        }),
      })
    );
  });

  it("should throw forbidden when channel belongs to different workspace", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const channelId = "channel-abc-123";
    const channelPk = `output-channels/${workspaceId}/${channelId}`;

    const mockChannel = {
      pk: channelPk,
      sk: "channel",
      workspaceId: "different-workspace",
      channelId,
      type: "discord",
      name: "My Channel",
      config: {},
    };

    const mockChannelGet = vi.fn().mockResolvedValue(mockChannel);
    mockDb["output_channel"].get = mockChannelGet;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-456",
      params: {
        workspaceId,
        channelId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 403,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "Channel does not belong to this workspace"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when channel is being used by one agent", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const channelId = "channel-abc-123";
    const channelPk = `output-channels/${workspaceId}/${channelId}`;

    const mockChannel = {
      pk: channelPk,
      sk: "channel",
      workspaceId,
      channelId,
      type: "discord",
      name: "My Channel",
      config: {},
    };

    const mockChannelGet = vi.fn().mockResolvedValue(mockChannel);
    mockDb["output_channel"].get = mockChannelGet;

    // Mock agents query - one agent using this channel
    const mockAgentsQuery = vi.fn().mockResolvedValue({
      items: [
        {
          agentId: "agent-1",
          name: "Agent One",
          notificationChannelId: channelId,
        },
        {
          agentId: "agent-2",
          name: "Agent Two",
          notificationChannelId: "different-channel",
        },
      ],
    });
    mockDb.agent.query = mockAgentsQuery;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-456",
      params: {
        workspaceId,
        channelId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockAgentsQuery).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "Cannot delete channel: it is being used by 1 agent(s): Agent One"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when channel is being used by multiple agents", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const channelId = "channel-abc-123";
    const channelPk = `output-channels/${workspaceId}/${channelId}`;

    const mockChannel = {
      pk: channelPk,
      sk: "channel",
      workspaceId,
      channelId,
      type: "discord",
      name: "My Channel",
      config: {},
    };

    const mockChannelGet = vi.fn().mockResolvedValue(mockChannel);
    mockDb["output_channel"].get = mockChannelGet;

    // Mock agents query - multiple agents using this channel
    const mockAgentsQuery = vi.fn().mockResolvedValue({
      items: [
        {
          agentId: "agent-1",
          name: "Agent One",
          notificationChannelId: channelId,
        },
        {
          agentId: "agent-2",
          name: "Agent Two",
          notificationChannelId: channelId,
        },
        {
          agentId: "agent-3",
          name: "Agent Three",
          notificationChannelId: "different-channel",
        },
      ],
    });
    mockDb.agent.query = mockAgentsQuery;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-456",
      params: {
        workspaceId,
        channelId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockAgentsQuery).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "Cannot delete channel: it is being used by 2 agent(s): Agent One, Agent Two"
            ),
          }),
        }),
      })
    );
  });

  it("should delete channel successfully when agents exist but none use this channel", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const channelId = "channel-abc-123";
    const channelPk = `output-channels/${workspaceId}/${channelId}`;

    const mockChannel = {
      pk: channelPk,
      sk: "channel",
      workspaceId,
      channelId,
      type: "discord",
      name: "My Channel",
      config: {},
    };

    const mockChannelGet = vi.fn().mockResolvedValue(mockChannel);
    mockDb["output_channel"].get = mockChannelGet;

    const mockChannelDelete = vi.fn().mockResolvedValue(undefined);
    mockDb["output_channel"].delete = mockChannelDelete;

    // Mock agents query - agents exist but use different channels
    const mockAgentsQuery = vi.fn().mockResolvedValue({
      items: [
        {
          agentId: "agent-1",
          name: "Agent One",
          notificationChannelId: "other-channel-1",
        },
        {
          agentId: "agent-2",
          name: "Agent Two",
          notificationChannelId: "other-channel-2",
        },
        {
          agentId: "agent-3",
          name: "Agent Three",
          notificationChannelId: null,
        },
      ],
    });
    mockDb.agent.query = mockAgentsQuery;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-456",
      params: {
        workspaceId,
        channelId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockAgentsQuery).toHaveBeenCalled();
    expect(mockChannelDelete).toHaveBeenCalledWith(channelPk, "channel");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
