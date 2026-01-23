import { describe, it, expect, vi, beforeEach } from "vitest";

// eslint-disable-next-line import/order
import {
  createAPIGatewayEvent,
  createMockContext,
} from "../../utils/__tests__/test-helpers";

const {
  mockStreamsHandler,
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
  mockStreamsHandler: vi.fn(),
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

vi.mock("../../any-api-streams-catchall", () => ({
  handler: mockStreamsHandler,
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
    mockStreamsHandler.mockResolvedValue({ statusCode: 200, body: "ok" });
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

  it("routes SQS events to the correct queue handler", async () => {
    const event = {
      Records: [
        {
          eventSource: "aws:sqs",
          eventSourceARN:
            "arn:aws:sqs:eu-west-2:123456789012:agent-temporal-grain-queue",
        },
      ],
    };

    await handler(event, mockContext);

    expect(mockAgentTemporalGrainQueueHandler).toHaveBeenCalledWith(
      event,
      mockContext,
      undefined
    );
  });

  it("routes scheduled events to the correct handler", async () => {
    const event = {
      source: "aws.events",
      resources: [
        "arn:aws:events:eu-west-2:123456789012:rule/SummarizeMemoryDailyScheduledRule",
      ],
    };

    await handler(event, mockContext);

    expect(mockSummarizeDailyHandler).toHaveBeenCalledWith(
      event,
      mockContext,
      undefined
    );
  });

  it("routes HTTP events to the correct handler", async () => {
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
