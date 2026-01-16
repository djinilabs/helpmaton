import {
  useInfiniteQuery,
  useQuery,
  useSuspenseQuery,
} from "@tanstack/react-query";

import {
  getAgentConversation,
  listAgentConversations,
} from "../utils/api";

export function useAgentConversations(
  workspaceId: string,
  agentId: string,
  limit: number = 50
) {
  return useInfiniteQuery({
    queryKey: [
      "workspaces",
      workspaceId,
      "agents",
      agentId,
      "conversations",
    ],
    queryFn: async ({ pageParam }) => {
      const result = await listAgentConversations(
        workspaceId,
        agentId,
        limit,
        pageParam
      );
      return result;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useAgentConversation(
  workspaceId: string,
  agentId: string,
  conversationId: string
) {
  return useSuspenseQuery({
    queryKey: [
      "workspaces",
      workspaceId,
      "agents",
      agentId,
      "conversations",
      conversationId,
    ],
    queryFn: () => getAgentConversation(workspaceId, agentId, conversationId),
  });
}

/**
 * Non-suspense version for nested conversations that need loading/error states
 */
export function useAgentConversationNested(
  workspaceId: string,
  agentId: string,
  conversationId: string,
  enabled: boolean = true
) {
  return useQuery({
    queryKey: [
      "workspaces",
      workspaceId,
      "agents",
      agentId,
      "conversations",
      conversationId,
    ],
    queryFn: () => getAgentConversation(workspaceId, agentId, conversationId),
    enabled: enabled && !!workspaceId && !!agentId && !!conversationId,
  });
}

