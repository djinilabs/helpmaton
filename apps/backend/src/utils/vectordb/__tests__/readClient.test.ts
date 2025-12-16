import { describe, it, expect, vi, beforeEach } from "vitest";

import { query, connectionCache } from "../readClient";
import type { QueryOptions, QueryResult } from "../types";

// Mock @lancedb/lancedb
vi.mock("@lancedb/lancedb", () => ({
  connect: vi.fn(),
}));

// Mock paths
vi.mock("../paths", () => ({
  getDatabaseUri: vi.fn((agentId: string, grain: string) =>
    `s3://bucket/vectordb/${agentId}/${grain}/`
  ),
}));

// Mock config
vi.mock("../config", () => ({
  DEFAULT_QUERY_LIMIT: 100,
  MAX_QUERY_LIMIT: 1000,
  DEFAULT_S3_REGION: "eu-west-2",
}));

describe("readClient", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Clear the connection cache
    connectionCache.clear();

    const { connect } = await import("@lancedb/lancedb");
    const mockConnect = vi.mocked(connect);

    // Setup default mocks
    const mockToArray = vi.fn().mockResolvedValue([]);
    const mockLimit = vi.fn().mockReturnValue({
      toArray: mockToArray,
    });
    const mockWhere = vi.fn().mockReturnValue({
      limit: mockLimit,
    });
    const mockNearestTo = vi.fn().mockReturnValue({
      where: mockWhere,
      limit: mockLimit,
    });
    const mockQuery = vi.fn().mockReturnValue({
      nearestTo: mockNearestTo,
      where: mockWhere,
      limit: mockLimit,
    });
    const mockOpenTable = vi.fn().mockResolvedValue({
      query: mockQuery,
    });

    mockConnect.mockResolvedValue({
      openTable: mockOpenTable,
      createTable: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof connect>>);
  });

  describe("query", () => {
    const agentId = "agent-123";
    const temporalGrain = "daily" as const;

    it("should query database with default options", async () => {
      const { connect } = await import("@lancedb/lancedb");
      const mockConnect = vi.mocked(connect);

      const mockResults = [
        {
          id: "record-1",
          content: "Test",
          vector: [0.1, 0.2],
          timestamp: "2024-01-01T00:00:00Z",
        },
      ];

      const mockToArray = vi.fn().mockResolvedValue(mockResults);
      const mockLimit = vi.fn().mockReturnValue({
        toArray: mockToArray,
      });
      const mockQueryBuilder = vi.fn().mockReturnValue({
        limit: mockLimit,
      });
      const mockOpenTable = vi.fn().mockResolvedValue({
        query: mockQueryBuilder,
      });

      mockConnect.mockResolvedValue({
        openTable: mockOpenTable,
      } as unknown as Awaited<ReturnType<typeof connect>>);

      const results = await query(agentId, temporalGrain);

      expect(mockConnect).toHaveBeenCalled();
      expect(mockOpenTable).toHaveBeenCalledWith("vectors");
      expect(mockQueryBuilder).toHaveBeenCalled();
      expect(mockLimit).toHaveBeenCalledWith(100);
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe("record-1");
    });

    it("should apply vector similarity search", async () => {
      const { connect } = await import("@lancedb/lancedb");
      const mockConnect = vi.mocked(connect);

      const vector = [0.1, 0.2, 0.3];
      const options: QueryOptions = { vector };

      const mockToArray = vi.fn().mockResolvedValue([]);
      const mockLimit = vi.fn().mockReturnValue({
        toArray: mockToArray,
      });
      const mockNearestTo = vi.fn().mockReturnValue({
        limit: mockLimit,
      });
      const mockQueryBuilder = vi.fn().mockReturnValue({
        nearestTo: mockNearestTo,
      });
      const mockOpenTable = vi.fn().mockResolvedValue({
        query: mockQueryBuilder,
      });

      mockConnect.mockResolvedValue({
        openTable: mockOpenTable,
      } as unknown as Awaited<ReturnType<typeof connect>>);

      await query(agentId, temporalGrain, options);

      expect(mockNearestTo).toHaveBeenCalledWith(vector);
    });

    it("should apply metadata filter", async () => {
      const { connect } = await import("@lancedb/lancedb");
      const mockConnect = vi.mocked(connect);

      const filter = "metadata.key = 'value'";
      const options: QueryOptions = { filter };

      const mockToArray = vi.fn().mockResolvedValue([]);
      const mockLimit = vi.fn().mockReturnValue({
        toArray: mockToArray,
      });
      const mockWhere = vi.fn().mockReturnValue({
        limit: mockLimit,
      });
      const mockQueryBuilder = vi.fn().mockReturnValue({
        where: mockWhere,
      });
      const mockOpenTable = vi.fn().mockResolvedValue({
        query: mockQueryBuilder,
      });

      mockConnect.mockResolvedValue({
        openTable: mockOpenTable,
      } as unknown as Awaited<ReturnType<typeof connect>>);

      await query(agentId, temporalGrain, options);

      expect(mockWhere).toHaveBeenCalledWith(filter);
    });

    it("should apply custom limit", async () => {
      const { connect } = await import("@lancedb/lancedb");
      const mockConnect = vi.mocked(connect);

      const options: QueryOptions = { limit: 50 };

      const mockToArray = vi.fn().mockResolvedValue([]);
      const mockLimit = vi.fn().mockReturnValue({
        toArray: mockToArray,
      });
      const mockQueryBuilder = vi.fn().mockReturnValue({
        limit: mockLimit,
      });
      const mockOpenTable = vi.fn().mockResolvedValue({
        query: mockQueryBuilder,
      });

      mockConnect.mockResolvedValue({
        openTable: mockOpenTable,
      } as unknown as Awaited<ReturnType<typeof connect>>);

      await query(agentId, temporalGrain, options);

      expect(mockLimit).toHaveBeenCalledWith(50);
    });

    it("should enforce max query limit", async () => {
      const { connect } = await import("@lancedb/lancedb");
      const mockConnect = vi.mocked(connect);

      const options: QueryOptions = { limit: 2000 };

      const mockToArray = vi.fn().mockResolvedValue([]);
      const mockLimit = vi.fn().mockReturnValue({
        toArray: mockToArray,
      });
      const mockQueryBuilder = vi.fn().mockReturnValue({
        limit: mockLimit,
      });
      const mockOpenTable = vi.fn().mockResolvedValue({
        query: mockQueryBuilder,
      });

      mockConnect.mockResolvedValue({
        openTable: mockOpenTable,
      } as unknown as Awaited<ReturnType<typeof connect>>);

      await query(agentId, temporalGrain, options);

      expect(mockLimit).toHaveBeenCalledWith(1000);
    });

    it("should enforce min query limit", async () => {
      const { connect } = await import("@lancedb/lancedb");
      const mockConnect = vi.mocked(connect);

      const options: QueryOptions = { limit: 0 };

      const mockToArray = vi.fn().mockResolvedValue([]);
      const mockLimit = vi.fn().mockReturnValue({
        toArray: mockToArray,
      });
      const mockQueryBuilder = vi.fn().mockReturnValue({
        limit: mockLimit,
      });
      const mockOpenTable = vi.fn().mockResolvedValue({
        query: mockQueryBuilder,
      });

      mockConnect.mockResolvedValue({
        openTable: mockOpenTable,
      } as unknown as Awaited<ReturnType<typeof connect>>);

      await query(agentId, temporalGrain, options);

      expect(mockLimit).toHaveBeenCalledWith(1);
    });

    it("should apply temporal filter", async () => {
      const { connect } = await import("@lancedb/lancedb");
      const mockConnect = vi.mocked(connect);

      const mockResults = [
        {
          id: "record-1",
          content: "Test 1",
          vector: [0.1, 0.2],
          timestamp: "2024-01-15T00:00:00Z",
        },
        {
          id: "record-2",
          content: "Test 2",
          vector: [0.3, 0.4],
          timestamp: "2024-01-20T00:00:00Z",
        },
        {
          id: "record-3",
          content: "Test 3",
          vector: [0.5, 0.6],
          timestamp: "2024-02-01T00:00:00Z",
        },
      ];

      const mockToArray = vi.fn().mockResolvedValue(mockResults);
      const mockLimit = vi.fn().mockReturnValue({
        toArray: mockToArray,
      });
      const mockQueryBuilder = vi.fn().mockReturnValue({
        limit: mockLimit,
      });
      const mockOpenTable = vi.fn().mockResolvedValue({
        query: mockQueryBuilder,
      });

      mockConnect.mockResolvedValue({
        openTable: mockOpenTable,
      } as unknown as Awaited<ReturnType<typeof connect>>);

      const options: QueryOptions = {
        temporalFilter: {
          startDate: "2024-01-10T00:00:00Z",
          endDate: "2024-01-25T00:00:00Z",
        },
      };

      const filteredResults = await query(agentId, temporalGrain, options);

      expect(filteredResults).toHaveLength(2);
      expect(filteredResults.map((r) => r.id)).toEqual(["record-1", "record-2"]);
    });

    it("should handle table not found gracefully", async () => {
      const { connect } = await import("@lancedb/lancedb");
      const mockConnect = vi.mocked(connect);

      const mockOpenTable = vi.fn().mockRejectedValue(new Error("Table not found"));

      mockConnect.mockResolvedValue({
        openTable: mockOpenTable,
        createTable: vi.fn(),
      } as unknown as Awaited<ReturnType<typeof connect>>);

      const results = await query(agentId, temporalGrain);

      expect(results).toEqual([]);
    });

    it("should cache connections per database", async () => {
      const { connect } = await import("@lancedb/lancedb");
      const mockConnect = vi.mocked(connect);

      const mockToArray = vi.fn().mockResolvedValue([]);
      const mockLimit = vi.fn().mockReturnValue({
        toArray: mockToArray,
      });
      const mockQueryBuilder = vi.fn().mockReturnValue({
        limit: mockLimit,
      });
      const mockOpenTable = vi.fn().mockResolvedValue({
        query: mockQueryBuilder,
      });

      mockConnect.mockResolvedValue({
        openTable: mockOpenTable,
        createTable: vi.fn(),
      } as unknown as Awaited<ReturnType<typeof connect>>);

      await query(agentId, temporalGrain);
      await query(agentId, temporalGrain);

      // Should only connect once per database (cached)
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it("should handle connection errors", async () => {
      const { connect } = await import("@lancedb/lancedb");
      const mockConnect = vi.mocked(connect);

      // Clear cache to ensure fresh connection attempt
      connectionCache.clear();

      const error = new Error("Connection failed");
      mockConnect.mockReset();
      mockConnect.mockRejectedValue(error);

      await expect(query(agentId, temporalGrain)).rejects.toThrow(
        "Vector database query failed"
      );
    });
  });
});
