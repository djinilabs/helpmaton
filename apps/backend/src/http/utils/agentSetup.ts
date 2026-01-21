import { randomUUID } from "crypto";

import { jsonSchema, tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import type { UIMessage } from "../../utils/messageTypes";
import { uploadConversationFile } from "../../utils/s3";
import type { AugmentedContext } from "../../utils/workspaceCreditContext";

import {
  createAgentModel,
  createSearchDocumentsTool,
  createSendNotificationTool,
  createSendEmailTool,
  createListAgentsTool,
  createCallAgentTool,
  createCallAgentAsyncTool,
  createCheckDelegationStatusTool,
  createGetDatetimeTool,
  getWorkspaceApiKey,
  validateWorkspaceAndAgent,
  type WorkspaceAndAgent,
} from "./agentUtils";
import type { LlmObserver } from "./llmObserver";
import { wrapToolsWithObserver } from "./llmObserver";
import { createMcpServerTools } from "./mcpUtils";
import { createSearchMemoryTool } from "./memorySearchTool";
import {
  resolveModelCapabilities,
  supportsToolCalling,
} from "./modelCapabilities";
import { getDefaultModel } from "./modelFactory";

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
  context?: AugmentedContext;
  conversationId?: string;
  conversationOwnerAgentId?: string; // Agent ID that owns the conversation (for delegation tracking)
  llmObserver?: LlmObserver;
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

const resolveAgentIdFromPk = (workspaceId: string, pk: string): string => {
  const extractedAgentId = pk.replace(`agents/${workspaceId}/`, "");
  if (!extractedAgentId || extractedAgentId.trim() === "") {
    throw new Error(
      `Invalid agent primary key format: expected "agents/${workspaceId}/{agentId}", got "${pk}"`
    );
  }
  return extractedAgentId;
};

const buildAgentConfig = (agent: WorkspaceAndAgent["agent"]) => ({
  temperature: agent.temperature,
  topP: agent.topP,
  topK: agent.topK,
  maxOutputTokens: agent.maxOutputTokens,
  stopSequences: agent.stopSequences,
});

const resolveModelName = (agent: WorkspaceAndAgent["agent"]) =>
  typeof agent.modelName === "string" ? agent.modelName : undefined;

const resolveEffectiveContext = (
  options?: AgentSetupOptions,
  context?: AugmentedContext
) => options?.context || context;

const addCoreTools = (
  tools: AgentSetup["tools"],
  workspaceId: string,
  agentId: string,
  agent: WorkspaceAndAgent["agent"],
  messages: unknown[],
  options?: AgentSetupOptions
) => {
  tools.get_datetime = createGetDatetimeTool();

  if (agent.enableSearchDocuments === true) {
    tools.search_documents = createSearchDocumentsTool(workspaceId, {
      messages,
      ...options?.searchDocumentsOptions,
    });
  }

  if (agent.enableMemorySearch === true) {
    tools.search_memory = createSearchMemoryTool(agentId, workspaceId);
  }

  if (agent.notificationChannelId) {
    tools.send_notification = createSendNotificationTool(
      workspaceId,
      agent.notificationChannelId
    );
  }
};

const addEmailToolIfAvailable = async (
  tools: AgentSetup["tools"],
  workspaceId: string,
  enabled: boolean
) => {
  if (!enabled) {
    return;
  }
  const db = await database();
  const emailConnectionPk = `email-connections/${workspaceId}`;
  const emailConnection = await db["email-connection"].get(
    emailConnectionPk,
    "connection"
  );
  if (emailConnection) {
    tools.send_email = createSendEmailTool(workspaceId);
  }
};

const addWebTools = async (params: {
  tools: AgentSetup["tools"];
  workspaceId: string;
  agentId: string;
  agent: WorkspaceAndAgent["agent"];
  options?: AgentSetupOptions;
  context?: AugmentedContext;
}) => {
  const effectiveContext = resolveEffectiveContext(params.options, params.context);

  if (params.agent.searchWebProvider === "tavily") {
    const { createTavilySearchTool } = await import("./tavilyTools");
    params.tools.search_web = createTavilySearchTool(
      params.workspaceId,
      effectiveContext,
      params.agentId,
      params.options?.conversationId
    );
  } else if (params.agent.searchWebProvider === "jina") {
    const { createJinaSearchTool } = await import("./tavilyTools");
    params.tools.search_web = createJinaSearchTool(
      params.workspaceId,
      params.agentId,
      params.options?.conversationId
    );
  }

  if (params.agent.fetchWebProvider === "tavily") {
    const { createTavilyFetchTool } = await import("./tavilyTools");
    params.tools.fetch_url = createTavilyFetchTool(
      params.workspaceId,
      effectiveContext,
      params.agentId,
      params.options?.conversationId
    );
  } else if (params.agent.fetchWebProvider === "jina") {
    const { createJinaFetchTool } = await import("./tavilyTools");
    params.tools.fetch_url = createJinaFetchTool(
      params.workspaceId,
      params.agentId,
      params.options?.conversationId
    );
  } else if (params.agent.fetchWebProvider === "scrape") {
    const conversationId = params.options?.conversationId;
    if (conversationId && params.agentId) {
      const { createScrapeFetchTool } = await import("./tavilyTools");
      params.tools.fetch_url = createScrapeFetchTool(
        params.workspaceId,
        effectiveContext,
        params.agentId,
        conversationId
      );
    } else {
      console.warn(
        "[Agent Setup] Scrape tool not created - missing required context:",
        {
          workspaceId: params.workspaceId,
          agentId: params.agentId,
          hasConversationId: !!conversationId,
          hasAgentId: !!params.agentId,
        }
      );
    }
  }

  if (params.agent.enableExaSearch === true) {
    const { createExaSearchTool } = await import("./exaTools");
    params.tools.search = createExaSearchTool(
      params.workspaceId,
      effectiveContext,
      params.agentId,
      params.options?.conversationId
    );
  }
};

const resolveImagePromptFromMessages = (messages: UIMessage[]): string | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") {
      continue;
    }
    if (typeof message.content === "string") {
      const trimmed = message.content.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
      continue;
    }
    if (Array.isArray(message.content)) {
      const textParts = message.content
        .map((part) => {
          if (
            part &&
            typeof part === "object" &&
            "type" in part &&
            part.type === "text" &&
            "text" in part &&
            typeof part.text === "string"
          ) {
            return part.text;
          }
          return "";
        })
        .filter((text) => text.trim().length > 0);
      if (textParts.length > 0) {
        return textParts.join("\n");
      }
    }
  }
  return null;
};

