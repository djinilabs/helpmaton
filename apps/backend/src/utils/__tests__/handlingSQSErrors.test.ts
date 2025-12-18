import type { SQSEvent } from "aws-lambda";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { handlingSQSErrors } from "../handlingSQSErrors";

// Mock dependencies
vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
}));

vi.mock("../posthog", () => ({
  flushPostHog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../sentry", () => ({
  flushSentry: vi.fn().mockResolvedValue(undefined),
  ensureError: vi.fn((error) => error),
}));

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

      expect(handler).toHaveBeenCalledWith(mockEvent);
      expect(result).toEqual({
        batchItemFailures: [],
      });
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
      const failedMessageIds = ["msg-1"];
      const handler = vi.fn().mockResolvedValue(failedMessageIds);
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
      const failedMessageIds = ["msg-1"];
      const handler = vi.fn().mockResolvedValue(failedMessageIds);
      const wrappedHandler = handlingSQSErrors(handler);

      await wrappedHandler(mockEvent);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("1 message(s) failed out of 2"),
        failedMessageIds
      );
    });

    it("should handle multiple failed messages", async () => {
      const failedMessageIds = ["msg-1", "msg-2"];
      const handler = vi.fn().mockResolvedValue(failedMessageIds);
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
      const handler = vi.fn().mockRejectedValue(error);
      const wrappedHandler = handlingSQSErrors(handler);

      await wrappedHandler(mockEvent);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "SQS function error:",
        expect.objectContaining({
          error: "Unexpected error",
          event: {
            recordCount: 2,
            messageIds: ["msg-1", "msg-2"],
          },
        })
      );
    });

    it("should report error to Sentry when handler throws", async () => {
      const { captureException } = await import("@sentry/node");
      const error = new Error("Unexpected error");
      const handler = vi.fn().mockRejectedValue(error);
      const wrappedHandler = handlingSQSErrors(handler);

      await wrappedHandler(mockEvent);

      expect(captureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          tags: expect.objectContaining({
            handler: "SQSFunction",
            recordCount: 2,
          }),
          contexts: expect.objectContaining({
            event: expect.objectContaining({
              recordCount: 2,
              messageIds: ["msg-1", "msg-2"],
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
      const handler = vi.fn().mockResolvedValue([undefined, "msg-1", null]);
      const wrappedHandler = handlingSQSErrors(handler);

      const result = await wrappedHandler(mockEvent);

      // Should handle undefined/null gracefully
      expect(result.batchItemFailures).toHaveLength(3);
      expect(result.batchItemFailures[1]).toEqual({
        itemIdentifier: "msg-1",
      });
    });
  });
});


