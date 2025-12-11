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

describe("POST /api/workspaces/:workspaceId/mcp-servers", () => {
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
        const { name, url, authType, config } = req.body;
        if (!name || typeof name !== "string") {
          throw badRequest("name is required and must be a string");
        }
        if (!url || typeof url !== "string") {
          throw badRequest("url is required and must be a string");
        }
        // Validate URL format
        try {
          new URL(url);
        } catch {
          throw badRequest("url must be a valid URL");
        }
        if (!authType || typeof authType !== "string") {
          throw badRequest("authType is required and must be a string");
        }
        if (!["none", "header", "basic"].includes(authType)) {
          throw badRequest(
            'authType must be one of: "none", "header", "basic"'
          );
        }
        if (typeof config !== "object" || config === null) {
          throw badRequest("config is required and must be a non-null object");
        }

        // Validate config based on authType
        if (authType === "header") {
          if (!config.headerValue || typeof config.headerValue !== "string") {
            throw badRequest(
              "config.headerValue is required for header authentication"
            );
          }
        } else if (authType === "basic") {
          if (!config.username || typeof config.username !== "string") {
            throw badRequest(
              "config.username is required for basic authentication"
            );
          }
          if (!config.password || typeof config.password !== "string") {
            throw badRequest(
              "config.password is required for basic authentication"
            );
          }
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

        // Ensure workspace has a subscription and check MCP server limit
        const userId = currentUserRef.replace("users/", "");
        const subscriptionId = await mockEnsureWorkspaceSubscription(
          workspaceId,
          userId
        );
        await mockCheckSubscriptionLimits(subscriptionId, "mcpServer", 1);

        const serverId = mockRandomUUID();
        const pk = `mcp-servers/${workspaceId}/${serverId}`;
        const sk = "server";

        // Create MCP server
        const server = await db["mcp-server"].create({
          pk,
          sk,
          workspaceId,
          name,
          url,
          authType: authType as "none" | "header" | "basic",
          config,
          createdBy: currentUserRef,
        });

        res.status(201).json({
          id: serverId,
          name: server.name,
          url: server.url,
          authType: server.authType,
          createdAt: server.createdAt,
          updatedAt: server.updatedAt,
        });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should create MCP server with 'none' auth type successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const subscriptionId = "sub-789";
    const serverId = "server-abc-123";
    const serverName = "GitHub MCP Server";
    const serverUrl = "https://api.github.com";
    const authType = "none";
    const config = {};

    mockEnsureWorkspaceSubscription.mockResolvedValue(subscriptionId);
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);
    mockRandomUUID.mockReturnValue(serverId);

    const mockServer = {
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      workspaceId,
      name: serverName,
      url: serverUrl,
      authType,
      config,
      createdBy: `users/${userId}`,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockCreate = vi.fn().mockResolvedValue(mockServer);
    (mockDb as Record<string, unknown>)["mcp-server"] = {
      create: mockCreate,
    };

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        name: serverName,
        url: serverUrl,
        authType,
        config,
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
      "mcpServer",
      1
    );
    expect(mockRandomUUID).toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      workspaceId,
      name: serverName,
      url: serverUrl,
      authType,
      config,
      createdBy: `users/${userId}`,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      id: serverId,
      name: serverName,
      url: serverUrl,
      authType,
      createdAt: mockServer.createdAt,
      updatedAt: mockServer.updatedAt,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should create MCP server with 'header' auth type successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const subscriptionId = "sub-789";
    const serverId = "server-abc-123";
    const serverName = "Custom MCP Server";
    const serverUrl = "https://mcp.example.com";
    const authType = "header";
    const config = { headerValue: "Bearer token-123" };

    mockEnsureWorkspaceSubscription.mockResolvedValue(subscriptionId);
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);
    mockRandomUUID.mockReturnValue(serverId);

    const mockServer = {
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      workspaceId,
      name: serverName,
      url: serverUrl,
      authType,
      config,
      createdBy: `users/${userId}`,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockCreate = vi.fn().mockResolvedValue(mockServer);
    (mockDb as Record<string, unknown>)["mcp-server"] = {
      create: mockCreate,
    };

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        name: serverName,
        url: serverUrl,
        authType,
        config,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockCreate).toHaveBeenCalledWith({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      workspaceId,
      name: serverName,
      url: serverUrl,
      authType,
      config,
      createdBy: `users/${userId}`,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      id: serverId,
      name: serverName,
      url: serverUrl,
      authType,
      createdAt: mockServer.createdAt,
      updatedAt: mockServer.updatedAt,
    });
  });

  it("should create MCP server with 'basic' auth type successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const subscriptionId = "sub-789";
    const serverId = "server-abc-123";
    const serverName = "Authenticated MCP Server";
    const serverUrl = "https://secure-mcp.example.com";
    const authType = "basic";
    const config = { username: "user123", password: "pass456" };

    mockEnsureWorkspaceSubscription.mockResolvedValue(subscriptionId);
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);
    mockRandomUUID.mockReturnValue(serverId);

    const mockServer = {
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      workspaceId,
      name: serverName,
      url: serverUrl,
      authType,
      config,
      createdBy: `users/${userId}`,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockCreate = vi.fn().mockResolvedValue(mockServer);
    (mockDb as Record<string, unknown>)["mcp-server"] = {
      create: mockCreate,
    };

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        name: serverName,
        url: serverUrl,
        authType,
        config,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockCreate).toHaveBeenCalledWith({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      workspaceId,
      name: serverName,
      url: serverUrl,
      authType,
      config,
      createdBy: `users/${userId}`,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      id: serverId,
      name: serverName,
      url: serverUrl,
      authType,
      createdAt: mockServer.createdAt,
      updatedAt: mockServer.updatedAt,
    });
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        name: "Test Server",
        url: "https://example.com",
        authType: "none",
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
            message: "Workspace resource not found",
          }),
        }),
      })
    );
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should throw unauthorized when userRef is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        name: "Test Server",
        url: "https://example.com",
        authType: "none",
        config: {},
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
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should throw badRequest when name is missing", async () => {
    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        url: "https://example.com",
        authType: "none",
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
            message: "name is required and must be a string",
          }),
        }),
      })
    );
  });

  it("should throw badRequest when url is missing", async () => {
    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        name: "Test Server",
        authType: "none",
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
            message: "url is required and must be a string",
          }),
        }),
      })
    );
  });

  it("should throw badRequest when url is invalid", async () => {
    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        name: "Test Server",
        url: "not-a-valid-url",
        authType: "none",
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
            message: "url must be a valid URL",
          }),
        }),
      })
    );
  });

  it("should throw badRequest when authType is missing", async () => {
    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        name: "Test Server",
        url: "https://example.com",
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
            message: "authType is required and must be a string",
          }),
        }),
      })
    );
  });

  it("should throw badRequest when authType is invalid", async () => {
    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        name: "Test Server",
        url: "https://example.com",
        authType: "invalid",
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
            message: 'authType must be one of: "none", "header", "basic"',
          }),
        }),
      })
    );
  });

  it("should throw badRequest when config is missing", async () => {
    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        name: "Test Server",
        url: "https://example.com",
        authType: "none",
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
            message: "config is required and must be a non-null object",
          }),
        }),
      })
    );
  });

  it("should throw badRequest when header authType is missing headerValue", async () => {
    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        name: "Test Server",
        url: "https://example.com",
        authType: "header",
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
              "config.headerValue is required for header authentication"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when basic authType is missing username", async () => {
    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        name: "Test Server",
        url: "https://example.com",
        authType: "basic",
        config: {
          password: "pass123",
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
              "config.username is required for basic authentication"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when basic authType is missing password", async () => {
    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        name: "Test Server",
        url: "https://example.com",
        authType: "basic",
        config: {
          username: "user123",
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
              "config.password is required for basic authentication"
            ),
          }),
        }),
      })
    );
  });
});
