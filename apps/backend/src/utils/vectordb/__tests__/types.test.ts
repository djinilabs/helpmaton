import { describe, it, expect } from "vitest";

import {
  TEMPORAL_GRAINS,
  type TemporalGrain,
  type FactRecord,
  type QueryOptions,
  type TemporalFilter,
  type WriteOperationMessage,
} from "../types";

describe("types", () => {
  describe("TemporalGrain", () => {
    it("should include all expected grains", () => {
      expect(TEMPORAL_GRAINS).toEqual([
        "daily",
        "weekly",
        "monthly",
        "quarterly",
        "yearly",
      ]);
    });

    it("should have correct type for each grain", () => {
      const grains: TemporalGrain[] = [
        "daily",
        "weekly",
        "monthly",
        "quarterly",
        "yearly",
      ];
      grains.forEach((grain) => {
        expect(TEMPORAL_GRAINS).toContain(grain);
      });
    });
  });

  describe("FactRecord", () => {
    it("should have required fields", () => {
      const record: FactRecord = {
        id: "record-1",
        content: "Test content",
        embedding: [0.1, 0.2, 0.3],
        timestamp: "2024-01-01T00:00:00Z",
      };
      expect(record.id).toBe("record-1");
      expect(record.content).toBe("Test content");
      expect(record.embedding).toEqual([0.1, 0.2, 0.3]);
      expect(record.timestamp).toBe("2024-01-01T00:00:00Z");
    });

    it("should support optional metadata", () => {
      const record: FactRecord = {
        id: "record-1",
        content: "Test content",
        embedding: [0.1, 0.2, 0.3],
        timestamp: "2024-01-01T00:00:00Z",
        metadata: { key: "value" },
      };
      expect(record.metadata).toEqual({ key: "value" });
    });
  });

  describe("QueryOptions", () => {
    it("should support vector search", () => {
      const options: QueryOptions = {
        vector: [0.1, 0.2, 0.3],
        limit: 10,
      };
      expect(options.vector).toEqual([0.1, 0.2, 0.3]);
      expect(options.limit).toBe(10);
    });

    it("should support metadata filter", () => {
      const options: QueryOptions = {
        filter: "metadata.key = 'value'",
      };
      expect(options.filter).toBe("metadata.key = 'value'");
    });

    it("should support temporal filter", () => {
      const temporalFilter: TemporalFilter = {
        startDate: "2024-01-01T00:00:00Z",
        endDate: "2024-01-31T23:59:59Z",
      };
      const options: QueryOptions = {
        temporalFilter,
      };
      expect(options.temporalFilter).toEqual(temporalFilter);
    });
  });

  describe("WriteOperationMessage", () => {
    it("should support insert operation", () => {
      const message: WriteOperationMessage = {
        operation: "insert",
        agentId: "agent-1",
        temporalGrain: "daily",
        data: {
          records: [
            {
              id: "record-1",
              content: "Test",
              embedding: [0.1, 0.2],
              timestamp: "2024-01-01T00:00:00Z",
            },
          ],
        },
      };
      expect(message.operation).toBe("insert");
      expect(message.data.records).toBeDefined();
    });

    it("should support delete operation", () => {
      const message: WriteOperationMessage = {
        operation: "delete",
        agentId: "agent-1",
        temporalGrain: "daily",
        data: {
          recordIds: ["record-1", "record-2"],
        },
      };
      expect(message.operation).toBe("delete");
      expect(message.data.recordIds).toEqual(["record-1", "record-2"]);
    });
  });
});

