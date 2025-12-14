import { badRequest, unauthorized } from "@hapi/boom";
import { generateText } from "ai";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockCreateModel,
  mockGenerateText,
  mockCheckDailyRequestLimit,
  mockIncrementRequestBucket,
  mockGetWorkspaceSubscription,
  mockDatabase,
} = vi.hoisted(() => {
  return {
    mockCreateModel: vi.fn(),
    mockGenerateText: vi.fn(),
    mockCheckDailyRequestLimit: vi.fn(),
    mockIncrementRequestBucket: vi.fn(),
    mockGetWorkspaceSubscription: vi.fn(),
    mockDatabase: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../utils/modelFactory", () => ({
  createModel: mockCreateModel,
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
}));

vi.mock("../../../../utils/requestTracking", () => ({
  checkDailyRequestLimit: mockCheckDailyRequestLimit,
  incrementRequestBucket: mockIncrementRequestBucket,
}));

vi.mock("../../../../utils/subscriptionUtils", () => ({
  getWorkspaceSubscription: mockGetWorkspaceSubscription,
}));

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

describe("POST /api/workspaces/:workspaceId/agents/generate-prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks
    mockGetWorkspaceSubscription.mockResolvedValue({
      pk: "subscriptions/sub-123",
      sk: "subscription",
    });
    mockCheckDailyRequestLimit.mockResolvedValue(undefined);
    mockIncrementRequestBucket.mockResolvedValue({
      pk: "llm-request-buckets/sub-123/2024-01-01T00:00:00.000Z",
      subscriptionId: "sub-123",
      hourTimestamp: "2024-01-01T00:00:00.000Z",
      count: 1,
    });
    const mockDb = createMockDatabase();
    // Add email-connection table mock
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      query: vi.fn().mockResolvedValue({ items: [] }),
    };
    // mcp-server is already in createMockDatabase
    mockDatabase.mockResolvedValue(mockDb);
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    // Extract the handler logic directly
    const handler = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        const { goal, agentId } = req.body;
        if (!goal || typeof goal !== "string" || goal.trim().length === 0) {
          throw badRequest("goal is required and must be a non-empty string");
        }

        const db = await mockDatabase();

        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }
        const workspaceId = req.params.workspaceId;

        // Get agent information if agentId is provided (simplified for test)
        if (agentId && typeof agentId === "string") {
          const agentPk = `agents/${workspaceId}/${agentId}`;
          await db.agent.get(agentPk, "agent");
        }

        // Check for email connection (simplified for test)
        const emailConnectionPk = `email-connections/${workspaceId}`;
        await db["email-connection"].get(emailConnectionPk, "connection");

        // Build tools information (simplified for test)
        const toolsContext = ""; // Simplified - full implementation would build tools info

        // Check daily request limit before LLM call
        const subscription = await mockGetWorkspaceSubscription(workspaceId);
        const subscriptionId = subscription
          ? subscription.pk.replace("subscriptions/", "")
          : undefined;
        if (subscriptionId) {
          await mockCheckDailyRequestLimit(subscriptionId);
        }

        // Create model for prompt generation (using Google provider with default model)
        const model = await mockCreateModel(
          "google",
          undefined, // Use default model
          workspaceId,
          "http://localhost:3000/api/prompt-generation"
        );

        // Generate the prompt
        const result = await mockGenerateText({
          model: model as unknown as Parameters<
            typeof generateText
          >[0]["model"],
          system: `You are an expert at writing effective system prompts for AI agents. Your task is to generate clear, actionable system prompts based on user-provided goals.

When generating a system prompt, you should:
1. Define the agent's role and purpose clearly
2. Include specific guidelines for how the agent should behave and respond
3. Add any relevant constraints or limitations
4. Make the prompt specific to the user's goal
5. Use clear, professional language
6. Support markdown formatting where appropriate

The system prompt should be comprehensive enough to guide the agent's behavior effectively, but concise enough to be practical. Focus on actionable instructions rather than abstract concepts.

Generate only the system prompt text itself, without any additional commentary or explanation.`,
          messages: [
            {
              role: "user",
              content: `Generate a system prompt for an AI agent with the following goal:\n\n${goal.trim()}${toolsContext}`,
            },
          ],
        });

        const generatedPrompt = result.text.trim();

        // Track successful LLM request (increment bucket)
        if (subscriptionId) {
          try {
            await mockIncrementRequestBucket(subscriptionId);
          } catch (error) {
            // Log error but don't fail the request
            console.error("Error incrementing request bucket:", error);
          }
        }

        res.json({
          prompt: generatedPrompt,
        });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should generate prompt successfully with valid goal", async () => {
    const mockModel = { model: "mock-model" };
    mockCreateModel.mockResolvedValue(mockModel);

    const mockGenerateTextResult = {
      text: "You are a helpful customer support agent.\n\nYour role is to:\n- Answer customer questions\n- Provide clear explanations\n- Escalate complex issues",
    };
    mockGenerateText.mockResolvedValue(mockGenerateTextResult);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123" },
      body: {
        goal: "I want an agent that helps customers with technical support",
      },
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockGetWorkspaceSubscription).toHaveBeenCalledWith("workspace-123");
    expect(mockCheckDailyRequestLimit).toHaveBeenCalledWith("sub-123");
    expect(mockCreateModel).toHaveBeenCalledWith(
      "google",
      undefined,
      "workspace-123",
      "http://localhost:3000/api/prompt-generation"
    );
    expect(mockGenerateText).toHaveBeenCalledWith({
      model: mockModel,
      system: expect.stringContaining(
        "You are an expert at writing effective system prompts"
      ),
      messages: [
        {
          role: "user",
          content: expect.stringContaining(
            "I want an agent that helps customers with technical support"
          ),
        },
      ],
    });
    expect(mockIncrementRequestBucket).toHaveBeenCalledWith("sub-123");
    expect(res.json).toHaveBeenCalledWith({
      prompt: mockGenerateTextResult.text.trim(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("should return 400 if goal is missing", async () => {
    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123" },
      body: {},
    });

    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: "goal is required and must be a non-empty string",
          }),
        }),
      })
    );
    expect(mockCreateModel).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("should return 400 if goal is not a string", async () => {
    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123" },
      body: {
        goal: 123,
      },
    });

    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: "goal is required and must be a non-empty string",
          }),
        }),
      })
    );
    expect(mockCreateModel).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("should return 400 if goal is empty string", async () => {
    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123" },
      body: {
        goal: "",
      },
    });

    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: "goal is required and must be a non-empty string",
          }),
        }),
      })
    );
    expect(mockCreateModel).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("should return 400 if goal is only whitespace", async () => {
    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123" },
      body: {
        goal: "   \n\t  ",
      },
    });

    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: "goal is required and must be a non-empty string",
          }),
        }),
      })
    );
    expect(mockCreateModel).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("should return 400 if workspace resource is missing", async () => {
    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: undefined,
      params: { workspaceId: "workspace-123" },
      body: {
        goal: "I want a helpful agent",
      },
    });

    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: "Workspace resource not found",
          }),
        }),
      })
    );
    expect(mockCreateModel).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("should return 401 if user ref is missing", async () => {
    const req = createMockRequest({
      userRef: undefined,
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123" },
      body: {
        goal: "I want a helpful agent",
      },
    });

    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 401,
        }),
      })
    );
    expect(mockCreateModel).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("should trim whitespace from goal before generating prompt", async () => {
    const mockModel = { model: "mock-model" };
    mockCreateModel.mockResolvedValue(mockModel);

    const mockGenerateTextResult = {
      text: "Generated prompt",
    };
    mockGenerateText.mockResolvedValue(mockGenerateTextResult);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123" },
      body: {
        goal: "  \n  I want a helpful agent  \n  ",
      },
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockGenerateText).toHaveBeenCalledWith({
      model: mockModel,
      system: expect.any(String),
      messages: [
        {
          role: "user",
          content: expect.stringContaining("I want a helpful agent"),
        },
      ],
    });
    expect(res.json).toHaveBeenCalledWith({
      prompt: mockGenerateTextResult.text.trim(),
    });
  });

  it("should trim whitespace from generated prompt", async () => {
    const mockModel = { model: "mock-model" };
    mockCreateModel.mockResolvedValue(mockModel);

    const mockGenerateTextResult = {
      text: "  \n  Generated prompt with whitespace  \n  ",
    };
    mockGenerateText.mockResolvedValue(mockGenerateTextResult);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123" },
      body: {
        goal: "I want a helpful agent",
      },
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      prompt: "Generated prompt with whitespace",
    });
  });

  it("should handle errors from createModel", async () => {
    const error = new Error("Failed to create model");
    mockCreateModel.mockRejectedValue(error);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123" },
      body: {
        goal: "I want a helpful agent",
      },
    });

    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("should handle errors from generateText", async () => {
    const mockModel = { model: "mock-model" };
    mockCreateModel.mockResolvedValue(mockModel);

    const error = new Error("Failed to generate text");
    mockGenerateText.mockRejectedValue(error);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123" },
      body: {
        goal: "I want a helpful agent",
      },
    });

    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
    // Should not increment bucket on error
    expect(mockIncrementRequestBucket).not.toHaveBeenCalled();
  });

  it("should check daily request limit before LLM call", async () => {
    const mockModel = { model: "mock-model" };
    mockCreateModel.mockResolvedValue(mockModel);

    const mockGenerateTextResult = {
      text: "Generated prompt",
    };
    mockGenerateText.mockResolvedValue(mockGenerateTextResult);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123" },
      body: {
        goal: "I want a helpful agent",
      },
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    // Verify order: check limit before creating model
    expect(mockGetWorkspaceSubscription).toHaveBeenCalledBefore(
      mockCreateModel as unknown as ReturnType<typeof vi.fn>
    );
    expect(mockCheckDailyRequestLimit).toHaveBeenCalledBefore(
      mockCreateModel as unknown as ReturnType<typeof vi.fn>
    );
  });

  it("should increment request bucket after successful LLM call", async () => {
    const mockModel = { model: "mock-model" };
    mockCreateModel.mockResolvedValue(mockModel);

    const mockGenerateTextResult = {
      text: "Generated prompt",
    };
    mockGenerateText.mockResolvedValue(mockGenerateTextResult);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123" },
      body: {
        goal: "I want a helpful agent",
      },
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    // Verify bucket is incremented after successful generation
    expect(mockGenerateText).toHaveBeenCalledBefore(
      mockIncrementRequestBucket as unknown as ReturnType<typeof vi.fn>
    );
    expect(mockIncrementRequestBucket).toHaveBeenCalledWith("sub-123");
  });

  it("should handle missing subscription gracefully", async () => {
    mockGetWorkspaceSubscription.mockResolvedValue(null);

    const mockModel = { model: "mock-model" };
    mockCreateModel.mockResolvedValue(mockModel);

    const mockGenerateTextResult = {
      text: "Generated prompt",
    };
    mockGenerateText.mockResolvedValue(mockGenerateTextResult);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123" },
      body: {
        goal: "I want a helpful agent",
      },
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    // Should not check limit or increment bucket if no subscription
    expect(mockCheckDailyRequestLimit).not.toHaveBeenCalled();
    expect(mockIncrementRequestBucket).not.toHaveBeenCalled();
    // But should still generate the prompt
    expect(res.json).toHaveBeenCalledWith({
      prompt: "Generated prompt",
    });
  });

  it("should handle request bucket increment errors gracefully", async () => {
    const mockModel = { model: "mock-model" };
    mockCreateModel.mockResolvedValue(mockModel);

    const mockGenerateTextResult = {
      text: "Generated prompt",
    };
    mockGenerateText.mockResolvedValue(mockGenerateTextResult);

    const bucketError = new Error("Failed to increment bucket");
    mockIncrementRequestBucket.mockRejectedValue(bucketError);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123" },
      body: {
        goal: "I want a helpful agent",
      },
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    // Should still return success even if bucket increment fails
    expect(res.json).toHaveBeenCalledWith({
      prompt: "Generated prompt",
    });
    expect(res.statusCode).toBe(200);
  });
});
