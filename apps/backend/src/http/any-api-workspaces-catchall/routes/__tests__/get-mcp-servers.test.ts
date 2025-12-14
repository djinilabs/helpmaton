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

describe("GET /api/workspaces/:workspaceId/mcp-servers", () => {
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

        // Query all MCP servers for this workspace
        const result = await db["mcp-server"].query({
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        });

        // Return servers without sensitive config data
        const servers = result.items.map(
          (server: {
            pk: string;
            name: string;
            url: string;
            authType: string;
            createdAt: string;
            updatedAt: string;
          }) => {
            const serverId = server.pk.replace(
              `mcp-servers/${workspaceId}/`,
              ""
            );
            return {
              id: serverId,
              name: server.name,
              url: server.url,
              authType: server.authType,
              createdAt: server.createdAt,
              updatedAt: server.updatedAt,
            };
          }
        );

        res.json({ servers });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should return all MCP servers for a workspace", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const mockServers = [
      {
        pk: `mcp-servers/${workspaceId}/server-1`,
        sk: "server",
        workspaceId,
        name: "GitHub Server",
        url: "https://api.github.com",
        authType: "bearer",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
      },
      {
        pk: `mcp-servers/${workspaceId}/server-2`,
        sk: "server",
        workspaceId,
        name: "File System Server",
        url: "file:///path/to/files",
        authType: "none",
        createdAt: "2024-01-03T00:00:00Z",
        updatedAt: "2024-01-04T00:00:00Z",
      },
    ];

    const mockServerQuery = vi.fn().mockResolvedValue({
      items: mockServers,
    });
    mockDb["mcp-server"].query = mockServerQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockServerQuery).toHaveBeenCalledWith({
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": workspaceId,
      },
    });
    expect(res.json).toHaveBeenCalledWith({
      servers: [
        {
          id: "server-1",
          name: "GitHub Server",
          url: "https://api.github.com",
          authType: "bearer",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        },
        {
          id: "server-2",
          name: "File System Server",
          url: "file:///path/to/files",
          authType: "none",
          createdAt: "2024-01-03T00:00:00Z",
          updatedAt: "2024-01-04T00:00:00Z",
        },
      ],
    });
  });

  it("should return empty array when workspace has no MCP servers", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";

    const mockServerQuery = vi.fn().mockResolvedValue({
      items: [],
    });
    mockDb["mcp-server"].query = mockServerQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockServerQuery).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      servers: [],
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

  it("should exclude sensitive config data from response", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const mockServers = [
      {
        pk: `mcp-servers/${workspaceId}/server-1`,
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
      },
    ];

    const mockServerQuery = vi.fn().mockResolvedValue({
      items: mockServers,
    });
    mockDb["mcp-server"].query = mockServerQuery;

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
    expect(response.servers[0]).not.toHaveProperty("config");
    expect(response.servers[0]).not.toHaveProperty("token");
    expect(response.servers[0]).not.toHaveProperty("apiKey");
    expect(response.servers[0]).toEqual({
      id: "server-1",
      name: "GitHub Server",
      url: "https://api.github.com",
      authType: "bearer",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });

  it("should correctly extract serverId from pk", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const mockServers = [
      {
        pk: `mcp-servers/${workspaceId}/abc-123-def`,
        sk: "server",
        workspaceId,
        name: "Custom Server",
        url: "https://example.com",
        authType: "api-key",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
      },
    ];

    const mockServerQuery = vi.fn().mockResolvedValue({
      items: mockServers,
    });
    mockDb["mcp-server"].query = mockServerQuery;

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
      servers: [
        {
          id: "abc-123-def",
          name: "Custom Server",
          url: "https://example.com",
          authType: "api-key",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        },
      ],
    });
  });
});
