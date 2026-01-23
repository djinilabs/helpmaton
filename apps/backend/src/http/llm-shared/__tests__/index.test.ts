import { describe, it, expect, vi, beforeEach } from "vitest";

// eslint-disable-next-line import/order
import {
  createAPIGatewayEvent,
  createMockContext,
} from "../../utils/__tests__/test-helpers";

const {
  mockStreamsInternalHandler,
  mockWebhookHandler,
  mockWorkspacesHandler,
  mockWorkspacesCatchallHandler,
  mockAgentTemporalGrainQueueHandler,
  mockAgentDelegationQueueHandler,
  mockBotWebhookQueueHandler,
  mockAgentScheduleQueueHandler,
  mockAgentEvalQueueHandler,
  mockWebhookQueueHandler,
  mockSummarizeDailyHandler,
  mockSummarizeWeeklyHandler,
  mockSummarizeMonthlyHandler,
  mockSummarizeQuarterlyHandler,
  mockSummarizeYearlyHandler,
  mockCleanupMemoryRetentionHandler,
} = vi.hoisted(() => ({
  mockStreamsInternalHandler: vi.fn(),
  mockWebhookHandler: vi.fn(),
  mockWorkspacesHandler: vi.fn(),
  mockWorkspacesCatchallHandler: vi.fn(),
  mockAgentTemporalGrainQueueHandler: vi.fn(),
  mockAgentDelegationQueueHandler: vi.fn(),
  mockBotWebhookQueueHandler: vi.fn(),
  mockAgentScheduleQueueHandler: vi.fn(),
  mockAgentEvalQueueHandler: vi.fn(),
  mockWebhookQueueHandler: vi.fn(),
  mockSummarizeDailyHandler: vi.fn(),
  mockSummarizeWeeklyHandler: vi.fn(),
  mockSummarizeMonthlyHandler: vi.fn(),
  mockSummarizeQuarterlyHandler: vi.fn(),
  mockSummarizeYearlyHandler: vi.fn(),
  mockCleanupMemoryRetentionHandler: vi.fn(),
}));

vi.mock("../../any-api-streams-catchall/internalHandler", () => ({
  internalHandler: mockStreamsInternalHandler,
}));

vi.mock("../../post-api-webhook-000workspaceId-000agentId-000key", () => ({
  handler: mockWebhookHandler,
}));

vi.mock("../../any-api-workspaces", () => ({
  handler: mockWorkspacesHandler,
}));

vi.mock("../../any-api-workspaces-catchall", () => ({
  handler: mockWorkspacesCatchallHandler,
}));

vi.mock("../../../queues/agent-temporal-grain-queue", () => ({
  handler: mockAgentTemporalGrainQueueHandler,
}));

vi.mock("../../../queues/agent-delegation-queue", () => ({
  handler: mockAgentDelegationQueueHandler,
}));

vi.mock("../../../queues/bot-webhook-queue", () => ({
  handler: mockBotWebhookQueueHandler,
}));

vi.mock("../../../queues/agent-schedule-queue", () => ({
  handler: mockAgentScheduleQueueHandler,
}));

vi.mock("../../../queues/agent-eval-queue", () => ({
  handler: mockAgentEvalQueueHandler,
}));

vi.mock("../../../queues/webhook-queue", () => ({
  handler: mockWebhookQueueHandler,
}));

vi.mock("../../../scheduled/summarize-memory-daily", () => ({
  handler: mockSummarizeDailyHandler,
}));

vi.mock("../../../scheduled/summarize-memory-weekly", () => ({
  handler: mockSummarizeWeeklyHandler,
}));

vi.mock("../../../scheduled/summarize-memory-monthly", () => ({
  handler: mockSummarizeMonthlyHandler,
}));

vi.mock("../../../scheduled/summarize-memory-quarterly", () => ({
  handler: mockSummarizeQuarterlyHandler,
}));

vi.mock("../../../scheduled/summarize-memory-yearly", () => ({
  handler: mockSummarizeYearlyHandler,
}));

vi.mock("../../../scheduled/cleanup-memory-retention", () => ({
  handler: mockCleanupMemoryRetentionHandler,
}));

import { handler } from "../index";

