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
    throw new Error("OAuth MCP servers should use dedicated tools, not generic MCP calls");
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
 * Create tools for all enabled MCP servers for an agent
 */
export async function createMcpServerTools(
  workspaceId: string,
  enabledMcpServerIds: string[]
): Promise<Record<string, ReturnType<typeof createMcpServerTool>>> {
  const tools: Record<string, ReturnType<typeof createMcpServerTool>> = {};

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

    // Check if this is an OAuth-based MCP server with dedicated tools
    if (server.authType === "oauth" && server.serviceType === "google-drive") {
      // Check for OAuth connection
      const config = server.config as {
        accessToken?: string;
      };

      if (!config.accessToken) {
        console.warn(
          `MCP server ${serverId} (Google Drive) is not connected, skipping tools`
        );
        continue;
      }

      // Import Google Drive tools dynamically to avoid circular dependencies
      const {
        createGoogleDriveListTool,
        createGoogleDriveReadTool,
        createGoogleDriveSearchTool,
      } = await import("./googleDriveTools");

      // Create dedicated Google Drive tools
      // Type assertion needed because tool return types are complex
      const listTool = createGoogleDriveListTool(workspaceId, serverId);
      const readTool = createGoogleDriveReadTool(workspaceId, serverId);
      const searchTool = createGoogleDriveSearchTool(workspaceId, serverId);
      
      // Use server name for tool names (sanitized) - simpler than using serverId
      const serverNameSanitized = server.name
        .replace(/[^a-zA-Z0-9]/g, "_")
        .toLowerCase();
      
      tools[`google_drive_list_${serverNameSanitized}`] =
        listTool as ReturnType<typeof createMcpServerTool>;
      tools[`google_drive_read_${serverNameSanitized}`] =
        readTool as ReturnType<typeof createMcpServerTool>;
      tools[`google_drive_search_${serverNameSanitized}`] =
        searchTool as ReturnType<typeof createMcpServerTool>;
    } else {
      // Create a generic MCP tool for external servers
      // Use server name for tool name (sanitized) - simpler than using serverId
      const serverNameSanitized = server.name
        .replace(/[^a-zA-Z0-9]/g, "_")
        .toLowerCase();
      const toolName = `mcp_${serverNameSanitized}`;
      tools[toolName] = createMcpServerTool(workspaceId, serverId, server.name);
    }
  }

  return tools;
}
