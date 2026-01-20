import { badRequest, unauthorized } from "@hapi/boom";
import { generateText } from "ai";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ToolMetadata } from "../../../../utils/toolMetadata";
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
  mockCheckPromptGenerationLimit,
  mockIncrementPromptGenerationBucket,
  mockDatabase,
  mockGenerateToolList,
} = vi.hoisted(() => {
  return {
    mockCreateModel: vi.fn(),
    mockGenerateText: vi.fn(),
    mockCheckPromptGenerationLimit: vi.fn(),
    mockIncrementPromptGenerationBucket: vi.fn(),
    mockDatabase: vi.fn(),
    mockGenerateToolList: vi.fn(),
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
  checkPromptGenerationLimit: mockCheckPromptGenerationLimit,
  incrementPromptGenerationBucket: mockIncrementPromptGenerationBucket,
}));

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/toolMetadata", () => ({
  generateToolList: mockGenerateToolList,
}));

type AgentPromptContext = {
  systemPrompt?: string;
  clientTools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  notificationChannelId?: string;
  delegatableAgentIds?: string[];
  enabledMcpServerIds?: string[];
  enableMemorySearch?: boolean;
  enableSearchDocuments?: boolean;
  enableSendEmail?: boolean;
  searchWebProvider?: "tavily" | "jina" | null;
  fetchWebProvider?: "tavily" | "jina" | "scrape" | null;
  enableExaSearch?: boolean;
};

type ToolGroup = {
  category: string;
  tools: ToolMetadata[];
};

const PROMPT_SYSTEM_TEXT = `You are an expert at writing effective system prompts for AI agents. Your task is to generate clear, actionable system prompts based on user-provided goals and available tools.

When generating a system prompt, you should:
1. Define the agent's role and purpose clearly
2. Include specific guidelines for how the agent should behave and respond
3. Add any relevant constraints or limitations
4. Make the prompt specific to the user's goal
5. Reference available tools when relevant to help the agent understand what capabilities it has
6. Use clear, professional language
7. Support markdown formatting where appropriate

If an existing system prompt is provided, you should build upon it, refine it, or incorporate relevant elements while addressing the user's goal. When an existing prompt is present, preserve important instructions and constraints while updating based on the new goal.

The system prompt should be comprehensive enough to guide the agent's behavior effectively, but concise enough to be practical. Focus on actionable instructions rather than abstract concepts.

If tools are available, you may mention them naturally in the prompt, but do not list them exhaustively - the agent will have access to tool definitions separately.

Generate only the system prompt text itself, without any additional commentary or explanation.`;

const extractGoal = (body: unknown): string => {
  const goal = (body as { goal?: unknown })?.goal;
  if (!goal || typeof goal !== "string" || goal.trim().length === 0) {
    throw badRequest("goal is required and must be a non-empty string");
  }
  return goal;
};

const requireWorkspaceContext = (req: express.Request) => {
  if (!req.workspaceResource) {
    throw badRequest("Workspace resource not found");
  }
  if (!req.userRef) {
    throw unauthorized();
  }
  return {
    workspaceId: req.params.workspaceId,
    currentUserRef: req.userRef,
  };
};

const loadAgentForPrompt = async (
  db: Awaited<ReturnType<typeof mockDatabase>>,
  workspaceId: string,
  agentId?: unknown
): Promise<AgentPromptContext | null> => {
  if (!agentId || typeof agentId !== "string") {
    return null;
  }
  const agentPk = `agents/${workspaceId}/${agentId}`;
  const agentRecord = await db.agent.get(agentPk, "agent");
  if (!agentRecord) {
    return null;
  }
  return {
    systemPrompt: agentRecord.systemPrompt,
    clientTools: agentRecord.clientTools,
    notificationChannelId: agentRecord.notificationChannelId,
    delegatableAgentIds: agentRecord.delegatableAgentIds,
    enabledMcpServerIds: agentRecord.enabledMcpServerIds,
    enableMemorySearch: agentRecord.enableMemorySearch,
    enableSearchDocuments: agentRecord.enableSearchDocuments,
    enableSendEmail: agentRecord.enableSendEmail,
    searchWebProvider: agentRecord.searchWebProvider ?? null,
    fetchWebProvider: agentRecord.fetchWebProvider ?? null,
    enableExaSearch: agentRecord.enableExaSearch ?? false,
  };
};

const loadEmailConnection = async (
  db: Awaited<ReturnType<typeof mockDatabase>>,
  workspaceId: string
): Promise<boolean> => {
  const emailConnectionPk = `email-connections/${workspaceId}`;
  const emailConnection = await db["email-connection"].get(
    emailConnectionPk,
    "connection"
  );
  return !!emailConnection;
};

