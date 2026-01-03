import { describe, expect, it, vi, beforeEach } from "vitest";

import { authenticateStreamRequest } from "../streamAuthentication";

import { createAPIGatewayEventV2 } from "./test-helpers";

// Mock dependencies
vi.mock("../../../tables/permissions", () => ({
  isUserAuthorized: vi.fn(),
}));

vi.mock("../../../utils/streamServerUtils", () => ({
  validateSecret: vi.fn(),
}));

vi.mock("../../../utils/tokenUtils", () => ({
  verifyAccessToken: vi.fn(),
}));

describe("streamAuthentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("authenticateStreamRequest", () => {
    describe("test endpoint", () => {
      it("should authenticate with valid JWT token", async () => {
        const { verifyAccessToken } = await import("../../../utils/tokenUtils");
        const { isUserAuthorized } = await import("../../../tables/permissions");

        vi.mocked(verifyAccessToken).mockResolvedValue({
          userId: "user123",
        } as Awaited<ReturnType<typeof verifyAccessToken>>);
        vi.mocked(isUserAuthorized).mockResolvedValue([true, "users/user123", 1]);

        const event = createAPIGatewayEventV2({
          headers: {
            authorization: "Bearer valid-token",
          },
        });

        const result = await authenticateStreamRequest(
          "test",
          event,
          "workspace123",
          "agent456"
        );

        expect(result).toEqual({
          authenticated: true,
          userId: "user123",
        });
        expect(verifyAccessToken).toHaveBeenCalledWith("valid-token");
        expect(isUserAuthorized).toHaveBeenCalledWith(
          "users/user123",
          "workspaces/workspace123",
          1
        );
      });

      it("should throw unauthorized when Authorization header is missing", async () => {
        const event = createAPIGatewayEventV2({
          headers: {},
        });

        await expect(
          authenticateStreamRequest("test", event, "workspace123", "agent456")
        ).rejects.toThrow("Missing or invalid Authorization header");
      });

      it("should throw unauthorized when Authorization header doesn't start with Bearer", async () => {
        const event = createAPIGatewayEventV2({
          headers: {
            authorization: "Invalid token",
          },
        });

        await expect(
          authenticateStreamRequest("test", event, "workspace123", "agent456")
        ).rejects.toThrow("Missing or invalid Authorization header");
      });

      it("should throw forbidden when user lacks workspace access", async () => {
        const { verifyAccessToken } = await import("../../../utils/tokenUtils");
        const { isUserAuthorized } = await import("../../../tables/permissions");

        vi.mocked(verifyAccessToken).mockResolvedValue({
          userId: "user123",
        } as Awaited<ReturnType<typeof verifyAccessToken>>);
        vi.mocked(isUserAuthorized).mockResolvedValue([false] as const);

        const event = createAPIGatewayEventV2({
          headers: {
            authorization: "Bearer valid-token",
          },
        });

        await expect(
          authenticateStreamRequest("test", event, "workspace123", "agent456")
        ).rejects.toThrow("Insufficient permissions to access this workspace");
      });
    });

    describe("stream endpoint", () => {
      it("should authenticate with valid secret", async () => {
        const { validateSecret } = await import("../../../utils/streamServerUtils");

        vi.mocked(validateSecret).mockResolvedValue(true);

        const event = createAPIGatewayEventV2();
        const result = await authenticateStreamRequest(
          "stream",
          event,
          "workspace123",
          "agent456",
          "valid-secret"
        );

        expect(result).toEqual({
          authenticated: true,
        });
        expect(validateSecret).toHaveBeenCalledWith(
          "workspace123",
          "agent456",
          "valid-secret"
        );
      });

      it("should throw unauthorized when secret is missing", async () => {
        const event = createAPIGatewayEventV2();

        await expect(
          authenticateStreamRequest("stream", event, "workspace123", "agent456")
        ).rejects.toThrow("Missing secret");
      });

      it("should throw unauthorized when secret is invalid", async () => {
        const { validateSecret } = await import("../../../utils/streamServerUtils");

        vi.mocked(validateSecret).mockResolvedValue(false);

        const event = createAPIGatewayEventV2();
        await expect(
          authenticateStreamRequest(
            "stream",
            event,
            "workspace123",
            "agent456",
            "invalid-secret"
          )
        ).rejects.toThrow("Invalid secret");
      });
    });
  });
});

