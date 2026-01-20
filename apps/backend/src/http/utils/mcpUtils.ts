import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import type { McpServerRecord } from "../../tables/schema";
import { trackBusinessEvent } from "../../utils/tracking";

/**
 * Get MCP server details
 */
export async function getMcpServer(
  workspaceId: string,
  serverId: string
): Promise<McpServerRecord | null> {
  const db = await database();
  const pk = `mcp-servers/${workspaceId}/${serverId}`;
  const server = await db["mcp-server"].get(pk, "server");
  return server || null;
}

/**
 * Build authentication headers for MCP server request
 */
function buildAuthHeaders(
  authType: "none" | "header" | "basic" | "oauth",
  config: Record<string, unknown>
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (authType === "header") {
    const headerValue = config.headerValue as string;
    if (!headerValue) {
      throw new Error(
        'Missing required "headerValue" for header authentication.'
      );
    }
    headers["Authorization"] = headerValue;
  } else if (authType === "basic") {
    const username = config.username as string;
    const password = config.password as string;
    if (!username || !password) {
      throw new Error(
        'Missing required "username" or "password" for basic authentication.'
      );
    }
    const credentials = Buffer.from(`${username}:${password}`).toString(
      "base64"
    );
    headers["Authorization"] = `Basic ${credentials}`;
  }
  // For "none", no additional headers needed

  return headers;
}

/**
 * Call MCP server using the MCP protocol
 * MCP uses JSON-RPC 2.0 format
 */
async function callMcpServer(
  server: McpServerRecord,
  method: string,
  params?: Record<string, unknown>
): Promise<unknown> {
  const url = server.url;
  if (!url) {
    throw new Error("MCP server URL is required for external servers");
  }
  // OAuth servers don't use this function - they have dedicated tools
  if (server.authType === "oauth") {
    throw new Error(
      "OAuth MCP servers should use dedicated tools, not generic MCP calls"
    );
  }
  const headers = buildAuthHeaders(server.authType, server.config);

  // MCP protocol uses JSON-RPC 2.0
  const requestBody = {
    jsonrpc: "2.0",
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    method,
    params: params || {},
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000), // 30 seconds timeout
    });

    if (!response.ok) {
      throw new Error(
        `MCP server request failed: ${response.status} ${response.statusText}`
      );
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      const bodyText = await response.text();
      throw new Error(
        `Expected JSON response from MCP server, but got Content-Type: ${contentType}. Response body: ${bodyText.slice(
          0,
          200
        )}`
      );
    }

    let result;
    try {
      result = await response.json();
    } catch (parseError) {
      const bodyText = await response.text();
      throw new Error(
        `Failed to parse JSON from MCP server response. Content-Type: ${contentType}. Error: ${
          parseError instanceof Error ? parseError.message : String(parseError)
        }. Response body: ${bodyText.slice(0, 200)}`
      );
    }

    // Handle JSON-RPC 2.0 response
    if (result.error) {
      throw new Error(
        `MCP server error: ${
          result.error.message || JSON.stringify(result.error)
        }`
      );
    }

    return result.result;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to call MCP server: ${String(error)}`);
  }
}

/**
 * Create a tool for calling an MCP server
 * This creates a generic tool that can call any MCP method
 */
export function createMcpServerTool(
  workspaceId: string,
  serverId: string,
  serverName: string
) {
  const toolParamsSchema = z.object({
    method: z.string().describe("The MCP method to call"),
    params: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Optional parameters for the MCP method"),
  });

  type ToolArgs = z.infer<typeof toolParamsSchema>;

  const description = `Call the MCP server "${serverName}". Provide the MCP method name and optional parameters.`;

  return tool({
    description,
    parameters: toolParamsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    execute: async (args: unknown) => {
      try {
        const typedArgs = args as ToolArgs;
        const server = await getMcpServer(workspaceId, serverId);

        if (!server) {
          return `Error: MCP server ${serverId} not found`;
        }

        if (server.workspaceId !== workspaceId) {
          return `Error: MCP server ${serverId} does not belong to this workspace`;
        }

        const result = await callMcpServer(
          server,
          typedArgs.method,
          typedArgs.params
        );

        // Track MCP server tool call
        trackBusinessEvent(
          "mcp_server",
          "tool_called",
          {
            workspace_id: workspaceId,
            server_id: serverId,
            method: typedArgs.method,
          },
          undefined // Tool execution doesn't have request context
        );

        // Format result as string for the agent
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error(`Error in MCP server tool for ${serverName}:`, error);
        return `Error calling MCP server: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Sanitize server name for use in tool names
 */
function sanitizeServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
}

type ValidServer = {
  server: McpServerRecord;
  serverId: string;
  hasOAuthConnection: boolean;
};

const OAUTH_SERVICE_TYPES = new Set([
  "google-drive",
  "gmail",
  "google-calendar",
  "notion",
  "github",
  "linear",
  "hubspot",
  "slack",
  "stripe",
  "salesforce",
  "intercom",
  "todoist",
  "zendesk",
]);

const GENERIC_SERVICE_GROUP = "__generic__";

const getServiceGroupKey = (server: McpServerRecord): string => {
  if (
    server.serviceType &&
    ((server.authType === "oauth" && OAUTH_SERVICE_TYPES.has(server.serviceType)) ||
      server.serviceType === "posthog")
  ) {
    return server.serviceType;
  }
  return GENERIC_SERVICE_GROUP;
};

const registerTool = (
  tools: Record<string, ReturnType<typeof createMcpServerTool>>,
  name: string,
  tool: ReturnType<typeof createMcpServerTool>
) => {
  tools[name] = tool;
};

const getToolSuffix = (server: McpServerRecord, hasConflict: boolean) => {
  if (!hasConflict) {
    return "";
  }
  return `_${sanitizeServerName(server.name)}`;
};

const logNotionServer = (params: {
  server: McpServerRecord;
  serverId: string;
  hasOAuthConnection: boolean;
  hasConflict: boolean;
  suffix: string;
}) => {
  if (
    params.server.serviceType === "notion" ||
    params.server.name.toLowerCase().includes("notion")
  ) {
    console.log(`[MCP Tools] Processing Notion server ${params.serverId}:`, {
      authType: params.server.authType,
      serviceType: params.server.serviceType,
      hasAccessToken: params.hasOAuthConnection,
      hasConflict: params.hasConflict,
      suffix: params.suffix,
    });
  }
};

const logNotionGenericFallback = (server: McpServerRecord, serverId: string) => {
  if (
    server.serviceType === "notion" ||
    server.name.toLowerCase().includes("notion")
  ) {
    console.warn(
      `[MCP Tools] Notion server ${serverId} falling through to generic tool. AuthType: ${server.authType}, ServiceType: ${server.serviceType}`
    );
  }
};

const collectValidServers = async (
  workspaceId: string,
  enabledMcpServerIds: string[]
): Promise<ValidServer[]> => {
  const validServers: ValidServer[] = [];
  for (const serverId of enabledMcpServerIds) {
    const server = await getMcpServer(workspaceId, serverId);
    if (!server) {
      console.warn(`MCP server ${serverId} not found, skipping`);
      continue;
    }

    if (server.workspaceId !== workspaceId) {
      console.warn(
        `MCP server ${serverId} does not belong to workspace ${workspaceId}, skipping`
      );
      continue;
    }

    const config = server.config as { accessToken?: string };
    const hasOAuthConnection = !!config.accessToken;

    if (server.authType === "oauth" && !hasOAuthConnection) {
      console.warn(
        `MCP server ${serverId} (${server.serviceType || "unknown"}) is not connected, skipping tools`
      );
      continue;
    }

    validServers.push({ server, serverId, hasOAuthConnection });
  }

  return validServers;
};

const buildServersByServiceType = (
  validServers: Array<{ server: McpServerRecord; serverId: string }>
) => {
  const serversByServiceType = new Map<
    string,
    Array<{ server: McpServerRecord; serverId: string }>
  >();

  for (const { server, serverId } of validServers) {
    const groupKey = getServiceGroupKey(server);
    if (!serversByServiceType.has(groupKey)) {
      serversByServiceType.set(groupKey, []);
    }
    serversByServiceType.get(groupKey)!.push({ server, serverId });
  }

  return serversByServiceType;
};

const addGoogleDriveTools = async (params: {
  tools: Record<string, ReturnType<typeof createMcpServerTool>>;
  workspaceId: string;
  serverId: string;
  suffix: string;
}) => {
  const {
    createGoogleDriveListTool,
    createGoogleDriveReadTool,
    createGoogleDriveSearchTool,
  } = await import("./googleDriveTools");

  registerTool(
    params.tools,
    `google_drive_list${params.suffix}`,
    createGoogleDriveListTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `google_drive_read${params.suffix}`,
    createGoogleDriveReadTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `google_drive_search${params.suffix}`,
    createGoogleDriveSearchTool(params.workspaceId, params.serverId)
  );
};

