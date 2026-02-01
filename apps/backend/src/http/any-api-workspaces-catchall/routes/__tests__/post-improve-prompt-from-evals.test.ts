/* eslint-disable import/order */
import type { Application, RequestHandler } from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

const {
  mockCreateModel,
  mockGenerateText,
  mockCheckPromptGenerationLimit,
  mockIncrementPromptGenerationBucket,
  mockDatabase,
  mockTrackBusinessEvent,
} = vi.hoisted(() => ({
  mockCreateModel: vi.fn(),
  mockGenerateText: vi.fn(),
  mockCheckPromptGenerationLimit: vi.fn(),
  mockIncrementPromptGenerationBucket: vi.fn(),
  mockDatabase: vi.fn(),
  mockTrackBusinessEvent: vi.fn(),
}));

vi.mock("../../../utils/modelFactory", () => ({
  createModel: mockCreateModel,
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
}));

vi.mock("../../../../utils/requestTracking", () => ({
  checkPromptGenerationLimit: mockCheckPromptGenerationLimit,
  incrementPromptGenerationBucket: mockIncrementPromptGenerationBucket,
}));

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/tracking", () => ({
  trackBusinessEvent: mockTrackBusinessEvent,
}));

import { registerPostImprovePromptFromEvals } from "../post-improve-prompt-from-evals";

function capturePostHandler(register: (app: Application) => void) {
  let captured: RequestHandler | undefined;
  const app = {
    post: (...args: unknown[]) => {
      const handlers = args.slice(1) as RequestHandler[];
      captured = handlers[handlers.length - 1];
    },
  } as unknown as Application;
  register(app);
  if (!captured) {
    throw new Error("Post handler not registered");
  }
  return captured;
}

describe("POST /api/workspaces/:workspaceId/agents/:agentId/improve-prompt-from-evals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckPromptGenerationLimit.mockResolvedValue(undefined);
    mockIncrementPromptGenerationBucket.mockResolvedValue({
      pk: "request-buckets/sub-123/prompt-generation/2024-01-01T00:00:00.000Z",
      subscriptionId: "sub-123",
      category: "prompt-generation",
      hourTimestamp: "2024-01-01T00:00:00.000Z",
      count: 1,
    });
  });

  it("generates an improved prompt using selected evaluations", async () => {
    const handler = capturePostHandler(registerPostImprovePromptFromEvals);
    const mockDb = createMockDatabase();
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const conversationId = "conversation-789";
    const judgeId = "judge-abc";

    mockDb.agent.get = vi.fn().mockResolvedValue({
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      agentId,
      systemPrompt: "Current system prompt",
    });

    (mockDb as Record<string, unknown>)["agent-eval-result"] = {
      get: vi.fn().mockResolvedValue({
        pk: `agent-eval-results/${workspaceId}/${agentId}/${conversationId}/${judgeId}`,
        workspaceId,
        agentId,
        conversationId,
        judgeId,
        status: "completed",
        summary: "Summary text",
        scoreGoalCompletion: 70,
        scoreToolEfficiency: 80,
        scoreFaithfulness: 90,
        criticalFailureDetected: false,
        evaluatedAt: new Date().toISOString(),
      }),
    };

    mockDatabase.mockResolvedValue(mockDb);

    const mockModel = { model: "mock-model" };
    mockCreateModel.mockResolvedValue(mockModel);
    mockGenerateText.mockResolvedValue({
      text: "Improved system prompt",
    });

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: `workspaces/${workspaceId}`,
      params: { workspaceId, agentId },
      body: {
        userPrompt: "Please improve the prompt",
        modelName: "google/gemini-2.5-flash",
        selectedEvaluations: [{ conversationId, judgeId }],
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await handler(req as never, res as never, next);

    expect(mockCheckPromptGenerationLimit).toHaveBeenCalledWith(workspaceId);
    expect(mockCreateModel).toHaveBeenCalledWith(
      "openrouter",
      "google/gemini-2.5-flash",
      workspaceId,
      "http://localhost:3000/api/improve-agent-prompt",
      "user-123"
    );
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mockModel,
        system: expect.stringContaining("improving AI agent system prompts"),
        messages: [
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("Please improve the prompt"),
          }),
        ],
      })
    );
    expect(mockIncrementPromptGenerationBucket).toHaveBeenCalledWith(workspaceId);
    expect(res.json).toHaveBeenCalledWith({
      prompt: "Improved system prompt",
    });
  });

  it("rejects when userPrompt is missing", async () => {
    const handler = capturePostHandler(registerPostImprovePromptFromEvals);
    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123", agentId: "agent-456" },
      body: {
        selectedEvaluations: [{ conversationId: "c1", judgeId: "j1" }],
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await handler(req as never, res as never, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("Validation failed: userPrompt");
  });

  it("rejects when selectedEvaluations is empty", async () => {
    const handler = capturePostHandler(registerPostImprovePromptFromEvals);
    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123", agentId: "agent-456" },
      body: {
        userPrompt: "Improve it",
        selectedEvaluations: [],
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await handler(req as never, res as never, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("selectedEvaluations");
  });

  it("rejects when agent does not exist", async () => {
    const handler = capturePostHandler(registerPostImprovePromptFromEvals);
    const mockDb = createMockDatabase();
    mockDb.agent.get = vi.fn().mockResolvedValue(null);
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123", agentId: "agent-456" },
      body: {
        userPrompt: "Improve it",
        selectedEvaluations: [{ conversationId: "c1", judgeId: "j1" }],
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await handler(req as never, res as never, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("Agent not found");
  });

  it("rejects when evaluation results are missing", async () => {
    const handler = capturePostHandler(registerPostImprovePromptFromEvals);
    const mockDb = createMockDatabase();
    mockDb.agent.get = vi.fn().mockResolvedValue({
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      workspaceId: "workspace-123",
      agentId: "agent-456",
      systemPrompt: "Current system prompt",
    });
    (mockDb as Record<string, unknown>)["agent-eval-result"] = {
      get: vi.fn().mockResolvedValue(null),
    };
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123", agentId: "agent-456" },
      body: {
        userPrompt: "Improve it",
        selectedEvaluations: [{ conversationId: "c1", judgeId: "j1" }],
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await handler(req as never, res as never, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("Evaluation result not found");
  });

  it("rejects extra fields in request body", async () => {
    const handler = capturePostHandler(registerPostImprovePromptFromEvals);
    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123", agentId: "agent-456" },
      body: {
        userPrompt: "Improve it",
        selectedEvaluations: [{ conversationId: "c1", judgeId: "j1" }],
        extraField: "nope",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await handler(req as never, res as never, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("Unrecognized");
  });
});
