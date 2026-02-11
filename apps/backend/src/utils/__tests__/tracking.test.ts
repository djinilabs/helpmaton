import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCapture = vi.fn();
const mockIdentify = vi.fn();
const mockGetCurrentRequestDistinctId = vi.fn();

vi.mock("../posthog", () => ({
  getPostHogClient: () => ({
    capture: mockCapture,
    groupIdentify: vi.fn(),
  }),
  identifyUser: (...args: unknown[]) => mockIdentify(...args),
  identifyWorkspaceGroup: vi.fn(),
  getCurrentRequestDistinctId: () => mockGetCurrentRequestDistinctId(),
}));

import {
  ensurePostHogIdentityFromRequest,
  trackEvent,
  type RequestWithUser,
} from "../tracking";

describe("tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentRequestDistinctId.mockReturnValue(null);
  });

  describe("ensurePostHogIdentityFromRequest", () => {
    it("calls identifyUser when req has userRef and session email", () => {
      const req: RequestWithUser = {
        userRef: "users/uid-1",
        session: { user: { id: "uid-1", email: "u@example.com" } },
      };
      ensurePostHogIdentityFromRequest(req);
      expect(mockIdentify).toHaveBeenCalledTimes(1);
      expect(mockIdentify).toHaveBeenCalledWith("uid-1", { email: "u@example.com" });
    });

    it("calls identifyUser with undefined properties when req has userRef but no email", () => {
      const req: RequestWithUser = {
        userRef: "users/uid-2",
        session: { user: { id: "uid-2" } },
      };
      ensurePostHogIdentityFromRequest(req);
      expect(mockIdentify).toHaveBeenCalledTimes(1);
      expect(mockIdentify).toHaveBeenCalledWith("uid-2", undefined);
    });

    it("does not call identifyUser when req has no userRef or session user", () => {
      ensurePostHogIdentityFromRequest({});
      ensurePostHogIdentityFromRequest({ session: {} });
      ensurePostHogIdentityFromRequest({ session: { user: {} } });
      expect(mockIdentify).not.toHaveBeenCalled();
    });

    it("uses session.user.id when userRef is missing", () => {
      const req: RequestWithUser = {
        session: { user: { id: "uid-3", email: "three@example.com" } },
      };
      ensurePostHogIdentityFromRequest(req);
      expect(mockIdentify).toHaveBeenCalledWith("uid-3", {
        email: "three@example.com",
      });
    });
  });

  describe("trackEvent", () => {
    it("uses getCurrentRequestDistinctId when no req and no properties.user_id", () => {
      mockGetCurrentRequestDistinctId.mockReturnValue("user/uid-ctx");
      trackEvent("test_event", { workspace_id: "ws-1" });
      expect(mockCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          distinctId: "user/uid-ctx",
          event: "test_event",
          properties: expect.objectContaining({
            workspace_id: "ws-1",
            user_id: "uid-ctx",
          }),
        })
      );
    });

    it("uses distinctId system when no req, no user_id, and getCurrentRequestDistinctId returns null", () => {
      mockGetCurrentRequestDistinctId.mockReturnValue(null);
      trackEvent("system_event", {});
      expect(mockCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          distinctId: "system",
          event: "system_event",
        })
      );
    });

    it("does not call identifyUser when req is passed and context already set to same user", () => {
      mockGetCurrentRequestDistinctId.mockReturnValue("user/uid-same");
      const req: RequestWithUser = {
        userRef: "users/uid-same",
        session: { user: { id: "uid-same", email: "same@example.com" } },
      };
      trackEvent("e", {}, req);
      expect(mockIdentify).not.toHaveBeenCalled();
      expect(mockCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          distinctId: "user/uid-same",
          properties: expect.objectContaining({ user_id: "uid-same" }),
        })
      );
    });

    it("calls identifyUser when req is passed and context is not set for that user", () => {
      mockGetCurrentRequestDistinctId.mockReturnValue(null);
      const req: RequestWithUser = {
        userRef: "users/uid-req",
        session: { user: { id: "uid-req", email: "req@example.com" } },
      };
      trackEvent("e", {}, req);
      expect(mockIdentify).toHaveBeenCalledWith("uid-req", {
        email: "req@example.com",
      });
      expect(mockCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          distinctId: "user/uid-req",
          properties: expect.objectContaining({ user_id: "uid-req" }),
        })
      );
    });
  });
});
