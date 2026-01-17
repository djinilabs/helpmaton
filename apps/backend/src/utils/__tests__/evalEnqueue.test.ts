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
    // Mock queryAsync as an async generator
    const mockQueryAsync = vi.fn(async function* () {
      yield {
        judgeId: "judge-1",
        name: "Judge 1",
        enabled: true,
        samplingProbability: 100,
      };
      yield {
        judgeId: "judge-2",
        name: "Judge 2",
        enabled: true,
        samplingProbability: 100,
      };
    });

    const mockDb = {
      "agent-eval-judge": {
        queryAsync: mockQueryAsync,
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
    // Mock queryAsync as an async generator
    const mockQueryAsync = vi.fn(async function* () {
      yield {
        judgeId: "judge-1",
        name: "Judge 1",
        enabled: true,
      };
      // Note: Disabled judges are filtered out by the query FilterExpression
      // So they won't appear in the generator
    });

    const mockDb = {
      "agent-eval-judge": {
        queryAsync: mockQueryAsync,
      },
    };

    mockDatabase.mockResolvedValue(mockDb as never);

    await enqueueEvaluations("workspace-123", "agent-456", "conversation-789");

    // Verify the query includes the enabled filter
    expect(mockQueryAsync).toHaveBeenCalledWith(
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
    // Mock queryAsync as an async generator that yields nothing
    const mockQueryAsync = vi.fn(async function* () {
      // Yield nothing - no enabled judges
    });

    const mockDb = {
      "agent-eval-judge": {
        queryAsync: mockQueryAsync,
      },
    };

    mockDatabase.mockResolvedValue(mockDb as never);

    await enqueueEvaluations("workspace-123", "agent-456", "conversation-789");

    expect(mockQueuesPublish).not.toHaveBeenCalled();
  });

  it("should continue enqueueing other judges if one fails", async () => {
    // Mock queryAsync as an async generator
    const mockQueryAsync = vi.fn(async function* () {
      yield {
        judgeId: "judge-1",
        name: "Judge 1",
        enabled: true,
        samplingProbability: 100,
      };
      yield {
        judgeId: "judge-2",
        name: "Judge 2",
        enabled: true,
        samplingProbability: 100,
      };
      yield {
        judgeId: "judge-3",
        name: "Judge 3",
        enabled: true,
        samplingProbability: 100,
      };
    });

    const mockDb = {
      "agent-eval-judge": {
        queryAsync: mockQueryAsync,
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

  it("should skip enqueueing when sampling probability is 0", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);

    const mockQueryAsync = vi.fn(async function* () {
      yield {
        judgeId: "judge-1",
        name: "Judge 1",
        enabled: true,
        samplingProbability: 0,
      };
    });

    const mockDb = {
      "agent-eval-judge": {
        queryAsync: mockQueryAsync,
      },
    };

    mockDatabase.mockResolvedValue(mockDb as never);

    await enqueueEvaluations("workspace-123", "agent-456", "conversation-789");

    expect(mockQueuesPublish).not.toHaveBeenCalled();
    expect(randomSpy).toHaveBeenCalledTimes(1);
    randomSpy.mockRestore();
  });

  it("should always enqueue when sampling probability is 100", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    const mockQueryAsync = vi.fn(async function* () {
      yield {
        judgeId: "judge-1",
        name: "Judge 1",
        enabled: true,
        samplingProbability: 100,
      };
    });

    const mockDb = {
      "agent-eval-judge": {
        queryAsync: mockQueryAsync,
      },
    };

    mockDatabase.mockResolvedValue(mockDb as never);

    await enqueueEvaluations("workspace-123", "agent-456", "conversation-789");

    expect(mockQueuesPublish).toHaveBeenCalledTimes(1);
    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });
});
