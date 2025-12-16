import { describe, it, expect, vi, beforeEach } from "vitest";

import { getS3Client } from "../../s3";
import { removeAgentDatabases } from "../agentRemoval";
import { getS3BucketName } from "../config";
import { getAllAgentDatabasePaths } from "../paths";

// Mock dependencies
vi.mock("../paths", () => ({
  getAllAgentDatabasePaths: vi.fn(() => [
    "vectordb/agent-123/daily/",
    "vectordb/agent-123/weekly/",
  ]),
  getS3BucketName: vi.fn(() => "test-bucket"),
}));

vi.mock("../config", () => ({
  getS3BucketName: vi.fn(() => "test-bucket"),
}));

vi.mock("../../s3", () => ({
  getS3Client: vi.fn(),
}));

describe("agentRemoval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("removeAgentDatabases", () => {
    it("should attempt to remove all database paths for an agent", async () => {
      const mockS3Client = {
        DeleteObject: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(getS3Client).mockResolvedValue(mockS3Client as unknown as Awaited<ReturnType<typeof getS3Client>>);

      await removeAgentDatabases("agent-123");

      expect(getAllAgentDatabasePaths).toHaveBeenCalledWith("agent-123");
      expect(getS3BucketName).toHaveBeenCalled();
    });

    it("should handle errors gracefully", async () => {
      const mockS3Client = {
        DeleteObject: vi.fn().mockRejectedValue(new Error("S3 error")),
      };

      vi.mocked(getS3Client).mockResolvedValue(mockS3Client as unknown as Awaited<ReturnType<typeof getS3Client>>);

      // Should not throw, but log errors
      await expect(removeAgentDatabases("agent-123")).resolves.not.toThrow();
    });

    it("should handle partial failures", async () => {
      const mockS3Client = {
        DeleteObject: vi.fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error("S3 error")),
      };

      vi.mocked(getS3Client).mockResolvedValue(mockS3Client as unknown as Awaited<ReturnType<typeof getS3Client>>);

      // Should complete even with partial failures
      await expect(removeAgentDatabases("agent-123")).resolves.not.toThrow();
    });

    it("should process all temporal grains", async () => {
      const mockS3Client = {
        DeleteObject: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(getS3Client).mockResolvedValue(mockS3Client as unknown as Awaited<ReturnType<typeof getS3Client>>);
      vi.mocked(getAllAgentDatabasePaths).mockReturnValue([
        "vectordb/agent-123/daily/",
        "vectordb/agent-123/weekly/",
        "vectordb/agent-123/monthly/",
        "vectordb/agent-123/quarterly/",
        "vectordb/agent-123/yearly/",
      ]);

      await removeAgentDatabases("agent-123");

      expect(getAllAgentDatabasePaths).toHaveBeenCalledWith("agent-123");
    });
  });
});

