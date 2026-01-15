import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @architect/functions
const { mockQueuesPublish } = vi.hoisted(() => ({
  mockQueuesPublish: vi.fn(),
}));

vi.mock("@architect/functions", () => ({
  queues: {
    publish: mockQueuesPublish,
  },
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

// Mock database - following pattern from streamServerUtils.test.ts
const mockDatabase = vi.hoisted(() => vi.fn());

// Mock the tables module - evalEnqueue uses await import("../tables")
// Path is relative to test file location: __tests__/evalEnqueue.test.ts -> ../tables -> utils/../tables -> tables
vi.mock("../../tables", () => ({
  database: mockDatabase,
}));

// Import after mocks are set up - following pattern from streamServerUtils.test.ts
import { enqueueEvaluations } from "../evalEnqueue";

describe("evalEnqueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueuesPublish.mockResolvedValue(undefined);
  });

  it("should enqueue evaluation tasks for all enabled judges", async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      items: [
        {
          judgeId: "judge-1",
          name: "Judge 1",
          enabled: true,
        },
        {
          judgeId: "judge-2",
          name: "Judge 2",
          enabled: true,
        },
      ],
      areAnyUnpublished: false,
    });

    const mockDb = {
      "agent-eval-judge": {
        query: mockQuery,
      },
    };

    // Set up database mock - following pattern from streamServerUtils.test.ts
    mockDatabase.mockResolvedValue(mockDb as never);

    await enqueueEvaluations("workspace-123", "agent-456", "conversation-789");

    expect(mockQueuesPublish).toHaveBeenCalledTimes(2);
    expect(mockQueuesPublish).toHaveBeenCalledWith({
      name: "agent-eval-queue",
      payload: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
        judgeId: "judge-1",
      },
    });
    expect(mockQueuesPublish).toHaveBeenCalledWith({
      name: "agent-eval-queue",
      payload: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
        judgeId: "judge-2",
      },
    });
  });

  it("should only query enabled judges (filtered by query)", async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      items: [
        {
          judgeId: "judge-1",
          name: "Judge 1",
          enabled: true,
        },
        // Note: Disabled judges are filtered out by the query FilterExpression
        // So they won't appear in items
      ],
      areAnyUnpublished: false,
    });

    const mockDb = {
      "agent-eval-judge": {
        query: mockQuery,
      },
    };

    mockDatabase.mockResolvedValue(mockDb as never);

    await enqueueEvaluations("workspace-123", "agent-456", "conversation-789");

    // Verify the query includes the enabled filter
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        FilterExpression: "#enabled = :enabled",
        ExpressionAttributeNames: {
          "#enabled": "enabled",
        },
        ExpressionAttributeValues: {
          ":agentId": "agent-456",
          ":enabled": true,
        },
      })
    );
    // Only enabled judge should be enqueued
    expect(mockQueuesPublish).toHaveBeenCalledTimes(1);
  });

  it("should return early if no enabled judges found", async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      items: [],
      areAnyUnpublished: false,
    });

    const mockDb = {
      "agent-eval-judge": {
        query: mockQuery,
      },
    };

    mockDatabase.mockResolvedValue(mockDb as never);

    await enqueueEvaluations("workspace-123", "agent-456", "conversation-789");

    expect(mockQueuesPublish).not.toHaveBeenCalled();
  });

  it("should continue enqueueing other judges if one fails", async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      items: [
        {
          judgeId: "judge-1",
          name: "Judge 1",
          enabled: true,
        },
        {
          judgeId: "judge-2",
          name: "Judge 2",
          enabled: true,
        },
        {
          judgeId: "judge-3",
          name: "Judge 3",
          enabled: true,
        },
      ],
      areAnyUnpublished: false,
    });

    const mockDb = {
      "agent-eval-judge": {
        query: mockQuery,
      },
    };

    mockDatabase.mockResolvedValue(mockDb as never);

    // Make the second call fail
    mockQueuesPublish
      .mockResolvedValueOnce(undefined) // First call succeeds
      .mockRejectedValueOnce(new Error("Queue error")) // Second call fails
      .mockResolvedValueOnce(undefined); // Third call succeeds

    await enqueueEvaluations("workspace-123", "agent-456", "conversation-789");

    // All three should have been attempted
    expect(mockQueuesPublish).toHaveBeenCalledTimes(3);
  });
});
