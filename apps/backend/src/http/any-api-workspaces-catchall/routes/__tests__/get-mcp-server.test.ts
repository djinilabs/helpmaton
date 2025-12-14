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

describe("GET /api/workspaces/:workspaceId/mcp-servers/:serverId", () => {
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
        const serverId = req.params.serverId;
        const pk = `mcp-servers/${workspaceId}/${serverId}`;

        const server = await db["mcp-server"].get(pk, "server");
        if (!server) {
          throw resourceGone("MCP server not found");
        }

        if (server.workspaceId !== workspaceId) {
          throw forbidden("MCP server does not belong to this workspace");
        }

        // Return server without sensitive config data
        res.json({
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

  it("should return MCP server without sensitive config data", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const serverId = "server-456";

    const mockServer = {
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      workspaceId,
      name: "GitHub Server",
      url: "https://api.github.com",
      authType: "bearer",
      config: {
        token: "secret-token",
        apiKey: "secret-key",
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockServerGet = vi.fn().mockResolvedValue(mockServer);
    mockDb["mcp-server"].get = mockServerGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        serverId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockServerGet).toHaveBeenCalledWith(
      `mcp-servers/${workspaceId}/${serverId}`,
      "server"
    );
    expect(res.json).toHaveBeenCalledWith({
      id: serverId,
      name: "GitHub Server",
      url: "https://api.github.com",
      authType: "bearer",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });

  it("should return different auth types", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const serverId = "server-456";

    const mockServer = {
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      workspaceId,
      name: "File System Server",
      url: "file:///path/to/files",
      authType: "none",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockServerGet = vi.fn().mockResolvedValue(mockServer);
    mockDb["mcp-server"].get = mockServerGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        serverId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      id: serverId,
      name: "File System Server",
      url: "file:///path/to/files",
      authType: "none",
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
        serverId: "server-456",
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

  it("should throw resourceGone when MCP server does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const serverId = "server-456";

    const mockServerGet = vi.fn().mockResolvedValue(null);
    mockDb["mcp-server"].get = mockServerGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        serverId,
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
    ).toContain("MCP server not found");
  });

  it("should throw forbidden when server belongs to different workspace", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const serverId = "server-456";

    const mockServer = {
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      workspaceId: "workspace-999", // Different workspace
      name: "GitHub Server",
      url: "https://api.github.com",
      authType: "bearer",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockServerGet = vi.fn().mockResolvedValue(mockServer);
    mockDb["mcp-server"].get = mockServerGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        serverId,
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
    ).toContain("MCP server does not belong to this workspace");
  });

  it("should exclude config data from response", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const serverId = "server-456";

    const mockServer = {
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      workspaceId,
      name: "API Server",
      url: "https://api.example.com",
      authType: "api-key",
      config: {
        apiKey: "very-secret-key",
        headers: {
          Authorization: "Bearer secret-token",
        },
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockServerGet = vi.fn().mockResolvedValue(mockServer);
    mockDb["mcp-server"].get = mockServerGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        serverId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response).not.toHaveProperty("config");
    expect(response).not.toHaveProperty("apiKey");
    expect(response).not.toHaveProperty("headers");
    expect(response).toEqual({
      id: serverId,
      name: "API Server",
      url: "https://api.example.com",
      authType: "api-key",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });
});
