import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import { z } from "zod";

import type { DatabaseSchema } from "../../../tables/schema";
import { isImageCapableModel } from "../../../utils/pricing";
import { buildMcpServerToolList } from "../../../utils/toolMetadata";
import { updateAgentSchema } from "../../utils/schemas/workspaceSchemas";

type UpdateAgentBody = z.infer<typeof updateAgentSchema>;

type Database = {
  agent: DatabaseSchema["agent"];
  output_channel: DatabaseSchema["output_channel"];
  "mcp-server": DatabaseSchema["mcp-server"];
};

type AgentRecord = Awaited<ReturnType<DatabaseSchema["agent"]["get"]>>;

const SEARCH_WEB_PROVIDERS = ["tavily", "jina"] as const;
const FETCH_WEB_PROVIDERS = ["tavily", "jina", "scrape"] as const;

const isSearchWebProvider = (
  value: string,
): value is (typeof SEARCH_WEB_PROVIDERS)[number] =>
  SEARCH_WEB_PROVIDERS.includes(value as (typeof SEARCH_WEB_PROVIDERS)[number]);

const isFetchWebProvider = (
  value: string,
): value is (typeof FETCH_WEB_PROVIDERS)[number] =>
  FETCH_WEB_PROVIDERS.includes(value as (typeof FETCH_WEB_PROVIDERS)[number]);

const resolveOptionalField = <T>(
  incoming: T | null | undefined,
  fallback: T | undefined,
): T | undefined => {
  if (incoming === undefined) return fallback;
  if (incoming === null) return undefined;
  return incoming;
};

export async function getAgentOrThrow(params: {
  db: Database;
  workspaceId: string;
  agentId: string;
}): Promise<NonNullable<AgentRecord>> {
  const agentPk = `agents/${params.workspaceId}/${params.agentId}`;
  const agent = await params.db.agent.get(agentPk, "agent");
  if (!agent) {
    throw resourceGone("Agent not found");
  }
  return agent as NonNullable<AgentRecord>;
}

export async function validateNotificationChannelId(params: {
  db: Database;
  workspaceId: string;
  notificationChannelId: string | null | undefined;
}): Promise<void> {
  const { notificationChannelId } = params;
  if (notificationChannelId === undefined || notificationChannelId === null) {
    return;
  }

  const channelPk = `output-channels/${params.workspaceId}/${notificationChannelId}`;
  const channel = await params.db["output_channel"].get(channelPk, "channel");
  if (!channel) {
    throw resourceGone("Notification channel not found");
  }
  if (channel.workspaceId !== params.workspaceId) {
    throw forbidden("Notification channel does not belong to this workspace");
  }
}

export function validateSpendingLimits(
  spendingLimits: UpdateAgentBody["spendingLimits"],
): void {
  if (spendingLimits === undefined) return;
  if (!Array.isArray(spendingLimits)) {
    throw badRequest("spendingLimits must be an array");
  }
  for (const limit of spendingLimits) {
    if (
      !limit.timeFrame ||
      !["daily", "weekly", "monthly"].includes(limit.timeFrame)
    ) {
      throw badRequest(
        "Each spending limit must have a valid timeFrame (daily, weekly, or monthly)",
      );
    }
    if (typeof limit.amount !== "number" || limit.amount < 0) {
      throw badRequest("Each spending limit must have a non-negative amount");
    }
  }
}

const buildDelegationMap = async (params: {
  db: Database;
  workspaceId: string;
  agentId: string;
  delegatableAgentIds: string[];
}): Promise<Map<string, { delegatableAgentIds?: string[] }>> => {
  const allAgentsQuery = await params.db.agent.query({
    IndexName: "byWorkspaceId",
    KeyConditionExpression: "workspaceId = :workspaceId",
    ExpressionAttributeValues: {
      ":workspaceId": params.workspaceId,
    },
  });

  const agentMap = new Map<string, { delegatableAgentIds?: string[] }>();
  for (const agent of allAgentsQuery.items) {
    agentMap.set(agent.pk.replace(`agents/${params.workspaceId}/`, ""), {
      delegatableAgentIds: agent.delegatableAgentIds,
    });
  }
  agentMap.set(params.agentId, {
    delegatableAgentIds: params.delegatableAgentIds,
  });

  return agentMap;
};