const addGmailTools = async (params: {
  tools: Record<string, ReturnType<typeof createMcpServerTool>>;
  workspaceId: string;
  serverId: string;
  suffix: string;
}) => {
  const {
    createGmailListTool,
    createGmailReadTool,
    createGmailSearchTool,
  } = await import("./gmailTools");

  registerTool(
    params.tools,
    `gmail_list${params.suffix}`,
    createGmailListTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `gmail_read${params.suffix}`,
    createGmailReadTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `gmail_search${params.suffix}`,
    createGmailSearchTool(params.workspaceId, params.serverId)
  );
};

const addGoogleCalendarTools = async (params: {
  tools: Record<string, ReturnType<typeof createMcpServerTool>>;
  workspaceId: string;
  serverId: string;
  suffix: string;
}) => {
  const {
    createGoogleCalendarListTool,
    createGoogleCalendarReadTool,
    createGoogleCalendarSearchTool,
    createGoogleCalendarCreateTool,
    createGoogleCalendarUpdateTool,
    createGoogleCalendarDeleteTool,
  } = await import("./googleCalendarTools");

  registerTool(
    params.tools,
    `google_calendar_list${params.suffix}`,
    createGoogleCalendarListTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `google_calendar_read${params.suffix}`,
    createGoogleCalendarReadTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `google_calendar_search${params.suffix}`,
    createGoogleCalendarSearchTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `google_calendar_create${params.suffix}`,
    createGoogleCalendarCreateTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `google_calendar_update${params.suffix}`,
    createGoogleCalendarUpdateTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `google_calendar_delete${params.suffix}`,
    createGoogleCalendarDeleteTool(params.workspaceId, params.serverId)
  );
};

const addNotionTools = async (params: {
  tools: Record<string, ReturnType<typeof createMcpServerTool>>;
  workspaceId: string;
  serverId: string;
  suffix: string;
}) => {
  console.log(
    `[MCP Tools] Creating Notion-specific tools for server ${params.serverId}`
  );
  const {
    createNotionReadPageTool,
    createNotionSearchTool,
    createNotionCreatePageTool,
    createNotionUpdatePageTool,
    createNotionQueryDatabaseTool,
    createNotionCreateDatabasePageTool,
    createNotionUpdateDatabasePageTool,
    createNotionAppendBlocksTool,
  } = await import("./notionTools");

  registerTool(
    params.tools,
    `notion_read${params.suffix}`,
    createNotionReadPageTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `notion_search${params.suffix}`,
    createNotionSearchTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `notion_create${params.suffix}`,
    createNotionCreatePageTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `notion_update${params.suffix}`,
    createNotionUpdatePageTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `notion_query_database${params.suffix}`,
    createNotionQueryDatabaseTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `notion_create_database_page${params.suffix}`,
    createNotionCreateDatabasePageTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `notion_update_database_page${params.suffix}`,
    createNotionUpdateDatabasePageTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `notion_append_blocks${params.suffix}`,
    createNotionAppendBlocksTool(params.workspaceId, params.serverId)
  );
};

const addGithubTools = async (params: {
  tools: Record<string, ReturnType<typeof createMcpServerTool>>;
  workspaceId: string;
  serverId: string;
  suffix: string;
}) => {
  const {
    createGithubListRepositoriesTool,
    createGithubGetRepositoryTool,
    createGithubListIssuesTool,
    createGithubGetIssueTool,
    createGithubListPullRequestsTool,
    createGithubGetPullRequestTool,
    createGithubReadFileTool,
    createGithubListCommitsTool,
    createGithubGetCommitTool,
  } = await import("./githubTools");

  registerTool(
    params.tools,
    `github_list_repos${params.suffix}`,
    createGithubListRepositoriesTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `github_get_repo${params.suffix}`,
    createGithubGetRepositoryTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `github_list_issues${params.suffix}`,
    createGithubListIssuesTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `github_get_issue${params.suffix}`,
    createGithubGetIssueTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `github_list_prs${params.suffix}`,
    createGithubListPullRequestsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `github_get_pr${params.suffix}`,
    createGithubGetPullRequestTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `github_read_file${params.suffix}`,
    createGithubReadFileTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `github_list_commits${params.suffix}`,
    createGithubListCommitsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `github_get_commit${params.suffix}`,
    createGithubGetCommitTool(params.workspaceId, params.serverId)
  );
};

