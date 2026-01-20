import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";
import { handlePutMcpServer } from "../put-mcp-server-handler";

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

vi.mock("../../../utils/bodyValidation", () => ({
  validateBody: vi.fn((body) => body),
}));

describe("PUT /api/workspaces/:workspaceId/mcp-servers/:serverId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    await handlePutMcpServer(
      req as express.Request,
      res as express.Response,
      next
    );
  }

  it("should update MCP server name successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const existingServer = {
      pk,
      sk: "server",
      workspaceId,
      name: "Old Server Name",
      url: "https://api.example.com",
      authType: "none" as const,
      config: {},
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const updatedServer = {
      ...existingServer,
      name: "New Server Name",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(existingServer);
    const mockUpdate = vi.fn().mockResolvedValue(updatedServer);
    const mcpServerMock = (mockDb as Record<string, unknown>)["mcp-server"] as {
      get: typeof mockGet;
      update: typeof mockUpdate;
    };
    mcpServerMock.get = mockGet;
    mcpServerMock.update = mockUpdate;

    const req = createMockRequest({
      workspaceResource,
      userRef: "users/user-789",
      params: {
        workspaceId,
        serverId,
      },
      body: {
        name: "New Server Name",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGet).toHaveBeenCalledWith(pk, "server");
    expect(mockUpdate).toHaveBeenCalledWith({
      pk,
      sk: "server",
      workspaceId,
      name: "New Server Name",
      url: existingServer.url,
      authType: existingServer.authType,
      config: existingServer.config,
      updatedBy: "users/user-789",
      updatedAt: expect.any(String),
    });
    expect(res.json).toHaveBeenCalledWith({
      id: serverId,
      name: updatedServer.name,
      url: updatedServer.url,
      authType: updatedServer.authType,
      createdAt: updatedServer.createdAt,
      updatedAt: updatedServer.updatedAt,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should update MCP server URL successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const existingServer = {
      pk,
      sk: "server",
      workspaceId,
      name: "Test Server",
      url: "https://old.example.com",
      authType: "none" as const,
      config: {},
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const updatedServer = {
      ...existingServer,
      url: "https://new.example.com",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(existingServer);
    const mockUpdate = vi.fn().mockResolvedValue(updatedServer);
    const mcpServerMock = (mockDb as Record<string, unknown>)["mcp-server"] as {
      get: typeof mockGet;
      update: typeof mockUpdate;
    };
    mcpServerMock.get = mockGet;
    mcpServerMock.update = mockUpdate;

    const req = createMockRequest({
      workspaceResource,
      userRef: "users/user-789",
      params: {
        workspaceId,
        serverId,
      },
      body: {
        url: "https://new.example.com",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({
      pk,
      sk: "server",
      workspaceId,
      name: existingServer.name,
      url: "https://new.example.com",
      authType: existingServer.authType,
      config: existingServer.config,
      updatedBy: "users/user-789",
      updatedAt: expect.any(String),
    });
    expect(res.json).toHaveBeenCalledWith({
      id: serverId,
      name: updatedServer.name,
      url: updatedServer.url,
      authType: updatedServer.authType,
      createdAt: updatedServer.createdAt,
      updatedAt: updatedServer.updatedAt,
    });
  });

  it("should update MCP server authType and config successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const existingServer = {
      pk,
      sk: "server",
      workspaceId,
      name: "Test Server",
      url: "https://example.com",
      authType: "none" as const,
      config: {},
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const updatedServer = {
      ...existingServer,
      authType: "header" as const,
      config: { headerValue: "Bearer token-123" },
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(existingServer);
    const mockUpdate = vi.fn().mockResolvedValue(updatedServer);
    const mcpServerMock = (mockDb as Record<string, unknown>)["mcp-server"] as {
      get: typeof mockGet;
      update: typeof mockUpdate;
    };
    mcpServerMock.get = mockGet;
    mcpServerMock.update = mockUpdate;

    const req = createMockRequest({
      workspaceResource,
      userRef: "users/user-789",
      params: {
        workspaceId,
        serverId,
      },
      body: {
        authType: "header",
        config: { headerValue: "Bearer token-123" },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({
      pk,
      sk: "server",
      workspaceId,
      name: existingServer.name,
      url: existingServer.url,
      authType: "header",
      config: { headerValue: "Bearer token-123" },
      updatedBy: "users/user-789",
      updatedAt: expect.any(String),
    });
    expect(res.json).toHaveBeenCalledWith({
      id: serverId,
      name: updatedServer.name,
      url: updatedServer.url,
      authType: updatedServer.authType,
      createdAt: updatedServer.createdAt,
      updatedAt: updatedServer.updatedAt,
    });
  });

  it("should update config only when authType is unchanged", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const existingServer = {
      pk,
      sk: "server",
      workspaceId,
      name: "Test Server",
      url: "https://example.com",
      authType: "header" as const,
      config: { headerValue: "Old token" },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const updatedServer = {
      ...existingServer,
      config: { headerValue: "New token" },
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(existingServer);
    const mockUpdate = vi.fn().mockResolvedValue(updatedServer);
    const mcpServerMock = (mockDb as Record<string, unknown>)["mcp-server"] as {
      get: typeof mockGet;
      update: typeof mockUpdate;
    };
    mcpServerMock.get = mockGet;
    mcpServerMock.update = mockUpdate;

    const req = createMockRequest({
      workspaceResource,
      userRef: "users/user-789",
      params: {
        workspaceId,
        serverId,
      },
      body: {
        config: { headerValue: "New token" },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({
      pk,
      sk: "server",
      workspaceId,
      name: existingServer.name,
      url: existingServer.url,
      authType: existingServer.authType,
      config: { headerValue: "New token" },
      updatedBy: "users/user-789",
      updatedAt: expect.any(String),
    });
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
        serverId: "server-456",
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
            message: "Workspace resource not found",
          }),
        }),
      })
    );
    expect(res.json).not.toHaveBeenCalled();
  });

  it("should throw resourceGone when MCP server is not found", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const mockGet = vi.fn().mockResolvedValue(null);
    const mcpServerMock = (mockDb as Record<string, unknown>)["mcp-server"] as {
      get: typeof mockGet;
    };
    mcpServerMock.get = mockGet;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        serverId,
      },
      body: {
        name: "New Name",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGet).toHaveBeenCalledWith(pk, "server");
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 410,
          payload: expect.objectContaining({
            message: "MCP server not found",
          }),
        }),
      })
    );
    expect(res.json).not.toHaveBeenCalled();
  });

  it("should throw forbidden when MCP server belongs to different workspace", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const existingServer = {
      pk,
      sk: "server",
      workspaceId: "different-workspace-789",
      name: "Test Server",
      url: "https://example.com",
      authType: "none" as const,
      config: {},
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(existingServer);
    const mcpServerMock = (mockDb as Record<string, unknown>)["mcp-server"] as {
      get: typeof mockGet;
    };
    mcpServerMock.get = mockGet;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        serverId,
      },
      body: {
        name: "New Name",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGet).toHaveBeenCalledWith(pk, "server");
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 403,
          payload: expect.objectContaining({
            message: "MCP server does not belong to this workspace",
          }),
        }),
      })
    );
    expect(res.json).not.toHaveBeenCalled();
  });

  it("should throw badRequest when name is not a string", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const existingServer = {
      pk,
      sk: "server",
      workspaceId,
      name: "Test Server",
      url: "https://example.com",
      authType: "none" as const,
      config: {},
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(existingServer);
    const mcpServerMock = (mockDb as Record<string, unknown>)["mcp-server"] as {
      get: typeof mockGet;
    };
    mcpServerMock.get = mockGet;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        serverId,
      },
      body: {
        name: 123,
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
            message: "name must be a string",
          }),
        }),
      })
    );
  });

  it("should throw badRequest when url is invalid", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const existingServer = {
      pk,
      sk: "server",
      workspaceId,
      name: "Test Server",
      url: "https://example.com",
      authType: "none" as const,
      config: {},
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(existingServer);
    const mcpServerMock = (mockDb as Record<string, unknown>)["mcp-server"] as {
      get: typeof mockGet;
    };
    mcpServerMock.get = mockGet;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        serverId,
      },
      body: {
        url: "not-a-valid-url",
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

  it("should throw badRequest when authType is invalid", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const existingServer = {
      pk,
      sk: "server",
      workspaceId,
      name: "Test Server",
      url: "https://example.com",
      authType: "none" as const,
      config: {},
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(existingServer);
    const mcpServerMock = (mockDb as Record<string, unknown>)["mcp-server"] as {
      get: typeof mockGet;
    };
    mcpServerMock.get = mockGet;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        serverId,
      },
      body: {
        authType: "invalid",
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
            message: 'authType must be one of: "none", "header", "basic", "oauth"',
          }),
        }),
      })
    );
  });

  it("should throw badRequest when config is not an object", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const existingServer = {
      pk,
      sk: "server",
      workspaceId,
      name: "Test Server",
      url: "https://example.com",
      authType: "none" as const,
      config: {},
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(existingServer);
    const mcpServerMock = (mockDb as Record<string, unknown>)["mcp-server"] as {
      get: typeof mockGet;
    };
    mcpServerMock.get = mockGet;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        serverId,
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
            message: "config must be an object",
          }),
        }),
      })
    );
  });

  it("should throw badRequest when Shopify shopDomain is invalid", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const existingServer = {
      pk,
      sk: "server",
      workspaceId,
      name: "Shopify Server",
      url: "https://example.com",
      authType: "oauth" as const,
      serviceType: "shopify",
      config: { shopDomain: "valid.myshopify.com" },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(existingServer);
    const mcpServerMock = (mockDb as Record<string, unknown>)["mcp-server"] as {
      get: typeof mockGet;
    };
    mcpServerMock.get = mockGet;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        serverId,
      },
      body: {
        config: {
          shopDomain: "not-a-shop",
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
            message:
              "shopDomain must be a valid Shopify domain like my-store.myshopify.com",
          }),
        }),
      })
    );
  });

  it("should throw badRequest when setting OAuth authType with tokens in config", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const existingServer = {
      pk,
      sk: "server",
      workspaceId,
      name: "Test Server",
      url: "https://example.com",
      authType: "none" as const,
      config: {},
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(existingServer);
    const mcpServerMock = (mockDb as Record<string, unknown>)["mcp-server"] as {
      get: typeof mockGet;
    };
    mcpServerMock.get = mockGet;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        serverId,
      },
      body: {
        authType: "oauth",
        config: {
          accessToken: "token",
          refreshToken: "refresh",
          expiresAt: "2026-01-01T00:00:00.000Z",
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
            message:
              "OAuth tokens cannot be updated via this endpoint. Use OAuth endpoints instead.",
          }),
        }),
      })
    );
  });

  it("should throw badRequest when header authType config is missing headerValue", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const existingServer = {
      pk,
      sk: "server",
      workspaceId,
      name: "Test Server",
      url: "https://example.com",
      authType: "header" as const,
      config: { headerValue: "Old token" },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(existingServer);
    const mcpServerMock = (mockDb as Record<string, unknown>)["mcp-server"] as {
      get: typeof mockGet;
    };
    mcpServerMock.get = mockGet;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        serverId,
      },
      body: {
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

  it("should throw badRequest when basic authType config is missing username", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const existingServer = {
      pk,
      sk: "server",
      workspaceId,
      name: "Test Server",
      url: "https://example.com",
      authType: "basic" as const,
      config: { username: "user", password: "pass" },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(existingServer);
    const mcpServerMock = (mockDb as Record<string, unknown>)["mcp-server"] as {
      get: typeof mockGet;
    };
    mcpServerMock.get = mockGet;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        serverId,
      },
      body: {
        config: {
          password: "pass",
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

  it("should throw badRequest when basic authType config is missing password", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const existingServer = {
      pk,
      sk: "server",
      workspaceId,
      name: "Test Server",
      url: "https://example.com",
      authType: "basic" as const,
      config: { username: "user", password: "pass" },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(existingServer);
    const mcpServerMock = (mockDb as Record<string, unknown>)["mcp-server"] as {
      get: typeof mockGet;
    };
    mcpServerMock.get = mockGet;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        serverId,
      },
      body: {
        config: {
          username: "user",
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