export const resolveImagePrompt = (
  prompt: string | undefined,
  observer?: LlmObserver
): string | null => {
  if (typeof prompt === "string") {
    const trimmed = prompt.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  if (!observer) {
    return null;
  }
  const events = observer.getEvents();
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "input-messages" && "messages" in event) {
      return resolveImagePromptFromMessages(event.messages);
    }
  }
  return null;
};

const addImageGenerationTool = async (params: {
  tools: AgentSetup["tools"];
  workspaceId: string;
  agentId: string;
  agent: WorkspaceAndAgent["agent"];
  options?: AgentSetupOptions;
}) => {
  if (params.agent.enableImageGeneration !== true) {
    return;
  }
  const modelName =
    typeof params.agent.imageGenerationModel === "string"
      ? params.agent.imageGenerationModel.trim()
      : "";
  if (!modelName) {
    console.warn(
      "[Agent Setup] Image generation enabled but no imageGenerationModel set"
    );
    return;
  }

  const workspaceKey = await getWorkspaceApiKey(
    params.workspaceId,
    "openrouter"
  );
  const apiKey = workspaceKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.warn(
      "[Agent Setup] OPENROUTER_API_KEY not set - image generation tool disabled"
    );
    return;
  }

  const generateImageSchema = z
    .object({
      prompt: z
        .string()
        .trim()
        .min(1, "prompt is required and cannot be empty")
        .optional()
        .describe(
          "Text prompt describing the image to generate. Be specific about style, subject, and composition."
        ),
    })
    .strict();
  type GenerateImageArgs = z.infer<typeof generateImageSchema>;
  const extractFromContentParts = (
    content:
      | string
      | Array<{
          type?: string;
          url?: string;
          data?: string;
          contentType?: string;
          mime_type?: string;
          image_url?: { url?: string };
          image?: { url?: string; data?: string; mime_type?: string };
        }>
      | undefined
  ): { url?: string; base64?: string; contentType?: string } | null => {
    if (!Array.isArray(content)) {
      return null;
    }
    for (const part of content) {
      if (typeof part?.image_url?.url === "string") {
        return { url: part.image_url.url };
      }
      if (typeof part?.image?.url === "string") {
        return { url: part.image.url };
      }
      if (typeof part?.image?.data === "string") {
        return {
          base64: part.image.data,
          contentType: part.image.mime_type,
        };
      }
      if (typeof part?.url === "string" && part.type?.includes("image")) {
        return { url: part.url };
      }
      if (typeof part?.data === "string" && part.type?.includes("image")) {
        return {
          base64: part.data,
          contentType: part.mime_type || part.contentType,
        };
      }
    }
    return null;
  };
  const extractFromImages = (
    images:
      | Array<{
          type?: string;
          image_url?: { url?: string };
          url?: string;
          data?: string;
          mime_type?: string;
          contentType?: string;
        }>
      | undefined
  ): { url?: string; base64?: string; contentType?: string } | null => {
    if (!Array.isArray(images)) {
      return null;
    }
    for (const image of images) {
      if (typeof image?.image_url?.url === "string") {
        return { url: image.image_url.url };
      }
      if (typeof image?.url === "string") {
        return { url: image.url };
      }
      if (typeof image?.data === "string") {
        return {
          base64: image.data,
          contentType: image.mime_type || image.contentType,
        };
      }
    }
    return null;
  };
  const extractFromContentString = (
    content: string | undefined
  ): { url?: string } | null => {
    if (typeof content !== "string") {
      return null;
    }
    if (content.startsWith("data:image/") || content.startsWith("http")) {
      return { url: content };
    }
    return null;
  };
  const extractFromFallback = (
    data: { data?: Array<{ url?: string; b64_json?: string }> }
  ): { url?: string; base64?: string } | null => {
    const fallback = data.data?.[0];
    if (typeof fallback?.url === "string") {
      return { url: fallback.url };
    }
    if (typeof fallback?.b64_json === "string") {
      return { base64: fallback.b64_json };
    }
    return null;
  };
  const extractImageOutput = (
    payload: unknown
  ): { url?: string; base64?: string; contentType?: string } | null => {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const data = payload as {
      choices?: Array<{
        message?: {
          content?:
            | string
            | Array<{
                type?: string;
                url?: string;
                data?: string;
                contentType?: string;
                mime_type?: string;
                image_url?: { url?: string };
                image?: { url?: string; data?: string; mime_type?: string };
              }>;
          images?: Array<{
            type?: string;
            image_url?: { url?: string };
            url?: string;
            data?: string;
            mime_type?: string;
            contentType?: string;
          }>;
        };
      }>;
      data?: Array<{ url?: string; b64_json?: string }>;
    };

    console.log("[Agent Setup] Image generation payload:", payload);
    console.log("[Agent Setup] Image generation data:", data);
    console.log("[Agent Setup] Image generation choices:", data.choices);
    console.log("[Agent Setup] Image generation choice 0:", data.choices?.[0]);
    console.log("[Agent Setup] Image generation choice 0 message:", data.choices?.[0]?.message);
    console.log("[Agent Setup] Image generation choice 0 message content:", data.choices?.[0]?.message?.content);

    const message = data.choices?.[0]?.message;
    const content = message?.content;
    console.log("[Agent Setup] Image generation images:", message?.images);

    return (
      extractFromContentParts(content) ||
      extractFromImages(message?.images) ||
      extractFromContentString(content as string | undefined) ||
      extractFromFallback(data)
    );
  };

  params.tools.generate_image = tool({
    description:
      "Generate an image from a text prompt using the configured image model. REQUIRED: You must pass a non-empty 'prompt' string describing the image. Example: {\"prompt\":\"A watercolor lighthouse on a rocky cliff at sunset\"}.",
    parameters: generateImageSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - Tool execution signature is compatible at runtime
    execute: async (args: GenerateImageArgs) => {
      const prompt = resolveImagePrompt(
        args?.prompt,
        params.options?.llmObserver
      );
      if (!prompt) {
        return "Error: generate_image requires a non-empty 'prompt' string describing the image to generate.";
      }
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      };
      if (params.options?.modelReferer) {
        headers["HTTP-Referer"] = params.options.modelReferer;
      }

      const response = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: modelName,
            messages: [
              {
                role: "user",
                content: prompt,
              },
            ],
            modalities: ["image", "text"],
          }),
        }
      );

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(
          `OpenRouter image generation failed: ${response.status} ${response.statusText} ${errorBody}`
        );
      }

      const result = (await response.json()) as unknown;
      const imageOutput = extractImageOutput(result);
      if (!imageOutput?.url && !imageOutput?.base64) {
        console.log("[Agent Setup] Image generation result:", result);
        throw new Error("image generation returned no image output");
      }

      let buffer: Buffer;
      let contentType = imageOutput?.contentType || "image/png";
      if (imageOutput?.url) {
        if (imageOutput.url.startsWith("data:")) {
          const match = imageOutput.url.match(/^data:(.+);base64,(.*)$/);
          if (!match) {
            throw new Error("OpenRouter returned an invalid data URL");
          }
          contentType = match[1] || contentType;
          buffer = Buffer.from(match[2] || "", "base64");
        } else {
          let filenameFromUrl: string | undefined;
          try {
            const parsedUrl = new URL(imageOutput.url);
            const basename = parsedUrl.pathname.split("/").pop();
            filenameFromUrl = basename || undefined;
          } catch {
            filenameFromUrl = imageOutput.url.split("/").pop();
          }
          return {
            url: imageOutput.url,
            contentType,
            filename: filenameFromUrl || "image.png",
            model: modelName,
          };
        }
      } else {
        buffer = Buffer.from(imageOutput.base64 || "", "base64");
      }

      const conversationId = params.options?.conversationId || randomUUID();
      const upload = await uploadConversationFile({
        workspaceId: params.workspaceId,
        agentId: params.agentId,
        conversationId,
        content: buffer,
        contentType,
      });

      return {
        url: upload.url,
        contentType,
        filename: upload.filename,
        model: modelName,
      };
    },
  });
};

