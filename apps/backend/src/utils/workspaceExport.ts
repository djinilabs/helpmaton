import type { WorkspaceExport } from "../schemas/workspace-export";
import { workspaceExportSchema } from "../schemas/workspace-export";
import { database } from "../tables";

/**
 * Generate a refName from an entity name, handling duplicates by appending numbers.
 * 
 * @param name - The entity name
 * @param nameCounts - Map tracking how many times each name has been used
 * @returns A refName in the format "{name}" or "{name 2}", "{name 3}", etc. for duplicates
 */
function generateRefName(
  name: string,
  nameCounts: Map<string, number>
): string {
  const count = (nameCounts.get(name) ?? 0) + 1;
  nameCounts.set(name, count);
  
  if (count === 1) {
    return `{${name}}`;
  }
  return `{${name} ${count}}`;
}

/**
 * Filter out sensitive authentication credentials from MCP server config.
 * Removes fields like accessToken, refreshToken, password, headerValue, etc.
 * 
 * @param config - The MCP server config object
 * @returns A new config object with sensitive fields removed
 */
function filterMcpServerCredentials(
  config: Record<string, unknown>
): Record<string, unknown> {
  const sensitiveFields = [
    "accessToken",
    "refreshToken",
    "token",
    "password",
    "headerValue",
    "apiKey",
    "api_key",
    "secret",
    "clientSecret",
    "client_secret",
  ];

  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    // Skip sensitive credential fields
    if (!sensitiveFields.includes(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/**
 * Export a complete workspace configuration
 * 
 * Fetches all workspace-related entities and transforms them into the export schema format.
 * All IDs are replaced with refNames in the format "{name}", with duplicate names
 * disambiguated by appending numbers (e.g., "{name 2}", "{name 3}").
 * 
 * @param workspaceId - The workspace ID to export
 * @returns The workspace export data validated against the schema
 * @throws If workspace is not found or validation fails
 */
export async function exportWorkspace(
  workspaceId: string
): Promise<WorkspaceExport> {
  const db = await database();
  const workspacePk = `workspaces/${workspaceId}`;

  // Fetch workspace
  const workspace = await db.workspace.get(workspacePk, "workspace");
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  // Fetch all agents
  const agentsResult = await db.agent.query({
    IndexName: "byWorkspaceId",
    KeyConditionExpression: "workspaceId = :workspaceId",
    ExpressionAttributeValues: {
      ":workspaceId": workspaceId,
    },
  });

  // Fetch all output channels
  const outputChannelsResult = await db.output_channel.query({
    IndexName: "byWorkspaceId",
    KeyConditionExpression: "workspaceId = :workspaceId",
    ExpressionAttributeValues: {
      ":workspaceId": workspaceId,
    },
  });

  // Fetch all email connections
  const emailConnectionsResult = await db["email-connection"].query({
    IndexName: "byWorkspaceId",
    KeyConditionExpression: "workspaceId = :workspaceId",
    ExpressionAttributeValues: {
      ":workspaceId": workspaceId,
    },
  });

  // Fetch all MCP servers
  const mcpServersResult = await db["mcp-server"].query({
    IndexName: "byWorkspaceId",
    KeyConditionExpression: "workspaceId = :workspaceId",
    ExpressionAttributeValues: {
      ":workspaceId": workspaceId,
    },
  });

  // Fetch all bot integrations
  const botIntegrationsResult = await db["bot-integration"].query({
    IndexName: "byWorkspaceId",
    KeyConditionExpression: "workspaceId = :workspaceId",
    ExpressionAttributeValues: {
      ":workspaceId": workspaceId,
    },
  });

  // Build ID-to-refName mappings
  // Maps: entity ID -> refName (e.g., "agent-123" -> "{Test Agent}")
  const idToRefNameMap = new Map<string, string>();
  const nameCounts = new Map<string, number>();

  // Map workspace ID to refName
  const workspaceRefName = generateRefName(workspace.name, nameCounts);
  idToRefNameMap.set(workspaceId, workspaceRefName);

  // Map output channel IDs to refNames
  const channelIdToRefNameMap = new Map<string, string>();
  for (const channel of outputChannelsResult.items) {
    const channelId = channel.channelId;
    const refName = generateRefName(channel.name, nameCounts);
    idToRefNameMap.set(channelId, refName);
    channelIdToRefNameMap.set(channelId, refName);
  }

  // Map email connection IDs to refNames
  const emailConnectionIdToRefNameMap = new Map<string, string>();
  for (const connection of emailConnectionsResult.items) {
    const connectionId = connection.pk.replace(
      `email-connections/${workspaceId}`,
      ""
    ) || "connection";
    const refName = generateRefName(connection.name, nameCounts);
    idToRefNameMap.set(connectionId, refName);
    emailConnectionIdToRefNameMap.set(connectionId, refName);
  }

  // Map MCP server IDs to refNames
  const mcpServerIdToRefNameMap = new Map<string, string>();
  for (const server of mcpServersResult.items) {
    const serverId = server.pk.replace(
      `mcp-servers/${workspaceId}/`,
      ""
    );
    const refName = generateRefName(server.name, nameCounts);
    idToRefNameMap.set(serverId, refName);
    mcpServerIdToRefNameMap.set(serverId, refName);
  }

  // Map agent IDs to refNames (need to fetch nested entities first)
  const agentIdToRefNameMap = new Map<string, string>();
  const agentIdToAgentMap = new Map<string, typeof agentsResult.items[0]>();
  
  for (const agent of agentsResult.items) {
    const agentId = agent.pk.replace(`agents/${workspaceId}/`, "");
    agentIdToAgentMap.set(agentId, agent);
    const refName = generateRefName(agent.name, nameCounts);
    idToRefNameMap.set(agentId, refName);
    agentIdToRefNameMap.set(agentId, refName);
  }

  // Map bot integration IDs to refNames
  const botIntegrationIdToRefNameMap = new Map<string, string>();
  for (const integration of botIntegrationsResult.items) {
    const integrationId = integration.pk.replace(
      `bot-integrations/${workspaceId}/`,
      ""
    );
    const refName = generateRefName(integration.name, nameCounts);
    idToRefNameMap.set(integrationId, refName);
    botIntegrationIdToRefNameMap.set(integrationId, refName);
  }

  // Build agents with nested entities
  const agents = await Promise.all(
    agentsResult.items.map(async (agent) => {
      const agentId = agent.pk.replace(`agents/${workspaceId}/`, "");
      const agentRefName = agentIdToRefNameMap.get(agentId)!;

      // Fetch agent keys
      const agentKeysResult = await db["agent-key"].query({
        IndexName: "byAgentId",
        KeyConditionExpression: "agentId = :agentId",
        ExpressionAttributeValues: {
          ":agentId": agentId,
        },
      });

      // Fetch eval judges
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- agent-eval-judge not in DatabaseSchema type yet
      const evalJudgesResult = await (db as any)["agent-eval-judge"].query({
        IndexName: "byAgentId",
        KeyConditionExpression: "agentId = :agentId",
        ExpressionAttributeValues: {
          ":agentId": agentId,
        },
      });

      // Fetch stream server
      const streamServerPk = `stream-servers/${workspaceId}/${agentId}`;
      const streamServer = await db["agent-stream-servers"].get(
        streamServerPk,
        "config"
      );

      // Map agent keys to refNames
      const keyIdToRefNameMap = new Map<string, string>();
      for (const key of agentKeysResult.items) {
        const keyId = key.pk.replace(
          `agent-keys/${workspaceId}/${agentId}/`,
          ""
        );
        const keyName = key.name || `${agent.name} Key`;
        const refName = generateRefName(keyName, nameCounts);
        idToRefNameMap.set(keyId, refName);
        keyIdToRefNameMap.set(keyId, refName);
      }

      // Map eval judges to refNames
      const judgeIdToRefNameMap = new Map<string, string>();
      for (const judge of evalJudgesResult.items) {
        const judgeId = judge.judgeId;
        const judgeName = judge.name || `${agent.name} Judge`;
        const refName = generateRefName(judgeName, nameCounts);
        idToRefNameMap.set(judgeId, refName);
        judgeIdToRefNameMap.set(judgeId, refName);
      }

      // Resolve notificationChannelId to refName
      const notificationChannelRefName = agent.notificationChannelId
        ? (() => {
            // Extract channel ID from full path if needed
            const actualChannelId = agent.notificationChannelId.includes("/")
              ? agent.notificationChannelId.replace(`output-channels/${workspaceId}/`, "")
              : agent.notificationChannelId;
            return channelIdToRefNameMap.get(actualChannelId) || agent.notificationChannelId;
          })()
        : undefined;

      // Resolve delegatableAgentIds to refNames
      const delegatableAgentRefNames = agent.delegatableAgentIds
        ? agent.delegatableAgentIds.map((id) => {
            // Extract agent ID from full path if needed
            const actualAgentId = id.includes("/") 
              ? id.replace(`agents/${workspaceId}/`, "")
              : id;
            return agentIdToRefNameMap.get(actualAgentId) || id;
          })
        : undefined;

      // Resolve enabledMcpServerIds to refNames
      const enabledMcpServerRefNames = agent.enabledMcpServerIds
        ? agent.enabledMcpServerIds.map((id) => {
            // Extract server ID from full path if needed
            const actualServerId = id.includes("/")
              ? id.replace(`mcp-servers/${workspaceId}/`, "")
              : id;
            return mcpServerIdToRefNameMap.get(actualServerId) || id;
          })
        : undefined;

      return {
        id: agentRefName,
        name: agent.name,
        systemPrompt: agent.systemPrompt,
        notificationChannelId: notificationChannelRefName,
        delegatableAgentIds: delegatableAgentRefNames,
        enabledMcpServerIds: enabledMcpServerRefNames,
        enableMemorySearch: agent.enableMemorySearch,
        enableSearchDocuments: agent.enableSearchDocuments,
        enableKnowledgeInjection: agent.enableKnowledgeInjection,
        knowledgeInjectionSnippetCount: agent.knowledgeInjectionSnippetCount,
        knowledgeInjectionMinSimilarity: agent.knowledgeInjectionMinSimilarity,
        enableKnowledgeReranking: agent.enableKnowledgeReranking,
        knowledgeRerankingModel: agent.knowledgeRerankingModel,
        enableSendEmail: agent.enableSendEmail,
        enableTavilySearch: agent.enableTavilySearch,
        searchWebProvider: agent.searchWebProvider,
        enableTavilyFetch: agent.enableTavilyFetch,
        fetchWebProvider: agent.fetchWebProvider,
        enableExaSearch: agent.enableExaSearch,
        spendingLimits: agent.spendingLimits,
        temperature: agent.temperature,
        topP: agent.topP,
        topK: agent.topK,
        maxOutputTokens: agent.maxOutputTokens,
        stopSequences: agent.stopSequences,
        maxToolRoundtrips: agent.maxToolRoundtrips,
        provider: agent.provider,
        modelName: agent.modelName,
        clientTools: agent.clientTools,
        widgetConfig: agent.widgetConfig,
        avatar: agent.avatar,
        keys:
          agentKeysResult.items.length > 0
            ? agentKeysResult.items.map((key) => {
                const keyId = key.pk.replace(
                  `agent-keys/${workspaceId}/${agentId}/`,
                  ""
                );
                return {
                  id: keyIdToRefNameMap.get(keyId) || keyId,
                  name: key.name,
                  type: key.type,
                  provider: key.provider,
                };
              })
            : undefined,
        evalJudges:
          evalJudgesResult.items.length > 0
            ? evalJudgesResult.items.map((judge: {
                judgeId: string;
                name: string;
                enabled: boolean;
                samplingProbability?: number;
                provider: "openrouter";
                modelName: string;
                evalPrompt: string;
              }) => ({
                id: judgeIdToRefNameMap.get(judge.judgeId) || judge.judgeId,
                name: judge.name,
                enabled: judge.enabled,
                samplingProbability: judge.samplingProbability ?? 100,
                provider: judge.provider,
                modelName: judge.modelName,
                evalPrompt: judge.evalPrompt,
              }))
            : undefined,
        streamServer: streamServer
          ? {
              secret: streamServer.secret,
              allowedOrigins: streamServer.allowedOrigins,
            }
          : undefined,
      };
    })
  );

  // Build export object
  const exportData: WorkspaceExport = {
    id: workspaceRefName,
    name: workspace.name,
    description: workspace.description,
    currency: workspace.currency,
    // creditBalance is excluded from exports
    spendingLimits: workspace.spendingLimits,
    agents: agents.length > 0 ? agents : undefined,
    outputChannels:
      outputChannelsResult.items.length > 0
        ? outputChannelsResult.items.map((channel) => ({
            id: channelIdToRefNameMap.get(channel.channelId) || channel.channelId,
            channelId: channel.channelId,
            type: channel.type,
            name: channel.name,
            config: channel.config,
          }))
        : undefined,
    emailConnections:
      emailConnectionsResult.items.length > 0
        ? emailConnectionsResult.items.map((connection) => {
            const connectionId = connection.pk.replace(
              `email-connections/${workspaceId}`,
              ""
            ) || "connection";
            return {
              id: emailConnectionIdToRefNameMap.get(connectionId) || connectionId,
              type: connection.type,
              name: connection.name,
              config: connection.config,
            };
          })
        : undefined,
    mcpServers:
      mcpServersResult.items.length > 0
        ? mcpServersResult.items.map((server) => {
            const serverId = server.pk.replace(
              `mcp-servers/${workspaceId}/`,
              ""
            );
            // Filter out sensitive credentials from config
            // Always return an object, even if empty after filtering
            const filteredConfig = server.config
              ? filterMcpServerCredentials(
                  server.config as Record<string, unknown>
                )
              : {};
            return {
              id: mcpServerIdToRefNameMap.get(serverId) || serverId,
              name: server.name,
              url: server.url,
              authType: server.authType,
              serviceType: server.serviceType,
              config: filteredConfig,
            };
          })
        : undefined,
    botIntegrations:
      botIntegrationsResult.items.length > 0
        ? botIntegrationsResult.items.map((integration) => {
            const integrationId = integration.pk.replace(
              `bot-integrations/${workspaceId}/`,
              ""
            );
            // Resolve agentId to refName
            const agentId = integration.agentId.includes("/")
              ? integration.agentId.replace(`agents/${workspaceId}/`, "")
              : integration.agentId;
            const agentRefName = agentIdToRefNameMap.get(agentId) || integration.agentId;
            
            return {
              id: botIntegrationIdToRefNameMap.get(integrationId) || integrationId,
              agentId: agentRefName,
              platform: integration.platform,
              name: integration.name,
              config: integration.config,
              webhookUrl: integration.webhookUrl,
              status: integration.status,
              lastUsedAt: integration.lastUsedAt,
            };
          })
        : undefined,
  };

  // Validate against schema
  return workspaceExportSchema.parse(exportData);
}