const addLinearTools = async (params: {
  tools: Record<string, ReturnType<typeof createMcpServerTool>>;
  workspaceId: string;
  serverId: string;
  suffix: string;
}) => {
  const {
    createLinearListTeamsTool,
    createLinearListProjectsTool,
    createLinearListIssuesTool,
    createLinearGetIssueTool,
    createLinearSearchIssuesTool,
  } = await import("./linearTools");

  registerTool(
    params.tools,
    `linear_list_teams${params.suffix}`,
    createLinearListTeamsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `linear_list_projects${params.suffix}`,
    createLinearListProjectsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `linear_list_issues${params.suffix}`,
    createLinearListIssuesTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `linear_get_issue${params.suffix}`,
    createLinearGetIssueTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `linear_search_issues${params.suffix}`,
    createLinearSearchIssuesTool(params.workspaceId, params.serverId)
  );
};

const addHubspotTools = async (params: {
  tools: Record<string, ReturnType<typeof createMcpServerTool>>;
  workspaceId: string;
  serverId: string;
  suffix: string;
}) => {
  const {
    createHubspotListContactsTool,
    createHubspotGetContactTool,
    createHubspotSearchContactsTool,
    createHubspotListCompaniesTool,
    createHubspotGetCompanyTool,
    createHubspotSearchCompaniesTool,
    createHubspotListDealsTool,
    createHubspotGetDealTool,
    createHubspotSearchDealsTool,
    createHubspotListOwnersTool,
    createHubspotGetOwnerTool,
    createHubspotSearchOwnersTool,
  } = await import("./hubspotTools");

  registerTool(
    params.tools,
    `hubspot_list_contacts${params.suffix}`,
    createHubspotListContactsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `hubspot_get_contact${params.suffix}`,
    createHubspotGetContactTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `hubspot_search_contacts${params.suffix}`,
    createHubspotSearchContactsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `hubspot_list_companies${params.suffix}`,
    createHubspotListCompaniesTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `hubspot_get_company${params.suffix}`,
    createHubspotGetCompanyTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `hubspot_search_companies${params.suffix}`,
    createHubspotSearchCompaniesTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `hubspot_list_deals${params.suffix}`,
    createHubspotListDealsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `hubspot_get_deal${params.suffix}`,
    createHubspotGetDealTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `hubspot_search_deals${params.suffix}`,
    createHubspotSearchDealsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `hubspot_list_owners${params.suffix}`,
    createHubspotListOwnersTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `hubspot_get_owner${params.suffix}`,
    createHubspotGetOwnerTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `hubspot_search_owners${params.suffix}`,
    createHubspotSearchOwnersTool(params.workspaceId, params.serverId)
  );
};

const addSlackTools = async (params: {
  tools: Record<string, ReturnType<typeof createMcpServerTool>>;
  workspaceId: string;
  serverId: string;
  suffix: string;
}) => {
  const {
    createSlackListChannelsTool,
    createSlackGetChannelHistoryTool,
    createSlackPostMessageTool,
  } = await import("./slackTools");

  registerTool(
    params.tools,
    `slack_list_channels${params.suffix}`,
    createSlackListChannelsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `slack_get_channel_history${params.suffix}`,
    createSlackGetChannelHistoryTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `slack_post_message${params.suffix}`,
    createSlackPostMessageTool(params.workspaceId, params.serverId)
  );
};

const addStripeTools = async (params: {
  tools: Record<string, ReturnType<typeof createMcpServerTool>>;
  workspaceId: string;
  serverId: string;
  suffix: string;
}) => {
  const { createStripeSearchChargesTool, createStripeGetMetricsTool } =
    await import("./stripeTools");

  registerTool(
    params.tools,
    `stripe_search_charges${params.suffix}`,
    createStripeSearchChargesTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `stripe_get_metrics${params.suffix}`,
    createStripeGetMetricsTool(params.workspaceId, params.serverId)
  );
};

