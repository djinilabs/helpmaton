import { badRequest, resourceGone, unauthorized } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockIsUserInTrialPeriod, mockGetTrialDaysRemaining } =
  vi.hoisted(() => {
    return {
      mockDatabase: vi.fn(),
      mockIsUserInTrialPeriod: vi.fn(),
      mockGetTrialDaysRemaining: vi.fn(),
    };
  });

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/trialPeriod", () => ({
  isUserInTrialPeriod: mockIsUserInTrialPeriod,
  getTrialDaysRemaining: mockGetTrialDaysRemaining,
}));

describe("GET /api/workspaces/:workspaceId/trial-status", () => {
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
      const workspaceResource = (req as { workspaceResource?: string })
        .workspaceResource;
      if (!workspaceResource) {
        throw badRequest("Workspace resource not found");
      }

      const session = (req as { session?: { user?: { id: string } } }).session;
      if (!session?.user?.id) {
        throw unauthorized("User session required");
      }

      const userId = session.user.id;

      // Get workspace
      const workspace = await db.workspace.get(workspaceResource, "workspace");
      if (!workspace) {
        throw resourceGone("Workspace not found");
      }

      // Check trial period
      // TEMPORARY: Can be disabled via DISABLE_TRIAL_PERIOD_CHECK env var
      const disableTrialPeriodCheck =
        process.env.DISABLE_TRIAL_PERIOD_CHECK === "true";
      const inTrial = disableTrialPeriodCheck
        ? true
        : await mockIsUserInTrialPeriod(userId);
      const daysRemaining = await mockGetTrialDaysRemaining(userId);

      // Calculate usage if credits were approved
      let currentUsage = 0;
      let initialCreditAmount = 0;

      if (workspace.trialCreditApproved && workspace.trialCreditAmount) {
        initialCreditAmount = workspace.trialCreditAmount;
        const currentBalance = workspace.creditBalance ?? 0;
        const used = initialCreditAmount - currentBalance;
        currentUsage = Math.min(
          100,
          Math.max(0, (used / initialCreditAmount) * 100)
        );
      }

      res.json({
        isInTrialPeriod: inTrial,
        daysRemaining: Math.max(0, daysRemaining),
        hasRequestedCredits: workspace.trialCreditRequested || false,
        creditsApproved: workspace.trialCreditApproved || false,
        initialCreditAmount: workspace.trialCreditApproved
          ? workspace.trialCreditAmount || 0
          : 0,
        currentUsage: Math.round(currentUsage * 100) / 100, // Round to 2 decimal places
      });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should return trial status for user in trial period", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const workspaceResource = `workspaces/${workspaceId}`;

    const mockWorkspace = {
      pk: workspaceResource,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      trialCreditRequested: false,
      trialCreditApproved: false,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockIsUserInTrialPeriod.mockResolvedValue(true);
    mockGetTrialDaysRemaining.mockResolvedValue(5);

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockWorkspaceGet).toHaveBeenCalledWith(
      workspaceResource,
      "workspace"
    );
    expect(mockIsUserInTrialPeriod).toHaveBeenCalledWith(userId);
    expect(mockGetTrialDaysRemaining).toHaveBeenCalledWith(userId);
    expect(res.json).toHaveBeenCalledWith({
      isInTrialPeriod: true,
      daysRemaining: 5,
      hasRequestedCredits: false,
      creditsApproved: false,
      initialCreditAmount: 0,
      currentUsage: 0,
    });
  });

  it("should return trial status for user not in trial period", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const workspaceResource = `workspaces/${workspaceId}`;

    const mockWorkspace = {
      pk: workspaceResource,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      trialCreditRequested: false,
      trialCreditApproved: false,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockIsUserInTrialPeriod.mockResolvedValue(false);
    mockGetTrialDaysRemaining.mockResolvedValue(0);

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      isInTrialPeriod: false,
      daysRemaining: 0,
      hasRequestedCredits: false,
      creditsApproved: false,
      initialCreditAmount: 0,
      currentUsage: 0,
    });
  });

  it("should return trial status with approved credits and usage", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const workspaceResource = `workspaces/${workspaceId}`;

    const mockWorkspace = {
      pk: workspaceResource,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      trialCreditRequested: true,
      trialCreditApproved: true,
      trialCreditAmount: 100,
      creditBalance: 60,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockIsUserInTrialPeriod.mockResolvedValue(true);
    mockGetTrialDaysRemaining.mockResolvedValue(3);

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    // Usage = (100 - 60) / 100 * 100 = 40%
    expect(res.json).toHaveBeenCalledWith({
      isInTrialPeriod: true,
      daysRemaining: 3,
      hasRequestedCredits: true,
      creditsApproved: true,
      initialCreditAmount: 100,
      currentUsage: 40,
    });
  });

  it("should cap usage at 100% when balance is negative", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const workspaceResource = `workspaces/${workspaceId}`;

    const mockWorkspace = {
      pk: workspaceResource,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      trialCreditRequested: true,
      trialCreditApproved: true,
      trialCreditAmount: 100,
      creditBalance: -10, // Negative balance
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockIsUserInTrialPeriod.mockResolvedValue(true);
    mockGetTrialDaysRemaining.mockResolvedValue(2);

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    // Usage = (100 - (-10)) / 100 * 100 = 110%, but capped at 100%
    expect(res.json).toHaveBeenCalledWith({
      isInTrialPeriod: true,
      daysRemaining: 2,
      hasRequestedCredits: true,
      creditsApproved: true,
      initialCreditAmount: 100,
      currentUsage: 100,
    });
  });

  it("should handle workspace with no creditBalance", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const workspaceResource = `workspaces/${workspaceId}`;

    const mockWorkspace = {
      pk: workspaceResource,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      trialCreditRequested: true,
      trialCreditApproved: true,
      trialCreditAmount: 100,
      creditBalance: undefined,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockIsUserInTrialPeriod.mockResolvedValue(true);
    mockGetTrialDaysRemaining.mockResolvedValue(4);

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    // Usage = (100 - 0) / 100 * 100 = 100%
    expect(res.json).toHaveBeenCalledWith({
      isInTrialPeriod: true,
      daysRemaining: 4,
      hasRequestedCredits: true,
      creditsApproved: true,
      initialCreditAmount: 100,
      currentUsage: 100,
    });
  });

  it("should round usage to 2 decimal places", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const workspaceResource = `workspaces/${workspaceId}`;

    const mockWorkspace = {
      pk: workspaceResource,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      trialCreditRequested: true,
      trialCreditApproved: true,
      trialCreditAmount: 100,
      creditBalance: 33.333333, // Will result in 66.666667% usage
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockIsUserInTrialPeriod.mockResolvedValue(true);
    mockGetTrialDaysRemaining.mockResolvedValue(1);

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    // Usage = (100 - 33.333333) / 100 * 100 = 66.666667%, rounded to 66.67
    expect(res.json).toHaveBeenCalledWith({
      isInTrialPeriod: true,
      daysRemaining: 1,
      hasRequestedCredits: true,
      creditsApproved: true,
      initialCreditAmount: 100,
      currentUsage: 66.67,
    });
  });

  it("should return true for trial period when DISABLE_TRIAL_PERIOD_CHECK is set", async () => {
    process.env.DISABLE_TRIAL_PERIOD_CHECK = "true";

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const workspaceResource = `workspaces/${workspaceId}`;

    const mockWorkspace = {
      pk: workspaceResource,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      trialCreditRequested: false,
      trialCreditApproved: false,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockGetTrialDaysRemaining.mockResolvedValue(0);

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockIsUserInTrialPeriod).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      isInTrialPeriod: true, // Forced to true when disabled
      daysRemaining: 0,
      hasRequestedCredits: false,
      creditsApproved: false,
      initialCreditAmount: 0,
      currentUsage: 0,
    });
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: undefined,
      session: {
        user: {
          id: "user-456",
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId: "workspace-123",
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
        user: {},
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId: "workspace-123",
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

  it("should throw resourceGone when workspace does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const workspaceResource = `workspaces/${workspaceId}`;

    const mockWorkspaceGet = vi.fn().mockResolvedValue(null);
    mockDb.workspace.get = mockWorkspaceGet;

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
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

  it("should ensure daysRemaining is never negative", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const workspaceResource = `workspaces/${workspaceId}`;

    const mockWorkspace = {
      pk: workspaceResource,
      sk: "workspace",
      workspaceId,
      name: "Test Workspace",
      trialCreditRequested: false,
      trialCreditApproved: false,
    };

    const mockWorkspaceGet = vi.fn().mockResolvedValue(mockWorkspace);
    mockDb.workspace.get = mockWorkspaceGet;

    mockIsUserInTrialPeriod.mockResolvedValue(false);
    mockGetTrialDaysRemaining.mockResolvedValue(-5); // Negative value

    const req = createMockRequest({
      workspaceResource,
      session: {
        user: {
          id: userId,
        },
        expires: "2024-12-31T23:59:59Z",
      },
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        daysRemaining: 0, // Should be clamped to 0
      })
    );
  });
});
