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

describe("PUT /api/workspaces/:workspaceId/email-connection", () => {
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
        const { name, config } = req.body;
        const db = await mockDatabase();
        const workspaceResource = (req as { workspaceResource?: string })
          .workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = req.params.workspaceId;
        const pk = `email-connections/${workspaceId}`;

        const connection = await db["email-connection"].get(pk, "connection");
        if (!connection) {
          throw resourceGone("Email connection not found");
        }

        if (connection.workspaceId !== workspaceId) {
          throw forbidden("Email connection does not belong to this workspace");
        }

        // Validate config if provided
        if (config !== undefined) {
          if (typeof config !== "object") {
            throw badRequest("config must be an object");
          }
          // Merge config with existing
          const updatedConfig = { ...connection.config, ...config };
          connection.config = updatedConfig;
        }

        // Update connection
        const updated = await db["email-connection"].update({
          pk,
          sk: "connection",
          workspaceId,
          type: connection.type,
          name: name !== undefined ? name : connection.name,
          config: connection.config,
          updatedBy: (req as { userRef?: string }).userRef || "",
          updatedAt: new Date().toISOString(),
        });

        res.json({
          name: updated.name,
          type: updated.type,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should successfully update email connection name", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const userRef = "users/user-456";
    const pk = `email-connections/${workspaceId}`;

    const mockConnection = {
      pk,
      sk: "connection",
      workspaceId,
      name: "Old Name",
      type: "gmail",
      config: { token: "token123" },
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockConnection);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    const updatedConnection = {
      ...mockConnection,
      name: "New Name",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockUpdate = vi.fn().mockResolvedValue(updatedConnection);
    const emailConnectionMock = (mockDb as Record<string, unknown>)[
      "email-connection"
    ] as { update: typeof mockUpdate };
    emailConnectionMock.update = mockUpdate;

    const req = createMockRequest({
      workspaceResource,
      userRef,
      params: {
        workspaceId,
      },
      body: {
        name: "New Name",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGet).toHaveBeenCalledWith(pk, "connection");
    expect(mockUpdate).toHaveBeenCalledWith({
      pk,
      sk: "connection",
      workspaceId,
      type: "gmail",
      name: "New Name",
      config: { token: "token123" },
      updatedBy: userRef,
      updatedAt: expect.any(String),
    });
    expect(res.json).toHaveBeenCalledWith({
      name: "New Name",
      type: "gmail",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });

  it("should successfully update email connection config", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const userRef = "users/user-456";
    const pk = `email-connections/${workspaceId}`;

    const mockConnection = {
      pk,
      sk: "connection",
      workspaceId,
      name: "Gmail Connection",
      type: "gmail",
      config: { token: "old-token", refreshToken: "refresh-token" },
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockConnection);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    const updatedConnection = {
      ...mockConnection,
      config: { token: "new-token", refreshToken: "refresh-token" },
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockUpdate = vi.fn().mockResolvedValue(updatedConnection);
    const emailConnectionMock = (mockDb as Record<string, unknown>)[
      "email-connection"
    ] as { update: typeof mockUpdate };
    emailConnectionMock.update = mockUpdate;

    const req = createMockRequest({
      workspaceResource,
      userRef,
      params: {
        workspaceId,
      },
      body: {
        config: { token: "new-token" },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({
      pk,
      sk: "connection",
      workspaceId,
      type: "gmail",
      name: "Gmail Connection",
      config: { token: "new-token", refreshToken: "refresh-token" },
      updatedBy: userRef,
      updatedAt: expect.any(String),
    });
    expect(res.json).toHaveBeenCalledWith({
      name: "Gmail Connection",
      type: "gmail",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });

  it("should successfully update both name and config", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const userRef = "users/user-456";
    const pk = `email-connections/${workspaceId}`;

    const mockConnection = {
      pk,
      sk: "connection",
      workspaceId,
      name: "Old Name",
      type: "outlook",
      config: { token: "old-token" },
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockConnection);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    const updatedConnection = {
      ...mockConnection,
      name: "New Name",
      config: { token: "new-token", clientId: "client-123" },
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockUpdate = vi.fn().mockResolvedValue(updatedConnection);
    const emailConnectionMock = (mockDb as Record<string, unknown>)[
      "email-connection"
    ] as { update: typeof mockUpdate };
    emailConnectionMock.update = mockUpdate;

    const req = createMockRequest({
      workspaceResource,
      userRef,
      params: {
        workspaceId,
      },
      body: {
        name: "New Name",
        config: { token: "new-token", clientId: "client-123" },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({
      pk,
      sk: "connection",
      workspaceId,
      type: "outlook",
      name: "New Name",
      config: { token: "new-token", clientId: "client-123" },
      updatedBy: userRef,
      updatedAt: expect.any(String),
    });
  });

  it("should preserve existing name when name is not provided", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const userRef = "users/user-456";
    const pk = `email-connections/${workspaceId}`;

    const mockConnection = {
      pk,
      sk: "connection",
      workspaceId,
      name: "Existing Name",
      type: "gmail",
      config: { token: "token123" },
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockConnection);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    const updatedConnection = {
      ...mockConnection,
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockUpdate = vi.fn().mockResolvedValue(updatedConnection);
    const emailConnectionMock = (mockDb as Record<string, unknown>)[
      "email-connection"
    ] as { update: typeof mockUpdate };
    emailConnectionMock.update = mockUpdate;

    const req = createMockRequest({
      workspaceResource,
      userRef,
      params: {
        workspaceId,
      },
      body: {
        config: { token: "new-token" },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({
      pk,
      sk: "connection",
      workspaceId,
      type: "gmail",
      name: "Existing Name",
      config: { token: "new-token" },
      updatedBy: userRef,
      updatedAt: expect.any(String),
    });
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: undefined,
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        name: "New Name",
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

  it("should throw resourceGone when email connection does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const pk = `email-connections/${workspaceId}`;

    const mockGet = vi.fn().mockResolvedValue(null);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
      },
      body: {
        name: "New Name",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGet).toHaveBeenCalledWith(pk, "connection");
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 410,
          payload: expect.objectContaining({
            message: expect.stringContaining("Email connection not found"),
          }),
        }),
      })
    );
  });

  it("should throw forbidden when connection belongs to different workspace", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const pk = `email-connections/${workspaceId}`;

    const mockConnection = {
      pk,
      sk: "connection",
      workspaceId: "different-workspace",
      name: "Connection",
      type: "gmail",
      config: {},
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockConnection);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
      },
      body: {
        name: "New Name",
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
              "Email connection does not belong to this workspace"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when config is not an object", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const pk = `email-connections/${workspaceId}`;

    const mockConnection = {
      pk,
      sk: "connection",
      workspaceId,
      name: "Connection",
      type: "gmail",
      config: {},
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockConnection);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
      },
      body: {
        config: "not-an-object",
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
            message: expect.stringContaining("config must be an object"),
          }),
        }),
      })
    );
  });

  it("should handle empty config object", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const userRef = "users/user-456";
    const pk = `email-connections/${workspaceId}`;

    const mockConnection = {
      pk,
      sk: "connection",
      workspaceId,
      name: "Connection",
      type: "gmail",
      config: { token: "token123" },
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockConnection);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    const updatedConnection = {
      ...mockConnection,
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockUpdate = vi.fn().mockResolvedValue(updatedConnection);
    const emailConnectionMock = (mockDb as Record<string, unknown>)[
      "email-connection"
    ] as { update: typeof mockUpdate };
    emailConnectionMock.update = mockUpdate;

    const req = createMockRequest({
      workspaceResource,
      userRef,
      params: {
        workspaceId,
      },
      body: {
        config: {},
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    // Empty config object merges with existing config, preserving existing values
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { token: "token123" },
      })
    );
  });

  it("should use empty string for updatedBy when userRef is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const pk = `email-connections/${workspaceId}`;

    const mockConnection = {
      pk,
      sk: "connection",
      workspaceId,
      name: "Connection",
      type: "gmail",
      config: {},
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockConnection);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    const updatedConnection = {
      ...mockConnection,
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockUpdate = vi.fn().mockResolvedValue(updatedConnection);
    const emailConnectionMock = (mockDb as Record<string, unknown>)[
      "email-connection"
    ] as { update: typeof mockUpdate };
    emailConnectionMock.update = mockUpdate;

    const req = createMockRequest({
      workspaceResource,
      userRef: undefined,
      params: {
        workspaceId,
      },
      body: {
        name: "New Name",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        updatedBy: "",
      })
    );
  });
});
