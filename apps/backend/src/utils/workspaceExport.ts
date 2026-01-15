import type { WorkspaceExport } from "../schemas/workspace-export";
import { workspaceExportSchema } from "../schemas/workspace-export";
import { database } from "../tables";

/**
 * Export a complete workspace configuration
 * 
 * Fetches all workspace-related entities and transforms them into the export schema format.
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

  // Build agents with nested entities
  const agents = await Promise.all(
    agentsResult.items.map(async (agent) => {
      const agentId = agent.pk.replace(`agents/${workspaceId}/`, "");

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

      return {
        id: agentId,
        name: agent.name,
        systemPrompt: agent.systemPrompt,
        notificationChannelId: agent.notificationChannelId,
        delegatableAgentIds: agent.delegatableAgentIds,
        enabledMcpServerIds: agent.enabledMcpServerIds,
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
            ? agentKeysResult.items.map((key) => ({
                id: key.pk.replace(
                  `agent-keys/${workspaceId}/${agentId}/`,
                  ""
                ),
                name: key.name,
                type: key.type,
                provider: key.provider,
              }))
            : undefined,
        evalJudges:
          evalJudgesResult.items.length > 0
            ? evalJudgesResult.items.map((judge: {
                judgeId: string;
                name: string;
                enabled: boolean;
                provider: "openrouter";
                modelName: string;
                evalPrompt: string;
              }) => ({
                id: judge.judgeId,
                name: judge.name,
                enabled: judge.enabled,
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
    id: workspaceId,
    name: workspace.name,
    description: workspace.description,
    currency: workspace.currency,
    // creditBalance is excluded from exports
    spendingLimits: workspace.spendingLimits,
    agents: agents.length > 0 ? agents : undefined,
    outputChannels:
      outputChannelsResult.items.length > 0
        ? outputChannelsResult.items.map((channel) => ({
            id: channel.channelId,
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
            );
            return {
              id: connectionId || "connection",
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
            return {
              id: serverId,
              name: server.name,
              url: server.url,
              authType: server.authType,
              serviceType: server.serviceType,
              config: server.config,
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
            return {
              id: integrationId,
              agentId: integration.agentId,
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