const hasDelegationCycle = (
  agentMap: Map<string, { delegatableAgentIds?: string[] }>,
  startId: string,
  currentId: string,
  visited: Set<string>,
): boolean => {
  if (visited.has(currentId)) return false;
  visited.add(currentId);
  const entry = agentMap.get(currentId);
  if (!entry || !entry.delegatableAgentIds) return false;
  for (const nextId of entry.delegatableAgentIds) {
    if (nextId === startId) {
      return true;
    }
    if (hasDelegationCycle(agentMap, startId, nextId, visited)) {
      return true;
    }
  }
  return false;
};

export async function validateDelegatableAgentIds(params: {
  db: Database;
  workspaceId: string;
  agentId: string;
  delegatableAgentIds: string[] | undefined;
}): Promise<void> {
  const { delegatableAgentIds } = params;
  if (delegatableAgentIds === undefined) {
    return;
  }
  if (!Array.isArray(delegatableAgentIds)) {
    throw badRequest("delegatableAgentIds must be an array");
  }
  for (const id of delegatableAgentIds) {
    if (typeof id !== "string") {
      throw badRequest("All delegatableAgentIds must be strings");
    }
    if (id === params.agentId) {
      throw badRequest("Agent cannot delegate to itself");
    }
    const targetAgentPk = `agents/${params.workspaceId}/${id}`;
    const targetAgent = await params.db.agent.get(targetAgentPk, "agent");
    if (!targetAgent) {
      throw resourceGone(`Delegatable agent ${id} not found`);
    }
    if (targetAgent.workspaceId !== params.workspaceId) {
      throw forbidden(
        `Delegatable agent ${id} does not belong to this workspace`,
      );
    }
  }

  const agentMap = await buildDelegationMap({
    db: params.db,
    workspaceId: params.workspaceId,
    agentId: params.agentId,
    delegatableAgentIds,
  });

  for (const id of delegatableAgentIds) {
    if (
      hasDelegationCycle(
        agentMap,
        params.agentId,
        id,
        new Set([params.agentId]),
      )
    ) {
      throw badRequest(
        "Circular delegation detected: this update would create a cycle in the delegation graph",
      );
    }
  }
}

export async function cleanEnabledMcpServerIds(params: {
  db: Database;
  workspaceId: string;
  enabledMcpServerIds: string[] | undefined;
  existingEnabledMcpServerIds: string[] | undefined;
}): Promise<string[] | undefined> {
  const { enabledMcpServerIds } = params;
  if (enabledMcpServerIds !== undefined) {
    if (!Array.isArray(enabledMcpServerIds)) {
      throw badRequest("enabledMcpServerIds must be an array");
    }

    const cleanedEnabledMcpServerIds: string[] = [];
    for (const id of enabledMcpServerIds) {
      if (typeof id !== "string") {
        throw badRequest("All enabledMcpServerIds must be strings");
      }
      const serverPk = `mcp-servers/${params.workspaceId}/${id}`;
      const server = await params.db["mcp-server"].get(serverPk, "server");
      if (!server) {
        throw resourceGone(`MCP server ${id} not found`);
      }
      if (server.workspaceId !== params.workspaceId) {
        throw forbidden(`MCP server ${id} does not belong to this workspace`);
      }
      cleanedEnabledMcpServerIds.push(id);
    }

    return cleanedEnabledMcpServerIds;
  }

  if (
    params.existingEnabledMcpServerIds &&
    params.existingEnabledMcpServerIds.length > 0
  ) {
    const cleanedEnabledMcpServerIds: string[] = [];
    for (const id of params.existingEnabledMcpServerIds) {
      const serverPk = `mcp-servers/${params.workspaceId}/${id}`;
      const server = await params.db["mcp-server"].get(serverPk, "server");
      if (server && server.workspaceId === params.workspaceId) {
        cleanedEnabledMcpServerIds.push(id);
      } else {
        console.warn(
          `MCP server ${id} not found or invalid, filtering out from enabledMcpServerIds`,
        );
      }
    }
    return cleanedEnabledMcpServerIds;
  }

  return undefined;
}

