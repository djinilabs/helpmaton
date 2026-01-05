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

// Mock the database module
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

describe("GET /api/workspaces/:workspaceId/agents/:agentId/conversations/:conversationId", () => {
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
      const conversationId = req.params.conversationId;
      const agentPk = `agents/${workspaceId}/${agentId}`;

      // Verify agent exists
      const agent = await db.agent.get(agentPk, "agent");
      if (!agent) {
        throw resourceGone("Agent not found");
      }

      const conversationPk = `conversations/${workspaceId}/${agentId}/${conversationId}`;
      const conversation = await db["agent-conversations"].get(conversationPk);

      if (!conversation) {
        throw resourceGone("Conversation not found");
      }

      if (
        conversation.workspaceId !== workspaceId ||
        conversation.agentId !== agentId
      ) {
        throw forbidden("Conversation does not belong to this agent");
      }

      res.json({
        id: conversationId,
        conversationType: conversation.conversationType,
        messages: conversation.messages || [],
        tokenUsage: conversation.tokenUsage || null,
        startedAt: conversation.startedAt,
        lastMessageAt: conversation.lastMessageAt,
        error: conversation.error || null,
        awsRequestIds: conversation.awsRequestIds ?? null,
        totalGenerationTimeMs: conversation.totalGenerationTimeMs ?? null,
        delegations: conversation.delegations || [],
        modelName: conversation.modelName ?? null,
        provider: conversation.provider ?? null,
      });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should return conversation details", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const conversationId = "conv-789";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockConversation = {
      pk: `conversations/${workspaceId}/${agentId}/${conversationId}`,
      sk: "conversation",
      workspaceId,
      agentId,
      conversationType: "chat",
      messages: [
        { id: "msg-1", content: "Hello" },
        { id: "msg-2", content: "World" },
      ],
      tokenUsage: { inputTokens: 100, outputTokens: 50 },
      modelName: "gpt-4",
      provider: "openai",
      startedAt: "2024-01-01T00:00:00Z",
      lastMessageAt: "2024-01-02T00:00:00Z",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockConversationGet = vi.fn().mockResolvedValue(mockConversation);
    mockDb["agent-conversations"].get = mockConversationGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
        conversationId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockAgentGet).toHaveBeenCalledWith(
      `agents/${workspaceId}/${agentId}`,
      "agent"
    );
    expect(mockConversationGet).toHaveBeenCalledWith(
      `conversations/${workspaceId}/${agentId}/${conversationId}`
    );
    expect(res.json).toHaveBeenCalledWith({
      id: conversationId,
      conversationType: "chat",
      messages: [
        { id: "msg-1", content: "Hello" },
        { id: "msg-2", content: "World" },
      ],
      tokenUsage: { inputTokens: 100, outputTokens: 50 },
      startedAt: "2024-01-01T00:00:00Z",
      lastMessageAt: "2024-01-02T00:00:00Z",
      error: null,
      awsRequestIds: null,
      totalGenerationTimeMs: null,
      delegations: [],
      modelName: "gpt-4",
      provider: "openai",
    });
  });

  it("should return conversation with null/empty defaults when fields are missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const conversationId = "conv-789";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockConversation = {
      pk: `conversations/${workspaceId}/${agentId}/${conversationId}`,
      sk: "conversation",
      workspaceId,
      agentId,
      conversationType: "chat",
      startedAt: "2024-01-01T00:00:00Z",
      lastMessageAt: "2024-01-02T00:00:00Z",
      // messages, tokenUsage, modelName, provider are missing
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockConversationGet = vi.fn().mockResolvedValue(mockConversation);
    mockDb["agent-conversations"].get = mockConversationGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
        conversationId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      id: conversationId,
      conversationType: "chat",
      messages: [],
      tokenUsage: null,
      startedAt: "2024-01-01T00:00:00Z",
      lastMessageAt: "2024-01-02T00:00:00Z",
      error: null,
      awsRequestIds: null,
      totalGenerationTimeMs: null,
      delegations: [],
      modelName: null,
      provider: null,
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
        conversationId: "conv-789",
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
      ).toContain("Workspace resource not found");
    }
  });

  it("should throw resourceGone when agent does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const conversationId = "conv-789";

    const mockAgentGet = vi.fn().mockResolvedValue(null);
    mockDb.agent.get = mockAgentGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
        conversationId,
      },
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

  it("should throw resourceGone when conversation does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const conversationId = "conv-789";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockConversationGet = vi.fn().mockResolvedValue(null);
    mockDb["agent-conversations"].get = mockConversationGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
        conversationId,
      },
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
      ).toContain("Conversation not found");
    }
  });

  it("should throw forbidden when conversation belongs to different workspace", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const conversationId = "conv-789";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockConversation = {
      pk: `conversations/${workspaceId}/${agentId}/${conversationId}`,
      sk: "conversation",
      workspaceId: "workspace-999", // Different workspace
      agentId,
      conversationType: "chat",
      startedAt: "2024-01-01T00:00:00Z",
      lastMessageAt: "2024-01-02T00:00:00Z",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockConversationGet = vi.fn().mockResolvedValue(mockConversation);
    mockDb["agent-conversations"].get = mockConversationGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
        conversationId,
      },
    });
    const res = createMockResponse();

    try {
      await callRouteHandler(req, res);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(
        (error as { output?: { statusCode: number } }).output?.statusCode
      ).toBe(403);
      expect(
        (error as { output?: { payload: { message: string } } }).output?.payload
          .message
      ).toContain("Conversation does not belong to this agent");
    }
  });

  it("should throw forbidden when conversation belongs to different agent", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const conversationId = "conv-789";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockConversation = {
      pk: `conversations/${workspaceId}/${agentId}/${conversationId}`,
      sk: "conversation",
      workspaceId,
      agentId: "agent-999", // Different agent
      conversationType: "chat",
      startedAt: "2024-01-01T00:00:00Z",
      lastMessageAt: "2024-01-02T00:00:00Z",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockConversationGet = vi.fn().mockResolvedValue(mockConversation);
    mockDb["agent-conversations"].get = mockConversationGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
        conversationId,
      },
    });
    const res = createMockResponse();

    try {
      await callRouteHandler(req, res);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(
        (error as { output?: { statusCode: number } }).output?.statusCode
      ).toBe(403);
      expect(
        (error as { output?: { payload: { message: string } } }).output?.payload
          .message
      ).toContain("Conversation does not belong to this agent");
    }
  });

  it("should include delegations in response when present", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const conversationId = "conv-789";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Test Agent",
    };

    const mockConversation = {
      pk: `conversations/${workspaceId}/${agentId}/${conversationId}`,
      sk: "conversation",
      workspaceId,
      agentId,
      conversationType: "test",
      messages: [],
      tokenUsage: null,
      startedAt: "2024-01-01T00:00:00Z",
      lastMessageAt: "2024-01-02T00:00:00Z",
      delegations: [
        {
          callingAgentId: "agent-456",
          targetAgentId: "agent-789",
          taskId: "task-123",
          timestamp: "2024-01-01T12:00:00Z",
          status: "completed" as const,
        },
        {
          callingAgentId: "agent-456",
          targetAgentId: "agent-999",
          timestamp: "2024-01-01T13:00:00Z",
          status: "failed" as const,
        },
      ],
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockConversationGet = vi.fn().mockResolvedValue(mockConversation);
    mockDb["agent-conversations"].get = mockConversationGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
        agentId,
        conversationId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      id: conversationId,
      conversationType: "test",
      messages: [],
      tokenUsage: null,
      startedAt: "2024-01-01T00:00:00Z",
      lastMessageAt: "2024-01-02T00:00:00Z",
      error: null,
      awsRequestIds: null,
      totalGenerationTimeMs: null,
      delegations: [
        {
          callingAgentId: "agent-456",
          targetAgentId: "agent-789",
          taskId: "task-123",
          timestamp: "2024-01-01T12:00:00Z",
          status: "completed",
        },
        {
          callingAgentId: "agent-456",
          targetAgentId: "agent-999",
          timestamp: "2024-01-01T13:00:00Z",
          status: "failed",
        },
      ],
      modelName: null,
      provider: null,
    });
  });
});
