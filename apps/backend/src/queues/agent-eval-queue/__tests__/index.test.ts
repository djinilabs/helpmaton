import type { SQSEvent, SQSRecord } from "aws-lambda";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockExecuteEvaluation, mockGetCurrentSQSContext } =
  vi.hoisted(() => ({
    mockDatabase: vi.fn(),
    mockExecuteEvaluation: vi.fn(),
    mockGetCurrentSQSContext: vi.fn(),
  }));

// Mock the database module - index.ts imports from "../../tables" which exports database
vi.mock("../../tables", () => ({
  database: mockDatabase,
}));

// Mock @architect/functions for database initialization
vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

// Mock evalExecution - path is relative to test file location
vi.mock("../../../utils/evalExecution", () => ({
  executeEvaluation: mockExecuteEvaluation,
}));

import { handler } from "../index";

// Mock workspaceCreditContext functions - following pattern from openrouter-cost-verification-queue test
const mockContext = {
  awsRequestId: "test-request-id",
  addWorkspaceCreditTransaction: vi.fn(),
};

vi.mock("../../utils/workspaceCreditContext", () => ({
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
  getCurrentSQSContext: mockGetCurrentSQSContext,
}));

// Mock handlingSQSErrors - it wraps the handler, so we need to call the wrapped function
vi.mock("../../utils/handlingSQSErrors", () => ({
  handlingSQSErrors: (fn: (event: SQSEvent) => Promise<string[]>) => fn,
}));

// Mock posthog and sentry for handlingSQSErrors
vi.mock("../../utils/posthog", () => ({
  flushPostHog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/sentry", () => ({
  flushSentry: vi.fn().mockResolvedValue(undefined),
  ensureError: vi.fn((error) => error),
  Sentry: {
    captureException: vi.fn(),
    startSpan: vi.fn(async (_config, callback) => callback?.()),
    setTag: vi.fn(),
    setContext: vi.fn(),
    withScope: (
      callback: (scope: {
        setTag: () => void;
        setContext: () => void;
      }) => Promise<unknown>,
    ) =>
      callback({
        setTag: vi.fn(),
        setContext: vi.fn(),
      }),
  },
}));

describe("agent-eval-queue handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock database with required tables for executeEvaluation
    // Note: executeEvaluation is mocked, so we don't need to provide full table structure
    // But we still mock it in case the handler needs it
    mockDatabase.mockResolvedValue({
      "agent-eval-judge": {
        get: vi.fn(),
      },
      "agent-conversations": {
        get: vi.fn(),
      },
      agent: {
        get: vi.fn(),
      },
      "agent-eval-result": {
        put: vi.fn(),
      },
    } as never);
    mockGetCurrentSQSContext.mockReturnValue(mockContext);
    mockExecuteEvaluation.mockResolvedValue(undefined);
  });

  it("should process a single evaluation task successfully", async () => {
    const record: SQSRecord = {
      messageId: "msg-1",
      receiptHandle: "receipt-1",
      body: JSON.stringify({
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
        judgeId: "judge-1",
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
      eventSourceARN: "arn:aws:sqs:region:account:queue",
      awsRegion: "eu-west-2",
    };

    const event: SQSEvent = { Records: [record] };

    const result = await handler(event);

    expect(mockExecuteEvaluation).toHaveBeenCalledTimes(1);
    expect(mockExecuteEvaluation).toHaveBeenCalledWith(
      expect.anything(), // db object
      "workspace-123",
      "agent-456",
      "conversation-789",
      "judge-1",
      expect.objectContaining({
        awsRequestId: "msg-1",
        addWorkspaceCreditTransaction: expect.any(Function),
      }),
    );
    expect(result).toEqual({ batchItemFailures: [] }); // No failed messages
  });

  it("should process multiple evaluation tasks", async () => {
    const record1: SQSRecord = {
      messageId: "msg-1",
      receiptHandle: "receipt-1",
      body: JSON.stringify({
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
        judgeId: "judge-1",
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
      eventSourceARN: "arn:aws:sqs:region:account:queue",
      awsRegion: "eu-west-2",
    };

    const record2: SQSRecord = {
      ...record1,
      messageId: "msg-2",
      body: JSON.stringify({
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
        judgeId: "judge-2",
      }),
    };

    const event: SQSEvent = { Records: [record1, record2] };

    const result = await handler(event);

    expect(mockExecuteEvaluation).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ batchItemFailures: [] }); // No failed messages
  });

  it("should not request retries when processing fails", async () => {
    const record: SQSRecord = {
      messageId: "msg-1",
      receiptHandle: "receipt-1",
      body: JSON.stringify({
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
        judgeId: "judge-1",
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
      eventSourceARN: "arn:aws:sqs:region:account:queue",
      awsRegion: "eu-west-2",
    };

    mockExecuteEvaluation.mockRejectedValue(new Error("Evaluation failed"));

    const event: SQSEvent = { Records: [record] };

    const result = await handler(event);

    expect(result).toEqual({
      batchItemFailures: [],
    });
  });

  it("should handle invalid JSON in message body without retries", async () => {
    const record: SQSRecord = {
      messageId: "msg-1",
      receiptHandle: "receipt-1",
      body: "invalid json",
      attributes: {
        ApproximateReceiveCount: "1",
        SentTimestamp: "1234567890000",
        SenderId: "test-sender",
        ApproximateFirstReceiveTimestamp: "1234567890000",
      },
      messageAttributes: {},
      md5OfBody: "",
      eventSource: "aws:sqs",
      eventSourceARN: "arn:aws:sqs:region:account:queue",
      awsRegion: "eu-west-2",
    };

    const event: SQSEvent = { Records: [record] };

    const result = await handler(event);

    expect(mockExecuteEvaluation).not.toHaveBeenCalled();
    expect(result).toEqual({
      batchItemFailures: [],
    });
  });

  it("should process successfully when SQS context is available", async () => {
    // Note: handlingSQSErrors always sets the context before calling the handler,
    // so getCurrentSQSContext will always return a context. This test verifies
    // that the handler works correctly when the context is available (the normal case).
    const record: SQSRecord = {
      messageId: "msg-1",
      receiptHandle: "receipt-1",
      body: JSON.stringify({
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
        judgeId: "judge-1",
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
      eventSourceARN: "arn:aws:sqs:region:account:queue",
      awsRegion: "eu-west-2",
    };

    const event: SQSEvent = { Records: [record] };

    const result = await handler(event);

    // handlingSQSErrors always sets the context, so the handler should succeed
    expect(mockExecuteEvaluation).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      batchItemFailures: [],
    }); // Success - context is always available
  });

  it("should process some messages successfully and some fail without retries", async () => {
    const record1: SQSRecord = {
      messageId: "msg-1",
      receiptHandle: "receipt-1",
      body: JSON.stringify({
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
        judgeId: "judge-1",
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
      eventSourceARN: "arn:aws:sqs:region:account:queue",
      awsRegion: "eu-west-2",
    };

    const record2: SQSRecord = {
      ...record1,
      messageId: "msg-2",
      body: JSON.stringify({
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
        judgeId: "judge-2",
      }),
    };

    // Reset mocks
    mockGetCurrentSQSContext.mockReturnValue(mockContext);

    // First succeeds, second fails
    mockExecuteEvaluation
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Evaluation failed"));

    const event: SQSEvent = { Records: [record1, record2] };

    const result = await handler(event);

    expect(mockExecuteEvaluation).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      batchItemFailures: [],
    });
  });
});
