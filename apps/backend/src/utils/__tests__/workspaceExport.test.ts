import { describe, it, expect, vi, beforeEach } from "vitest";

import type { QueryResponse } from "../../tables/schema";
import { exportWorkspace } from "../workspaceExport";

// Mock the database module
vi.mock("../../tables", () => ({
  database: vi.fn(),
}));

describe("exportWorkspace", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock database type
  let mockDb: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create mock database with all required methods
    mockDb = {
      workspace: {
        get: vi.fn(),
      },
      agent: {
        query: vi.fn(),
      },
      "agent-key": {
        query: vi.fn(),
      },
      "agent-eval-judge": {
        query: vi.fn(),
      },
      "agent-stream-servers": {
        get: vi.fn(),
      },
      output_channel: {
        query: vi.fn(),
      },
      "email-connection": {
        query: vi.fn(),
      },
      "mcp-server": {
        query: vi.fn(),
      },
      "bot-integration": {
        query: vi.fn(),
      },
    };

    const { database } = await import("../../tables");
    vi.mocked(database).mockResolvedValue(mockDb);
  });

  it("should export a minimal workspace", async () => {
    const workspaceId = "workspace-123";

    // Mock workspace
    mockDb.workspace.get.mockResolvedValue({
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      currency: "usd",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    // Mock empty queries
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic query response
    const emptyQueryResponse: QueryResponse<any> = {
      items: [],
      areAnyUnpublished: false,
    };
    mockDb.agent.query.mockResolvedValue(emptyQueryResponse);
    mockDb.output_channel.query.mockResolvedValue(emptyQueryResponse);
    mockDb["email-connection"].query.mockResolvedValue(emptyQueryResponse);
    mockDb["mcp-server"].query.mockResolvedValue(emptyQueryResponse);
    mockDb["bot-integration"].query.mockResolvedValue(emptyQueryResponse);

    const result = await exportWorkspace(workspaceId);

    expect(result.id).toBe("{Test Workspace}");
    expect(result.name).toBe("Test Workspace");
    expect(result.currency).toBe("usd");
    expect(result.agents).toBeUndefined();
    expect(result.outputChannels).toBeUndefined();
  });

  it("should export workspace with agents and nested entities", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    // Mock workspace
    mockDb.workspace.get.mockResolvedValue({
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      currency: "usd",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    // Mock agent
    mockDb.agent.query.mockResolvedValue({
      items: [
        {
          pk: `agents/${workspaceId}/${agentId}`,
          sk: "agent",
          workspaceId,
          name: "Test Agent",
          systemPrompt: "You are helpful",
          provider: "openrouter",
          modelName: "gpt-4o",
          version: 1,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
      areAnyUnpublished: false,
    });

    // Mock agent keys
    mockDb["agent-key"].query.mockResolvedValue({
      items: [
        {
          pk: `agent-keys/${workspaceId}/${agentId}/key-1`,
          sk: "key",
          workspaceId,
          agentId,
          key: "secret-key",
          name: "Webhook Key",
          type: "webhook",
          provider: "google",
          version: 1,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
      areAnyUnpublished: false,
    });

    // Mock eval judges
    mockDb["agent-eval-judge"].query.mockResolvedValue({
      items: [
        {
          pk: `agent-eval-judges/${workspaceId}/${agentId}/judge-1`,
          sk: "judge",
          workspaceId,
          agentId,
          judgeId: "judge-1",
          name: "Quality Judge",
          enabled: true,
          provider: "openrouter",
          modelName: "gpt-4o",
          evalPrompt: "Evaluate quality",
          version: 1,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
      areAnyUnpublished: false,
    });

    // Mock stream server
    mockDb["agent-stream-servers"].get.mockResolvedValue({
      pk: `stream-servers/${workspaceId}/${agentId}`,
      sk: "config",
      workspaceId,
      agentId,
      secret: "stream-secret",
      allowedOrigins: ["https://example.com"],
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    // Mock empty other entities
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic query response
    const emptyResponse: QueryResponse<any> = {
      items: [],
      areAnyUnpublished: false,
    };
    mockDb.output_channel.query.mockResolvedValue(emptyResponse);
    mockDb["email-connection"].query.mockResolvedValue(emptyResponse);
    mockDb["mcp-server"].query.mockResolvedValue(emptyResponse);
    mockDb["bot-integration"].query.mockResolvedValue(emptyResponse);

    const result = await exportWorkspace(workspaceId);

    expect(result.agents).toHaveLength(1);
    expect(result.agents![0].id).toBe("{Test Agent}");
    expect(result.agents![0].name).toBe("Test Agent");
    expect(result.agents![0].keys).toHaveLength(1);
    expect(result.agents![0].keys![0].id).toBe("{Webhook Key}");
    expect(result.agents![0].evalJudges).toHaveLength(1);
    expect(result.agents![0].evalJudges![0].id).toBe("{Quality Judge}");
    expect(result.agents![0].streamServer).toBeDefined();
    expect(result.agents![0].streamServer!.secret).toBe("stream-secret");
  });

  it("should export workspace with output channels", async () => {
    const workspaceId = "workspace-123";

    mockDb.workspace.get.mockResolvedValue({
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      currency: "usd",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    vi.mocked(mockDb.agent!.query).mockResolvedValue({ items: [] });
    vi.mocked(mockDb.output_channel!.query).mockResolvedValue({
      items: [
        {
          pk: `output-channels/${workspaceId}/channel-789`,
          sk: "channel",
          workspaceId,
          channelId: "channel-789",
          type: "discord",
          name: "Discord Channel",
          config: { webhookUrl: "https://discord.com/webhook" },
          version: 1,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
      areAnyUnpublished: false,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic query response
    const emptyResponse: QueryResponse<any> = {
      items: [],
      areAnyUnpublished: false,
    };
    mockDb["email-connection"].query.mockResolvedValue(emptyResponse);
    mockDb["mcp-server"].query.mockResolvedValue(emptyResponse);
    mockDb["bot-integration"].query.mockResolvedValue(emptyResponse);

    const result = await exportWorkspace(workspaceId);

    expect(result.outputChannels).toHaveLength(1);
    expect(result.outputChannels![0].id).toBe("{Discord Channel}");
    expect(result.outputChannels![0].type).toBe("discord");
  });

  it("should export workspace with email connections", async () => {
    const workspaceId = "workspace-123";

    mockDb.workspace.get.mockResolvedValue({
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      currency: "usd",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    vi.mocked(mockDb.agent!.query).mockResolvedValue({ items: [] });
    vi.mocked(mockDb.output_channel!.query).mockResolvedValue({ items: [] });
    vi.mocked(mockDb["email-connection"]!.query).mockResolvedValue({
      items: [
        {
          pk: `email-connections/${workspaceId}`,
          sk: "connection",
          workspaceId,
          type: "gmail",
          name: "Gmail Connection",
          config: { accessToken: "token" },
          version: 1,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
    });
    vi.mocked(mockDb["mcp-server"]!.query).mockResolvedValue({ items: [] });
    vi.mocked(mockDb["bot-integration"]!.query).mockResolvedValue({
      items: [],
    });

    const result = await exportWorkspace(workspaceId);

    expect(result.emailConnections).toHaveLength(1);
    expect(result.emailConnections![0].type).toBe("gmail");
    expect(result.emailConnections![0].name).toBe("Gmail Connection");
  });

  it("should export workspace with MCP servers", async () => {
    const workspaceId = "workspace-123";

    mockDb.workspace.get.mockResolvedValue({
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      currency: "usd",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    vi.mocked(mockDb.agent!.query).mockResolvedValue({ items: [] });
    vi.mocked(mockDb.output_channel!.query).mockResolvedValue({ items: [] });
    vi.mocked(mockDb["email-connection"]!.query).mockResolvedValue({
      items: [],
    });
    vi.mocked(mockDb["mcp-server"]!.query).mockResolvedValue({
      items: [
        {
          pk: `mcp-servers/${workspaceId}/server-1`,
          sk: "server",
          workspaceId,
          name: "Notion MCP",
          url: "https://mcp.example.com",
          authType: "oauth",
          serviceType: "notion",
          config: { accessToken: "token" },
          version: 1,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
    });
    vi.mocked(mockDb["bot-integration"]!.query).mockResolvedValue({
      items: [],
    });

    const result = await exportWorkspace(workspaceId);

    expect(result.mcpServers).toHaveLength(1);
    expect(result.mcpServers![0].id).toBe("{Notion MCP}");
    expect(result.mcpServers![0].name).toBe("Notion MCP");
    expect(result.mcpServers![0].authType).toBe("oauth");
    // Credentials should be filtered out
    expect(result.mcpServers![0].config).not.toHaveProperty("accessToken");
  });

  it("should export workspace with bot integrations", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    mockDb.workspace.get.mockResolvedValue({
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      currency: "usd",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    // Mock agent so we can test refName resolution
    vi.mocked(mockDb.agent!.query).mockResolvedValue({
      items: [
        {
          pk: `agents/${workspaceId}/${agentId}`,
          sk: "agent",
          workspaceId,
          name: "Test Agent",
          systemPrompt: "You are helpful",
          provider: "openrouter",
          version: 1,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
      areAnyUnpublished: false,
    });

    // Mock empty nested entities for agent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic query response
    const emptyResponse: QueryResponse<any> = {
      items: [],
      areAnyUnpublished: false,
    };
    mockDb["agent-key"].query.mockResolvedValue(emptyResponse);
    mockDb["agent-eval-judge"].query.mockResolvedValue(emptyResponse);
    mockDb["agent-stream-servers"].get.mockResolvedValue(undefined);

    vi.mocked(mockDb.output_channel!.query).mockResolvedValue({ items: [] });
    vi.mocked(mockDb["email-connection"]!.query).mockResolvedValue({
      items: [],
    });
    vi.mocked(mockDb["mcp-server"]!.query).mockResolvedValue({ items: [] });
    vi.mocked(mockDb["bot-integration"]!.query).mockResolvedValue({
      items: [
        {
          pk: `bot-integrations/${workspaceId}/integration-1`,
          sk: "integration",
          workspaceId,
          agentId,
          platform: "discord",
          name: "Discord Bot",
          config: { botToken: "token" },
          webhookUrl: "https://example.com/webhook",
          status: "active",
          version: 1,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
      areAnyUnpublished: false,
    });

    const result = await exportWorkspace(workspaceId);

    expect(result.botIntegrations).toHaveLength(1);
    expect(result.botIntegrations![0].id).toBe("{Discord Bot}");
    expect(result.botIntegrations![0].agentId).toBe("{Test Agent}");
    expect(result.botIntegrations![0].platform).toBe("discord");
  });

  it("should handle agent without nested entities", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    mockDb.workspace.get.mockResolvedValue({
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      currency: "usd",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    vi.mocked(mockDb.agent!.query).mockResolvedValue({
      items: [
        {
          pk: `agents/${workspaceId}/${agentId}`,
          sk: "agent",
          workspaceId,
          name: "Test Agent",
          systemPrompt: "You are helpful",
          provider: "openrouter",
          version: 1,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
    });

    // Mock empty nested entities
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic query response
    const emptyResponse: QueryResponse<any> = {
      items: [],
      areAnyUnpublished: false,
    };
    mockDb["agent-key"].query.mockResolvedValue(emptyResponse);
    mockDb["agent-eval-judge"].query.mockResolvedValue(emptyResponse);
    mockDb["agent-stream-servers"].get.mockResolvedValue(undefined);

    mockDb.output_channel.query.mockResolvedValue(emptyResponse);
    mockDb["email-connection"].query.mockResolvedValue(emptyResponse);
    mockDb["mcp-server"].query.mockResolvedValue(emptyResponse);
    mockDb["bot-integration"].query.mockResolvedValue(emptyResponse);

    const result = await exportWorkspace(workspaceId);

    expect(result.agents).toHaveLength(1);
    expect(result.agents![0].keys).toBeUndefined();
    expect(result.agents![0].evalJudges).toBeUndefined();
    expect(result.agents![0].streamServer).toBeUndefined();
  });

  it("should throw error if workspace not found", async () => {
    const workspaceId = "workspace-123";

    mockDb.workspace.get.mockResolvedValue(undefined);

    await expect(exportWorkspace(workspaceId)).rejects.toThrow(
      `Workspace ${workspaceId} not found`
    );
  });

  it("should handle workspace with spending limits", async () => {
    const workspaceId = "workspace-123";

    mockDb.workspace.get.mockResolvedValue({
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      currency: "usd",
      spendingLimits: [
        {
          timeFrame: "daily",
          amount: 5000000,
        },
        {
          timeFrame: "monthly",
          amount: 100000000,
        },
      ],
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    vi.mocked(mockDb.agent!.query).mockResolvedValue({ items: [] });
    vi.mocked(mockDb.output_channel!.query).mockResolvedValue({ items: [] });
    vi.mocked(mockDb["email-connection"]!.query).mockResolvedValue({
      items: [],
    });
    vi.mocked(mockDb["mcp-server"]!.query).mockResolvedValue({ items: [] });
    vi.mocked(mockDb["bot-integration"]!.query).mockResolvedValue({
      items: [],
    });

    const result = await exportWorkspace(workspaceId);

    expect(result.spendingLimits).toHaveLength(2);
    expect(result.spendingLimits![0].timeFrame).toBe("daily");
    expect(result.spendingLimits![0].amount).toBe(5000000);
    expect(result.spendingLimits![1].timeFrame).toBe("monthly");
    expect(result.spendingLimits![1].amount).toBe(100000000);
  });

  it("should handle duplicate names with disambiguation", async () => {
    const workspaceId = "workspace-123";

    mockDb.workspace.get.mockResolvedValue({
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      currency: "usd",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    // Mock two agents with the same name
    vi.mocked(mockDb.agent!.query).mockResolvedValue({
      items: [
        {
          pk: `agents/${workspaceId}/agent-1`,
          sk: "agent",
          workspaceId,
          name: "Main Agent",
          systemPrompt: "You are helpful",
          provider: "openrouter",
          version: 1,
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          pk: `agents/${workspaceId}/agent-2`,
          sk: "agent",
          workspaceId,
          name: "Main Agent",
          systemPrompt: "You are helpful too",
          provider: "openrouter",
          version: 1,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
      areAnyUnpublished: false,
    });

    // Mock empty nested entities
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic query response
    const emptyResponse: QueryResponse<any> = {
      items: [],
      areAnyUnpublished: false,
    };
    mockDb["agent-key"].query.mockResolvedValue(emptyResponse);
    mockDb["agent-eval-judge"].query.mockResolvedValue(emptyResponse);
    mockDb["agent-stream-servers"].get.mockResolvedValue(undefined);

    mockDb.output_channel.query.mockResolvedValue(emptyResponse);
    mockDb["email-connection"].query.mockResolvedValue(emptyResponse);
    mockDb["mcp-server"].query.mockResolvedValue(emptyResponse);
    mockDb["bot-integration"].query.mockResolvedValue(emptyResponse);

    const result = await exportWorkspace(workspaceId);

    expect(result.agents).toHaveLength(2);
    expect(result.agents![0].id).toBe("{Main Agent}");
    expect(result.agents![1].id).toBe("{Main Agent 2}");
  });

  it("should replace cross-references with refNames", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const channelId = "channel-789";
    const serverId = "server-1";

    mockDb.workspace.get.mockResolvedValue({
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      currency: "usd",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    // Mock agent with references
    vi.mocked(mockDb.agent!.query).mockResolvedValue({
      items: [
        {
          pk: `agents/${workspaceId}/${agentId}`,
          sk: "agent",
          workspaceId,
          name: "Test Agent",
          systemPrompt: "You are helpful",
          provider: "openrouter",
          notificationChannelId: channelId,
          enabledMcpServerIds: [serverId],
          version: 1,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
      areAnyUnpublished: false,
    });

    // Mock output channel
    vi.mocked(mockDb.output_channel!.query).mockResolvedValue({
      items: [
        {
          pk: `output-channels/${workspaceId}/${channelId}`,
          sk: "channel",
          workspaceId,
          channelId,
          type: "discord",
          name: "Discord Channel",
          config: { webhookUrl: "https://discord.com/webhook" },
          version: 1,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
      areAnyUnpublished: false,
    });

    // Mock MCP server
    vi.mocked(mockDb["mcp-server"]!.query).mockResolvedValue({
      items: [
        {
          pk: `mcp-servers/${workspaceId}/${serverId}`,
          sk: "server",
          workspaceId,
          name: "Notion MCP",
          url: "https://mcp.example.com",
          authType: "oauth",
          serviceType: "notion",
          config: { accessToken: "token" },
          version: 1,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
      areAnyUnpublished: false,
    });

    // Mock empty nested entities
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic query response
    const emptyResponse: QueryResponse<any> = {
      items: [],
      areAnyUnpublished: false,
    };
    mockDb["agent-key"].query.mockResolvedValue(emptyResponse);
    mockDb["agent-eval-judge"].query.mockResolvedValue(emptyResponse);
    mockDb["agent-stream-servers"].get.mockResolvedValue(undefined);
    mockDb["email-connection"].query.mockResolvedValue(emptyResponse);
    mockDb["bot-integration"].query.mockResolvedValue(emptyResponse);

    const result = await exportWorkspace(workspaceId);

    expect(result.agents![0].notificationChannelId).toBe("{Discord Channel}");
    expect(result.agents![0].enabledMcpServerIds).toEqual(["{Notion MCP}"]);
  });

  it("should filter out credentials from MCP server configs", async () => {
    const workspaceId = "workspace-123";

    mockDb.workspace.get.mockResolvedValue({
      pk: `workspaces/${workspaceId}`,
      sk: "workspace",
      name: "Test Workspace",
      currency: "usd",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    vi.mocked(mockDb.agent!.query).mockResolvedValue({ items: [] });
    vi.mocked(mockDb.output_channel!.query).mockResolvedValue({ items: [] });
    vi.mocked(mockDb["email-connection"]!.query).mockResolvedValue({
      items: [],
    });
    vi.mocked(mockDb["mcp-server"]!.query).mockResolvedValue({
      items: [
        {
          pk: `mcp-servers/${workspaceId}/server-1`,
          sk: "server",
          workspaceId,
          name: "Notion MCP",
          url: "https://mcp.example.com",
          authType: "oauth",
          serviceType: "notion",
          config: {
            accessToken: "secret-access-token",
            refreshToken: "secret-refresh-token",
            expiresAt: "2024-12-31T00:00:00Z",
            email: "user@example.com",
            // Non-sensitive field should be kept
            someOtherField: "value",
          },
          version: 1,
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          pk: `mcp-servers/${workspaceId}/server-2`,
          sk: "server",
          workspaceId,
          name: "Header Auth Server",
          url: "https://api.example.com",
          authType: "header",
          serviceType: "external",
          config: {
            headerValue: "Bearer secret-token",
            apiKey: "secret-api-key",
            // Non-sensitive field should be kept
            endpoint: "/api/v1",
          },
          version: 1,
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          pk: `mcp-servers/${workspaceId}/server-3`,
          sk: "server",
          workspaceId,
          name: "Basic Auth Server",
          url: "https://basic.example.com",
          authType: "basic",
          serviceType: "external",
          config: {
            username: "user",
            password: "secret-password",
            // Non-sensitive field should be kept
            timeout: 5000,
          },
          version: 1,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
      areAnyUnpublished: false,
    });
    vi.mocked(mockDb["bot-integration"]!.query).mockResolvedValue({
      items: [],
    });

    const result = await exportWorkspace(workspaceId);

    expect(result.mcpServers).toHaveLength(3);

    // OAuth server - should filter accessToken, refreshToken
    const oauthServer = result.mcpServers!.find((s) => s.name === "Notion MCP");
    expect(oauthServer).toBeDefined();
    expect(oauthServer!.config).not.toHaveProperty("accessToken");
    expect(oauthServer!.config).not.toHaveProperty("refreshToken");
    expect(oauthServer!.config).toHaveProperty("expiresAt"); // expiresAt is not a credential
    expect(oauthServer!.config).toHaveProperty("email");
    expect(oauthServer!.config).toHaveProperty("someOtherField");
    expect(
      (oauthServer!.config as Record<string, unknown>).someOtherField
    ).toBe("value");

    // Header auth server - should filter headerValue, apiKey
    const headerServer = result.mcpServers!.find(
      (s) => s.name === "Header Auth Server"
    );
    expect(headerServer).toBeDefined();
    expect(headerServer!.config).not.toHaveProperty("headerValue");
    expect(headerServer!.config).not.toHaveProperty("apiKey");
    expect(headerServer!.config).toHaveProperty("endpoint");
    expect((headerServer!.config as Record<string, unknown>).endpoint).toBe(
      "/api/v1"
    );

    // Basic auth server - should filter password
    const basicServer = result.mcpServers!.find(
      (s) => s.name === "Basic Auth Server"
    );
    expect(basicServer).toBeDefined();
    expect(basicServer!.config).toHaveProperty("username"); // username might be okay, but password isn't
    expect(basicServer!.config).not.toHaveProperty("password");
    expect(basicServer!.config).toHaveProperty("timeout");
    expect((basicServer!.config as Record<string, unknown>).timeout).toBe(5000);
  });
});
