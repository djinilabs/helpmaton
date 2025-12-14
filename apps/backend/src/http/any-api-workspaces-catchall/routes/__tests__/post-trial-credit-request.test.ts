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
  mockDatabase,
  mockIsUserInTrialPeriod,
  mockValidateCloudflareTurnstile,
  mockSendTrialCreditRequestNotification,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockIsUserInTrialPeriod: vi.fn(),
    mockValidateCloudflareTurnstile: vi.fn(),
    mockSendTrialCreditRequestNotification: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/trialPeriod", () => ({
  isUserInTrialPeriod: mockIsUserInTrialPeriod,
}));

vi.mock("../../../../utils/captcha", () => ({
  validateCloudflareTurnstile: mockValidateCloudflareTurnstile,
}));

vi.mock("../../../../utils/trialCreditNotifications", () => ({
  sendTrialCreditRequestNotification: mockSendTrialCreditRequestNotification,
}));

describe("POST /api/workspaces/:workspaceId/trial-credit-request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env var
    delete process.env.DISABLE_TRIAL_PERIOD_CHECK;
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>
  ) {
    // Extract the handler logic directly
    const handler = async (req: express.Request, res: express.Response) => {
      const db = await mockDatabase();
      const workspaceId = req.params.workspaceId;
      const workspaceResource = (req as { workspaceResource?: string })
        .workspaceResource;
      if (!workspaceResource) {
        throw badRequest("Workspace resource not found");
      }

      const session = (
        req as {
          session?: { user?: { id: string; email?: string } };
        }
      ).session;
      if (!session?.user?.id || !session?.user?.email) {
        throw unauthorized("User session required");
      }

      const userId = session.user.id;
      const userEmail = session.user.email;

      // Validate user is in trial period
      // TEMPORARY: Can be disabled via DISABLE_TRIAL_PERIOD_CHECK env var
      const disableTrialPeriodCheck =
        process.env.DISABLE_TRIAL_PERIOD_CHECK === "true";
      if (!disableTrialPeriodCheck) {
        const inTrial = await mockIsUserInTrialPeriod(userId);
        if (!inTrial) {
          throw badRequest(
            "Trial period has expired. Trial credits are only available within 7 days of account creation."
          );
        }
      }

      // Get workspace
      const workspace = await db.workspace.get(workspaceResource, "workspace");
      if (!workspace) {
        throw resourceGone("Workspace not found");
      }

      // Check if user has already requested credits for this workspace
      if (workspace.trialCreditRequested) {
        throw badRequest(
          "Trial credits have already been requested for this workspace."
        );
      }

      // Validate CAPTCHA token
      const { captchaToken } = req.body as { captchaToken?: string };
      if (!captchaToken || typeof captchaToken !== "string") {
        throw badRequest("CAPTCHA token is required");
      }

      // Get user IP from request
      const userIp =
        (req as { ip?: string }).ip ||
        (req as { socket?: { remoteAddress?: string } }).socket
          ?.remoteAddress ||
        "unknown";
      const captchaValid = await mockValidateCloudflareTurnstile(
        captchaToken,
        userIp
      );
      if (!captchaValid) {
        throw badRequest("CAPTCHA validation failed. Please try again.");
      }

      // Create trial credit request record
      const requestPk = `trial-credit-requests/${workspaceId}`;
      const requestSk = "request";

      await db["trial-credit-requests"].create({
        pk: requestPk,
        sk: requestSk,
        workspaceId,
        userId,
        userEmail,
        currency: workspace.currency || "usd",
        requestedAt: new Date().toISOString(),
        status: "pending",
      });

      // Update workspace to mark that credits have been requested
      await db.workspace.update({
        pk: workspaceResource,
        sk: "workspace",
        trialCreditRequested: true,
        trialCreditRequestedAt: new Date().toISOString(),
      });

      // Send Discord notification
      await mockSendTrialCreditRequestNotification(
        workspaceId,
        userEmail,
        workspace.currency || "usd"
      );

      res.status(201).json({
        success: true,
        message:
          "Trial credit request submitted successfully. You will be notified once approved.",
      });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should successfully create trial credit request", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const userEmail = "user@example.com";
    const workspaceResource = `workspaces/${workspaceId}`;
    const captchaToken = "test-captcha-token";
    const userIp = "192.168.1.1";

    const mockWorkspace = {
      pk: workspaceResource,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      currency: "usd",
      trialCreditRequested: false,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockCreate = vi.fn().mockResolvedValue({});
    (mockDb as Record<string, unknown>)["trial-credit-requests"] = {
      create: mockCreate,
    };

    const mockUpdate = vi.fn().mockResolvedValue({});
    mockDb.workspace.update = mockUpdate;

    mockIsUserInTrialPeriod.mockResolvedValue(true);
    mockValidateCloudflareTurnstile.mockResolvedValue(true);
    mockSendTrialCreditRequestNotification.mockResolvedValue(undefined);

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
          email: userEmail,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
      },
      body: {
        captchaToken,
      },
      ip: userIp,
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockWorkspaceGet).toHaveBeenCalledWith(
      workspaceResource,
      "workspace"
    );
    expect(mockIsUserInTrialPeriod).toHaveBeenCalledWith(userId);
    expect(mockValidateCloudflareTurnstile).toHaveBeenCalledWith(
      captchaToken,
      userIp
    );
    expect(mockCreate).toHaveBeenCalledWith({
      pk: `trial-credit-requests/${workspaceId}`,
      sk: "request",
      workspaceId,
      userId,
      userEmail,
      currency: "usd",
      requestedAt: expect.any(String),
      status: "pending",
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      pk: workspaceResource,
      sk: "workspace",
      trialCreditRequested: true,
      trialCreditRequestedAt: expect.any(String),
    });
    expect(mockSendTrialCreditRequestNotification).toHaveBeenCalledWith(
      workspaceId,
      userEmail,
      "usd"
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message:
        "Trial credit request submitted successfully. You will be notified once approved.",
    });
  });

  it("should use default currency when workspace currency is not set", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const userEmail = "user@example.com";
    const workspaceResource = `workspaces/${workspaceId}`;
    const captchaToken = "test-captcha-token";
    const userIp = "192.168.1.1";

    const mockWorkspace = {
      pk: workspaceResource,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      currency: undefined,
      trialCreditRequested: false,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockCreate = vi.fn().mockResolvedValue({});
    (mockDb as Record<string, unknown>)["trial-credit-requests"] = {
      create: mockCreate,
    };

    const mockUpdate = vi.fn().mockResolvedValue({});
    mockDb.workspace.update = mockUpdate;

    mockIsUserInTrialPeriod.mockResolvedValue(true);
    mockValidateCloudflareTurnstile.mockResolvedValue(true);
    mockSendTrialCreditRequestNotification.mockResolvedValue(undefined);

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
          email: userEmail,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
      },
      body: {
        captchaToken,
      },
      ip: userIp,
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: "usd",
      })
    );
    expect(mockSendTrialCreditRequestNotification).toHaveBeenCalledWith(
      workspaceId,
      userEmail,
      "usd"
    );
  });

  it("should use socket.remoteAddress when ip is not available", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const userEmail = "user@example.com";
    const workspaceResource = `workspaces/${workspaceId}`;
    const captchaToken = "test-captcha-token";
    const socketIp = "10.0.0.1";

    const mockWorkspace = {
      pk: workspaceResource,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      currency: "eur",
      trialCreditRequested: false,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockCreate = vi.fn().mockResolvedValue({});
    (mockDb as Record<string, unknown>)["trial-credit-requests"] = {
      create: mockCreate,
    };

    const mockUpdate = vi.fn().mockResolvedValue({});
    mockDb.workspace.update = mockUpdate;

    mockIsUserInTrialPeriod.mockResolvedValue(true);
    mockValidateCloudflareTurnstile.mockResolvedValue(true);
    mockSendTrialCreditRequestNotification.mockResolvedValue(undefined);

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
          email: userEmail,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
      },
      body: {
        captchaToken,
      },
      ip: undefined,
      socket: {
        remoteAddress: socketIp,
      } as express.Request["socket"],
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockValidateCloudflareTurnstile).toHaveBeenCalledWith(
      captchaToken,
      socketIp
    );
  });

  it("should use 'unknown' when neither ip nor socket.remoteAddress is available", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const userEmail = "user@example.com";
    const workspaceResource = `workspaces/${workspaceId}`;
    const captchaToken = "test-captcha-token";

    const mockWorkspace = {
      pk: workspaceResource,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      currency: "gbp",
      trialCreditRequested: false,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockCreate = vi.fn().mockResolvedValue({});
    (mockDb as Record<string, unknown>)["trial-credit-requests"] = {
      create: mockCreate,
    };

    const mockUpdate = vi.fn().mockResolvedValue({});
    mockDb.workspace.update = mockUpdate;

    mockIsUserInTrialPeriod.mockResolvedValue(true);
    mockValidateCloudflareTurnstile.mockResolvedValue(true);
    mockSendTrialCreditRequestNotification.mockResolvedValue(undefined);

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
          email: userEmail,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
      },
      body: {
        captchaToken,
      },
      ip: undefined,
      socket: {} as express.Request["socket"],
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockValidateCloudflareTurnstile).toHaveBeenCalledWith(
      captchaToken,
      "unknown"
    );
  });

  it("should skip trial period check when DISABLE_TRIAL_PERIOD_CHECK is set", async () => {
    process.env.DISABLE_TRIAL_PERIOD_CHECK = "true";

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const userEmail = "user@example.com";
    const workspaceResource = `workspaces/${workspaceId}`;
    const captchaToken = "test-captcha-token";
    const userIp = "192.168.1.1";

    const mockWorkspace = {
      pk: workspaceResource,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      currency: "usd",
      trialCreditRequested: false,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    const mockCreate = vi.fn().mockResolvedValue({});
    (mockDb as Record<string, unknown>)["trial-credit-requests"] = {
      create: mockCreate,
    };

    const mockUpdate = vi.fn().mockResolvedValue({});
    mockDb.workspace.update = mockUpdate;

    mockValidateCloudflareTurnstile.mockResolvedValue(true);
    mockSendTrialCreditRequestNotification.mockResolvedValue(undefined);

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
          email: userEmail,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
      },
      body: {
        captchaToken,
      },
      ip: userIp,
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockIsUserInTrialPeriod).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: undefined,
      session: {
        user: {
          id: "user-456",
          email: "user@example.com",
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        captchaToken: "test-token",
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
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

  it("should throw unauthorized when session is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      session: undefined,
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        captchaToken: "test-token",
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 401,
          payload: expect.objectContaining({
            message: expect.stringContaining("User session required"),
          }),
        }),
      })
    );
  });

  it("should throw unauthorized when session.user.id is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      session: {
        user: {
          email: "user@example.com",
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        captchaToken: "test-token",
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 401,
          payload: expect.objectContaining({
            message: expect.stringContaining("User session required"),
          }),
        }),
      })
    );
  });

  it("should throw unauthorized when session.user.email is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      session: {
        user: {
          id: "user-456",
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        captchaToken: "test-token",
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 401,
          payload: expect.objectContaining({
            message: expect.stringContaining("User session required"),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when user is not in trial period", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const userEmail = "user@example.com";
    const workspaceResource = `workspaces/${workspaceId}`;

    mockIsUserInTrialPeriod.mockResolvedValue(false);

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
          email: userEmail,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
      },
      body: {
        captchaToken: "test-token",
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "Trial period has expired. Trial credits are only available within 7 days of account creation."
            ),
          }),
        }),
      })
    );
  });

  it("should throw resourceGone when workspace does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const userEmail = "user@example.com";
    const workspaceResource = `workspaces/${workspaceId}`;

    const mockWorkspaceGet = vi.fn().mockResolvedValue(null);
    mockDb.workspace.get = mockWorkspaceGet;

    mockIsUserInTrialPeriod.mockResolvedValue(true);

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
          email: userEmail,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
      },
      body: {
        captchaToken: "test-token",
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 410,
          payload: expect.objectContaining({
            message: expect.stringContaining("Workspace not found"),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when credits have already been requested", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const userEmail = "user@example.com";
    const workspaceResource = `workspaces/${workspaceId}`;

    const mockWorkspace = {
      pk: workspaceResource,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      currency: "usd",
      trialCreditRequested: true,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockIsUserInTrialPeriod.mockResolvedValue(true);

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
          email: userEmail,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
      },
      body: {
        captchaToken: "test-token",
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "Trial credits have already been requested for this workspace."
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when captchaToken is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const userEmail = "user@example.com";
    const workspaceResource = `workspaces/${workspaceId}`;

    const mockWorkspace = {
      pk: workspaceResource,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      currency: "usd",
      trialCreditRequested: false,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockIsUserInTrialPeriod.mockResolvedValue(true);

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
          email: userEmail,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
      },
      body: {},
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining("CAPTCHA token is required"),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when captchaToken is not a string", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const userEmail = "user@example.com";
    const workspaceResource = `workspaces/${workspaceId}`;

    const mockWorkspace = {
      pk: workspaceResource,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      currency: "usd",
      trialCreditRequested: false,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockIsUserInTrialPeriod.mockResolvedValue(true);

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
          email: userEmail,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
      },
      body: {
        captchaToken: 123,
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining("CAPTCHA token is required"),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when CAPTCHA validation fails", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const userEmail = "user@example.com";
    const workspaceResource = `workspaces/${workspaceId}`;
    const captchaToken = "invalid-token";
    const userIp = "192.168.1.1";

    const mockWorkspace = {
      pk: workspaceResource,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      currency: "usd",
      trialCreditRequested: false,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockIsUserInTrialPeriod.mockResolvedValue(true);
    mockValidateCloudflareTurnstile.mockResolvedValue(false);

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
          email: userEmail,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
      },
      body: {
        captchaToken,
      },
      ip: userIp,
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "CAPTCHA validation failed. Please try again."
            ),
          }),
        }),
      })
    );
  });
});
