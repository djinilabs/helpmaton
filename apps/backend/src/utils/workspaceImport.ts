import { randomUUID } from "crypto";

import { badRequest } from "@hapi/boom";

import { generatePromptForAgent } from "../http/utils/promptGeneration";
import type { WorkspaceExport } from "../schemas/workspace-export";
import { workspaceExportSchema } from "../schemas/workspace-export";
import { database } from "../tables";
import { ensureAuthorization } from "../tables/permissions";
import { PERMISSION_LEVELS } from "../tables/schema";

import {
  checkPromptGenerationLimit,
  incrementPromptGenerationBucketSafe,
} from "./requestTracking";
import { createStreamServerConfig } from "./streamServerUtils";
import { getPlanLimits } from "./subscriptionPlans";
import {
  checkSubscriptionLimits,
  getUserSubscription,
} from "./subscriptionUtils";

/**
 * Helper function to check if a string is a reference (e.g., "{refName}")
 */
function isReference(id: string): boolean {
  return id.startsWith("{") && id.endsWith("}");
}

/**
 * Extract reference name from a reference string (e.g., "{refName}" -> "refName")
 */
function extractReferenceName(ref: string): string {
  return ref.slice(1, -1);
}

/**
 * Pre-generate all reference mappings by scanning all entities in the export data.
 * This ensures all refNames are mapped to UUIDs before any entity creation,
 * allowing consistent reference resolution throughout the import process.
 *
 * @param validatedData - The validated workspace export data
 * @returns A map of reference names to generated UUIDs
 */
function preGenerateReferenceMap(
  validatedData: WorkspaceExport,
): Map<string, string> {
  const referenceMap = new Map<string, string>();

  // Map workspace ID if it's a reference
  if (isReference(validatedData.id)) {
    const refName = extractReferenceName(validatedData.id);
    referenceMap.set(refName, randomUUID());
  }

  // Map output channel IDs
  if (validatedData.outputChannels) {
    for (const channel of validatedData.outputChannels) {
      if (isReference(channel.id)) {
        const refName = extractReferenceName(channel.id);
        if (!referenceMap.has(refName)) {
          referenceMap.set(refName, randomUUID());
        }
      }
    }
  }

  // Map email connection IDs
  if (validatedData.emailConnections) {
    for (const connection of validatedData.emailConnections) {
      if (isReference(connection.id)) {
        const refName = extractReferenceName(connection.id);
        if (!referenceMap.has(refName)) {
          referenceMap.set(refName, randomUUID());
        }
      }
    }
  }

  // Map MCP server IDs
  if (validatedData.mcpServers) {
    for (const server of validatedData.mcpServers) {
      if (isReference(server.id)) {
        const refName = extractReferenceName(server.id);
        if (!referenceMap.has(refName)) {
          referenceMap.set(refName, randomUUID());
        }
      }
    }
  }

  // Map agent IDs and their nested entities (keys, evalJudges)
  if (validatedData.agents) {
    for (const agent of validatedData.agents) {
      // Map agent ID
      if (isReference(agent.id)) {
        const refName = extractReferenceName(agent.id);
        if (!referenceMap.has(refName)) {
          referenceMap.set(refName, randomUUID());
        }
      }

      // Map agent key IDs
      if (agent.keys) {
        for (const key of agent.keys) {
          if (isReference(key.id)) {
            const refName = extractReferenceName(key.id);
            if (!referenceMap.has(refName)) {
              referenceMap.set(refName, randomUUID());
            }
          }
        }
      }

      // Map eval judge IDs
      if (agent.evalJudges) {
        for (const judge of agent.evalJudges) {
          if (isReference(judge.id)) {
            const refName = extractReferenceName(judge.id);
            if (!referenceMap.has(refName)) {
              referenceMap.set(refName, randomUUID());
            }
          }
        }
      }
    }
  }

  // Map bot integration IDs
  if (validatedData.botIntegrations) {
    for (const integration of validatedData.botIntegrations) {
      if (isReference(integration.id)) {
        const refName = extractReferenceName(integration.id);
        if (!referenceMap.has(refName)) {
          referenceMap.set(refName, randomUUID());
        }
      }
    }
  }

  return referenceMap;
}

type ImportContext = {
  db: Awaited<ReturnType<typeof database>>;
  userRef: string;
  userId: string;
  subscriptionId: string;
  subscriptionPlan: string;
  limits: ReturnType<typeof getPlanLimits>;
  referenceMap: Map<string, string>;
  resolveId: (id: string) => string;
};

