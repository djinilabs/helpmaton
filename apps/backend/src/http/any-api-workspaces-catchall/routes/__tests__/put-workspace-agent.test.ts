import { badRequest } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

 
import { isValidAvatar } from "../../../../utils/avatarUtils";
import * as summarizeMemory from "../../../../utils/memory/summarizeMemory";
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";
import {
  buildAgentResponse,
  buildAgentUpdateParams,
  cleanEnabledMcpServerIds,
  getAgentOrThrow,
  resolveFetchWebProvider,
  resolveSearchWebProvider,
  validateClientTools,
  validateDelegatableAgentIds,
  validateKnowledgeConfig,
  validateModelName,
  validateModelTuning,
  validateNotificationChannelId,
  validateSpendingLimits,
  validateAvatar,
} from "../agentUpdate";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockGetModelPricing } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockGetModelPricing: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/pricing", () => ({
  getModelPricing: mockGetModelPricing,
}));

describe("PUT /api/workspaces/:workspaceId/agents/:agentId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    // Extract the handler logic directly - simplified version focusing on key validations
    const handler = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        const body = req.body;
        const db = await mockDatabase();
        const workspaceResource = (req as { workspaceResource?: string })
          .workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = (req.params as { workspaceId?: string })
          .workspaceId;
        const agentId = (req.params as { agentId?: string }).agentId;
        if (!workspaceId || !agentId) {
          throw badRequest("workspaceId and agentId are required");
        }
        const agentPk = `agents/${workspaceId}/${agentId}`;

        const agent = await getAgentOrThrow({
          db,
          workspaceId,
          agentId,
        });

        await validateNotificationChannelId({
          db,
          workspaceId,
          notificationChannelId: body.notificationChannelId,
        });
        validateSpendingLimits(body.spendingLimits);
        await validateDelegatableAgentIds({
          db,
          workspaceId,
          agentId,
          delegatableAgentIds: body.delegatableAgentIds,
        });
        const cleanedEnabledMcpServerIds = await cleanEnabledMcpServerIds({
          db,
          workspaceId,
          enabledMcpServerIds: body.enabledMcpServerIds,
          existingEnabledMcpServerIds: agent.enabledMcpServerIds,
        });
        validateClientTools(body.clientTools);
        validateKnowledgeConfig({
          knowledgeInjectionMinSimilarity: body.knowledgeInjectionMinSimilarity,
        });
        validateModelTuning({
          temperature: body.temperature,
          topP: body.topP,
          topK: body.topK,
          maxOutputTokens: body.maxOutputTokens,
          stopSequences: body.stopSequences,
          maxToolRoundtrips: body.maxToolRoundtrips,
        });
        const resolvedModelName = await validateModelName({
          modelName: body.modelName,
          getModelPricing: mockGetModelPricing,
        });
        validateAvatar({ avatar: body.avatar, isValidAvatar });

        const resolvedSearchWebProvider = resolveSearchWebProvider({
          searchWebProvider: body.searchWebProvider,
          enableTavilySearch: body.enableTavilySearch,
          currentProvider: agent.searchWebProvider,
        });
        const resolvedFetchWebProvider = resolveFetchWebProvider({
          fetchWebProvider: body.fetchWebProvider,
          enableTavilyFetch: body.enableTavilyFetch,
          currentProvider: agent.fetchWebProvider,
        });

        const normalizedSummarizationPrompts =
          summarizeMemory.normalizeSummarizationPrompts(body.summarizationPrompts);

        const updated = await db.agent.update({
          ...buildAgentUpdateParams({
            body,
            agent,
            agentPk,
            workspaceId,
            normalizedSummarizationPrompts,
            cleanedEnabledMcpServerIds,
            resolvedSearchWebProvider,
            resolvedFetchWebProvider,
            resolvedModelName,
            updatedBy: (req as { userRef?: string }).userRef || "",
          }),
        });

        const response = buildAgentResponse({ agentId, updated });
        res.json(response);
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should update agent name and systemPrompt successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Old Name",
      systemPrompt: "Old Prompt",
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockUpdatedAgent = {
      ...mockAgent,
      name: "New Name",
      systemPrompt: "New Prompt",
      updatedBy: "users/user-123",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockAgentUpdate = vi.fn().mockResolvedValue(mockUpdatedAgent);
    mockDb.agent.update = mockAgentUpdate;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: {
        name: "New Name",
        systemPrompt: "New Prompt",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockAgentGet).toHaveBeenCalledWith(
      "agents/workspace-123/agent-456",
      "agent"
    );
    expect(mockAgentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "New Name",
        systemPrompt: "New Prompt",
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "agent-456",
        name: "New Name",
        systemPrompt: "New Prompt",
      })
    );
  });

  it("should normalize summarization prompts on update", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Old Name",
      systemPrompt: "Old Prompt",
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockUpdatedAgent = {
      ...mockAgent,
      summarizationPrompts: { daily: "Custom daily prompt" },
      updatedBy: "users/user-123",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    const mockAgentUpdate = vi.fn().mockResolvedValue(mockUpdatedAgent);
    mockDb.agent.update = mockAgentUpdate;

    const normalizeSpy = vi.spyOn(
      summarizeMemory,
      "normalizeSummarizationPrompts"
    );

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: {
        summarizationPrompts: {
          daily: "  Custom daily prompt  ",
          weekly: "",
          monthly: null,
        },
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(normalizeSpy).toHaveBeenCalledWith({
      daily: "  Custom daily prompt  ",
      weekly: "",
      monthly: null,
    });
    const updateArgs = mockAgentUpdate.mock.calls[0][0];
    expect(updateArgs.summarizationPrompts).toEqual({
      daily: "Custom daily prompt",
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        summarizationPrompts: { daily: "Custom daily prompt" },
      })
    );
  });

  it("should keep existing summarization prompts when omitted", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Old Name",
      systemPrompt: "Old Prompt",
      summarizationPrompts: { weekly: "Existing weekly prompt" },
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockUpdatedAgent = {
      ...mockAgent,
      updatedBy: "users/user-123",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    const mockAgentUpdate = vi.fn().mockResolvedValue(mockUpdatedAgent);
    mockDb.agent.update = mockAgentUpdate;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: {
        name: "New Name",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    const updateArgs = mockAgentUpdate.mock.calls[0][0];
    expect(updateArgs.summarizationPrompts).toEqual({
      weekly: "Existing weekly prompt",
    });
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: undefined,
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: {
        name: "New Name",
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

    const mockAgentGet = vi.fn().mockResolvedValue(null);
    mockDb.agent.get = mockAgentGet;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: {
        name: "New Name",
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

  it("should validate and update notificationChannelId", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "Test Prompt",
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockChannel = {
      pk: "output-channels/workspace-123/channel-789",
      sk: "channel",
      workspaceId: "workspace-123",
    };

    const mockUpdatedAgent = {
      ...mockAgent,
      notificationChannelId: "channel-789",
      updatedBy: "users/user-123",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockChannelGet = vi.fn().mockResolvedValue(mockChannel);
    mockDb["output_channel"].get = mockChannelGet;

    const mockAgentUpdate = vi.fn().mockResolvedValue(mockUpdatedAgent);
    mockDb.agent.update = mockAgentUpdate;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: {
        notificationChannelId: "channel-789",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockChannelGet).toHaveBeenCalledWith(
      "output-channels/workspace-123/channel-789",
      "channel"
    );
    expect(mockAgentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationChannelId: "channel-789",
      })
    );
  });

  it("should throw resourceGone when notification channel does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "Test Prompt",
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockChannelGet = vi.fn().mockResolvedValue(null);
    mockDb["output_channel"].get = mockChannelGet;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: {
        notificationChannelId: "channel-789",
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
    ).toContain("Notification channel not found");
  });

  it("should throw forbidden when notification channel belongs to different workspace", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "Test Prompt",
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockChannel = {
      pk: "output-channels/workspace-123/channel-789",
      sk: "channel",
      workspaceId: "workspace-other",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockChannelGet = vi.fn().mockResolvedValue(mockChannel);
    mockDb["output_channel"].get = mockChannelGet;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: {
        notificationChannelId: "channel-789",
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
    ).toContain("Notification channel does not belong to this workspace");
  });

  it("should validate spendingLimits format", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "Test Prompt",
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: {
        spendingLimits: [
          {
            timeFrame: "daily",
            amount: 100,
          },
        ],
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    const mockUpdatedAgent = {
      ...mockAgent,
      spendingLimits: [{ timeFrame: "daily", amount: 100 }],
      updatedBy: "users/user-123",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockAgentUpdate = vi.fn().mockResolvedValue(mockUpdatedAgent);
    mockDb.agent.update = mockAgentUpdate;

    await callRouteHandler(req, res, next);

    expect(mockAgentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        spendingLimits: [{ timeFrame: "daily", amount: 100 }],
      })
    );
  });

  it("should throw badRequest when spendingLimits has invalid timeFrame", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "Test Prompt",
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: {
        spendingLimits: [
          {
            timeFrame: "invalid",
            amount: 100,
          },
        ],
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(
      (error as { output?: { payload: { message: string } } }).output?.payload
        .message
    ).toContain("valid timeFrame");
  });

  it("should throw resourceGone when enabledMcpServerIds contains missing server", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "Test Prompt",
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockMcpServerGet = vi.fn().mockResolvedValue(null);
    mockDb["mcp-server"].get = mockMcpServerGet;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: {
        enabledMcpServerIds: ["missing-server"],
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(
      (error as { output?: { payload: { message: string } } }).output?.payload
        .message
    ).toContain("MCP server missing-server not found");
  });

  it("should throw badRequest when delegatableAgentIds includes self", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "Test Prompt",
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: {
        delegatableAgentIds: ["agent-456"],
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(
      (error as { output?: { payload: { message: string } } }).output?.payload
        .message
    ).toContain("cannot delegate to itself");
  });

  it("should validate and update delegatableAgentIds", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "Test Prompt",
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockTargetAgent = {
      pk: "agents/workspace-123/agent-789",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Target Agent",
    };

    const mockUpdatedAgent = {
      ...mockAgent,
      delegatableAgentIds: ["agent-789"],
      updatedBy: "users/user-123",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockAgentGet = vi
      .fn()
      .mockResolvedValueOnce(mockAgent)
      .mockResolvedValueOnce(mockTargetAgent);
    mockDb.agent.get = mockAgentGet;
    mockDb.agent.query = vi.fn().mockResolvedValue({
      items: [
        {
          pk: "agents/workspace-123/agent-456",
          delegatableAgentIds: [],
        },
        {
          pk: "agents/workspace-123/agent-789",
          delegatableAgentIds: [],
        },
      ],
    });

    const mockAgentUpdate = vi.fn().mockResolvedValue(mockUpdatedAgent);
    mockDb.agent.update = mockAgentUpdate;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: {
        delegatableAgentIds: ["agent-789"],
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockAgentGet).toHaveBeenCalledTimes(2);
    expect(mockAgentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        delegatableAgentIds: ["agent-789"],
      })
    );
  });

  it("should validate temperature range", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "Test Prompt",
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: {
        temperature: 2.5,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(
      (error as { output?: { payload: { message: string } } }).output?.payload
        .message
    ).toContain("temperature must be a number between 0 and 2");
  });

  it("should validate modelName against pricing config", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "Test Prompt",
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    mockGetModelPricing.mockReturnValue({
      inputPrice: 0.001,
      outputPrice: 0.002,
    });

    const mockUpdatedAgent = {
      ...mockAgent,
      modelName: "gemini-2.5-flash",
      updatedBy: "users/user-123",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockAgentUpdate = vi.fn().mockResolvedValue(mockUpdatedAgent);
    mockDb.agent.update = mockAgentUpdate;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: {
        modelName: "gemini-2.5-flash",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockGetModelPricing).toHaveBeenCalledWith(
      "openrouter",
      "gemini-2.5-flash"
    );
    expect(mockAgentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: "gemini-2.5-flash",
      })
    );
  });

  it("should throw badRequest when modelName is invalid", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "Test Prompt",
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    mockGetModelPricing.mockReturnValue(null);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: {
        modelName: "invalid-model",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(
      (error as { output?: { payload: { message: string } } }).output?.payload
        .message
    ).toContain("is not available");
  });

  it("should allow clearing notificationChannelId by setting to null", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "Test Prompt",
      notificationChannelId: "channel-789",
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockUpdatedAgent = {
      ...mockAgent,
      notificationChannelId: undefined,
      updatedBy: "users/user-123",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockAgentUpdate = vi.fn().mockResolvedValue(mockUpdatedAgent);
    mockDb.agent.update = mockAgentUpdate;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: {
        notificationChannelId: null,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockAgentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationChannelId: undefined,
      })
    );
  });
});
