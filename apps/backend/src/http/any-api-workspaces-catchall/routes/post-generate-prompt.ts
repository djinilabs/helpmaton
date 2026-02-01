import { badRequest, resourceGone } from "@hapi/boom";
import { generateText } from "ai";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import {
  checkPromptGenerationLimit,
  incrementPromptGenerationBucketSafe,
} from "../../../utils/requestTracking";
import { generateToolList, type ToolMetadata } from "../../../utils/toolMetadata";
import { trackBusinessEvent } from "../../../utils/tracking";
import { validateBody } from "../../utils/bodyValidation";
import { createModel } from "../../utils/modelFactory";
import {
  createRequestTimeout,
  cleanupRequestTimeout,
} from "../../utils/requestTimeout";
import { generatePromptRequestSchema } from "../../utils/schemas/requestSchemas";
import { extractUserId } from "../../utils/session";
import { requireWorkspaceContext } from "../../utils/workspaceContext";
import { handleError, requireAuth, requirePermission } from "../middleware";

const PROMPT_GENERATOR_SYSTEM_PROMPT = `You are an expert at writing effective system prompts for AI agents. Your task is to generate clear, actionable system prompts based on user-provided goals and available tools.

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
  enabledMcpServerToolNames?: Record<string, string[]>;
  enableMemorySearch?: boolean;
  enableSearchDocuments?: boolean;
  enableSendEmail?: boolean;
  searchWebProvider?: "tavily" | "jina" | null;
  fetchWebProvider?: "tavily" | "jina" | "scrape" | null;
  enableExaSearch?: boolean;
};

type EnabledMcpServer = {
  id: string;
  name: string;
  serviceType?: string;
  authType: string;
  oauthConnected: boolean;
};

type ToolGroup = {
  category: string;
  tools: ToolMetadata[];
};

const loadAgentForPrompt = async (params: {
  db: Awaited<ReturnType<typeof database>>;
  workspaceId: string;
  agentId?: string;
}): Promise<AgentPromptContext | null> => {
  const { db, workspaceId, agentId } = params;
  if (!agentId) {
    return null;
  }
  const agentPk = `agents/${workspaceId}/${agentId}`;
  const agentRecord = await db.agent.get(agentPk, "agent");
  if (!agentRecord) {
    throw resourceGone("Agent not found");
  }
  if (agentRecord.workspaceId !== workspaceId) {
    throw badRequest("Agent does not belong to this workspace");
  }
  return {
    systemPrompt: agentRecord.systemPrompt,
    clientTools: agentRecord.clientTools,
    notificationChannelId: agentRecord.notificationChannelId,
    delegatableAgentIds: agentRecord.delegatableAgentIds,
    enabledMcpServerIds: agentRecord.enabledMcpServerIds,
    enabledMcpServerToolNames: agentRecord.enabledMcpServerToolNames,
    enableMemorySearch: agentRecord.enableMemorySearch,
    enableSearchDocuments: agentRecord.enableSearchDocuments,
    enableSendEmail: agentRecord.enableSendEmail,
    searchWebProvider: agentRecord.searchWebProvider ?? null,
    fetchWebProvider: agentRecord.fetchWebProvider ?? null,
    enableExaSearch: agentRecord.enableExaSearch ?? false,
  };
};

const loadEmailConnection = async (
  db: Awaited<ReturnType<typeof database>>,
  workspaceId: string
): Promise<boolean> => {
  const emailConnectionPk = `email-connections/${workspaceId}`;
  const emailConnection = await db["email-connection"].get(
    emailConnectionPk,
    "connection"
  );
  return !!emailConnection;
};

const loadEnabledMcpServers = async (params: {
  db: Awaited<ReturnType<typeof database>>;
  workspaceId: string;
  enabledMcpServerIds: string[];
}): Promise<EnabledMcpServer[]> => {
  const { db, workspaceId, enabledMcpServerIds } = params;
  const enabledMcpServers: EnabledMcpServer[] = [];

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
  enabledMcpServers: EnabledMcpServer[];
  emailConnection: boolean;
}): ToolGroup[] => {
  return generateToolList({
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
      enabledMcpServerToolNames:
        params.agent?.enabledMcpServerToolNames ?? undefined,
      clientTools: params.agent?.clientTools ?? [],
    },
    workspaceId: params.workspaceId,
    enabledMcpServers: params.enabledMcpServers,
    emailConnection: params.emailConnection,
  });
};

const resolveMcpServerName = (tool: ToolMetadata): string => {
  if (!tool.condition) {
    return "Unknown";
  }
  const match = tool.condition.match(/"([^"]+)"/);
  return match ? match[1] : "Unknown";
};

const resolveServiceTypeForTool = (toolName: string): string => {
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
      (tool) =>
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
        const serverName = resolveMcpServerName(tool);
        const serviceType = resolveServiceTypeForTool(tool.name);
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

const buildExistingPromptContext = (agent: AgentPromptContext | null): string => {
  if (!agent?.systemPrompt || agent.systemPrompt.trim().length === 0) {
    return "";
  }
  return `\n\n## Existing System Prompt\n\n${agent.systemPrompt}\n\nPlease build upon or refine this existing prompt based on the goal above.`;
};