type ImportCounts = {
  agentCount: number;
  channelCount: number;
  mcpServerCount: number;
  agentKeyCount: number;
  perAgentEvalJudgeCounts: number[];
};

async function prepareImportContext(
  exportData: WorkspaceExport,
  userRef: string,
): Promise<{
  validatedData: WorkspaceExport;
  context: ImportContext;
}> {
  const validatedData = workspaceExportSchema.parse(exportData);
  const db = await database();
  const userId = userRef.replace("users/", "");

  const subscription = await getUserSubscription(userId);
  const subscriptionId = subscription.pk.replace("subscriptions/", "");
  const subscriptionPlan = subscription.plan;
  const limits = getPlanLimits(subscription.plan);
  if (!limits) {
    throw badRequest(`Invalid subscription plan: ${subscription.plan}`);
  }

  const referenceMap = preGenerateReferenceMap(validatedData);
  const resolveId = (id: string): string => {
    if (isReference(id)) {
      const ref = extractReferenceName(id);
      const resolvedId = referenceMap.get(ref);
      if (!resolvedId) {
        throw badRequest(
          `Reference "${id}" not found. All references must be defined in the export data.`,
        );
      }
      return resolvedId;
    }
    return randomUUID();
  };

  return {
    validatedData,
    context: {
      db,
      userRef,
      userId,
      subscriptionId,
      subscriptionPlan,
      limits,
      referenceMap,
      resolveId,
    },
  };
}

function countImportEntities(validatedData: WorkspaceExport): ImportCounts {
  const agentCount = validatedData.agents?.length ?? 0;
  const channelCount = validatedData.outputChannels?.length ?? 0;
  const mcpServerCount = validatedData.mcpServers?.length ?? 0;
  const agentKeyCount =
    validatedData.agents?.reduce(
      (sum, agent) => sum + (agent.keys?.length ?? 0),
      0,
    ) ?? 0;
  const perAgentEvalJudgeCounts =
    validatedData.agents?.map((agent) => agent.evalJudges?.length ?? 0) ?? [];

  return {
    agentCount,
    channelCount,
    mcpServerCount,
    agentKeyCount,
    perAgentEvalJudgeCounts,
  };
}

async function validateImportLimits(
  subscriptionId: string,
  limits: ReturnType<typeof getPlanLimits>,
  counts: ImportCounts,
  subscriptionPlan: string,
): Promise<void> {
  await checkSubscriptionLimits(subscriptionId, "workspace", 1);
  if (counts.agentCount > 0) {
    await checkSubscriptionLimits(subscriptionId, "agent", counts.agentCount);
  }
  if (counts.channelCount > 0) {
    await checkSubscriptionLimits(
      subscriptionId,
      "channel",
      counts.channelCount,
    );
  }
  if (counts.mcpServerCount > 0) {
    await checkSubscriptionLimits(
      subscriptionId,
      "mcpServer",
      counts.mcpServerCount,
    );
  }
  if (counts.agentKeyCount > 0) {
    await checkSubscriptionLimits(
      subscriptionId,
      "agentKey",
      counts.agentKeyCount,
    );
  }
  if (counts.perAgentEvalJudgeCounts.length > 0) {
    const maxEvalJudges = Math.max(...counts.perAgentEvalJudgeCounts);
    if (limits && maxEvalJudges > limits.maxEvalJudgesPerAgent) {
      throw badRequest(
        `Eval judge limit exceeded. Maximum ${limits.maxEvalJudgesPerAgent} eval judge(s) allowed per agent for ${subscriptionPlan} plan.`,
      );
    }
  }
}

async function createWorkspaceAndOwner(
  ctx: ImportContext,
  validatedData: WorkspaceExport,
  workspaceId: string,
  creationNotes?: string,
): Promise<void> {
  const workspacePk = `workspaces/${workspaceId}`;
  const workspaceSk = "workspace";

  const createPayload = {
    pk: workspacePk,
    sk: workspaceSk,
    name: validatedData.name,
    description: validatedData.description,
    createdBy: ctx.userRef,
    subscriptionId: ctx.subscriptionId,
    currency: validatedData.currency ?? "usd",
    creditBalance: 0,
    spendingLimits: validatedData.spendingLimits,
  };
  if (creationNotes !== undefined && creationNotes !== "") {
    (createPayload as Record<string, unknown>).creationNotes = creationNotes;
  }
  await ctx.db.workspace.create(createPayload);

  await ensureAuthorization(
    workspacePk,
    ctx.userRef,
    PERMISSION_LEVELS.OWNER,
    ctx.userRef,
  );
}