describe("llm-shared handler", () => {
  const mockContext = createMockContext();

  beforeEach(() => {
    vi.clearAllMocks();
    mockStreamsInternalHandler.mockImplementation(async (_event, responseStream) => {
      responseStream.write("ok");
      responseStream.end();
    });
    mockWebhookHandler.mockResolvedValue({ statusCode: 200, body: "ok" });
    mockWorkspacesHandler.mockResolvedValue({ statusCode: 200, body: "ok" });
    mockWorkspacesCatchallHandler.mockResolvedValue({
      statusCode: 200,
      body: "ok",
    });
    mockAgentTemporalGrainQueueHandler.mockResolvedValue(undefined);
    mockAgentDelegationQueueHandler.mockResolvedValue(undefined);
    mockBotWebhookQueueHandler.mockResolvedValue(undefined);
    mockAgentScheduleQueueHandler.mockResolvedValue(undefined);
    mockAgentEvalQueueHandler.mockResolvedValue(undefined);
    mockWebhookQueueHandler.mockResolvedValue(undefined);
    mockSummarizeDailyHandler.mockResolvedValue(undefined);
    mockSummarizeWeeklyHandler.mockResolvedValue(undefined);
    mockSummarizeMonthlyHandler.mockResolvedValue(undefined);
    mockSummarizeQuarterlyHandler.mockResolvedValue(undefined);
    mockSummarizeYearlyHandler.mockResolvedValue(undefined);
    mockCleanupMemoryRetentionHandler.mockResolvedValue(undefined);
  });

  it.each([
    ["agent-temporal-grain-queue", mockAgentTemporalGrainQueueHandler],
    ["agent-delegation-queue", mockAgentDelegationQueueHandler],
    ["bot-webhook-queue", mockBotWebhookQueueHandler],
    ["agent-schedule-queue", mockAgentScheduleQueueHandler],
    ["agent-eval-queue", mockAgentEvalQueueHandler],
    ["webhook-queue", mockWebhookQueueHandler],
  ])("routes SQS events for %s", async (queueName, queueHandler) => {
    const event = {
      Records: [
        {
          eventSource: "aws:sqs",
          eventSourceARN: `arn:aws:sqs:eu-west-2:123456789012:${queueName}`,
        },
      ],
    };

    await handler(event, mockContext);

    expect(queueHandler).toHaveBeenCalledWith(event, mockContext, undefined);
  });

  it("routes SQS events for physical FIFO queue names", async () => {
    const event = {
      Records: [
        {
          eventSource: "aws:sqs",
          eventSourceARN:
            "arn:aws:sqs:eu-west-2:123456789012:HelpmatonStagingPR210-WebhookQueueQueue-ABC123.fifo",
        },
      ],
    };

    await handler(event, mockContext);

    expect(mockWebhookQueueHandler).toHaveBeenCalledWith(
      event,
      mockContext,
      undefined
    );
  });

  it("throws for unknown SQS queues", async () => {
    const event = {
      Records: [
        {
          eventSource: "aws:sqs",
          eventSourceARN:
            "arn:aws:sqs:eu-west-2:123456789012:unknown-queue",
        },
      ],
    };

    await expect(handler(event, mockContext)).rejects.toThrow(
      "[llm-shared] Unknown SQS queue for event"
    );
  });

  it.each([
    ["summarize-memory-daily", mockSummarizeDailyHandler],
    ["summarize-memory-weekly", mockSummarizeWeeklyHandler],
    ["summarize-memory-monthly", mockSummarizeMonthlyHandler],
    ["summarize-memory-quarterly", mockSummarizeQuarterlyHandler],
    ["summarize-memory-yearly", mockSummarizeYearlyHandler],
    ["cleanup-memory-retention", mockCleanupMemoryRetentionHandler],
  ])("routes scheduled events for %s", async (scheduleName, scheduleHandler) => {
    const event = {
      source: "aws.events",
      resources: [
        `arn:aws:events:eu-west-2:123456789012:rule/${scheduleName}`,
      ],
    };

    await handler(event, mockContext);

    expect(scheduleHandler).toHaveBeenCalledWith(
      event,
      mockContext,
      undefined
    );
  });

  it("throws for unknown scheduled events", async () => {
    const event = {
      source: "aws.events",
      resources: [
        "arn:aws:events:eu-west-2:123456789012:rule/unknown-schedule",
      ],
    };

    await expect(handler(event, mockContext)).rejects.toThrow(
      "[llm-shared] Unknown scheduled event"
    );
  });

  it("routes HTTP webhook events to the correct handler", async () => {
    const event = createAPIGatewayEvent({
      path: "/api/webhook/workspace/agent/key",
    });

    await handler(event, mockContext);

    expect(mockWebhookHandler).toHaveBeenCalledWith(
      event,
      mockContext,
      undefined
    );
  });

  it("routes HTTP workspaces root to the correct handler", async () => {
    const event = createAPIGatewayEvent({
      path: "/api/workspaces",
    });

    await handler(event, mockContext);

    expect(mockWorkspacesHandler).toHaveBeenCalledWith(
      event,
      mockContext,
      undefined
    );
  });

  it("routes HTTP workspaces catchall to the correct handler", async () => {
    const event = createAPIGatewayEvent({
      path: "/api/workspaces/123",
    });

    await handler(event, mockContext);

    expect(mockWorkspacesCatchallHandler).toHaveBeenCalledWith(
      event,
      mockContext,
      undefined
    );
  });

  it("buffers stream responses for API Gateway", async () => {
    const event = createAPIGatewayEvent({
      path: "/api/streams/test",
    });

    const result = await handler(event, mockContext);

    expect(mockStreamsInternalHandler).toHaveBeenCalled();
    expect(result).toEqual({
      statusCode: 200,
      headers: {},
      body: "ok",
    });
  });

  it("returns 404 for unknown HTTP routes", async () => {
    const event = createAPIGatewayEvent({
      path: "/api/unknown",
    });

    const result = await handler(event, mockContext);

    expect(result).toEqual({
      statusCode: 404,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: "Route not found" }),
    });
  });
});
