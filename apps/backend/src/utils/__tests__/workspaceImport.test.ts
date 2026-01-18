import { describe, it, expect, vi, beforeEach } from "vitest";


import type { WorkspaceExport } from "../../schemas/workspace-export";
import { importWorkspace } from "../workspaceImport";

// Mock dependencies
vi.mock("../../tables", () => ({
  database: vi.fn(),
}));

vi.mock("../../tables/permissions", () => ({
  ensureAuthorization: vi.fn(),
}));

vi.mock("../subscriptionUtils", () => ({
  getUserSubscription: vi.fn(),
  ensureWorkspaceSubscription: vi.fn(),
  checkSubscriptionLimits: vi.fn(),
}));

vi.mock("../streamServerUtils", () => ({
  createStreamServerConfig: vi.fn(),
}));

describe("importWorkspace", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock database type
  let mockDb: any;
  const userRef = "users/user-123";

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create mock database with all required methods
    mockDb = {
      workspace: {
        create: vi.fn(),
        get: vi.fn(),
      },
      agent: {
        create: vi.fn(),
      },
      "agent-key": {
        create: vi.fn(),
      },
      "agent-eval-judge": {
        create: vi.fn(),
      },
      "agent-stream-servers": {
        create: vi.fn(),
      },
      output_channel: {
        create: vi.fn(),
      },
      "email-connection": {
        create: vi.fn(),
        get: vi.fn(),
      },
      "mcp-server": {
        create: vi.fn(),
      },
      "bot-integration": {
        create: vi.fn(),
      },
    };

    const { database } = await import("../../tables");
    vi.mocked(database).mockResolvedValue(mockDb);

    // Mock subscription utilities
    const { getUserSubscription, ensureWorkspaceSubscription, checkSubscriptionLimits } =
      await import("../subscriptionUtils");
     
     
    vi.mocked(getUserSubscription).mockResolvedValue({
      pk: "subscriptions/sub-123",
      sk: "subscription",
      userId: "user-123",
      plan: "free",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock subscription type
    } as any);
    vi.mocked(ensureWorkspaceSubscription).mockResolvedValue("sub-123");
    vi.mocked(checkSubscriptionLimits).mockResolvedValue(undefined);

    // Mock permissions
    const { ensureAuthorization } = await import("../../tables/permissions");
    vi.mocked(ensureAuthorization).mockResolvedValue(undefined);

    // Mock stream server utils
    const { createStreamServerConfig } = await import("../streamServerUtils");
     
     
    vi.mocked(createStreamServerConfig).mockResolvedValue({
      pk: "stream-servers/workspace-123/agent-456",
      sk: "config",
      workspaceId: "workspace-123",
      agentId: "agent-456",
      secret: "secret-123",
      allowedOrigins: ["*"],
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock subscription type
    } as any);

    // Set environment variables for webhook URL generation
    process.env.ARC_ENV = "testing";
    process.env.BASE_URL = "http://localhost:3000";
  });

  it("should import a minimal workspace", async () => {
    const exportData: WorkspaceExport = {
      id: "{workspaceId}",
      name: "Imported Workspace",
      currency: "usd",
    };

    mockDb.workspace.create.mockResolvedValue({
      pk: "workspaces/new-workspace-id",
      sk: "workspace",
      name: "Imported Workspace",
      currency: "usd",
      creditBalance: 0,
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    const workspaceId = await importWorkspace(exportData, userRef);

    expect(workspaceId).toBeDefined();
    expect(mockDb.workspace.create).toHaveBeenCalledTimes(1);
    expect(mockDb.workspace.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Imported Workspace",
        currency: "usd",
        creditBalance: 0,
      })
    );
  });

  it("should import workspace with output channels", async () => {
    const exportData: WorkspaceExport = {
      id: "{workspaceId}",
      name: "Imported Workspace",
      currency: "usd",
      outputChannels: [
        {
          id: "{discordChannel}",
          channelId: "discord-123",
          type: "discord",
          name: "Discord Channel",
          config: {
            botToken: "token-123",
            discordChannelId: "channel-123",
          },
        },
      ],
    };

    mockDb.workspace.create.mockResolvedValue({
      pk: "workspaces/new-workspace-id",
      sk: "workspace",
      name: "Imported Workspace",
      currency: "usd",
      creditBalance: 0,
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    mockDb["output_channel"].create.mockResolvedValue({
      pk: "output-channels/workspace-id/channel-id",
      sk: "channel",
      workspaceId: "workspace-id",
      channelId: "channel-id",
      type: "discord",
      name: "Discord Channel",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    const workspaceId = await importWorkspace(exportData, userRef);

    expect(workspaceId).toBeDefined();
    expect(mockDb["output_channel"].create).toHaveBeenCalledTimes(1);
    expect(mockDb["output_channel"].create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "discord",
        name: "Discord Channel",
        config: {
          botToken: "token-123",
          discordChannelId: "channel-123",
        },
      })
    );
  });

  it("should import workspace with agents and nested entities", async () => {
    const exportData: WorkspaceExport = {
      id: "{workspaceId}",
      name: "Imported Workspace",
      currency: "usd",
      agents: [
        {
          id: "{mainAgent}",
          name: "Main Agent",
          systemPrompt: "You are helpful",
          provider: "openrouter",
          modelName: "gpt-4o",
          keys: [
            {
              id: "{agentKey}",
              name: "Webhook Key",
              type: "webhook",
              provider: "google",
            },
          ],
          evalJudges: [
            {
              id: "{judge}",
              name: "Quality Judge",
              enabled: true,
              samplingProbability: 25,
              provider: "openrouter",
              modelName: "gpt-4o",
              evalPrompt: "Evaluate the response",
            },
          ],
          streamServer: {
            secret: "secret-123",
            allowedOrigins: ["*"],
          },
        },
      ],
    };

    mockDb.workspace.create.mockResolvedValue({
      pk: "workspaces/new-workspace-id",
      sk: "workspace",
      name: "Imported Workspace",
      currency: "usd",
      creditBalance: 0,
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    mockDb.agent.create.mockResolvedValue({
      pk: "agents/workspace-id/agent-id",
      sk: "agent",
      workspaceId: "workspace-id",
      name: "Main Agent",
      systemPrompt: "You are helpful",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    mockDb["agent-key"].create.mockResolvedValue({
      pk: "agent-keys/workspace-id/agent-id/key-id",
      sk: "key",
      workspaceId: "workspace-id",
      agentId: "agent-id",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

     
    mockDb["agent-eval-judge"].create.mockResolvedValue({
      pk: "agent-eval-judges/workspace-id/agent-id/judge-id",
      sk: "judge",
      workspaceId: "workspace-id",
      agentId: "agent-id",
      judgeId: "judge-id",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    const workspaceId = await importWorkspace(exportData, userRef);

    expect(workspaceId).toBeDefined();
    expect(mockDb.agent.create).toHaveBeenCalledTimes(1);
    expect(mockDb["agent-key"].create).toHaveBeenCalledTimes(1);
    expect(mockDb["agent-eval-judge"].create).toHaveBeenCalledTimes(1);
    expect(mockDb["agent-eval-judge"].create).toHaveBeenCalledWith(
      expect.objectContaining({
        samplingProbability: 25,
      })
    );
    const { createStreamServerConfig } = await import("../streamServerUtils");
    expect(createStreamServerConfig).toHaveBeenCalledTimes(1);
  });

  it("should resolve cross-references between entities", async () => {
    const exportData: WorkspaceExport = {
      id: "{workspaceId}",
      name: "Imported Workspace",
      currency: "usd",
      outputChannels: [
        {
          id: "{discordChannel}",
          channelId: "discord-123",
          type: "discord",
          name: "Discord Channel",
          config: {
            botToken: "token-123",
            discordChannelId: "channel-123",
          },
        },
      ],
      mcpServers: [
        {
          id: "{notionServer}",
          name: "Notion MCP",
          authType: "oauth",
          serviceType: "notion",
          config: {},
        },
      ],
      agents: [
        {
          id: "{mainAgent}",
          name: "Main Agent",
          systemPrompt: "You are helpful",
          provider: "openrouter",
          notificationChannelId: "{discordChannel}",
          enabledMcpServerIds: ["{notionServer}"],
          delegatableAgentIds: ["{helperAgent}"],
        },
        {
          id: "{helperAgent}",
          name: "Helper Agent",
          systemPrompt: "I help",
          provider: "openrouter",
        },
      ],
    };

    mockDb.workspace.create.mockResolvedValue({
      pk: "workspaces/new-workspace-id",
      sk: "workspace",
      name: "Imported Workspace",
      currency: "usd",
      creditBalance: 0,
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    mockDb["output_channel"].create.mockResolvedValue({
      pk: "output-channels/workspace-id/channel-id",
      sk: "channel",
      workspaceId: "workspace-id",
      channelId: "channel-id",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    mockDb["mcp-server"].create.mockResolvedValue({
      pk: "mcp-servers/workspace-id/server-id",
      sk: "server",
      workspaceId: "workspace-id",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    mockDb.agent.create.mockResolvedValue({
      pk: "agents/workspace-id/agent-id",
      sk: "agent",
      workspaceId: "workspace-id",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    const workspaceId = await importWorkspace(exportData, userRef);

    expect(workspaceId).toBeDefined();
    expect(mockDb.agent.create).toHaveBeenCalledTimes(2);
    
    // Check that the first agent has resolved references
    const firstAgentCall = mockDb.agent.create.mock.calls[0][0];
    expect(firstAgentCall.notificationChannelId).toBeDefined();
    expect(firstAgentCall.enabledMcpServerIds).toBeDefined();
    expect(firstAgentCall.enabledMcpServerIds).toHaveLength(1);
    expect(firstAgentCall.delegatableAgentIds).toBeDefined();
    expect(firstAgentCall.delegatableAgentIds).toHaveLength(1);
  });

  it("should import workspace with bot integrations", async () => {
    const exportData: WorkspaceExport = {
      id: "{workspaceId}",
      name: "Imported Workspace",
      currency: "usd",
      agents: [
        {
          id: "{mainAgent}",
          name: "Main Agent",
          systemPrompt: "You are helpful",
          provider: "openrouter",
        },
      ],
      botIntegrations: [
        {
          id: "{slackIntegration}",
          agentId: "{mainAgent}",
          platform: "slack",
          name: "Slack Integration",
          config: {
            botToken: "token-123",
            signingSecret: "secret-123",
          },
          webhookUrl: "https://example.com/webhook",
          status: "active",
        },
      ],
    };

    mockDb.workspace.create.mockResolvedValue({
      pk: "workspaces/new-workspace-id",
      sk: "workspace",
      name: "Imported Workspace",
      currency: "usd",
      creditBalance: 0,
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    mockDb.agent.create.mockResolvedValue({
      pk: "agents/workspace-id/agent-id",
      sk: "agent",
      workspaceId: "workspace-id",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    mockDb["bot-integration"].create.mockResolvedValue({
      pk: "bot-integrations/workspace-id/integration-id",
      sk: "integration",
      workspaceId: "workspace-id",
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    const workspaceId = await importWorkspace(exportData, userRef);

    expect(workspaceId).toBeDefined();
    expect(mockDb["bot-integration"].create).toHaveBeenCalledTimes(1);
    const integrationCall = mockDb["bot-integration"].create.mock.calls[0][0];
    expect(integrationCall.agentId).toBeDefined();
    expect(integrationCall.platform).toBe("slack");
    expect(integrationCall.webhookUrl).toContain("/api/webhooks/slack/");
  });

  it("should throw error for invalid notification channel reference", async () => {
    const exportData: WorkspaceExport = {
      id: "{workspaceId}",
      name: "Imported Workspace",
      currency: "usd",
      agents: [
        {
          id: "{mainAgent}",
          name: "Main Agent",
          systemPrompt: "You are helpful",
          provider: "openrouter",
          notificationChannelId: "{nonexistentChannel}",
        },
      ],
    };

    mockDb.workspace.create.mockResolvedValue({
      pk: "workspaces/new-workspace-id",
      sk: "workspace",
      name: "Imported Workspace",
      currency: "usd",
      creditBalance: 0,
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    await expect(importWorkspace(exportData, userRef)).rejects.toThrow();
  });

  it("should throw error for invalid delegatable agent reference", async () => {
    const exportData: WorkspaceExport = {
      id: "{workspaceId}",
      name: "Imported Workspace",
      currency: "usd",
      agents: [
        {
          id: "{mainAgent}",
          name: "Main Agent",
          systemPrompt: "You are helpful",
          provider: "openrouter",
          delegatableAgentIds: ["{nonexistentAgent}"],
        },
      ],
    };

    mockDb.workspace.create.mockResolvedValue({
      pk: "workspaces/new-workspace-id",
      sk: "workspace",
      name: "Imported Workspace",
      currency: "usd",
      creditBalance: 0,
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    await expect(importWorkspace(exportData, userRef)).rejects.toThrow();
  });

  it("should validate subscription limits before creating entities", async () => {
    const exportData: WorkspaceExport = {
      id: "{workspaceId}",
      name: "Imported Workspace",
      currency: "usd",
      agents: [
        {
          id: "{agent1}",
          name: "Agent 1",
          systemPrompt: "You are helpful",
          provider: "openrouter",
        },
        {
          id: "{agent2}",
          name: "Agent 2",
          systemPrompt: "You are helpful",
          provider: "openrouter",
        },
      ],
    };

    const { checkSubscriptionLimits } = await import("../subscriptionUtils");

    mockDb.workspace.create.mockResolvedValue({
      pk: "workspaces/new-workspace-id",
      sk: "workspace",
      name: "Imported Workspace",
      currency: "usd",
      creditBalance: 0,
      version: 1,
      createdAt: "2024-01-01T00:00:00Z",
    });

    await importWorkspace(exportData, userRef);

    // Verify subscription limits were checked
    expect(checkSubscriptionLimits).toHaveBeenCalledWith(
      "sub-123",
      "workspace",
      1
    );
    expect(checkSubscriptionLimits).toHaveBeenCalledWith(
      "sub-123",
      "agent",
      2
    );
  });
});