async function createOutputChannels(
  ctx: ImportContext,
  validatedData: WorkspaceExport,
  workspaceId: string,
): Promise<Map<string, string>> {
  const channelIdMap = new Map<string, string>();
  if (!validatedData.outputChannels) {
    return channelIdMap;
  }
  for (const channel of validatedData.outputChannels) {
    const newChannelId = ctx.resolveId(channel.id);
    channelIdMap.set(channel.id, newChannelId);
    const channelPk = `output-channels/${workspaceId}/${newChannelId}`;
    await ctx.db["output_channel"].create({
      pk: channelPk,
      sk: "channel",
      workspaceId,
      channelId: newChannelId,
      type: channel.type,
      name: channel.name,
      config: channel.config,
      createdBy: ctx.userRef,
    });
  }
  return channelIdMap;
}

async function createEmailConnections(
  ctx: ImportContext,
  validatedData: WorkspaceExport,
  workspaceId: string,
): Promise<Map<string, string>> {
  const emailConnectionIdMap = new Map<string, string>();
  if (!validatedData.emailConnections) {
    return emailConnectionIdMap;
  }
  for (const connection of validatedData.emailConnections) {
    const newConnectionId = ctx.resolveId(connection.id);
    emailConnectionIdMap.set(connection.id, newConnectionId);
    const pk = `email-connections/${workspaceId}`;
    const sk = "connection";
    const existing = await ctx.db["email-connection"].get(pk, sk);
    if (!existing) {
      await ctx.db["email-connection"].create({
        pk,
        sk,
        workspaceId,
        type: connection.type,
        name: connection.name,
        config: connection.config,
        createdBy: ctx.userRef,
      });
    }
  }
  return emailConnectionIdMap;
}

async function createMcpServers(
  ctx: ImportContext,
  validatedData: WorkspaceExport,
  workspaceId: string,
): Promise<Map<string, string>> {
  const mcpServerIdMap = new Map<string, string>();
  if (!validatedData.mcpServers) {
    return mcpServerIdMap;
  }
  for (const server of validatedData.mcpServers) {
    const newServerId = ctx.resolveId(server.id);
    mcpServerIdMap.set(server.id, newServerId);
    const pk = `mcp-servers/${workspaceId}/${newServerId}`;
    await ctx.db["mcp-server"].create({
      pk,
      sk: "server",
      workspaceId,
      name: server.name,
      url: server.url,
      authType: server.authType,
      serviceType: server.serviceType ?? "external",
      config: server.config,
      createdBy: ctx.userRef,
    });
  }
  return mcpServerIdMap;
}

function buildAgentIdMap(
  ctx: ImportContext,
  validatedData: WorkspaceExport,
): Map<string, string> {
  const agentIdMap = new Map<string, string>();
  if (!validatedData.agents) {
    return agentIdMap;
  }
  for (const agentData of validatedData.agents) {
    const newAgentId = ctx.resolveId(agentData.id);
    agentIdMap.set(agentData.id, newAgentId);
  }
  return agentIdMap;
}

function resolveNotificationChannelId(
  channelRef: string,
  referenceMap: Map<string, string>,
  channelIdMap: Map<string, string>,
): string {
  if (isReference(channelRef)) {
    const refName = extractReferenceName(channelRef);
    const notificationChannelId = referenceMap.get(refName);
    if (!notificationChannelId) {
      throw badRequest(
        `Notification channel reference "${channelRef}" not found in outputChannels`,
      );
    }
    return notificationChannelId;
  }
  const notificationChannelId = channelIdMap.get(channelRef);
  if (!notificationChannelId) {
    throw badRequest(
      `Notification channel "${channelRef}" not found in outputChannels`,
    );
  }
  return notificationChannelId;
}

function resolveDelegatableAgentIds(
  agentIds: string[],
  referenceMap: Map<string, string>,
  agentIdMap: Map<string, string>,
): string[] {
  return agentIds.map((id) => {
    if (isReference(id)) {
      const refName = extractReferenceName(id);
      const resolvedId = referenceMap.get(refName);
      if (!resolvedId) {
        throw badRequest(
          `Delegatable agent reference "${id}" not found in agents`,
        );
      }
      return resolvedId;
    }
    const resolvedId = agentIdMap.get(id);
    if (!resolvedId) {
      throw badRequest(`Delegatable agent "${id}" not found in agents`);
    }
    return resolvedId;
  });
}

