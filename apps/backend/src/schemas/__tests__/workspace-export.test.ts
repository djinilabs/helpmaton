import { describe, it, expect } from "vitest";

import { workspaceExportSchema, type WorkspaceExport } from "../workspace-export";

describe("workspaceExportSchema", () => {
  describe("validation", () => {
    it("should validate a minimal workspace", () => {
      const minimal: WorkspaceExport = {
        id: "workspace-123",
        name: "Test Workspace",
        currency: "usd",
      };

      const result = workspaceExportSchema.safeParse(minimal);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe("workspace-123");
        expect(result.data.name).toBe("Test Workspace");
        expect(result.data.currency).toBe("usd");
      }
    });

    it("should validate a workspace with all optional fields", () => {
      const full: WorkspaceExport = {
        id: "workspace-123",
        name: "Test Workspace",
        description: "A test workspace",
        currency: "usd",
        spendingLimits: [
          {
            timeFrame: "daily",
            amount: 5000000,
          },
        ],
        agents: [
          {
            id: "agent-456",
            name: "Test Agent",
            systemPrompt: "You are a helpful assistant",
            provider: "openrouter",
            modelName: "gpt-4o",
          },
        ],
        outputChannels: [
          {
            id: "channel-789",
            channelId: "channel-789",
            type: "discord",
            name: "Discord Channel",
            config: { webhookUrl: "https://discord.com/webhook" },
          },
        ],
        emailConnections: [
          {
            id: "email-conn-1",
            type: "gmail",
            name: "Gmail Connection",
            config: { accessToken: "token" },
          },
        ],
        mcpServers: [
          {
            id: "mcp-server-1",
            name: "Notion MCP",
            authType: "oauth",
            serviceType: "notion",
            config: { accessToken: "token" },
          },
        ],
        botIntegrations: [
          {
            id: "bot-integration-1",
            agentId: "agent-456",
            platform: "discord",
            name: "Discord Bot",
            config: { botToken: "token" },
            webhookUrl: "https://example.com/webhook",
            status: "active",
          },
        ],
      };

      const result = workspaceExportSchema.safeParse(full);
      expect(result.success).toBe(true);
    });

    it("should validate workspace with named references (template format)", () => {
      const template: WorkspaceExport = {
        id: "{workspaceId}",
        name: "Template Workspace",
        currency: "usd",
        agents: [
          {
            id: "{mainAgent}",
            name: "Main Agent",
            systemPrompt: "You are a helpful assistant",
            provider: "openrouter",
            notificationChannelId: "{discordChannel}",
            delegatableAgentIds: ["{helperAgent}"],
            enabledMcpServerIds: ["{notionServer}"],
          },
        ],
        outputChannels: [
          {
            id: "{discordChannel}",
            channelId: "discord-123",
            type: "discord",
            name: "Discord Channel",
            config: {},
          },
        ],
        mcpServers: [
          {
            id: "{notionServer}",
            name: "Notion MCP",
            authType: "oauth",
            config: {},
          },
        ],
        botIntegrations: [
          {
            id: "{botIntegration}",
            agentId: "{mainAgent}",
            platform: "discord",
            name: "Discord Bot",
            config: {},
            webhookUrl: "https://example.com/webhook",
            status: "active",
          },
        ],
      };

      const result = workspaceExportSchema.safeParse(template);
      expect(result.success).toBe(true);
    });

    it("should validate agent with nested entities", () => {
      const workspace: WorkspaceExport = {
        id: "workspace-123",
        name: "Test Workspace",
        currency: "usd",
        agents: [
          {
            id: "agent-456",
            name: "Test Agent",
            systemPrompt: "You are a helpful assistant",
            provider: "openrouter",
            keys: [
              {
                id: "key-1",
                name: "Webhook Key",
                type: "webhook",
                provider: "google",
              },
              {
                id: "key-2",
                type: "widget",
                provider: "google",
              },
            ],
            evalJudges: [
              {
                id: "judge-1",
                name: "Quality Judge",
                enabled: true,
                samplingProbability: 100,
                provider: "openrouter",
                modelName: "gpt-4o",
                evalPrompt: "Evaluate the conversation quality",
              },
            ],
            streamServer: {
              secret: "stream-secret-123",
              allowedOrigins: ["https://example.com"],
            },
          },
        ],
      };

      const result = workspaceExportSchema.safeParse(workspace);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agents?.[0]?.keys).toHaveLength(2);
        expect(result.data.agents?.[0]?.evalJudges).toHaveLength(1);
        expect(result.data.agents?.[0]?.evalJudges?.[0]?.samplingProbability).toBe(
          100
        );
        expect(result.data.agents?.[0]?.streamServer).toBeDefined();
      }
    });

    it("should reject invalid workspace (missing required fields)", () => {
      const invalid = {
        // Missing id and name
        description: "Test",
      };

      const result = workspaceExportSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject invalid currency", () => {
      const invalid = {
        id: "workspace-123",
        name: "Test Workspace",
        currency: "eur", // Invalid, only "usd" allowed
      };

      const result = workspaceExportSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject invalid spending limit timeFrame", () => {
      const invalid = {
        id: "workspace-123",
        name: "Test Workspace",
        spendingLimits: [
          {
            timeFrame: "yearly", // Invalid
            amount: 1000000,
          },
        ],
      };

      const result = workspaceExportSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject invalid agent provider", () => {
      const invalid = {
        id: "workspace-123",
        name: "Test Workspace",
        agents: [
          {
            id: "agent-456",
            name: "Test Agent",
            systemPrompt: "You are helpful",
            provider: "invalid-provider", // Invalid
          },
        ],
      };

      const result = workspaceExportSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject invalid agent key type", () => {
      const invalid = {
        id: "workspace-123",
        name: "Test Workspace",
        agents: [
          {
            id: "agent-456",
            name: "Test Agent",
            systemPrompt: "You are helpful",
            keys: [
              {
                id: "key-1",
                type: "invalid-type", // Invalid
              },
            ],
          },
        ],
      };

      const result = workspaceExportSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject invalid eval judge provider", () => {
      const invalid = {
        id: "workspace-123",
        name: "Test Workspace",
        agents: [
          {
            id: "agent-456",
            name: "Test Agent",
            systemPrompt: "You are helpful",
            evalJudges: [
              {
                id: "judge-1",
                name: "Judge",
                provider: "openai", // Invalid, only "openrouter" allowed
                modelName: "gpt-4",
                evalPrompt: "Evaluate",
              },
            ],
          },
        ],
      };

      const result = workspaceExportSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject invalid bot integration platform", () => {
      const invalid = {
        id: "workspace-123",
        name: "Test Workspace",
        botIntegrations: [
          {
            id: "bot-1",
            agentId: "agent-456",
            platform: "telegram", // Invalid
            name: "Bot",
            config: {},
            webhookUrl: "https://example.com/webhook",
          },
        ],
      };

      const result = workspaceExportSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should validate agent with all optional fields", () => {
      const workspace: WorkspaceExport = {
        id: "workspace-123",
        name: "Test Workspace",
        currency: "usd",
        agents: [
          {
            id: "agent-456",
            name: "Test Agent",
            systemPrompt: "You are a helpful assistant",
            notificationChannelId: "channel-789",
            delegatableAgentIds: ["agent-789"],
            enabledMcpServerIds: ["mcp-server-1"],
            enableMemorySearch: true,
            enableSearchDocuments: true,
            enableKnowledgeInjection: true,
            knowledgeInjectionSnippetCount: 10,
            knowledgeInjectionMinSimilarity: 0.7,
            enableKnowledgeReranking: true,
            knowledgeRerankingModel: "gpt-4o",
            enableSendEmail: true,
            searchWebProvider: "tavily",
            fetchWebProvider: "jina",
            enableExaSearch: true,
            spendingLimits: [
              {
                timeFrame: "monthly",
                amount: 10000000,
              },
            ],
            temperature: 0.7,
            topP: 0.9,
            topK: 40,
            maxOutputTokens: 2000,
            stopSequences: ["STOP"],
            maxToolRoundtrips: 10,
            provider: "openrouter",
            modelName: "gpt-4o",
            clientTools: [
              {
                name: "getWeather",
                description: "Get weather for a location",
                parameters: {
                  type: "object",
                  properties: {
                    location: { type: "string" },
                  },
                },
              },
            ],
            widgetConfig: {
              enabled: true,
              allowedOrigins: ["https://example.com"],
              theme: "dark",
              position: "bottom-right",
            },
            avatar: "/images/avatar.svg",
          },
        ],
      };

      const result = workspaceExportSchema.safeParse(workspace);
      expect(result.success).toBe(true);
    });

    it("should validate email connection types", () => {
      const workspace: WorkspaceExport = {
        id: "workspace-123",
        name: "Test Workspace",
        currency: "usd",
        emailConnections: [
          {
            id: "email-1",
            type: "gmail",
            name: "Gmail",
            config: {},
          },
          {
            id: "email-2",
            type: "outlook",
            name: "Outlook",
            config: {},
          },
          {
            id: "email-3",
            type: "smtp",
            name: "SMTP",
            config: {},
          },
        ],
      };

      const result = workspaceExportSchema.safeParse(workspace);
      expect(result.success).toBe(true);
    });

    it("should validate MCP server auth types", () => {
      const workspace: WorkspaceExport = {
        id: "workspace-123",
        name: "Test Workspace",
        currency: "usd",
        mcpServers: [
          {
            id: "mcp-1",
            name: "Server 1",
            authType: "none",
            config: {},
          },
          {
            id: "mcp-2",
            name: "Server 2",
            authType: "header",
            config: {},
          },
          {
            id: "mcp-3",
            name: "Server 3",
            authType: "basic",
            config: {},
          },
          {
            id: "mcp-4",
            name: "Server 4",
            authType: "oauth",
            config: {},
          },
        ],
      };

      const result = workspaceExportSchema.safeParse(workspace);
      expect(result.success).toBe(true);
    });

    it("should validate MCP server service types", () => {
      const workspace: WorkspaceExport = {
        id: "workspace-123",
        name: "Test Workspace",
        currency: "usd",
        mcpServers: [
          {
            id: "mcp-1",
            name: "External",
            authType: "none",
            serviceType: "external",
            config: {},
          },
          {
            id: "mcp-2",
            name: "Google Drive",
            authType: "oauth",
            serviceType: "google-drive",
            config: {},
          },
          {
            id: "mcp-3",
            name: "Gmail",
            authType: "oauth",
            serviceType: "gmail",
            config: {},
          },
          {
            id: "mcp-4",
            name: "Google Calendar",
            authType: "oauth",
            serviceType: "google-calendar",
            config: {},
          },
          {
            id: "mcp-5",
            name: "Notion",
            authType: "oauth",
            serviceType: "notion",
            config: {},
          },
          {
            id: "mcp-6",
            name: "Linear",
            authType: "oauth",
            serviceType: "linear",
            config: {},
          },
          {
            id: "mcp-7",
            name: "Intercom",
            authType: "oauth",
            serviceType: "intercom",
            config: {},
          },
          {
            id: "mcp-8",
            name: "Zendesk",
            authType: "oauth",
            serviceType: "zendesk",
            config: {},
          },
        ],
      };

      const result = workspaceExportSchema.safeParse(workspace);
      expect(result.success).toBe(true);
    });
  });

  describe("reference format", () => {
    it("should accept actual IDs", () => {
      const workspace: WorkspaceExport = {
        id: "workspace-123",
        name: "Test",
        currency: "usd",
        agents: [
          {
            id: "agent-456",
            name: "Agent",
            systemPrompt: "Test",
            provider: "openrouter",
          },
        ],
      };

      const result = workspaceExportSchema.safeParse(workspace);
      expect(result.success).toBe(true);
    });

    it("should accept named references", () => {
      const workspace: WorkspaceExport = {
        id: "{workspaceId}",
        name: "Test",
        currency: "usd",
        agents: [
          {
            id: "{agentId}",
            name: "Agent",
            systemPrompt: "Test",
            provider: "openrouter",
            notificationChannelId: "{channelId}",
            delegatableAgentIds: ["{agent1}", "{agent2}"],
            enabledMcpServerIds: ["{mcpServer}"],
          },
        ],
      };

      const result = workspaceExportSchema.safeParse(workspace);
      expect(result.success).toBe(true);
    });

    it("should accept mixed actual IDs and references in arrays", () => {
      const workspace: WorkspaceExport = {
        id: "workspace-123",
        name: "Test",
        currency: "usd",
        agents: [
          {
            id: "agent-456",
            name: "Agent",
            systemPrompt: "Test",
            provider: "openrouter",
            delegatableAgentIds: ["agent-789", "{newAgent}"],
            enabledMcpServerIds: ["mcp-1", "{newMcp}"],
          },
        ],
      };

      const result = workspaceExportSchema.safeParse(workspace);
      expect(result.success).toBe(true);
    });
  });
});
