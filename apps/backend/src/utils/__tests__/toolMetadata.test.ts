import { describe, it, expect } from "vitest";

import {
  generateToolList,
  type ToolListOptions,
  type McpServerInfo,
} from "../toolMetadata";

describe("toolMetadata", () => {
  describe("generateToolList", () => {
    const baseOptions: ToolListOptions = {
      agent: {
        enableSearchDocuments: false,
        enableMemorySearch: false,
        enableSendEmail: false,
        searchWebProvider: null,
        fetchWebProvider: null,
        enableExaSearch: false,
        delegatableAgentIds: [],
        enabledMcpServerIds: [],
        clientTools: [],
      },
      workspaceId: "workspace-123",
      enabledMcpServers: [],
      emailConnection: false,
    };

    it("should always include get_datetime tool", () => {
      const result = generateToolList(baseOptions);

      const coreToolsGroup = result.find((g) => g.category === "Core Tools");
      expect(coreToolsGroup).toBeDefined();
      expect(coreToolsGroup?.tools).toHaveLength(1);
      expect(coreToolsGroup?.tools[0].name).toBe("get_datetime");
      expect(coreToolsGroup?.tools[0].alwaysAvailable).toBe(true);
    });

    it("should include search_documents when enableSearchDocuments is true", () => {
      const options: ToolListOptions = {
        ...baseOptions,
        agent: {
          ...baseOptions.agent,
          enableSearchDocuments: true,
        },
      };

      const result = generateToolList(options);

      const docToolsGroup = result.find((g) => g.category === "Document Tools");
      expect(docToolsGroup).toBeDefined();
      const searchDocTool = docToolsGroup?.tools.find(
        (t) => t.name === "search_documents"
      );
      expect(searchDocTool).toBeDefined();
      expect(searchDocTool?.alwaysAvailable).toBe(false);
      expect(searchDocTool?.condition).toContain("Available");
    });

    it("should not include search_documents when enableSearchDocuments is false", () => {
      const result = generateToolList(baseOptions);

      const docToolsGroup = result.find((g) => g.category === "Document Tools");
      if (docToolsGroup) {
        const searchDocTool = docToolsGroup.tools.find(
          (t) => t.name === "search_documents"
        );
        // Tool is included but marked as not available
        if (searchDocTool) {
          expect(searchDocTool.condition).toContain("Not available");
        }
      }
    });

    it("should include search_memory when enableMemorySearch is true", () => {
      const options: ToolListOptions = {
        ...baseOptions,
        agent: {
          ...baseOptions.agent,
          enableMemorySearch: true,
        },
      };

      const result = generateToolList(options);

      // Memory tools are in "Memory Tools" category when enabled, or "Document Tools" when not enabled
      const memoryToolsGroup = result.find(
        (g) => g.category === "Memory Tools"
      );
      if (!memoryToolsGroup) {
        // Check Document Tools category as fallback
        const docToolsGroup = result.find(
          (g) => g.category === "Document Tools"
        );
        expect(docToolsGroup).toBeDefined();
        const searchMemoryTool = docToolsGroup?.tools.find(
          (t) => t.name === "search_memory"
        );
        expect(searchMemoryTool).toBeDefined();
        expect(searchMemoryTool?.condition).toContain("Available");
      } else {
        const searchMemoryTool = memoryToolsGroup.tools.find(
          (t) => t.name === "search_memory"
        );
        expect(searchMemoryTool).toBeDefined();
        expect(searchMemoryTool?.alwaysAvailable).toBe(false);
        expect(searchMemoryTool?.condition).toContain("Available");
      }
    });

    it("should include send_notification when notificationChannelId is set", () => {
      const options: ToolListOptions = {
        ...baseOptions,
        agent: {
          ...baseOptions.agent,
          notificationChannelId: "channel-123",
        },
      };

      const result = generateToolList(options);

      const commToolsGroup = result.find(
        (g) => g.category === "Communication Tools"
      );
      expect(commToolsGroup).toBeDefined();
      const sendNotifTool = commToolsGroup?.tools.find(
        (t) => t.name === "send_notification"
      );
      expect(sendNotifTool).toBeDefined();
      expect(sendNotifTool?.alwaysAvailable).toBe(false);
      expect(sendNotifTool?.condition).toContain("Available");
    });

    it("should include send_email when enableSendEmail is true and emailConnection exists", () => {
      const options: ToolListOptions = {
        ...baseOptions,
        agent: {
          ...baseOptions.agent,
          enableSendEmail: true,
        },
        emailConnection: true,
      };

      const result = generateToolList(options);

      const commToolsGroup = result.find(
        (g) => g.category === "Communication Tools"
      );
      expect(commToolsGroup).toBeDefined();
      const sendEmailTool = commToolsGroup?.tools.find(
        (t) => t.name === "send_email"
      );
      expect(sendEmailTool).toBeDefined();
      expect(sendEmailTool?.alwaysAvailable).toBe(false);
      expect(sendEmailTool?.condition).toContain("Available");
    });

    it("should not include send_email when emailConnection is false", () => {
      const options: ToolListOptions = {
        ...baseOptions,
        agent: {
          ...baseOptions.agent,
          enableSendEmail: true,
        },
        emailConnection: false,
      };

      const result = generateToolList(options);

      const commToolsGroup = result.find(
        (g) => g.category === "Communication Tools"
      );
      if (commToolsGroup) {
        const sendEmailTool = commToolsGroup.tools.find(
          (t) => t.name === "send_email"
        );
        // Tool is included but marked as not available
        if (sendEmailTool) {
          expect(sendEmailTool.condition).toContain("Not available");
        }
      }
    });

    it("should include web search tools when searchWebProvider is tavily", () => {
      const options: ToolListOptions = {
        ...baseOptions,
        agent: {
          ...baseOptions.agent,
          searchWebProvider: "tavily",
        },
      };

      const result = generateToolList(options);

      const webToolsGroup = result.find((g) => g.category === "Web Tools");
      expect(webToolsGroup).toBeDefined();
      const searchWebTool = webToolsGroup?.tools.find(
        (t) => t.name === "search_web"
      );
      expect(searchWebTool).toBeDefined();
      expect(searchWebTool?.condition).toContain("Tavily");
    });

    it("should include web search tools when searchWebProvider is jina", () => {
      const options: ToolListOptions = {
        ...baseOptions,
        agent: {
          ...baseOptions.agent,
          searchWebProvider: "jina",
        },
      };

      const result = generateToolList(options);

      const webToolsGroup = result.find((g) => g.category === "Web Tools");
      expect(webToolsGroup).toBeDefined();
      const searchWebTool = webToolsGroup?.tools.find(
        (t) => t.name === "search_web"
      );
      expect(searchWebTool).toBeDefined();
      expect(searchWebTool?.condition).toContain("Jina");
    });

    it("should include fetch_url when fetchWebProvider is set", () => {
      const options: ToolListOptions = {
        ...baseOptions,
        agent: {
          ...baseOptions.agent,
          fetchWebProvider: "tavily",
        },
      };

      const result = generateToolList(options);

      const webToolsGroup = result.find((g) => g.category === "Web Tools");
      expect(webToolsGroup).toBeDefined();
      const fetchUrlTool = webToolsGroup?.tools.find(
        (t) => t.name === "fetch_url"
      );
      expect(fetchUrlTool).toBeDefined();
    });

    it("should include delegation tools when delegatableAgentIds is not empty", () => {
      const options: ToolListOptions = {
        ...baseOptions,
        agent: {
          ...baseOptions.agent,
          delegatableAgentIds: ["agent-1", "agent-2"],
        },
      };

      const result = generateToolList(options);

      const delegationGroup = result.find(
        (g) => g.category === "Delegation Tools"
      );
      expect(delegationGroup).toBeDefined();
      expect(delegationGroup?.tools.length).toBeGreaterThan(0);

      const listAgentsTool = delegationGroup?.tools.find(
        (t) => t.name === "list_agents"
      );
      expect(listAgentsTool).toBeDefined();

      const callAgentTool = delegationGroup?.tools.find(
        (t) => t.name === "call_agent"
      );
      expect(callAgentTool).toBeDefined();
    });

    it("should include client tools when clientTools array is not empty", () => {
      const options: ToolListOptions = {
        ...baseOptions,
        agent: {
          ...baseOptions.agent,
          clientTools: [
            {
              name: "custom_tool",
              description: "A custom client tool",
              parameters: {
                type: "object",
                properties: {
                  param1: {
                    type: "string",
                    description: "First parameter",
                  },
                },
                required: ["param1"],
              },
            },
          ],
        },
      };

      const result = generateToolList(options);

      const clientToolsGroup = result.find(
        (g) => g.category === "Client Tools"
      );
      expect(clientToolsGroup).toBeDefined();
      expect(clientToolsGroup?.tools).toHaveLength(1);
      expect(clientToolsGroup?.tools[0].name).toBe("custom_tool");
      expect(clientToolsGroup?.tools[0].description).toBe(
        "A custom client tool"
      );
      expect(clientToolsGroup?.tools[0].alwaysAvailable).toBe(true);
      expect(clientToolsGroup?.tools[0].parameters).toHaveLength(1);
      expect(clientToolsGroup?.tools[0].parameters[0].name).toBe("param1");
      expect(clientToolsGroup?.tools[0].parameters[0].required).toBe(true);
    });

    describe("MCP Server Tools", () => {
      it("should include Google Drive tools when OAuth-connected server is enabled", () => {
        const mcpServers: McpServerInfo[] = [
          {
            id: "server-1",
            name: "My Google Drive",
            serviceType: "google-drive",
            authType: "oauth",
            oauthConnected: true,
          },
        ];

        const options: ToolListOptions = {
          ...baseOptions,
          agent: {
            ...baseOptions.agent,
            enabledMcpServerIds: ["server-1"],
          },
          enabledMcpServers: mcpServers,
        };

        const result = generateToolList(options);

        const mcpGroup = result.find((g) => g.category === "MCP Server Tools");
        expect(mcpGroup).toBeDefined();

        const driveTools = mcpGroup?.tools.filter((t) =>
          t.name.startsWith("google_drive_")
        );
        expect(driveTools?.length).toBeGreaterThan(0);
        expect(driveTools?.some((t) => t.name === "google_drive_list")).toBe(
          true
        );
        expect(driveTools?.some((t) => t.name === "google_drive_read")).toBe(
          true
        );
        expect(driveTools?.some((t) => t.name === "google_drive_search")).toBe(
          true
        );
      });

      it("should not include Google Drive tools when OAuth is not connected", () => {
        const mcpServers: McpServerInfo[] = [
          {
            id: "server-1",
            name: "My Google Drive",
            serviceType: "google-drive",
            authType: "oauth",
            oauthConnected: false,
          },
        ];

        const options: ToolListOptions = {
          ...baseOptions,
          agent: {
            ...baseOptions.agent,
            enabledMcpServerIds: ["server-1"],
          },
          enabledMcpServers: mcpServers,
        };

        const result = generateToolList(options);

        const mcpGroup = result.find((g) => g.category === "MCP Server Tools");
        // Looking at generateToolList line 1943, it only calls getMcpServerToolMetadata when oauthConnected === true
        // So when oauthConnected is false, tools should NOT be generated at all
        if (mcpGroup) {
          const driveTools = mcpGroup.tools.filter((t) =>
            t.name.startsWith("google_drive_")
          );
          expect(driveTools).toHaveLength(0);
        }
        // If no tools are generated, mcpGroup might be undefined, which is also valid
      });

      it("should include GitHub tools when OAuth-connected server is enabled", () => {
        const mcpServers: McpServerInfo[] = [
          {
            id: "server-1",
            name: "My GitHub",
            serviceType: "github",
            authType: "oauth",
            oauthConnected: true,
          },
        ];

        const options: ToolListOptions = {
          ...baseOptions,
          agent: {
            ...baseOptions.agent,
            enabledMcpServerIds: ["server-1"],
          },
          enabledMcpServers: mcpServers,
        };

        const result = generateToolList(options);

        const mcpGroup = result.find((g) => g.category === "MCP Server Tools");
        expect(mcpGroup).toBeDefined();

        const githubTools = mcpGroup?.tools.filter((t) =>
          t.name.startsWith("github_")
        );
        expect(githubTools?.length).toBeGreaterThan(0);
        // Check for actual GitHub tool names from the implementation
        expect(githubTools?.some((t) => t.name === "github_list_repos")).toBe(
          true
        );
        expect(githubTools?.some((t) => t.name === "github_get_repo")).toBe(
          true
        );
      });

      it("should include Linear tools when OAuth-connected server is enabled", () => {
        const mcpServers: McpServerInfo[] = [
          {
            id: "server-1",
            name: "My Linear",
            serviceType: "linear",
            authType: "oauth",
            oauthConnected: true,
          },
        ];

        const options: ToolListOptions = {
          ...baseOptions,
          agent: {
            ...baseOptions.agent,
            enabledMcpServerIds: ["server-1"],
          },
          enabledMcpServers: mcpServers,
        };

        const result = generateToolList(options);

        const mcpGroup = result.find((g) => g.category === "MCP Server Tools");
        expect(mcpGroup).toBeDefined();

        const linearTools = mcpGroup?.tools.filter((t) =>
          t.name.startsWith("linear_")
        );
        expect(linearTools?.length).toBeGreaterThan(0);
        expect(linearTools?.some((t) => t.name === "linear_list_teams")).toBe(
          true
        );
        expect(linearTools?.some((t) => t.name === "linear_get_issue")).toBe(
          true
        );
      });

      it("should include HubSpot tools when OAuth-connected server is enabled", () => {
        const mcpServers: McpServerInfo[] = [
          {
            id: "server-1",
            name: "My HubSpot",
            serviceType: "hubspot",
            authType: "oauth",
            oauthConnected: true,
          },
        ];

        const options: ToolListOptions = {
          ...baseOptions,
          agent: {
            ...baseOptions.agent,
            enabledMcpServerIds: ["server-1"],
          },
          enabledMcpServers: mcpServers,
        };

        const result = generateToolList(options);

        const mcpGroup = result.find((g) => g.category === "MCP Server Tools");
        expect(mcpGroup).toBeDefined();

        const hubspotTools = mcpGroup?.tools.filter((t) =>
          t.name.startsWith("hubspot_")
        );
        expect(hubspotTools?.length).toBeGreaterThan(0);
        expect(
          hubspotTools?.some((t) => t.name === "hubspot_list_contacts")
        ).toBe(true);
        expect(
          hubspotTools?.some((t) => t.name === "hubspot_get_deal")
        ).toBe(true);
      });

      it("should include Intercom tools when OAuth-connected server is enabled", () => {
        const mcpServers: McpServerInfo[] = [
          {
            id: "server-1",
            name: "My Intercom",
            serviceType: "intercom",
            authType: "oauth",
            oauthConnected: true,
          },
        ];

        const options: ToolListOptions = {
          ...baseOptions,
          agent: {
            ...baseOptions.agent,
            enabledMcpServerIds: ["server-1"],
          },
          enabledMcpServers: mcpServers,
        };

        const result = generateToolList(options);

        const mcpGroup = result.find((g) => g.category === "MCP Server Tools");
        expect(mcpGroup).toBeDefined();

        const intercomTools = mcpGroup?.tools.filter((t) =>
          t.name.startsWith("intercom_")
        );
        expect(intercomTools?.length).toBeGreaterThan(0);
        expect(
          intercomTools?.some((t) => t.name === "intercom_list_contacts")
        ).toBe(true);
        expect(
          intercomTools?.some((t) => t.name === "intercom_reply_conversation")
        ).toBe(true);
      });

      it("should include Salesforce tools when OAuth-connected server is enabled", () => {
        const mcpServers: McpServerInfo[] = [
          {
            id: "server-1",
            name: "My Salesforce",
            serviceType: "salesforce",
            authType: "oauth",
            oauthConnected: true,
          },
        ];

        const options: ToolListOptions = {
          ...baseOptions,
          agent: {
            ...baseOptions.agent,
            enabledMcpServerIds: ["server-1"],
          },
          enabledMcpServers: mcpServers,
        };

        const result = generateToolList(options);

        const mcpGroup = result.find((g) => g.category === "MCP Server Tools");
        expect(mcpGroup).toBeDefined();

        const salesforceTools = mcpGroup?.tools.filter((t) =>
          t.name.startsWith("salesforce_")
        );
        expect(salesforceTools?.length).toBeGreaterThan(0);
        expect(
          salesforceTools?.some((t) => t.name === "salesforce_list_objects")
        ).toBe(true);
        expect(
          salesforceTools?.some((t) => t.name === "salesforce_query")
        ).toBe(true);
      });

      it("should include Slack tools when OAuth-connected server is enabled", () => {
        const mcpServers: McpServerInfo[] = [
          {
            id: "server-1",
            name: "My Slack",
            serviceType: "slack",
            authType: "oauth",
            oauthConnected: true,
          },
        ];

        const options: ToolListOptions = {
          ...baseOptions,
          agent: {
            ...baseOptions.agent,
            enabledMcpServerIds: ["server-1"],
          },
          enabledMcpServers: mcpServers,
        };

        const result = generateToolList(options);

        const mcpGroup = result.find((g) => g.category === "MCP Server Tools");
        expect(mcpGroup).toBeDefined();

        const slackTools = mcpGroup?.tools.filter((t) =>
          t.name.startsWith("slack_")
        );
        expect(slackTools?.length).toBeGreaterThan(0);
        expect(
          slackTools?.some((t) => t.name === "slack_list_channels")
        ).toBe(true);
        expect(
          slackTools?.some((t) => t.name === "slack_post_message")
        ).toBe(true);
      });

      it("should include Stripe tools when OAuth-connected server is enabled", () => {
        const mcpServers: McpServerInfo[] = [
          {
            id: "server-1",
            name: "My Stripe",
            serviceType: "stripe",
            authType: "oauth",
            oauthConnected: true,
          },
        ];

        const options: ToolListOptions = {
          ...baseOptions,
          agent: {
            ...baseOptions.agent,
            enabledMcpServerIds: ["server-1"],
          },
          enabledMcpServers: mcpServers,
        };

        const result = generateToolList(options);

        const mcpGroup = result.find((g) => g.category === "MCP Server Tools");
        expect(mcpGroup).toBeDefined();

        const stripeTools = mcpGroup?.tools.filter((t) =>
          t.name.startsWith("stripe_")
        );
        expect(stripeTools?.length).toBeGreaterThan(0);
        expect(
          stripeTools?.some((t) => t.name === "stripe_search_charges")
        ).toBe(true);
        expect(
          stripeTools?.some((t) => t.name === "stripe_get_metrics")
        ).toBe(true);
      });

      it("should include PostHog tools when PostHog server is enabled", () => {
        const mcpServers: McpServerInfo[] = [
          {
            id: "server-1",
            name: "My PostHog",
            serviceType: "posthog",
            authType: "header",
            oauthConnected: false,
          },
        ];

        const options: ToolListOptions = {
          ...baseOptions,
          agent: {
            ...baseOptions.agent,
            enabledMcpServerIds: ["server-1"],
          },
          enabledMcpServers: mcpServers,
        };

        const result = generateToolList(options);

        const mcpGroup = result.find((g) => g.category === "MCP Server Tools");
        expect(mcpGroup).toBeDefined();

        const posthogTools = mcpGroup?.tools.filter((t) =>
          t.name.startsWith("posthog_")
        );
        expect(posthogTools?.length).toBeGreaterThan(0);
        expect(
          posthogTools?.some((t) => t.name === "posthog_list_projects")
        ).toBe(true);
        expect(
          posthogTools?.some((t) => t.name === "posthog_get_project")
        ).toBe(true);
      });

      it("should add suffix to tool names when multiple servers of same type exist", () => {
        const mcpServers: McpServerInfo[] = [
          {
            id: "server-1",
            name: "Drive 1",
            serviceType: "google-drive",
            authType: "oauth",
            oauthConnected: true,
          },
          {
            id: "server-2",
            name: "Drive 2",
            serviceType: "google-drive",
            authType: "oauth",
            oauthConnected: true,
          },
        ];

        const options: ToolListOptions = {
          ...baseOptions,
          agent: {
            ...baseOptions.agent,
            enabledMcpServerIds: ["server-1", "server-2"],
          },
          enabledMcpServers: mcpServers,
        };

        const result = generateToolList(options);

        const mcpGroup = result.find((g) => g.category === "MCP Server Tools");
        expect(mcpGroup).toBeDefined();

        // Should have tools with suffixes
        const drive1Tools = mcpGroup?.tools.filter((t) =>
          t.name.includes("drive_1")
        );
        const drive2Tools = mcpGroup?.tools.filter((t) =>
          t.name.includes("drive_2")
        );

        expect(drive1Tools?.length).toBeGreaterThan(0);
        expect(drive2Tools?.length).toBeGreaterThan(0);
      });

      it("should include generic MCP server tool for non-OAuth servers", () => {
        const mcpServers: McpServerInfo[] = [
          {
            id: "server-1",
            name: "Custom MCP Server",
            authType: "api-key",
            oauthConnected: true,
          },
        ];

        const options: ToolListOptions = {
          ...baseOptions,
          agent: {
            ...baseOptions.agent,
            enabledMcpServerIds: ["server-1"],
          },
          enabledMcpServers: mcpServers,
        };

        const result = generateToolList(options);

        const mcpGroup = result.find((g) => g.category === "MCP Server Tools");
        expect(mcpGroup).toBeDefined();

        const genericTool = mcpGroup?.tools.find((t) =>
          t.name.startsWith("mcp_")
        );
        expect(genericTool).toBeDefined();
        expect(genericTool?.description).toContain("Custom MCP Server");
      });

      it("should include Notion tools with all variants", () => {
        const mcpServers: McpServerInfo[] = [
          {
            id: "server-1",
            name: "My Notion",
            serviceType: "notion",
            authType: "oauth",
            oauthConnected: true,
          },
        ];

        const options: ToolListOptions = {
          ...baseOptions,
          agent: {
            ...baseOptions.agent,
            enabledMcpServerIds: ["server-1"],
          },
          enabledMcpServers: mcpServers,
        };

        const result = generateToolList(options);

        const mcpGroup = result.find((g) => g.category === "MCP Server Tools");
        expect(mcpGroup).toBeDefined();

        const notionTools = mcpGroup?.tools.filter((t) =>
          t.name.startsWith("notion_")
        );
        expect(notionTools?.length).toBeGreaterThan(5);
        expect(notionTools?.some((t) => t.name === "notion_read")).toBe(true);
        expect(notionTools?.some((t) => t.name === "notion_search")).toBe(true);
        expect(notionTools?.some((t) => t.name === "notion_create")).toBe(true);
        expect(notionTools?.some((t) => t.name === "notion_update")).toBe(true);
        expect(
          notionTools?.some((t) => t.name === "notion_query_database")
        ).toBe(true);
      });
    });

    it("should group tools by category", () => {
      const options: ToolListOptions = {
        ...baseOptions,
        agent: {
          ...baseOptions.agent,
          enableSearchDocuments: true,
          enableMemorySearch: true,
          notificationChannelId: "channel-123",
          delegatableAgentIds: ["agent-1"],
        },
      };

      const result = generateToolList(options);

      // Should have multiple categories
      expect(result.length).toBeGreaterThan(1);

      // Each group should have a category name
      for (const group of result) {
        expect(group.category).toBeDefined();
        expect(group.tools.length).toBeGreaterThan(0);
      }

      // Tools should be sorted within each category
      for (const group of result) {
        const toolNames = group.tools.map((t) => t.name);
        const sortedNames = [...toolNames].sort();
        expect(toolNames).toEqual(sortedNames);
      }
    });

    it("should handle complex agent configuration with all features enabled", () => {
      const mcpServers: McpServerInfo[] = [
        {
          id: "server-1",
          name: "GitHub Server",
          serviceType: "github",
          authType: "oauth",
          oauthConnected: true,
        },
      ];

      const options: ToolListOptions = {
        ...baseOptions,
        agent: {
          ...baseOptions.agent,
          enableSearchDocuments: true,
          enableMemorySearch: true,
          notificationChannelId: "channel-123",
          enableSendEmail: true,
          searchWebProvider: "tavily",
          fetchWebProvider: "tavily",
          enableExaSearch: true,
          delegatableAgentIds: ["agent-1", "agent-2"],
          enabledMcpServerIds: ["server-1"],
          clientTools: [
            {
              name: "custom_tool",
              description: "Custom tool",
              parameters: {},
            },
          ],
        },
        enabledMcpServers: mcpServers,
        emailConnection: true,
      };

      const result = generateToolList(options);

      // Should have tools from multiple categories
      expect(result.length).toBeGreaterThan(5);

      // Verify core tools
      const coreTools = result.find((g) => g.category === "Core Tools");
      expect(coreTools).toBeDefined();

      // Verify document tools
      const docTools = result.find((g) => g.category === "Document Tools");
      expect(docTools).toBeDefined();

      // Memory tools might be in "Memory Tools" or "Document Tools" category depending on implementation
      const memoryToolInAnyCategory = result.some((g) =>
        g.tools.some((t) => t.name === "search_memory")
      );
      expect(memoryToolInAnyCategory).toBe(true);

      // Verify communication tools
      const commTools = result.find(
        (g) => g.category === "Communication Tools"
      );
      expect(commTools).toBeDefined();

      // Verify web tools
      const webTools = result.find((g) => g.category === "Web Tools");
      expect(webTools).toBeDefined();

      // Verify delegation tools
      const delegationTools = result.find(
        (g) => g.category === "Delegation Tools"
      );
      expect(delegationTools).toBeDefined();

      // Verify MCP tools
      const mcpTools = result.find((g) => g.category === "MCP Server Tools");
      expect(mcpTools).toBeDefined();

      // Verify client tools
      const clientTools = result.find((g) => g.category === "Client Tools");
      expect(clientTools).toBeDefined();
    });
  });
});
