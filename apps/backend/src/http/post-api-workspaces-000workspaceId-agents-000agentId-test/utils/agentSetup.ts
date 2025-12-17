import { jsonSchema, tool } from "ai";

import { database } from "../../../tables";
import {
  createAgentModel,
  createSearchDocumentsTool,
  createSendNotificationTool,
  createSendEmailTool,
  createListAgentsTool,
  createCallAgentTool,
  getWorkspaceApiKey,
  validateWorkspaceAndAgent,
  type WorkspaceAndAgent,
} from "../../utils/agentUtils";
import { createMcpServerTools } from "../../utils/mcpUtils";
import { createSearchMemoryTool } from "../../utils/memorySearchTool";

export interface AgentSetup {
  agent: WorkspaceAndAgent["agent"];
  model: Awaited<ReturnType<typeof createAgentModel>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tools have varying types, including dynamic MCP tools
  tools: Record<string, any>;
  usesByok: boolean;
}

export interface AgentSetupOptions {
  modelReferer?: string;
  searchDocumentsOptions?: Parameters<typeof createSearchDocumentsTool>[1];
  callDepth?: number;
  maxDelegationDepth?: number;
  userId?: string;
}

/**
 * Logs tool definitions to console for debugging
 */
export function logToolDefinitions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tools have varying types
  tools: Record<string, any>,
  context: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Agent type varies
  agent?: any
): void {
  if (!tools || Object.keys(tools).length === 0) {
    console.log(`[${context}] No tools available`);
    return;
  }

  // Create a map of client tool parameters for quick lookup
  const clientToolParamsMap = new Map<string, Record<string, unknown>>();
  if (agent?.clientTools && Array.isArray(agent.clientTools)) {
    for (const clientTool of agent.clientTools) {
      clientToolParamsMap.set(clientTool.name, clientTool.parameters);
    }
  }

  console.log(
    `[${context}] Tool definitions (${Object.keys(tools).length} tools):`
  );
  for (const [toolName, toolDef] of Object.entries(tools)) {
    const description =
      (toolDef as { description?: string }).description || "No description";

    // For client tools, use the original parameters from agent configuration
    // For other tools, try to extract from the tool object
    let parameters: unknown = {};
    if (clientToolParamsMap.has(toolName)) {
      // Client tool - use original parameters from agent config
      parameters = clientToolParamsMap.get(toolName)!;
    } else {
      // Server-side tool - try to extract from tool object
      const toolObj = toolDef as {
        inputSchema?: unknown;
        parameters?: unknown;
        schema?: unknown;
      };
      parameters =
        toolObj.inputSchema || toolObj.parameters || toolObj.schema || {};
    }

    console.log(`  - ${toolName}:`, {
      description,
      parameters: JSON.stringify(parameters, null, 2),
    });
  }
}

/**
 * Creates client-side tools from agent configuration
 * These tools have no server-side execute function - they will be executed on the client
 */
export function createClientTools(
  clientTools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>
): Record<string, ReturnType<typeof tool>> {
  if (!clientTools || clientTools.length === 0) {
    return {};
  }

  const tools: Record<string, ReturnType<typeof tool>> = {};

  for (const toolDef of clientTools) {
    // Create tool with no-op execute function
    // The absence of a real server-side implementation identifies this as a client-side tool
    // AI SDK requires inputSchema (not parameters) and jsonSchema() wrapper for JSON Schema
    tools[toolDef.name] = tool({
      description: toolDef.description,
      inputSchema: jsonSchema(toolDef.parameters as Record<string, unknown>),
    });
  }

  return tools;
}

/**
 * Validates workspace/agent and sets up model and tools
 */
export async function setupAgentAndTools(
  workspaceId: string,
  agentId: string,
  messages: unknown[],
  options?: AgentSetupOptions
): Promise<AgentSetup> {
  const { agent } = await validateWorkspaceAndAgent(workspaceId, agentId);

  // Fetch workspace API key if it exists (only for Google provider since createAgentModel only supports Google)
  const agentProvider = "google"; // createAgentModel only supports Google
  const workspaceApiKey = await getWorkspaceApiKey(workspaceId, agentProvider);
  const usesByok = workspaceApiKey !== null;

  // Use agent's modelName if set, otherwise use default
  const modelName =
    typeof agent.modelName === "string" ? agent.modelName : undefined;

  const model = await createAgentModel(
    options?.modelReferer || "http://localhost:3000/api/workspaces",
    workspaceApiKey || undefined,
    modelName,
    workspaceId,
    agentId,
    usesByok,
    options?.userId
  );

  const searchDocumentsTool = createSearchDocumentsTool(workspaceId, {
    messages,
    ...options?.searchDocumentsOptions,
  });

  // Extract agentId from agent.pk (format: "agents/{workspaceId}/{agentId}")
  const extractedAgentId = agent.pk.replace(`agents/${workspaceId}/`, "");

  const tools: AgentSetup["tools"] = {
    search_documents: searchDocumentsTool,
    search_memory: createSearchMemoryTool(extractedAgentId, workspaceId),
  };

  if (agent.notificationChannelId) {
    tools.send_notification = createSendNotificationTool(
      workspaceId,
      agent.notificationChannelId
    );
  }

  // Check if workspace has email connection
  const db = await database();
  const emailConnectionPk = `email-connections/${workspaceId}`;
  const emailConnection = await db["email-connection"].get(
    emailConnectionPk,
    "connection"
  );
  if (emailConnection) {
    tools.send_email = createSendEmailTool(workspaceId);
  }

  // Add delegation tools if agent has delegatable agents configured
  if (
    agent.delegatableAgentIds &&
    Array.isArray(agent.delegatableAgentIds) &&
    agent.delegatableAgentIds.length > 0
  ) {
    const callDepth = options?.callDepth ?? 0;
    const maxDepth = options?.maxDelegationDepth ?? 3;

    tools.list_agents = createListAgentsTool(
      workspaceId,
      agent.delegatableAgentIds
    );

    // Extract agentId from agent.pk (format: "agents/{workspaceId}/{agentId}")
    const agentId = agent.pk.replace(`agents/${workspaceId}/`, "");
    tools.call_agent = createCallAgentTool(
      workspaceId,
      agent.delegatableAgentIds,
      agentId,
      callDepth,
      maxDepth
    );
  }

  // Add MCP server tools if agent has enabled MCP servers
  if (
    agent.enabledMcpServerIds &&
    Array.isArray(agent.enabledMcpServerIds) &&
    agent.enabledMcpServerIds.length > 0
  ) {
    const mcpTools = await createMcpServerTools(
      workspaceId,
      agent.enabledMcpServerIds
    );
    // Merge MCP tools into tools object
    Object.assign(tools, mcpTools);
  }

  // Add client-side tools if agent has client tools configured
  if (
    agent.clientTools &&
    Array.isArray(agent.clientTools) &&
    agent.clientTools.length > 0
  ) {
    console.log("[Agent Setup] Adding client tools:", agent.clientTools);
    const clientTools = createClientTools(agent.clientTools);
    // Merge client tools into tools object
    Object.assign(tools, clientTools);
  }

  return { agent, model, tools, usesByok };
}
