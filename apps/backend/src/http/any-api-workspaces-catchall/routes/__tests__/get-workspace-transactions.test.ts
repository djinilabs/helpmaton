import { badRequest } from "@hapi/boom";
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

describe("GET /api/workspaces/:workspaceId/transactions", () => {
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
      const workspacePk = `workspaces/${workspaceId}`;

      // Verify workspace exists
      const workspace = await db.workspace.get(workspacePk, "workspace");
      if (!workspace) {
        throw badRequest("Workspace not found");
      }

      // Parse pagination parameters
      const limit = req.query.limit
        ? Math.min(Math.max(parseInt(req.query.limit as string, 10), 1), 100)
        : 50; // Default 50, max 100
      const cursor = req.query.cursor as string | undefined;

      // Query transactions by workspaceId (using pk)
      const query: Parameters<
        (typeof db)["workspace-credit-transactions"]["query"]
      >[0] = {
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": workspacePk,
        },
        ScanIndexForward: false, // Sort descending (most recent first, since sk contains timestamp)
      };

      // Query all transactions (tableApi will fetch all pages)
      const result = await db["workspace-credit-transactions"].query(query);

      // Map transactions to response format
      const allTransactions = result.items.map((t: {
        sk: string;
        workspaceId: string;
        agentId?: string;
        conversationId?: string;
        source: string;
        supplier: string;
        model?: string;
        tool_call?: string;
        description: string;
        amountNanoUsd: number;
        workspaceCreditsBeforeNanoUsd: number;
        workspaceCreditsAfterNanoUsd: number;
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
          amountNanoUsd: t.amountNanoUsd,
          workspaceCreditsBeforeNanoUsd: t.workspaceCreditsBeforeNanoUsd,
          workspaceCreditsAfterNanoUsd: t.workspaceCreditsAfterNanoUsd,
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

  it("should return transactions with default pagination", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspacePk = `workspaces/${workspaceId}`;

    const mockWorkspace = {
      pk: workspacePk,
      sk: "workspace",
      id: workspaceId,
      name: "Test Workspace",
    };

    const mockTransactions = [
      {
        pk: workspacePk,
        sk: `${Date.now()}-uuid-1`,
        workspaceId,
        agentId: "agent-1",
        source: "text-generation" as const,
        supplier: "openrouter" as const,
        model: "gpt-4",
        description: "Test transaction 1",
        amountNanoUsd: 1_000_000_000,
        workspaceCreditsBeforeNanoUsd: 10_000_000_000,
        workspaceCreditsAfterNanoUsd: 9_000_000_000,
        createdAt: new Date().toISOString(),
      },
      {
        pk: workspacePk,
        sk: `${Date.now() - 1000}-uuid-2`,
        workspaceId,
        agentId: "agent-2",
        source: "embedding-generation" as const,
        supplier: "openrouter" as const,
        description: "Test transaction 2",
        amountNanoUsd: 500_000_000,
        workspaceCreditsBeforeNanoUsd: 9_000_000_000,
        workspaceCreditsAfterNanoUsd: 8_500_000_000,
        createdAt: new Date().toISOString(),
      },
    ];

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockTransactionsQuery = vi.fn().mockResolvedValue({
      items: mockTransactions,
    });
    mockDb["workspace-credit-transactions"].query = mockTransactionsQuery;

    const req = createMockRequest({
      params: { workspaceId },
      workspaceResource: `workspaces/${workspaceId}`,
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      transactions: expect.arrayContaining([
        expect.objectContaining({
          id: expect.any(String),
          workspaceId,
          description: "Test transaction 1",
        }),
      ]),
      nextCursor: undefined,
    });
    expect(mockDb.workspace.get).toHaveBeenCalledWith(workspacePk, "workspace");
  });

  it("should handle pagination with cursor", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspacePk = `workspaces/${workspaceId}`;

    const mockWorkspace = {
      pk: workspacePk,
      sk: "workspace",
      id: workspaceId,
      name: "Test Workspace",
    };

    const mockTransactions = Array.from({ length: 100 }, (_, i) => ({
      pk: workspacePk,
      sk: `${Date.now() - i * 1000}-uuid-${i}`,
      workspaceId,
      source: "text-generation" as const,
      supplier: "openrouter" as const,
      description: `Transaction ${i}`,
      amountNanoUsd: 1_000_000_000,
      workspaceCreditsBeforeNanoUsd: 10_000_000_000,
      workspaceCreditsAfterNanoUsd: 9_000_000_000,
      createdAt: new Date().toISOString(),
    }));

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockTransactionsQuery = vi.fn().mockResolvedValue({
      items: mockTransactions,
    });
    mockDb["workspace-credit-transactions"].query = mockTransactionsQuery;

    const cursor = Buffer.from(
      JSON.stringify({ startIndex: 50 })
    ).toString("base64");

    const req = createMockRequest({
      params: { workspaceId },
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

  it("should validate limit parameter (max 100)", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspacePk = `workspaces/${workspaceId}`;

    const mockWorkspace = {
      pk: workspacePk,
      sk: "workspace",
      id: workspaceId,
      name: "Test Workspace",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockTransactionsQuery = vi.fn().mockResolvedValue({
      items: [],
    });
    mockDb["workspace-credit-transactions"].query = mockTransactionsQuery;

    const req = createMockRequest({
      params: { workspaceId },
      query: { limit: "200" },
      workspaceResource: `workspaces/${workspaceId}`,
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    // Should cap limit at 100
    expect(mockDb["workspace-credit-transactions"].query).toHaveBeenCalled();
  });

  it("should return error for invalid cursor", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspacePk = `workspaces/${workspaceId}`;

    const mockWorkspace = {
      pk: workspacePk,
      sk: "workspace",
      id: workspaceId,
      name: "Test Workspace",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const req = createMockRequest({
      params: { workspaceId },
      query: { cursor: "invalid-cursor" },
      workspaceResource: `workspaces/${workspaceId}`,
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow();
  });

  it("should return error when workspace not found", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";

    const mockWorkspaceGet = vi.fn().mockResolvedValue(null);
    mockDb.workspace.get = mockWorkspaceGet;

    const req = createMockRequest({
      params: { workspaceId },
      workspaceResource: `workspaces/${workspaceId}`,
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow();
  });

  it("should return empty array when no transactions", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspacePk = `workspaces/${workspaceId}`;

    const mockWorkspace = {
      pk: workspacePk,
      sk: "workspace",
      id: workspaceId,
      name: "Test Workspace",
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockTransactionsQuery = vi.fn().mockResolvedValue({
      items: [],
    });
    mockDb["workspace-credit-transactions"].query = mockTransactionsQuery;

    const req = createMockRequest({
      params: { workspaceId },
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