const addSalesforceTools = async (params: {
  tools: Record<string, ReturnType<typeof createMcpServerTool>>;
  workspaceId: string;
  serverId: string;
  suffix: string;
}) => {
  const {
    createSalesforceListObjectsTool,
    createSalesforceDescribeObjectTool,
    createSalesforceQueryTool,
  } = await import("./salesforceTools");

  registerTool(
    params.tools,
    `salesforce_list_objects${params.suffix}`,
    createSalesforceListObjectsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `salesforce_describe_object${params.suffix}`,
    createSalesforceDescribeObjectTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `salesforce_query${params.suffix}`,
    createSalesforceQueryTool(params.workspaceId, params.serverId)
  );
};

const addIntercomTools = async (params: {
  tools: Record<string, ReturnType<typeof createMcpServerTool>>;
  workspaceId: string;
  serverId: string;
  suffix: string;
}) => {
  const {
    createIntercomListContactsTool,
    createIntercomGetContactTool,
    createIntercomSearchContactsTool,
    createIntercomUpdateContactTool,
    createIntercomListConversationsTool,
    createIntercomGetConversationTool,
    createIntercomSearchConversationsTool,
    createIntercomReplyConversationTool,
  } = await import("./intercomTools");

  registerTool(
    params.tools,
    `intercom_list_contacts${params.suffix}`,
    createIntercomListContactsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `intercom_get_contact${params.suffix}`,
    createIntercomGetContactTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `intercom_search_contacts${params.suffix}`,
    createIntercomSearchContactsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `intercom_update_contact${params.suffix}`,
    createIntercomUpdateContactTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `intercom_list_conversations${params.suffix}`,
    createIntercomListConversationsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `intercom_get_conversation${params.suffix}`,
    createIntercomGetConversationTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `intercom_search_conversations${params.suffix}`,
    createIntercomSearchConversationsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `intercom_reply_conversation${params.suffix}`,
    createIntercomReplyConversationTool(params.workspaceId, params.serverId)
  );
};

const addTodoistTools = async (params: {
  tools: Record<string, ReturnType<typeof createMcpServerTool>>;
  workspaceId: string;
  serverId: string;
  suffix: string;
}) => {
  const {
    createTodoistAddTaskTool,
    createTodoistGetTasksTool,
    createTodoistCloseTaskTool,
    createTodoistGetProjectsTool,
  } = await import("./todoistTools");

  registerTool(
    params.tools,
    `todoist_add_task${params.suffix}`,
    createTodoistAddTaskTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `todoist_get_tasks${params.suffix}`,
    createTodoistGetTasksTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `todoist_close_task${params.suffix}`,
    createTodoistCloseTaskTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `todoist_get_projects${params.suffix}`,
    createTodoistGetProjectsTool(params.workspaceId, params.serverId)
  );
};

const addZendeskTools = async (params: {
  tools: Record<string, ReturnType<typeof createMcpServerTool>>;
  workspaceId: string;
  serverId: string;
  suffix: string;
}) => {
  const {
    createZendeskSearchTicketsTool,
    createZendeskGetTicketDetailsTool,
    createZendeskDraftCommentTool,
    createZendeskSearchHelpCenterTool,
  } = await import("./zendeskTools");

  registerTool(
    params.tools,
    `zendesk_search_tickets${params.suffix}`,
    createZendeskSearchTicketsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `zendesk_get_ticket_details${params.suffix}`,
    createZendeskGetTicketDetailsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `zendesk_draft_comment${params.suffix}`,
    createZendeskDraftCommentTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `zendesk_search_help_center${params.suffix}`,
    createZendeskSearchHelpCenterTool(params.workspaceId, params.serverId)
  );
};

const addPosthogTools = async (params: {
  tools: Record<string, ReturnType<typeof createMcpServerTool>>;
  workspaceId: string;
  serverId: string;
  suffix: string;
}) => {
  const {
    createPosthogListProjectsTool,
    createPosthogGetProjectTool,
    createPosthogListEventsTool,
    createPosthogListFeatureFlagsTool,
    createPosthogGetFeatureFlagTool,
    createPosthogListInsightsTool,
    createPosthogGetInsightTool,
    createPosthogListPersonsTool,
    createPosthogGetPersonTool,
    createPosthogGetTool,
  } = await import("./posthogTools");

  registerTool(
    params.tools,
    `posthog_list_projects${params.suffix}`,
    createPosthogListProjectsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `posthog_get_project${params.suffix}`,
    createPosthogGetProjectTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `posthog_list_events${params.suffix}`,
    createPosthogListEventsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `posthog_list_feature_flags${params.suffix}`,
    createPosthogListFeatureFlagsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `posthog_get_feature_flag${params.suffix}`,
    createPosthogGetFeatureFlagTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `posthog_list_insights${params.suffix}`,
    createPosthogListInsightsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `posthog_get_insight${params.suffix}`,
    createPosthogGetInsightTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `posthog_list_persons${params.suffix}`,
    createPosthogListPersonsTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `posthog_get_person${params.suffix}`,
    createPosthogGetPersonTool(params.workspaceId, params.serverId)
  );
  registerTool(
    params.tools,
    `posthog_get${params.suffix}`,
    createPosthogGetTool(params.workspaceId, params.serverId)
  );
};