export async function cleanEnabledMcpServerToolNames(params: {
  db: Database;
  workspaceId: string;
  enabledMcpServerToolNames: Record<string, string[]> | undefined;
  existingEnabledMcpServerToolNames: Record<string, string[]> | undefined;
}): Promise<Record<string, string[]> | undefined> {
  const { enabledMcpServerToolNames } = params;
  if (enabledMcpServerToolNames !== undefined) {
    if (
      typeof enabledMcpServerToolNames !== "object" ||
      enabledMcpServerToolNames === null ||
      Array.isArray(enabledMcpServerToolNames)
    ) {
      throw badRequest("enabledMcpServerToolNames must be an object");
    }

    const cleanedToolNamesByServer: Record<string, string[]> = {};
    for (const [serverId, toolNames] of Object.entries(
      enabledMcpServerToolNames,
    )) {
      if (!Array.isArray(toolNames)) {
        throw badRequest(
          "enabledMcpServerToolNames values must be arrays of strings",
        );
      }
      for (const toolName of toolNames) {
        if (typeof toolName !== "string") {
          throw badRequest(
            "All enabledMcpServerToolNames values must be arrays of strings",
          );
        }
      }

      const serverPk = `mcp-servers/${params.workspaceId}/${serverId}`;
      const server = await params.db["mcp-server"].get(serverPk, "server");
      if (!server) {
        throw resourceGone(`MCP server ${serverId} not found`);
      }
      if (server.workspaceId !== params.workspaceId) {
        throw forbidden(
          `MCP server ${serverId} does not belong to this workspace`,
        );
      }

      const config = server.config as { accessToken?: string };
      const oauthConnected =
        server.authType === "oauth" && !!config.accessToken;
      const toolList = buildMcpServerToolList({
        serverName: server.name,
        serviceType: server.serviceType,
        authType: server.authType,
        oauthConnected,
      });
      const validToolNames = new Set(
        toolList.flatMap((group) => group.tools.map((tool) => tool.name)),
      );
      const invalidToolNames = toolNames.filter(
        (toolName) => !validToolNames.has(toolName),
      );
      if (invalidToolNames.length > 0) {
        throw badRequest(
          `Invalid tool names for MCP server ${serverId}: ${invalidToolNames.join(
            ", ",
          )}`,
        );
      }

      cleanedToolNamesByServer[serverId] = Array.from(
        new Set(toolNames.filter((toolName) => validToolNames.has(toolName))),
      );
    }

    return cleanedToolNamesByServer;
  }

  if (
    params.existingEnabledMcpServerToolNames &&
    Object.keys(params.existingEnabledMcpServerToolNames).length > 0
  ) {
    const cleanedToolNamesByServer: Record<string, string[]> = {};
    for (const [serverId, toolNames] of Object.entries(
      params.existingEnabledMcpServerToolNames,
    )) {
      const serverPk = `mcp-servers/${params.workspaceId}/${serverId}`;
      const server = await params.db["mcp-server"].get(serverPk, "server");
      if (!server || server.workspaceId !== params.workspaceId) {
        console.warn(
          `MCP server ${serverId} not found or invalid, filtering out from enabledMcpServerToolNames`,
        );
        continue;
      }

      const config = server.config as { accessToken?: string };
      const oauthConnected =
        server.authType === "oauth" && !!config.accessToken;
      const toolList = buildMcpServerToolList({
        serverName: server.name,
        serviceType: server.serviceType,
        authType: server.authType,
        oauthConnected,
      });
      const validToolNames = new Set(
        toolList.flatMap((group) => group.tools.map((tool) => tool.name)),
      );
      const filteredToolNames = toolNames.filter((toolName) =>
        validToolNames.has(toolName),
      );
      if (filteredToolNames.length !== toolNames.length) {
        console.warn(
          `Invalid tool names found for MCP server ${serverId}, filtering out invalid entries`,
        );
      }
      cleanedToolNamesByServer[serverId] = Array.from(
        new Set(filteredToolNames),
      );
    }
    return cleanedToolNamesByServer;
  }

  return undefined;
}

