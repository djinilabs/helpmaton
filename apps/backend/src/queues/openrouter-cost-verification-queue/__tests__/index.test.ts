import type { SQSEvent, SQSRecord } from "aws-lambda";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { UIMessage } from "../../../http/post-api-workspaces-000workspaceId-agents-000agentId-test/utils/types";
import type { DatabaseSchema } from "../../../tables/schema";
import type { AugmentedContext } from "../../../utils/workspaceCreditContext";
import { handler } from "../index";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockDatabase,
  mockFinalizeCreditReservation,
  mockGet,
  mockAtomicUpdate,
  mockGetReservation,
  mockAtomicUpdateReservation,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockFinalizeCreditReservation: vi.fn(),
    mockGet: vi.fn(),
    mockAtomicUpdate: vi.fn(),
    mockGetReservation: vi.fn(),
    mockAtomicUpdateReservation: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../../tables/database", () => ({
  database: mockDatabase,
}));

// Mock @architect/functions for database initialization
vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

// Mock workspaceCreditContext functions
const mockContext: AugmentedContext = {
  awsRequestId: "test-request-id",
  addWorkspaceCreditTransaction: vi.fn(),
  getRemainingTimeInMillis: () => 30000,
  functionName: "test-function",
  functionVersion: "$LATEST",
  invokedFunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:test",
  memoryLimitInMB: "128",
  logGroupName: "/aws/lambda/test",
  logStreamName: "2024/01/01/[$LATEST]test",
  callbackWaitsForEmptyEventLoop: true,
  succeed: vi.fn(),
  fail: vi.fn(),
  done: vi.fn(),
} as AugmentedContext;

vi.mock("../../../utils/workspaceCreditContext", () => {
  const mockContext = {
    awsRequestId: "test-request-id",
    addWorkspaceCreditTransaction: vi.fn(),
  };
  return {
    augmentContextWithCreditTransactions: vi.fn((context) => ({
      ...context,
      addWorkspaceCreditTransaction: vi.fn(),
    })),
    commitContextTransactions: vi.fn().mockResolvedValue(undefined),
    setTransactionBuffer: vi.fn(),
    createTransactionBuffer: vi.fn(() => new Map()),
    setCurrentSQSContext: vi.fn(),
    clearCurrentSQSContext: vi.fn(),
    getCurrentSQSContext: vi.fn(() => mockContext),
  };
});

// Mock posthog and sentry for handlingSQSErrors
vi.mock("../../../utils/posthog", () => ({
  flushPostHog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../utils/sentry", () => ({
  flushSentry: vi.fn().mockResolvedValue(undefined),
  ensureError: vi.fn((error) => error),
}));

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
}));

// Mock creditManagement
vi.mock("../../../utils/creditManagement", () => ({
  finalizeCreditReservation: mockFinalizeCreditReservation,
}));

// Mock getDefined
vi.mock("../../../utils", () => ({
  getDefined: (value: string | undefined, message: string) => {
    if (!value) throw new Error(message);
    return value;
  },
}));

// Mock global fetch
global.fetch = vi.fn();