const loadEnabledMcpServers = async (
  db: Awaited<ReturnType<typeof mockDatabase>>,
  workspaceId: string,
  enabledMcpServerIds: string[]
) => {
  const enabledMcpServers = [];
  for (const serverId of enabledMcpServerIds) {
    const serverPk = `mcp-servers/${workspaceId}/${serverId}`;
    const server = await db["mcp-server"].get(serverPk, "server");
    if (server) {
      const config = server.config as { accessToken?: string };
      const hasOAuthConnection = !!config.accessToken;

      enabledMcpServers.push({
        id: serverId,
        name: server.name,
        serviceType: server.serviceType,
        authType: server.authType,
        oauthConnected: hasOAuthConnection,
      });
    }
  }
  return enabledMcpServers;
};

const buildToolList = (params: {
  agent: AgentPromptContext | null;
  workspaceId: string;
  enabledMcpServers: Array<{
    id: string;
    name: string;
    serviceType: string;
    authType: string;
    oauthConnected: boolean;
  }>;
  emailConnection: boolean;
}): ToolGroup[] => {
  return mockGenerateToolList({
    agent: {
      enableSearchDocuments: params.agent?.enableSearchDocuments ?? false,
      enableMemorySearch: params.agent?.enableMemorySearch ?? false,
      notificationChannelId: params.agent?.notificationChannelId,
      enableSendEmail: params.agent?.enableSendEmail ?? false,
      searchWebProvider: params.agent?.searchWebProvider ?? null,
      fetchWebProvider: params.agent?.fetchWebProvider ?? null,
      enableExaSearch: params.agent?.enableExaSearch ?? false,
      delegatableAgentIds: params.agent?.delegatableAgentIds ?? [],
      enabledMcpServerIds: params.agent?.enabledMcpServerIds ?? [],
      clientTools: params.agent?.clientTools ?? [],
    },
    workspaceId: params.workspaceId,
    enabledMcpServers: params.enabledMcpServers,
    emailConnection: params.emailConnection,
  });
};

const getServiceTypeForTool = (toolName: string): string => {
  if (toolName.startsWith("google_drive_")) {
    return "Google Drive";
  }
  if (toolName.startsWith("gmail_")) {
    return "Gmail";
  }
  if (toolName.startsWith("google_calendar_")) {
    return "Google Calendar";
  }
  if (toolName.startsWith("notion_")) {
    return "Notion";
  }
  if (toolName.startsWith("github_")) {
    return "GitHub";
  }
  if (toolName.startsWith("linear_")) {
    return "Linear";
  }
  if (toolName.startsWith("mcp_")) {
    return "MCP Server";
  }
  return "";
};

const buildToolsInfo = (toolList: ToolGroup[]): string[] => {
  const toolsInfo: string[] = [];

  for (const group of toolList) {
    const availableToolsInGroup = group.tools.filter(
      (tool: ToolMetadata) =>
        tool.alwaysAvailable ||
        (tool.condition && tool.condition.includes("Available"))
    );

    if (availableToolsInGroup.length === 0) {
      continue;
    }

    if (group.category === "MCP Server Tools") {
      toolsInfo.push("## MCP Server Tools");
    } else if (group.category === "Client Tools") {
      toolsInfo.push("## Client-Side Tools (Custom)");
    } else {
      toolsInfo.push(`## ${group.category}`);
    }

    if (group.category === "MCP Server Tools") {
      const toolsByServer = new Map<string, string[]>();
      for (const tool of availableToolsInGroup) {
        let serverName = "Unknown";
        if (tool.condition) {
          const match = tool.condition.match(/"([^"]+)"/);
          if (match) {
            serverName = match[1];
          }
        }

        const serviceType = getServiceTypeForTool(tool.name);
        const key = serviceType
          ? `${serviceType} (${serverName})`
          : `MCP Server (${serverName})`;
        if (!toolsByServer.has(key)) {
          toolsByServer.set(key, []);
        }
        toolsByServer.get(key)!.push(tool.name);
      }

      for (const [serverKey, toolNames] of toolsByServer.entries()) {
        toolsInfo.push(`- **${serverKey}**: ${toolNames.join(", ")}`);
      }
    } else {
      for (const tool of availableToolsInGroup) {
        const shortDescription = tool.description
          .split(".")
          .slice(0, 1)
          .join(".")
          .trim();
        toolsInfo.push(`- **${tool.name}**: ${shortDescription}`);
      }
    }
  }

  return toolsInfo;
};

