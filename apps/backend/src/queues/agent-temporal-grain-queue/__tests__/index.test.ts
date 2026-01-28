import type { SQSEvent, SQSRecord } from "aws-lambda";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type {
  WriteOperationMessage,
  FactRecord,
} from "../../../utils/vectordb/types";
import { handler } from "../index";

// Mock dependencies
vi.mock("@lancedb/lancedb", () => ({
  connect: vi.fn(),
}));

vi.mock("../../../utils/vectordb/paths", () => ({
  getDatabaseUri: vi.fn(
    (agentId: string, grain: string) =>
      `s3://bucket/vectordb/${agentId}/${grain}/`,
  ),
}));

vi.mock("../../../utils/vectordb/config", () => ({
  DEFAULT_S3_REGION: "eu-west-2",
  getS3ConnectionOptions: vi.fn().mockReturnValue({
    region: "eu-west-2",
  }),
}));

// Mock database for handlingSQSErrors
const { mockDatabase } = vi.hoisted(() => {
  const db = {
    workspace: { get: vi.fn() },
    "workspace-credit-transactions": { create: vi.fn() },
    atomicUpdate: vi.fn().mockResolvedValue([]),
  };
  return {
    mockDatabase: vi.fn().mockResolvedValue(db),
  };
});

vi.mock("../../../tables/database", () => ({
  database: mockDatabase,
}));

vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

// Mock workspaceCreditContext functions
vi.mock("../../../utils/workspaceCreditContext", () => ({
  augmentContextWithCreditTransactions: vi.fn((context) => context),
  commitContextTransactions: vi.fn().mockResolvedValue(undefined),
  setCurrentHTTPContext: vi.fn(),
  clearCurrentHTTPContext: vi.fn(),
  setTransactionBuffer: vi.fn(),
  createTransactionBuffer: vi.fn(() => new Map()),
  setCurrentSQSContext: vi.fn(),
  clearCurrentSQSContext: vi.fn(),
}));