function resolveMcpServerIds(
  serverIds: string[],
  referenceMap: Map<string, string>,
  mcpServerIdMap: Map<string, string>,
): string[] {
  return serverIds.map((id) => {
    if (isReference(id)) {
      const refName = extractReferenceName(id);
      const resolvedId = referenceMap.get(refName);
      if (!resolvedId) {
        throw badRequest(
          `MCP server reference "${id}" not found in mcpServers`,
        );
      }
      return resolvedId;
    }
    const resolvedId = mcpServerIdMap.get(id);
    if (!resolvedId) {
      throw badRequest(`MCP server "${id}" not found in mcpServers`);
    }
    return resolvedId;
  });
}

function resolveMcpServerToolNames(
  toolNamesByServer: Record<string, string[]> | undefined,
  referenceMap: Map<string, string>,
  mcpServerIdMap: Map<string, string>,
): Record<string, string[]> | undefined {
  if (!toolNamesByServer) {
    return undefined;
  }
  const resolvedToolNamesByServer: Record<string, string[]> = {};
  for (const [serverId, toolNames] of Object.entries(toolNamesByServer)) {
    const [resolvedServerId] = resolveMcpServerIds(
      [serverId],
      referenceMap,
      mcpServerIdMap,
    );
    resolvedToolNamesByServer[resolvedServerId] = toolNames;
  }
  return resolvedToolNamesByServer;
}

async function createAgentsAndNestedEntities(
  ctx: ImportContext,
  validatedData: WorkspaceExport,
  workspaceId: string,
  channelIdMap: Map<string, string>,
  mcpServerIdMap: Map<string, string>,
  agentIdMap: Map<string, string>,
): Promise<void> {
  if (!validatedData.agents) {
    return;
  }

  for (const agentData of validatedData.agents) {
    const newAgentId = agentIdMap.get(agentData.id)!;
    const agentPk = `agents/${workspaceId}/${newAgentId}`;

    let notificationChannelId: string | undefined;
    if (agentData.notificationChannelId) {
      notificationChannelId = resolveNotificationChannelId(
        agentData.notificationChannelId,
        ctx.referenceMap,
        channelIdMap,
      );
    }

    const delegatableAgentIds: string[] | undefined = agentData
      .delegatableAgentIds?.length
      ? resolveDelegatableAgentIds(
          agentData.delegatableAgentIds,
          ctx.referenceMap,
          agentIdMap,
        )
      : undefined;

    const enabledMcpServerIds: string[] | undefined = agentData
      .enabledMcpServerIds?.length
      ? resolveMcpServerIds(
          agentData.enabledMcpServerIds,
          ctx.referenceMap,
          mcpServerIdMap,
        )
      : undefined;
    const enabledMcpServerToolNames = resolveMcpServerToolNames(
      agentData.enabledMcpServerToolNames,
      ctx.referenceMap,
      mcpServerIdMap,
    );

    await ctx.db.agent.create({
      pk: agentPk,
      sk: "agent",
      workspaceId,
      name: agentData.name,
      systemPrompt: agentData.systemPrompt,
      summarizationPrompts: agentData.summarizationPrompts,
      memoryExtractionEnabled: agentData.memoryExtractionEnabled ?? false,
      memoryExtractionModel: agentData.memoryExtractionModel,
      memoryExtractionPrompt: agentData.memoryExtractionPrompt,
      provider: agentData.provider ?? "openrouter",
      modelName: agentData.modelName,
      notificationChannelId,
      delegatableAgentIds,
      enabledMcpServerIds,
      enabledMcpServerToolNames,
      enabledSkillIds: agentData.enabledSkillIds,
      enableMemorySearch: agentData.enableMemorySearch ?? false,
      enableSearchDocuments: agentData.enableSearchDocuments ?? false,
      enableKnowledgeInjection: agentData.enableKnowledgeInjection ?? false,
      enableKnowledgeInjectionFromMemories:
        agentData.enableKnowledgeInjectionFromMemories ?? false,
      enableKnowledgeInjectionFromDocuments:
        agentData.enableKnowledgeInjectionFromDocuments ?? true,
      knowledgeInjectionSnippetCount: agentData.knowledgeInjectionSnippetCount,
      knowledgeInjectionMinSimilarity:
        agentData.knowledgeInjectionMinSimilarity,
      knowledgeInjectionEntityExtractorModel:
        agentData.knowledgeInjectionEntityExtractorModel,
      enableKnowledgeReranking: agentData.enableKnowledgeReranking ?? false,
      knowledgeRerankingModel: agentData.knowledgeRerankingModel,
      enableSendEmail: agentData.enableSendEmail ?? false,
      enableTavilySearch: agentData.enableTavilySearch ?? false,
      searchWebProvider: agentData.searchWebProvider,
      enableTavilyFetch: agentData.enableTavilyFetch ?? false,
      fetchWebProvider: agentData.fetchWebProvider,
      enableExaSearch: agentData.enableExaSearch ?? false,
      enableImageGeneration: agentData.enableImageGeneration ?? false,
      imageGenerationModel: agentData.imageGenerationModel,
      spendingLimits: agentData.spendingLimits,
      temperature: agentData.temperature,
      topP: agentData.topP,
      topK: agentData.topK,
      maxOutputTokens: agentData.maxOutputTokens,
      stopSequences: agentData.stopSequences,
      maxToolRoundtrips: agentData.maxToolRoundtrips,
      clientTools: agentData.clientTools,
      widgetConfig: agentData.widgetConfig,
      avatar: agentData.avatar,
      createdBy: ctx.userRef,
    });

    if (agentData.keys) {
      for (const keyData of agentData.keys) {
        const newKeyId = ctx.resolveId(keyData.id);
        const keyValue = randomUUID();
        const agentKeyPk = `agent-keys/${workspaceId}/${newAgentId}/${newKeyId}`;
        await ctx.db["agent-key"].create({
          pk: agentKeyPk,
          sk: "key",
          workspaceId,
          agentId: newAgentId,
          key: keyValue,
          name: keyData.name,
          provider: keyData.provider ?? "google",
          type: keyData.type ?? "webhook",
          createdBy: ctx.userRef,
        });
      }
    }

    if (agentData.evalJudges) {
      for (const judgeData of agentData.evalJudges) {
        const newJudgeId = ctx.resolveId(judgeData.id);
        const judgePk = `agent-eval-judges/${workspaceId}/${newAgentId}/${newJudgeId}`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (ctx.db as any)["agent-eval-judge"].create({
          pk: judgePk,
          sk: "judge",
          workspaceId,
          agentId: newAgentId,
          judgeId: newJudgeId,
          name: judgeData.name,
          enabled: judgeData.enabled ?? true,
          samplingProbability: judgeData.samplingProbability ?? 100,
          provider: judgeData.provider ?? "openrouter",
          modelName: judgeData.modelName,
          evalPrompt: judgeData.evalPrompt,
          version: 1,
          createdAt: new Date().toISOString(),
        });
      }
    }

    if (agentData.streamServer) {
      await createStreamServerConfig(
        workspaceId,
        newAgentId,
        agentData.streamServer.allowedOrigins,
      );
    }
  }
}

