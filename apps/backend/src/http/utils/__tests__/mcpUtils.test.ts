/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { database } from "../../../tables";
import { createMcpServerTool } from "../mcpUtils";

vi.mock("../../../tables", () => ({
  database: vi.fn(),
}));

const createJsonResponse = (result: unknown) => ({
  ok: true,
  headers: {
    get: () => "application/json",
  },
  json: async () => ({ jsonrpc: "2.0", result }),
  text: async () => JSON.stringify({ jsonrpc: "2.0", result }),
});

describe("MCP Utils", () => {
  const workspaceId = "workspace-1";
  const serverId = "server-1";
  const serverName = "Test MCP";
  const mockDb = {
    "mcp-server": {
      get: vi.fn(),
      update: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(database).mockResolvedValue(mockDb as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns validation error for missing params", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      workspaceId,
      authType: "none",
      url: "https://example.com",
      config: {},
    });

    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        tools: [
          {
            name: "doThing",
            inputSchema: {
              type: "object",
              properties: {
                foo: { type: "string" },
              },
              required: ["foo"],
              additionalProperties: false,
            },
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock as any);

    const tool = createMcpServerTool(workspaceId, serverId, serverName);
    const result = await (tool as any).execute({
      method: "doThing",
      params: {},
    });

    expect(result).toContain("Invalid tool arguments");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns error for unknown method", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      workspaceId,
      authType: "none",
      url: "https://example.com",
      config: {},
    });

    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        tools: [{ name: "doThing", inputSchema: { type: "object" } }],
      })
    );
    vi.stubGlobal("fetch", fetchMock as any);

    const tool = createMcpServerTool(workspaceId, serverId, serverName);
    const result = await (tool as any).execute({
      method: "unknown",
      params: {},
    });

    expect(result).toContain("Unknown MCP method");
    expect(result).toContain("doThing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
