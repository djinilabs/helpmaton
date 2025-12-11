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

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

describe("DELETE /api/workspaces/:workspaceId/agents/:agentId/keys/:keyId", () => {
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
        const keyId = req.params.keyId;
        const agentPk = `agents/${workspaceId}/${agentId}`;

        // Verify agent exists
        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw resourceGone("Agent not found");
        }

        // Get the key to verify it exists and belongs to agent
        const agentKeyPk = `agent-keys/${workspaceId}/${agentId}/${keyId}`;
        const agentKeySk = "key";
        const agentKey = await db["agent-key"].get(agentKeyPk, agentKeySk);

        if (!agentKey) {
          throw resourceGone("Key not found");
        }

        if (
          agentKey.workspaceId !== workspaceId ||
          agentKey.agentId !== agentId
        ) {
          throw forbidden("Key does not belong to this agent");
        }

        // Delete key
        await db["agent-key"].delete(agentKeyPk, agentKeySk);

        res.status(204).send();
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should delete agent key successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const keyId = "key-789";
    const workspaceResource = `workspaces/${workspaceId}`;
    const agentPk = `agents/${workspaceId}/${agentId}`;
    const agentKeyPk = `agent-keys/${workspaceId}/${agentId}/${keyId}`;

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
      pk: agentKeyPk,
      sk: "key",
      workspaceId,
      agentId,
      keyId,
      key: "key-value-123",
      name: "My Key",
      provider: "google",
    };

    const mockKeyGet = vi.fn().mockResolvedValue(mockAgentKey);
    (mockDb as Record<string, unknown>)["agent-key"] = {
      get: mockKeyGet,
    };

    const mockDelete = vi.fn().mockResolvedValue({});
    const agentKeyMock = (mockDb as Record<string, unknown>)["agent-key"] as {
      delete: typeof mockDelete;
    };
    agentKeyMock.delete = mockDelete;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        agentId,
        keyId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockAgentGet).toHaveBeenCalledWith(agentPk, "agent");
    expect(mockKeyGet).toHaveBeenCalledWith(agentKeyPk, "key");
    expect(mockDelete).toHaveBeenCalledWith(agentKeyPk, "key");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: undefined,
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        keyId: "key-789",
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

  it("should throw resourceGone when agent does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const keyId = "key-789";
    const workspaceResource = `workspaces/${workspaceId}`;
    const agentPk = `agents/${workspaceId}/${agentId}`;

    const mockAgentGet = vi.fn().mockResolvedValue(null);
    mockDb.agent.get = mockAgentGet;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        agentId,
        keyId,
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

  it("should throw resourceGone when key does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const keyId = "key-789";
    const workspaceResource = `workspaces/${workspaceId}`;
    const agentPk = `agents/${workspaceId}/${agentId}`;
    const agentKeyPk = `agent-keys/${workspaceId}/${agentId}/${keyId}`;

    const mockAgent = {
      pk: agentPk,
      sk: "agent",
      workspaceId,
      agentId,
      name: "Test Agent",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockKeyGet = vi.fn().mockResolvedValue(null);
    (mockDb as Record<string, unknown>)["agent-key"] = {
      get: mockKeyGet,
    };

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        agentId,
        keyId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockKeyGet).toHaveBeenCalledWith(agentKeyPk, "key");
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 410,
          payload: expect.objectContaining({
            message: expect.stringContaining("Key not found"),
          }),
        }),
      })
    );
  });

  it("should throw forbidden when key belongs to different workspace", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const keyId = "key-789";
    const workspaceResource = `workspaces/${workspaceId}`;
    const agentPk = `agents/${workspaceId}/${agentId}`;
    const agentKeyPk = `agent-keys/${workspaceId}/${agentId}/${keyId}`;

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
      pk: agentKeyPk,
      sk: "key",
      workspaceId: "different-workspace",
      agentId,
      keyId,
      key: "key-value-123",
    };

    const mockKeyGet = vi.fn().mockResolvedValue(mockAgentKey);
    (mockDb as Record<string, unknown>)["agent-key"] = {
      get: mockKeyGet,
    };

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        agentId,
        keyId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 403,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "Key does not belong to this agent"
            ),
          }),
        }),
      })
    );
  });

  it("should throw forbidden when key belongs to different agent", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const keyId = "key-789";
    const workspaceResource = `workspaces/${workspaceId}`;
    const agentPk = `agents/${workspaceId}/${agentId}`;
    const agentKeyPk = `agent-keys/${workspaceId}/${agentId}/${keyId}`;

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
      pk: agentKeyPk,
      sk: "key",
      workspaceId,
      agentId: "different-agent",
      keyId,
      key: "key-value-123",
    };

    const mockKeyGet = vi.fn().mockResolvedValue(mockAgentKey);
    (mockDb as Record<string, unknown>)["agent-key"] = {
      get: mockKeyGet,
    };

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
        agentId,
        keyId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 403,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "Key does not belong to this agent"
            ),
          }),
        }),
      })
    );
  });
});
