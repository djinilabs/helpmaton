import readline from "readline";

import { Page, Locator } from "@playwright/test";

import { BasePage } from "../pages/base-page";

import type { McpServiceType } from "./mcp-service-config";

export interface McpServer {
  id: string;
  name: string;
  url?: string;
  authType: string;
  serviceType?: string;
  oauthConnected?: boolean;
}

export interface CreateMcpServerInput {
  name: string;
  url?: string;
  authType: "oauth";
  serviceType: McpServiceType;
  config?: Record<string, unknown>;
}

export interface OAuthError {
  service: string;
  error: string;
  details?: string;
  action?: string;
  screenshotPath?: string;
}

export interface ToolDescriptor {
  name: string;
  description?: string;
  category?: string;
  parameters?: Array<{
    name: string;
    type?: string;
    required?: boolean;
    description?: string;
  }>;
}

/**
 * Page object for MCP server management UI
 */
export class McpServerPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to workspace detail page and expand MCP servers section
   */
  async gotoWorkspace(workspaceId: string): Promise<void> {
    await this.page.goto(`/workspaces/${workspaceId}`);
    await this.waitForPageLoad();
    await this.expandMcpServersSection();
  }

  async refreshMcpServersSection(workspaceId: string): Promise<void> {
    await this.page.goto(`/workspaces/${workspaceId}`);
    await this.waitForPageLoad();
    await this.expandMcpServersSection();
  }

  /**
   * Expand MCP Servers accordion section
   */
  async expandMcpServersSection(): Promise<void> {
    const accordion = this.page
      .locator('button[aria-controls="accordion-content-mcp-servers"]')
      .or(this.page.locator('button:has-text("Connected tools")'));

    const isExpanded =
      (await accordion.getAttribute("aria-expanded")) === "true";

    if (!isExpanded) {
      await this.clickElement(accordion);
      await accordion.waitFor({ state: "visible", timeout: 10000 });
      const handle = await accordion.elementHandle();
      if (!handle) {
        throw new Error("MCP servers accordion button not found");
      }
      await this.page.waitForFunction(
        (el) => el.getAttribute("aria-expanded") === "true",
        handle,
        { timeout: 10000 }
      );
    }
  }

  /**
   * Create MCP server via API (faster than UI)
   */
  async createMcpServerViaApi(
    workspaceId: string,
    input: CreateMcpServerInput
  ): Promise<McpServer> {
    const baseUrl = this.getBaseUrl();
    const token = await this.getAccessToken();

    const response = await this.page.request.post(
      `${baseUrl}/api/workspaces/${workspaceId}/mcp-servers`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        data: input,
      }
    );

    if (!response.ok()) {
      const errorText = await response.text();
      throw new Error(
        `Failed to create MCP server: ${response.status()} ${errorText}`
      );
    }

    return response.json();
  }

  /**
   * Initiate OAuth flow by clicking Connect button
   */
  async initiateOAuthFlow(serverName: string): Promise<void> {
    const serverCard = await this.waitForServerCard(serverName);
    const connectButton = serverCard
      .locator('button:has-text("Connect")')
      .or(serverCard.locator('button:has-text("Reconnect")'))
      .first();

    await this.clickElement(connectButton);
    await this.page.waitForLoadState("domcontentloaded", { timeout: 10000 });
  }

  /**
   * Wait for OAuth callback and handle it
   */
  async waitForOAuthCallback(
    workspaceId: string,
    serverId: string,
    serviceType: McpServiceType,
    timeout: number = 120000
  ): Promise<{ success: boolean; error?: OAuthError }> {
    const callbackPattern = new RegExp(
      `/workspaces/${workspaceId}/mcp-servers/${serverId}/oauth/callback`
    );

    try {
      await this.page.waitForURL(callbackPattern, { timeout });
    } catch {
      const currentUrl = this.page.url();
      const pageText = (await this.page.textContent("body")) || "";

      if (this.detectOAuthError(pageText, currentUrl)) {
        const error = this.extractOAuthError(pageText, currentUrl, serviceType);
        return { success: false, error };
      }

      return {
        success: false,
        error: {
          service: serviceType,
          error: "OAuth callback timeout",
          details: `Current URL: ${currentUrl}`,
          action: "Complete OAuth flow or check redirect URI configuration",
        },
      };
    }

    const url = new URL(this.page.url());
    const errorParam = url.searchParams.get("error");
    const successParam = url.searchParams.get("success");

    if (errorParam) {
      return {
        success: false,
        error: {
          service: serviceType,
          error: "OAuth callback error",
          details: decodeURIComponent(errorParam),
          action: "Check OAuth app configuration and redirect URI",
        },
      };
    }

    if (successParam === "true") {
      await this.page.waitForURL(new RegExp(`/workspaces/${workspaceId}`), {
        timeout: 10000,
      });
      return { success: true };
    }

    const pageText = await this.page.textContent("body");
    if (pageText?.includes("Error") || pageText?.includes("Failed")) {
      return {
        success: false,
        error: {
          service: serviceType,
          error: "OAuth connection failed",
          details: pageText.substring(0, 200),
          action: "Check OAuth app configuration",
        },
      };
    }

    return { success: true };
  }

  /**
   * Wait for manual OAuth completion if needed
   */
  async waitForManualOAuthCompletion(
    workspaceId: string,
    serverId: string,
    serviceType: McpServiceType
  ): Promise<void> {
    const callbackPattern = new RegExp(
      `/workspaces/${workspaceId}/mcp-servers/${serverId}/oauth/callback`
    );

    const manualNeeded = await this.detectManualInterventionNeeded();
    if (!manualNeeded) {
      return;
    }

    console.log(
      `[MCP OAuth] Manual step required for ${serviceType}. Complete the OAuth flow in the browser.`
    );

    if (process.env.HEADLESS === "true") {
      console.log(
        "[MCP OAuth] HEADLESS=true detected. Manual OAuth completion may not be possible."
      );
    } else {
      process.stdout.write("\x07");
      await this.page.pause();
    }

    await this.page.waitForURL(callbackPattern, { timeout: 120000 });
  }

  /**
   * Verify OAuth connection status for a server
   */
  async verifyOAuthConnection(serverName: string): Promise<boolean> {
    const serverCard = this.getServerCard(serverName);
    const connectedIndicator = serverCard.locator(
      'text=/Connected|✓ Connected/i'
    );

    try {
      await connectedIndicator.waitFor({ timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get MCP server list via API
   */
  async getMcpServersViaApi(workspaceId: string): Promise<McpServer[]> {
    const baseUrl = this.getBaseUrl();
    const token = await this.getAccessToken();

    const response = await this.page.request.get(
      `${baseUrl}/api/workspaces/${workspaceId}/mcp-servers`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok()) {
      throw new Error(`Failed to get MCP servers: ${response.status()}`);
    }

    const data = await response.json();
    return data.servers || [];
  }

  /**
   * Enable MCP server on an agent via API
   */
  async enableMcpServerOnAgent(
    workspaceId: string,
    agentId: string,
    serverId: string,
    currentEnabledIds: string[] = []
  ): Promise<void> {
    const baseUrl = this.getBaseUrl();
    const token = await this.getAccessToken();

    const enabledMcpServerIds = [...new Set([...currentEnabledIds, serverId])];

    const response = await this.page.request.put(
      `${baseUrl}/api/workspaces/${workspaceId}/agents/${agentId}`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        data: {
          enabledMcpServerIds,
        },
      }
    );

    if (!response.ok()) {
      const errorText = await response.text();
      throw new Error(
        `Failed to enable MCP server on agent: ${response.status()} ${errorText}`
      );
    }
  }

  async disableMcpServerOnAgent(
    workspaceId: string,
    agentId: string,
    serverId: string,
    currentEnabledIds: string[] = []
  ): Promise<void> {
    const baseUrl = this.getBaseUrl();
    const token = await this.getAccessToken();

    const enabledMcpServerIds = currentEnabledIds.filter((id) => id !== serverId);

    const response = await this.page.request.put(
      `${baseUrl}/api/workspaces/${workspaceId}/agents/${agentId}`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        data: {
          enabledMcpServerIds,
        },
      }
    );

    if (!response.ok()) {
      const errorText = await response.text();
      throw new Error(
        `Failed to disable MCP server on agent: ${response.status()} ${errorText}`
      );
    }
  }

  async deleteMcpServer(
    workspaceId: string,
    serverId: string
  ): Promise<void> {
    const baseUrl = this.getBaseUrl();
    const token = await this.getAccessToken();

    const response = await this.page.request.delete(
      `${baseUrl}/api/workspaces/${workspaceId}/mcp-servers/${serverId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok()) {
      const errorText = await response.text();
      throw new Error(
        `Failed to delete MCP server: ${response.status()} ${errorText}`
      );
    }
  }

  /**
   * Fetch agent tools via API
   */
  async getAgentTools(
    workspaceId: string,
    agentId: string
  ): Promise<ToolDescriptor[]> {
    const baseUrl = this.getBaseUrl();
    const token = await this.getAccessToken();

    const response = await this.page.request.get(
      `${baseUrl}/api/workspaces/${workspaceId}/agents/${agentId}/tools`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok()) {
      const errorText = await response.text();
      throw new Error(
        `Failed to get agent tools: ${response.status()} ${errorText}`
      );
    }

    const toolGroups = await response.json();
    const tools: ToolDescriptor[] = [];
    for (const group of toolGroups) {
      if (Array.isArray(group.tools)) {
        for (const tool of group.tools) {
          tools.push(tool);
        }
      }
    }
    return tools;
  }

  /**
   * Prompt the user for a config value
   */
  async promptForConfigValue(
    serviceType: McpServiceType,
    fieldName: string
  ): Promise<string> {
    const envKey = `MCP_OAUTH_${toEnvKey(serviceType)}_${toEnvKey(fieldName)}`;
    const envValue = process.env[envKey];
    if (envValue && envValue.trim()) {
      console.log(`[MCP OAuth] Using ${envKey} from environment.`);
      return envValue.trim();
    }

    throw new Error(
      `Missing ${envKey}. Set it in tests/e2e/.env or export it before running the tests.`
    );
  }

  /**
   * Prompt the user for tool args in JSON format
   */
  async promptForToolArgs(toolName: string): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(
        `Provide JSON args for tool "${toolName}" (or leave blank for {}): `,
        (answer) => {
          rl.close();
          const trimmed = answer.trim();
          if (!trimmed) {
            resolve({});
            return;
          }
          try {
            resolve(JSON.parse(trimmed));
          } catch {
            console.warn(
              "Invalid JSON provided, defaulting to empty object."
            );
            resolve({});
          }
        }
      );
    });
  }

  /**
   * Take screenshot for error reporting
   */
  async takeErrorScreenshot(
    serviceType: McpServiceType,
    errorType: string
  ): Promise<string> {
    const timestamp = Date.now();
    const filename = `mcp-oauth-${serviceType}-${errorType}-${timestamp}.png`;
    const path = `test-results/${filename}`;
    await this.page.screenshot({ path, fullPage: true });
    return path;
  }

  private getServerCard(serverName: string): Locator {
    return this.page.locator(
      `xpath=//div[contains(@class,"rounded-xl") and .//div[text()="${serverName}"]]`
    );
  }

  private async waitForServerCard(serverName: string): Promise<Locator> {
    const card = this.getServerCard(serverName);
    await card.waitFor({ state: "visible", timeout: 20000 });
    return card;
  }

  private async getSessionCookie() {
    const cookies = await this.page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name.includes("session"));

    if (!sessionCookie) {
      throw new Error("No session cookie found. User may not be authenticated.");
    }

    return sessionCookie;
  }

  private async getAccessToken(): Promise<string> {
    const token = await this.page.evaluate(() => {
      return (
        localStorage.getItem("helpmaton_access_token") ||
        localStorage.getItem("access_token") ||
        localStorage.getItem("auth_token")
      );
    });
    if (!token) {
      throw new Error("No auth token found in localStorage.");
    }
    return token;
  }

  private getBaseUrl(): string {
    const currentUrl = this.page.url();
    if (currentUrl.includes("/workspaces")) {
      return currentUrl.split("/workspaces")[0];
    }
    return "http://localhost:5173";
  }

  private async detectManualInterventionNeeded(): Promise<boolean> {
    const url = this.page.url().toLowerCase();
    const pageText = (await this.page.textContent("body"))?.toLowerCase() || "";

    const indicators = [
      "login",
      "sign in",
      "sign-in",
      "two-factor",
      "2fa",
      "verification code",
      "consent",
      "authorize",
      "permissions",
      "select an account",
      "choose an account",
    ];

    return indicators.some(
      (indicator) => url.includes(indicator) || pageText.includes(indicator)
    );
  }

  private detectOAuthError(pageText: string, url: string): boolean {
    const lowerText = pageText.toLowerCase();
    const lowerUrl = url.toLowerCase();

    const errorIndicators = [
      "error",
      "invalid",
      "unauthorized",
      "forbidden",
      "access denied",
      "scope",
      "permission",
      "redirect_uri_mismatch",
      "redirect uri",
      "client_id",
      "client_secret",
      "invalid_client",
      "invalid_grant",
    ];

    return errorIndicators.some(
      (indicator) =>
        lowerText.includes(indicator) || lowerUrl.includes(indicator)
    );
  }

  private extractOAuthError(
    pageText: string,
    url: string,
    serviceType: McpServiceType
  ): OAuthError {
    const lowerText = pageText.toLowerCase();
    const lowerUrl = url.toLowerCase();

    let errorType = "OAuth error";
    let details = "";
    let action = "Check OAuth app configuration";

    if (lowerText.includes("redirect") || lowerUrl.includes("redirect")) {
      errorType = "Redirect URI mismatch";
      details =
        "The redirect URI in the OAuth app configuration does not match the callback URL";
      action = `Update OAuth app redirect URI to match: ${this.getCallbackUrl(
        serviceType
      )}`;
    } else if (
      lowerText.includes("scope") ||
      lowerText.includes("permission")
    ) {
      errorType = "Scope/permission error";
      details = "Required OAuth scopes are missing or invalid";
      action = "Update OAuth app scopes in the service provider's app settings";
    } else if (
      lowerText.includes("client_id") ||
      lowerText.includes("client_secret") ||
      lowerUrl.includes("client_id")
    ) {
      errorType = "Invalid client credentials";
      details = "OAuth client ID or secret is incorrect";
      action = "Verify OAuth app credentials in environment variables";
    } else if (lowerText.includes("access denied")) {
      errorType = "Access denied";
      details = "User denied access or app is not authorized";
      action = "User needs to grant permissions in OAuth provider";
    }

    const errorMatch = pageText.match(/error[:\s]+([^\n]+)/i);
    if (errorMatch) {
      details = errorMatch[1].trim();
    }

    return {
      service: serviceType,
      error: errorType,
      details,
      action,
    };
  }

  private getCallbackUrl(serviceType: McpServiceType): string {
    const baseUrl =
      process.env.OAUTH_REDIRECT_BASE_URL || "http://localhost:3333";
    return `${baseUrl}/api/mcp-oauth/${serviceType}/callback`;
  }
}

function toEnvKey(fieldName: string): string {
  return fieldName
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toUpperCase();
}
