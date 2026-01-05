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
  authType: "none" | "header" | "basic",
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

    // Create a tool with a unique name based on server ID
    // Sanitize server ID to ensure valid tool name (alphanumeric and underscores only)
    const toolName = `mcp_${serverId.replace(/[^a-zA-Z0-9]/g, "_")}`;
    tools[toolName] = createMcpServerTool(workspaceId, serverId, server.name);
  }

  return tools;
}
