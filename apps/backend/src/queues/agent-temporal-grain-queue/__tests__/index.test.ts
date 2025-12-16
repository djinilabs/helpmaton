import type { SQSEvent, SQSRecord } from "aws-lambda";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { WriteOperationMessage, FactRecord } from "../../../utils/vectordb/types";
import { handler } from "../index";

// Mock dependencies
vi.mock("@lancedb/lancedb", () => ({
  connect: vi.fn(),
}));

vi.mock("../../../utils/vectordb/paths", () => ({
  getDatabaseUri: vi.fn((agentId: string, grain: string) =>
    `s3://bucket/vectordb/${agentId}/${grain}/`
  ),
}));

vi.mock("../../../utils/vectordb/config", () => ({
  DEFAULT_S3_REGION: "eu-west-2",
}));

vi.mock("../../../utils/handlingSQSErrors", () => ({
  handlingSQSErrors: (fn: (event: SQSEvent) => Promise<void>) => fn,
}));

describe("agent-temporal-grain-queue handler", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const { connect } = await import("@lancedb/lancedb");
    const mockConnect = vi.mocked(connect);

    // Setup default mocks
    const mockAdd = vi.fn().mockResolvedValue(undefined);
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    const mockOpenTable = vi.fn().mockResolvedValue({
      add: mockAdd,
      delete: mockDelete,
    });
    const mockCreateTable = vi.fn().mockResolvedValue(undefined);

    mockConnect.mockResolvedValue({
      openTable: mockOpenTable,
      createTable: mockCreateTable,
    } as unknown as Awaited<ReturnType<typeof connect>>);
  });

  describe("handler", () => {
    const createSQSEvent = (messages: WriteOperationMessage[]): SQSEvent => ({
      Records: messages.map(
        (message, index): SQSRecord => ({
          messageId: `msg-${index}`,
          receiptHandle: `handle-${index}`,
          body: JSON.stringify(message),
          attributes: {
            ApproximateReceiveCount: "1",
            SentTimestamp: Date.now().toString(),
            SenderId: "test",
            ApproximateFirstReceiveTimestamp: Date.now().toString(),
          },
          messageAttributes: {},
          md5OfBody: "test",
          eventSource: "aws:sqs",
          eventSourceARN: "arn:aws:sqs:region:account:queue",
          awsRegion: "eu-west-2",
        })
      ),
    });

    describe("insert operation", () => {
      it("should process insert operation", async () => {
        const { connect } = await import("@lancedb/lancedb");
        const mockConnect = vi.mocked(connect);

        const records: FactRecord[] = [
          {
            id: "record-1",
            content: "Test content",
            embedding: [0.1, 0.2, 0.3],
            timestamp: "2024-01-01T00:00:00Z",
          },
        ];

        const mockAdd = vi.fn().mockResolvedValue(undefined);
        const mockOpenTable = vi.fn().mockResolvedValue({
          add: mockAdd,
        });

        mockConnect.mockResolvedValue({
          openTable: mockOpenTable,
          createTable: vi.fn(),
        } as unknown as Awaited<ReturnType<typeof connect>>);

        const message: WriteOperationMessage = {
          operation: "insert",
          agentId: "agent-123",
          temporalGrain: "daily",
          data: { records },
        };

        const event = createSQSEvent([message]);

        await handler(event);

        expect(mockConnect).toHaveBeenCalled();
        expect(mockOpenTable).toHaveBeenCalledWith("vectors");
        expect(mockAdd).toHaveBeenCalledWith([
          {
            id: "record-1",
            content: "Test content",
            vector: [0.1, 0.2, 0.3],
            timestamp: "2024-01-01T00:00:00Z",
            metadata: {},
          },
        ]);
      });

      it("should create table if it doesn't exist", async () => {
        const { connect } = await import("@lancedb/lancedb");
        const mockConnect = vi.mocked(connect);

        const records: FactRecord[] = [
          {
            id: "record-1",
            content: "Test",
            embedding: [0.1, 0.2],
            timestamp: "2024-01-01T00:00:00Z",
          },
        ];

        const mockCreateTable = vi.fn().mockResolvedValue(undefined);
        const mockOpenTable = vi.fn().mockRejectedValue(new Error("Table not found"));

        mockConnect.mockResolvedValue({
          openTable: mockOpenTable,
          createTable: mockCreateTable,
        } as unknown as Awaited<ReturnType<typeof connect>>);

        const message: WriteOperationMessage = {
          operation: "insert",
          agentId: "agent-123",
          temporalGrain: "daily",
          data: { records },
        };

        const event = createSQSEvent([message]);

        await handler(event);

        expect(mockCreateTable).toHaveBeenCalledWith(
          "vectors",
          expect.arrayContaining([
            expect.objectContaining({
              id: "record-1",
              content: "Test",
              vector: [0.1, 0.2],
            }),
          ])
        );
      });
    });

    describe("update operation", () => {
      it("should process update operation", async () => {
        const { connect } = await import("@lancedb/lancedb");
        const mockConnect = vi.mocked(connect);

        const records: FactRecord[] = [
          {
            id: "record-1",
            content: "Updated content",
            embedding: [0.5, 0.6, 0.7],
            timestamp: "2024-01-02T00:00:00Z",
          },
        ];

        const mockAdd = vi.fn().mockResolvedValue(undefined);
        const mockDelete = vi.fn().mockResolvedValue(undefined);
        const mockOpenTable = vi.fn().mockResolvedValue({
          add: mockAdd,
          delete: mockDelete,
        });

        mockConnect.mockResolvedValue({
          openTable: mockOpenTable,
          createTable: vi.fn(),
        } as unknown as Awaited<ReturnType<typeof connect>>);

        const message: WriteOperationMessage = {
          operation: "update",
          agentId: "agent-123",
          temporalGrain: "daily",
          data: { records },
        };

        const event = createSQSEvent([message]);

        await handler(event);

        expect(mockDelete).toHaveBeenCalledWith("id = 'record-1'");
        expect(mockAdd).toHaveBeenCalledWith([
          expect.objectContaining({
            id: "record-1",
            content: "Updated content",
          }),
        ]);
      });
    });

    describe("delete operation", () => {
      it("should process delete operation", async () => {
        const { connect } = await import("@lancedb/lancedb");
        const mockConnect = vi.mocked(connect);

        const mockDelete = vi.fn().mockResolvedValue(undefined);
        const mockOpenTable = vi.fn().mockResolvedValue({
          delete: mockDelete,
        });

        mockConnect.mockResolvedValue({
          openTable: mockOpenTable,
          createTable: vi.fn(),
        } as unknown as Awaited<ReturnType<typeof connect>>);

        const message: WriteOperationMessage = {
          operation: "delete",
          agentId: "agent-123",
          temporalGrain: "daily",
          data: { recordIds: ["record-1", "record-2"] },
        };

        const event = createSQSEvent([message]);

        await handler(event);

        expect(mockDelete).toHaveBeenCalledWith("id = 'record-1'");
        expect(mockDelete).toHaveBeenCalledWith("id = 'record-2'");
      });
    });

    describe("error handling", () => {
      it("should throw error for invalid message format", async () => {
        const event: SQSEvent = {
          Records: [
            {
              messageId: "msg-1",
              receiptHandle: "handle-1",
              body: "invalid json",
              attributes: {} as any,
              messageAttributes: {},
              md5OfBody: "test",
              eventSource: "aws:sqs",
              eventSourceARN: "arn:aws:sqs:region:account:queue",
              awsRegion: "eu-west-2",
            },
          ],
        };

        await expect(handler(event)).rejects.toThrow("Invalid message format");
      });

      it("should throw error for missing records in insert", async () => {
        const message: WriteOperationMessage = {
          operation: "insert",
          agentId: "agent-123",
          temporalGrain: "daily",
          data: {},
        };

        const event = createSQSEvent([message]);

        await expect(handler(event as any)).rejects.toThrow(
          "Insert operation requires records"
        );
      });

      it("should throw error for unknown operation", async () => {
        const message = {
          operation: "unknown",
          agentId: "agent-123",
          temporalGrain: "daily",
          data: {},
        };

        const event = createSQSEvent([message as any]);

        await expect(handler(event as any)).rejects.toThrow(
          "Unknown operation"
        );
      });
    });

    describe("batch processing", () => {
      it("should process multiple messages", async () => {
        const { connect } = await import("@lancedb/lancedb");
        const mockConnect = vi.mocked(connect);

        const mockAdd = vi.fn().mockResolvedValue(undefined);
        const mockOpenTable = vi.fn().mockResolvedValue({
          add: mockAdd,
        });

        mockConnect.mockResolvedValue({
          openTable: mockOpenTable,
          createTable: vi.fn(),
        } as unknown as Awaited<ReturnType<typeof connect>>);

        const messages: WriteOperationMessage[] = [
          {
            operation: "insert",
            agentId: "agent-123",
            temporalGrain: "daily",
            data: {
              records: [
                {
                  id: "record-1",
                  content: "Test 1",
                  embedding: [0.1, 0.2],
                  timestamp: "2024-01-01T00:00:00Z",
                },
              ],
            },
          },
          {
            operation: "insert",
            agentId: "agent-123",
            temporalGrain: "weekly",
            data: {
              records: [
                {
                  id: "record-2",
                  content: "Test 2",
                  embedding: [0.3, 0.4],
                  timestamp: "2024-01-02T00:00:00Z",
                },
              ],
            },
          },
        ];

        const event = createSQSEvent(messages);

        await handler(event);

        expect(mockAdd).toHaveBeenCalledTimes(2);
      });
    });
  });
});

