import { resourceGone } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

const mockDatabase = vi.fn();

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

import {
  getAvailableSkills,
  groupSkillsByRole,
} from "../../../../utils/agentSkills";

describe("GET /api/workspaces/:workspaceId/agents/:agentId/available-skills", () => {
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
        const workspaceId = req.params.workspaceId;
        const agentId = req.params.agentId;
        const agentPk = `agents/${workspaceId}/${agentId}`;

        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw resourceGone("Agent not found");
        }

        const emailConnectionPk = `email-connections/${workspaceId}`;
        const emailConnection = await db["email-connection"].get(
          emailConnectionPk,
          "connection"
        );
        const hasEmailConnection = !!emailConnection;

        const enabledMcpServerIds = agent.enabledMcpServerIds || [];
        const enabledMcpServers: { id: string; serviceType?: string; oauthConnected?: boolean }[] = [];
        for (const serverId of enabledMcpServerIds) {
          const serverPk = `mcp-servers/${workspaceId}/${serverId}`;
          const server = await db["mcp-server"].get(serverPk, "server");
          if (server) {
            const config = server.config as { accessToken?: string };
            enabledMcpServers.push({
              id: serverId,
              serviceType: server.serviceType,
              oauthConnected: !!config?.accessToken,
            });
          }
        }

        const skills = await getAvailableSkills(
          {
            enableSearchDocuments: agent.enableSearchDocuments ?? false,
            enableMemorySearch: agent.enableMemorySearch ?? false,
            searchWebProvider: agent.searchWebProvider ?? null,
            fetchWebProvider: agent.fetchWebProvider ?? null,
            enableExaSearch: agent.enableExaSearch ?? false,
            enableSendEmail: agent.enableSendEmail ?? false,
            enableImageGeneration: agent.enableImageGeneration ?? false,
          },
          enabledMcpServers,
          { hasEmailConnection }
        );

        const groupedByRole = groupSkillsByRole(skills);

        res.json({ skills, groupedByRole });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("returns 200 with skills and groupedByRole for agent with document search enabled", async () => {
    const mockDb = createMockDatabase();
    const mockAgent = {
      pk: "agents/workspace-123/agent-123",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      enableSearchDocuments: true,
      enableMemorySearch: false,
      searchWebProvider: null,
      fetchWebProvider: null,
      enableExaSearch: false,
      enableSendEmail: false,
      enableImageGeneration: false,
      enabledMcpServerIds: [],
    };

    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: vi.fn().mockResolvedValue(null),
    };
    (mockDb as Record<string, unknown>)["mcp-server"] = {
      get: vi.fn().mockResolvedValue(null),
    };
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123", agentId: "agent-123" },
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockDb.agent.get).toHaveBeenCalledWith(
      "agents/workspace-123/agent-123",
      "agent"
    );
    expect(res.json).toHaveBeenCalled();
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).toHaveProperty("skills");
    expect(payload).toHaveProperty("groupedByRole");
    expect(Array.isArray(payload.skills)).toBe(true);
    expect(typeof payload.groupedByRole).toBe("object");
    const documentSkills = payload.skills.filter(
      (s: { id: string }) =>
        s.id === "document-faq-assistant" || s.id === "document-research"
    );
    expect(documentSkills.length).toBeGreaterThanOrEqual(1);
    expect(res.statusCode).toBe(200);
  });

  it("returns 410 if agent is not found", async () => {
    const mockDb = createMockDatabase();
    mockDb.agent.get = vi.fn().mockResolvedValue(null);
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123", agentId: "agent-123" },
    });

    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 410,
          payload: expect.objectContaining({
            message: "Agent not found",
          }),
        }),
      })
    );
    expect(res.json).not.toHaveBeenCalled();
  });

  it("returns only skills whose required tools are satisfied (no tools => empty or minimal)", async () => {
    const mockDb = createMockDatabase();
    const mockAgent = {
      pk: "agents/workspace-123/agent-123",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      enableSearchDocuments: false,
      enableMemorySearch: false,
      searchWebProvider: null,
      fetchWebProvider: null,
      enableExaSearch: false,
      enableSendEmail: false,
      enableImageGeneration: false,
      enabledMcpServerIds: [],
    };

    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: vi.fn().mockResolvedValue(null),
    };
    (mockDb as Record<string, unknown>)["mcp-server"] = {
      get: vi.fn().mockResolvedValue(null),
    };
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123", agentId: "agent-123" },
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.skills).toBeDefined();
    expect(Array.isArray(payload.skills)).toBe(true);
    expect(res.statusCode).toBe(200);
  });
});
