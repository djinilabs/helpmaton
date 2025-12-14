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

describe("DELETE /api/workspaces/:workspaceId/mcp-servers/:serverId", () => {
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

        // Check if any agents are using this MCP server
        const agentsResult = await db.agent.query({
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        });

        // Early exit if we find any agent using the server
        for (const agent of agentsResult.items) {
          if (
            agent.enabledMcpServerIds &&
            agent.enabledMcpServerIds.includes(serverId)
          ) {
            throw badRequest(
              `Cannot delete MCP server: at least one agent is using it. Please disable it in those agents first.`
            );
          }
        }

        // Delete server
        await db["mcp-server"].delete(pk, "server");

        res.status(204).send();
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should delete MCP server successfully when no agents are using it", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const mockServer = {
      pk,
      sk: "server",
      workspaceId,
      name: "GitHub Server",
      url: "https://api.github.com",
      authType: "bearer",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockServer);
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    const mockQuery = vi.fn().mockResolvedValue({
      items: [],
    });

    const mcpServerMock = (mockDb as Record<string, unknown>)["mcp-server"] as {
      get: typeof mockGet;
      delete: typeof mockDelete;
    };
    mcpServerMock.get = mockGet;
    mcpServerMock.delete = mockDelete;

    mockDb.agent.query = mockQuery;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        serverId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGet).toHaveBeenCalledWith(pk, "server");
    expect(mockQuery).toHaveBeenCalledWith({
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": workspaceId,
      },
    });
    expect(mockDelete).toHaveBeenCalledWith(pk, "server");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should delete MCP server successfully when agents exist but none are using it", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const mockServer = {
      pk,
      sk: "server",
      workspaceId,
      name: "GitHub Server",
      url: "https://api.github.com",
      authType: "bearer",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockServer);
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    const mockQuery = vi.fn().mockResolvedValue({
      items: [
        {
          pk: `agents/${workspaceId}/agent-1`,
          sk: "agent",
          workspaceId,
          name: "Agent 1",
          enabledMcpServerIds: ["server-789"], // Different server
        },
        {
          pk: `agents/${workspaceId}/agent-2`,
          sk: "agent",
          workspaceId,
          name: "Agent 2",
          enabledMcpServerIds: undefined, // No MCP servers
        },
      ],
    });

    const mcpServerMock = (mockDb as Record<string, unknown>)["mcp-server"] as {
      get: typeof mockGet;
      delete: typeof mockDelete;
    };
    mcpServerMock.get = mockGet;
    mcpServerMock.delete = mockDelete;

    mockDb.agent.query = mockQuery;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        serverId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGet).toHaveBeenCalledWith(pk, "server");
    expect(mockQuery).toHaveBeenCalledWith({
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": workspaceId,
      },
    });
    expect(mockDelete).toHaveBeenCalledWith(pk, "server");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const serverId = "server-456";

    const req = createMockRequest({
      params: {
        workspaceId,
        serverId,
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
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should throw forbidden when MCP server belongs to different workspace", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const mockServer = {
      pk,
      sk: "server",
      workspaceId: "different-workspace-789", // Different workspace
      name: "GitHub Server",
      url: "https://api.github.com",
      authType: "bearer",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockServer);
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
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should throw badRequest when an agent is using the MCP server", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const mockServer = {
      pk,
      sk: "server",
      workspaceId,
      name: "GitHub Server",
      url: "https://api.github.com",
      authType: "bearer",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockServer);
    const mockQuery = vi.fn().mockResolvedValue({
      items: [
        {
          pk: `agents/${workspaceId}/agent-1`,
          sk: "agent",
          workspaceId,
          name: "Agent 1",
          enabledMcpServerIds: ["server-789"], // Different server
        },
        {
          pk: `agents/${workspaceId}/agent-2`,
          sk: "agent",
          workspaceId,
          name: "Agent 2",
          enabledMcpServerIds: [serverId], // Using this server
        },
      ],
    });

    const mcpServerMock = (mockDb as Record<string, unknown>)["mcp-server"] as {
      get: typeof mockGet;
    };
    mcpServerMock.get = mockGet;

    mockDb.agent.query = mockQuery;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        serverId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGet).toHaveBeenCalledWith(pk, "server");
    expect(mockQuery).toHaveBeenCalledWith({
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": workspaceId,
      },
    });
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "Cannot delete MCP server: at least one agent is using it"
            ),
          }),
        }),
      })
    );
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should throw badRequest when multiple agents are using the MCP server", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const serverId = "server-456";
    const pk = `mcp-servers/${workspaceId}/${serverId}`;

    const mockServer = {
      pk,
      sk: "server",
      workspaceId,
      name: "GitHub Server",
      url: "https://api.github.com",
      authType: "bearer",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockServer);
    const mockQuery = vi.fn().mockResolvedValue({
      items: [
        {
          pk: `agents/${workspaceId}/agent-1`,
          sk: "agent",
          workspaceId,
          name: "Agent 1",
          enabledMcpServerIds: [serverId, "server-789"], // Using this server
        },
        {
          pk: `agents/${workspaceId}/agent-2`,
          sk: "agent",
          workspaceId,
          name: "Agent 2",
          enabledMcpServerIds: [serverId], // Also using this server
        },
      ],
    });

    const mcpServerMock = (mockDb as Record<string, unknown>)["mcp-server"] as {
      get: typeof mockGet;
    };
    mcpServerMock.get = mockGet;

    mockDb.agent.query = mockQuery;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        serverId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGet).toHaveBeenCalledWith(pk, "server");
    expect(mockQuery).toHaveBeenCalledWith({
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": workspaceId,
      },
    });
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "Cannot delete MCP server: at least one agent is using it"
            ),
          }),
        }),
      })
    );
    expect(res.status).not.toHaveBeenCalled();
  });
});