describe("openrouter-cost-verification-queue", () => {
  let mockDb: DatabaseSchema;
  let mockConversation: {
    pk: string;
    workspaceId: string;
    agentId: string;
    conversationId: string;
    conversationType: "webhook";
    messages: unknown[];
    startedAt: string;
    lastMessageAt: string;
    expires: number;
    costUsd?: number;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    // Set OPENROUTER_API_KEY for tests
    process.env.OPENROUTER_API_KEY = "test-api-key";

    // Setup mock conversation
    mockConversation = {
      pk: "conversations/workspace-1/agent-1/conv-1",
      workspaceId: "workspace-1",
      agentId: "agent-1",
      conversationId: "conv-1",
      conversationType: "webhook",
      messages: [
        {
          role: "user",
          content: "Hello",
        },
        {
          role: "assistant",
          content: "Hi there!",
          modelName: "openrouter/auto",
          provider: "openrouter",
          openrouterGenerationId: "gen-12345",
          tokenUsage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
        },
      ] as UIMessage[],
      startedAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      costUsd: 1000, // Initial cost in millionths
    };

    // Setup mock database
    mockDb = {
      "agent-conversations": {
        get: mockGet,
        atomicUpdate: mockAtomicUpdate,
      },
      "credit-reservations": {
        get: mockGetReservation,
        atomicUpdate: mockAtomicUpdateReservation,
      },
    } as unknown as DatabaseSchema;

    mockDatabase.mockResolvedValue(mockDb);
    mockGet.mockResolvedValue(mockConversation);
    mockAtomicUpdate.mockImplementation(async (_pk, _sk, updater) => {
      const updated = await updater(mockConversation);
      return updated || mockConversation;
    });
    mockFinalizeCreditReservation.mockResolvedValue(undefined);
  });

  describe("processCostVerification", () => {
    it("should fetch cost from OpenRouter API and update message with finalCostUsd", async () => {
      // Mock reservation for single generation
      const mockReservation = {
        pk: "credit-reservations/res-1",
        workspaceId: "workspace-1",
        openrouterGenerationId: "gen-12345", // Single ID (old format)
        expectedGenerationCount: 1, // Will default to 1 if not set
        verifiedGenerationIds: [],
        verifiedCosts: [],
        reservedAmount: 5000,
        tokenUsageBasedCost: 4000,
      };

      mockGetReservation.mockResolvedValue(mockReservation);
      let currentReservation = { ...mockReservation };

      mockAtomicUpdateReservation.mockImplementation(
        async (_pk, _sk, updater) => {
          const updated = await updater(currentReservation);
          if (updated) {
            currentReservation = updated;
          }
          return updated || currentReservation;
        }
      );

      // Mock OpenRouter API response (nested structure: data.data.total_cost)
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            total_cost: 0.001, // $0.001 USD
          },
        }),
      });

      const record: SQSRecord = {
        messageId: "msg-1",
        receiptHandle: "receipt-1",
        body: JSON.stringify({
          reservationId: "res-1",
          openrouterGenerationId: "gen-12345",
          workspaceId: "workspace-1",
          conversationId: "conv-1",
          agentId: "agent-1",
        }),
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "1234567890000",
          SenderId: "test-sender",
          ApproximateFirstReceiveTimestamp: "1234567890000",
        },
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "",
        awsRegion: "",
      };

      const event: SQSEvent = {
        Records: [record],
      };

      await handler(event);

      // Verify OpenRouter API was called
      expect(global.fetch).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/generation?id=gen-12345",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Bearer"),
          }),
        })
      );

      // Verify finalizeCreditReservation was called with correct cost (0.001 * 1_000_000 * 1.055 = 1055 millionths)
      expect(mockFinalizeCreditReservation).toHaveBeenCalledWith(
        mockDb,
        "res-1",
        1055, // Math.ceil(0.001 * 1_000_000 * 1.055) = 1055
        expect.objectContaining({
          addWorkspaceCreditTransaction: expect.any(Function),
        }),
        3
      );

      // Verify conversation was updated
      expect(mockGet).toHaveBeenCalledWith(
        "conversations/workspace-1/agent-1/conv-1"
      );
      expect(mockAtomicUpdate).toHaveBeenCalled();

      // Verify the updater function was called and updated the message
      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const updated = await updaterCall(mockConversation);

      const updatedMessages = updated.messages as UIMessage[];
      const assistantMessage = updatedMessages.find(
        (msg) => msg.role === "assistant"
      );

      expect(assistantMessage).toBeDefined();
      expect(assistantMessage).toHaveProperty("finalCostUsd", 1055);
      expect(updated.costUsd).toBe(1055); // Conversation cost should be updated
    });

    it("should apply 5.5% markup to OpenRouter cost", async () => {
      // Mock reservation for single generation
      const mockReservation = {
        pk: "credit-reservations/res-1",
        workspaceId: "workspace-1",
        openrouterGenerationId: "gen-12345", // Single ID (old format)
        expectedGenerationCount: 1, // Will default to 1 if not set
        verifiedGenerationIds: [],
        verifiedCosts: [],
        reservedAmount: 5000,
        tokenUsageBasedCost: 4000,
      };

      mockGetReservation.mockResolvedValue(mockReservation);
      let currentReservation = { ...mockReservation };

      mockAtomicUpdateReservation.mockImplementation(
        async (_pk, _sk, updater) => {
          const updated = await updater(currentReservation);
          if (updated) {
            currentReservation = updated;
          }
          return updated || currentReservation;
        }
      );

      // Mock OpenRouter API response with cost 0.01 USD (nested structure)
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            total_cost: 0.01, // $0.01 USD
          },
        }),
      });

      const record: SQSRecord = {
        messageId: "msg-1",
        receiptHandle: "receipt-1",
        body: JSON.stringify({
          reservationId: "res-1",
          openrouterGenerationId: "gen-12345",
          workspaceId: "workspace-1",
          conversationId: "conv-1",
          agentId: "agent-1",
        }),
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "1234567890000",
          SenderId: "test-sender",
          ApproximateFirstReceiveTimestamp: "1234567890000",
        },
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "",
        awsRegion: "",
      };

      await handler({ Records: [record] });

      // Verify markup was applied: 0.01 * 1_000_000 * 1.055 = 10,550 millionths
      expect(mockFinalizeCreditReservation).toHaveBeenCalledWith(
        mockDb,
        "res-1",
        10550,
        expect.objectContaining({
          addWorkspaceCreditTransaction: expect.any(Function),
        }),
        3
      );
    });

    it("should skip message update if conversation not found", async () => {
      mockGet.mockResolvedValueOnce(null);

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            total_cost: 0.001,
          },
        }),
      });

      const record: SQSRecord = {
        messageId: "msg-1",
        receiptHandle: "receipt-1",
        body: JSON.stringify({
          reservationId: "res-1",
          openrouterGenerationId: "gen-12345",
          workspaceId: "workspace-1",
          conversationId: "conv-1",
          agentId: "agent-1",
        }),
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "1234567890000",
          SenderId: "test-sender",
          ApproximateFirstReceiveTimestamp: "1234567890000",
        },
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "",
        awsRegion: "",
      };

      await handler({ Records: [record] });

      // Should still finalize credit reservation
      expect(mockFinalizeCreditReservation).toHaveBeenCalled();

      // Should not call atomicUpdate since conversation doesn't exist
      expect(mockAtomicUpdate).not.toHaveBeenCalled();
    });

    it("should skip message update if message with generationId not found", async () => {
      // Conversation with message that has different generationId
      const conversationWithoutMatchingMessage = {
        ...mockConversation,
        messages: [
          {
            role: "assistant",
            content: "Hi there!",
            openrouterGenerationId: "gen-99999", // Different generationId
          },
        ] as UIMessage[],
      };

      mockGet.mockResolvedValueOnce(conversationWithoutMatchingMessage);

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            total_cost: 0.001,
          },
        }),
      });

      const record: SQSRecord = {
        messageId: "msg-1",
        receiptHandle: "receipt-1",
        body: JSON.stringify({
          reservationId: "res-1",
          openrouterGenerationId: "gen-12345",
          workspaceId: "workspace-1",
          conversationId: "conv-1",
          agentId: "agent-1",
        }),
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "1234567890000",
          SenderId: "test-sender",
          ApproximateFirstReceiveTimestamp: "1234567890000",
        },
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "",
        awsRegion: "",
      };

      await handler({ Records: [record] });

      // Should still finalize credit reservation
      expect(mockFinalizeCreditReservation).toHaveBeenCalled();

      // Should call atomicUpdate but message won't be updated
      expect(mockAtomicUpdate).toHaveBeenCalled();
      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const updated = await updaterCall(conversationWithoutMatchingMessage);

      // Message should not have finalCostUsd
      const assistantMessage = (updated.messages as UIMessage[]).find(
        (msg) => msg.role === "assistant"
      );
      expect(assistantMessage).not.toHaveProperty("finalCostUsd");
    });

    it("should skip message update if conversationId or agentId missing (backward compatibility)", async () => {
      // Mock reservation for single generation (backward compatibility)
      const mockReservation = {
        pk: "credit-reservations/res-1",
        workspaceId: "workspace-1",
        openrouterGenerationId: "gen-12345", // Single ID (old format)
        expectedGenerationCount: 1, // Will default to 1 if not set
        verifiedGenerationIds: [],
        verifiedCosts: [],
        reservedAmount: 5000,
        tokenUsageBasedCost: 4000,
      };

      mockGetReservation.mockResolvedValue(mockReservation);
      let currentReservation = { ...mockReservation };

      mockAtomicUpdateReservation.mockImplementation(
        async (_pk, _sk, updater) => {
          const updated = await updater(currentReservation);
          if (updated) {
            currentReservation = updated;
          }
          return updated || currentReservation;
        }
      );

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            total_cost: 0.001,
          },
        }),
      });

      const record: SQSRecord = {
        messageId: "msg-1",
        receiptHandle: "receipt-1",
        body: JSON.stringify({
          reservationId: "res-1",
          openrouterGenerationId: "gen-12345",
          workspaceId: "workspace-1",
          // conversationId and agentId missing
        }),
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "1234567890000",
          SenderId: "test-sender",
          ApproximateFirstReceiveTimestamp: "1234567890000",
        },
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "",
        awsRegion: "",
      };

      await handler({ Records: [record] });

      // Should still finalize credit reservation
      expect(mockFinalizeCreditReservation).toHaveBeenCalled();

      // Should not try to update conversation
      expect(mockGet).not.toHaveBeenCalled();
      expect(mockAtomicUpdate).not.toHaveBeenCalled();
    });

    it("should throw error when generation not found (404)", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "Not found",
      });

      const record: SQSRecord = {
        messageId: "msg-1",
        receiptHandle: "receipt-1",
        body: JSON.stringify({
          reservationId: "res-1",
          openrouterGenerationId: "gen-12345",
          workspaceId: "workspace-1",
          conversationId: "conv-1",
          agentId: "agent-1",
        }),
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "1234567890000",
          SenderId: "test-sender",
          ApproximateFirstReceiveTimestamp: "1234567890000",
        },
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "",
        awsRegion: "",
      };

      // Error should be thrown and message should be in failed batch
      const response = await handler({ Records: [record] });

      // Should not finalize credit reservation
      expect(mockFinalizeCreditReservation).not.toHaveBeenCalled();

      // Should not update conversation
      expect(mockGet).not.toHaveBeenCalled();
      expect(mockAtomicUpdate).not.toHaveBeenCalled();

      // Message should be marked as failed
      expect(response.batchItemFailures).toHaveLength(1);
      expect(response.batchItemFailures[0].itemIdentifier).toBe("msg-1");
    });

    it("should throw error when cost field is missing from OpenRouter response", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            // Missing total_cost field
          },
        }),
      });

      const record: SQSRecord = {
        messageId: "msg-1",
        receiptHandle: "receipt-1",
        body: JSON.stringify({
          reservationId: "res-1",
          openrouterGenerationId: "gen-12345",
          workspaceId: "workspace-1",
        }),
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "1234567890000",
          SenderId: "test-sender",
          ApproximateFirstReceiveTimestamp: "1234567890000",
        },
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "",
        awsRegion: "",
      };

      // Error should be thrown and message should be in failed batch
      const response = await handler({ Records: [record] });

      // Should not finalize credit reservation
      expect(mockFinalizeCreditReservation).not.toHaveBeenCalled();

      // Message should be marked as failed
      expect(response.batchItemFailures).toHaveLength(1);
      expect(response.batchItemFailures[0].itemIdentifier).toBe("msg-1");
    });

    it("should handle OpenRouter API error", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Network error")
      );

      const record: SQSRecord = {
        messageId: "msg-1",
        receiptHandle: "receipt-1",
        body: JSON.stringify({
          reservationId: "res-1",
          openrouterGenerationId: "gen-12345",
          workspaceId: "workspace-1",
          conversationId: "conv-1",
          agentId: "agent-1",
        }),
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "1234567890000",
          SenderId: "test-sender",
          ApproximateFirstReceiveTimestamp: "1234567890000",
        },
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "",
        awsRegion: "",
      };

      const event: SQSEvent = { Records: [record] };

      // Should return failed message ID (handlingSQSErrors wraps and returns SQSBatchResponse)
      const response = await handler(event);

      expect(response.batchItemFailures).toHaveLength(1);
      expect(response.batchItemFailures[0].itemIdentifier).toBe("msg-1");
      expect(mockFinalizeCreditReservation).not.toHaveBeenCalled();
    });

    it("should update conversation costUsd when message has finalCostUsd", async () => {
      // Conversation with multiple messages, one with finalCostUsd
      const conversationWithMultipleMessages = {
        ...mockConversation,
        messages: [
          {
            role: "user",
            content: "Hello",
          },
          {
            role: "assistant",
            content: "Hi!",
            modelName: "openrouter/auto",
            provider: "openrouter",
            openrouterGenerationId: "gen-11111",
            finalCostUsd: 2000, // Already has finalCostUsd
          },
          {
            role: "assistant",
            content: "How can I help?",
            modelName: "openrouter/auto",
            provider: "openrouter",
            openrouterGenerationId: "gen-12345", // This one will be updated
            tokenUsage: {
              promptTokens: 100,
              completionTokens: 50,
              totalTokens: 150,
            },
          },
        ] as UIMessage[],
      };

      mockGet.mockResolvedValueOnce(conversationWithMultipleMessages);

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            total_cost: 0.001, // Will become 1055 millionths with markup
          },
        }),
      });

      const record: SQSRecord = {
        messageId: "msg-1",
        receiptHandle: "receipt-1",
        body: JSON.stringify({
          reservationId: "res-1",
          openrouterGenerationId: "gen-12345",
          workspaceId: "workspace-1",
          conversationId: "conv-1",
          agentId: "agent-1",
        }),
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "1234567890000",
          SenderId: "test-sender",
          ApproximateFirstReceiveTimestamp: "1234567890000",
        },
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "",
        awsRegion: "",
      };

      await handler({ Records: [record] });

      // Verify conversation cost is sum of both finalCostUsd values
      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const updated = await updaterCall(conversationWithMultipleMessages);

      expect(updated.costUsd).toBe(3055); // 2000 + 1055
    });

    it("should handle backward compatibility with old API format (top-level cost)", async () => {
      // Mock reservation for single generation (backward compatibility)
      const mockReservation = {
        pk: "credit-reservations/res-1",
        workspaceId: "workspace-1",
        openrouterGenerationId: "gen-12345", // Single ID (old format)
        expectedGenerationCount: 1, // Will default to 1 if not set
        verifiedGenerationIds: [],
        verifiedCosts: [],
        reservedAmount: 5000,
        tokenUsageBasedCost: 4000,
      };

      mockGetReservation.mockResolvedValue(mockReservation);
      let currentReservation = { ...mockReservation };

      mockAtomicUpdateReservation.mockImplementation(
        async (_pk, _sk, updater) => {
          const updated = await updater(currentReservation);
          if (updated) {
            currentReservation = updated;
          }
          return updated || currentReservation;
        }
      );

      // Mock OpenRouter API response with old format (top-level cost)
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cost: 0.002, // Old format: top-level cost
        }),
      });

      const record: SQSRecord = {
        messageId: "msg-1",
        receiptHandle: "receipt-1",
        body: JSON.stringify({
          reservationId: "res-1",
          openrouterGenerationId: "gen-12345",
          workspaceId: "workspace-1",
        }),
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "1234567890000",
          SenderId: "test-sender",
          ApproximateFirstReceiveTimestamp: "1234567890000",
        },
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "",
        awsRegion: "",
      };

      await handler({ Records: [record] });

      // Verify finalizeCreditReservation was called with correct cost (0.002 * 1_000_000 * 1.055 = 2110 millionths)
      // With transaction system, context is now required
      expect(mockFinalizeCreditReservation).toHaveBeenCalledWith(
        mockDb,
        "res-1",
        2110, // Math.ceil(0.002 * 1_000_000 * 1.055) = 2110
        expect.objectContaining({
          addWorkspaceCreditTransaction: expect.any(Function),
        }),
        3
      );
    });

    it("should handle invalid message schema", async () => {
      const record: SQSRecord = {
        messageId: "msg-1",
        receiptHandle: "receipt-1",
        body: JSON.stringify({
          // Missing required fields
          workspaceId: "workspace-1",
        }),
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "1234567890000",
          SenderId: "test-sender",
          ApproximateFirstReceiveTimestamp: "1234567890000",
        },
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "",
        awsRegion: "",
      };

      const event: SQSEvent = { Records: [record] };

      // Should return failed message ID (handlingSQSErrors wraps and returns SQSBatchResponse)
      const response = await handler(event);

      expect(response.batchItemFailures).toHaveLength(1);
      expect(response.batchItemFailures[0].itemIdentifier).toBe("msg-1");
      expect(mockFinalizeCreditReservation).not.toHaveBeenCalled();
    });

    it("should accumulate costs for multiple generation IDs and finalize when all verified", async () => {
      // Mock reservation with multiple generation IDs
      const mockReservation = {
        pk: "credit-reservations/res-1",
        workspaceId: "workspace-1",
        openrouterGenerationIds: ["gen-12345", "gen-67890", "gen-abc123"],
        expectedGenerationCount: 3,
        verifiedGenerationIds: [],
        verifiedCosts: [],
        reservedAmount: 5000,
        tokenUsageBasedCost: 4000,
      };

      mockGetReservation.mockResolvedValue(mockReservation);
      let currentReservation = { ...mockReservation };

      // Mock atomic update for reservation
      mockAtomicUpdateReservation.mockImplementation(
        async (_pk, _sk, updater) => {
          const updated = await updater(currentReservation);
          if (updated) {
            currentReservation = updated;
          }
          return updated || currentReservation;
        }
      );

      // Mock OpenRouter API responses for each generation
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: { total_cost: 0.001 }, // $0.001 USD
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: { total_cost: 0.002 }, // $0.002 USD
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: { total_cost: 0.0015 }, // $0.0015 USD
          }),
        });

      // Process first generation
      const record1: SQSRecord = {
        messageId: "msg-1",
        receiptHandle: "receipt-1",
        body: JSON.stringify({
          reservationId: "res-1",
          openrouterGenerationId: "gen-12345",
          workspaceId: "workspace-1",
        }),
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "1234567890000",
          SenderId: "test-sender",
          ApproximateFirstReceiveTimestamp: "1234567890000",
        },
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "",
        awsRegion: "",
      };

      await handler({ Records: [record1] });

      // Verify first generation was added but not finalized
      // Note: atomicUpdate internally calls get, but our mock doesn't expose that
      expect(mockAtomicUpdateReservation).toHaveBeenCalledWith(
        "credit-reservations/res-1",
        undefined,
        expect.any(Function)
      );
      expect(mockFinalizeCreditReservation).not.toHaveBeenCalled();

      // Process second generation
      const record2: SQSRecord = {
        ...record1,
        messageId: "msg-2",
        body: JSON.stringify({
          reservationId: "res-1",
          openrouterGenerationId: "gen-67890",
          workspaceId: "workspace-1",
        }),
      };

      await handler({ Records: [record2] });

      // Still not all verified
      expect(mockFinalizeCreditReservation).not.toHaveBeenCalled();

      // Process third generation (should trigger finalization)
      const record3: SQSRecord = {
        ...record1,
        messageId: "msg-3",
        body: JSON.stringify({
          reservationId: "res-1",
          openrouterGenerationId: "gen-abc123",
          workspaceId: "workspace-1",
        }),
      };

      await handler({ Records: [record3] });

      // Now all should be verified and finalized
      // Total cost: Each cost has markup applied individually, then summed:
      // Cost 1: Math.ceil(0.001 * 1_000_000 * 1.055) = 1,055
      // Cost 2: Math.ceil(0.002 * 1_000_000 * 1.055) = 2,110
      // Cost 3: Math.ceil(0.0015 * 1_000_000 * 1.055) = 1,583
      // Total: 1,055 + 2,110 + 1,583 = 4,748
      expect(mockFinalizeCreditReservation).toHaveBeenCalledWith(
        mockDb,
        "res-1",
        4748, // Sum of individually marked-up costs
        expect.objectContaining({
          addWorkspaceCreditTransaction: expect.any(Function),
        }),
        3
      );
    });

    it("should handle idempotency - skip duplicate generation ID verification", async () => {
      const mockReservation = {
        pk: "credit-reservations/res-1",
        workspaceId: "workspace-1",
        openrouterGenerationIds: ["gen-12345", "gen-67890"],
        expectedGenerationCount: 2,
        verifiedGenerationIds: ["gen-12345"], // Already verified
        verifiedCosts: [1055], // Already has cost
        reservedAmount: 5000,
        tokenUsageBasedCost: 4000,
      };

      mockGetReservation.mockResolvedValue(mockReservation);
      mockAtomicUpdateReservation.mockImplementation(
        async (_pk, _sk, updater) => {
          const updated = await updater(mockReservation);
          return updated || mockReservation;
        }
      );

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { total_cost: 0.001 },
        }),
      });

      const record: SQSRecord = {
        messageId: "msg-1",
        receiptHandle: "receipt-1",
        body: JSON.stringify({
          reservationId: "res-1",
          openrouterGenerationId: "gen-12345", // Already verified
          workspaceId: "workspace-1",
        }),
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "1234567890000",
          SenderId: "test-sender",
          ApproximateFirstReceiveTimestamp: "1234567890000",
        },
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "",
        awsRegion: "",
      };

      await handler({ Records: [record] });

      // Should not finalize since not all verified yet
      expect(mockFinalizeCreditReservation).not.toHaveBeenCalled();

      // Verify the updater was called but returned unchanged (idempotency check)
      const updaterCall = mockAtomicUpdateReservation.mock.calls[0][2];
      const updated = await updaterCall(mockReservation);
      expect(updated.verifiedGenerationIds).toEqual(["gen-12345"]); // Unchanged
      expect(updated.verifiedCosts).toEqual([1055]); // Unchanged
    });
  });
});
