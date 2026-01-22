import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  WebhookQueueMessageSchema,
  enqueueWebhookTask,
} from "../webhookQueue";

vi.mock("@architect/functions", () => ({
  queues: {
    publish: vi.fn(),
  },
}));

describe("webhookQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues webhook tasks with the expected payload", async () => {
    const { queues } = await import("@architect/functions");
    const mockPublish = vi.mocked(queues.publish);
    mockPublish.mockResolvedValue(undefined);

    await enqueueWebhookTask(
      "workspace-123",
      "agent-456",
      "hello from webhook",
      "conversation-789",
      "sub-123"
    );

    expect(mockPublish).toHaveBeenCalledWith({
      name: "webhook-queue",
      payload: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        bodyText: "hello from webhook",
        conversationId: "conversation-789",
        subscriptionId: "sub-123",
      },
    });
  });

  it("rejects payloads with unexpected fields", () => {
    const result = WebhookQueueMessageSchema.safeParse({
      workspaceId: "workspace-123",
      agentId: "agent-456",
      bodyText: "hello",
      conversationId: "conversation-789",
      extra: "nope",
    });

    expect(result.success).toBe(false);
  });
});
