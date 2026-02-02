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
  mockGetDefaultModel,
  mockGenerateText,
  mockCheckPromptGenerationLimit,
  mockIncrementPromptGenerationBucketSafe,
  mockDatabase,
  mockTrackBusinessEvent,
  mockGetContextFromRequestId,
  mockGetWorkspaceApiKey,
  mockValidateAndReserveCredits,
  mockAdjustCreditsAfterLLMCall,
  mockEnqueueCostVerificationIfNeeded,
  mockCleanupReservationOnError,
  mockCleanupReservationWithoutTokenUsage,
  mockExtractTokenUsageAndCosts,
} = vi.hoisted(() => ({
  mockCreateModel: vi.fn(),
  mockGetDefaultModel: vi.fn(),
  mockGenerateText: vi.fn(),
  mockCheckPromptGenerationLimit: vi.fn(),
  mockIncrementPromptGenerationBucketSafe: vi.fn(),
  mockDatabase: vi.fn(),
  mockTrackBusinessEvent: vi.fn(),
  mockGetContextFromRequestId: vi.fn(),
  mockGetWorkspaceApiKey: vi.fn(),
  mockValidateAndReserveCredits: vi.fn(),
  mockAdjustCreditsAfterLLMCall: vi.fn(),
  mockEnqueueCostVerificationIfNeeded: vi.fn(),
  mockCleanupReservationOnError: vi.fn(),
  mockCleanupReservationWithoutTokenUsage: vi.fn(),
  mockExtractTokenUsageAndCosts: vi.fn(),
}));

vi.mock("../../../utils/modelFactory", () => ({
  createModel: mockCreateModel,
  getDefaultModel: mockGetDefaultModel,
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
}));

vi.mock("../../../../utils/requestTracking", () => ({
  checkPromptGenerationLimit: mockCheckPromptGenerationLimit,
  incrementPromptGenerationBucketSafe: mockIncrementPromptGenerationBucketSafe,
}));

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/tracking", () => ({
  trackBusinessEvent: mockTrackBusinessEvent,
}));

vi.mock("../../../../utils/workspaceCreditContext", () => ({
  getContextFromRequestId: mockGetContextFromRequestId,
}));

vi.mock("../../../utils/agentUtils", () => ({
  getWorkspaceApiKey: mockGetWorkspaceApiKey,
}));

vi.mock("../../../utils/generationCreditManagement", () => ({
  validateAndReserveCredits: mockValidateAndReserveCredits,
  adjustCreditsAfterLLMCall: mockAdjustCreditsAfterLLMCall,
  enqueueCostVerificationIfNeeded: mockEnqueueCostVerificationIfNeeded,
  cleanupReservationOnError: mockCleanupReservationOnError,
  cleanupReservationWithoutTokenUsage: mockCleanupReservationWithoutTokenUsage,
}));