const addDelegationTools = (params: {
  tools: AgentSetup["tools"];
  workspaceId: string;
  agent: WorkspaceAndAgent["agent"];
  agentId: string;
  options?: AgentSetupOptions;
}) => {
  if (
    !params.agent.delegatableAgentIds ||
    !Array.isArray(params.agent.delegatableAgentIds) ||
    params.agent.delegatableAgentIds.length === 0
  ) {
    return;
  }

  const callDepth = params.options?.callDepth ?? 0;
  const maxDepth = params.options?.maxDelegationDepth ?? 3;

  params.tools.list_agents = createListAgentsTool(
    params.workspaceId,
    params.agent.delegatableAgentIds
  );

  const conversationOwnerAgentId =
    params.options?.conversationOwnerAgentId || params.agentId;
  params.tools.call_agent = createCallAgentTool(
    params.workspaceId,
    params.agent.delegatableAgentIds,
    params.agentId,
    callDepth,
    maxDepth,
    params.options?.context,
    params.options?.conversationId,
    conversationOwnerAgentId
  );

  params.tools.call_agent_async = createCallAgentAsyncTool(
    params.workspaceId,
    params.agent.delegatableAgentIds,
    params.agentId,
    callDepth,
    maxDepth,
    params.options?.context,
    params.options?.conversationId
  );
  params.tools.check_delegation_status =
    createCheckDelegationStatusTool(params.workspaceId);
};