function resolveWebhookBaseUrl(): string {
  const webhookBaseFromEnv = process.env.WEBHOOK_BASE_URL?.trim();
  const baseUrlFromEnv = process.env.BASE_URL?.trim();

  if (webhookBaseFromEnv && webhookBaseFromEnv.length > 0) {
    return webhookBaseFromEnv.replace(/\/+$/, "");
  }
  if (baseUrlFromEnv && baseUrlFromEnv.length > 0) {
    return baseUrlFromEnv.replace(/\/+$/, "");
  }
  if (process.env.ARC_ENV === "production") {
    return "https://api.helpmaton.com";
  }
  if (process.env.ARC_ENV === "staging") {
    return "https://staging-api.helpmaton.com";
  }
  throw new Error(
    "WEBHOOK_BASE_URL or BASE_URL environment variable must be set for non-production/non-staging environments",
  );
}

function resolveIntegrationAgentId(
  agentId: string,
  referenceMap: Map<string, string>,
  agentIdMap: Map<string, string>,
): string {
  if (isReference(agentId)) {
    const refName = extractReferenceName(agentId);
    const resolvedId = referenceMap.get(refName);
    if (!resolvedId) {
      throw badRequest(`Agent reference "${agentId}" not found in agents`);
    }
    return resolvedId;
  }
  const resolvedId = agentIdMap.get(agentId);
  if (!resolvedId) {
    throw badRequest(`Agent "${agentId}" not found in agents`);
  }
  return resolvedId;
}

