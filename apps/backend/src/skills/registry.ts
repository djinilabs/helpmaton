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
  "hubspot-marketing-contacts",
  "hubspot-sales-crm",
  "linear-issue-management",
  "linear-sprint-planning",
  "notion-knowledge-base",
  "notion-project-tracking",
  "posthog-events-debugging",
  "posthog-feature-flags",
  "posthog-marketing-analytics",
  "posthog-product-analytics",
  "slack-channel-engagement",
  "slack-internal-comms",
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
    case "hubspot-marketing-contacts":
      return (await import("./hubspot-marketing-contacts")).default;
    case "hubspot-sales-crm":
      return (await import("./hubspot-sales-crm")).default;
    case "linear-issue-management":
      return (await import("./linear-issue-management")).default;
    case "linear-sprint-planning":
      return (await import("./linear-sprint-planning")).default;
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
    case "slack-channel-engagement":
      return (await import("./slack-channel-engagement")).default;
    case "slack-internal-comms":
      return (await import("./slack-internal-comms")).default;
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
