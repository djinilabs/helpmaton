/**
 * Unit tests for Agent Error Notifications
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendAgentErrorNotification } from "../agentErrorNotifications";
import {
  InsufficientCreditsError,
  SpendingLimitExceededError,
} from "../creditErrors";

const {
  mockDatabase,
  mockSendEmail,
  mockGetWorkspaceOwnerRecipients,
} = vi.hoisted(() => {
  const database = vi.fn();
  const sendEmail = vi.fn();
  const getWorkspaceOwnerRecipients = vi.fn();
  return {
    mockDatabase: database,
    mockSendEmail: sendEmail,
    mockGetWorkspaceOwnerRecipients: getWorkspaceOwnerRecipients,
  };
});

vi.mock("../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../send-email", () => ({
  sendEmail: mockSendEmail,
}));

vi.mock("../creditAdminNotifications", () => ({
  getWorkspaceOwnerRecipients: mockGetWorkspaceOwnerRecipients,
}));

describe("sendAgentErrorNotification", () => {
  const workspaceId = "test-workspace-id";
  const workspaceName = "Test Workspace";
  const userId = "test-user-id";
  const userEmail = "test@example.com";
  const agentId = "agent-123";

  let mockDb: {
    workspace: {
      get: ReturnType<typeof vi.fn>;
    };
    agent: {
      get: ReturnType<typeof vi.fn>;
    };
    atomicUpdate: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      workspace: {
        get: vi.fn(),
      },
      agent: {
        get: vi.fn(),
      },
      atomicUpdate: vi.fn(),
    };

    mockDatabase.mockResolvedValue(mockDb as never);

    mockDb.workspace.get.mockResolvedValue({
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: workspaceName,
      currency: "usd",
    });

    mockDb.agent.get.mockResolvedValue({
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      name: "Agent One",
      workspaceId,
    });

    mockDb.atomicUpdate.mockImplementation(async (_spec, callback) => {
      const fetched = new Map([
        [
          "user",
          {
            pk: `USER#${userId}`,
            sk: `USER#${userId}`,
            email: userEmail,
          },
        ],
      ]);
      return callback(fetched);
    });

    mockGetWorkspaceOwnerRecipients.mockResolvedValue([
      { userId, email: userEmail },
    ]);

    mockSendEmail.mockResolvedValue({});
  });

  it("sends credit error emails to workspace owners", async () => {
    const error = new InsufficientCreditsError(
      workspaceId,
      1_000_000_000,
      500_000_000,
      "usd",
      agentId
    );

    await sendAgentErrorNotification(workspaceId, "credit", error);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: userEmail,
        subject: `Insufficient Credits - ${workspaceName}`,
      })
    );
    expect(mockDb.atomicUpdate).toHaveBeenCalledTimes(1);
  });

  it("skips credit error emails when user is rate limited", async () => {
    const oneHourAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    mockDb.atomicUpdate.mockImplementation(async (_spec, callback) => {
      const fetched = new Map([
        [
          "user",
          {
            pk: `USER#${userId}`,
            sk: `USER#${userId}`,
            email: userEmail,
            lastCreditErrorEmailSentAt: oneHourAgo,
          },
        ],
      ]);
      return callback(fetched);
    });

    const error = new InsufficientCreditsError(
      workspaceId,
      1_000_000_000,
      500_000_000,
      "usd",
      agentId
    );

    await sendAgentErrorNotification(workspaceId, "credit", error);

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockDb.atomicUpdate).toHaveBeenCalledTimes(1);
  });

  it("sends spending limit emails to workspace owners", async () => {
    const error = new SpendingLimitExceededError(
      workspaceId,
      [
        {
          scope: "workspace",
          timeFrame: "daily",
          limit: 1000,
          current: 1500,
        },
      ],
      agentId
    );

    await sendAgentErrorNotification(workspaceId, "spendingLimit", error);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: userEmail,
        subject: `Spending Limit Reached - ${workspaceName}`,
      })
    );
    expect(mockDb.atomicUpdate).toHaveBeenCalledTimes(1);
  });

  it("sends emails per user with per-type throttling", async () => {
    mockGetWorkspaceOwnerRecipients.mockResolvedValue([
      { userId: "user-1", email: "user1@example.com" },
      { userId: "user-2", email: "user2@example.com" },
    ]);

    mockDb.atomicUpdate.mockImplementation(async (spec, callback) => {
      const userSpec = (spec as Map<string, { pk: string }>).get("user");
      const pk = userSpec?.pk || "";
      const record =
        pk === "USER#user-1"
          ? {
              pk,
              sk: pk,
              email: "user1@example.com",
              lastCreditErrorEmailSentAt: new Date(
                Date.now() - 10 * 60 * 1000
              ).toISOString(),
            }
          : {
              pk,
              sk: pk,
              email: "user2@example.com",
            };
      const fetched = new Map([["user", record]]);
      return callback(fetched);
    });

    const error = new InsufficientCreditsError(
      workspaceId,
      1_000_000_000,
      500_000_000,
      "usd",
      agentId
    );

    await sendAgentErrorNotification(workspaceId, "credit", error);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user2@example.com",
      })
    );
    expect(mockDb.atomicUpdate).toHaveBeenCalledTimes(2);
  });

  it("does not throw when email sending fails", async () => {
    mockSendEmail.mockRejectedValue(new Error("Email sending failed"));
    const error = new InsufficientCreditsError(
      workspaceId,
      1000000,
      500000,
      "usd",
      agentId
    );

    await expect(
      sendAgentErrorNotification(workspaceId, "credit", error)
    ).resolves.not.toThrow();
  });

  it("handles missing workspace gracefully", async () => {
    mockDb.workspace.get.mockResolvedValue(undefined);
    const error = new InsufficientCreditsError(
      workspaceId,
      1000000,
      500000,
      "usd",
      agentId
    );

    await expect(
      sendAgentErrorNotification(workspaceId, "credit", error)
    ).resolves.not.toThrow();

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("skips users without a rate-limit record", async () => {
    mockDb.atomicUpdate.mockImplementation(async (_spec, callback) => {
      const fetched = new Map([["user", undefined]]);
      return callback(fetched);
    });
    const error = new InsufficientCreditsError(
      workspaceId,
      1000000,
      500000,
      "usd",
      agentId
    );

    await sendAgentErrorNotification(workspaceId, "credit", error);

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("skips email and does not throw when atomicUpdate fails with ConditionalCheckFailed (concurrent update)", async () => {
    const transactionError = new Error(
      "@aws-lite/client: DynamoDB.TransactWriteItems: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed]"
    );
    transactionError.name = "TransactionCanceledException";
    mockDb.atomicUpdate.mockRejectedValue(transactionError);

    const error = new InsufficientCreditsError(
      workspaceId,
      1000000,
      500000,
      "usd",
      agentId
    );

    await expect(
      sendAgentErrorNotification(workspaceId, "credit", error)
    ).resolves.not.toThrow();

    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