export function validateClientTools(
  clientTools: UpdateAgentBody["clientTools"],
): void {
  if (clientTools === undefined) {
    return;
  }
  if (!Array.isArray(clientTools)) {
    throw badRequest("clientTools must be an array");
  }
  for (const tool of clientTools) {
    if (
      !tool ||
      typeof tool !== "object" ||
      typeof tool.name !== "string" ||
      typeof tool.description !== "string" ||
      !tool.parameters ||
      typeof tool.parameters !== "object"
    ) {
      throw badRequest(
        "Each client tool must have name, description (both strings) and parameters (object)",
      );
    }
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(tool.name)) {
      throw badRequest(
        `Tool name "${tool.name}" must be a valid JavaScript identifier (letters, numbers, underscore, $; no spaces or special characters)`,
      );
    }
  }
}

export function validateKnowledgeConfig(params: {
  knowledgeInjectionMinSimilarity: UpdateAgentBody["knowledgeInjectionMinSimilarity"];
}): void {
  const { knowledgeInjectionMinSimilarity } = params;
  if (
    knowledgeInjectionMinSimilarity !== undefined &&
    knowledgeInjectionMinSimilarity !== null
  ) {
    if (
      typeof knowledgeInjectionMinSimilarity !== "number" ||
      knowledgeInjectionMinSimilarity < 0 ||
      knowledgeInjectionMinSimilarity > 1
    ) {
      throw badRequest(
        "knowledgeInjectionMinSimilarity must be a number between 0 and 1",
      );
    }
  }
}

export function resolveKnowledgeInjectionSources(params: {
  body: UpdateAgentBody;
  agent: NonNullable<AgentRecord>;
}): {
  enableKnowledgeInjection: boolean;
  enableKnowledgeInjectionFromDocuments: boolean;
  enableKnowledgeInjectionFromMemories: boolean;
} {
  const enableKnowledgeInjection =
    params.body.enableKnowledgeInjection !== undefined
      ? params.body.enableKnowledgeInjection
      : params.agent.enableKnowledgeInjection ?? false;

  const enableKnowledgeInjectionFromDocuments =
    params.body.enableKnowledgeInjectionFromDocuments !== undefined
      ? params.body.enableKnowledgeInjectionFromDocuments
      : params.agent.enableKnowledgeInjectionFromDocuments ?? true;

  const enableKnowledgeInjectionFromMemories =
    params.body.enableKnowledgeInjectionFromMemories !== undefined
      ? params.body.enableKnowledgeInjectionFromMemories
      : params.agent.enableKnowledgeInjectionFromMemories ?? false;

  return {
    enableKnowledgeInjection,
    enableKnowledgeInjectionFromDocuments,
    enableKnowledgeInjectionFromMemories,
  };
}

export function validateKnowledgeInjectionSources(params: {
  enableKnowledgeInjection: boolean;
  enableKnowledgeInjectionFromDocuments: boolean;
  enableKnowledgeInjectionFromMemories: boolean;
}): void {
  if (!params.enableKnowledgeInjection) {
    return;
  }
  if (
    !params.enableKnowledgeInjectionFromDocuments &&
    !params.enableKnowledgeInjectionFromMemories
  ) {
    throw badRequest(
      "At least one knowledge injection source must be enabled (documents or memories)",
    );
  }
}

