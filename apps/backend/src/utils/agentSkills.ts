/**
 * Agent skills: load skill definitions from the skills folder, filter by
 * tool requirements, and merge skill content into the agent system prompt.
 * Skills are loaded lazily on first use and cached.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";

export type RequiredTool =
  | { type: "mcpService"; serviceType: string }
  | { type: "builtin"; tool: string };

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  role?: string;
  requiredTools: RequiredTool[];
  content: string;
}

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

const BUILTIN_IDS = [
  "search_documents",
  "search_memory",
  "search_web",
  "fetch_web",
  "exa_search",
  "send_email",
  "image_generation",
] as const;

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

/** Paths to try in order: Lambda (skills copied next to handler), then dev (src/skills). */
function getDefaultSkillsDirCandidates(): string[] {
  return [
    path.join(__dirname, "skills"),
    path.join(__dirname, "..", "skills"),
  ];
}

function parseRequiredTools(raw: unknown): RequiredTool[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }
  const result: RequiredTool[] = [];
  for (const item of raw) {
    if (item && typeof item === "object" && "type" in item) {
      const t = (item as { type: string }).type;
      if (t === "mcpService" && "serviceType" in item) {
        const st = (item as { serviceType: unknown }).serviceType;
        if (typeof st === "string" && st.length > 0) {
          result.push({ type: "mcpService", serviceType: st });
        }
      } else if (t === "builtin" && "tool" in item) {
        const tool = (item as { tool: unknown }).tool;
        if (typeof tool === "string" && BUILTIN_IDS.includes(tool as (typeof BUILTIN_IDS)[number])) {
          result.push({ type: "builtin", tool });
        }
      }
    }
  }
  return result;
}

function parseSkillFromFrontmatter(
  id: string,
  content: string,
  frontmatter: Record<string, unknown>
): AgentSkill | null {
  const name = frontmatter.name;
  const description = frontmatter.description;
  const requiredTools = parseRequiredTools(frontmatter.requiredTools);
  if (
    typeof name !== "string" ||
    name.trim() === "" ||
    typeof description !== "string" ||
    description.trim() === "" ||
    requiredTools.length === 0
  ) {
    return null;
  }
  const role =
    typeof frontmatter.role === "string" && frontmatter.role.trim() !== ""
      ? frontmatter.role.trim()
      : undefined;
  return {
    id,
    name: name.trim(),
    description: description.trim(),
    role,
    requiredTools,
    content: content.trim(),
  };
}

let loadPromise: Promise<AgentSkill[]> | null = null;

/**
 * Load all skills from the skills folder. Lazy: loads on first call and caches.
 * Validates requiredTools non-empty; skips malformed skills.
 */
async function loadSkillsFromFolderAsync(skillsDir?: string): Promise<AgentSkill[]> {
  if (skillsCache !== null) {
    return skillsCache;
  }
  if (loadPromise !== null) {
    return loadPromise;
  }
  const dirsToTry = skillsDir
    ? [skillsDir]
    : getDefaultSkillsDirCandidates();
  loadPromise = (async () => {
    const skills: AgentSkill[] = [];
    let dir: string | null = null;
    let entries: { name: string; isDirectory: () => boolean }[] = [];
    for (const d of dirsToTry) {
      try {
        entries = await readdir(d, { withFileTypes: true });
        dir = d;
        break;
      } catch {
        continue;
      }
    }
    if (dir === null) {
      loadPromise = null;
      return skills;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      if (!/^[a-z0-9-]+$/.test(id)) continue;
      const skillPath = path.join(dir, id, "SKILL.md");
      let raw: string;
      try {
        raw = await readFile(skillPath, "utf-8");
      } catch {
        continue;
      }
      const parsed = matter(raw);
      const skill = parseSkillFromFrontmatter(
        id,
        parsed.content,
        parsed.data as Record<string, unknown>
      );
      if (skill) {
        skills.push(skill);
      }
    }
    skillsCache = skills;
    loadPromise = null;
    return skills;
  })();
  return loadPromise;
}

function satisfiesBuiltin(
  tool: string,
  agent: AgentForSkills,
  hasEmailConnection?: boolean
): boolean {
  switch (tool) {
    case "search_documents":
      return agent.enableSearchDocuments === true;
    case "search_memory":
      return agent.enableMemorySearch === true;
    case "search_web":
      return (
        agent.searchWebProvider === "tavily" || agent.searchWebProvider === "jina"
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
      return (
        agent.enableSendEmail === true && hasEmailConnection === true
      );
    case "image_generation":
      return agent.enableImageGeneration === true;
    default:
      return false;
  }
}

function satisfiesMcpService(
  serviceType: string,
  enabledMcpServers: McpServerForSkills[]
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
  hasEmailConnection?: boolean
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
 * Lazy-loads skills on first call.
 */
export async function getAvailableSkills(
  agent: AgentForSkills,
  enabledMcpServers: McpServerForSkills[],
  options?: { hasEmailConnection?: boolean; skillsDir?: string }
): Promise<AgentSkill[]> {
  const skills = await loadSkillsFromFolderAsync(options?.skillsDir);
  const hasEmailConnection = options?.hasEmailConnection;
  return skills.filter((skill) =>
    skillRequirementsSatisfied(
      skill,
      agent,
      enabledMcpServers,
      hasEmailConnection
    )
  );
}

/**
 * Build system prompt by appending enabled skill contents. Dedupes skillIds,
 * preserves order, skips invalid IDs. Returns basePrompt unchanged if no valid skills.
 */
export async function buildSystemPromptWithSkills(
  basePrompt: string,
  skillIds: string[] | undefined,
  options?: { skillsDir?: string }
): Promise<string> {
  if (!skillIds || skillIds.length === 0) {
    return basePrompt;
  }
  const all = await loadSkillsFromFolderAsync(options?.skillsDir);
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
 * Load all skills from the skills folder. Lazy-loads on first call and caches.
 * Exported for tests and explicit load.
 */
export async function loadSkillsFromFolder(skillsDir?: string): Promise<AgentSkill[]> {
  return loadSkillsFromFolderAsync(skillsDir);
}

/**
 * Get all loaded skills (for available-skills API). Lazy-loads on first call.
 */
export async function getAllSkills(skillsDir?: string): Promise<AgentSkill[]> {
  return loadSkillsFromFolderAsync(skillsDir);
}

/**
 * Group skills by role for UI. Skills with no role go under "other".
 */
export function groupSkillsByRole(skills: AgentSkill[]): Record<string, AgentSkill[]> {
  const grouped: Record<string, AgentSkill[]> = {};
  for (const skill of skills) {
    const role = skill.role?.trim() && skill.role !== "other" ? skill.role : "other";
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
}
