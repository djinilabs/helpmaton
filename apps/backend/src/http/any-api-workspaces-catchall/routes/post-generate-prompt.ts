import { badRequest, resourceGone, unauthorized } from "@hapi/boom";
import { generateText } from "ai";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import {
  checkPromptGenerationLimit,
  incrementPromptGenerationBucket,
} from "../../../utils/requestTracking";
import { generateToolList } from "../../../utils/toolMetadata";
import { trackBusinessEvent } from "../../../utils/tracking";
import { validateBody } from "../../utils/bodyValidation";
import { createModel } from "../../utils/modelFactory";
import { generatePromptRequestSchema } from "../../utils/schemas/requestSchemas";
import { extractUserId } from "../../utils/session";
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

        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }
        const workspaceId = req.params.workspaceId;

        // Get database connection
        const db = await database();

        // Get agent information if agentId is provided (for editing existing agent)
        let agent: {
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
        } | null = null;

        if (agentId && typeof agentId === "string") {
          const agentPk = `agents/${workspaceId}/${agentId}`;
          const agentRecord = await db.agent.get(agentPk, "agent");
          if (!agentRecord) {
            throw resourceGone("Agent not found");
          }
          if (agentRecord.workspaceId !== workspaceId) {
            throw badRequest("Agent does not belong to this workspace");
          }
          agent = {
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
        }

        // Check for email connection in workspace
        const emailConnectionPk = `email-connections/${workspaceId}`;
        const emailConnection = await db["email-connection"].get(
          emailConnectionPk,
          "connection"
        );
        const hasEmailConnection = !!emailConnection;

        // Load enabled MCP servers if agent has them
        const enabledMcpServerIds = agent?.enabledMcpServerIds || [];
        const enabledMcpServers = [];

        for (const serverId of enabledMcpServerIds) {
          const serverPk = `mcp-servers/${workspaceId}/${serverId}`;
          const server = await db["mcp-server"].get(serverPk, "server");
          if (server) {
            // Check for OAuth connection
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

        // Use shared tool metadata library to generate tool list
        const toolList = generateToolList({
          agent: {
            enableSearchDocuments: agent?.enableSearchDocuments ?? false,
            enableMemorySearch: agent?.enableMemorySearch ?? false,
            notificationChannelId: agent?.notificationChannelId,
            enableSendEmail: agent?.enableSendEmail ?? false,
            searchWebProvider: agent?.searchWebProvider ?? null,
            fetchWebProvider: agent?.fetchWebProvider ?? null,
            enableExaSearch: agent?.enableExaSearch ?? false,
            delegatableAgentIds: agent?.delegatableAgentIds ?? [],
            enabledMcpServerIds: agent?.enabledMcpServerIds ?? [],
            clientTools: agent?.clientTools ?? [],
          },
          workspaceId,
          enabledMcpServers,
          emailConnection: hasEmailConnection,
        });

        // Convert tool metadata to text format for prompt generation
        const toolsInfo: string[] = [];
        const availableTools: string[] = [];

        for (const group of toolList) {
          // Only include available tools (skip tools that are not available)
          const availableToolsInGroup = group.tools.filter(
            (tool) =>
              tool.alwaysAvailable ||
              (tool.condition && tool.condition.includes("Available"))
          );

          if (availableToolsInGroup.length === 0) {
            continue;
          }

          // Add category header
          if (group.category === "MCP Server Tools") {
            toolsInfo.push("## MCP Server Tools");
          } else if (group.category === "Client Tools") {
            toolsInfo.push("## Client-Side Tools (Custom)");
          } else {
            toolsInfo.push(`## ${group.category}`);
          }

          // Group MCP tools by server name for better formatting
          if (group.category === "MCP Server Tools") {
            // Group tools by server (extract server name from condition)
            const toolsByServer = new Map<string, string[]>();
            for (const tool of availableToolsInGroup) {
              availableTools.push(tool.name);

              // Extract server name from condition if available
              // Format: "Available (GitHub \"server-name\" connected)"
              let serverName = "Unknown";
              if (tool.condition) {
                const match = tool.condition.match(/"([^"]+)"/);
                if (match) {
                  serverName = match[1];
                }
              }

              // Extract service type from tool name
              let serviceType = "";
              if (tool.name.startsWith("google_drive_")) {
                serviceType = "Google Drive";
              } else if (tool.name.startsWith("gmail_")) {
                serviceType = "Gmail";
              } else if (tool.name.startsWith("google_calendar_")) {
                serviceType = "Google Calendar";
              } else if (tool.name.startsWith("notion_")) {
                serviceType = "Notion";
              } else if (tool.name.startsWith("github_")) {
                serviceType = "GitHub";
              } else if (tool.name.startsWith("mcp_")) {
                serviceType = "MCP Server";
              }

              const key = serviceType
                ? `${serviceType} (${serverName})`
                : `MCP Server (${serverName})`;
              if (!toolsByServer.has(key)) {
                toolsByServer.set(key, []);
              }
              toolsByServer.get(key)!.push(tool.name);
            }

            // Format MCP tools grouped by server
            for (const [serverKey, toolNames] of toolsByServer.entries()) {
              toolsInfo.push(`- **${serverKey}**: ${toolNames.join(", ")}`);
            }
          } else {
            // For non-MCP tools, list them individually
            for (const tool of availableToolsInGroup) {
              availableTools.push(tool.name);
              // Use a simplified description for prompt generation
              const shortDescription = tool.description
                .split(".")
                .slice(0, 1)
                .join(".")
                .trim();
              toolsInfo.push(`- **${tool.name}**: ${shortDescription}`);
            }
          }
        }

        // Build tools context for prompt generation
        const toolsContext =
          toolsInfo.length > 0
            ? `\n\n## Available Tools\n\nThe agent will have access to the following tools:\n\n${toolsInfo.join(
                "\n"
              )}\n\nWhen generating the prompt, you may reference these tools naturally if they are relevant to the agent's goal, but do not list them exhaustively.`
            : "";

        // Build existing prompt context if available
        const existingPromptContext =
          agent?.systemPrompt && agent.systemPrompt.trim().length > 0
            ? `\n\n## Existing System Prompt\n\n${agent.systemPrompt}\n\nPlease build upon or refine this existing prompt based on the goal above.`
            : "";

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
        const result = await generateText({
          model: model as unknown as Parameters<
            typeof generateText
          >[0]["model"],
          system: PROMPT_GENERATOR_SYSTEM_PROMPT,
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
          console.log(
            "[Prompt Generation] Incrementing prompt generation bucket for workspace:",
            workspaceId
          );
          await incrementPromptGenerationBucket(workspaceId);
          console.log(
            "[Prompt Generation] Successfully incremented prompt generation bucket:",
            workspaceId
          );
        } catch (error) {
          // Log error but don't fail the request
          console.error(
            "[Prompt Generation] Error incrementing prompt generation bucket:",
            {
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
              workspaceId,
            }
          );
        }

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
