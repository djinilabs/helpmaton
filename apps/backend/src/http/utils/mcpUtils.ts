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

/**
 * Create tools for all enabled MCP servers for an agent
 */
export async function createMcpServerTools(
  workspaceId: string,
  enabledMcpServerIds: string[]
): Promise<Record<string, ReturnType<typeof createMcpServerTool>>> {
  const tools: Record<string, ReturnType<typeof createMcpServerTool>> = {};
  const oauthServiceTypes = [
    "google-drive",
    "gmail",
    "google-calendar",
    "notion",
    "github",
    "linear",
  ];

  // First pass: collect all valid servers
  interface ValidServer {
    server: McpServerRecord;
    serverId: string;
    hasOAuthConnection: boolean;
  }
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

    // Check for OAuth connection
    const config = server.config as { accessToken?: string };
    const hasOAuthConnection = !!config.accessToken;

    // Skip OAuth servers without connection
    if (server.authType === "oauth" && !hasOAuthConnection) {
      console.warn(
        `MCP server ${serverId} (${server.serviceType || "unknown"}) is not connected, skipping tools`
      );
      continue;
    }

    validServers.push({ server, serverId, hasOAuthConnection });
  }

  // Group servers by serviceType for conflict detection
  // For OAuth servers with specific serviceTypes, group by serviceType
  // For generic servers, group all together
  const serversByServiceType = new Map<
    string,
    Array<{ server: McpServerRecord; serverId: string }>
  >();

  for (const { server, serverId } of validServers) {
    // Determine grouping key
    let groupKey: string;
    if (
      server.serviceType &&
      ((server.authType === "oauth" &&
        oauthServiceTypes.includes(server.serviceType)) ||
        server.serviceType === "posthog")
    ) {
      // OAuth servers with specific serviceTypes
      groupKey = server.serviceType;
    } else {
      // Generic MCP servers (all grouped together)
      groupKey = "__generic__";
    }

    if (!serversByServiceType.has(groupKey)) {
      serversByServiceType.set(groupKey, []);
    }
    serversByServiceType.get(groupKey)!.push({ server, serverId });
  }

  // Second pass: create tools with conditional naming
  for (const { server, serverId, hasOAuthConnection } of validServers) {
    // Determine if there's a conflict (multiple servers of same type)
    let groupKey: string;
    if (
      server.serviceType &&
      ((server.authType === "oauth" &&
        oauthServiceTypes.includes(server.serviceType)) ||
        server.serviceType === "posthog")
    ) {
      groupKey = server.serviceType;
    } else {
      groupKey = "__generic__";
    }

    const sameTypeServers = serversByServiceType.get(groupKey) || [];
    const hasConflict = sameTypeServers.length > 1;
    const serverNameSanitized = sanitizeServerName(server.name);
    const suffix = hasConflict ? `_${serverNameSanitized}` : "";

    // Debug logging for Notion MCP servers
    if (server.serviceType === "notion" || server.name.toLowerCase().includes("notion")) {
      console.log(`[MCP Tools] Processing Notion server ${serverId}:`, {
        authType: server.authType,
        serviceType: server.serviceType,
        hasAccessToken: hasOAuthConnection,
        hasConflict,
        suffix,
      });
    }

    // Check if this is an OAuth-based MCP server with dedicated tools
    if (server.authType === "oauth" && server.serviceType === "google-drive") {
      // Import Google Drive tools dynamically to avoid circular dependencies
      const {
        createGoogleDriveListTool,
        createGoogleDriveReadTool,
        createGoogleDriveSearchTool,
      } = await import("./googleDriveTools");

      // Create dedicated Google Drive tools
      const listTool = createGoogleDriveListTool(workspaceId, serverId);
      const readTool = createGoogleDriveReadTool(workspaceId, serverId);
      const searchTool = createGoogleDriveSearchTool(workspaceId, serverId);

      tools[`google_drive_list${suffix}`] =
        listTool as ReturnType<typeof createMcpServerTool>;
      tools[`google_drive_read${suffix}`] =
        readTool as ReturnType<typeof createMcpServerTool>;
      tools[`google_drive_search${suffix}`] =
        searchTool as ReturnType<typeof createMcpServerTool>;
    } else if (server.authType === "oauth" && server.serviceType === "gmail") {
      // Import Gmail tools dynamically to avoid circular dependencies
      const {
        createGmailListTool,
        createGmailReadTool,
        createGmailSearchTool,
      } = await import("./gmailTools");

      // Create dedicated Gmail tools
      const listTool = createGmailListTool(workspaceId, serverId);
      const readTool = createGmailReadTool(workspaceId, serverId);
      const searchTool = createGmailSearchTool(workspaceId, serverId);

      tools[`gmail_list${suffix}`] =
        listTool as ReturnType<typeof createMcpServerTool>;
      tools[`gmail_read${suffix}`] =
        readTool as ReturnType<typeof createMcpServerTool>;
      tools[`gmail_search${suffix}`] =
        searchTool as ReturnType<typeof createMcpServerTool>;
    } else if (server.authType === "oauth" && server.serviceType === "google-calendar") {
      // Import Google Calendar tools dynamically to avoid circular dependencies
      const {
        createGoogleCalendarListTool,
        createGoogleCalendarReadTool,
        createGoogleCalendarSearchTool,
        createGoogleCalendarCreateTool,
        createGoogleCalendarUpdateTool,
        createGoogleCalendarDeleteTool,
      } = await import("./googleCalendarTools");

      // Create dedicated Google Calendar tools
      const listTool = createGoogleCalendarListTool(workspaceId, serverId);
      const readTool = createGoogleCalendarReadTool(workspaceId, serverId);
      const searchTool = createGoogleCalendarSearchTool(workspaceId, serverId);
      const createTool = createGoogleCalendarCreateTool(workspaceId, serverId);
      const updateTool = createGoogleCalendarUpdateTool(workspaceId, serverId);
      const deleteTool = createGoogleCalendarDeleteTool(workspaceId, serverId);

      tools[`google_calendar_list${suffix}`] =
        listTool as ReturnType<typeof createMcpServerTool>;
      tools[`google_calendar_read${suffix}`] =
        readTool as ReturnType<typeof createMcpServerTool>;
      tools[`google_calendar_search${suffix}`] =
        searchTool as ReturnType<typeof createMcpServerTool>;
      tools[`google_calendar_create${suffix}`] =
        createTool as ReturnType<typeof createMcpServerTool>;
      tools[`google_calendar_update${suffix}`] =
        updateTool as ReturnType<typeof createMcpServerTool>;
      tools[`google_calendar_delete${suffix}`] =
        deleteTool as ReturnType<typeof createMcpServerTool>;
    } else if (server.authType === "oauth" && server.serviceType === "notion") {
      console.log(
        `[MCP Tools] Creating Notion-specific tools for server ${serverId} (${server.name})`
      );

      // Import Notion tools dynamically to avoid circular dependencies
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

      // Create dedicated Notion tools
      const readTool = createNotionReadPageTool(workspaceId, serverId);
      const searchTool = createNotionSearchTool(workspaceId, serverId);
      const createTool = createNotionCreatePageTool(workspaceId, serverId);
      const updateTool = createNotionUpdatePageTool(workspaceId, serverId);
      const queryDatabaseTool = createNotionQueryDatabaseTool(workspaceId, serverId);
      const createDatabasePageTool = createNotionCreateDatabasePageTool(workspaceId, serverId);
      const updateDatabasePageTool = createNotionUpdateDatabasePageTool(workspaceId, serverId);
      const appendBlocksTool = createNotionAppendBlocksTool(workspaceId, serverId);

      tools[`notion_read${suffix}`] =
        readTool as ReturnType<typeof createMcpServerTool>;
      tools[`notion_search${suffix}`] =
        searchTool as ReturnType<typeof createMcpServerTool>;
      tools[`notion_create${suffix}`] =
        createTool as ReturnType<typeof createMcpServerTool>;
      tools[`notion_update${suffix}`] =
        updateTool as ReturnType<typeof createMcpServerTool>;
      tools[`notion_query_database${suffix}`] =
        queryDatabaseTool as ReturnType<typeof createMcpServerTool>;
      tools[`notion_create_database_page${suffix}`] =
        createDatabasePageTool as ReturnType<typeof createMcpServerTool>;
      tools[`notion_update_database_page${suffix}`] =
        updateDatabasePageTool as ReturnType<typeof createMcpServerTool>;
      tools[`notion_append_blocks${suffix}`] =
        appendBlocksTool as ReturnType<typeof createMcpServerTool>;
    } else if (server.authType === "oauth" && server.serviceType === "github") {
      // Import GitHub tools dynamically to avoid circular dependencies
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

      // Create dedicated GitHub tools
      const listReposTool = createGithubListRepositoriesTool(workspaceId, serverId);
      const getRepoTool = createGithubGetRepositoryTool(workspaceId, serverId);
      const listIssuesTool = createGithubListIssuesTool(workspaceId, serverId);
      const getIssueTool = createGithubGetIssueTool(workspaceId, serverId);
      const listPRsTool = createGithubListPullRequestsTool(workspaceId, serverId);
      const getPRTool = createGithubGetPullRequestTool(workspaceId, serverId);
      const readFileTool = createGithubReadFileTool(workspaceId, serverId);
      const listCommitsTool = createGithubListCommitsTool(workspaceId, serverId);
      const getCommitTool = createGithubGetCommitTool(workspaceId, serverId);

      tools[`github_list_repos${suffix}`] =
        listReposTool as ReturnType<typeof createMcpServerTool>;
      tools[`github_get_repo${suffix}`] =
        getRepoTool as ReturnType<typeof createMcpServerTool>;
      tools[`github_list_issues${suffix}`] =
        listIssuesTool as ReturnType<typeof createMcpServerTool>;
      tools[`github_get_issue${suffix}`] =
        getIssueTool as ReturnType<typeof createMcpServerTool>;
      tools[`github_list_prs${suffix}`] =
        listPRsTool as ReturnType<typeof createMcpServerTool>;
      tools[`github_get_pr${suffix}`] =
        getPRTool as ReturnType<typeof createMcpServerTool>;
      tools[`github_read_file${suffix}`] =
        readFileTool as ReturnType<typeof createMcpServerTool>;
      tools[`github_list_commits${suffix}`] =
        listCommitsTool as ReturnType<typeof createMcpServerTool>;
      tools[`github_get_commit${suffix}`] =
        getCommitTool as ReturnType<typeof createMcpServerTool>;
    } else if (server.authType === "oauth" && server.serviceType === "linear") {
      const {
        createLinearListTeamsTool,
        createLinearListProjectsTool,
        createLinearListIssuesTool,
        createLinearGetIssueTool,
        createLinearSearchIssuesTool,
      } = await import("./linearTools");

      const listTeamsTool = createLinearListTeamsTool(workspaceId, serverId);
      const listProjectsTool = createLinearListProjectsTool(workspaceId, serverId);
      const listIssuesTool = createLinearListIssuesTool(workspaceId, serverId);
      const getIssueTool = createLinearGetIssueTool(workspaceId, serverId);
      const searchIssuesTool = createLinearSearchIssuesTool(workspaceId, serverId);

      tools[`linear_list_teams${suffix}`] =
        listTeamsTool as ReturnType<typeof createMcpServerTool>;
      tools[`linear_list_projects${suffix}`] =
        listProjectsTool as ReturnType<typeof createMcpServerTool>;
      tools[`linear_list_issues${suffix}`] =
        listIssuesTool as ReturnType<typeof createMcpServerTool>;
      tools[`linear_get_issue${suffix}`] =
        getIssueTool as ReturnType<typeof createMcpServerTool>;
      tools[`linear_search_issues${suffix}`] =
        searchIssuesTool as ReturnType<typeof createMcpServerTool>;
    } else if (server.serviceType === "posthog") {
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

      const listProjectsTool = createPosthogListProjectsTool(
        workspaceId,
        serverId
      );
      const getProjectTool = createPosthogGetProjectTool(workspaceId, serverId);
      const listEventsTool = createPosthogListEventsTool(workspaceId, serverId);
      const listFlagsTool = createPosthogListFeatureFlagsTool(
        workspaceId,
        serverId
      );
      const getFlagTool = createPosthogGetFeatureFlagTool(
        workspaceId,
        serverId
      );
      const listInsightsTool = createPosthogListInsightsTool(
        workspaceId,
        serverId
      );
      const getInsightTool = createPosthogGetInsightTool(workspaceId, serverId);
      const listPersonsTool = createPosthogListPersonsTool(
        workspaceId,
        serverId
      );
      const getPersonTool = createPosthogGetPersonTool(workspaceId, serverId);
      const getTool = createPosthogGetTool(workspaceId, serverId);

      tools[`posthog_list_projects${suffix}`] =
        listProjectsTool as ReturnType<typeof createMcpServerTool>;
      tools[`posthog_get_project${suffix}`] =
        getProjectTool as ReturnType<typeof createMcpServerTool>;
      tools[`posthog_list_events${suffix}`] =
        listEventsTool as ReturnType<typeof createMcpServerTool>;
      tools[`posthog_list_feature_flags${suffix}`] =
        listFlagsTool as ReturnType<typeof createMcpServerTool>;
      tools[`posthog_get_feature_flag${suffix}`] =
        getFlagTool as ReturnType<typeof createMcpServerTool>;
      tools[`posthog_list_insights${suffix}`] =
        listInsightsTool as ReturnType<typeof createMcpServerTool>;
      tools[`posthog_get_insight${suffix}`] =
        getInsightTool as ReturnType<typeof createMcpServerTool>;
      tools[`posthog_list_persons${suffix}`] =
        listPersonsTool as ReturnType<typeof createMcpServerTool>;
      tools[`posthog_get_person${suffix}`] =
        getPersonTool as ReturnType<typeof createMcpServerTool>;
      tools[`posthog_get${suffix}`] =
        getTool as ReturnType<typeof createMcpServerTool>;
    } else {
      // Create a generic MCP tool for external servers
      // For generic servers, always use server name since they're inherently different
      // Only append suffix if there are multiple generic servers
      const toolName = hasConflict
        ? `mcp_${serverNameSanitized}`
        : `mcp_${serverNameSanitized}`;

      // Debug logging for servers that fall through to generic tool
      if (server.serviceType === "notion" || server.name.toLowerCase().includes("notion")) {
        console.warn(
          `[MCP Tools] Notion server ${serverId} falling through to generic tool. AuthType: ${server.authType}, ServiceType: ${server.serviceType}`
        );
      }

      tools[toolName] = createMcpServerTool(workspaceId, serverId, server.name);
    }
  }

  return tools;
}
