import { describe, it, expect, vi, beforeEach } from "vitest";

import { toNanoDollars } from "../creditConversions";
import {
  createWorkspaceRecord,
  INITIAL_WORKSPACE_CREDITS_USD,
  WORKSPACE_CREATED_EVENT,
} from "../workspaceCreate";

const { mockTrackEvent } = vi.hoisted(() => ({ mockTrackEvent: vi.fn() }));

vi.mock("../tracking", () => ({
  trackEvent: mockTrackEvent,
}));

describe("workspaceCreate", () => {
  const mockWorkspaceCreate = vi.fn();

  const mockDb = {
    workspace: {
      create: mockWorkspaceCreate,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createWorkspaceRecord", () => {
    it("always credits new workspace with 2 USD", async () => {
      const created = {
        pk: "workspaces/ws-1",
        sk: "workspace",
        name: "Test",
        currency: "usd",
        creditBalance: toNanoDollars(INITIAL_WORKSPACE_CREDITS_USD),
        version: 1,
        createdAt: "2024-01-01T00:00:00Z",
      };
      mockWorkspaceCreate.mockResolvedValue(created);

      await createWorkspaceRecord(mockDb as never, {
        pk: "workspaces/ws-1",
        sk: "workspace",
        name: "Test",
        createdBy: "users/u1",
        subscriptionId: "sub-1",
      });

      expect(mockWorkspaceCreate).toHaveBeenCalledTimes(1);
      expect(mockWorkspaceCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          creditBalance: toNanoDollars(2),
        })
      );
    });

    it("passes through optional spendingLimits and creationNotes", async () => {
      mockWorkspaceCreate.mockResolvedValue({});

      await createWorkspaceRecord(mockDb as never, {
        pk: "workspaces/ws-2",
        sk: "workspace",
        name: "Imported",
        createdBy: "users/u2",
        subscriptionId: "sub-2",
        spendingLimits: [{ timeFrame: "daily", amount: 1_000_000_000 }],
        creationNotes: "Onboarding summary",
      });

      expect(mockWorkspaceCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          spendingLimits: [{ timeFrame: "daily", amount: 1_000_000_000 }],
          creationNotes: "Onboarding summary",
          creditBalance: toNanoDollars(2),
        })
      );
    });

    it("sends workspace_created PostHog event with workspace_id and user_id", async () => {
      mockWorkspaceCreate.mockResolvedValue({});

      await createWorkspaceRecord(mockDb as never, {
        pk: "workspaces/ws-3",
        sk: "workspace",
        name: "Analytics Test",
        createdBy: "users/creator-99",
        subscriptionId: "sub-3",
      });

      expect(mockTrackEvent).toHaveBeenCalledTimes(1);
      expect(mockTrackEvent).toHaveBeenCalledWith(
        WORKSPACE_CREATED_EVENT,
        expect.objectContaining({
          workspace_id: "ws-3",
          user_id: "creator-99",
        })
      );
    });

    it("extracts ids correctly when pk/createdBy have standard prefixes", async () => {
      mockWorkspaceCreate.mockResolvedValue({});

      await createWorkspaceRecord(mockDb as never, {
        pk: "workspaces/abc-123",
        sk: "workspace",
        name: "Prefixed",
        createdBy: "users/user-456",
        subscriptionId: "sub-4",
      });

      expect(mockTrackEvent).toHaveBeenCalledWith(
        WORKSPACE_CREATED_EVENT,
        expect.objectContaining({
          workspace_id: "abc-123",
          user_id: "user-456",
        })
      );
    });
  });
});
