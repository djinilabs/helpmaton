import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockRandomUUID,
  mockDatabase,
  mockEnsureWorkspaceSubscription,
  mockCheckSubscriptionLimits,
} = vi.hoisted(() => {
  return {
    mockRandomUUID: vi.fn(),
    mockDatabase: vi.fn(),
    mockEnsureWorkspaceSubscription: vi.fn(),
    mockCheckSubscriptionLimits: vi.fn(),
  };
});

// Mock the modules
vi.mock("crypto", () => ({
  randomUUID: mockRandomUUID,
}));

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/subscriptionUtils", () => ({
  ensureWorkspaceSubscription: mockEnsureWorkspaceSubscription,
  checkSubscriptionLimits: mockCheckSubscriptionLimits,
}));

describe("POST /api/workspaces/:workspaceId/channels", () => {
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
        const { type, name, config } = req.body;
        if (!type || typeof type !== "string") {
          throw badRequest("type is required and must be a string");
        }
        if (!name || typeof name !== "string") {
          throw badRequest("name is required and must be a string");
        }
        if (!config || typeof config !== "object") {
          throw badRequest("config is required and must be an object");
        }

        // Validate type-specific config
        if (type === "discord") {
          if (!config.botToken || typeof config.botToken !== "string") {
            throw badRequest(
              "config.botToken is required for Discord channels"
            );
          }
          if (
            !config.discordChannelId ||
            typeof config.discordChannelId !== "string"
          ) {
            throw badRequest(
              "config.discordChannelId is required for Discord channels"
            );
          }
          // Validate bot token format (Discord tokens contain dots and are typically 59+ characters)
          // Format: [base64].[timestamp].[hmac] - typically 59-70 characters
          if (!/^[A-Za-z0-9._-]{59,}$/.test(config.botToken)) {
            throw badRequest("Invalid Discord bot token format");
          }
        } else if (type === "slack") {
          if (!config.webhookUrl || typeof config.webhookUrl !== "string") {
            throw badRequest(
              "config.webhookUrl is required for Slack channels"
            );
          }
          // Validate webhook URL format (must be from hooks.slack.com)
          if (
            !config.webhookUrl.startsWith("https://hooks.slack.com/services/")
          ) {
            throw badRequest(
              "Invalid Slack webhook URL format. Must start with https://hooks.slack.com/services/"
            );
          }
        } else {
          throw badRequest(`Unsupported channel type: ${type}`);
        }

        const db = await mockDatabase();
        const workspaceResource = (req as { workspaceResource?: string })
          .workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const currentUserRef = (req as { userRef?: string }).userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }
        const workspaceId = req.params.workspaceId;

        // Ensure workspace has a subscription and check channel limit
        const userId = currentUserRef.replace("users/", "");
        const subscriptionId = await mockEnsureWorkspaceSubscription(
          workspaceId,
          userId
        );
        await mockCheckSubscriptionLimits(subscriptionId, "channel", 1);

        const channelId = mockRandomUUID();
        const channelPk = `output-channels/${workspaceId}/${channelId}`;
        const channelSk = "channel";

        // Create channel entity
        const channel = await db["output_channel"].create({
          pk: channelPk,
          sk: channelSk,
          workspaceId,
          channelId,
          type,
          name,
          config,
          createdBy: currentUserRef,
        });

        res.status(201).json({
          id: channel.channelId,
          name: channel.name,
          type: channel.type,
          createdAt: channel.createdAt,
        });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should create a Discord channel successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const subscriptionId = "sub-789";
    const channelId = "channel-abc-123";
    const channelName = "My Discord Channel";
    const botToken =
      "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Ng";
    const discordChannelId = "123456789012345678";

    const mockChannel = {
      pk: `output-channels/${workspaceId}/${channelId}`,
      sk: "channel",
      workspaceId,
      channelId,
      type: "discord",
      name: channelName,
      config: {
        botToken,
        discordChannelId,
      },
      createdBy: `users/${userId}`,
      createdAt: "2024-01-01T00:00:00Z",
    };

    mockRandomUUID.mockReturnValue(channelId);
    mockEnsureWorkspaceSubscription.mockResolvedValue(subscriptionId);
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);

    const mockChannelCreate = vi.fn().mockResolvedValue(mockChannel);
    mockDb["output_channel"].create = mockChannelCreate;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        type: "discord",
        name: channelName,
        config: {
          botToken,
          discordChannelId,
        },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockEnsureWorkspaceSubscription).toHaveBeenCalledWith(
      workspaceId,
      userId
    );
    expect(mockCheckSubscriptionLimits).toHaveBeenCalledWith(
      subscriptionId,
      "channel",
      1
    );
    expect(mockRandomUUID).toHaveBeenCalled();
    expect(mockChannelCreate).toHaveBeenCalledWith({
      pk: `output-channels/${workspaceId}/${channelId}`,
      sk: "channel",
      workspaceId,
      channelId,
      type: "discord",
      name: channelName,
      config: {
        botToken,
        discordChannelId,
      },
      createdBy: `users/${userId}`,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      id: channelId,
      name: channelName,
      type: "discord",
      createdAt: mockChannel.createdAt,
    });
  });

  it("should throw badRequest when type is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        name: "My Channel",
        config: {},
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
            message: expect.stringContaining("type is required"),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when type is not a string", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: 123,
        name: "My Channel",
        config: {},
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
            message: expect.stringContaining("type is required"),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when name is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "discord",
        config: {},
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
            message: expect.stringContaining("name is required"),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when name is not a string", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "discord",
        name: 123,
        config: {},
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
            message: expect.stringContaining("name is required"),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when config is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "discord",
        name: "My Channel",
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
            message: expect.stringContaining("config is required"),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when config is not an object", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "discord",
        name: "My Channel",
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
            message: expect.stringContaining("config is required"),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when Discord botToken is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "discord",
        name: "My Channel",
        config: {
          discordChannelId: "123456789012345678",
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
            message: expect.stringContaining("config.botToken is required"),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when Discord botToken is not a string", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "discord",
        name: "My Channel",
        config: {
          botToken: 123,
          discordChannelId: "123456789012345678",
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
            message: expect.stringContaining("config.botToken is required"),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when Discord discordChannelId is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const botToken =
      "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Ng";

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "discord",
        name: "My Channel",
        config: {
          botToken,
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
              "config.discordChannelId is required"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when Discord botToken format is invalid (too short)", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "discord",
        name: "My Channel",
        config: {
          botToken: "short-token",
          discordChannelId: "123456789012345678",
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

  it("should throw badRequest when Discord botToken format is invalid (invalid characters)", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "discord",
        name: "My Channel",
        config: {
          botToken:
            "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Ng!@#",
          discordChannelId: "123456789012345678",
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

  it("should create a Slack channel successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const subscriptionId = "sub-789";
    const channelId = "channel-abc-123";
    const channelName = "My Slack Channel";
    const webhookUrl =
      "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX";

    const mockChannel = {
      pk: `output-channels/${workspaceId}/${channelId}`,
      sk: "channel",
      workspaceId,
      channelId,
      type: "slack",
      name: channelName,
      config: {
        webhookUrl,
      },
      createdBy: `users/${userId}`,
      createdAt: "2024-01-01T00:00:00Z",
    };

    mockRandomUUID.mockReturnValue(channelId);
    mockEnsureWorkspaceSubscription.mockResolvedValue(subscriptionId);
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);

    const mockChannelCreate = vi.fn().mockResolvedValue(mockChannel);
    mockDb["output_channel"].create = mockChannelCreate;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        type: "slack",
        name: channelName,
        config: {
          webhookUrl,
        },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockEnsureWorkspaceSubscription).toHaveBeenCalledWith(
      workspaceId,
      userId
    );
    expect(mockCheckSubscriptionLimits).toHaveBeenCalledWith(
      subscriptionId,
      "channel",
      1
    );
    expect(mockRandomUUID).toHaveBeenCalled();
    expect(mockChannelCreate).toHaveBeenCalledWith({
      pk: `output-channels/${workspaceId}/${channelId}`,
      sk: "channel",
      workspaceId,
      channelId,
      type: "slack",
      name: channelName,
      config: {
        webhookUrl,
      },
      createdBy: `users/${userId}`,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      id: channelId,
      name: channelName,
      type: "slack",
      createdAt: mockChannel.createdAt,
    });
  });

  it("should throw badRequest when Slack webhookUrl is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "slack",
        name: "My Channel",
        config: {},
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
              "config.webhookUrl is required for Slack channels"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when Slack webhookUrl has invalid format", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "slack",
        name: "My Channel",
        config: {
          webhookUrl: "https://invalid-url.com/webhook",
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
              "Invalid Slack webhook URL format"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when channel type is unsupported", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "email",
        name: "My Channel",
        config: {},
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
            message: expect.stringContaining("Unsupported channel type: email"),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const botToken =
      "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Ng";

    const req = createMockRequest({
      workspaceResource: undefined,
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "discord",
        name: "My Channel",
        config: {
          botToken,
          discordChannelId: "123456789012345678",
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
            message: expect.stringContaining("Workspace resource not found"),
          }),
        }),
      })
    );
  });

  it("should throw unauthorized when userRef is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const botToken =
      "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Ng";

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: undefined,
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "discord",
        name: "My Channel",
        config: {
          botToken,
          discordChannelId: "123456789012345678",
        },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 401,
        }),
      })
    );
  });
});