export function validateModelTuning(params: {
  temperature: UpdateAgentBody["temperature"];
  topP: UpdateAgentBody["topP"];
  topK: UpdateAgentBody["topK"];
  maxOutputTokens: UpdateAgentBody["maxOutputTokens"];
  stopSequences: UpdateAgentBody["stopSequences"];
  maxToolRoundtrips: UpdateAgentBody["maxToolRoundtrips"];
}): void {
  const {
    temperature,
    topP,
    topK,
    maxOutputTokens,
    stopSequences,
    maxToolRoundtrips,
  } = params;

  if (temperature !== undefined && temperature !== null) {
    if (typeof temperature !== "number" || temperature < 0 || temperature > 2) {
      throw badRequest("temperature must be a number between 0 and 2");
    }
  }

  if (topP !== undefined && topP !== null) {
    if (typeof topP !== "number" || topP < 0 || topP > 1) {
      throw badRequest("topP must be a number between 0 and 1");
    }
  }

  if (topK !== undefined && topK !== null) {
    if (typeof topK !== "number" || !Number.isInteger(topK) || topK <= 0) {
      throw badRequest("topK must be a positive integer");
    }
  }

  if (maxOutputTokens !== undefined && maxOutputTokens !== null) {
    if (
      typeof maxOutputTokens !== "number" ||
      !Number.isInteger(maxOutputTokens) ||
      maxOutputTokens <= 0
    ) {
      throw badRequest("maxOutputTokens must be a positive integer");
    }
  }

  if (stopSequences !== undefined && stopSequences !== null) {
    if (!Array.isArray(stopSequences)) {
      throw badRequest("stopSequences must be an array");
    }
    for (const seq of stopSequences) {
      if (typeof seq !== "string") {
        throw badRequest("All stopSequences must be strings");
      }
    }
  }

  if (maxToolRoundtrips !== undefined && maxToolRoundtrips !== null) {
    if (
      typeof maxToolRoundtrips !== "number" ||
      !Number.isInteger(maxToolRoundtrips) ||
      maxToolRoundtrips <= 0
    ) {
      throw badRequest("maxToolRoundtrips must be a positive integer");
    }
  }
}

export async function validateModelName(params: {
  modelName: UpdateAgentBody["modelName"];
  getModelPricing?: (provider: string, model: string) => unknown | null;
}): Promise<string | undefined> {
  const { modelName } = params;
  if (modelName === undefined || modelName === null) {
    return undefined;
  }
  if (typeof modelName !== "string" || modelName.trim().length === 0) {
    throw badRequest("modelName must be a non-empty string or null");
  }
  const resolver =
    params.getModelPricing ??
    (await import("../../../utils/pricing")).getModelPricing;
  const trimmed = modelName.trim();
  const pricing = resolver("openrouter", trimmed);
  if (!pricing) {
    throw badRequest(
      `Model "${trimmed}" is not available. Please check available models at /api/models`,
    );
  }
  return trimmed;
}

export async function validateMemoryExtractionModel(params: {
  memoryExtractionModel: UpdateAgentBody["memoryExtractionModel"];
  getModelPricing?: (provider: string, model: string) => unknown | null;
}): Promise<string | undefined> {
  const { memoryExtractionModel } = params;
  if (memoryExtractionModel === undefined || memoryExtractionModel === null) {
    return undefined;
  }
  if (
    typeof memoryExtractionModel !== "string" ||
    memoryExtractionModel.trim().length === 0
  ) {
    throw badRequest(
      "memoryExtractionModel must be a non-empty string or null",
    );
  }
  const resolver =
    params.getModelPricing ??
    (await import("../../../utils/pricing")).getModelPricing;
  const trimmed = memoryExtractionModel.trim();
  const pricing = resolver("openrouter", trimmed);
  if (!pricing) {
    throw badRequest(
      `Model "${trimmed}" is not available. Please check available models at /api/models`,
    );
  }
  return trimmed;
}

export async function validateKnowledgeInjectionEntityExtractorModel(params: {
  knowledgeInjectionEntityExtractorModel: UpdateAgentBody["knowledgeInjectionEntityExtractorModel"];
  getModelPricing?: (provider: string, model: string) => unknown | null;
}): Promise<string | undefined> {
  const { knowledgeInjectionEntityExtractorModel } = params;
  if (
    knowledgeInjectionEntityExtractorModel === undefined ||
    knowledgeInjectionEntityExtractorModel === null
  ) {
    return undefined;
  }
  if (
    typeof knowledgeInjectionEntityExtractorModel !== "string" ||
    knowledgeInjectionEntityExtractorModel.trim().length === 0
  ) {
    throw badRequest(
      "knowledgeInjectionEntityExtractorModel must be a non-empty string or null",
    );
  }
  const resolver =
    params.getModelPricing ??
    (await import("../../../utils/pricing")).getModelPricing;
  const trimmed = knowledgeInjectionEntityExtractorModel.trim();
  const pricing = resolver("openrouter", trimmed);
  if (!pricing) {
    throw badRequest(
      `Model "${trimmed}" is not available. Please check available models at /api/models`,
    );
  }
  return trimmed;
}

