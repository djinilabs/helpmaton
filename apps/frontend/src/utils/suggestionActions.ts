import {
  AGENT_SECTION_IDS,
  WORKSPACE_SECTION_IDS,
} from "../constants/sectionIds";

import type { SuggestionActionType } from "./api";

/** Action the client can run: expand section + scroll, or open edit modal. */
export type SuggestionActionPayload =
  | { label: string; sectionId: string }
  | { label: string; openEdit: true };

/**
 * Returns the action payload for a suggestion type so the client can expand
 * the right accordion (and scroll) or open the agent edit modal.
 */
export function getSuggestionAction(
  actionType: SuggestionActionType,
  _workspaceId: string,
  agentId?: string,
): SuggestionActionPayload | null {
  const map: Record<
    SuggestionActionType,
    SuggestionActionPayload | null
  > = {
    workspace_api_keys: {
      label: "API keys",
      sectionId: WORKSPACE_SECTION_IDS.apiKey,
    },
    workspace_spending_limits: {
      label: "Spending limits",
      sectionId: WORKSPACE_SECTION_IDS.spendingLimits,
    },
    workspace_team: {
      label: "Team",
      sectionId: WORKSPACE_SECTION_IDS.team,
    },
    workspace_documents: {
      label: "Documents",
      sectionId: WORKSPACE_SECTION_IDS.documents,
    },
    workspace_agents: {
      label: "Agents",
      sectionId: WORKSPACE_SECTION_IDS.agents,
    },
    workspace_integrations: {
      label: "Integrations",
      sectionId: WORKSPACE_SECTION_IDS.mcpServers,
    },
    workspace_credits: {
      label: "Credits",
      sectionId: WORKSPACE_SECTION_IDS.credits,
    },
    agent_model:
      agentId != null
        ? { label: "Model", openEdit: true }
        : null,
    agent_memory:
      agentId != null
        ? { label: "Memory", sectionId: AGENT_SECTION_IDS.memory }
        : null,
    agent_tools:
      agentId != null
        ? {
            label: "Connected tools",
            sectionId: AGENT_SECTION_IDS.mcpServers,
          }
        : null,
  };

  return map[actionType] ?? null;
}
