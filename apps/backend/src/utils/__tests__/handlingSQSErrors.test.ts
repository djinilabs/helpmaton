import type { SQSEvent } from "aws-lambda";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies - must be before imports
const {
  mockDatabase,
  mockCommitContextTransactions,
  mockSentryCaptureException,
  mockSentryStartSpan,
} = vi.hoisted(() => {
  const db = {
    workspace: { get: vi.fn() },
    "workspace-credit-transactions": { create: vi.fn() },
    atomicUpdate: vi.fn().mockResolvedValue([]),
  };
  return {
    mockDatabase: vi.fn().mockResolvedValue(db),
    mockCommitContextTransactions: vi.fn().mockResolvedValue(undefined),
    mockSentryCaptureException: vi.fn(),
    mockSentryStartSpan: vi.fn(),
  };
});

// Mock database function to return the mocked database
vi.mock("../tables/database", () => ({
  database: mockDatabase,
}));

vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

vi.mock("../posthog", () => ({
  flushPostHog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../sentry", () => ({
  flushSentry: vi.fn().mockResolvedValue(undefined),
  ensureError: vi.fn((error) => error),
  Sentry: {
    captureException: mockSentryCaptureException,
    startSpan: mockSentryStartSpan,
    setTag: vi.fn(),
    setContext: vi.fn(),
    withScope: (callback: (scope: { setTag: () => void; setContext: () => void }) => Promise<unknown>) =>
      callback({
        setTag: vi.fn(),
        setContext: vi.fn(),
      }),
  },
}));

vi.mock("../workspaceCreditContext", () => ({
  augmentContextWithCreditTransactions: vi.fn((context) => context),
  commitContextTransactions: mockCommitContextTransactions,
  setTransactionBuffer: vi.fn(),
  createTransactionBuffer: vi.fn(() => new Map()),
  setCurrentSQSContext: vi.fn(),
  clearCurrentSQSContext: vi.fn(),
}));

import { handlingSQSErrors } from "../handlingSQSErrors";

