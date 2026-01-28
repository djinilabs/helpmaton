import { describe, it, expect, vi, beforeEach } from "vitest";

import { removeAgentDatabases } from "../agentRemoval";
import { TEMPORAL_GRAINS } from "../types";

const { mockPurge } = vi.hoisted(() => {
  return {
    mockPurge: vi.fn(),
  };
});

vi.mock("../writeClient", () => ({
  purge: mockPurge,
}));

describe("agentRemoval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("removeAgentDatabases", () => {
    it("should schedule purge for all temporal grains", async () => {
      await removeAgentDatabases("agent-123");

      for (const grain of TEMPORAL_GRAINS) {
        expect(mockPurge).toHaveBeenCalledWith("agent-123", grain);
      }
    });

    it("should handle errors gracefully", async () => {
      mockPurge.mockRejectedValueOnce(new Error("Queue error"));

      // Should not throw, but log errors
      await expect(removeAgentDatabases("agent-123")).resolves.not.toThrow();
    });

    it("should handle partial failures", async () => {
      mockPurge
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Queue error"));

      // Should complete even with partial failures
      await expect(removeAgentDatabases("agent-123")).resolves.not.toThrow();
    });
  });
});
