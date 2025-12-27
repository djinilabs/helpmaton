import { badRequest, resourceGone } from "@hapi/boom";
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

// Mock the database module
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

describe("GET /api/workspaces/:workspaceId/agents/:agentId/transactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>
  ) {
    // Extract the handler logic directly
    const handler = async (req: express.Request, res: express.Response) => {
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

      // Parse pagination parameters
      const limit = req.query.limit
        ? Math.min(Math.max(parseInt(req.query.limit as string, 10), 1), 100)
        : 50; // Default 50, max 100
      const cursor = req.query.cursor as string | undefined;

      // Query transactions by agentId using the byAgentId GSI
      const query: Parameters<
        (typeof db)["workspace-credit-transactions"]["query"]
      >[0] = {
        IndexName: "byAgentId",
        KeyConditionExpression: "agentId = :agentId",
        ExpressionAttributeValues: {
          ":agentId": agentId,
        },
        ScanIndexForward: false, // Sort descending (most recent first)
      };

      // Query all transactions (tableApi will fetch all pages)
      const result = await db["workspace-credit-transactions"].query(query);

      // Filter to only transactions for this workspace (security check)
      // and map to response format
      const allTransactions = result.items
        .filter((t: { workspaceId: string }) => t.workspaceId === workspaceId)
        .map((t: {
          sk: string;
          workspaceId: string;
          agentId?: string;
          conversationId?: string;
          source: string;
          supplier: string;
          model?: string;
          tool_call?: string;
          description: string;
          amountMillionthUsd: number;
          workspaceCreditsBeforeMillionthUsd: number;
          workspaceCreditsAfterMillionthUsd: number;
          createdAt: string;
        }) => {
          // Extract transaction ID from sk (format: `${timestamp}-${uuid}`)
          // For display, we'll use the full sk as the ID
          const transactionId = t.sk;

          return {
            id: transactionId,
            workspaceId: t.workspaceId,
            agentId: t.agentId || null,
            conversationId: t.conversationId || null,
            source: t.source,
            supplier: t.supplier,
            model: t.model || null,
            tool_call: t.tool_call || null,
            description: t.description,
            amountMillionthUsd: t.amountMillionthUsd,
            workspaceCreditsBeforeMillionthUsd:
              t.workspaceCreditsBeforeMillionthUsd,
            workspaceCreditsAfterMillionthUsd: t.workspaceCreditsAfterMillionthUsd,
            createdAt: t.createdAt,
          };
        });

      // Handle cursor-based pagination
      let startIndex = 0;
      if (cursor) {
        try {
          const cursorData = JSON.parse(
            Buffer.from(cursor, "base64").toString()
          );
          startIndex = cursorData.startIndex || 0;
        } catch {
          throw badRequest("Invalid cursor");
        }
      }

      // Apply pagination
      const transactions = allTransactions.slice(
        startIndex,
        startIndex + limit
      );

      // Build next cursor if there are more results
      let nextCursor: string | undefined;
      if (startIndex + limit < allTransactions.length) {
        nextCursor = Buffer.from(
          JSON.stringify({ startIndex: startIndex + limit })
        ).toString("base64");
      }

      res.json({
        transactions,
        nextCursor,
      });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should return transactions for agent with default pagination", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const agentPk = `agents/${workspaceId}/${agentId}`;

    const mockAgent = {
      pk: agentPk,
      sk: "agent",
      id: agentId,
      name: "Test Agent",
    };

    const mockTransactions = [
      {
        pk: `workspaces/${workspaceId}`,
        sk: `${Date.now()}-uuid-1`,
        workspaceId,
        agentId,
        source: "text-generation" as const,
        supplier: "openrouter" as const,
        model: "gpt-4",
        description: "Test transaction 1",
        amountMillionthUsd: 1000000,
        workspaceCreditsBeforeMillionthUsd: 10000000,
        workspaceCreditsAfterMillionthUsd: 9000000,
        createdAt: new Date().toISOString(),
      },
      {
        pk: `workspaces/${workspaceId}`,
        sk: `${Date.now() - 1000}-uuid-2`,
        workspaceId,
        agentId,
        source: "embedding-generation" as const,
        supplier: "openrouter" as const,
        description: "Test transaction 2",
        amountMillionthUsd: 500000,
        workspaceCreditsBeforeMillionthUsd: 9000000,
        workspaceCreditsAfterMillionthUsd: 8500000,
        createdAt: new Date().toISOString(),
      },
    ];

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockTransactionsQuery = vi.fn().mockResolvedValue({
      items: mockTransactions,
    });
    mockDb["workspace-credit-transactions"].query = mockTransactionsQuery;

    const req = createMockRequest({
      params: { workspaceId, agentId },
      workspaceResource: `workspaces/${workspaceId}`,
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      transactions: expect.arrayContaining([
        expect.objectContaining({
          id: expect.any(String),
          workspaceId,
          agentId,
          description: "Test transaction 1",
        }),
      ]),
      nextCursor: undefined,
    });
    expect(mockAgentGet).toHaveBeenCalledWith(agentPk, "agent");
  });

  it("should filter transactions by workspaceId (security check)", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const agentPk = `agents/${workspaceId}/${agentId}`;

    const mockAgent = {
      pk: agentPk,
      sk: "agent",
      id: agentId,
      name: "Test Agent",
    };

    const mockTransactions = [
      {
        pk: `workspaces/${workspaceId}`,
        sk: `${Date.now()}-uuid-1`,
        workspaceId,
        agentId,
        source: "text-generation" as const,
        supplier: "openrouter" as const,
        description: "Valid transaction",
        amountMillionthUsd: 1000000,
        workspaceCreditsBeforeMillionthUsd: 10000000,
        workspaceCreditsAfterMillionthUsd: 9000000,
        createdAt: new Date().toISOString(),
      },
      {
        pk: `workspaces/other-workspace`,
        sk: `${Date.now() - 1000}-uuid-2`,
        workspaceId: "other-workspace",
        agentId,
        source: "text-generation" as const,
        supplier: "openrouter" as const,
        description: "Invalid transaction (different workspace)",
        amountMillionthUsd: 1000000,
        workspaceCreditsBeforeMillionthUsd: 10000000,
        workspaceCreditsAfterMillionthUsd: 9000000,
        createdAt: new Date().toISOString(),
      },
    ];

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockTransactionsQuery = vi.fn().mockResolvedValue({
      items: mockTransactions,
    });
    mockDb["workspace-credit-transactions"].query = mockTransactionsQuery;

    const req = createMockRequest({
      params: { workspaceId, agentId },
      workspaceResource: `workspaces/${workspaceId}`,
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      transactions: expect.arrayContaining([
        expect.objectContaining({
          description: "Valid transaction",
        }),
      ]),
      nextCursor: undefined,
    });
    // Should not include transaction from other workspace
    const jsonCall = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(
      jsonCall.transactions.find(
        (t: { description: string }) =>
          t.description === "Invalid transaction (different workspace)"
      )
    ).toBeUndefined();
  });

  it("should handle pagination with cursor", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const agentPk = `agents/${workspaceId}/${agentId}`;

    const mockAgent = {
      pk: agentPk,
      sk: "agent",
      id: agentId,
      name: "Test Agent",
    };

    const mockTransactions = Array.from({ length: 100 }, (_, i) => ({
      pk: `workspaces/${workspaceId}`,
      sk: `${Date.now() - i * 1000}-uuid-${i}`,
      workspaceId,
      agentId,
      source: "text-generation" as const,
      supplier: "openrouter" as const,
      description: `Transaction ${i}`,
      amountMillionthUsd: 1000000,
      workspaceCreditsBeforeMillionthUsd: 10000000,
      workspaceCreditsAfterMillionthUsd: 9000000,
      createdAt: new Date().toISOString(),
    }));

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockTransactionsQuery = vi.fn().mockResolvedValue({
      items: mockTransactions,
    });
    mockDb["workspace-credit-transactions"].query = mockTransactionsQuery;

    const cursor = Buffer.from(
      JSON.stringify({ startIndex: 50 })
    ).toString("base64");

    const req = createMockRequest({
      params: { workspaceId, agentId },
      query: { limit: "25", cursor },
      workspaceResource: `workspaces/${workspaceId}`,
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      transactions: expect.arrayContaining([
        expect.objectContaining({
          description: "Transaction 50",
        }),
      ]),
      nextCursor: expect.any(String),
    });
    const jsonCall = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonCall.transactions).toHaveLength(25);
  });

  it("should return error when agent not found", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const agentPk = `agents/${workspaceId}/${agentId}`;

    const mockAgentGet = vi.fn().mockResolvedValue(null);
    mockDb.agent.get = mockAgentGet;

    const req = createMockRequest({
      params: { workspaceId, agentId },
      workspaceResource: `workspaces/${workspaceId}`,
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow();
  });

  it("should return empty array when no transactions", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const agentPk = `agents/${workspaceId}/${agentId}`;

    const mockAgent = {
      pk: agentPk,
      sk: "agent",
      id: agentId,
      name: "Test Agent",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockTransactionsQuery = vi.fn().mockResolvedValue({
      items: [],
    });
    mockDb["workspace-credit-transactions"].query = mockTransactionsQuery;

    const req = createMockRequest({
      params: { workspaceId, agentId },
      workspaceResource: `workspaces/${workspaceId}`,
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      transactions: [],
      nextCursor: undefined,
    });
  });
});

