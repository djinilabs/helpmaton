import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// eslint-disable-next-line import/order -- test-helpers after vitest; mocks and route import follow
import {
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";

const { mockRunOnboardingAgentLlm } = vi.hoisted(() => ({
  mockRunOnboardingAgentLlm: vi.fn(),
}));

vi.mock("../../../utils/onboardingAgentLlm", () => ({
  runOnboardingAgentLlm: mockRunOnboardingAgentLlm,
}));

import { onboardingAgentStreamRequestSchema } from "../../../utils/onboardingAgentSchemas";
import { registerPostWorkspacesOnboardingAgentStream } from "../post-workspaces-onboarding-agent-stream";

import { createTestAppWithHandlerCapture } from "./route-test-helpers";

const STREAM_PATH = "/api/workspaces/onboarding-agent/stream";

function validBody(overrides?: Record<string, unknown>) {
  return {
    onboardingContext: {
      step: "intent" as const,
      intent: { goal: "Customer support", freeText: "FAQ bot" },
    },
    ...overrides,
  };
}

describe("POST /api/workspaces/onboarding-agent/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response> & { body?: unknown; statusCode?: number },
    next?: express.NextFunction
  ) {
    const { app, postHandler } = createTestAppWithHandlerCapture();
    registerPostWorkspacesOnboardingAgentStream(app);
    const handler = postHandler(STREAM_PATH);
    if (!handler) {
      throw new Error("Handler not found");
    }
    await handler(
      req as express.Request,
      res as express.Response,
      next ?? (() => {})
    );
  }

  it("should return 200 with onboarding_agent_result (questions) when LLM returns questions", async () => {
    const questionsResult = {
      type: "questions" as const,
      questions: [
        {
          id: "businessType",
          label: "What type of business?",
          kind: "choice" as const,
          options: ["Retail", "SaaS", "Other"],
        },
      ],
    };
    mockRunOnboardingAgentLlm.mockResolvedValue({
      success: true,
      assistantText: "Here are some questions.",
      result: questionsResult,
    });

    const req = createMockRequest({
      userRef: "users/user-123",
      body: validBody(),
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockRunOnboardingAgentLlm).toHaveBeenCalledWith({
      step: "intent",
      intent: { goal: "Customer support", freeText: "FAQ bot" },
      template: undefined,
      chatMessage: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      assistantText: "Here are some questions.",
      finalEvent: {
        type: "onboarding_agent_result",
        payload: questionsResult,
      },
    });
  });

  it("should accept and forward questions result with multiple: true and intent with array value", async () => {
    const questionsResult = {
      type: "questions" as const,
      questions: [
        {
          id: "wantChannels",
          label: "Where should this agent respond?",
          kind: "choice" as const,
          options: ["Discord", "Slack", "Email", "API/widget only"],
          multiple: true,
        },
      ],
    };
    mockRunOnboardingAgentLlm.mockResolvedValue({
      success: true,
      assistantText: "Where should it respond?",
      result: questionsResult,
    });

    const intentWithArray = {
      goals: ["support"],
      wantChannels: ["Discord", "Slack"],
    };
    const req = createMockRequest({
      userRef: "users/user-123",
      body: {
        onboardingContext: {
          step: "intent" as const,
          intent: intentWithArray,
        },
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockRunOnboardingAgentLlm).toHaveBeenCalledWith({
      step: "intent",
      intent: intentWithArray,
      template: undefined,
      chatMessage: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      assistantText: "Where should it respond?",
      finalEvent: {
        type: "onboarding_agent_result",
        payload: questionsResult,
      },
    });
  });

  it("should accept intent.tasksOrRoles as string and normalize to array", async () => {
    mockRunOnboardingAgentLlm.mockResolvedValue({
      success: true,
      assistantText: "OK",
      result: {
        type: "template" as const,
        template: {
          id: "{workspaceId}",
          name: "Test",
          agents: [{ id: "{mainAgent}", name: "Agent", systemPrompt: "Help." }],
        },
        summary: "Test workspace.",
      },
    });
    const req = createMockRequest({
      userRef: "users/user-123",
      body: {
        onboardingContext: {
          step: "intent" as const,
          intent: { goals: ["support"], tasksOrRoles: "customer support" },
        },
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockRunOnboardingAgentLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "intent",
        intent: expect.objectContaining({
          goals: ["support"],
          tasksOrRoles: ["customer support"],
        }),
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("should return 200 with onboarding_agent_result (template) when LLM returns template", async () => {
    const minimalTemplate = {
      id: "{workspaceId}",
      name: "Support Workspace",
      description: "FAQ and support",
      agents: [
        {
          id: "{mainAgent}",
          name: "Support Agent",
          systemPrompt: "You help with FAQs.",
        },
      ],
    };
    const templateResult = {
      type: "template" as const,
      template: minimalTemplate,
      summary: "Workspace with 1 support agent for FAQs.",
    };
    mockRunOnboardingAgentLlm.mockResolvedValue({
      success: true,
      assistantText: "Here is your workspace template.",
      result: templateResult,
    });

    const req = createMockRequest({
      userRef: "users/user-456",
      body: validBody({ onboardingContext: { step: "intent", intent: {} } }),
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      assistantText: "Here is your workspace template.",
      finalEvent: {
        type: "onboarding_agent_result",
        payload: templateResult,
      },
    });
  });

  it("should return 200 with onboarding_agent_validation_failed when validation fails after retries", async () => {
    mockRunOnboardingAgentLlm.mockResolvedValue({
      success: false,
      assistantText: "Invalid JSON output",
      error: "Template validation failed: agents[0].systemPrompt is required",
      code: "onboarding_agent_validation_failed",
    });

    const req = createMockRequest({
      userRef: "users/user-789",
      body: validBody(),
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      assistantText: "Invalid JSON output",
      finalEvent: {
        type: "onboarding_agent_validation_failed",
        error:
          "Template validation failed: agents[0].systemPrompt is required",
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should call runOnboardingAgentLlm with refine step and template when provided", async () => {
    const minimalTemplate = {
      id: "{workspaceId}",
      name: "Support Workspace",
      agents: [
        {
          id: "{mainAgent}",
          name: "Support Agent",
          systemPrompt: "You help with FAQs.",
        },
      ],
    };
    mockRunOnboardingAgentLlm.mockResolvedValue({
      success: true,
      assistantText: "Updated.",
      result: {
        type: "template",
        template: { ...minimalTemplate, name: "Updated Workspace" },
        summary: "Updated workspace.",
      },
    });

    const req = createMockRequest({
      userRef: "users/user-refine",
      body: {
        onboardingContext: {
          step: "refine",
          template: minimalTemplate,
          chatMessage: "Make the agent friendlier",
        },
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    // Body validation applies workspaceExportSchema defaults (e.g. currency, provider)
    expect(mockRunOnboardingAgentLlm).toHaveBeenCalledWith({
      step: "refine",
      intent: undefined,
      template: expect.objectContaining({
        id: "{workspaceId}",
        name: "Support Workspace",
        agents: expect.arrayContaining([
          expect.objectContaining({
            id: "{mainAgent}",
            name: "Support Agent",
            systemPrompt: "You help with FAQs.",
          }),
        ]),
      }),
      chatMessage: "Make the agent friendlier",
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("should throw unauthorized when userRef is missing", async () => {
    const req = createMockRequest({
      userRef: undefined,
      body: validBody(),
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(
      (error as { output?: { statusCode: number } }).output?.statusCode
    ).toBe(401);
    expect(mockRunOnboardingAgentLlm).not.toHaveBeenCalled();
  });

  it("should call next with error when body validation fails (missing onboardingContext)", async () => {
    const req = createMockRequest({
      userRef: "users/user-123",
      body: { messages: [] },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(mockRunOnboardingAgentLlm).not.toHaveBeenCalled();
  });

  it("rejects onboardingContext with unknown keys (strict schema)", () => {
    const result = onboardingAgentStreamRequestSchema.safeParse({
      onboardingContext: {
        step: "intent",
        intent: {},
        unknownField: "not allowed",
      },
    });
    expect(result.success).toBe(false);
  });

  it("should call next with error when body has extra fields in onboardingContext (strict)", async () => {
    const req = createMockRequest({
      userRef: "users/user-123",
      body: {
        onboardingContext: {
          step: "intent",
          intent: {},
          unknownField: "not allowed",
        },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockRunOnboardingAgentLlm).not.toHaveBeenCalled();
  });

  it("should call next with error when step is refine but chatMessage is missing", async () => {
    const minimalTemplate = {
      id: "{workspaceId}",
      name: "Support",
      agents: [{ id: "{mainAgent}", name: "Agent", systemPrompt: "Help." }],
    };
    const req = createMockRequest({
      userRef: "users/user-123",
      body: {
        onboardingContext: {
          step: "refine",
          template: minimalTemplate,
          // chatMessage missing
        },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockRunOnboardingAgentLlm).not.toHaveBeenCalled();
  });
});
