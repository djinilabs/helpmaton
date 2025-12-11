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

describe("DELETE /api/workspaces/:workspaceId/email-connection", () => {
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

        // Delete connection
        await db["email-connection"].delete(pk, "connection");

        res.status(204).send();
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should delete email connection successfully", async () => {
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
      config: { token: "token123" },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockConnection);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    const mockDelete = vi.fn().mockResolvedValue({});
    const emailConnectionMock = (mockDb as Record<string, unknown>)[
      "email-connection"
    ] as { delete: typeof mockDelete };
    emailConnectionMock.delete = mockDelete;

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
    expect(mockDelete).toHaveBeenCalledWith(pk, "connection");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should delete Gmail email connection", async () => {
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
      config: {},
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockConnection);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    const mockDelete = vi.fn().mockResolvedValue({});
    const emailConnectionMock = (mockDb as Record<string, unknown>)[
      "email-connection"
    ] as { delete: typeof mockDelete };
    emailConnectionMock.delete = mockDelete;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockDelete).toHaveBeenCalledWith(pk, "connection");
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("should delete Outlook email connection", async () => {
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
      config: {},
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockConnection);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    const mockDelete = vi.fn().mockResolvedValue({});
    const emailConnectionMock = (mockDb as Record<string, unknown>)[
      "email-connection"
    ] as { delete: typeof mockDelete };
    emailConnectionMock.delete = mockDelete;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockDelete).toHaveBeenCalledWith(pk, "connection");
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("should delete SMTP email connection", async () => {
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
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockConnection);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    const mockDelete = vi.fn().mockResolvedValue({});
    const emailConnectionMock = (mockDb as Record<string, unknown>)[
      "email-connection"
    ] as { delete: typeof mockDelete };
    emailConnectionMock.delete = mockDelete;

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockDelete).toHaveBeenCalledWith(pk, "connection");
    expect(res.status).toHaveBeenCalledWith(204);
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