export function validateImageGenerationConfig(params: {
  enableImageGeneration: UpdateAgentBody["enableImageGeneration"];
  imageGenerationModel: UpdateAgentBody["imageGenerationModel"];
  isImageCapableModel?: (provider: string, model: string) => boolean;
}): void {
  const isImageCapable = params.isImageCapableModel ?? isImageCapableModel;
  const resolvedModel =
    typeof params.imageGenerationModel === "string"
      ? params.imageGenerationModel.trim()
      : params.imageGenerationModel === null
        ? null
        : undefined;

  if (params.enableImageGeneration === true && !resolvedModel) {
    throw badRequest(
      "imageGenerationModel is required when enableImageGeneration is true",
    );
  }

  if (resolvedModel) {
    if (!isImageCapable("openrouter", resolvedModel)) {
      throw badRequest(
        `Image generation model "${resolvedModel}" is not image-capable. Please select a model that supports image output.`,
      );
    }
  }
}

export function validateAvatar(params: {
  avatar: UpdateAgentBody["avatar"];
  isValidAvatar: (avatar: string) => boolean;
}): void {
  const { avatar } = params;
  if (avatar !== undefined && avatar !== null) {
    if (typeof avatar !== "string") {
      throw badRequest("avatar must be a string or null");
    }
    if (!params.isValidAvatar(avatar)) {
      throw badRequest(
        "Invalid avatar path. Avatar must be one of the available logo paths.",
      );
    }
  }
}

export function resolveSearchWebProvider(params: {
  searchWebProvider: UpdateAgentBody["searchWebProvider"];
  enableTavilySearch: UpdateAgentBody["enableTavilySearch"];
  currentProvider: "tavily" | "jina" | undefined;
}): "tavily" | "jina" | undefined {
  if (params.searchWebProvider !== undefined) {
    if (
      params.searchWebProvider !== null &&
      !isSearchWebProvider(params.searchWebProvider)
    ) {
      throw badRequest("searchWebProvider must be 'tavily', 'jina', or null");
    }
    return params.searchWebProvider === null
      ? undefined
      : params.searchWebProvider;
  }
  if (params.enableTavilySearch !== undefined) {
    return params.enableTavilySearch === true ? "tavily" : undefined;
  }
  return params.currentProvider;
}

export function resolveFetchWebProvider(params: {
  fetchWebProvider: UpdateAgentBody["fetchWebProvider"];
  enableTavilyFetch: UpdateAgentBody["enableTavilyFetch"];
  currentProvider: "tavily" | "jina" | "scrape" | undefined;
}): "tavily" | "jina" | "scrape" | undefined {
  if (params.fetchWebProvider !== undefined) {
    if (
      params.fetchWebProvider !== null &&
      !isFetchWebProvider(params.fetchWebProvider)
    ) {
      throw badRequest(
        "fetchWebProvider must be 'tavily', 'jina', 'scrape', or null",
      );
    }
    return params.fetchWebProvider === null
      ? undefined
      : params.fetchWebProvider;
  }
  if (params.enableTavilyFetch !== undefined) {
    return params.enableTavilyFetch === true ? "tavily" : undefined;
  }
  return params.currentProvider;
}

