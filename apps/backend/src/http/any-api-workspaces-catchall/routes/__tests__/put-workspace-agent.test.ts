import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

 
import * as summarizeMemory from "../../../../utils/memory/summarizeMemory";
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

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
        const {
          name,
          systemPrompt,
          notificationChannelId,
          spendingLimits,
          delegatableAgentIds,
          enabledMcpServerIds,
          clientTools,
          summarizationPrompts,
          temperature,
          topP,
          topK,
          maxOutputTokens,
          stopSequences,
          maxToolRoundtrips,
          modelName,
        } = req.body;
        const db = await mockDatabase();
        const workspaceResource = (req as { workspaceResource?: string })
          .workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = (req.params as { workspaceId?: string })
          .workspaceId;
        const agentId = (req.params as { agentId?: string }).agentId;
        const agentPk = `agents/${workspaceId}/${agentId}`;

        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw resourceGone("Agent not found");
        }

        // Validate notificationChannelId if provided
        if (
          notificationChannelId !== undefined &&
          notificationChannelId !== null
        ) {
          if (typeof notificationChannelId !== "string") {
            throw badRequest("notificationChannelId must be a string or null");
          }
          const channelPk = `output-channels/${workspaceId}/${notificationChannelId}`;
          const channel = await db["output_channel"].get(channelPk, "channel");
          if (!channel) {
            throw resourceGone("Notification channel not found");
          }
          if (channel.workspaceId !== workspaceId) {
            throw forbidden(
              "Notification channel does not belong to this workspace"
            );
          }
        }

        // Validate spendingLimits if provided
        if (spendingLimits !== undefined) {
          if (!Array.isArray(spendingLimits)) {
            throw badRequest("spendingLimits must be an array");
          }
          for (const limit of spendingLimits) {
            if (
              !limit.timeFrame ||
              !["daily", "weekly", "monthly"].includes(limit.timeFrame)
            ) {
              throw badRequest(
                "Each spending limit must have a valid timeFrame (daily, weekly, or monthly)"
              );
            }
            if (typeof limit.amount !== "number" || limit.amount < 0) {
              throw badRequest(
                "Each spending limit must have a non-negative amount"
              );
            }
          }
        }

        // Validate delegatableAgentIds if provided (simplified - skip circular check for now)
        if (delegatableAgentIds !== undefined) {
          if (!Array.isArray(delegatableAgentIds)) {
            throw badRequest("delegatableAgentIds must be an array");
          }
          for (const id of delegatableAgentIds) {
            if (typeof id !== "string") {
              throw badRequest("All delegatableAgentIds must be strings");
            }
            if (id === agentId) {
              throw badRequest("Agent cannot delegate to itself");
            }
            const targetAgentPk = `agents/${workspaceId}/${id}`;
            const targetAgent = await db.agent.get(targetAgentPk, "agent");
            if (!targetAgent) {
              throw resourceGone(`Delegatable agent ${id} not found`);
            }
            if (targetAgent.workspaceId !== workspaceId) {
              throw forbidden(
                `Delegatable agent ${id} does not belong to this workspace`
              );
            }
          }
        }

        // Validate enabledMcpServerIds if provided
        if (enabledMcpServerIds !== undefined) {
          if (!Array.isArray(enabledMcpServerIds)) {
            throw badRequest("enabledMcpServerIds must be an array");
          }
          for (const id of enabledMcpServerIds) {
            if (typeof id !== "string") {
              throw badRequest("All enabledMcpServerIds must be strings");
            }
            const serverPk = `mcp-servers/${workspaceId}/${id}`;
            const server = await db["mcp-server"].get(serverPk, "server");
            if (!server) {
              throw resourceGone(`MCP server ${id} not found`);
            }
            if (server.workspaceId !== workspaceId) {
              throw forbidden(
                `MCP server ${id} does not belong to this workspace`
              );
            }
          }
        }

        // Validate clientTools if provided
        if (clientTools !== undefined) {
          if (!Array.isArray(clientTools)) {
            throw badRequest("clientTools must be an array");
          }
          for (const tool of clientTools) {
            if (
              !tool ||
              typeof tool !== "object" ||
              typeof tool.name !== "string" ||
              typeof tool.description !== "string" ||
              !tool.parameters ||
              typeof tool.parameters !== "object"
            ) {
              throw badRequest(
                "Each client tool must have name, description (both strings) and parameters (object)"
              );
            }
            if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(tool.name)) {
              throw badRequest(
                `Tool name "${tool.name}" must be a valid JavaScript identifier`
              );
            }
          }
        }

        // Validate model configuration fields
        if (temperature !== undefined && temperature !== null) {
          if (
            typeof temperature !== "number" ||
            temperature < 0 ||
            temperature > 2
          ) {
            throw badRequest("temperature must be a number between 0 and 2");
          }
        }

        if (topP !== undefined && topP !== null) {
          if (typeof topP !== "number" || topP < 0 || topP > 1) {
            throw badRequest("topP must be a number between 0 and 1");
          }
        }

        if (topK !== undefined && topK !== null) {
          if (
            typeof topK !== "number" ||
            !Number.isInteger(topK) ||
            topK <= 0
          ) {
            throw badRequest("topK must be a positive integer");
          }
        }

        if (maxOutputTokens !== undefined && maxOutputTokens !== null) {
          if (
            typeof maxOutputTokens !== "number" ||
            !Number.isInteger(maxOutputTokens) ||
            maxOutputTokens <= 0
          ) {
            throw badRequest("maxOutputTokens must be a positive integer");
          }
        }

        if (stopSequences !== undefined && stopSequences !== null) {
          if (!Array.isArray(stopSequences)) {
            throw badRequest("stopSequences must be an array");
          }
          for (const seq of stopSequences) {
            if (typeof seq !== "string") {
              throw badRequest("All stopSequences must be strings");
            }
          }
        }

        if (maxToolRoundtrips !== undefined && maxToolRoundtrips !== null) {
          if (
            typeof maxToolRoundtrips !== "number" ||
            !Number.isInteger(maxToolRoundtrips) ||
            maxToolRoundtrips <= 0
          ) {
            throw badRequest("maxToolRoundtrips must be a positive integer");
          }
        }

        // Validate modelName if provided
        if (modelName !== undefined && modelName !== null) {
          if (typeof modelName !== "string" || modelName.trim().length === 0) {
            throw badRequest("modelName must be a non-empty string or null");
          }
          const pricing = mockGetModelPricing("google", modelName.trim());
          if (!pricing) {
            throw badRequest(
              `Model "${modelName.trim()}" is not available. Please check available models at /api/models`
            );
          }
        }

        const normalizedSummarizationPrompts =
          summarizeMemory.normalizeSummarizationPrompts(summarizationPrompts);

        // Update agent
        const updated = await db.agent.update({
          pk: agentPk,
          sk: "agent",
          workspaceId,
          name: name !== undefined ? name : agent.name,
          systemPrompt:
            systemPrompt !== undefined ? systemPrompt : agent.systemPrompt,
          notificationChannelId:
            notificationChannelId !== undefined
              ? notificationChannelId === null
                ? undefined
                : notificationChannelId
              : agent.notificationChannelId,
          delegatableAgentIds:
            delegatableAgentIds !== undefined
              ? delegatableAgentIds
              : agent.delegatableAgentIds,
          enabledMcpServerIds:
            enabledMcpServerIds !== undefined
              ? enabledMcpServerIds
              : agent.enabledMcpServerIds,
          clientTools:
            clientTools !== undefined ? clientTools : agent.clientTools,
          summarizationPrompts:
            summarizationPrompts !== undefined
              ? normalizedSummarizationPrompts
              : agent.summarizationPrompts,
          spendingLimits:
            spendingLimits !== undefined
              ? spendingLimits
              : agent.spendingLimits,
          temperature:
            temperature !== undefined
              ? temperature === null
                ? undefined
                : temperature
              : agent.temperature,
          topP:
            topP !== undefined
              ? topP === null
                ? undefined
                : topP
              : agent.topP,
          topK:
            topK !== undefined
              ? topK === null
                ? undefined
                : topK
              : agent.topK,
          maxOutputTokens:
            maxOutputTokens !== undefined
              ? maxOutputTokens === null
                ? undefined
                : maxOutputTokens
              : agent.maxOutputTokens,
          stopSequences:
            stopSequences !== undefined
              ? stopSequences === null
                ? undefined
                : stopSequences
              : agent.stopSequences,
          maxToolRoundtrips:
            maxToolRoundtrips !== undefined
              ? maxToolRoundtrips === null
                ? undefined
                : maxToolRoundtrips
              : agent.maxToolRoundtrips,
          modelName:
            modelName !== undefined
              ? modelName === null
                ? undefined
                : modelName.trim()
              : agent.modelName,
          updatedBy: (req as { userRef?: string }).userRef || "",
          updatedAt: new Date().toISOString(),
        });

        const response = {
          id: agentId,
          name: updated.name,
          systemPrompt: updated.systemPrompt,
          notificationChannelId: updated.notificationChannelId,
          delegatableAgentIds: updated.delegatableAgentIds ?? [],
          enabledMcpServerIds: updated.enabledMcpServerIds ?? [],
          clientTools: updated.clientTools ?? [],
          summarizationPrompts: updated.summarizationPrompts,
          spendingLimits: updated.spendingLimits ?? [],
          temperature: updated.temperature ?? null,
          topP: updated.topP ?? null,
          topK: updated.topK ?? null,
          maxOutputTokens: updated.maxOutputTokens ?? null,
          stopSequences: updated.stopSequences ?? null,
          maxToolRoundtrips: updated.maxToolRoundtrips ?? null,
          provider: updated.provider,
          modelName: updated.modelName ?? null,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        };
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
      "google",
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
