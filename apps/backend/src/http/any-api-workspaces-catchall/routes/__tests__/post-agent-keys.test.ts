import { badRequest, resourceGone, unauthorized } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockRandomUUID,
  mockDatabase,
  mockEnsureWorkspaceSubscription,
  mockCheckSubscriptionLimits,
} = vi.hoisted(() => {
  return {
    mockRandomUUID: vi.fn(),
    mockDatabase: vi.fn(),
    mockEnsureWorkspaceSubscription: vi.fn(),
    mockCheckSubscriptionLimits: vi.fn(),
  };
});

// Mock the modules
vi.mock("crypto", () => ({
  randomUUID: mockRandomUUID,
}));

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/subscriptionUtils", () => ({
  ensureWorkspaceSubscription: mockEnsureWorkspaceSubscription,
  checkSubscriptionLimits: mockCheckSubscriptionLimits,
}));

describe("POST /api/workspaces/:workspaceId/agents/:agentId/keys", () => {
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

        const { name, provider } = req.body;
        const currentUserRef = (req as { userRef?: string }).userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }

        // Ensure workspace has a subscription and check agent key limit
        const userId = currentUserRef.replace("users/", "");
        const subscriptionId = await mockEnsureWorkspaceSubscription(
          workspaceId,
          userId
        );
        await mockCheckSubscriptionLimits(subscriptionId, "agentKey", 1);

        // Generate keyId and key value
        const keyId = mockRandomUUID();
        const keyValue = mockRandomUUID(); // Use UUID as key value
        const agentKeyPk = `agent-keys/${workspaceId}/${agentId}/${keyId}`;
        const agentKeySk = "key";

        // Create agent key
        const agentKey = await db["agent-key"].create({
          pk: agentKeyPk,
          sk: agentKeySk,
          workspaceId,
          agentId,
          key: keyValue,
          name: name || undefined,
          provider: provider || "google",
          createdBy: currentUserRef,
        });

        res.status(201).json({
          id: keyId,
          key: keyValue,
          name: agentKey.name,
          provider: agentKey.provider,
          createdAt: agentKey.createdAt,
        });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should create agent key successfully with name and provider", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const workspaceResource = `workspaces/${workspaceId}`;
    const userRef = "users/user-789";
    const agentPk = `agents/${workspaceId}/${agentId}`;
    const keyId = "key-id-123";
    const keyValue = "key-value-456";

    const mockAgent = {
      pk: agentPk,
      sk: "agent",
      workspaceId,
      agentId,
      name: "Test Agent",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockAgentKey = {
      pk: `agent-keys/${workspaceId}/${agentId}/${keyId}`,
      sk: "key",
      workspaceId,
      agentId,
      key: keyValue,
      name: "My Key",
      provider: "openai",
      createdBy: userRef,
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockCreate = vi.fn().mockResolvedValue(mockAgentKey);
    (mockDb as Record<string, unknown>)["agent-key"] = {
      create: mockCreate,
    };

    mockRandomUUID.mockReturnValueOnce(keyId).mockReturnValueOnce(keyValue);
    mockEnsureWorkspaceSubscription.mockResolvedValue("subscription-123");
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);

    const req = createMockRequest({
      workspaceResource,
      userRef,
      params: {
        workspaceId,
        agentId,
      },
      body: {
        name: "My Key",
        provider: "openai",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockAgentGet).toHaveBeenCalledWith(agentPk, "agent");
    expect(mockEnsureWorkspaceSubscription).toHaveBeenCalledWith(
      workspaceId,
      "user-789"
    );
    expect(mockCheckSubscriptionLimits).toHaveBeenCalledWith(
      "subscription-123",
      "agentKey",
      1
    );
    expect(mockRandomUUID).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenCalledWith({
      pk: `agent-keys/${workspaceId}/${agentId}/${keyId}`,
      sk: "key",
      workspaceId,
      agentId,
      key: keyValue,
      name: "My Key",
      provider: "openai",
      createdBy: userRef,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      id: keyId,
      key: keyValue,
      name: "My Key",
      provider: "openai",
      createdAt: "2024-01-01T00:00:00Z",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should create agent key with default provider when provider is not provided", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const workspaceResource = `workspaces/${workspaceId}`;
    const userRef = "users/user-789";
    const agentPk = `agents/${workspaceId}/${agentId}`;
    const keyId = "key-id-123";
    const keyValue = "key-value-456";

    const mockAgent = {
      pk: agentPk,
      sk: "agent",
      workspaceId,
      agentId,
      name: "Test Agent",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockAgentKey = {
      pk: `agent-keys/${workspaceId}/${agentId}/${keyId}`,
      sk: "key",
      workspaceId,
      agentId,
      key: keyValue,
      name: "My Key",
      provider: "google",
      createdBy: userRef,
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockCreate = vi.fn().mockResolvedValue(mockAgentKey);
    (mockDb as Record<string, unknown>)["agent-key"] = {
      create: mockCreate,
    };

    mockRandomUUID.mockReturnValueOnce(keyId).mockReturnValueOnce(keyValue);
    mockEnsureWorkspaceSubscription.mockResolvedValue("subscription-123");
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);

    const req = createMockRequest({
      workspaceResource,
      userRef,
      params: {
        workspaceId,
        agentId,
      },
      body: {
        name: "My Key",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockCreate).toHaveBeenCalledWith({
      pk: `agent-keys/${workspaceId}/${agentId}/${keyId}`,
      sk: "key",
      workspaceId,
      agentId,
      key: keyValue,
      name: "My Key",
      provider: "google",
      createdBy: userRef,
    });
    expect(res.json).toHaveBeenCalledWith({
      id: keyId,
      key: keyValue,
      name: "My Key",
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    });
  });

  it("should create agent key without name when name is not provided", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const workspaceResource = `workspaces/${workspaceId}`;
    const userRef = "users/user-789";
    const agentPk = `agents/${workspaceId}/${agentId}`;
    const keyId = "key-id-123";
    const keyValue = "key-value-456";

    const mockAgent = {
      pk: agentPk,
      sk: "agent",
      workspaceId,
      agentId,
      name: "Test Agent",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockAgentKey = {
      pk: `agent-keys/${workspaceId}/${agentId}/${keyId}`,
      sk: "key",
      workspaceId,
      agentId,
      key: keyValue,
      name: undefined,
      provider: "google",
      createdBy: userRef,
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockCreate = vi.fn().mockResolvedValue(mockAgentKey);
    (mockDb as Record<string, unknown>)["agent-key"] = {
      create: mockCreate,
    };

    mockRandomUUID.mockReturnValueOnce(keyId).mockReturnValueOnce(keyValue);
    mockEnsureWorkspaceSubscription.mockResolvedValue("subscription-123");
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);

    const req = createMockRequest({
      workspaceResource,
      userRef,
      params: {
        workspaceId,
        agentId,
      },
      body: {},
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockCreate).toHaveBeenCalledWith({
      pk: `agent-keys/${workspaceId}/${agentId}/${keyId}`,
      sk: "key",
      workspaceId,
      agentId,
      key: keyValue,
      name: undefined,
      provider: "google",
      createdBy: userRef,
    });
    expect(res.json).toHaveBeenCalledWith({
      id: keyId,
      key: keyValue,
      name: undefined,
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    });
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: undefined,
      userRef: "users/user-789",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: {
        name: "My Key",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining("Workspace resource not found"),
          }),
        }),
      })
    );
  });

  it("should throw unauthorized when userRef is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const agentPk = `agents/${workspaceId}/${agentId}`;

    const mockAgent = {
      pk: agentPk,
      sk: "agent",
      workspaceId,
      agentId,
      name: "Test Agent",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: undefined,
      params: {
        workspaceId,
        agentId,
      },
      body: {
        name: "My Key",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 401,
        }),
      })
    );
  });

  it("should throw resourceGone when agent does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const workspaceResource = `workspaces/${workspaceId}`;
    const userRef = "users/user-789";
    const agentPk = `agents/${workspaceId}/${agentId}`;

    const mockAgentGet = vi.fn().mockResolvedValue(null);
    mockDb.agent.get = mockAgentGet;

    const req = createMockRequest({
      workspaceResource,
      userRef,
      params: {
        workspaceId,
        agentId,
      },
      body: {
        name: "My Key",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockAgentGet).toHaveBeenCalledWith(agentPk, "agent");
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 410,
          payload: expect.objectContaining({
            message: expect.stringContaining("Agent not found"),
          }),
        }),
      })
    );
  });
});
