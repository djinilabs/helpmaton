import type { SQSEvent, SQSRecord } from "aws-lambda";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockDatabase,
  mockFinalizeCreditReservation,
  mockGet,
  mockAtomicUpdate,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockFinalizeCreditReservation: vi.fn(),
    mockGet: vi.fn(),
    mockAtomicUpdate: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../../tables/database", () => ({
  database: mockDatabase,
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

// Import after mocks are set up
import type { UIMessage } from "../../../http/post-api-workspaces-000workspaceId-agents-000agentId-test/utils/types";
import type { DatabaseSchema } from "../../../tables/schema";
import { handler } from "../index";

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

    it("should handle OpenRouter API 404 gracefully", async () => {
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

      await handler({ Records: [record] });

      // Should not finalize credit reservation
      expect(mockFinalizeCreditReservation).not.toHaveBeenCalled();

      // Should not update conversation
      expect(mockGet).not.toHaveBeenCalled();
      expect(mockAtomicUpdate).not.toHaveBeenCalled();
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
      expect(mockFinalizeCreditReservation).toHaveBeenCalledWith(
        mockDb,
        "res-1",
        2110, // Math.ceil(0.002 * 1_000_000 * 1.055) = 2110
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
  });
});

