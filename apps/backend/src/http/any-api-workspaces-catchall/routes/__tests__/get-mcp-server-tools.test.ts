import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { buildMcpServerToolList } from "../../../../utils/toolMetadata";
import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

const { mockDatabase } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
  };
});

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

describe("GET /api/workspaces/:workspaceId/mcp-servers/:serverId/tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
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

        const config = server.config as { accessToken?: string };
        const oauthConnected =
          server.authType === "oauth" && !!config.accessToken;

        const toolList = buildMcpServerToolList({
          serverName: server.name,
          serviceType: server.serviceType,
          authType: server.authType,
          oauthConnected,
        });

        res.json(toolList);
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should return MCP server tools", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const serverId = "server-456";

    const mockServer = {
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      workspaceId,
      name: "PostHog Server",
      url: "https://app.posthog.com",
      authType: "header",
      serviceType: "posthog",
      config: {
        apiKey: "secret",
      },
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

    expect(res.json).toHaveBeenCalledWith(
      buildMcpServerToolList({
        serverName: "PostHog Server",
        serviceType: "posthog",
        authType: "header",
        oauthConnected: false,
      })
    );
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

  it("should throw forbidden when MCP server belongs to another workspace", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const serverId = "server-456";

    const mockServer = {
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      workspaceId: "workspace-other",
      name: "GitHub Server",
      url: "https://api.github.com",
      authType: "header",
      serviceType: "github",
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

  it("should return Not available conditions when OAuth is disconnected", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const serverId = "server-456";

    const mockServer = {
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      workspaceId,
      name: "Drive Server",
      url: "https://www.googleapis.com",
      authType: "oauth",
      serviceType: "google-drive",
      config: {},
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

    const response = res as { json: ReturnType<typeof vi.fn> };
    const toolList = response.json.mock.calls[0]?.[0] as ReturnType<
      typeof buildMcpServerToolList
    >;
    const hasNotAvailable = toolList[0]?.tools.some((tool) =>
      tool.condition?.includes("Not available")
    );
    expect(hasNotAvailable).toBe(true);
  });
});