const buildToolsContext = (toolList: ToolGroup[]): string => {
  const toolsInfo = buildToolsInfo(toolList);
  if (toolsInfo.length === 0) {
    return "";
  }
  return `\n\n## Available Tools\n\nThe agent will have access to the following tools:\n\n${toolsInfo.join(
    "\n"
  )}\n\nWhen generating the prompt, you may reference these tools naturally if they are relevant to the agent's goal, but do not list them exhaustively.`;
};

const buildExistingPromptContext = (
  agent: AgentPromptContext | null
): string => {
  if (!agent?.systemPrompt || agent.systemPrompt.trim().length === 0) {
    return "";
  }
  return `\n\n## Existing System Prompt\n\n${agent.systemPrompt}\n\nPlease build upon or refine this existing prompt based on the goal above.`;
};

describe("POST /api/workspaces/:workspaceId/agents/generate-prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks
    mockCheckPromptGenerationLimit.mockResolvedValue(undefined);
    mockIncrementPromptGenerationBucket.mockResolvedValue({
      pk: "request-buckets/sub-123/prompt-generation/2024-01-01T00:00:00.000Z",
      subscriptionId: "sub-123",
      category: "prompt-generation",
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
    mockGenerateToolList.mockReturnValue([]);
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
        const goal = extractGoal(req.body);
        const agentId = (req.body as { agentId?: unknown })?.agentId;

        const db = await mockDatabase();

        const { workspaceId, currentUserRef } = requireWorkspaceContext(req);

        // Get agent information if agentId is provided
        const agent = await loadAgentForPrompt(db, workspaceId, agentId);

        // Check for email connection
        const hasEmailConnection = await loadEmailConnection(db, workspaceId);

        // Load enabled MCP servers if agent has them
        const enabledMcpServerIds = agent?.enabledMcpServerIds || [];
        const enabledMcpServers = await loadEnabledMcpServers(
          db,
          workspaceId,
          enabledMcpServerIds
        );

        // Use shared tool metadata library to generate tool list
        const toolList = buildToolList({
          agent,
          workspaceId,
          enabledMcpServers,
          emailConnection: hasEmailConnection,
        });

        // Convert tool metadata to text format for prompt generation
        const toolsContext = buildToolsContext(toolList);

        // Build existing prompt context if available
        const existingPromptContext = buildExistingPromptContext(agent);

        // Check prompt generation limit before LLM call
        await mockCheckPromptGenerationLimit(workspaceId);

        // Create model for prompt generation (using OpenRouter provider with default model)
        const model = await mockCreateModel(
          "openrouter",
          undefined, // Use default model
          workspaceId,
          "http://localhost:3000/api/prompt-generation",
          currentUserRef
        );

        // Generate the prompt
        const result = await mockGenerateText({
          model: model as unknown as Parameters<
            typeof generateText
          >[0]["model"],
          system: PROMPT_SYSTEM_TEXT,
          messages: [
            {
              role: "user",
              content: `Generate a system prompt for an AI agent with the following goal:\n\n${goal.trim()}${existingPromptContext}${toolsContext}`,
            },
          ],
        });

        const generatedPrompt = result.text.trim();

        // Track successful prompt generation (increment bucket)
        try {
          await mockIncrementPromptGenerationBucket(workspaceId);
        } catch (error) {
          // Log error but don't fail the request
          console.error("Error incrementing prompt generation bucket:", error);
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
    mockGenerateToolList.mockReturnValue([]);

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

    expect(mockCheckPromptGenerationLimit).toHaveBeenCalledWith("workspace-123");
    expect(mockCreateModel).toHaveBeenCalledWith(
      "openrouter",
      undefined,
      "workspace-123",
      "http://localhost:3000/api/prompt-generation",
      "users/user-123"
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
    expect(mockIncrementPromptGenerationBucket).toHaveBeenCalledWith("workspace-123");
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
    expect(mockIncrementPromptGenerationBucket).not.toHaveBeenCalled();
  });

  it("should check prompt generation limit before LLM call", async () => {
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
    expect(mockCheckPromptGenerationLimit).toHaveBeenCalledBefore(
      mockCreateModel as unknown as ReturnType<typeof vi.fn>
    );
  });

  it("should increment prompt generation bucket after successful LLM call", async () => {
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
      mockIncrementPromptGenerationBucket as unknown as ReturnType<typeof vi.fn>
    );
    expect(mockIncrementPromptGenerationBucket).toHaveBeenCalledWith("workspace-123");
  });

  it("should handle missing subscription gracefully", async () => {
    // checkPromptGenerationLimit will throw if subscription not found
    const subscriptionError = new Error("Could not find subscription for workspace workspace-123");
    mockCheckPromptGenerationLimit.mockRejectedValue(subscriptionError);

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
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    // Should throw error if subscription not found
    expect(next).toHaveBeenCalledWith(subscriptionError);
  });

  it("should handle prompt generation bucket increment errors gracefully", async () => {
    const mockModel = { model: "mock-model" };
    mockCreateModel.mockResolvedValue(mockModel);

    const mockGenerateTextResult = {
      text: "Generated prompt",
    };
    mockGenerateText.mockResolvedValue(mockGenerateTextResult);

    const bucketError = new Error("Failed to increment bucket");
    mockIncrementPromptGenerationBucket.mockRejectedValue(bucketError);

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

  it("should include existing system prompt when agentId is provided", async () => {
    const mockModel = { model: "mock-model" };
    mockCreateModel.mockResolvedValue(mockModel);

    const existingPrompt = "You are a helpful assistant. Always be polite and professional.";
    const mockDb = createMockDatabase();
    const mockAgentGet = vi.fn().mockResolvedValue({
      pk: "agents/workspace-123/agent-123",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: existingPrompt,
      enableSearchDocuments: false,
      enableMemorySearch: false,
      enableSendEmail: false,
      searchWebProvider: null,
      fetchWebProvider: null,
      enableExaSearch: false,
      delegatableAgentIds: [],
      enabledMcpServerIds: [],
      clientTools: [],
    });
    mockDb.agent.get = mockAgentGet;
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: vi.fn().mockResolvedValue(null),
    };
    (mockDb as Record<string, unknown>)["mcp-server"] = {
      get: vi.fn().mockResolvedValue(null),
    };
    mockDatabase.mockResolvedValue(mockDb);

    mockGenerateToolList.mockReturnValue([]);

    const mockGenerateTextResult = {
      text: "Refined system prompt",
    };
    mockGenerateText.mockResolvedValue(mockGenerateTextResult);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123" },
      body: {
        goal: "I want to improve the agent's response quality",
        agentId: "agent-123",
      },
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockAgentGet).toHaveBeenCalledWith(
      "agents/workspace-123/agent-123",
      "agent"
    );
    expect(mockGenerateText).toHaveBeenCalledWith({
      model: mockModel,
      system: expect.stringContaining(
        "If an existing system prompt is provided"
      ),
      messages: [
        {
          role: "user",
          content: expect.stringContaining(
            `## Existing System Prompt\n\n${existingPrompt}\n\nPlease build upon or refine this existing prompt based on the goal above.`
          ),
        },
      ],
    });
    expect(res.json).toHaveBeenCalledWith({
      prompt: mockGenerateTextResult.text.trim(),
    });
  });

  it("should not include existing prompt section when agent has empty system prompt", async () => {
    const mockModel = { model: "mock-model" };
    mockCreateModel.mockResolvedValue(mockModel);

    const mockDb = createMockDatabase();
    const mockAgentGet = vi.fn().mockResolvedValue({
      pk: "agents/workspace-123/agent-123",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "",
      enableSearchDocuments: false,
      enableMemorySearch: false,
      enableSendEmail: false,
      searchWebProvider: null,
      fetchWebProvider: null,
      enableExaSearch: false,
      delegatableAgentIds: [],
      enabledMcpServerIds: [],
      clientTools: [],
    });
    mockDb.agent.get = mockAgentGet;
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: vi.fn().mockResolvedValue(null),
    };
    (mockDb as Record<string, unknown>)["mcp-server"] = {
      get: vi.fn().mockResolvedValue(null),
    };
    mockDatabase.mockResolvedValue(mockDb);

    mockGenerateToolList.mockReturnValue([]);

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
        agentId: "agent-123",
      },
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockAgentGet).toHaveBeenCalledWith(
      "agents/workspace-123/agent-123",
      "agent"
    );
    expect(mockGenerateText).toHaveBeenCalledWith({
      model: mockModel,
      system: expect.any(String),
      messages: [
        {
          role: "user",
          content: expect.not.stringContaining("## Existing System Prompt"),
        },
      ],
    });
    expect(res.json).toHaveBeenCalledWith({
      prompt: mockGenerateTextResult.text.trim(),
    });
  });

  it("should not include existing prompt section when agentId is not provided", async () => {
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

    expect(mockGenerateText).toHaveBeenCalledWith({
      model: mockModel,
      system: expect.any(String),
      messages: [
        {
          role: "user",
          content: expect.not.stringContaining("## Existing System Prompt"),
        },
      ],
    });
    expect(res.json).toHaveBeenCalledWith({
      prompt: mockGenerateTextResult.text.trim(),
    });
  });

  it("should include tools information when tools are available", async () => {
    const mockModel = { model: "mock-model" };
    mockCreateModel.mockResolvedValue(mockModel);

    const mockGenerateTextResult = {
      text: "Generated prompt with tools",
    };
    mockGenerateText.mockResolvedValue(mockGenerateTextResult);

    const mockDb = createMockDatabase();
    const mockAgentGet = vi.fn().mockResolvedValue({
      pk: "agents/workspace-123/agent-123",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      enableSearchDocuments: true,
      enableMemorySearch: false,
      enableSendEmail: false,
      searchWebProvider: null,
      fetchWebProvider: null,
      enableExaSearch: false,
      delegatableAgentIds: [],
      enabledMcpServerIds: [],
      clientTools: [],
    });
    mockDb.agent.get = mockAgentGet;
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: vi.fn().mockResolvedValue(null),
    };
    (mockDb as Record<string, unknown>)["mcp-server"] = {
      get: vi.fn().mockResolvedValue(null),
    };
    mockDatabase.mockResolvedValue(mockDb);

    // Mock tool list with available tools
    mockGenerateToolList.mockReturnValue([
      {
        category: "Document Tools",
        tools: [
          {
            name: "search_documents",
            description: "Search workspace documents using semantic vector search.",
            category: "Document Tools",
            alwaysAvailable: false,
            condition: "Available (document search enabled)",
            parameters: [],
          },
        ],
      },
    ]);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123" },
      body: {
        goal: "I want an agent that searches documents",
        agentId: "agent-123",
      },
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockGenerateToolList).toHaveBeenCalled();
    expect(mockGenerateText).toHaveBeenCalledWith({
      model: mockModel,
      system: expect.any(String),
      messages: [
        {
          role: "user",
          content: expect.stringContaining("## Available Tools"),
        },
      ],
    });
  });

  it("should include MCP server tools when enabled", async () => {
    const mockModel = { model: "mock-model" };
    mockCreateModel.mockResolvedValue(mockModel);

    const mockGenerateTextResult = {
      text: "Generated prompt",
    };
    mockGenerateText.mockResolvedValue(mockGenerateTextResult);

    const mockDb = createMockDatabase();
    const mockAgentGet = vi.fn().mockResolvedValue({
      pk: "agents/workspace-123/agent-123",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      enableSearchDocuments: false,
      enableMemorySearch: false,
      enableSendEmail: false,
      searchWebProvider: null,
      fetchWebProvider: null,
      enableExaSearch: false,
      delegatableAgentIds: [],
      enabledMcpServerIds: ["server-1"],
      clientTools: [],
    });
    mockDb.agent.get = mockAgentGet;
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: vi.fn().mockResolvedValue(null),
    };
    (mockDb as Record<string, unknown>)["mcp-server"] = {
      get: vi.fn().mockResolvedValue({
        pk: "mcp-servers/workspace-123/server-1",
        sk: "server",
        workspaceId: "workspace-123",
        name: "GitHub Server",
        serviceType: "github",
        authType: "oauth",
        config: { accessToken: "token-123" },
      }),
    };
    mockDatabase.mockResolvedValue(mockDb);

    mockGenerateToolList.mockReturnValue([
      {
        category: "MCP Server Tools",
        tools: [
          {
            name: "github_list_repositories",
            description: "List repositories",
            category: "MCP Server Tools",
            alwaysAvailable: false,
            condition: 'Available (GitHub "GitHub Server" connected)',
            parameters: [],
          },
        ],
      },
    ]);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123" },
      body: {
        goal: "I want an agent with GitHub access",
        agentId: "agent-123",
      },
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockGenerateToolList).toHaveBeenCalledWith(
      expect.objectContaining({
        enabledMcpServers: [
          {
            id: "server-1",
            name: "GitHub Server",
            serviceType: "github",
            authType: "oauth",
            oauthConnected: true,
          },
        ],
      })
    );
    expect(mockGenerateText).toHaveBeenCalledWith({
      model: mockModel,
      system: expect.any(String),
      messages: [
        {
          role: "user",
          content: expect.stringContaining("GitHub (GitHub Server)"),
        },
      ],
    });
  });
});
