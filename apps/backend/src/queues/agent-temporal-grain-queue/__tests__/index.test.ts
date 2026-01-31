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

vi.mock("../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

const {
  mockGenerateEmbeddingWithUsage,
  mockResolveEmbeddingApiKey,
  mockReserveEmbeddingCredits,
  mockAdjustEmbeddingCreditReservation,
  mockRefundEmbeddingCredits,
  mockGetCurrentSQSContext,
} = vi.hoisted(() => {
  return {
    mockGenerateEmbeddingWithUsage: vi.fn().mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      usage: { promptTokens: 5 },
      fromCache: false,
    }),
    mockResolveEmbeddingApiKey: vi
      .fn()
      .mockResolvedValue({ apiKey: "test-api-key", usesByok: false }),
    mockReserveEmbeddingCredits: vi.fn().mockResolvedValue({
      reservationId: "res-123",
    }),
    mockAdjustEmbeddingCreditReservation: vi.fn().mockResolvedValue(undefined),
    mockRefundEmbeddingCredits: vi.fn().mockResolvedValue(undefined),
    mockGetCurrentSQSContext: vi.fn(),
  };
});

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
  getCurrentSQSContext: (...args: unknown[]) => mockGetCurrentSQSContext(...args),
}));

vi.mock("../../../utils/embedding", () => ({
  generateEmbeddingWithUsage: (...args: unknown[]) =>
    mockGenerateEmbeddingWithUsage(...args),
  resolveEmbeddingApiKey: (...args: unknown[]) =>
    mockResolveEmbeddingApiKey(...args),
}));

vi.mock("../../../utils/embeddingCredits", () => ({
  reserveEmbeddingCredits: (...args: unknown[]) =>
    mockReserveEmbeddingCredits(...args),
  adjustEmbeddingCreditReservation: (...args: unknown[]) =>
    mockAdjustEmbeddingCreditReservation(...args),
  refundEmbeddingCredits: (...args: unknown[]) =>
    mockRefundEmbeddingCredits(...args),
}));