const addMcpTools = async (params: {
  tools: AgentSetup["tools"];
  workspaceId: string;
  agent: WorkspaceAndAgent["agent"];
}) => {
  if (
    !params.agent.enabledMcpServerIds ||
    !Array.isArray(params.agent.enabledMcpServerIds) ||
    params.agent.enabledMcpServerIds.length === 0
  ) {
    return;
  }
  const mcpTools = await createMcpServerTools(
    params.workspaceId,
    params.agent.enabledMcpServerIds
  );
  Object.assign(params.tools, mcpTools);
};

type ClientToolConfig = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

const hasClientTools = (
  agent: WorkspaceAndAgent["agent"]
): agent is WorkspaceAndAgent["agent"] & { clientTools: ClientToolConfig[] } =>
  Array.isArray(agent.clientTools) && agent.clientTools.length > 0;

const addClientTools = (
  tools: AgentSetup["tools"],
  agent: WorkspaceAndAgent["agent"]
) => {
  if (!hasClientTools(agent)) {
    return;
  }
  console.log("[Agent Setup] Adding client tools:", agent.clientTools);
  const clientTools = createClientTools(agent.clientTools);
  Object.assign(tools, clientTools);
};

/**
 * Validates workspace/agent and sets up model and tools
 */
export async function setupAgentAndTools(
  workspaceId: string,
  agentId: string,
  messages: unknown[],
  options?: AgentSetupOptions,
  context?: AugmentedContext
): Promise<AgentSetup> {
  const { agent } = await validateWorkspaceAndAgent(workspaceId, agentId);

  // Fetch workspace API key if it exists (only OpenRouter is supported for BYOK)
  const agentProvider = "openrouter"; // Only OpenRouter is supported for BYOK
  const workspaceApiKey = await getWorkspaceApiKey(workspaceId, agentProvider);
  const usesByok = workspaceApiKey !== null;

  // Use agent's modelName if set, otherwise use default
  const modelName = resolveModelName(agent);
  const resolvedModelName = modelName || getDefaultModel();
  const modelCapabilities = resolveModelCapabilities(
    agentProvider,
    resolvedModelName
  );
  const canUseTools = supportsToolCalling(modelCapabilities);

  // Extract agent config for advanced options
  const agentConfig = buildAgentConfig(agent);

  const model = await createAgentModel(
    options?.modelReferer || "http://localhost:3000/api/workspaces",
    workspaceApiKey || undefined,
    modelName,
    workspaceId,
    agentId,
    usesByok,
    options?.userId,
    agentProvider, // Pass provider to createAgentModel
    agentConfig, // Pass agent config with advanced options
    options?.llmObserver
  );

  // Extract agentId from agent.pk (format: "agents/{workspaceId}/{agentId}")
  const extractedAgentId = resolveAgentIdFromPk(workspaceId, agent.pk);

  const tools: AgentSetup["tools"] = {};

  if (canUseTools) {
    addCoreTools(tools, workspaceId, extractedAgentId, agent, messages, options);
    await addEmailToolIfAvailable(
      tools,
      workspaceId,
      agent.enableSendEmail === true
    );
    await addWebTools({
      tools,
      workspaceId,
      agentId: extractedAgentId,
      agent,
      options,
      context,
    });
    await addImageGenerationTool({
      tools,
      workspaceId,
      agentId: extractedAgentId,
      agent,
      options,
    });
    addDelegationTools({
      tools,
      workspaceId,
      agent,
      agentId: extractedAgentId,
      options,
    });
    await addMcpTools({ tools, workspaceId, agent });
    addClientTools(tools, agent);
  }

  return {
    agent,
    model,
    tools: wrapToolsWithObserver(tools, options?.llmObserver),
    usesByok,
  };
}