const createDedicatedTools = async (params: {
  tools: Record<string, ReturnType<typeof createMcpServerTool>>;
  workspaceId: string;
  server: McpServerRecord;
  serverId: string;
  suffix: string;
}) => {
  const { server } = params;
  if (server.authType === "oauth" && server.serviceType === "google-drive") {
    await addGoogleDriveTools(params);
    return true;
  }
  if (server.authType === "oauth" && server.serviceType === "gmail") {
    await addGmailTools(params);
    return true;
  }
  if (server.authType === "oauth" && server.serviceType === "google-calendar") {
    await addGoogleCalendarTools(params);
    return true;
  }
  if (server.authType === "oauth" && server.serviceType === "notion") {
    await addNotionTools(params);
    return true;
  }
  if (server.authType === "oauth" && server.serviceType === "github") {
    await addGithubTools(params);
    return true;
  }
  if (server.authType === "oauth" && server.serviceType === "linear") {
    await addLinearTools(params);
    return true;
  }
  if (server.authType === "oauth" && server.serviceType === "hubspot") {
    await addHubspotTools(params);
    return true;
  }
  if (server.authType === "oauth" && server.serviceType === "slack") {
    await addSlackTools(params);
    return true;
  }
  if (server.authType === "oauth" && server.serviceType === "stripe") {
    await addStripeTools(params);
    return true;
  }
  if (server.authType === "oauth" && server.serviceType === "salesforce") {
    await addSalesforceTools(params);
    return true;
  }
  if (server.authType === "oauth" && server.serviceType === "intercom") {
    await addIntercomTools(params);
    return true;
  }
  if (server.authType === "oauth" && server.serviceType === "todoist") {
    await addTodoistTools(params);
    return true;
  }
  if (server.authType === "oauth" && server.serviceType === "zendesk") {
    await addZendeskTools(params);
    return true;
  }
  if (server.serviceType === "posthog") {
    await addPosthogTools(params);
    return true;
  }
  return false;
};

/**
 * Create tools for all enabled MCP servers for an agent
 */
export async function createMcpServerTools(
  workspaceId: string,
  enabledMcpServerIds: string[]
): Promise<Record<string, ReturnType<typeof createMcpServerTool>>> {
  const tools: Record<string, ReturnType<typeof createMcpServerTool>> = {};
  const validServers = await collectValidServers(
    workspaceId,
    enabledMcpServerIds
  );
  const serversByServiceType = buildServersByServiceType(
    validServers.map(({ server, serverId }) => ({ server, serverId }))
  );

  // Second pass: create tools with conditional naming
  for (const { server, serverId, hasOAuthConnection } of validServers) {
    const groupKey = getServiceGroupKey(server);
    const sameTypeServers = serversByServiceType.get(groupKey) ?? [];
    const hasConflict = sameTypeServers.length > 1;
    const suffix = getToolSuffix(server, hasConflict);

    logNotionServer({
      server,
      serverId,
      hasOAuthConnection,
      hasConflict,
      suffix,
    });

    const dedicatedToolsCreated = await createDedicatedTools({
      tools,
      workspaceId,
      server,
      serverId,
      suffix,
    });
    if (!dedicatedToolsCreated) {
      // Create a generic MCP tool for external servers
      // For generic servers, always use server name since they're inherently different
      // Only append suffix if there are multiple generic servers
      const toolName = `mcp_${sanitizeServerName(server.name)}`;
      logNotionGenericFallback(server, serverId);
      tools[toolName] = createMcpServerTool(workspaceId, serverId, server.name);
    }
  }

  return tools;
}
