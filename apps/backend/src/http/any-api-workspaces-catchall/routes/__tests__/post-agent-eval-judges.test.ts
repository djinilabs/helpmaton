/* eslint-disable import/order */
import { badRequest } from "@hapi/boom";
import type { Application, RequestHandler } from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

const {
  mockRandomUUID,
  mockDatabase,
  mockEnsureWorkspaceSubscription,
  mockCheckAgentEvalJudgeLimit,
} = vi.hoisted(() => ({
  mockRandomUUID: vi.fn(),
  mockDatabase: vi.fn(),
  mockEnsureWorkspaceSubscription: vi.fn(),
  mockCheckAgentEvalJudgeLimit: vi.fn(),
}));

vi.mock("crypto", () => ({
  randomUUID: mockRandomUUID,
}));

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/subscriptionUtils", () => ({
  ensureWorkspaceSubscription: mockEnsureWorkspaceSubscription,
  checkAgentEvalJudgeLimit: mockCheckAgentEvalJudgeLimit,
}));

import { registerPostAgentEvalJudges } from "../post-agent-eval-judges";

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

describe("POST /api/workspaces/:workspaceId/agents/:agentId/eval-judges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an eval judge and returns its details", async () => {
    const handler = capturePostHandler(registerPostAgentEvalJudges);

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const judgeId = "judge-789";
    mockRandomUUID.mockReturnValue(judgeId);

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      agentId,
      name: "Agent",
    };
    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);

    const mockCreate = vi.fn().mockResolvedValue({
      pk: `agent-eval-judges/${workspaceId}/${agentId}/${judgeId}`,
      sk: "judge",
      workspaceId,
      agentId,
      judgeId,
      name: "Accuracy Judge",
      enabled: true,
      samplingProbability: 100,
      provider: "openrouter",
      modelName: "gpt-4o",
      evalPrompt: "Evaluate accuracy",
      createdAt: new Date().toISOString(),
    });
    (mockDb as Record<string, unknown>)["agent-eval-judge"] = {
      create: mockCreate,
    };

    mockEnsureWorkspaceSubscription.mockResolvedValue("subscription-123");
    mockCheckAgentEvalJudgeLimit.mockResolvedValue(undefined);

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-123",
      params: {
        workspaceId,
        agentId,
      },
      body: {
        name: "Accuracy Judge",
        enabled: true,
        samplingProbability: 100,
        provider: "openrouter",
        modelName: "gpt-4o",
        evalPrompt: "Evaluate accuracy",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await handler(req as never, res as never, next);

    expect(mockEnsureWorkspaceSubscription).toHaveBeenCalledWith(
      workspaceId,
      "user-123"
    );
    expect(mockCheckAgentEvalJudgeLimit).toHaveBeenCalledWith(
      "subscription-123",
      workspaceId,
      agentId
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        pk: `agent-eval-judges/${workspaceId}/${agentId}/${judgeId}`,
        sk: "judge",
        workspaceId,
        agentId,
        judgeId,
        name: "Accuracy Judge",
        enabled: true,
        samplingProbability: 100,
        provider: "openrouter",
        modelName: "gpt-4o",
        evalPrompt: "Evaluate accuracy",
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect((res as { body: unknown }).body).toEqual({
      id: judgeId,
      name: "Accuracy Judge",
      enabled: true,
      samplingProbability: 100,
      provider: "openrouter",
      modelName: "gpt-4o",
      evalPrompt: "Evaluate accuracy",
      createdAt: expect.any(String),
    });
  });

  it("rejects when eval judge limit is exceeded", async () => {
    const handler = capturePostHandler(registerPostAgentEvalJudges);

    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockAgent = {
      pk: `agents/${workspaceId}/${agentId}`,
      sk: "agent",
      workspaceId,
      agentId,
      name: "Agent",
    };
    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);

    mockEnsureWorkspaceSubscription.mockResolvedValue("subscription-123");
    mockCheckAgentEvalJudgeLimit.mockRejectedValue(
      badRequest(
        "Eval judge limit exceeded. Maximum 1 eval judge(s) allowed per agent for free plan."
      )
    );

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-123",
      params: {
        workspaceId,
        agentId,
      },
      body: {
        name: "Accuracy Judge",
        enabled: true,
        samplingProbability: 100,
        provider: "openrouter",
        modelName: "gpt-4o",
        evalPrompt: "Evaluate accuracy",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await handler(req as never, res as never, next);

    expect(mockEnsureWorkspaceSubscription).toHaveBeenCalledWith(
      workspaceId,
      "user-123"
    );
    expect(mockCheckAgentEvalJudgeLimit).toHaveBeenCalledWith(
      "subscription-123",
      workspaceId,
      agentId
    );
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
