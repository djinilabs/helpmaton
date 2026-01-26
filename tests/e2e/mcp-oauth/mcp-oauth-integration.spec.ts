import { spawnSync } from "child_process";
import { createRequire } from "module";

import { expect, Page } from "@playwright/test";

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
const preserveMcpOAuthData = isTruthyEnv(process.env.MCP_OAUTH_PRESERVE);
const mcpDescribe = shouldRunMcpOAuth
  ? testWithUserManagement.describe.serial
  : testWithUserManagement.describe.skip;

if (shouldRunMcpOAuth) {
  testWithUserManagement.use({ channel: "chrome" });
}

mcpDescribe("MCP OAuth Integrations - Full Integration", () => {
  const state: TestState = testState;

  testWithUserManagement(
    "1. Login and authenticate",
    async ({ page, userManagement }) => {
      const user = await userManagement.createAndLoginUser();
      state.user = user;
      expect(page.url()).not.toContain("/api/auth/signin");
    },
  );

  testWithUserManagement(
    "1b. Upgrade subscription to pro",
    async ({ page }) => {
      await ensureProSubscription(page);
    },
  );

  testWithUserManagement("2. Create workspace", async ({ page }) => {
    const workspacesPage = new WorkspacesPage(page);
    await workspacesPage.goto();
    await workspacesPage.waitForWorkspacesPage();

    const workspaceName = `MCP OAuth Test Workspace ${Date.now()}`;
    const workspaceDescription = "Automated MCP OAuth integration testing";
    const workspace = await workspacesPage.createWorkspace(
      workspaceName,
      workspaceDescription,
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
      testWithUserManagement.setTimeout(getMcpOauthTimeoutMs());
      if (!state.workspace || !state.agent) {
        throw new Error("Workspace or agent not found in state.");
      }

      const failures: OAuthFailure[] = [];
      const mcpPage = new McpServerPage(page);
      const agentDetailPage = new AgentDetailPage(page);
      let enabledMcpServerIds: string[] = [];
      const skipServices = new Set<McpServiceType>([
        ...getSkipServicesFromList(),
        ...getSkipServicesFromFlags(),
      ]);

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
              fieldName,
            );
            serverConfig[fieldName] = value;
          }
        }

        let serverId: string;
        let serverEnabled = false;
        try {
          const server = await mcpPage.createMcpServerViaApi(
            state.workspace.id,
            {
              name: serverName,
              authType: "oauth",
              serviceType,
              config: serverConfig || {},
            },
          );
          serverId = server.id;
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
            serviceType,
          );

          const callbackResult = await mcpPage.waitForOAuthCallback(
            state.workspace.id,
            serverId,
            serviceType,
          );

          if (!callbackResult.success) {
            const screenshotPath = await mcpPage.takeErrorScreenshot(
              serviceType,
              "oauth",
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
            enabledMcpServerIds,
          );
          enabledMcpServerIds = [...enabledMcpServerIds, serverId];
          serverEnabled = true;

          const tools = await mcpPage.getAgentTools(
            state.workspace.id,
            state.agent.id,
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
                .join(", ")}`,
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

          const response =
            await agentDetailPage.sendMessageAndWaitForResponse(prompt);

          expect(response).toBeTruthy();
          console.log(
            `Tool response for ${tool.name}: ${response.slice(0, 100)}...`,
          );
        } finally {
          if (preserveMcpOAuthData) {
            console.log(
              `[MCP OAuth] Preserving MCP server ${serverId} for ${serviceType}`
            );
          } else {
            try {
              if (serverEnabled) {
                await mcpPage.disableMcpServerOnAgent(
                  state.workspace.id,
                  state.agent.id,
                  serverId,
                  enabledMcpServerIds,
                );
                enabledMcpServerIds = enabledMcpServerIds.filter(
                  (id) => id !== serverId,
                );
              }
              await mcpPage.deleteMcpServer(state.workspace.id, serverId);
            } catch (cleanupError) {
              console.warn(
                `Failed to cleanup MCP server ${serverId}: ${
                  cleanupError instanceof Error
                    ? cleanupError.message
                    : String(cleanupError)
                }`,
              );
              failures.push({
                serviceType,
                error: `Failed to cleanup MCP server ${serverId}`,
                details:
                  cleanupError instanceof Error
                    ? cleanupError.message
                    : String(cleanupError),
                action:
                  "Manually delete this MCP server to avoid hitting plan limits.",
              });
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
    },
  );
});

function getSkipServicesFromList(): McpServiceType[] {
  const raw = process.env.MCP_OAUTH_SKIP_SERVICES || "";
  return raw
    .split(",")
    .map((service) => service.trim())
    .filter(Boolean) as McpServiceType[];
}

function getSkipServicesFromFlags(): McpServiceType[] {
  return ALL_MCP_SERVICES.filter((service) => {
    const envKey = `MCP_OAUTH_SKIP_${toEnvKey(service)}`;
    return isTruthyEnv(process.env[envKey]);
  });
}

function toEnvKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "_").toUpperCase();
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return ["1", "true", "yes", "y"].includes(value.toLowerCase());
}

function getMcpOauthTimeoutMs(): number {
  const raw = process.env.MCP_OAUTH_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 30 * 60 * 1000;
}

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
  config: ReturnType<typeof getServiceConfig>,
) {
  const keywords = config.toolMatchKeywords?.map((keyword) =>
    keyword.toLowerCase(),
  );
  if (!keywords || keywords.length === 0) {
    return tools[0];
  }

  return tools.find((tool) => {
    const haystack = [tool.name, tool.description || "", tool.category || ""]
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
      `Failed to add credits to workspace ${workspaceId} (exit code ${result.status})`,
    );
  }
}

async function ensureProSubscription(page: Page): Promise<void> {
  const baseUrl = process.env.BASE_URL || "http://localhost:5173";
  if (!baseUrl.includes("localhost")) {
    console.warn(
      "[MCP OAuth] Skipping subscription upgrade: non-local BASE_URL detected.",
    );
    return;
  }

  const mcpPage = new McpServerPage(page);
  const token = await mcpPage.getAccessTokenForApi();
  const apiBaseUrl = mcpPage.getApiBaseUrl();

  const response = await page.request.get(`${apiBaseUrl}/api/subscription`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok()) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch subscription details: ${response.status()} ${errorText}`,
    );
  }

  const subscription = (await response.json()) as {
    subscriptionId: string;
    plan: string;
  };

  if (subscription.plan === "pro") {
    console.log("[MCP OAuth] Subscription already set to pro.");
    return;
  }

  // Local-only: update the sandbox subscription directly to avoid MCP limits.
  const require = createRequire(import.meta.url);
  const { database } = require("../../../apps/backend/src/tables/database");
  const db = await database();
  const subscriptionPk = `subscriptions/${subscription.subscriptionId}`;
  const existing = await db.subscription.get(subscriptionPk, "subscription");

  if (!existing) {
    throw new Error(
      `Subscription record not found for ${subscription.subscriptionId}`,
    );
  }

  await db.subscription.update({
    ...existing,
    plan: "pro",
    status: "active",
    endsAt: undefined,
    gracePeriodEndsAt: undefined,
  });

  console.log(
    `[MCP OAuth] Subscription ${subscription.subscriptionId} updated to pro.`,
  );
}
