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
    "next-auth": {
      get: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
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
      "next-auth": {
        get: vi.fn(),
        update: vi.fn(),
      },
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

    mockDb["next-auth"].get.mockResolvedValue({
      pk: `USER#${userId}`,
      sk: `USER#${userId}`,
      email: userEmail,
    });

    mockDb["next-auth"].update.mockResolvedValue({});

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
    expect(mockDb["next-auth"].update).toHaveBeenCalledWith(
      expect.objectContaining({
        lastCreditErrorEmailSentAt: expect.any(String),
      })
    );
  });

  it("skips credit error emails when user is rate limited", async () => {
    const oneHourAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    mockDb["next-auth"].get.mockResolvedValue({
      pk: `USER#${userId}`,
      sk: `USER#${userId}`,
      email: userEmail,
      lastCreditErrorEmailSentAt: oneHourAgo,
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
    expect(mockDb["next-auth"].update).not.toHaveBeenCalled();
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
    expect(mockDb["next-auth"].update).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSpendingLimitErrorEmailSentAt: expect.any(String),
      })
    );
  });

  it("sends emails per user with per-type throttling", async () => {
    mockGetWorkspaceOwnerRecipients.mockResolvedValue([
      { userId: "user-1", email: "user1@example.com" },
      { userId: "user-2", email: "user2@example.com" },
    ]);

    mockDb["next-auth"].get.mockImplementation((pk: string) => {
      if (pk === "USER#user-1") {
        return {
          pk,
          sk: pk,
          email: "user1@example.com",
          lastCreditErrorEmailSentAt: new Date(
            Date.now() - 10 * 60 * 1000
          ).toISOString(),
        };
      }
      return {
        pk,
        sk: pk,
        email: "user2@example.com",
      };
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
    mockDb["next-auth"].get.mockResolvedValue(undefined);
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
});
