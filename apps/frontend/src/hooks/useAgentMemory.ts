import { useQuery } from "@tanstack/react-query";

import { getAgentMemory, type AgentMemoryOptions } from "../utils/api";

export function useAgentMemory(
  workspaceId: string,
  agentId: string,
  options: AgentMemoryOptions = {}
) {
  return useQuery({
    queryKey: ["agent-memory", workspaceId, agentId, options],
    queryFn: () => getAgentMemory(workspaceId, agentId, options),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}