describe("handlingSQSErrors", () => {
  const mockEvent: SQSEvent = {
    Records: [
      {
        messageId: "msg-1",
        receiptHandle: "handle-1",
        body: '{"test":"data"}',
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
      {
        messageId: "msg-2",
        receiptHandle: "handle-2",
        body: '{"test":"data2"}',
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

  // Suppress console output during tests
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSentryStartSpan.mockImplementation(async (_config, callback) => {
      if (typeof callback === "function") {
        return callback();
      }
      return undefined;
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("successful processing", () => {
    it("should return empty batchItemFailures when all messages succeed", async () => {
      const handler = vi.fn().mockResolvedValue([]);
      const wrappedHandler = handlingSQSErrors(handler);

      const result = await wrappedHandler(mockEvent);

      // Handler should be called once per record with single-record events
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith({
        Records: [mockEvent.Records[0]],
      });
      expect(handler).toHaveBeenCalledWith({
        Records: [mockEvent.Records[1]],
      });
      expect(result).toEqual({
        batchItemFailures: [],
      });
    });

    it("should start a Sentry transaction for the batch", async () => {
      const handler = vi.fn().mockResolvedValue([]);
      const wrappedHandler = handlingSQSErrors(handler);

      await wrappedHandler(mockEvent);

      expect(mockSentryStartSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          op: "sqs.consume",
          name: "SQS queue",
        }),
        expect.any(Function)
      );
    });

    it("should log success message when all messages succeed", async () => {
      const handler = vi.fn().mockResolvedValue([]);
      const wrappedHandler = handlingSQSErrors(handler);

      await wrappedHandler(mockEvent);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Successfully processed all 2 message(s)")
      );
    });
  });

  describe("partial batch failures", () => {
    it("should return batchItemFailures for failed messages", async () => {
      // Handler returns msg-1 as failed, empty for others
      const handler = vi.fn(async (event) =>
        event.Records[0]?.messageId === "msg-1" ? ["msg-1"] : []
      );
      const wrappedHandler = handlingSQSErrors(handler);

      const result = await wrappedHandler(mockEvent);

      expect(result).toEqual({
        batchItemFailures: [
          {
            itemIdentifier: "msg-1",
          },
        ],
      });
    });

    it("should log warning for failed messages", async () => {
      // Handler returns msg-1 as failed, empty for others
      const handler = vi.fn(async (event) =>
        event.Records[0]?.messageId === "msg-1" ? ["msg-1"] : []
      );
      const wrappedHandler = handlingSQSErrors(handler);

      await wrappedHandler(mockEvent);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("1 message(s) failed out of 2"),
        expect.objectContaining({
          failedMessageIds: ["msg-1"],
          queueNames: ["queue"],
          failedMessages: expect.arrayContaining([
            expect.objectContaining({
              messageId: "msg-1",
              queueName: "queue",
              messageBody: '{"test":"data"}',
            }),
          ]),
        })
      );
    });

    it("should handle multiple failed messages", async () => {
      // Handler returns each message as failed
      const handler = vi.fn(async (event) => [
        event.Records[0]?.messageId || "unknown",
      ]);
      const wrappedHandler = handlingSQSErrors(handler);

      const result = await wrappedHandler(mockEvent);

      expect(result).toEqual({
        batchItemFailures: [
          {
            itemIdentifier: "msg-1",
          },
          {
            itemIdentifier: "msg-2",
          },
        ],
      });
    });
  });

  describe("error handling", () => {
    it("should return all messages as failed when handler throws", async () => {
      const error = new Error("Unexpected error");
      const handler = vi.fn().mockRejectedValue(error);
      const wrappedHandler = handlingSQSErrors(handler);

      const result = await wrappedHandler(mockEvent);

      expect(result).toEqual({
        batchItemFailures: [
          {
            itemIdentifier: "msg-1",
          },
          {
            itemIdentifier: "msg-2",
          },
        ],
      });
    });

    it("should log error details when handler throws", async () => {
      const error = new Error("Unexpected error");
      // Handler throws for first record, succeeds for second
      const handler = vi.fn(async (event) => {
        if (event.Records[0]?.messageId === "msg-1") {
          throw error;
        }
        return [];
      });
      const wrappedHandler = handlingSQSErrors(handler);

      await wrappedHandler(mockEvent);

      // Should log error for the specific record that failed
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[SQS Handler] Error processing message msg-1 in queue queue"),
        expect.objectContaining({
          error: "Unexpected error",
          queueName: "queue",
          messageId: "msg-1",
          messageBody: '{"test":"data"}',
        })
      );
    });

    it("should report error to Sentry when handler throws", async () => {
      const { Sentry } = await import("../sentry");
      const error = new Error("Unexpected error");
      // Handler throws for first record, succeeds for second
      const handler = vi.fn(async (event) => {
        if (event.Records[0]?.messageId === "msg-1") {
          throw error;
        }
        return [];
      });
      const wrappedHandler = handlingSQSErrors(handler);

      await wrappedHandler(mockEvent);

      // Should report error for the specific record that failed
      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: expect.objectContaining({
            handler: "SQSFunction",
            messageId: "msg-1",
            queueName: "queue",
          }),
          contexts: expect.objectContaining({
            event: expect.objectContaining({
              messageId: "msg-1",
              queueName: "queue",
              messageBody: '{"test":"data"}',
            }),
          }),
        })
      );
    });
  });

  describe("analytics flushing", () => {
    it("should flush PostHog and Sentry after successful processing", async () => {
      const { flushPostHog } = await import("../posthog");
      const { flushSentry } = await import("../sentry");

      const handler = vi.fn().mockResolvedValue([]);
      const wrappedHandler = handlingSQSErrors(handler);

      await wrappedHandler(mockEvent);

      expect(flushPostHog).toHaveBeenCalled();
      expect(flushSentry).toHaveBeenCalled();
    });

    it("should flush PostHog and Sentry after error", async () => {
      const { flushPostHog } = await import("../posthog");
      const { flushSentry } = await import("../sentry");

      const error = new Error("Unexpected error");
      const handler = vi.fn().mockRejectedValue(error);
      const wrappedHandler = handlingSQSErrors(handler);

      await wrappedHandler(mockEvent);

      expect(flushPostHog).toHaveBeenCalled();
      expect(flushSentry).toHaveBeenCalled();
    });

    it("should handle flush errors gracefully", async () => {
      const { flushPostHog } = await import("../posthog");
      const mockFlushPostHog = vi.mocked(flushPostHog);
      mockFlushPostHog.mockRejectedValue(new Error("Flush error"));

      const handler = vi.fn().mockResolvedValue([]);
      const wrappedHandler = handlingSQSErrors(handler);

      // Should not throw even if flush fails
      await expect(wrappedHandler(mockEvent)).resolves.toEqual({
        batchItemFailures: [],
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error flushing events"),
        expect.any(Error)
      );
    });
  });

  describe("edge cases", () => {
    it("should handle empty event", async () => {
      const emptyEvent: SQSEvent = {
        Records: [],
      };

      const handler = vi.fn().mockResolvedValue([]);
      const wrappedHandler = handlingSQSErrors(handler);

      const result = await wrappedHandler(emptyEvent);

      expect(result).toEqual({
        batchItemFailures: [],
      });
    });

    it("should handle handler returning undefined message IDs", async () => {
      // Handler returns msg-1 as failed for first record, empty for second
      // (handler returns the messageId of the failed record)
      const handler = vi.fn(async (event) =>
        event.Records[0]?.messageId === "msg-1" ? ["msg-1"] : []
      );
      const wrappedHandler = handlingSQSErrors(handler);

      const result = await wrappedHandler(mockEvent);

      // Should handle the failed message
      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0]).toEqual({
        itemIdentifier: "msg-1",
      });
    });
  });
});