describe("agent-temporal-grain-queue handler", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Set environment variable for API key
    process.env.OPENROUTER_API_KEY = "test-api-key";

    mockGetCurrentSQSContext.mockReturnValue({
      addWorkspaceCreditTransaction: vi.fn(),
    });
    mockResolveEmbeddingApiKey.mockResolvedValue({
      apiKey: "test-api-key",
      usesByok: false,
    });
    mockReserveEmbeddingCredits.mockResolvedValue({
      reservationId: "res-123",
    });
    mockGenerateEmbeddingWithUsage.mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      usage: { promptTokens: 5 },
      fromCache: false,
    });

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

      it("should use BYOK key and skip charged reservations for rawFacts", async () => {
        mockResolveEmbeddingApiKey.mockResolvedValue({
          apiKey: "byok-key",
          usesByok: true,
        });
        mockReserveEmbeddingCredits.mockResolvedValue({
          reservationId: "byok",
        });

        const message: WriteOperationMessage = {
          operation: "insert",
          agentId: "agent-123",
          temporalGrain: "daily",
          workspaceId: "workspace-123",
          usesByok: true,
          data: {
            rawFacts: [
              {
                id: "fact-1",
                content: "BYOK content",
                timestamp: "2024-01-01T00:00:00Z",
                metadata: {
                  workspaceId: "workspace-123",
                  agentId: "agent-123",
                  conversationId: "conv-1",
                },
              },
            ],
          },
        };

        await handler(createSQSEvent([message]));

        expect(mockGenerateEmbeddingWithUsage).toHaveBeenCalledWith(
          "BYOK content",
          "byok-key",
          undefined,
          undefined,
        );
        expect(mockReserveEmbeddingCredits).toHaveBeenCalledWith(
          expect.objectContaining({
            workspaceId: "workspace-123",
            usesByok: true,
            agentId: "agent-123",
            conversationId: "conv-1",
          }),
        );
        expect(mockAdjustEmbeddingCreditReservation).toHaveBeenCalledWith(
          expect.objectContaining({ reservationId: "byok" }),
        );
      });

      it("should charge credits when using system key for rawFacts", async () => {
        mockResolveEmbeddingApiKey.mockResolvedValue({
          apiKey: "workspace-key",
          usesByok: true,
        });

        const message: WriteOperationMessage = {
          operation: "insert",
          agentId: "agent-123",
          temporalGrain: "daily",
          workspaceId: "workspace-123",
          usesByok: false,
          data: {
            rawFacts: [
              {
                id: "fact-1",
                content: "System content",
                timestamp: "2024-01-01T00:00:00Z",
                metadata: {
                  workspaceId: "workspace-123",
                },
              },
            ],
          },
        };

        await handler(createSQSEvent([message]));

        expect(mockGenerateEmbeddingWithUsage).toHaveBeenCalledWith(
          "System content",
          "test-api-key",
          undefined,
          undefined,
        );
        expect(mockReserveEmbeddingCredits).toHaveBeenCalledWith(
          expect.objectContaining({
            workspaceId: "workspace-123",
            usesByok: false,
          }),
        );
        expect(mockAdjustEmbeddingCreditReservation).toHaveBeenCalledWith(
          expect.objectContaining({ reservationId: "res-123" }),
        );
      });

      it("should refund credits when embedding generation fails", async () => {
        mockGenerateEmbeddingWithUsage.mockRejectedValueOnce(
          new Error("Embedding failed"),
        );

        const message: WriteOperationMessage = {
          operation: "insert",
          agentId: "agent-123",
          temporalGrain: "daily",
          workspaceId: "workspace-123",
          data: {
            rawFacts: [
              {
                id: "fact-1",
                content: "Failing content",
                timestamp: "2024-01-01T00:00:00Z",
                metadata: {
                  workspaceId: "workspace-123",
                },
              },
            ],
          },
        };

        await handler(createSQSEvent([message]));

        expect(mockRefundEmbeddingCredits).toHaveBeenCalledWith(
          expect.objectContaining({ reservationId: "res-123" }),
        );
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

      it("should process update operation with rawFacts", async () => {
        const { connect } = await import("@lancedb/lancedb");
        const mockConnect = vi.mocked(connect);

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
          workspaceId: "workspace-1",
          data: {
            rawFacts: [
              {
                id: "record-raw-1",
                content: "Raw content update",
                timestamp: "2024-01-02T00:00:00Z",
                metadata: {
                  conversationId: "conversation-1",
                  workspaceId: "workspace-1",
                  agentId: "agent-123",
                },
              },
            ],
          },
        };

        const event = createSQSEvent([message]);

        const result = await handler(event);

        expect(mockDelete).toHaveBeenCalledWith("id = 'record-raw-1'");
        expect(mockAdd).toHaveBeenCalledWith([
          expect.objectContaining({
            id: "record-raw-1",
            content: "Raw content update",
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

      it("should handle missing table gracefully", async () => {
        const { connect } = await import("@lancedb/lancedb");
        const mockConnect = vi.mocked(connect);

        const mockOpenTable = vi
          .fn()
          .mockRejectedValue(new Error("Table not found"));

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

        expect(mockOpenTable).toHaveBeenCalledWith("vectors");
        expect(result).toEqual({ batchItemFailures: [] });
      });
    });

    describe("error handling", () => {
      it("should not request retries for invalid message format", async () => {
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

        expect(result).toEqual({
          batchItemFailures: [],
        });
      });

      it("should not request retries for missing records or rawFacts in insert", async () => {
        const message: WriteOperationMessage = {
          operation: "insert",
          agentId: "agent-123",
          temporalGrain: "daily",
          data: {},
        };

        const event = createSQSEvent([message]);

        const result = await handler(event as unknown as SQSEvent);

        expect(result).toEqual({
          batchItemFailures: [],
        });
      });

      it("should process insert operation with rawFacts and generate embeddings", async () => {
        const { connect } = await import("@lancedb/lancedb");
        const mockConnect = vi.mocked(connect);

        const mockEmbedding = [0.5, 0.6, 0.7];
        mockGenerateEmbeddingWithUsage.mockResolvedValue({
          embedding: mockEmbedding,
          usage: { promptTokens: 5 },
          fromCache: false,
        });

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
        expect(mockGenerateEmbeddingWithUsage).toHaveBeenCalledWith(
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

      it("should not request retries for unknown operation", async () => {
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

        expect(result).toEqual({
          batchItemFailures: [],
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

      it("should not request retries for partial batch failures", async () => {
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

        expect(result).toEqual({
          batchItemFailures: [],
        });
      });

      it("should not request retries when all messages fail", async () => {
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
          batchItemFailures: [],
        });
      });
    });
  });
});
