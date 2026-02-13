/**
 * Skill registry: exhaustive mapping from skill id to dynamic import.
 * No filesystem reads; all skills are loaded via hard-coded imports.
 */

import type { AgentSkill } from "./skill";

export const ALL_SKILL_IDS = [
  "competitive-intel",
  "document-faq-assistant",
  "document-research",
  "email-follow-up",
  "email-support-reply",
  "exa-semantic-research",
  "github-issue-pr-workflow",
  "hubspot-marketing-contacts",
  "hubspot-sales-crm",
  "image-generation-assistant",
  "intercom-customer-conversations",
  "linear-issue-management",
  "linear-sprint-planning",
  "memory-context-recall",
  "notion-knowledge-base",
  "notion-project-tracking",
  "posthog-events-debugging",
  "posthog-feature-flags",
  "posthog-marketing-analytics",
  "posthog-product-analytics",
  "salesforce-crm-query",
  "shopify-ecommerce-ops",
  "slack-channel-engagement",
  "slack-internal-comms",
  "stripe-billing-overview",
  "todoist-task-management",
  "web-content-fetch",
  "web-research-assistant",
  "zendesk-customer-context",
  "zendesk-support-tickets",
] as const;

export type SkillId = (typeof ALL_SKILL_IDS)[number];

/**
 * Load a single skill by id. Returns null for unknown id.
 */
export async function loadSkillById(id: string): Promise<AgentSkill | null> {
  switch (id) {
    case "competitive-intel":
      return (await import("./competitive-intel")).default;
    case "document-faq-assistant":
      return (await import("./document-faq-assistant")).default;
    case "document-research":
      return (await import("./document-research")).default;
    case "email-follow-up":
      return (await import("./email-follow-up")).default;
    case "email-support-reply":
      return (await import("./email-support-reply")).default;
    case "exa-semantic-research":
      return (await import("./exa-semantic-research")).default;
    case "github-issue-pr-workflow":
      return (await import("./github-issue-pr-workflow")).default;
    case "hubspot-marketing-contacts":
      return (await import("./hubspot-marketing-contacts")).default;
    case "hubspot-sales-crm":
      return (await import("./hubspot-sales-crm")).default;
    case "image-generation-assistant":
      return (await import("./image-generation-assistant")).default;
    case "intercom-customer-conversations":
      return (await import("./intercom-customer-conversations")).default;
    case "linear-issue-management":
      return (await import("./linear-issue-management")).default;
    case "linear-sprint-planning":
      return (await import("./linear-sprint-planning")).default;
    case "memory-context-recall":
      return (await import("./memory-context-recall")).default;
    case "notion-knowledge-base":
      return (await import("./notion-knowledge-base")).default;
    case "notion-project-tracking":
      return (await import("./notion-project-tracking")).default;
    case "posthog-events-debugging":
      return (await import("./posthog-events-debugging")).default;
    case "posthog-feature-flags":
      return (await import("./posthog-feature-flags")).default;
    case "posthog-marketing-analytics":
      return (await import("./posthog-marketing-analytics")).default;
    case "posthog-product-analytics":
      return (await import("./posthog-product-analytics")).default;
    case "salesforce-crm-query":
      return (await import("./salesforce-crm-query")).default;
    case "shopify-ecommerce-ops":
      return (await import("./shopify-ecommerce-ops")).default;
    case "slack-channel-engagement":
      return (await import("./slack-channel-engagement")).default;
    case "slack-internal-comms":
      return (await import("./slack-internal-comms")).default;
    case "stripe-billing-overview":
      return (await import("./stripe-billing-overview")).default;
    case "todoist-task-management":
      return (await import("./todoist-task-management")).default;
    case "web-content-fetch":
      return (await import("./web-content-fetch")).default;
    case "web-research-assistant":
      return (await import("./web-research-assistant")).default;
    case "zendesk-customer-context":
      return (await import("./zendesk-customer-context")).default;
    case "zendesk-support-tickets":
      return (await import("./zendesk-support-tickets")).default;
    default:
      return null;
  }
}

/**
 * Load all skills. Uses hard-coded imports only.
 */
export async function loadAllSkills(): Promise<AgentSkill[]> {
  const results = await Promise.all(
    ALL_SKILL_IDS.map((id) => loadSkillById(id)),
  );
  return results.filter((s): s is AgentSkill => s != null);
}
