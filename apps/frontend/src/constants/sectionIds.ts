/**
 * Section IDs used for in-page anchors (hash links).
 * Suggestion "Go to X" links use these so the app can scroll to the right section.
 *
 * IMPORTANT: These values must match the id attributes in:
 * - WorkspaceDetail.tsx (workspace sections)
 * - AgentDetail.tsx (agent sections)
 *
 * If you rename or add a section id in a page, update this file and suggestionActions.ts
 * so suggestion links still work.
 */
export const WORKSPACE_SECTION_IDS = {
  agents: "agents",
  apiKey: "api-key",
  credits: "credits",
  documents: "documents",
  mcpServers: "mcp-servers",
  spendingLimits: "spending-limits",
  team: "team",
} as const;

export const AGENT_SECTION_IDS = {
  delegation: "delegation",
  documentSearch: "document-search",
  evaluations: "evaluations",
  injectKnowledge: "inject-knowledge",
  memory: "memory",
  mcpServers: "mcp-servers",
  schedules: "schedules",
} as const;
