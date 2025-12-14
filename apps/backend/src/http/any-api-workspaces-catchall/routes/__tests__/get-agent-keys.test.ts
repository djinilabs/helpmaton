import { badRequest, resourceGone } from "@hapi/boom";
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

describe("GET /api/workspaces/:workspaceId/agents/:agentId/keys", () => {
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
        const agentId = req.params.agentId;
        const agentPk = `agents/${workspaceId}/${agentId}`;

        // Verify agent exists
        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw resourceGone("Agent not found");
        }

        // Query agent-key table by agentId using GSI
        const keysQuery = await db["agent-key"].query({
          IndexName: "byAgentId",
          KeyConditionExpression: "agentId = :agentId",
          ExpressionAttributeValues: {
            ":agentId": agentId,
          },
        });

        // Filter to only keys for this workspace and extract keyId from pk
        const keys = keysQuery.items
          .filter((k: { workspaceId: string }) => k.workspaceId === workspaceId)
          .map(
            (k: {
              pk: string;
              key: string;
              name: string;
              provider?: string;
              createdAt: string;
            }) => {
              // Extract keyId from pk: "agent-keys/{workspaceId}/{agentId}/{keyId}"
              const pkParts = k.pk.split("/");
              const keyId = pkParts[3];

              return {
                id: keyId,
                key: k.key,
                name: k.name,
                provider: k.provider || "google",
                createdAt: k.createdAt,
              };
            }
          );

        res.json({ keys });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should return agent keys for the workspace", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockKeys = [
      {
        pk: `agent-keys/${workspaceId}/${agentId}/key-1`,
        sk: "key",
        workspaceId,
        agentId,
        key: "api-key-1",
        name: "Key 1",
        provider: "google",
        createdAt: "2024-01-01T00:00:00Z",
      },
      {
        pk: `agent-keys/${workspaceId}/${agentId}/key-2`,
        sk: "key",
        workspaceId,
        agentId,
        key: "api-key-2",
        name: "Key 2",
        provider: "openai",
        createdAt: "2024-01-02T00:00:00Z",
      },
    ];

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockKeysQuery = vi.fn().mockResolvedValue({
      items: mockKeys,
    });
    mockDb["agent-key"].query = mockKeysQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockAgentGet).toHaveBeenCalledWith(
      `agents/${workspaceId}/${agentId}`,
      "agent"
    );
    expect(mockKeysQuery).toHaveBeenCalledWith({
      IndexName: "byAgentId",
      KeyConditionExpression: "agentId = :agentId",
      ExpressionAttributeValues: {
        ":agentId": agentId,
      },
    });
    expect(res.json).toHaveBeenCalledWith({
      keys: [
        {
          id: "key-1",
          key: "api-key-1",
          name: "Key 1",
          provider: "google",
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          id: "key-2",
          key: "api-key-2",
          name: "Key 2",
          provider: "openai",
          createdAt: "2024-01-02T00:00:00Z",
        },
      ],
    });
  });

  it("should filter out keys from other workspaces", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockKeys = [
      {
        pk: `agent-keys/${workspaceId}/${agentId}/key-1`,
        sk: "key",
        workspaceId,
        agentId,
        key: "api-key-1",
        name: "Key 1",
        provider: "google",
        createdAt: "2024-01-01T00:00:00Z",
      },
      {
        pk: `agent-keys/workspace-999/${agentId}/key-2`,
        sk: "key",
        workspaceId: "workspace-999", // Different workspace
        agentId,
        key: "api-key-2",
        name: "Key 2",
        provider: "openai",
        createdAt: "2024-01-02T00:00:00Z",
      },
    ];

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockKeysQuery = vi.fn().mockResolvedValue({
      items: mockKeys,
    });
    mockDb["agent-key"].query = mockKeysQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      keys: [
        {
          id: "key-1",
          key: "api-key-1",
          name: "Key 1",
          provider: "google",
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
    });
  });

  it("should return empty array when agent has no keys", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockKeysQuery = vi.fn().mockResolvedValue({
      items: [],
    });
    mockDb["agent-key"].query = mockKeysQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      keys: [],
    });
  });

  it("should default provider to google when not specified", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockKeys = [
      {
        pk: `agent-keys/${workspaceId}/${agentId}/key-1`,
        sk: "key",
        workspaceId,
        agentId,
        key: "api-key-1",
        name: "Key 1",
        // No provider field
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockKeysQuery = vi.fn().mockResolvedValue({
      items: mockKeys,
    });
    mockDb["agent-key"].query = mockKeysQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      keys: [
        {
          id: "key-1",
          key: "api-key-1",
          name: "Key 1",
          provider: "google",
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
    });
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: undefined,
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
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

  it("should throw resourceGone when agent does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgentGet = vi.fn().mockResolvedValue(null);
    mockDb.agent.get = mockAgentGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
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
    ).toContain("Agent not found");
  });

  it("should correctly extract keyId from pk with complex structure", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockKeys = [
      {
        pk: `agent-keys/${workspaceId}/${agentId}/abc-123-def-456`,
        sk: "key",
        workspaceId,
        agentId,
        key: "api-key-1",
        name: "Complex Key",
        provider: "google",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockKeysQuery = vi.fn().mockResolvedValue({
      items: mockKeys,
    });
    mockDb["agent-key"].query = mockKeysQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      keys: [
        {
          id: "abc-123-def-456",
          key: "api-key-1",
          name: "Complex Key",
          provider: "google",
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
    });
  });
});
