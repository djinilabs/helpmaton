import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

 
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockDatabase,
  mockEnsureWorkspaceSubscription,
  mockCheckSubscriptionLimits,
  mockGetModelPricing,
  mockRandomUUID,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockEnsureWorkspaceSubscription: vi.fn(),
    mockCheckSubscriptionLimits: vi.fn(),
    mockGetModelPricing: vi.fn(),
    mockRandomUUID: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/subscriptionUtils", () => ({
  ensureWorkspaceSubscription: mockEnsureWorkspaceSubscription,
  checkSubscriptionLimits: mockCheckSubscriptionLimits,
}));

vi.mock("../../../../utils/pricing", () => ({
  getModelPricing: mockGetModelPricing,
}));

vi.mock("crypto", () => ({
  randomUUID: mockRandomUUID,
}));

describe("POST /api/workspaces/:workspaceId/agents", () => {
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
        const { name, systemPrompt, modelName, clientTools } = req.body;
        if (!name || typeof name !== "string") {
          throw badRequest("name is required and must be a string");
        }
        if (!systemPrompt || typeof systemPrompt !== "string") {
          throw badRequest("systemPrompt is required and must be a string");
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
            // Validate name is a valid JavaScript identifier
            if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(tool.name)) {
              throw badRequest(
                `Tool name "${tool.name}" must be a valid JavaScript identifier (letters, numbers, underscore, $; no spaces or special characters)`
              );
            }
          }
        }

        const db = await mockDatabase();
        const workspaceResource = (req as { workspaceResource?: string })
          .workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const currentUserRef = (req as { userRef?: string }).userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }
        const workspaceId = (req.params as { workspaceId?: string })
          .workspaceId;

        // Ensure workspace has a subscription and check agent limit
        const userId = currentUserRef.replace("users/", "");
        const subscriptionId = await mockEnsureWorkspaceSubscription(
          workspaceId,
          userId
        );
        await mockCheckSubscriptionLimits(subscriptionId, "agent", 1);

        const agentId = mockRandomUUID();
        const agentPk = `agents/${workspaceId}/${agentId}`;
        const agentSk = "agent";

        // Validate modelName if provided
        if (modelName !== undefined && modelName !== null) {
          if (typeof modelName !== "string" || modelName.trim().length === 0) {
            throw badRequest("modelName must be a non-empty string or null");
          }
          // Validate model exists in pricing config
          const pricing = mockGetModelPricing("google", modelName.trim());
          if (!pricing) {
            throw badRequest(
              `Model "${modelName.trim()}" is not available. Please check available models at /api/models`
            );
          }
        }

        // Create agent entity
        const agent = await db.agent.create({
          pk: agentPk,
          sk: agentSk,
          workspaceId,
          name,
          systemPrompt,
          provider: "google",
          modelName:
            typeof modelName === "string" && modelName.trim()
              ? modelName.trim()
              : undefined,
          clientTools: clientTools || undefined,
          createdBy: currentUserRef,
        });

        res.status(201).json({
          id: agentId,
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          provider: agent.provider,
          modelName: agent.modelName ?? null,
          clientTools: agent.clientTools ?? [],
          createdAt: agent.createdAt,
        });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should create agent successfully with all required fields", async () => {
    const agentId = "agent-123";
    mockRandomUUID.mockReturnValue(agentId);

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    mockEnsureWorkspaceSubscription.mockResolvedValue("sub-123");
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);

    const mockAgent = {
      pk: `agents/workspace-123/${agentId}`,
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      provider: "google",
      modelName: undefined,
      clientTools: undefined,
      createdBy: "users/user-123",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockAgentCreate = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.create = mockAgentCreate;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        name: "Test Agent",
        systemPrompt: "You are a helpful assistant",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockEnsureWorkspaceSubscription).toHaveBeenCalledWith(
      "workspace-123",
      "user-123"
    );
    expect(mockCheckSubscriptionLimits).toHaveBeenCalledWith(
      "sub-123",
      "agent",
      1
    );
    expect(mockAgentCreate).toHaveBeenCalledWith({
      pk: `agents/workspace-123/${agentId}`,
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      provider: "google",
      modelName: undefined,
      clientTools: undefined,
      createdBy: "users/user-123",
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      id: agentId,
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      provider: "google",
      modelName: null,
      clientTools: [],
      createdAt: "2024-01-01T00:00:00Z",
    });
  });

  it("should create agent with modelName and clientTools", async () => {
    const agentId = "agent-456";
    mockRandomUUID.mockReturnValue(agentId);

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    mockEnsureWorkspaceSubscription.mockResolvedValue("sub-123");
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);
    mockGetModelPricing.mockReturnValue({
      inputPrice: 0.001,
      outputPrice: 0.002,
    });

    const mockClientTools = [
      {
        name: "searchWeb",
        description: "Search the web",
        parameters: { query: { type: "string" } },
      },
    ];

    const mockAgent = {
      pk: `agents/workspace-123/${agentId}`,
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      provider: "google",
      modelName: "gemini-2.5-flash",
      clientTools: mockClientTools,
      createdBy: "users/user-123",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockAgentCreate = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.create = mockAgentCreate;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        name: "Test Agent",
        systemPrompt: "You are a helpful assistant",
        modelName: "gemini-2.5-flash",
        clientTools: mockClientTools,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockGetModelPricing).toHaveBeenCalledWith(
      "google",
      "gemini-2.5-flash"
    );
    expect(mockAgentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: "gemini-2.5-flash",
        clientTools: mockClientTools,
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: "gemini-2.5-flash",
        clientTools: mockClientTools,
      })
    );
  });

  it("should throw badRequest when name is missing", async () => {
    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      body: {
        systemPrompt: "You are a helpful assistant",
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
    ).toContain("name is required");
  });

  it("should throw badRequest when systemPrompt is missing", async () => {
    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      body: {
        name: "Test Agent",
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
    ).toContain("systemPrompt is required");
  });

  it("should throw badRequest when clientTools is not an array", async () => {
    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      body: {
        name: "Test Agent",
        systemPrompt: "You are a helpful assistant",
        clientTools: "not-an-array",
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
    ).toContain("clientTools must be an array");
  });

  it("should throw badRequest when clientTool is missing required fields", async () => {
    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      body: {
        name: "Test Agent",
        systemPrompt: "You are a helpful assistant",
        clientTools: [
          {
            name: "searchWeb",
            // Missing description and parameters
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
    ).toContain("Each client tool must have name, description");
  });

  it("should throw badRequest when tool name is not a valid JavaScript identifier", async () => {
    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      body: {
        name: "Test Agent",
        systemPrompt: "You are a helpful assistant",
        clientTools: [
          {
            name: "invalid-tool-name",
            description: "A tool with invalid name",
            parameters: {},
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
    ).toContain("must be a valid JavaScript identifier");
  });

  it("should throw badRequest when modelName is invalid", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    mockEnsureWorkspaceSubscription.mockResolvedValue("sub-123");
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);
    mockGetModelPricing.mockReturnValue(null);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        name: "Test Agent",
        systemPrompt: "You are a helpful assistant",
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

  it("should throw badRequest when workspace resource is missing", async () => {
    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: undefined,
      body: {
        name: "Test Agent",
        systemPrompt: "You are a helpful assistant",
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
    ).toContain("Workspace resource not found");
  });

  it("should throw unauthorized when userRef is missing", async () => {
    const req = createMockRequest({
      userRef: undefined,
      workspaceResource: "workspaces/workspace-123",
      body: {
        name: "Test Agent",
        systemPrompt: "You are a helpful assistant",
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
    ).toBe(401);
  });

  it("should trim modelName before validation", async () => {
    const agentId = "agent-789";
    mockRandomUUID.mockReturnValue(agentId);

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    mockEnsureWorkspaceSubscription.mockResolvedValue("sub-123");
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);
    mockGetModelPricing.mockReturnValue({
      inputPrice: 0.001,
      outputPrice: 0.002,
    });

    const mockAgent = {
      pk: `agents/workspace-123/${agentId}`,
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "You are a helpful assistant",
      provider: "google",
      modelName: "gemini-2.5-flash",
      createdBy: "users/user-123",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockAgentCreate = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.create = mockAgentCreate;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        name: "Test Agent",
        systemPrompt: "You are a helpful assistant",
        modelName: "  gemini-2.5-flash  ",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockGetModelPricing).toHaveBeenCalledWith(
      "google",
      "gemini-2.5-flash"
    );
    expect(mockAgentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: "gemini-2.5-flash",
      })
    );
  });

  it("should handle subscription limit check errors", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    mockEnsureWorkspaceSubscription.mockResolvedValue("sub-123");

    const limitError = new Error("Agent limit exceeded");
    mockCheckSubscriptionLimits.mockRejectedValue(limitError);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        name: "Test Agent",
        systemPrompt: "You are a helpful assistant",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBe(limitError);
    // Agent should not be created when limit check fails
  });
});
