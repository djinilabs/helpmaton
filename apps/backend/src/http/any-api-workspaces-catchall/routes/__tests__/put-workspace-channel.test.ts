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

describe("PUT /api/workspaces/:workspaceId/channels/:channelId", () => {
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
        const { name, config } = req.body;
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

        // Validate config if provided
        if (config !== undefined) {
          if (typeof config !== "object") {
            throw badRequest("config must be an object");
          }
          if (channel.type === "discord") {
            if (
              config.botToken !== undefined &&
              typeof config.botToken !== "string"
            ) {
              throw badRequest("config.botToken must be a string");
            }
            if (
              config.discordChannelId !== undefined &&
              typeof config.discordChannelId !== "string"
            ) {
              throw badRequest("config.discordChannelId must be a string");
            }
            // Validate bot token format if provided (Discord tokens contain dots and are typically 59+ characters)
            if (
              config.botToken &&
              !/^[A-Za-z0-9._-]{59,}$/.test(config.botToken)
            ) {
              throw badRequest("Invalid Discord bot token format");
            }
          }
        }

        // Merge config if provided
        const updatedConfig =
          config !== undefined
            ? { ...channel.config, ...config }
            : channel.config;

        // Update channel
        const updated = await db["output_channel"].update({
          pk: channelPk,
          sk: "channel",
          workspaceId,
          channelId,
          type: channel.type,
          name: name !== undefined ? name : channel.name,
          config: updatedConfig,
          updatedBy: (req as { userRef?: string }).userRef || "",
          updatedAt: new Date().toISOString(),
        });

        res.json({
          id: updated.channelId,
          name: updated.name,
          type: updated.type,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should update channel name successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const channelId = "channel-abc-123";
    const userId = "user-456";
    const channelPk = `output-channels/${workspaceId}/${channelId}`;

    const mockChannel = {
      pk: channelPk,
      sk: "channel",
      workspaceId,
      channelId,
      type: "discord",
      name: "Old Channel Name",
      config: {
        botToken:
          "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Ng",
        discordChannelId: "123456789012345678",
      },
      createdBy: `users/${userId}`,
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockUpdatedChannel = {
      ...mockChannel,
      name: "New Channel Name",
      updatedBy: `users/${userId}`,
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockChannelGet = vi.fn().mockResolvedValue(mockChannel);
    mockDb["output_channel"].get = mockChannelGet;

    const mockChannelUpdate = vi.fn().mockResolvedValue(mockUpdatedChannel);
    mockDb["output_channel"].update = mockChannelUpdate;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
        channelId,
      },
      body: {
        name: "New Channel Name",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockChannelGet).toHaveBeenCalledWith(channelPk, "channel");
    expect(mockChannelUpdate).toHaveBeenCalledWith({
      pk: channelPk,
      sk: "channel",
      workspaceId,
      channelId,
      type: "discord",
      name: "New Channel Name",
      config: mockChannel.config,
      updatedBy: `users/${userId}`,
      updatedAt: expect.any(String),
    });
    expect(res.json).toHaveBeenCalledWith({
      id: channelId,
      name: "New Channel Name",
      type: "discord",
      createdAt: mockChannel.createdAt,
      updatedAt: mockUpdatedChannel.updatedAt,
    });
  });

  it("should update channel config successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const channelId = "channel-abc-123";
    const userId = "user-456";
    const channelPk = `output-channels/${workspaceId}/${channelId}`;

    const mockChannel = {
      pk: channelPk,
      sk: "channel",
      workspaceId,
      channelId,
      type: "discord",
      name: "My Channel",
      config: {
        botToken:
          "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Ng",
        discordChannelId: "123456789012345678",
      },
      createdBy: `users/${userId}`,
      createdAt: "2024-01-01T00:00:00Z",
    };

    const newBotToken =
      "QWJjZGVmZ2hpamsxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNA";
    const newDiscordChannelId = "987654321098765432";

    const mockUpdatedChannel = {
      ...mockChannel,
      config: {
        botToken: newBotToken,
        discordChannelId: newDiscordChannelId,
      },
      updatedBy: `users/${userId}`,
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockChannelGet = vi.fn().mockResolvedValue(mockChannel);
    mockDb["output_channel"].get = mockChannelGet;

    const mockChannelUpdate = vi.fn().mockResolvedValue(mockUpdatedChannel);
    mockDb["output_channel"].update = mockChannelUpdate;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
        channelId,
      },
      body: {
        config: {
          botToken: newBotToken,
          discordChannelId: newDiscordChannelId,
        },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockChannelUpdate).toHaveBeenCalledWith({
      pk: channelPk,
      sk: "channel",
      workspaceId,
      channelId,
      type: "discord",
      name: mockChannel.name,
      config: {
        botToken: newBotToken,
        discordChannelId: newDiscordChannelId,
      },
      updatedBy: `users/${userId}`,
      updatedAt: expect.any(String),
    });
    expect(res.json).toHaveBeenCalledWith({
      id: channelId,
      name: mockChannel.name,
      type: "discord",
      createdAt: mockChannel.createdAt,
      updatedAt: mockUpdatedChannel.updatedAt,
    });
  });

  it("should merge config when updating only part of config", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const channelId = "channel-abc-123";
    const userId = "user-456";
    const channelPk = `output-channels/${workspaceId}/${channelId}`;

    const mockChannel = {
      pk: channelPk,
      sk: "channel",
      workspaceId,
      channelId,
      type: "discord",
      name: "My Channel",
      config: {
        botToken:
          "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Ng",
        discordChannelId: "123456789012345678",
      },
      createdBy: `users/${userId}`,
      createdAt: "2024-01-01T00:00:00Z",
    };

    const newBotToken =
      "QWJjZGVmZ2hpamsxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNA";

    const mockUpdatedChannel = {
      ...mockChannel,
      config: {
        botToken: newBotToken,
        discordChannelId: mockChannel.config.discordChannelId, // Preserved
      },
      updatedBy: `users/${userId}`,
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockChannelGet = vi.fn().mockResolvedValue(mockChannel);
    mockDb["output_channel"].get = mockChannelGet;

    const mockChannelUpdate = vi.fn().mockResolvedValue(mockUpdatedChannel);
    mockDb["output_channel"].update = mockChannelUpdate;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
        channelId,
      },
      body: {
        config: {
          botToken: newBotToken,
        },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockChannelUpdate).toHaveBeenCalledWith({
      pk: channelPk,
      sk: "channel",
      workspaceId,
      channelId,
      type: "discord",
      name: mockChannel.name,
      config: {
        botToken: newBotToken,
        discordChannelId: mockChannel.config.discordChannelId,
      },
      updatedBy: `users/${userId}`,
      updatedAt: expect.any(String),
    });
  });

  it("should update both name and config successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const channelId = "channel-abc-123";
    const userId = "user-456";
    const channelPk = `output-channels/${workspaceId}/${channelId}`;

    const mockChannel = {
      pk: channelPk,
      sk: "channel",
      workspaceId,
      channelId,
      type: "discord",
      name: "Old Channel Name",
      config: {
        botToken:
          "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Ng",
        discordChannelId: "123456789012345678",
      },
      createdBy: `users/${userId}`,
      createdAt: "2024-01-01T00:00:00Z",
    };

    const newBotToken =
      "QWJjZGVmZ2hpamsxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNA";
    const newDiscordChannelId = "987654321098765432";

    const mockUpdatedChannel = {
      ...mockChannel,
      name: "New Channel Name",
      config: {
        botToken: newBotToken,
        discordChannelId: newDiscordChannelId,
      },
      updatedBy: `users/${userId}`,
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockChannelGet = vi.fn().mockResolvedValue(mockChannel);
    mockDb["output_channel"].get = mockChannelGet;

    const mockChannelUpdate = vi.fn().mockResolvedValue(mockUpdatedChannel);
    mockDb["output_channel"].update = mockChannelUpdate;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
        channelId,
      },
      body: {
        name: "New Channel Name",
        config: {
          botToken: newBotToken,
          discordChannelId: newDiscordChannelId,
        },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockChannelUpdate).toHaveBeenCalledWith({
      pk: channelPk,
      sk: "channel",
      workspaceId,
      channelId,
      type: "discord",
      name: "New Channel Name",
      config: {
        botToken: newBotToken,
        discordChannelId: newDiscordChannelId,
      },
      updatedBy: `users/${userId}`,
      updatedAt: expect.any(String),
    });
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
      body: {
        name: "New Name",
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
      body: {
        name: "New Name",
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
      body: {
        name: "New Name",
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

  it("should throw badRequest when config is not an object", async () => {
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

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-456",
      params: {
        workspaceId,
        channelId,
      },
      body: {
        config: "not-an-object",
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
            message: expect.stringContaining("config must be an object"),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when Discord botToken is not a string", async () => {
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

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-456",
      params: {
        workspaceId,
        channelId,
      },
      body: {
        config: {
          botToken: 123,
        },
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
            message: expect.stringContaining(
              "config.botToken must be a string"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when Discord discordChannelId is not a string", async () => {
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

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-456",
      params: {
        workspaceId,
        channelId,
      },
      body: {
        config: {
          discordChannelId: 123,
        },
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
            message: expect.stringContaining(
              "config.discordChannelId must be a string"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when Discord botToken format is invalid", async () => {
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

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-456",
      params: {
        workspaceId,
        channelId,
      },
      body: {
        config: {
          botToken: "short-token",
        },
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
            message: expect.stringContaining(
              "Invalid Discord bot token format"
            ),
          }),
        }),
      })
    );
  });

  it("should not update anything when body is empty", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const channelId = "channel-abc-123";
    const userId = "user-456";
    const channelPk = `output-channels/${workspaceId}/${channelId}`;

    const mockChannel = {
      pk: channelPk,
      sk: "channel",
      workspaceId,
      channelId,
      type: "discord",
      name: "My Channel",
      config: {
        botToken:
          "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Ng",
        discordChannelId: "123456789012345678",
      },
      createdBy: `users/${userId}`,
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockUpdatedChannel = {
      ...mockChannel,
      updatedBy: `users/${userId}`,
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockChannelGet = vi.fn().mockResolvedValue(mockChannel);
    mockDb["output_channel"].get = mockChannelGet;

    const mockChannelUpdate = vi.fn().mockResolvedValue(mockUpdatedChannel);
    mockDb["output_channel"].update = mockChannelUpdate;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
        channelId,
      },
      body: {},
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockChannelUpdate).toHaveBeenCalledWith({
      pk: channelPk,
      sk: "channel",
      workspaceId,
      channelId,
      type: "discord",
      name: mockChannel.name,
      config: mockChannel.config,
      updatedBy: `users/${userId}`,
      updatedAt: expect.any(String),
    });
  });
});
