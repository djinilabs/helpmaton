/**
 * Canonical Helpmaton product description and rules for meta-agent system prompts.
 * Used by onboarding, workspace, and agent-config agents (and optionally suggestions)
 * so product wording stays consistent and accurate.
 */

/** Short product description for system prompts (2–4 sentences). */
export const HELPMATON_PRODUCT_DESCRIPTION =
  "Helpmaton is a workspace-based AI agent management platform. Users create workspaces, add AI agents with custom prompts and models, manage documents and knowledge bases, and deploy agents via webhooks and APIs. Workspaces have credits (usage), spending limits, team members, and integrations (MCP servers, Discord, Slack, email).";

/** Subscription plans mention (for onboarding and workspace context). */
export const HELPMATON_SUBSCRIPTION_TIERS =
  "Subscription plans are Free, Starter, and Pro, with different limits on workspaces, agents, channels, and MCP servers.";

/** BYOK rule: do not claim adding an OpenRouter key gives access to more models. */
export const HELPMATON_BYOK_RULE =
  "Never suggest that adding an OpenRouter API key gives access to more models; the same models are available with or without a key. BYOK only lets the workspace pay OpenRouter directly instead of using credits.";
