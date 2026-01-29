import { useQuery } from "@tanstack/react-query";

import {
  getAgentKnowledgeGraph,
  type AgentKnowledgeGraphOptions,
} from "../utils/api";

export function useAgentKnowledgeGraph(
  workspaceId: string,
  agentId: string,
  options: AgentKnowledgeGraphOptions = {},
) {
  return useQuery({
    queryKey: ["agent-knowledge-graph", workspaceId, agentId, options],
    queryFn: () => getAgentKnowledgeGraph(workspaceId, agentId, options),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