vi.mock("../../../http/utils/agentUtils", () => ({
  getWorkspaceApiKey: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../../utils/embedding", () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

vi.mock("../../../utils", () => ({
  getDefined: vi.fn((value: string, message: string) => {
    if (!value) throw new Error(message);
    return value;
  }),
}));

describe("agent-temporal-grain-queue handler", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Set environment variable for API key
    process.env.OPENROUTER_API_KEY = "test-api-key";

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
        }),
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

        const result = await handler(event);

        expect(mockConnect).toHaveBeenCalled();
        expect(mockOpenTable).toHaveBeenCalledWith("vectors");
        expect(mockAdd).toHaveBeenCalledWith([
          {
            id: "record-1",
            content: "Test content",
            vector: [0.1, 0.2, 0.3],
            timestamp: "2024-01-01T00:00:00Z",
            // Metadata is now stored as top-level fields
            conversationId: "",
            workspaceId: "",
            agentId: "",
            documentId: "",
            documentName: "",
            folderPath: "",
          },
        ]);
        expect(result).toEqual({ batchItemFailures: [] });
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
        const mockOpenTable = vi
          .fn()
          .mockRejectedValue(new Error("Table not found"));

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

        const result = await handler(event);

        expect(mockCreateTable).toHaveBeenCalledWith(
          "vectors",
          expect.arrayContaining([
            expect.objectContaining({
              id: "record-1",
              content: "Test",
              vector: [0.1, 0.2],
            }),
          ]),
        );
        expect(result).toEqual({ batchItemFailures: [] });
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

        const result = await handler(event);

        expect(mockDelete).toHaveBeenCalledWith("id = 'record-1'");
        expect(mockAdd).toHaveBeenCalledWith([
          expect.objectContaining({
            id: "record-1",
            content: "Updated content",
          }),
        ]);
        expect(result).toEqual({ batchItemFailures: [] });
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

        const result = await handler(event);

        expect(mockDelete).toHaveBeenCalledWith("id = 'record-1'");
        expect(mockDelete).toHaveBeenCalledWith("id = 'record-2'");
        expect(result).toEqual({ batchItemFailures: [] });
      });
    });

    describe("purge operation", () => {
      it("should purge all records in the table", async () => {
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
          operation: "purge",
          agentId: "agent-123",
          temporalGrain: "daily",
          data: {},
        };

        const event = createSQSEvent([message]);

        const result = await handler(event);

        expect(mockDelete).toHaveBeenCalledWith("id IS NOT NULL");
        expect(result).toEqual({ batchItemFailures: [] });
      });
    });

    describe("error handling", () => {
      it("should return failed message ID for invalid message format", async () => {
        const event: SQSEvent = {
          Records: [
            {
              messageId: "msg-1",
              receiptHandle: "handle-1",
              body: "invalid json",
              attributes: {
                ApproximateReceiveCount: "1",
                SentTimestamp: "1234567890",
                SenderId: "test",
                ApproximateFirstReceiveTimestamp: "1234567890",
              },
              messageAttributes: {},
              md5OfBody: "test",
              eventSource: "aws:sqs",
              eventSourceARN: "arn:aws:sqs:region:account:queue",
              awsRegion: "eu-west-2",
            },
          ],
        };

        const result = await handler(event);

        // Message should be marked as failed
        expect(result).toEqual({
          batchItemFailures: [{ itemIdentifier: "msg-1" }],
        });
      });

      it("should return failed message ID for missing records or rawFacts in insert", async () => {
        const message: WriteOperationMessage = {
          operation: "insert",
          agentId: "agent-123",
          temporalGrain: "daily",
          data: {},
        };

        const event = createSQSEvent([message]);

        const result = await handler(event as unknown as SQSEvent);

        // Message should be marked as failed
        expect(result).toEqual({
          batchItemFailures: [{ itemIdentifier: "msg-0" }],
        });
      });

      it("should process insert operation with rawFacts and generate embeddings", async () => {
        const { connect } = await import("@lancedb/lancedb");
        const { generateEmbedding } = await import("../../../utils/embedding");
        const mockConnect = vi.mocked(connect);
        const mockGenerateEmbedding = vi.mocked(generateEmbedding);

        const mockEmbedding = [0.5, 0.6, 0.7];
        mockGenerateEmbedding.mockResolvedValue(mockEmbedding);

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
          temporalGrain: "working",
          workspaceId: "workspace-456",
          data: {
            rawFacts: [
              {
                id: "raw-fact-1",
                content: "User said: Hello world",
                timestamp: "2024-01-01T00:00:00Z",
                metadata: { conversationId: "conv-1" },
                cacheKey: "workspace-456:agent-123:abc123",
              },
            ],
          },
        };

        const event = createSQSEvent([message]);

        const result = await handler(event);

        // Verify embedding was generated
        expect(mockGenerateEmbedding).toHaveBeenCalledWith(
          "User said: Hello world",
          expect.any(String), // API key
          "workspace-456:agent-123:abc123",
          undefined,
        );

        // Verify record was inserted with generated embedding
        expect(mockConnect).toHaveBeenCalled();
        expect(mockOpenTable).toHaveBeenCalledWith("vectors");
        expect(mockAdd).toHaveBeenCalledWith([
          {
            id: "raw-fact-1",
            content: "User said: Hello world",
            vector: mockEmbedding,
            timestamp: "2024-01-01T00:00:00Z",
            // Metadata is now stored as top-level fields
            conversationId: "conv-1",
            workspaceId: "",
            agentId: "",
            documentId: "",
            documentName: "",
            folderPath: "",
          },
        ]);
        expect(result).toEqual({ batchItemFailures: [] });
      });

      it("should return failed message ID for unknown operation", async () => {
        const message = {
          operation: "unknown",
          agentId: "agent-123",
          temporalGrain: "daily",
          data: {},
        };

        const event = createSQSEvent([
          message as unknown as WriteOperationMessage,
        ]);

        const result = await handler(event as unknown as SQSEvent);

        // Message should be marked as failed
        expect(result).toEqual({
          batchItemFailures: [{ itemIdentifier: "msg-0" }],
        });
      });
    });

    describe("batch processing", () => {
      it("should process multiple messages successfully", async () => {
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

        const result = await handler(event);

        expect(mockAdd).toHaveBeenCalledTimes(2);
        expect(result).toEqual({ batchItemFailures: [] }); // No failed messages
      });

      it("should return failed message IDs for partial batch failures", async () => {
        const { connect } = await import("@lancedb/lancedb");
        const mockConnect = vi.mocked(connect);

        // First message succeeds, second fails, third succeeds
        let callCount = 0;
        const mockAdd = vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 2) {
            return Promise.reject(new Error("Database connection error"));
          }
          return Promise.resolve(undefined);
        });

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
            agentId: "agent-456",
            temporalGrain: "daily",
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
          {
            operation: "insert",
            agentId: "agent-789",
            temporalGrain: "daily",
            data: {
              records: [
                {
                  id: "record-3",
                  content: "Test 3",
                  embedding: [0.5, 0.6],
                  timestamp: "2024-01-03T00:00:00Z",
                },
              ],
            },
          },
        ];

        const event = createSQSEvent(messages);

        const result = await handler(event);

        // All three messages should be attempted
        expect(mockAdd).toHaveBeenCalledTimes(3);

        // Only the second message should be marked as failed
        expect(result).toEqual({
          batchItemFailures: [{ itemIdentifier: "msg-1" }],
        });
      });

      it("should return all failed message IDs when all messages fail", async () => {
        const { connect } = await import("@lancedb/lancedb");
        const mockConnect = vi.mocked(connect);

        const mockAdd = vi
          .fn()
          .mockRejectedValue(new Error("Database connection error"));

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
            agentId: "agent-456",
            temporalGrain: "daily",
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

        const result = await handler(event);

        expect(result).toEqual({
          batchItemFailures: [
            { itemIdentifier: "msg-0" },
            { itemIdentifier: "msg-1" },
          ],
        });
      });
    });
  });
});