export function buildAgentUpdateParams(params: {
  body: UpdateAgentBody;
  agent: NonNullable<AgentRecord>;
  agentPk: string;
  workspaceId: string;
  normalizedSummarizationPrompts: UpdateAgentBody["summarizationPrompts"];
  cleanedEnabledMcpServerIds: string[] | undefined;
  cleanedEnabledMcpServerToolNames: Record<string, string[]> | undefined;
  resolvedSearchWebProvider: "tavily" | "jina" | undefined;
  resolvedFetchWebProvider: "tavily" | "jina" | "scrape" | undefined;
  resolvedModelName: string | undefined;
  resolvedMemoryExtractionModel: string | undefined;
  resolvedKnowledgeInjectionEntityExtractorModel: string | undefined;
  updatedBy: string;
}): Record<string, unknown> {
  const { body, agent } = params;

  return {
    pk: params.agentPk,
    sk: "agent",
    workspaceId: params.workspaceId,
    name: body.name !== undefined ? body.name : agent.name,
    systemPrompt:
      body.systemPrompt !== undefined ? body.systemPrompt : agent.systemPrompt,
    notificationChannelId: resolveOptionalField(
      body.notificationChannelId,
      agent.notificationChannelId,
    ),
    delegatableAgentIds:
      body.delegatableAgentIds !== undefined
        ? body.delegatableAgentIds
        : agent.delegatableAgentIds,
    enabledMcpServerIds:
      params.cleanedEnabledMcpServerIds !== undefined
        ? params.cleanedEnabledMcpServerIds
        : (agent.enabledMcpServerIds ?? []),
    enabledMcpServerToolNames:
      params.cleanedEnabledMcpServerToolNames !== undefined
        ? params.cleanedEnabledMcpServerToolNames
        : agent.enabledMcpServerToolNames,
    enableMemorySearch:
      body.enableMemorySearch !== undefined
        ? body.enableMemorySearch
        : agent.enableMemorySearch,
    enableSearchDocuments:
      body.enableSearchDocuments !== undefined
        ? body.enableSearchDocuments
        : agent.enableSearchDocuments,
    enableKnowledgeInjection:
      body.enableKnowledgeInjection !== undefined
        ? body.enableKnowledgeInjection
        : agent.enableKnowledgeInjection,
    enableKnowledgeInjectionFromMemories:
      body.enableKnowledgeInjectionFromMemories !== undefined
        ? body.enableKnowledgeInjectionFromMemories
        : agent.enableKnowledgeInjectionFromMemories,
    enableKnowledgeInjectionFromDocuments:
      body.enableKnowledgeInjectionFromDocuments !== undefined
        ? body.enableKnowledgeInjectionFromDocuments
        : agent.enableKnowledgeInjectionFromDocuments,
    knowledgeInjectionSnippetCount:
      body.knowledgeInjectionSnippetCount !== undefined
        ? body.knowledgeInjectionSnippetCount
        : agent.knowledgeInjectionSnippetCount,
    knowledgeInjectionMinSimilarity: resolveOptionalField(
      body.knowledgeInjectionMinSimilarity,
      agent.knowledgeInjectionMinSimilarity,
    ),
    knowledgeInjectionEntityExtractorModel:
      body.knowledgeInjectionEntityExtractorModel !== undefined
        ? body.knowledgeInjectionEntityExtractorModel === null
          ? undefined
          : params.resolvedKnowledgeInjectionEntityExtractorModel
        : agent.knowledgeInjectionEntityExtractorModel,
    enableKnowledgeReranking:
      body.enableKnowledgeReranking !== undefined
        ? body.enableKnowledgeReranking
        : agent.enableKnowledgeReranking,
    knowledgeRerankingModel: resolveOptionalField(
      body.knowledgeRerankingModel,
      agent.knowledgeRerankingModel,
    ),
    enableSendEmail:
      body.enableSendEmail !== undefined
        ? body.enableSendEmail
        : agent.enableSendEmail,
    enableTavilySearch:
      body.enableTavilySearch !== undefined
        ? body.enableTavilySearch
        : agent.enableTavilySearch,
    searchWebProvider: params.resolvedSearchWebProvider,
    fetchWebProvider: params.resolvedFetchWebProvider,
    enableExaSearch:
      body.enableExaSearch !== undefined
        ? body.enableExaSearch
        : agent.enableExaSearch,
    enableImageGeneration:
      body.enableImageGeneration !== undefined
        ? body.enableImageGeneration
        : agent.enableImageGeneration,
    imageGenerationModel: resolveOptionalField(
      body.imageGenerationModel,
      agent.imageGenerationModel,
    ),
    clientTools:
      body.clientTools !== undefined ? body.clientTools : agent.clientTools,
    summarizationPrompts:
      body.summarizationPrompts !== undefined
        ? params.normalizedSummarizationPrompts
        : agent.summarizationPrompts,
    memoryExtractionEnabled:
      body.memoryExtractionEnabled !== undefined
        ? body.memoryExtractionEnabled
        : agent.memoryExtractionEnabled,
    memoryExtractionModel:
      body.memoryExtractionModel !== undefined
        ? body.memoryExtractionModel === null
          ? undefined
          : params.resolvedMemoryExtractionModel
        : agent.memoryExtractionModel,
    memoryExtractionPrompt: resolveOptionalField(
      body.memoryExtractionPrompt,
      agent.memoryExtractionPrompt,
    ),
    widgetConfig: resolveOptionalField(body.widgetConfig, agent.widgetConfig),
    spendingLimits:
      body.spendingLimits !== undefined
        ? body.spendingLimits
        : agent.spendingLimits,
    temperature: resolveOptionalField(body.temperature, agent.temperature),
    topP: resolveOptionalField(body.topP, agent.topP),
    topK: resolveOptionalField(body.topK, agent.topK),
    maxOutputTokens: resolveOptionalField(
      body.maxOutputTokens,
      agent.maxOutputTokens,
    ),
    stopSequences: resolveOptionalField(
      body.stopSequences,
      agent.stopSequences,
    ),
    maxToolRoundtrips: resolveOptionalField(
      body.maxToolRoundtrips,
      agent.maxToolRoundtrips,
    ),
    provider: "openrouter",
    modelName:
      body.modelName !== undefined
        ? body.modelName === null
          ? undefined
          : params.resolvedModelName
        : agent.modelName,
    avatar: resolveOptionalField(body.avatar, agent.avatar),
    updatedBy: params.updatedBy,
    updatedAt: new Date().toISOString(),
  };
}

