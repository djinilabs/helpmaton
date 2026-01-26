import type { SQSEvent, SQSRecord } from "aws-lambda";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { DatabaseSchema } from "../../../tables/schema";
import type { UIMessage } from "../../../utils/messageTypes";
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
    setCurrentHTTPContext: vi.fn(),
    clearCurrentHTTPContext: vi.fn(),
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
  Sentry: {
    captureException: vi.fn(),
    startSpan: vi.fn(async (_config, callback) => callback?.()),
    setTag: vi.fn(),
    setContext: vi.fn(),
    withScope: (callback: (scope: { setTag: () => void; setContext: () => void }) => Promise<unknown>) =>
      callback({
        setTag: vi.fn(),
        setContext: vi.fn(),
      }),
  },
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
      costUsd: 1_000_000, // Initial cost in nano-dollars
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
        reservedAmount: 5_000_000_000,
        tokenUsageBasedCost: 4_000_000_000,
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

      // Verify finalizeCreditReservation was called with correct cost (0.001 * 1_000_000_000 * 1.055 = 1_055_000 nano-dollars)
      expect(mockFinalizeCreditReservation).toHaveBeenCalledWith(
        mockDb,
        "res-1",
        1_055_000, // Math.ceil(0.001 * 1_000_000_000 * 1.055) = 1_055_000
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
      expect(assistantMessage).toHaveProperty("finalCostUsd", 1_055_000);
      expect(updated.costUsd).toBe(1_055_000); // Conversation cost should be updated
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
        reservedAmount: 5_000_000_000,
        tokenUsageBasedCost: 4_000_000_000,
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

      // Verify markup was applied: 0.01 * 1_000_000_000 * 1.055 = 10,550,000 nano-dollars
      expect(mockFinalizeCreditReservation).toHaveBeenCalledWith(
        mockDb,
        "res-1",
        10_550_000,
        expect.objectContaining({
          addWorkspaceCreditTransaction: expect.any(Function),
        }),
        3
      );
    });

    it("should skip message update if conversation not found", async () => {
      // Mock get to return null for all retry attempts (3 retries = 4 total attempts)
      mockGet.mockResolvedValue(null);

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

      // Should not call atomicUpdate since conversation doesn't exist after all retries
      expect(mockAtomicUpdate).not.toHaveBeenCalled();
      
      // Should have called get multiple times due to retries (1 initial + 3 retries = 4 calls)
      expect(mockGet).toHaveBeenCalledTimes(4);
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
        reservedAmount: 5_000_000_000,
        tokenUsageBasedCost: 4_000_000_000,
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

    it("should not finalize when reservationId is missing", async () => {
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

      expect(mockFinalizeCreditReservation).not.toHaveBeenCalled();
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
            finalCostUsd: 2_000_000, // Already has finalCostUsd
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
            total_cost: 0.001, // Will become 1_055_000 nano-dollars with markup
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

      expect(updated.costUsd).toBe(3_055_000); // 2_000_000 + 1_055_000
    });

    it("should update tool-result cost when generation ID matches", async () => {
      const conversationWithToolResult = {
        ...mockConversation,
        messages: [
          {
            role: "user",
            content: "Generate an image",
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "tool-1",
                toolName: "generate_image",
                result: {
                  url: "https://example.com/image.png",
                },
                costUsd: 500,
                openrouterGenerationId: "gen-12345",
              },
            ],
          },
        ] as UIMessage[],
      };

      const mockReservation = {
        pk: "credit-reservations/res-1",
        workspaceId: "workspace-1",
        openrouterGenerationId: "gen-12345",
        expectedGenerationCount: 1,
        verifiedGenerationIds: [],
        verifiedCosts: [],
        reservedAmount: 5_000_000_000,
        tokenUsageBasedCost: 4_000_000_000,
      };

      mockGet.mockResolvedValueOnce(conversationWithToolResult);
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
            total_cost: 0.001, // Will become 1_055_000 nano-dollars with markup
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

      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const updated = await updaterCall(conversationWithToolResult);
      const toolMessage = (updated.messages as UIMessage[]).find(
        (msg) => msg.role === "tool"
      );
      const toolResult = Array.isArray(toolMessage?.content)
        ? toolMessage?.content.find(
            (item) => typeof item === "object" && item !== null && "type" in item && item.type === "tool-result"
          )
        : undefined;

      expect(toolResult && "costUsd" in toolResult ? toolResult.costUsd : undefined).toBe(1_055_000);
      expect(updated.costUsd).toBe(1_055_000);
    });

    it("should use actual cost from OpenRouter API, not transaction/refund amount", async () => {
      // This test verifies that finalCostUsd uses the actual cost, not the transaction amount
      // Scenario: OpenRouter cost is 1_000_000, token usage cost is 1_200_000
      // The transaction amount would be 200_000 (refund), but finalCostUsd should be 1_000_000 (actual cost)
      
      const mockReservation = {
        pk: "credit-reservations/res-1",
        workspaceId: "workspace-1",
        openrouterGenerationId: "gen-12345",
        expectedGenerationCount: 1,
        verifiedGenerationIds: [],
        verifiedCosts: [],
        reservedAmount: 5_000_000_000,
        tokenUsageBasedCost: 1_200_000_000, // Token usage cost is higher than OpenRouter cost
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

      // Mock OpenRouter API to return cost of 0.001 (1_000_000 nano-dollars with markup = 1_055_000)
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            total_cost: 0.001, // $0.001 USD = 1_000_000 nano-dollars base, 1_055_000 with markup
          },
        }),
      });

      const conversationWithMessage = {
        ...mockConversation,
        messages: [
          {
            role: "assistant",
            content: "Test response",
            modelName: "openrouter/auto",
            provider: "openrouter",
            openrouterGenerationId: "gen-12345",
            tokenUsage: {
              promptTokens: 100,
              completionTokens: 50,
            },
          },
        ] as UIMessage[],
      };

      mockGet.mockResolvedValueOnce(conversationWithMessage);

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

      // Verify finalizeCreditReservation was called with actual cost (1_055_000), not transaction amount
      expect(mockFinalizeCreditReservation).toHaveBeenCalledWith(
        expect.anything(),
        "res-1",
        1_055_000, // Actual cost from OpenRouter API (with markup), NOT the transaction amount
        expect.anything(),
        3
      );

      // Verify the message was updated with actual cost, not transaction amount
      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const updated = await updaterCall(conversationWithMessage);

      const updatedMessages = updated.messages as UIMessage[];
      const assistantMessage = updatedMessages.find(
        (msg) => msg.role === "assistant"
      );

      expect(assistantMessage).toBeDefined();
      // finalCostUsd should be the actual cost (1_055_000), NOT the transaction amount (200,000 refund)
      // Transaction amount would be: -(1_055_000 - 1_200_000) = 145_000 (refund)
      // But finalCostUsd must be the actual cost: 1_055_000
      expect(assistantMessage).toHaveProperty("finalCostUsd", 1_055_000);
      expect(updated.costUsd).toBe(1_055_000);
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
        reservedAmount: 5_000_000_000,
        tokenUsageBasedCost: 4_000_000_000,
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

      // Verify finalizeCreditReservation was called with correct cost (0.002 * 1_000_000_000 * 1.055 = 2_110_000 nano-dollars)
      // With transaction system, context is now required
      expect(mockFinalizeCreditReservation).toHaveBeenCalledWith(
        mockDb,
        "res-1",
        2_110_000, // Math.ceil(0.002 * 1_000_000_000 * 1.055) = 2_110_000
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
        reservedAmount: 5_000_000_000,
        tokenUsageBasedCost: 4_000_000_000,
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
      // Cost 1: Math.ceil(0.001 * 1_000_000_000 * 1.055) = 1_055_000
      // Cost 2: Math.ceil(0.002 * 1_000_000_000 * 1.055) = 2_110_000
      // Cost 3: Math.ceil(0.0015 * 1_000_000_000 * 1.055) = 1_582_500
      // Total: 1_055_000 + 2_110_000 + 1_582_500 = 4_747_500
      expect(mockFinalizeCreditReservation).toHaveBeenCalledWith(
        mockDb,
        "res-1",
        4_747_500, // Sum of individually marked-up costs
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
        verifiedCosts: [1_055_000], // Already has cost
        reservedAmount: 5_000_000_000,
        tokenUsageBasedCost: 4_000_000_000,
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
      expect(updated.verifiedCosts).toEqual([1_055_000]); // Unchanged
    });

    it("should handle out-of-order generation verification", async () => {
      const mockReservation = {
        pk: "credit-reservations/res-1",
        workspaceId: "workspace-1",
        openrouterGenerationIds: ["gen-1", "gen-2", "gen-3"],
        expectedGenerationCount: 3,
        verifiedGenerationIds: [],
        verifiedCosts: [],
        reservedAmount: 5_000_000_000,
        tokenUsageBasedCost: 4_000_000_000,
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

      // Verify generations arrive out of order: gen-2, then gen-3, then gen-1
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: { total_cost: 0.001 }, // gen-2 cost
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: { total_cost: 0.0015 }, // gen-3 cost
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: { total_cost: 0.0008 }, // gen-1 cost
          }),
        });

      // Process gen-2 first
      const record2: SQSRecord = {
        messageId: "msg-2",
        receiptHandle: "receipt-2",
        body: JSON.stringify({
          reservationId: "res-1",
          openrouterGenerationId: "gen-2",
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

      await handler({ Records: [record2] });
      expect(mockFinalizeCreditReservation).not.toHaveBeenCalled(); // Not all verified yet

      // Process gen-3 second
      const record3: SQSRecord = {
        ...record2,
        messageId: "msg-3",
        body: JSON.stringify({
          reservationId: "res-1",
          openrouterGenerationId: "gen-3",
          workspaceId: "workspace-1",
        }),
      };

      await handler({ Records: [record3] });
      expect(mockFinalizeCreditReservation).not.toHaveBeenCalled(); // Still not all verified

      // Process gen-1 last (should trigger finalization)
      const record1: SQSRecord = {
        ...record2,
        messageId: "msg-1",
        body: JSON.stringify({
          reservationId: "res-1",
          openrouterGenerationId: "gen-1",
          workspaceId: "workspace-1",
        }),
      };

      await handler({ Records: [record1] });

      // Now all should be verified and finalized
      // Total cost: Each cost has markup applied individually, then summed:
      // Cost 1 (gen-1): Math.ceil(0.0008 * 1_000_000_000 * 1.055) = 844_000
      // Cost 2 (gen-2): Math.ceil(0.001 * 1_000_000_000 * 1.055) = 1_055_000
      // Cost 3 (gen-3): Math.ceil(0.0015 * 1_000_000_000 * 1.055) = 1_582_500
      // Total: 844_000 + 1_055_000 + 1_582_500 = 3_481_500
      expect(mockFinalizeCreditReservation).toHaveBeenCalledWith(
        mockDb,
        "res-1",
        3_481_500, // Sum of individually marked-up costs
        expect.objectContaining({
          addWorkspaceCreditTransaction: expect.any(Function),
        }),
        3
      );
    });

    it("should handle count mismatch gracefully when fewer generations arrive than expected", async () => {
      const mockReservation = {
        pk: "credit-reservations/res-1",
        workspaceId: "workspace-1",
        openrouterGenerationIds: ["gen-1", "gen-2", "gen-3"],
        expectedGenerationCount: 3,
        verifiedGenerationIds: ["gen-1", "gen-2"], // Only 2 verified
        verifiedCosts: [1_055_000, 1_055_000],
        reservedAmount: 5_000_000_000,
        tokenUsageBasedCost: 4_000_000_000,
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
          openrouterGenerationId: "gen-3",
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

      // Should finalize when all expected generations are verified
      expect(mockFinalizeCreditReservation).toHaveBeenCalled();
    });

    it("should handle extra generation ID by finalizing when count matches", async () => {
      const mockReservation = {
        pk: "credit-reservations/res-1",
        workspaceId: "workspace-1",
        openrouterGenerationIds: ["gen-1", "gen-2"],
        expectedGenerationCount: 2,
        verifiedGenerationIds: ["gen-1"], // Only one verified so far
        verifiedCosts: [1_055_000],
        reservedAmount: 5_000_000_000,
        tokenUsageBasedCost: 4_000_000_000,
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

      // Verify a generation ID (even if it's not in the original list)
      // The system will add it and finalize when count matches expected
      const record: SQSRecord = {
        messageId: "msg-1",
        receiptHandle: "receipt-1",
        body: JSON.stringify({
          reservationId: "res-1",
          openrouterGenerationId: "gen-extra", // Not in original openrouterGenerationIds
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

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { total_cost: 0.001 },
        }),
      });

      await handler({ Records: [record] });

      // System finalizes when verified count (2) matches expected count (2)
      // It doesn't validate that the IDs match the original list
      expect(mockFinalizeCreditReservation).toHaveBeenCalled();
    });
  });
});
