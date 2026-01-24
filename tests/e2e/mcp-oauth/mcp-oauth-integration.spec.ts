import { spawnSync } from "child_process";

import { expect } from "@playwright/test";

import { testWithUserManagement } from "../fixtures/test-fixtures";
import { AgentDetailPage } from "../pages/agent-detail-page";
import { WorkspaceDetailPage } from "../pages/workspace-detail-page";
import { WorkspacesPage } from "../pages/workspaces-page";
import { testState, TestState } from "../utils/shared-state";

import { McpServerPage } from "./mcp-oauth-test-utils";
import {
  ALL_MCP_SERVICES,
  getServiceConfig,
  McpServiceType,
} from "./mcp-service-config";

type OAuthFailure = {
  serviceType: McpServiceType;
  error: string;
  details?: string;
  action?: string;
  screenshotPath?: string;
};

const shouldRunMcpOAuth = process.env.RUN_MCP_OAUTH_E2E === "true";
const mcpDescribe = shouldRunMcpOAuth
  ? testWithUserManagement.describe.serial
  : testWithUserManagement.describe.skip;

if (shouldRunMcpOAuth) {
  testWithUserManagement.use({ channel: "chrome" });
}

mcpDescribe(
  "MCP OAuth Integrations - Full Integration",
  () => {
    const state: TestState = testState;

    testWithUserManagement(
      "1. Login and authenticate",
      async ({ page, userManagement }) => {
        const user = await userManagement.createAndLoginUser();
        state.user = user;
        expect(page.url()).not.toContain("/api/auth/signin");
      }
    );

    testWithUserManagement("2. Create workspace", async ({ page }) => {
      const workspacesPage = new WorkspacesPage(page);
      await workspacesPage.goto();
      await workspacesPage.waitForWorkspacesPage();

      const workspaceName = `MCP OAuth Test Workspace ${Date.now()}`;
      const workspaceDescription = "Automated MCP OAuth integration testing";
      const workspace = await workspacesPage.createWorkspace(
        workspaceName,
        workspaceDescription
      );

      state.workspace = workspace;
      expect(workspace.id).toBeTruthy();

      const creditsAmount = process.env.E2E_ADD_CREDITS_AMOUNT || "50";
      addCreditsToWorkspace(workspace.id, creditsAmount);
    });

    testWithUserManagement("3. Create test agent", async ({ page }) => {
      if (!state.workspace) {
        throw new Error("No workspace found in state.");
      }

      const workspaceDetailPage = new WorkspaceDetailPage(page);
      await workspaceDetailPage.goto(state.workspace.id);
      await workspaceDetailPage.waitForWorkspaceDetailPage();

      const agentName = `MCP OAuth Test Agent ${Date.now()}`;
      const systemPrompt = [
        "You are a testing assistant.",
        "When asked to call a tool, you must call the tool with the provided arguments.",
        "Return the tool output exactly as received.",
      ].join("\n");

      const agent = await workspaceDetailPage.createAgent({
        name: agentName,
        systemPrompt,
      });

      state.agent = agent;
      expect(agent.id).toBeTruthy();
    });

    testWithUserManagement(
      "4. Test OAuth integrations (all services)",
      async ({ page }) => {
        testWithUserManagement.setTimeout(1800000);
        if (!state.workspace || !state.agent) {
          throw new Error("Workspace or agent not found in state.");
        }

        const failures: OAuthFailure[] = [];
        const mcpPage = new McpServerPage(page);
        const agentDetailPage = new AgentDetailPage(page);
        let enabledMcpServerIds: string[] = [];
        const skipServices = new Set(
          (process.env.MCP_OAUTH_SKIP_SERVICES || "")
            .split(",")
            .map((service) => service.trim())
            .filter(Boolean)
        );

        await mcpPage.gotoWorkspace(state.workspace.id);

        for (const serviceType of ALL_MCP_SERVICES) {
          if (skipServices.has(serviceType)) {
            console.log(`\n=== Skipping ${serviceType} ===`);
            continue;
          }
          const config = getServiceConfig(serviceType);
          const serverName = `MCP ${config.displayName} ${Date.now()}`;
          console.log(`\n=== Testing ${config.displayName} ===`);

          let serverConfig: Record<string, unknown> | undefined;
          if (config.requiresAdditionalConfig && config.configFields) {
            serverConfig = {};
            for (const fieldName of config.configFields) {
              const value = await mcpPage.promptForConfigValue(
                serviceType,
                fieldName
              );
              serverConfig[fieldName] = value;
            }
          }

          let serverId: string;
          let serverCreated = false;
          let serverEnabled = false;
          try {
            const server = await mcpPage.createMcpServerViaApi(
              state.workspace.id,
              {
                name: serverName,
                authType: "oauth",
                serviceType,
                config: serverConfig || {},
              }
            );
            serverId = server.id;
            serverCreated = true;
            console.log(`Created MCP server ${serverName} (${serverId})`);
          } catch (error) {
            failures.push({
              serviceType,
              error: "Failed to create MCP server",
              details: error instanceof Error ? error.message : String(error),
              action: "Check backend logs and MCP server schema validation",
            });
            continue;
          }

          try {
            await mcpPage.refreshMcpServersSection(state.workspace.id);
            await mcpPage.initiateOAuthFlow(serverName);
            await mcpPage.waitForManualOAuthCompletion(
              state.workspace.id,
              serverId,
              serviceType
            );

            const callbackResult = await mcpPage.waitForOAuthCallback(
              state.workspace.id,
              serverId,
              serviceType
            );

            if (!callbackResult.success) {
              const screenshotPath = await mcpPage.takeErrorScreenshot(
                serviceType,
                "oauth"
              );
              failures.push({
                serviceType,
                error: callbackResult.error?.error || "OAuth flow failed",
                details: callbackResult.error?.details,
                action: callbackResult.error?.action,
                screenshotPath,
              });
              continue;
            }

            const connected = await mcpPage.verifyOAuthConnection(serverName);
            if (!connected) {
              failures.push({
                serviceType,
                error: "OAuth connection not marked as connected",
                action: "Check MCP server status and OAuth token storage",
              });
              continue;
            }

            await mcpPage.enableMcpServerOnAgent(
              state.workspace.id,
              state.agent.id,
              serverId,
              enabledMcpServerIds
            );
            enabledMcpServerIds = [...enabledMcpServerIds, serverId];
            serverEnabled = true;

            const tools = await mcpPage.getAgentTools(
              state.workspace.id,
              state.agent.id
            );

            const tool = selectToolForService(tools, config);
            if (!tool) {
              failures.push({
                serviceType,
                error: "No tool matched for service",
                details: `No tool found with keywords: ${config.toolMatchKeywords?.join(", ")}`,
                action: "Verify tool metadata wiring for MCP service",
              });
              continue;
            }

            const requiredParams =
              tool.parameters?.filter((param) => param.required) || [];

            let toolArgs: Record<string, unknown> = {};
            if (requiredParams.length > 0) {
              console.log(
                `Tool ${tool.name} requires params: ${requiredParams
                  .map((param) => param.name)
                  .join(", ")}`
              );
              toolArgs = await mcpPage.promptForToolArgs(tool.name);
            }

            await agentDetailPage.goto(state.workspace.id, state.agent.id);
            await agentDetailPage.waitForAgentDetailPage();

            const prompt = [
              `Use the tool "${tool.name}" with the following args:`,
              JSON.stringify(toolArgs),
              "Return only the tool output.",
            ].join("\n");

            const response = await agentDetailPage.sendMessageAndWaitForResponse(
              prompt
            );

            expect(response).toBeTruthy();
            console.log(
              `Tool response for ${tool.name}: ${response.slice(0, 100)}...`
            );
          } finally {
            if (serverCreated) {
              try {
                if (serverEnabled) {
                  await mcpPage.disableMcpServerOnAgent(
                    state.workspace.id,
                    state.agent.id,
                    serverId,
                    enabledMcpServerIds
                  );
                  enabledMcpServerIds = enabledMcpServerIds.filter(
                    (id) => id !== serverId
                  );
                }
                await mcpPage.deleteMcpServer(state.workspace.id, serverId);
              } catch (cleanupError) {
                console.warn(
                  `Failed to cleanup MCP server ${serverId}: ${
                    cleanupError instanceof Error
                      ? cleanupError.message
                      : String(cleanupError)
                  }`
                );
              }
            }
          }
        }

        if (failures.length > 0) {
          const summary = failures
            .map((failure) => {
              const parts = [
                `[${failure.serviceType}] ${failure.error}`,
                failure.details ? `Details: ${failure.details}` : null,
                failure.action ? `Action: ${failure.action}` : null,
                failure.screenshotPath
                  ? `Screenshot: ${failure.screenshotPath}`
                  : null,
              ].filter(Boolean);
              return parts.join("\n");
            })
            .join("\n\n");

          throw new Error(`MCP OAuth failures:\n${summary}`);
        }
      }
    );
  }
);

function selectToolForService(
  tools: Array<{
    name: string;
    description?: string;
    category?: string;
    parameters?: Array<{
      name: string;
      required?: boolean;
    }>;
  }>,
  config: ReturnType<typeof getServiceConfig>
) {
  const keywords = config.toolMatchKeywords?.map((keyword) =>
    keyword.toLowerCase()
  );
  if (!keywords || keywords.length === 0) {
    return tools[0];
  }

  return tools.find((tool) => {
    const haystack = [
      tool.name,
      tool.description || "",
      tool.category || "",
    ]
      .join(" ")
      .toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword));
  });
}

function addCreditsToWorkspace(workspaceId: string, amount: string): void {
  const result = spawnSync("pnpm", ["add-credits", workspaceId, amount], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(
      `Failed to add credits to workspace ${workspaceId} (exit code ${result.status})`
    );
  }
}