export function buildAgentResponse(params: {
  agentId: string;
  updated: NonNullable<AgentRecord>;
}): Record<string, unknown> {
  const { updated } = params;

  return {
    id: params.agentId,
    name: updated.name,
    systemPrompt: updated.systemPrompt,
    summarizationPrompts: updated.summarizationPrompts,
    memoryExtractionEnabled: updated.memoryExtractionEnabled ?? false,
    memoryExtractionModel: updated.memoryExtractionModel ?? null,
    memoryExtractionPrompt: updated.memoryExtractionPrompt ?? null,
    notificationChannelId: updated.notificationChannelId,
    delegatableAgentIds: updated.delegatableAgentIds ?? [],
    enabledMcpServerIds: updated.enabledMcpServerIds ?? [],
    enabledMcpServerToolNames: updated.enabledMcpServerToolNames ?? undefined,
    enableMemorySearch: updated.enableMemorySearch ?? false,
    enableSearchDocuments: updated.enableSearchDocuments ?? false,
    enableKnowledgeInjection: updated.enableKnowledgeInjection ?? false,
    enableKnowledgeInjectionFromMemories:
      updated.enableKnowledgeInjectionFromMemories ?? false,
    enableKnowledgeInjectionFromDocuments:
      updated.enableKnowledgeInjectionFromDocuments ?? true,
    knowledgeInjectionSnippetCount:
      updated.knowledgeInjectionSnippetCount ?? undefined,
    knowledgeInjectionMinSimilarity:
      updated.knowledgeInjectionMinSimilarity ?? undefined,
    knowledgeInjectionEntityExtractorModel:
      updated.knowledgeInjectionEntityExtractorModel ?? undefined,
    enableKnowledgeReranking: updated.enableKnowledgeReranking ?? false,
    knowledgeRerankingModel: updated.knowledgeRerankingModel ?? undefined,
    enableSendEmail: updated.enableSendEmail ?? false,
    enableTavilySearch: updated.enableTavilySearch ?? false,
    searchWebProvider: updated.searchWebProvider ?? null,
    fetchWebProvider: updated.fetchWebProvider ?? null,
    enableExaSearch: updated.enableExaSearch ?? false,
    enableImageGeneration: updated.enableImageGeneration ?? false,
    imageGenerationModel: updated.imageGenerationModel ?? null,
    clientTools: updated.clientTools ?? [],
    spendingLimits: updated.spendingLimits ?? [],
    temperature: updated.temperature ?? null,
    topP: updated.topP ?? null,
    topK: updated.topK ?? null,
    maxOutputTokens: updated.maxOutputTokens ?? null,
    stopSequences: updated.stopSequences ?? null,
    maxToolRoundtrips: updated.maxToolRoundtrips ?? null,
    provider: updated.provider,
    modelName: updated.modelName ?? null,
    avatar: updated.avatar ?? null,
    widgetConfig: updated.widgetConfig ?? undefined,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
}