async function createBotIntegrations(
  ctx: ImportContext,
  validatedData: WorkspaceExport,
  workspaceId: string,
  agentIdMap: Map<string, string>,
): Promise<void> {
  if (!validatedData.botIntegrations) {
    return;
  }
  const baseUrl = resolveWebhookBaseUrl();
  for (const integrationData of validatedData.botIntegrations) {
    const newIntegrationId = ctx.resolveId(integrationData.id);
    const resolvedAgentId = resolveIntegrationAgentId(
      integrationData.agentId,
      ctx.referenceMap,
      agentIdMap,
    );
    const webhookUrl = `${baseUrl}/api/webhooks/${integrationData.platform}/${workspaceId}/${newIntegrationId}`;
    const integrationPk = `bot-integrations/${workspaceId}/${newIntegrationId}`;
    await ctx.db["bot-integration"].create({
      pk: integrationPk,
      sk: "integration",
      workspaceId,
      agentId: resolvedAgentId,
      platform: integrationData.platform,
      name: integrationData.name,
      config: integrationData.config,
      webhookUrl,
      status: integrationData.status ?? "active",
      createdBy: ctx.userRef,
    });
  }
}

/**
 * Import a complete workspace configuration
 *
 * Creates a new workspace from exported configuration data. Handles reference resolution,
 * entity creation in the correct order, and subscription limit validation.
 *
 * @param exportData - The workspace export data (validated against schema)
 * @param userRef - The user reference of the user importing the workspace
 * @returns The created workspace ID
 * @throws If validation fails, subscription limits are exceeded, or entity creation fails
 */
export async function importWorkspace(
  exportData: WorkspaceExport,
  userRef: string,
  creationNotes?: string,
): Promise<string> {
  const { validatedData, context } = await prepareImportContext(
    exportData,
    userRef,
  );

  const counts = countImportEntities(validatedData);
  await validateImportLimits(
    context.subscriptionId,
    context.limits,
    counts,
    context.subscriptionPlan,
  );

  const workspaceId = context.resolveId(validatedData.id);
  await createWorkspaceAndOwner(
    context,
    validatedData,
    workspaceId,
    creationNotes,
  );

  const channelIdMap = await createOutputChannels(
    context,
    validatedData,
    workspaceId,
  );
  await createEmailConnections(context, validatedData, workspaceId);
  const mcpServerIdMap = await createMcpServers(
    context,
    validatedData,
    workspaceId,
  );

  const agentIdMap = buildAgentIdMap(context, validatedData);
  await createAgentsAndNestedEntities(
    context,
    validatedData,
    workspaceId,
    channelIdMap,
    mcpServerIdMap,
    agentIdMap,
  );

  await createBotIntegrations(context, validatedData, workspaceId, agentIdMap);

  if (
    creationNotes?.trim() &&
    validatedData.agents &&
    validatedData.agents.length > 0
  ) {
    await enhanceAgentPromptsAfterImport(
      context.db,
      workspaceId,
      validatedData,
      agentIdMap,
      creationNotes.trim(),
      userRef,
    );
  }

  return workspaceId;
}

async function enhanceAgentPromptsAfterImport(
  db: Awaited<ReturnType<typeof database>>,
  workspaceId: string,
  validatedData: WorkspaceExport,
  agentIdMap: Map<string, string>,
  goal: string,
  userRef: string,
): Promise<void> {
  if (!validatedData.agents) return;

  // Only enhance the first agent to cap import latency and prompt-generation quota
  const agentsToEnhance = validatedData.agents.slice(0, 1);
  for (const agentData of agentsToEnhance) {
    const newAgentId = agentIdMap.get(agentData.id);
    if (!newAgentId) continue;

    try {
      await checkPromptGenerationLimit(workspaceId);
    } catch {
      console.warn(
        "[workspaceImport] Skipping prompt enhancement: prompt generation limit reached",
        { workspaceId, agentId: newAgentId },
      );
      continue;
    }

    try {
      const enhancedPrompt = await generatePromptForAgent({
        db,
        workspaceId,
        agentId: newAgentId,
        goal,
        userRef,
        referer: `${process.env.BASE_URL ?? "http://localhost:3000"}/api/workspaces/import`,
      });

      const agentPk = `agents/${workspaceId}/${newAgentId}`;
      await db.agent.update({
        pk: agentPk,
        sk: "agent",
        systemPrompt: enhancedPrompt,
      });

      await incrementPromptGenerationBucketSafe(workspaceId);
    } catch (err) {
      console.error(
        "[workspaceImport] Failed to enhance agent prompt after import",
        { workspaceId, agentId: newAgentId, error: err },
      );
    }
  }
}
