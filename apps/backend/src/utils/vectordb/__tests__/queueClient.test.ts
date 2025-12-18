import { describe, it, expect, vi, beforeEach } from "vitest";

import { getQueueClient, sendWriteOperation } from "../queueClient";
import type { WriteOperationMessage } from "../types";

// Mock @architect/functions
vi.mock("@architect/functions", () => {
  const mockPublish = vi.fn();
  return {
    queues: {
      publish: mockPublish,
    },
  };
});

// Mock paths
vi.mock("../paths", () => ({
  getMessageGroupId: vi.fn(
    (agentId: string, grain: string) => `${agentId}-${grain}`
  ),
}));

describe("queueClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getQueueClient", () => {
    it("should return queue client from @architect/functions", async () => {
      const client = await getQueueClient();
      expect(client).toBeDefined();
      expect(client.publish).toBeDefined();
    });

    it("should cache the queue client", async () => {
      const client1 = await getQueueClient();
      const client2 = await getQueueClient();
      expect(client1).toBe(client2);
    });
  });

  describe("sendWriteOperation", () => {
    it("should send insert operation to queue", async () => {
      const { queues } = await import("@architect/functions");
      const mockPublish = vi.mocked(queues.publish);
      mockPublish.mockResolvedValue(undefined);

      const message: WriteOperationMessage = {
        operation: "insert",
        agentId: "agent-123",
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

      await sendWriteOperation(message);

      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "agent-temporal-grain-queue",
          payload: message,
        })
      );
      expect(mockPublish).toHaveBeenCalledTimes(1);
    });

    it("should send update operation to queue", async () => {
      const { queues } = await import("@architect/functions");
      const mockPublish = vi.mocked(queues.publish);
      mockPublish.mockResolvedValue(undefined);

      const message: WriteOperationMessage = {
        operation: "update",
        agentId: "agent-123",
        temporalGrain: "weekly",
        data: {
          records: [
            {
              id: "record-1",
              content: "Updated",
              embedding: [0.3, 0.4],
              timestamp: "2024-01-02T00:00:00Z",
            },
          ],
        },
      };

      await sendWriteOperation(message);

      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "agent-temporal-grain-queue",
          payload: message,
        })
      );
    });

    it("should send delete operation to queue", async () => {
      const { queues } = await import("@architect/functions");
      const mockPublish = vi.mocked(queues.publish);
      mockPublish.mockResolvedValue(undefined);

      const message: WriteOperationMessage = {
        operation: "delete",
        agentId: "agent-123",
        temporalGrain: "monthly",
        data: {
          recordIds: ["record-1", "record-2"],
        },
      };

      await sendWriteOperation(message);

      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "agent-temporal-grain-queue",
          payload: message,
        })
      );
    });

    it("should generate unique deduplication IDs", async () => {
      const { queues } = await import("@architect/functions");
      const mockPublish = vi.mocked(queues.publish);
      mockPublish.mockResolvedValue(undefined);

      const message: WriteOperationMessage = {
        operation: "insert",
        agentId: "agent-123",
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

      await sendWriteOperation(message);
      const call1 = mockPublish.mock.calls[0]?.[0] as {
        dedupeId?: string;
        MessageDeduplicationId?: string;
      };

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      await sendWriteOperation(message);
      const call2 = mockPublish.mock.calls[1]?.[0] as {
        dedupeId?: string;
        MessageDeduplicationId?: string;
      };

      // Deduplication IDs should be different due to timestamp
      const dedupeId1 = call1?.dedupeId || call1?.MessageDeduplicationId;
      const dedupeId2 = call2?.dedupeId || call2?.MessageDeduplicationId;
      expect(dedupeId1).not.toBe(dedupeId2);
      expect(dedupeId1?.length).toBeLessThanOrEqual(128);
      expect(dedupeId2?.length).toBeLessThanOrEqual(128);
    });

    it("should throw error on queue failure", async () => {
      const { queues } = await import("@architect/functions");
      const mockPublish = vi.mocked(queues.publish);
      const error = new Error("Queue error");
      mockPublish.mockRejectedValue(error);

      const message: WriteOperationMessage = {
        operation: "insert",
        agentId: "agent-123",
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

      await expect(sendWriteOperation(message)).rejects.toThrow(
        "Failed to send write operation to queue"
      );
    });
  });
});