const buildPromptMessage = (params: {
  goal: string;
  existingPromptContext: string;
  toolsContext: string;
}) =>
  `Generate a system prompt for an AI agent with the following goal:\n\n${params.goal.trim()}${params.existingPromptContext}${params.toolsContext}`;

const generatePromptText = async (params: {
  model: Parameters<typeof generateText>[0]["model"];
  goal: string;
  existingPromptContext: string;
  toolsContext: string;
}): Promise<string> => {
  console.log("[Prompt Generation] generateText arguments:", {
    model: "default",
    systemPromptLength: PROMPT_GENERATOR_SYSTEM_PROMPT.length,
    messagesCount: 1,
  });
  const requestTimeout = createRequestTimeout();
  try {
    const result = await generateText({
      model: params.model,
      system: PROMPT_GENERATOR_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildPromptMessage({
            goal: params.goal,
            existingPromptContext: params.existingPromptContext,
            toolsContext: params.toolsContext,
          }),
        },
      ],
      abortSignal: requestTimeout.signal,
    });
    return result.text.trim();
  } finally {
    cleanupRequestTimeout(requestTimeout);
  }
};

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/generate-prompt:
 *   post:
 *     summary: Generate system prompt for an agent
 *     description: Generates a system prompt for an AI agent based on a user-provided goal and available tools
 *     tags:
 *       - Agents
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: workspaceId
 *         in: path
 *         required: true
 *         description: Workspace ID
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GeneratePromptRequest'
 *     responses:
 *       200:
 *         description: Generated system prompt
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GeneratePromptResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Agent not found (when agentId is provided)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostGeneratePrompt = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/agents/generate-prompt",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const body = validateBody(req.body, generatePromptRequestSchema);
        const { goal, agentId } = body;

        const { workspaceId } = requireWorkspaceContext(req);

        // Get database connection
        const db = await database();

        // Get agent information if agentId is provided (for editing existing agent)
        const agent = await loadAgentForPrompt({
          db,
          workspaceId,
          agentId,
        });

        // Check for email connection in workspace
        const hasEmailConnection = await loadEmailConnection(db, workspaceId);

        // Load enabled MCP servers if agent has them
        const enabledMcpServerIds = agent?.enabledMcpServerIds || [];
        const enabledMcpServers = await loadEnabledMcpServers({
          db,
          workspaceId,
          enabledMcpServerIds,
        });

        // Use shared tool metadata library to generate tool list
        const toolList = buildToolList({
          agent,
          workspaceId,
          enabledMcpServers,
          emailConnection: hasEmailConnection,
        });

        const toolsContext = buildToolsContext(toolList);

        const existingPromptContext = buildExistingPromptContext(agent);

        // Check prompt generation limit before LLM call
        // Note: This is a soft limit - there's a small race condition window where
        // concurrent requests near the limit could all pass the check before incrementing.
        // This is acceptable as a user experience limit, not a security boundary.
        await checkPromptGenerationLimit(workspaceId);

        // Extract userId for PostHog tracking
        const userId = extractUserId(req);

        // Create model for prompt generation (using OpenRouter provider with default model)
        // PostHog tracking is automatically handled by createModel via withTracing
        const model = await createModel(
          "openrouter",
          undefined, // Use default model
          workspaceId,
          "http://localhost:3000/api/prompt-generation",
          userId
        );

        // Generate the prompt
        const generatedPrompt = await generatePromptText({
          model: model as unknown as Parameters<
            typeof generateText
          >[0]["model"],
          goal,
          existingPromptContext,
          toolsContext,
        });

        // Track successful prompt generation (increment bucket)
        await incrementPromptGenerationBucketSafe(workspaceId);

        // Track prompt generation
        trackBusinessEvent(
          "agent",
          "prompt_generated",
          {
            workspace_id: workspaceId,
          },
          req
        );

        res.json({
          prompt: generatedPrompt,
        });
      } catch (error) {
        handleError(
          error,
          next,
          "POST /api/workspaces/:workspaceId/agents/generate-prompt"
        );
      }
    }
  );
};
