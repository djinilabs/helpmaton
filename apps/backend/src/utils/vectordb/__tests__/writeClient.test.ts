import { describe, it, expect, vi, beforeEach } from "vitest";

import { sendWriteOperation } from "../queueClient";
import type { FactRecord } from "../types";
import { insert, update, remove, delete as deleteOp } from "../writeClient";

// Mock queueClient
vi.mock("../queueClient", () => ({
  sendWriteOperation: vi.fn(),
}));

describe("writeClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const agentId = "agent-123";
  const temporalGrain = "daily" as const;

  describe("insert", () => {
    it("should send insert operation for records", async () => {
      const records: FactRecord[] = [
        {
          id: "record-1",
          content: "Test content",
          embedding: [0.1, 0.2, 0.3],
          timestamp: "2024-01-01T00:00:00Z",
        },
      ];

      vi.mocked(sendWriteOperation).mockResolvedValue(undefined);

      await insert(agentId, temporalGrain, records);

      expect(sendWriteOperation).toHaveBeenCalledWith({
        operation: "insert",
        agentId,
        temporalGrain,
        data: { records },
      });
    });

    it("should not send operation for empty records", async () => {
      await insert(agentId, temporalGrain, []);

      expect(sendWriteOperation).not.toHaveBeenCalled();
    });

    it("should handle multiple records", async () => {
      const records: FactRecord[] = [
        {
          id: "record-1",
          content: "Test 1",
          embedding: [0.1, 0.2],
          timestamp: "2024-01-01T00:00:00Z",
        },
        {
          id: "record-2",
          content: "Test 2",
          embedding: [0.3, 0.4],
          timestamp: "2024-01-02T00:00:00Z",
        },
      ];

      vi.mocked(sendWriteOperation).mockResolvedValue(undefined);

      await insert(agentId, temporalGrain, records);

      expect(sendWriteOperation).toHaveBeenCalledWith({
        operation: "insert",
        agentId,
        temporalGrain,
        data: { records },
      });
    });
  });

  describe("update", () => {
    it("should send update operation for records", async () => {
      const records: FactRecord[] = [
        {
          id: "record-1",
          content: "Updated content",
          embedding: [0.5, 0.6, 0.7],
          timestamp: "2024-01-02T00:00:00Z",
        },
      ];

      vi.mocked(sendWriteOperation).mockResolvedValue(undefined);

      await update(agentId, temporalGrain, records);

      expect(sendWriteOperation).toHaveBeenCalledWith({
        operation: "update",
        agentId,
        temporalGrain,
        data: { records },
      });
    });

    it("should not send operation for empty records", async () => {
      await update(agentId, temporalGrain, []);

      expect(sendWriteOperation).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("should send delete operation for record IDs", async () => {
      const recordIds = ["record-1", "record-2"];

      vi.mocked(sendWriteOperation).mockResolvedValue(undefined);

      await remove(agentId, temporalGrain, recordIds);

      expect(sendWriteOperation).toHaveBeenCalledWith({
        operation: "delete",
        agentId,
        temporalGrain,
        data: { recordIds },
      });
    });

    it("should not send operation for empty record IDs", async () => {
      await remove(agentId, temporalGrain, []);

      expect(sendWriteOperation).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("should be an alias for remove", () => {
      expect(deleteOp).toBe(remove);
    });
  });
});

