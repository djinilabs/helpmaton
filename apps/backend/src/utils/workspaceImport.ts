import { randomUUID } from "crypto";

import { badRequest } from "@hapi/boom";

import type { WorkspaceExport } from "../schemas/workspace-export";
import { workspaceExportSchema } from "../schemas/workspace-export";
import { database } from "../tables";
import { ensureAuthorization } from "../tables/permissions";
import { PERMISSION_LEVELS } from "../tables/schema";

import { createStreamServerConfig } from "./streamServerUtils";
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
  userRef: string
): Promise<string> {
  // Validate export data against schema
  const validatedData = workspaceExportSchema.parse(exportData);

  const db = await database();
  const userId = userRef.replace("users/", "");

  // Get or create user subscription
  const subscription = await getUserSubscription(userId);
  const subscriptionId = subscription.pk.replace("subscriptions/", "");

  // Create reference mapping for resolving references to actual IDs
  const referenceMap = new Map<string, string>();

  // Helper to resolve an ID (either use existing reference or generate new UUID)
  const resolveId = (id: string): string => {
    if (isReference(id)) {
      const ref = extractReferenceName(id);
      if (!referenceMap.has(ref)) {
        const newId = randomUUID();
        referenceMap.set(ref, newId);
        return newId;
      }
      return referenceMap.get(ref)!;
    }
    // If it's an actual ID, generate a new one for import (we don't reuse IDs from exports)
    return randomUUID();
  };

  // Count entities for subscription limit validation
  // IMPORTANT: All counting and limit validation must happen BEFORE any database writes
  const agentCount = validatedData.agents?.length ?? 0;
  const channelCount = validatedData.outputChannels?.length ?? 0;
  const mcpServerCount = validatedData.mcpServers?.length ?? 0;
  const agentKeyCount =
    validatedData.agents?.reduce(
      (sum, agent) => sum + (agent.keys?.length ?? 0),
      0
    ) ?? 0;

  // Validate ALL subscription limits BEFORE creating any entities
  // This ensures we fail fast if limits would be exceeded, without creating partial data
  await checkSubscriptionLimits(subscriptionId, "workspace", 1);
  if (agentCount > 0) {
    await checkSubscriptionLimits(subscriptionId, "agent", agentCount);
  }
  if (channelCount > 0) {
    await checkSubscriptionLimits(subscriptionId, "channel", channelCount);
  }
  if (mcpServerCount > 0) {
    await checkSubscriptionLimits(
      subscriptionId,
      "mcpServer",
      mcpServerCount
    );
  }
  if (agentKeyCount > 0) {
    await checkSubscriptionLimits(
      subscriptionId,
      "agentKey",
      agentKeyCount
    );
  }
  // Note: Bot integrations don't have subscription limits currently

  // All limit checks complete - now safe to create entities
  // Step 1: Create workspace
  const workspaceId = resolveId(validatedData.id);
  // Map workspace ID to reference map if it was a reference
  if (isReference(validatedData.id)) {
    const refName = extractReferenceName(validatedData.id);
    referenceMap.set(refName, workspaceId);
  }
  const workspacePk = `workspaces/${workspaceId}`;
  const workspaceSk = "workspace";

  await db.workspace.create({
    pk: workspacePk,
    sk: workspaceSk,
    name: validatedData.name,
    description: validatedData.description,
    createdBy: userRef,
    subscriptionId,
    currency: validatedData.currency ?? "usd",
    creditBalance: 0, // Always start with 0 credits
    spendingLimits: validatedData.spendingLimits,
  });

  // Grant creator OWNER permission
  await ensureAuthorization(
    workspacePk,
    userRef,
    PERMISSION_LEVELS.OWNER,
    userRef
  );

  // Step 2: Create output channels (before agents, as agents may reference them)
  const channelIdMap = new Map<string, string>();
  if (validatedData.outputChannels) {
    for (const channel of validatedData.outputChannels) {
      const newChannelId = resolveId(channel.id);
      channelIdMap.set(channel.id, newChannelId);
      // Also map reference name if it's a reference
      if (isReference(channel.id)) {
        const refName = extractReferenceName(channel.id);
        referenceMap.set(refName, newChannelId);
      }
      const channelPk = `output-channels/${workspaceId}/${newChannelId}`;
      await db["output_channel"].create({
        pk: channelPk,
        sk: "channel",
        workspaceId,
        channelId: newChannelId,
        type: channel.type,
        name: channel.name,
        config: channel.config,
        createdBy: userRef,
      });
    }
  }

  // Step 3: Create email connections (before agents, as agents may reference them)
  const emailConnectionIdMap = new Map<string, string>();
  if (validatedData.emailConnections) {
    for (const connection of validatedData.emailConnections) {
      const newConnectionId = resolveId(connection.id);
      emailConnectionIdMap.set(connection.id, newConnectionId);
      // Also map reference name if it's a reference
      if (isReference(connection.id)) {
        const refName = extractReferenceName(connection.id);
        referenceMap.set(refName, newConnectionId);
      }
      const pk = `email-connections/${workspaceId}`;
      const sk = "connection";
      // Email connections use a fixed PK, so we can only have one
      // Check if it already exists (shouldn't for new workspace, but be safe)
      const existing = await db["email-connection"].get(pk, sk);
      if (!existing) {
        await db["email-connection"].create({
          pk,
          sk,
          workspaceId,
          type: connection.type,
          name: connection.name,
          config: connection.config,
          createdBy: userRef,
        });
      }
    }
  }

  // Step 4: Create MCP servers (before agents, as agents may reference them)
  const mcpServerIdMap = new Map<string, string>();
  if (validatedData.mcpServers) {
    for (const server of validatedData.mcpServers) {
      const newServerId = resolveId(server.id);
      mcpServerIdMap.set(server.id, newServerId);
      // Also map reference name if it's a reference
      if (isReference(server.id)) {
        const refName = extractReferenceName(server.id);
        referenceMap.set(refName, newServerId);
      }
      const pk = `mcp-servers/${workspaceId}/${newServerId}`;
      await db["mcp-server"].create({
        pk,
        sk: "server",
        workspaceId,
        name: server.name,
        url: server.url,
        authType: server.authType,
        serviceType: server.serviceType ?? "external",
        config: server.config,
        createdBy: userRef,
      });
    }
  }

  // Step 5: Create agents (with nested entities)
  // First, build agentIdMap for all agents to support forward references in delegatableAgentIds
  const agentIdMap = new Map<string, string>();
  if (validatedData.agents) {
    for (const agentData of validatedData.agents) {
      const newAgentId = resolveId(agentData.id);
      agentIdMap.set(agentData.id, newAgentId);
      // Also map reference name if it's a reference
      if (isReference(agentData.id)) {
        const refName = extractReferenceName(agentData.id);
        referenceMap.set(refName, newAgentId);
      }
    }
  }

  // Now create agents with resolved references
  if (validatedData.agents) {
    for (const agentData of validatedData.agents) {
      const newAgentId = agentIdMap.get(agentData.id)!;
      const agentPk = `agents/${workspaceId}/${newAgentId}`;

      // Resolve notification channel ID if provided
      let notificationChannelId: string | undefined = undefined;
      if (agentData.notificationChannelId) {
        const channelRef = agentData.notificationChannelId;
        if (isReference(channelRef)) {
          const refName = extractReferenceName(channelRef);
          notificationChannelId = referenceMap.get(refName);
          if (!notificationChannelId) {
            // Fallback: check channelIdMap
            notificationChannelId = channelIdMap.get(channelRef);
          }
          if (!notificationChannelId) {
            throw badRequest(
              `Notification channel reference "${channelRef}" not found in outputChannels`
            );
          }
        } else {
          // Look up in channelIdMap
          notificationChannelId = channelIdMap.get(channelRef);
          if (!notificationChannelId) {
            throw badRequest(
              `Notification channel "${channelRef}" not found in outputChannels`
            );
          }
        }
      }

      // Resolve delegatable agent IDs (now all agents are in agentIdMap)
      const delegatableAgentIds: string[] | undefined =
        agentData.delegatableAgentIds?.map((id) => {
          if (isReference(id)) {
            const refName = extractReferenceName(id);
            const resolvedId = referenceMap.get(refName);
            if (resolvedId) {
              return resolvedId;
            }
            // Fallback: check agentIdMap
            const fallbackId = agentIdMap.get(id);
            if (fallbackId) {
              return fallbackId;
            }
            throw badRequest(
              `Delegatable agent reference "${id}" not found in agents`
            );
          }
          const resolvedId = agentIdMap.get(id);
          if (!resolvedId) {
            throw badRequest(`Delegatable agent "${id}" not found in agents`);
          }
          return resolvedId;
        });

      // Resolve enabled MCP server IDs
      const enabledMcpServerIds: string[] | undefined =
        agentData.enabledMcpServerIds?.map((id) => {
          if (isReference(id)) {
            const refName = extractReferenceName(id);
            const resolvedId = referenceMap.get(refName);
            if (resolvedId) {
              return resolvedId;
            }
            // Fallback: check mcpServerIdMap
            const fallbackId = mcpServerIdMap.get(id);
            if (fallbackId) {
              return fallbackId;
            }
            throw badRequest(
              `MCP server reference "${id}" not found in mcpServers`
            );
          }
          const resolvedId = mcpServerIdMap.get(id);
          if (!resolvedId) {
            throw badRequest(`MCP server "${id}" not found in mcpServers`);
          }
          return resolvedId;
        });

      // Create agent
      await db.agent.create({
        pk: agentPk,
        sk: "agent",
        workspaceId,
        name: agentData.name,
        systemPrompt: agentData.systemPrompt,
        provider: agentData.provider ?? "openrouter",
        modelName: agentData.modelName,
        notificationChannelId,
        delegatableAgentIds,
        enabledMcpServerIds,
        enableMemorySearch: agentData.enableMemorySearch ?? false,
        enableSearchDocuments: agentData.enableSearchDocuments ?? false,
        enableKnowledgeInjection: agentData.enableKnowledgeInjection ?? false,
        knowledgeInjectionSnippetCount:
          agentData.knowledgeInjectionSnippetCount,
        knowledgeInjectionMinSimilarity:
          agentData.knowledgeInjectionMinSimilarity,
        enableKnowledgeReranking: agentData.enableKnowledgeReranking ?? false,
        knowledgeRerankingModel: agentData.knowledgeRerankingModel,
        enableSendEmail: agentData.enableSendEmail ?? false,
        enableTavilySearch: agentData.enableTavilySearch ?? false,
        searchWebProvider: agentData.searchWebProvider,
        enableTavilyFetch: agentData.enableTavilyFetch ?? false,
        fetchWebProvider: agentData.fetchWebProvider,
        enableExaSearch: agentData.enableExaSearch ?? false,
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
        createdBy: userRef,
      });

      // Create agent keys (agent variable not needed after creation)
      if (agentData.keys) {
        for (const keyData of agentData.keys) {
          const newKeyId = randomUUID();
          const keyValue = randomUUID();
          const agentKeyPk = `agent-keys/${workspaceId}/${newAgentId}/${newKeyId}`;
          await db["agent-key"].create({
            pk: agentKeyPk,
            sk: "key",
            workspaceId,
            agentId: newAgentId,
            key: keyValue,
            name: keyData.name,
            provider: keyData.provider ?? "google",
            type: keyData.type ?? "webhook",
            createdBy: userRef,
          });
        }
      }

      // Create eval judges
      if (agentData.evalJudges) {
        for (const judgeData of agentData.evalJudges) {
          const newJudgeId = randomUUID();
          const judgePk = `agent-eval-judges/${workspaceId}/${newAgentId}/${newJudgeId}`;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (db as any)["agent-eval-judge"].create({
            pk: judgePk,
            sk: "judge",
            workspaceId,
            agentId: newAgentId,
            judgeId: newJudgeId,
            name: judgeData.name,
            enabled: judgeData.enabled ?? true,
            provider: judgeData.provider ?? "openrouter",
            modelName: judgeData.modelName,
            evalPrompt: judgeData.evalPrompt,
            version: 1,
            createdAt: new Date().toISOString(),
          });
        }
      }

      // Create stream server if configured
      if (agentData.streamServer) {
        await createStreamServerConfig(
          workspaceId,
          newAgentId,
          agentData.streamServer.allowedOrigins
        );
      }
    }
  }

  // Step 6: Create bot integrations (they reference agents)
  if (validatedData.botIntegrations) {
    for (const integrationData of validatedData.botIntegrations) {
      const newIntegrationId = randomUUID();

      // Resolve agent ID
      let resolvedAgentId: string;
      if (isReference(integrationData.agentId)) {
        const refName = extractReferenceName(integrationData.agentId);
        const resolvedId = referenceMap.get(refName);
        if (resolvedId) {
          resolvedAgentId = resolvedId;
        } else {
          // Fallback: check agentIdMap
          const fallbackId = agentIdMap.get(integrationData.agentId);
          if (fallbackId) {
            resolvedAgentId = fallbackId;
          } else {
            throw badRequest(
              `Agent reference "${integrationData.agentId}" not found in agents`
            );
          }
        }
      } else {
        const resolvedId = agentIdMap.get(integrationData.agentId);
        if (!resolvedId) {
          throw badRequest(
            `Agent "${integrationData.agentId}" not found in agents`
          );
        }
        resolvedAgentId = resolvedId;
      }

      // Construct webhook URL
      const webhookBaseFromEnv = process.env.WEBHOOK_BASE_URL?.trim();
      const baseUrlFromEnv = process.env.BASE_URL?.trim();
      let baseUrl: string;

      if (webhookBaseFromEnv && webhookBaseFromEnv.length > 0) {
        baseUrl = webhookBaseFromEnv.replace(/\/+$/, "");
      } else if (baseUrlFromEnv && baseUrlFromEnv.length > 0) {
        baseUrl = baseUrlFromEnv.replace(/\/+$/, "");
      } else if (process.env.ARC_ENV === "production") {
        baseUrl = "https://api.helpmaton.com";
      } else if (process.env.ARC_ENV === "staging") {
        baseUrl = "https://staging-api.helpmaton.com";
      } else {
        throw new Error(
          "WEBHOOK_BASE_URL or BASE_URL environment variable must be set for non-production/non-staging environments"
        );
      }
      const webhookUrl = `${baseUrl}/api/webhooks/${integrationData.platform}/${workspaceId}/${newIntegrationId}`;

      // Create integration
      const integrationPk = `bot-integrations/${workspaceId}/${newIntegrationId}`;
      await db["bot-integration"].create({
        pk: integrationPk,
        sk: "integration",
        workspaceId,
        agentId: resolvedAgentId,
        platform: integrationData.platform,
        name: integrationData.name,
        config: integrationData.config,
        webhookUrl,
        status: integrationData.status ?? "active",
        createdBy: userRef,
      });
    }
  }

  return workspaceId;
}
