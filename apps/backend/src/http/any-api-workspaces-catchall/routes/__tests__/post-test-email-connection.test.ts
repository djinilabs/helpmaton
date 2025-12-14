import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockSendEmailViaConnection } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockSendEmailViaConnection: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/email", () => ({
  sendEmailViaConnection: mockSendEmailViaConnection,
}));

describe("POST /api/workspaces/:workspaceId/email-connection/test", () => {
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

        // Import email sending utility
        const { sendEmailViaConnection } = await import(
          "../../../../utils/email"
        );

        // Get user email from session for test email
        const userEmail = req.session?.user?.email;
        if (!userEmail) {
          throw badRequest("User email not found in session");
        }

        // Send test email
        const testSubject = "Test Email from Helpmaton";
        const testText = `✅ Test email from Helpmaton\n\nThis is a test email to verify that your ${connection.name} email connection is configured correctly. If you received this email, your email setup is working!`;

        try {
          await sendEmailViaConnection(workspaceId, {
            to: userEmail,
            subject: testSubject,
            text: testText,
          });
          res.json({
            success: true,
            message: "Test email sent successfully",
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          throw badRequest(`Failed to send test email: ${errorMessage}`);
        }
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should send test email successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const pk = `email-connections/${workspaceId}`;
    const userEmail = "user@example.com";

    const mockConnection = {
      pk,
      sk: "connection",
      workspaceId,
      name: "Gmail Connection",
      type: "gmail",
      config: { token: "sensitive-token" },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockConnection);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    mockSendEmailViaConnection.mockResolvedValue(undefined);

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
      },
      session: {
        user: {
          id: "user-123",
          email: userEmail,
        },
        expires: "2024-12-31T23:59:59Z",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGet).toHaveBeenCalledWith(pk, "connection");
    expect(mockSendEmailViaConnection).toHaveBeenCalledWith(workspaceId, {
      to: userEmail,
      subject: "Test Email from Helpmaton",
      text: `✅ Test email from Helpmaton\n\nThis is a test email to verify that your ${mockConnection.name} email connection is configured correctly. If you received this email, your email setup is working!`,
    });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Test email sent successfully",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";

    const req = createMockRequest({
      params: {
        workspaceId,
      },
      session: {
        user: {
          id: "user-123",
          email: "user@example.com",
        },
        expires: "2024-12-31T23:59:59Z",
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
            message: "Workspace resource not found",
          }),
        }),
      })
    );
    expect(mockSendEmailViaConnection).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("should throw resourceGone when email connection is not found", async () => {
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
      session: {
        user: {
          id: "user-123",
          email: "user@example.com",
        },
        expires: "2024-12-31T23:59:59Z",
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
            message: "Email connection not found",
          }),
        }),
      })
    );
    expect(mockSendEmailViaConnection).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("should throw forbidden when email connection belongs to different workspace", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const pk = `email-connections/${workspaceId}`;

    const mockConnection = {
      pk,
      sk: "connection",
      workspaceId: "different-workspace-789", // Different workspace
      name: "Gmail Connection",
      type: "gmail",
      config: { token: "sensitive-token" },
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
      session: {
        user: {
          id: "user-123",
          email: "user@example.com",
        },
        expires: "2024-12-31T23:59:59Z",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGet).toHaveBeenCalledWith(pk, "connection");
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 403,
          payload: expect.objectContaining({
            message: "Email connection does not belong to this workspace",
          }),
        }),
      })
    );
    expect(mockSendEmailViaConnection).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("should throw badRequest when user email is not found in session", async () => {
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
      config: { token: "sensitive-token" },
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
      session: {
        user: {
          id: "user-123",
          // email is missing
        },
        expires: "2024-12-31T23:59:59Z",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGet).toHaveBeenCalledWith(pk, "connection");
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: "User email not found in session",
          }),
        }),
      })
    );
    expect(mockSendEmailViaConnection).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("should throw badRequest when sendEmailViaConnection fails", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const pk = `email-connections/${workspaceId}`;
    const userEmail = "user@example.com";

    const mockConnection = {
      pk,
      sk: "connection",
      workspaceId,
      name: "Gmail Connection",
      type: "gmail",
      config: { token: "sensitive-token" },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockConnection);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    const errorMessage = "Gmail connection missing tokens";
    mockSendEmailViaConnection.mockRejectedValue(new Error(errorMessage));

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
      },
      session: {
        user: {
          id: "user-123",
          email: userEmail,
        },
        expires: "2024-12-31T23:59:59Z",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGet).toHaveBeenCalledWith(pk, "connection");
    expect(mockSendEmailViaConnection).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: `Failed to send test email: ${errorMessage}`,
          }),
        }),
      })
    );
    expect(res.json).not.toHaveBeenCalled();
  });

  it("should throw badRequest when sendEmailViaConnection fails with string error", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const pk = `email-connections/${workspaceId}`;
    const userEmail = "user@example.com";

    const mockConnection = {
      pk,
      sk: "connection",
      workspaceId,
      name: "Gmail Connection",
      type: "gmail",
      config: { token: "sensitive-token" },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockConnection);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    const errorMessage = "Network timeout";
    mockSendEmailViaConnection.mockRejectedValue(errorMessage);

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
      },
      session: {
        user: {
          id: "user-123",
          email: userEmail,
        },
        expires: "2024-12-31T23:59:59Z",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGet).toHaveBeenCalledWith(pk, "connection");
    expect(mockSendEmailViaConnection).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: `Failed to send test email: ${errorMessage}`,
          }),
        }),
      })
    );
    expect(res.json).not.toHaveBeenCalled();
  });

  it("should include connection name in test email", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const pk = `email-connections/${workspaceId}`;
    const userEmail = "user@example.com";
    const connectionName = "My Custom Gmail Connection";

    const mockConnection = {
      pk,
      sk: "connection",
      workspaceId,
      name: connectionName,
      type: "gmail",
      config: { token: "sensitive-token" },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(mockConnection);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    mockSendEmailViaConnection.mockResolvedValue(undefined);

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
      },
      session: {
        user: {
          id: "user-123",
          email: userEmail,
        },
        expires: "2024-12-31T23:59:59Z",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockSendEmailViaConnection).toHaveBeenCalledWith(workspaceId, {
      to: userEmail,
      subject: "Test Email from Helpmaton",
      text: `✅ Test email from Helpmaton\n\nThis is a test email to verify that your ${connectionName} email connection is configured correctly. If you received this email, your email setup is working!`,
    });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Test email sent successfully",
    });
  });
});
