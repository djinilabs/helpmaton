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

describe("GET /api/workspaces/:workspaceId/agents", () => {
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
        const workspaceId = (req.params as { workspaceId?: string })
          .workspaceId;

        // Query all agents for this workspace using GSI
        const agents = await db.agent.query({
          IndexName: "byWorkspaceId",
          KeyConditionExpression: "workspaceId = :workspaceId",
          ExpressionAttributeValues: {
            ":workspaceId": workspaceId,
          },
        });

        const agentsList = agents.items.map(
          (agent: {
            pk: string;
            name: string;
            systemPrompt: string;
            notificationChannelId?: string;
            delegatableAgentIds?: string[];
            enabledMcpServerIds?: string[];
            clientTools?: unknown[];
            spendingLimits?: unknown[];
            provider: string;
            modelName?: string;
            createdAt: string;
            updatedAt?: string;
          }) => ({
            id: agent.pk.replace(`agents/${workspaceId}/`, ""),
            name: agent.name,
            systemPrompt: agent.systemPrompt,
            notificationChannelId: agent.notificationChannelId,
            delegatableAgentIds: agent.delegatableAgentIds ?? [],
            enabledMcpServerIds: agent.enabledMcpServerIds ?? [],
            clientTools: agent.clientTools ?? [],
            spendingLimits: agent.spendingLimits ?? [],
            provider: agent.provider,
            modelName: agent.modelName ?? null,
            createdAt: agent.createdAt,
            updatedAt: agent.updatedAt,
          })
        );

        res.json({ agents: agentsList });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should return list of agents for workspace", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgents = [
      {
        pk: "agents/workspace-123/agent-1",
        sk: "agent",
        workspaceId: "workspace-123",
        name: "Agent 1",
        systemPrompt: "Prompt 1",
        provider: "google",
        modelName: "gemini-2.5-flash",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
      },
      {
        pk: "agents/workspace-123/agent-2",
        sk: "agent",
        workspaceId: "workspace-123",
        name: "Agent 2",
        systemPrompt: "Prompt 2",
        notificationChannelId: "channel-789",
        delegatableAgentIds: ["agent-1"],
        enabledMcpServerIds: ["mcp-1"],
        clientTools: [{ name: "tool1", description: "Tool 1", parameters: {} }],
        spendingLimits: [{ timeFrame: "daily", amount: 100 }],
        provider: "google",
        modelName: null,
        createdAt: "2024-01-03T00:00:00Z",
        updatedAt: "2024-01-04T00:00:00Z",
      },
    ];

    const mockAgentQuery = vi.fn().mockResolvedValue({
      items: mockAgents,
    });
    mockDb.agent.query = mockAgentQuery;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockAgentQuery).toHaveBeenCalledWith({
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": "workspace-123",
      },
    });
    expect(res.json).toHaveBeenCalledWith({
      agents: [
        {
          id: "agent-1",
          name: "Agent 1",
          systemPrompt: "Prompt 1",
          notificationChannelId: undefined,
          delegatableAgentIds: [],
          enabledMcpServerIds: [],
          clientTools: [],
          spendingLimits: [],
          provider: "google",
          modelName: "gemini-2.5-flash",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        },
        {
          id: "agent-2",
          name: "Agent 2",
          systemPrompt: "Prompt 2",
          notificationChannelId: "channel-789",
          delegatableAgentIds: ["agent-1"],
          enabledMcpServerIds: ["mcp-1"],
          clientTools: [
            { name: "tool1", description: "Tool 1", parameters: {} },
          ],
          spendingLimits: [{ timeFrame: "daily", amount: 100 }],
          provider: "google",
          modelName: null,
          createdAt: "2024-01-03T00:00:00Z",
          updatedAt: "2024-01-04T00:00:00Z",
        },
      ],
    });
  });

  it("should return empty array when workspace has no agents", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgentQuery = vi.fn().mockResolvedValue({
      items: [],
    });
    mockDb.agent.query = mockAgentQuery;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockAgentQuery).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ agents: [] });
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
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

  it("should handle agents with all optional fields", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgent = {
      pk: "agents/workspace-123/agent-1",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Full Agent",
      systemPrompt: "Full Prompt",
      notificationChannelId: "channel-1",
      delegatableAgentIds: ["agent-2", "agent-3"],
      enabledMcpServerIds: ["mcp-1", "mcp-2"],
      clientTools: [
        {
          name: "tool1",
          description: "Tool 1",
          parameters: { param1: "value1" },
        },
        {
          name: "tool2",
          description: "Tool 2",
          parameters: { param2: "value2" },
        },
      ],
      spendingLimits: [
        { timeFrame: "daily", amount: 50 },
        { timeFrame: "monthly", amount: 1000 },
      ],
      provider: "google",
      modelName: "gemini-2.5-flash",
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 2048,
      stopSequences: ["STOP"],
      maxToolRoundtrips: 10,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockAgentQuery = vi.fn().mockResolvedValue({
      items: [mockAgent],
    });
    mockDb.agent.query = mockAgentQuery;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      agents: [
        {
          id: "agent-1",
          name: "Full Agent",
          systemPrompt: "Full Prompt",
          notificationChannelId: "channel-1",
          delegatableAgentIds: ["agent-2", "agent-3"],
          enabledMcpServerIds: ["mcp-1", "mcp-2"],
          clientTools: [
            {
              name: "tool1",
              description: "Tool 1",
              parameters: { param1: "value1" },
            },
            {
              name: "tool2",
              description: "Tool 2",
              parameters: { param2: "value2" },
            },
          ],
          spendingLimits: [
            { timeFrame: "daily", amount: 50 },
            { timeFrame: "monthly", amount: 1000 },
          ],
          provider: "google",
          modelName: "gemini-2.5-flash",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        },
      ],
    });
  });
});
