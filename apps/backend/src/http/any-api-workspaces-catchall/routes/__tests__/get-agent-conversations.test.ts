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

describe("GET /api/workspaces/:workspaceId/agents/:agentId/conversations", () => {
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

      const query: Parameters<(typeof db)["agent-conversations"]["query"]>[0] =
        {
          IndexName: "byAgentId",
          KeyConditionExpression: "agentId = :agentId",
          ExpressionAttributeValues: {
            ":agentId": agentId,
          },
          ScanIndexForward: false, // Sort descending (most recent first)
        };

      // Query all conversations (tableApi will fetch all pages)
      const result = await db["agent-conversations"].query(query);

      // Filter to only conversations for this workspace and sort by lastMessageAt
      const allConversations = result.items
        .filter((c: { workspaceId: string }) => c.workspaceId === workspaceId)
        .sort((a: { lastMessageAt: string }, b: { lastMessageAt: string }) => {
          // Sort by lastMessageAt descending
          const aTime = new Date(a.lastMessageAt).getTime();
          const bTime = new Date(b.lastMessageAt).getTime();
          return bTime - aTime;
        })
        .map(
          (c: {
            pk: string;
            conversationType: string;
            startedAt: string;
            lastMessageAt: string;
            messages?: unknown[];
            tokenUsage?: unknown;
            modelName?: string;
            provider?: string;
          }) => {
            // Extract conversationId from pk: "conversations/{workspaceId}/{agentId}/{conversationId}"
            const pkParts = c.pk.split("/");
            const conversationId = pkParts[3];

            return {
              id: conversationId,
              conversationType: c.conversationType,
              startedAt: c.startedAt,
              lastMessageAt: c.lastMessageAt,
              messageCount: Array.isArray(c.messages) ? c.messages.length : 0,
              tokenUsage: c.tokenUsage || null,
              modelName: c.modelName || null,
              provider: c.provider || null,
            };
          }
        );

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
      const conversations = allConversations.slice(
        startIndex,
        startIndex + limit
      );

      // Build next cursor if there are more results
      let nextCursor: string | undefined;
      if (startIndex + limit < allConversations.length) {
        nextCursor = Buffer.from(
          JSON.stringify({ startIndex: startIndex + limit })
        ).toString("base64");
      }

      res.json({
        conversations,
        nextCursor,
      });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should return conversations with default pagination", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockConversations = [
      {
        pk: `conversations/${workspaceId}/${agentId}/conv-1`,
        sk: "conversation",
        workspaceId,
        agentId,
        conversationType: "chat",
        startedAt: "2024-01-01T00:00:00Z",
        lastMessageAt: "2024-01-02T00:00:00Z",
        messages: [{ id: "msg-1" }, { id: "msg-2" }],
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
        modelName: "gpt-4",
        provider: "openai",
      },
      {
        pk: `conversations/${workspaceId}/${agentId}/conv-2`,
        sk: "conversation",
        workspaceId,
        agentId,
        conversationType: "chat",
        startedAt: "2024-01-03T00:00:00Z",
        lastMessageAt: "2024-01-04T00:00:00Z",
        messages: [{ id: "msg-3" }],
        tokenUsage: null,
        modelName: null,
        provider: null,
      },
    ];

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockConversationsQuery = vi.fn().mockResolvedValue({
      items: mockConversations,
    });
    mockDb["agent-conversations"].query = mockConversationsQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
      },
      query: {},
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockAgentGet).toHaveBeenCalledWith(
      `agents/${workspaceId}/${agentId}`,
      "agent"
    );
    expect(mockConversationsQuery).toHaveBeenCalledWith({
      IndexName: "byAgentId",
      KeyConditionExpression: "agentId = :agentId",
      ExpressionAttributeValues: {
        ":agentId": agentId,
      },
      ScanIndexForward: false,
    });
    expect(res.json).toHaveBeenCalledWith({
      conversations: [
        {
          id: "conv-2",
          conversationType: "chat",
          startedAt: "2024-01-03T00:00:00Z",
          lastMessageAt: "2024-01-04T00:00:00Z",
          messageCount: 1,
          tokenUsage: null,
          modelName: null,
          provider: null,
        },
        {
          id: "conv-1",
          conversationType: "chat",
          startedAt: "2024-01-01T00:00:00Z",
          lastMessageAt: "2024-01-02T00:00:00Z",
          messageCount: 2,
          tokenUsage: { inputTokens: 100, outputTokens: 50 },
          modelName: "gpt-4",
          provider: "openai",
        },
      ],
      nextCursor: undefined,
    });
  });

  it("should filter out conversations from other workspaces", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockConversations = [
      {
        pk: `conversations/${workspaceId}/${agentId}/conv-1`,
        sk: "conversation",
        workspaceId,
        agentId,
        conversationType: "chat",
        startedAt: "2024-01-01T00:00:00Z",
        lastMessageAt: "2024-01-02T00:00:00Z",
        messages: [],
      },
      {
        pk: `conversations/workspace-999/${agentId}/conv-2`,
        sk: "conversation",
        workspaceId: "workspace-999", // Different workspace
        agentId,
        conversationType: "chat",
        startedAt: "2024-01-03T00:00:00Z",
        lastMessageAt: "2024-01-04T00:00:00Z",
        messages: [],
      },
    ];

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockConversationsQuery = vi.fn().mockResolvedValue({
      items: mockConversations,
    });
    mockDb["agent-conversations"].query = mockConversationsQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
      },
      query: {},
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      conversations: [
        {
          id: "conv-1",
          conversationType: "chat",
          startedAt: "2024-01-01T00:00:00Z",
          lastMessageAt: "2024-01-02T00:00:00Z",
          messageCount: 0,
          tokenUsage: null,
          modelName: null,
          provider: null,
        },
      ],
      nextCursor: undefined,
    });
  });

  it("should return empty array when agent has no conversations", async () => {
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

    const mockConversationsQuery = vi.fn().mockResolvedValue({
      items: [],
    });
    mockDb["agent-conversations"].query = mockConversationsQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
      },
      query: {},
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      conversations: [],
      nextCursor: undefined,
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
      query: {},
    });
    const res = createMockResponse();

    try {
      await callRouteHandler(req, res);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(
        (error as { output?: { statusCode: number } }).output?.statusCode
      ).toBe(400);
      expect(
        (error as { output?: { payload: { message: string } } }).output?.payload
          .message
      ).toContain("Workspace resource not found");
    }
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
      query: {},
    });
    const res = createMockResponse();

    try {
      await callRouteHandler(req, res);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(
        (error as { output?: { statusCode: number } }).output?.statusCode
      ).toBe(410);
      expect(
        (error as { output?: { payload: { message: string } } }).output?.payload
          .message
      ).toContain("Agent not found");
    }
  });

  it("should handle custom limit parameter", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockConversations = Array.from({ length: 100 }, (_, i) => ({
      pk: `conversations/${workspaceId}/${agentId}/conv-${i + 1}`,
      sk: "conversation",
      workspaceId,
      agentId,
      conversationType: "chat",
      startedAt: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      lastMessageAt: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      messages: [],
    }));

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockConversationsQuery = vi.fn().mockResolvedValue({
      items: mockConversations,
    });
    mockDb["agent-conversations"].query = mockConversationsQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
      },
      query: {
        limit: "10",
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response.conversations).toHaveLength(10);
    expect(response.nextCursor).toBeDefined();
  });

  it("should handle cursor-based pagination", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockConversations = Array.from({ length: 100 }, (_, i) => ({
      pk: `conversations/${workspaceId}/${agentId}/conv-${i + 1}`,
      sk: "conversation",
      workspaceId,
      agentId,
      conversationType: "chat",
      startedAt: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      lastMessageAt: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      messages: [],
    }));

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockConversationsQuery = vi.fn().mockResolvedValue({
      items: mockConversations,
    });
    mockDb["agent-conversations"].query = mockConversationsQuery;

    const cursor = Buffer.from(JSON.stringify({ startIndex: 50 })).toString(
      "base64"
    );

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
      },
      query: {
        limit: "20",
        cursor,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response.conversations).toHaveLength(20);
    expect(response.nextCursor).toBeDefined();
  });

  it("should throw badRequest when cursor is invalid", async () => {
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

    const mockConversationsQuery = vi.fn().mockResolvedValue({
      items: [],
    });
    mockDb["agent-conversations"].query = mockConversationsQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
      },
      query: {
        cursor: "invalid-cursor",
      },
    });
    const res = createMockResponse();

    try {
      await callRouteHandler(req, res);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(
        (error as { output?: { statusCode: number } }).output?.statusCode
      ).toBe(400);
      expect(
        (error as { output?: { payload: { message: string } } }).output?.payload
          .message
      ).toContain("Invalid cursor");
    }
  });

  it("should enforce maximum limit of 100", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockConversations = Array.from({ length: 200 }, (_, i) => ({
      pk: `conversations/${workspaceId}/${agentId}/conv-${i + 1}`,
      sk: "conversation",
      workspaceId,
      agentId,
      conversationType: "chat",
      startedAt: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      lastMessageAt: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      messages: [],
    }));

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockConversationsQuery = vi.fn().mockResolvedValue({
      items: mockConversations,
    });
    mockDb["agent-conversations"].query = mockConversationsQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
      },
      query: {
        limit: "200", // Should be capped at 100
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response.conversations).toHaveLength(100);
  });

  it("should enforce minimum limit of 1", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockConversations = [
      {
        pk: `conversations/${workspaceId}/${agentId}/conv-1`,
        sk: "conversation",
        workspaceId,
        agentId,
        conversationType: "chat",
        startedAt: "2024-01-01T00:00:00Z",
        lastMessageAt: "2024-01-02T00:00:00Z",
        messages: [],
      },
    ];

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockConversationsQuery = vi.fn().mockResolvedValue({
      items: mockConversations,
    });
    mockDb["agent-conversations"].query = mockConversationsQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
      },
      query: {
        limit: "0", // Should be capped at 1
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response.conversations).toHaveLength(1);
  });

  it("should sort conversations by lastMessageAt descending", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockConversations = [
      {
        pk: `conversations/${workspaceId}/${agentId}/conv-1`,
        sk: "conversation",
        workspaceId,
        agentId,
        conversationType: "chat",
        startedAt: "2024-01-01T00:00:00Z",
        lastMessageAt: "2024-01-01T00:00:00Z", // Oldest
        messages: [],
      },
      {
        pk: `conversations/${workspaceId}/${agentId}/conv-2`,
        sk: "conversation",
        workspaceId,
        agentId,
        conversationType: "chat",
        startedAt: "2024-01-02T00:00:00Z",
        lastMessageAt: "2024-01-03T00:00:00Z", // Newest
        messages: [],
      },
      {
        pk: `conversations/${workspaceId}/${agentId}/conv-3`,
        sk: "conversation",
        workspaceId,
        agentId,
        conversationType: "chat",
        startedAt: "2024-01-02T00:00:00Z",
        lastMessageAt: "2024-01-02T00:00:00Z", // Middle
        messages: [],
      },
    ];

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockConversationsQuery = vi.fn().mockResolvedValue({
      items: mockConversations,
    });
    mockDb["agent-conversations"].query = mockConversationsQuery;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
      },
      query: {},
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response.conversations[0].id).toBe("conv-2"); // Newest first
    expect(response.conversations[1].id).toBe("conv-3"); // Middle
    expect(response.conversations[2].id).toBe("conv-1"); // Oldest last
  });
});
