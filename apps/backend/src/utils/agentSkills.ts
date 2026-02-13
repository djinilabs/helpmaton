/**
 * Agent skills: filter by tool requirements and merge skill content into the agent system prompt.
 * Skills are loaded via hard-coded dynamic imports (registry), not the filesystem. Lazy on first use, then cached.
 */

import { loadAllSkills } from "../skills/registry";
import type { AgentSkill } from "../skills/skill";

export type { AgentSkill, RequiredTool } from "../skills/skill";

/** Agent shape used to determine which builtin tools are enabled */
export interface AgentForSkills {
  enableSearchDocuments?: boolean;
  enableMemorySearch?: boolean;
  searchWebProvider?: "tavily" | "jina" | null;
  fetchWebProvider?: "tavily" | "jina" | "scrape" | null;
  enableExaSearch?: boolean;
  enableSendEmail?: boolean;
  enableImageGeneration?: boolean;
}

/** MCP server info used to check mcpService requirements */
export interface McpServerForSkills {
  id: string;
  serviceType?: string;
  oauthConnected?: boolean;
}

/** OAuth-based MCP services: must be connected for the tool to count as enabled */
const OAUTH_SERVICE_TYPES = new Set([
  "notion",
  "linear",
  "hubspot",
  "shopify",
  "salesforce",
  "slack",
  "intercom",
  "todoist",
  "zendesk",
  "stripe",
  "github",
  "google-drive",
  "gmail",
  "google-calendar",
]);

let skillsCache: AgentSkill[] | null = null;
let loadPromise: Promise<AgentSkill[]> | null = null;

/** For tests only: inject a custom loader. Call clearSkillsCache() after test. */
let testSkillLoader: (() => Promise<AgentSkill[]>) | null = null;
export function setSkillLoaderForTests(
  loader: () => Promise<AgentSkill[]>,
): void {
  testSkillLoader = loader;
}

// skillsDir kept for API compatibility but unused (skills loaded via registry)
async function loadSkillsAsync(
  _skillsDir?: string, // eslint-disable-line @typescript-eslint/no-unused-vars
): Promise<AgentSkill[]> {
  if (skillsCache !== null) {
    return skillsCache;
  }
  if (loadPromise !== null) {
    return loadPromise;
  }
  loadPromise = (async () => {
    try {
      const skills = testSkillLoader
        ? await testSkillLoader()
        : await loadAllSkills();
      skillsCache = skills;
      return skills;
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

function satisfiesBuiltin(
  tool: string,
  agent: AgentForSkills,
  hasEmailConnection?: boolean,
): boolean {
  switch (tool) {
    case "search_documents":
      return agent.enableSearchDocuments === true;
    case "search_memory":
      return agent.enableMemorySearch === true;
    case "search_web":
      return (
        agent.searchWebProvider === "tavily" ||
        agent.searchWebProvider === "jina"
      );
    case "fetch_web":
      return (
        agent.fetchWebProvider === "tavily" ||
        agent.fetchWebProvider === "jina" ||
        agent.fetchWebProvider === "scrape"
      );
    case "exa_search":
      return agent.enableExaSearch === true;
    case "send_email":
      return agent.enableSendEmail === true && hasEmailConnection === true;
    case "image_generation":
      return agent.enableImageGeneration === true;
    default:
      return false;
  }
}

function satisfiesMcpService(
  serviceType: string,
  enabledMcpServers: McpServerForSkills[],
): boolean {
  for (const server of enabledMcpServers) {
    if (server.serviceType !== serviceType) continue;
    if (OAUTH_SERVICE_TYPES.has(serviceType) && !server.oauthConnected) {
      continue;
    }
    return true;
  }
  return false;
}

function skillRequirementsSatisfied(
  skill: AgentSkill,
  agent: AgentForSkills,
  enabledMcpServers: McpServerForSkills[],
  hasEmailConnection?: boolean,
): boolean {
  for (const req of skill.requiredTools) {
    if (req.type === "mcpService") {
      if (!satisfiesMcpService(req.serviceType, enabledMcpServers)) {
        return false;
      }
    } else {
      if (!satisfiesBuiltin(req.tool, agent, hasEmailConnection)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Return skills available for the agent (all required tools enabled).
 * Lazy-loads skills on first call (via registry imports).
 */
export async function getAvailableSkills(
  agent: AgentForSkills,
  enabledMcpServers: McpServerForSkills[],
  options?: { hasEmailConnection?: boolean; skillsDir?: string },
): Promise<AgentSkill[]> {
  const skills = await loadSkillsAsync(options?.skillsDir);
  const hasEmailConnection = options?.hasEmailConnection;
  return skills.filter((skill) =>
    skillRequirementsSatisfied(
      skill,
      agent,
      enabledMcpServers,
      hasEmailConnection,
    ),
  );
}

/**
 * Build system prompt by appending enabled skill contents. Dedupes skillIds,
 * preserves order, skips invalid IDs. Returns basePrompt unchanged if no valid skills.
 */
export async function buildSystemPromptWithSkills(
  basePrompt: string,
  skillIds: string[] | undefined,
  options?: { skillsDir?: string },
): Promise<string> {
  if (!skillIds || skillIds.length === 0) {
    return basePrompt;
  }
  const all = await loadSkillsAsync(options?.skillsDir);
  const byId = new Map(all.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const ordered: AgentSkill[] = [];
  for (const id of skillIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const skill = byId.get(id);
    if (skill) {
      ordered.push(skill);
    }
  }
  if (ordered.length === 0) {
    return basePrompt;
  }
  const parts = [basePrompt, "", "---", "## Enabled Skills", ""];
  for (const skill of ordered) {
    parts.push(skill.content, "", "---");
  }
  return parts.join("\n").replace(/\n---\n?$/, "");
}

/**
 * Load all skills. Lazy-loads on first call and caches. Exported for tests.
 * skillsDir is ignored (skills are loaded via registry).
 */
export async function loadSkillsFromFolder(
  skillsDir?: string,
): Promise<AgentSkill[]> {
  return loadSkillsAsync(skillsDir);
}

/**
 * Get all loaded skills (for available-skills API). Lazy-loads on first call.
 */
export async function getAllSkills(skillsDir?: string): Promise<AgentSkill[]> {
  return loadSkillsAsync(skillsDir);
}

/**
 * Group skills by role for UI. Skills with no role or unknown role go under "other".
 * Normalizes role to lowercase for stable API response.
 */
export function groupSkillsByRole(
  skills: AgentSkill[],
): Record<string, AgentSkill[]> {
  const grouped: Record<string, AgentSkill[]> = {};
  for (const skill of skills) {
    const raw = skill.role?.trim().toLowerCase();
    const role = raw && raw !== "other" ? raw : "other";
    if (!grouped[role]) {
      grouped[role] = [];
    }
    grouped[role].push(skill);
  }
  return grouped;
}

/** Reset cache (for tests). */
export function clearSkillsCache(): void {
  skillsCache = null;
  loadPromise = null;
  testSkillLoader = null;
}
