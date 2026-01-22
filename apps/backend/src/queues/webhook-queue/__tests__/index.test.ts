import type { SQSEvent, SQSRecord } from "aws-lambda";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockProcessWebhookTask, mockGetCurrentSQSContext } = vi.hoisted(() => ({
  mockProcessWebhookTask: vi.fn(),
  mockGetCurrentSQSContext: vi.fn(),
}));

vi.mock("../webhookTask", () => ({
  processWebhookTask: mockProcessWebhookTask,
}));

vi.mock("../../../utils/workspaceCreditContext", () => ({
  getCurrentSQSContext: mockGetCurrentSQSContext,
}));

vi.mock("../../../utils/handlingSQSErrors", () => ({
  handlingSQSErrors: (fn: (event: SQSEvent) => Promise<string[]>) => fn,
}));

vi.mock("../../../utils/sentry", () => ({
  ensureError: vi.fn((error) => error),
  Sentry: {
    captureException: vi.fn(),
  },
}));

import { handler } from "../index";

describe("webhook-queue handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentSQSContext.mockReturnValue({
      awsRequestId: "msg-1",
      addWorkspaceCreditTransaction: vi.fn(),
    });
  });

  it("processes webhook queue messages", async () => {
    const record: SQSRecord = {
      messageId: "msg-1",
      receiptHandle: "receipt-1",
      body: JSON.stringify({
        workspaceId: "workspace-123",
        agentId: "agent-456",
        bodyText: "hello",
        conversationId: "conversation-789",
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

    expect(mockProcessWebhookTask).toHaveBeenCalledWith({
      workspaceId: "workspace-123",
      agentId: "agent-456",
      bodyText: "hello",
      conversationId: "conversation-789",
      subscriptionId: undefined,
      context: expect.objectContaining({
        awsRequestId: "msg-1",
        addWorkspaceCreditTransaction: expect.any(Function),
      }),
      awsRequestId: "msg-1",
    });
    expect(result).toEqual([]);
  });

  it("returns failed message IDs for invalid JSON", async () => {
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

    expect(mockProcessWebhookTask).not.toHaveBeenCalled();
    expect(result).toEqual(["msg-1"]);
  });
});
