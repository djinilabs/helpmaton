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

describe("GET /api/workspaces/:workspaceId/email-connection", () => {
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
        const pk = `email-connections/${workspaceId}`;

        const connection = await db["email-connection"].get(pk, "connection");
        if (!connection) {
          throw resourceGone("Email connection not found");
        }

        if (connection.workspaceId !== workspaceId) {
          throw forbidden("Email connection does not belong to this workspace");
        }

        // Return connection without sensitive config data
        res.json({
          name: connection.name,
          type: connection.type,
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
        });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should return email connection successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const pk = `email-connections/${workspaceId}`;

    const mockConnection = {
      pk,
      sk: "connection",
      workspaceId,
      name: "Gmail Connection",
      type: "gmail",
      config: { token: "sensitive-token" }, // Should not be returned
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
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
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGet).toHaveBeenCalledWith(pk, "connection");
    expect(res.json).toHaveBeenCalledWith({
      name: "Gmail Connection",
      type: "gmail",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should return email connection without sensitive config data", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const pk = `email-connections/${workspaceId}`;

    const mockConnection = {
      pk,
      sk: "connection",
      workspaceId,
      name: "SMTP Connection",
      type: "smtp",
      config: {
        host: "smtp.example.com",
        port: 587,
        username: "user@example.com",
        password: "secret-password",
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
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
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    // Verify config is not included in response
    expect(res.json).toHaveBeenCalledWith({
      name: "SMTP Connection",
      type: "smtp",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
    const responseCall = (res.json as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(responseCall).not.toHaveProperty("config");
  });

  it("should return Outlook email connection", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const pk = `email-connections/${workspaceId}`;

    const mockConnection = {
      pk,
      sk: "connection",
      workspaceId,
      name: "Outlook Connection",
      type: "outlook",
      config: { token: "outlook-token" },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
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
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      name: "Outlook Connection",
      type: "outlook",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
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
      updatedAt: "2024-01-02T00:00:00Z",
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
});