vi.mock("../../../utils/generationTokenExtraction", () => ({
  extractTokenUsageAndCosts: mockExtractTokenUsageAndCosts,
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
    mockIncrementPromptGenerationBucketSafe.mockResolvedValue(undefined);
    mockGetDefaultModel.mockReturnValue("google/gemini-2.5-flash");
    mockGetContextFromRequestId.mockReturnValue({
      addWorkspaceCreditTransaction: vi.fn(),
    });
    mockGetWorkspaceApiKey.mockResolvedValue(null);
    mockValidateAndReserveCredits.mockResolvedValue("res-1");
    mockAdjustCreditsAfterLLMCall.mockResolvedValue(undefined);
    mockEnqueueCostVerificationIfNeeded.mockResolvedValue(undefined);
    mockExtractTokenUsageAndCosts.mockReturnValue({
      tokenUsage: { promptTokens: 10, completionTokens: 20 },
      openrouterGenerationId: "gen-1",
      openrouterGenerationIds: ["gen-1"],
      provisionalCostUsd: 1000,
    });
  });

  it("generates an improved prompt using selected evaluations and charges workspace", async () => {
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
      headers: { "x-request-id": "test-req-id" },
      body: {
        userPrompt: "Please improve the prompt",
        modelName: "google/gemini-2.5-flash",
        selectedEvaluations: [{ conversationId, judgeId }],
      },
    });
    const res = createMockResponse();
    const next = vi.fn();
    const handlerDone = new Promise<void>((resolve) => {
      const origJson = (res.json as ReturnType<typeof vi.fn>).getMockImplementation() as
        | ((this: unknown, ...args: unknown[]) => unknown)
        | undefined;
      (res.json as ReturnType<typeof vi.fn>).mockImplementation(
        function (this: unknown, ...args: unknown[]) {
          origJson?.apply(this, args);
          resolve();
        }
      );
    });

    handler(req as never, res as never, next);
    await handlerDone;

    expect(mockGetContextFromRequestId).toHaveBeenCalledWith("test-req-id");
    expect(mockGetWorkspaceApiKey).toHaveBeenCalledWith(
      workspaceId,
      "openrouter"
    );
    expect(mockValidateAndReserveCredits).toHaveBeenCalledWith(
      mockDb,
      workspaceId,
      agentId,
      "openrouter",
      "google/gemini-2.5-flash",
      expect.any(Array),
      expect.stringContaining("improving AI agent system prompts"),
      undefined,
      false,
      "improve-prompt-from-evals",
      expect.anything(),
      undefined
    );
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
    expect(mockExtractTokenUsageAndCosts).toHaveBeenCalled();
    expect(mockAdjustCreditsAfterLLMCall).toHaveBeenCalled();
    expect(mockEnqueueCostVerificationIfNeeded).toHaveBeenCalledWith(
      "gen-1",
      ["gen-1"],
      workspaceId,
      "res-1",
      undefined,
      agentId,
      "improve-prompt-from-evals"
    );
    expect(mockIncrementPromptGenerationBucketSafe).toHaveBeenCalledWith(
      workspaceId
    );
    expect(res.json).toHaveBeenCalledWith({
      prompt: "Improved system prompt",
    });
  });

  it("skips reservation when BYOK (workspace has OpenRouter key)", async () => {
    mockGetWorkspaceApiKey.mockResolvedValue({ apiKey: "key" });
    mockValidateAndReserveCredits.mockResolvedValue(undefined);

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
        summary: "Summary",
        scoreGoalCompletion: 80,
        scoreToolEfficiency: 80,
        scoreFaithfulness: 90,
        criticalFailureDetected: false,
        evaluatedAt: new Date().toISOString(),
      }),
    };
    mockDatabase.mockResolvedValue(mockDb);
    mockCreateModel.mockResolvedValue({ model: "mock" });
    mockGenerateText.mockResolvedValue({ text: "Improved prompt" });

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: `workspaces/${workspaceId}`,
      params: { workspaceId, agentId },
      headers: { "x-request-id": "test-req-id" },
      body: {
        userPrompt: "Improve",
        selectedEvaluations: [{ conversationId, judgeId }],
      },
    });
    const res = createMockResponse();
    const next = vi.fn();
    const handlerDone = new Promise<void>((resolve) => {
      const origJson = (res.json as ReturnType<typeof vi.fn>).getMockImplementation() as
        | ((this: unknown, ...args: unknown[]) => unknown)
        | undefined;
      (res.json as ReturnType<typeof vi.fn>).mockImplementation(
        function (this: unknown, ...args: unknown[]) {
          origJson?.apply(this, args);
          resolve();
        }
      );
    });

    handler(req as never, res as never, next);
    await handlerDone;

    expect(mockValidateAndReserveCredits).toHaveBeenCalledWith(
      expect.anything(),
      workspaceId,
      agentId,
      "openrouter",
      expect.any(String),
      expect.any(Array),
      expect.any(String),
      undefined,
      true,
      "improve-prompt-from-evals",
      expect.anything(),
      undefined
    );
    expect(res.json).toHaveBeenCalledWith({ prompt: "Improved prompt" });
  });

  it("refunds reservation when generateText throws", async () => {
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
        summary: "Summary",
        scoreGoalCompletion: 80,
        scoreToolEfficiency: 80,
        scoreFaithfulness: 90,
        criticalFailureDetected: false,
        evaluatedAt: new Date().toISOString(),
      }),
    };
    mockDatabase.mockResolvedValue(mockDb);
    mockCreateModel.mockResolvedValue({ model: "mock" });
    mockGenerateText.mockRejectedValue(new Error("LLM failed"));

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: `workspaces/${workspaceId}`,
      params: { workspaceId, agentId },
      headers: { "x-request-id": "test-req-id" },
      body: {
        userPrompt: "Improve",
        modelName: "google/gemini-2.5-flash",
        selectedEvaluations: [{ conversationId, judgeId }],
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    handler(req as never, res as never, next);
    await new Promise((r) => setImmediate(r));

    expect(mockCleanupReservationOnError).toHaveBeenCalledWith(
      mockDb,
      "res-1",
      workspaceId,
      agentId,
      "openrouter",
      "google/gemini-2.5-flash",
      expect.any(Error),
      true,
      false,
      "improve-prompt-from-evals",
      expect.anything()
    );
    expect(next).toHaveBeenCalledWith(expect.any(Error));
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

    handler(req as never, res as never, next);
    await new Promise((r) => setImmediate(r));

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

    handler(req as never, res as never, next);
    await new Promise((r) => setImmediate(r));

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

    handler(req as never, res as never, next);
    await new Promise((r) => setImmediate(r));

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

    handler(req as never, res as never, next);
    await new Promise((r) => setImmediate(r));

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

    handler(req as never, res as never, next);
    await new Promise((r) => setImmediate(r));

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("Unrecognized");
  });
});
