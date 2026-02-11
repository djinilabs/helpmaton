import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTrackEvent = vi.fn();
const mockBaseCreateUser = vi.fn();

vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    name: vi.fn().mockResolvedValue("next-auth"),
    _doc: {},
  }),
}));

vi.mock("@auth/dynamodb-adapter", () => ({
  DynamoDBAdapter: vi.fn(() => ({
    createUser: mockBaseCreateUser,
  })),
}));

vi.mock("../tracking", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

import { getDynamoDBAdapter } from "../authUtils";

describe("authUtils", () => {
  describe("getDynamoDBAdapter", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockBaseCreateUser.mockResolvedValue({
        id: "created-user-id",
        email: "newuser@example.com",
        emailVerified: null,
        name: null,
        image: null,
      });
    });

    it("sends user_signed_up to PostHog when createUser is called", async () => {
      const adapter = await getDynamoDBAdapter();
      const user = { email: "newuser@example.com" };

      const createdUser = await adapter.createUser!(user as never);

      expect(createdUser).toBeDefined();
      expect(createdUser.id).toBe("created-user-id");
      expect(createdUser.email).toBe("newuser@example.com");
      expect(mockTrackEvent).toHaveBeenCalledTimes(1);
      expect(mockTrackEvent).toHaveBeenCalledWith("user_signed_up", {
        user_id: "created-user-id",
        user_email: "newuser@example.com",
      });
    });

    it("sends user_signed_up with undefined email when created user has no email", async () => {
      mockBaseCreateUser.mockResolvedValueOnce({
        id: "no-email-user-id",
        email: null,
        emailVerified: null,
        name: null,
        image: null,
      });
      const adapter = await getDynamoDBAdapter();

      await adapter.createUser!({} as never);

      expect(mockTrackEvent).toHaveBeenCalledWith("user_signed_up", {
        user_id: "no-email-user-id",
        user_email: undefined,
      });
    });

    it("returns created user and does not throw when trackEvent throws", async () => {
      mockTrackEvent.mockImplementationOnce(() => {
        throw new Error("PostHog unavailable");
      });
      const adapter = await getDynamoDBAdapter();

      const createdUser = await adapter.createUser!({
        email: "resilient@example.com",
      } as never);

      expect(createdUser).toBeDefined();
      expect(createdUser.id).toBe("created-user-id");
      expect(createdUser.email).toBe("newuser@example.com");
      expect(mockTrackEvent).toHaveBeenCalledTimes(1);
    });
  });
});
