import { describe, it, expect, vi } from "vitest";

import {
  getDatabasePath,
  getDatabaseUri,
  getMessageGroupId,
  getAllAgentDatabasePaths,
  getAllAgentDatabaseUris,
} from "../paths";
import { TEMPORAL_GRAINS } from "../types";

// Mock config
vi.mock("../config", () => ({
  getS3BucketName: () => "test-bucket",
}));

describe("paths", () => {
  const agentId = "agent-123";

  describe("getDatabasePath", () => {
    it("should generate correct path for daily grain", () => {
      const path = getDatabasePath(agentId, "daily");
      expect(path).toBe("vectordb/agent-123/daily/");
    });

    it("should generate correct path for weekly grain", () => {
      const path = getDatabasePath(agentId, "weekly");
      expect(path).toBe("vectordb/agent-123/weekly/");
    });

    it("should generate correct path for all temporal grains", () => {
      for (const grain of TEMPORAL_GRAINS) {
        const path = getDatabasePath(agentId, grain);
        expect(path).toBe(`vectordb/${agentId}/${grain}/`);
      }
    });
  });

  describe("getDatabaseUri", () => {
    it("should generate correct S3 URI", () => {
      const uri = getDatabaseUri(agentId, "daily");
      expect(uri).toBe("s3://test-bucket/vectordb/agent-123/daily/");
    });

    it("should include bucket name from config", () => {
      const uri = getDatabaseUri(agentId, "monthly");
      expect(uri).toContain("s3://test-bucket/");
      expect(uri).toContain("vectordb/agent-123/monthly/");
    });
  });

  describe("getMessageGroupId", () => {
    it("should generate correct message group ID", () => {
      const groupId = getMessageGroupId(agentId, "daily");
      expect(groupId).toBe("agent-123-daily");
    });

    it("should generate unique group IDs for different grains", () => {
      const dailyId = getMessageGroupId(agentId, "daily");
      const weeklyId = getMessageGroupId(agentId, "weekly");
      expect(dailyId).not.toBe(weeklyId);
      expect(dailyId).toBe("agent-123-daily");
      expect(weeklyId).toBe("agent-123-weekly");
    });
  });

  describe("getAllAgentDatabasePaths", () => {
    it("should return paths for all temporal grains", () => {
      const paths = getAllAgentDatabasePaths(agentId);
      expect(paths).toHaveLength(TEMPORAL_GRAINS.length);
      expect(paths).toEqual([
        "vectordb/agent-123/working/",
        "vectordb/agent-123/daily/",
        "vectordb/agent-123/weekly/",
        "vectordb/agent-123/monthly/",
        "vectordb/agent-123/quarterly/",
        "vectordb/agent-123/yearly/",
      ]);
    });
  });

  describe("getAllAgentDatabaseUris", () => {
    it("should return URIs for all temporal grains", () => {
      const uris = getAllAgentDatabaseUris(agentId);
      expect(uris).toHaveLength(TEMPORAL_GRAINS.length);
      uris.forEach((uri, index) => {
        expect(uri).toBe(
          `s3://test-bucket/vectordb/${agentId}/${TEMPORAL_GRAINS[index]}/`
        );
      });
    });
  });
});
