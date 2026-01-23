/**
 * Configuration for MCP OAuth service testing
 *
 * This file contains service-specific configurations including:
 * - Service type identifiers
 * - OAuth scope requirements (for validation/documentation)
 * - Tool matching hints for selecting a tool to call
 * - Service-specific setup requirements (e.g., Shopify shop domain, Zendesk subdomain)
 */

export type McpServiceType =
  | "google-drive"
  | "gmail"
  | "google-calendar"
  | "notion"
  | "github"
  | "linear"
  | "hubspot"
  | "shopify"
  | "slack"
  | "stripe"
  | "salesforce"
  | "intercom"
  | "todoist"
  | "zendesk";

export interface McpServiceConfig {
  serviceType: McpServiceType;
  displayName: string;
  requiredScopes?: string[];
  toolMatchKeywords?: string[];
  requiresAdditionalConfig?: boolean;
  configFields?: string[];
  oauthProvider?: string;
}

export const ALL_MCP_SERVICES: McpServiceType[] = [
  "google-drive",
  "gmail",
  "google-calendar",
  "notion",
  "github",
  "linear",
  "hubspot",
  "shopify",
  "slack",
  "stripe",
  "salesforce",
  "intercom",
  "todoist",
  "zendesk",
];

export const MCP_SERVICE_CONFIGS: Record<McpServiceType, McpServiceConfig> = {
  "google-drive": {
    serviceType: "google-drive",
    displayName: "Google Drive",
    oauthProvider: "Google",
    toolMatchKeywords: ["drive", "file", "folder"],
  },
  gmail: {
    serviceType: "gmail",
    displayName: "Gmail",
    oauthProvider: "Google",
    toolMatchKeywords: ["gmail", "email", "message"],
  },
  "google-calendar": {
    serviceType: "google-calendar",
    displayName: "Google Calendar",
    oauthProvider: "Google",
    toolMatchKeywords: ["calendar", "event"],
  },
  notion: {
    serviceType: "notion",
    displayName: "Notion",
    oauthProvider: "Notion",
    toolMatchKeywords: ["notion", "page", "database"],
  },
  github: {
    serviceType: "github",
    displayName: "GitHub",
    oauthProvider: "GitHub",
    toolMatchKeywords: ["github", "repo", "issue", "pull"],
  },
  linear: {
    serviceType: "linear",
    displayName: "Linear",
    oauthProvider: "Linear",
    toolMatchKeywords: ["linear", "issue", "team", "project"],
  },
  hubspot: {
    serviceType: "hubspot",
    displayName: "HubSpot",
    oauthProvider: "HubSpot",
    toolMatchKeywords: ["hubspot", "contact", "company", "deal"],
  },
  shopify: {
    serviceType: "shopify",
    displayName: "Shopify",
    oauthProvider: "Shopify",
    requiresAdditionalConfig: true,
    configFields: ["shopDomain"],
    toolMatchKeywords: ["shopify", "product", "order"],
  },
  slack: {
    serviceType: "slack",
    displayName: "Slack",
    oauthProvider: "Slack",
    toolMatchKeywords: ["slack", "channel", "message"],
  },
  stripe: {
    serviceType: "stripe",
    displayName: "Stripe",
    oauthProvider: "Stripe",
    toolMatchKeywords: ["stripe", "customer", "invoice", "payment"],
  },
  salesforce: {
    serviceType: "salesforce",
    displayName: "Salesforce",
    oauthProvider: "Salesforce",
    toolMatchKeywords: ["salesforce", "soql", "object", "query"],
  },
  intercom: {
    serviceType: "intercom",
    displayName: "Intercom",
    oauthProvider: "Intercom",
    toolMatchKeywords: ["intercom", "conversation", "contact"],
  },
  todoist: {
    serviceType: "todoist",
    displayName: "Todoist",
    oauthProvider: "Todoist",
    toolMatchKeywords: ["todoist", "task", "project"],
  },
  zendesk: {
    serviceType: "zendesk",
    displayName: "Zendesk",
    oauthProvider: "Zendesk",
    requiresAdditionalConfig: true,
    configFields: ["subdomain"],
    toolMatchKeywords: ["zendesk", "ticket", "help center"],
  },
};

export function getServiceConfig(
  serviceType: McpServiceType
): McpServiceConfig {
  return MCP_SERVICE_CONFIGS[serviceType];
}

export function getServicesRequiringConfig(): McpServiceType[] {
  return ALL_MCP_SERVICES.filter(
    (service) => MCP_SERVICE_CONFIGS[service].requiresAdditionalConfig
  );
}
