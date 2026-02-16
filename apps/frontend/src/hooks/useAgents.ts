import {
  useSuspenseQuery,
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";

import {
  listAgents,
  getAgent,
  getAgentSuggestions,
  createAgent,
  updateAgent,
  deleteAgent,
  getAgentKeys,
  createAgentKey,
  deleteAgentKey,
  generatePrompt,
  dismissAgentSuggestion,
  improvePromptFromEvals,
  type Agent,
  type CreateAgentInput,
  type UpdateAgentInput,
  type CreateAgentKeyInput,
  type ImprovePromptFromEvalsInput,
} from "../utils/api";

import { useToast } from "./useToast";

export function useAgents(workspaceId: string) {
  return useSuspenseQuery({
    queryKey: ["workspaces", workspaceId, "agents"],
    queryFn: async () => {
      const result = await listAgents(workspaceId, 100);
      return result.agents;
    },
  });
}

export function useAgentsInfinite(workspaceId: string, pageSize = 50) {
  return useInfiniteQuery({
    queryKey: ["workspaces", workspaceId, "agents", "infinite"],
    queryFn: async ({ pageParam }) => {
      const result = await listAgents(workspaceId, pageSize, pageParam);
      return result;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useAgent(workspaceId: string, agentId: string) {
  return useSuspenseQuery({
    queryKey: ["workspaces", workspaceId, "agents", agentId],
    queryFn: () => getAgent(workspaceId, agentId),
  });
}

/**
 * Optional version of useAgent that uses useQuery instead of useSuspenseQuery.
 * This allows the query to be disabled or fail without throwing, which is useful
 * in widget contexts where authentication may not be available.
 *
 * Note: This hook always uses useQuery (not useSuspenseQuery) to avoid throwing errors
 * in widget contexts. For normal app usage where suspense is desired, use useAgent instead.
 *
 * @param skip - If true, the query will be disabled and won't execute (widget context)
 */
export function useAgentOptional(
  workspaceId: string,
  agentId: string,
  skip: boolean = false,
) {
  return useQuery({
    queryKey: ["workspaces", workspaceId, "agents", agentId],
    queryFn: () => getAgent(workspaceId, agentId),
    enabled: !skip, // Disable query when skip is true (e.g., when agent prop is provided)
    retry: false, // Don't retry on failure in widget context
  });
}

export function useCreateAgent(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: CreateAgentInput) => createAgent(workspaceId, input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents"],
      });
      queryClient.setQueryData(
        ["workspaces", workspaceId, "agents", data.id],
        data,
      );
      toast.success("Agent created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create agent");
    },
  });
}

export function useUpdateAgent(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: UpdateAgentInput) =>
      updateAgent(workspaceId, agentId, input),
    onSuccess: async (data) => {
      // Merge PUT response into cache so form fields update immediately. Preserve contextStats and modelInfo
      // from previous cache (PUT does not return them); refetch will replace with fresh stats for the new settings.
      queryClient.setQueryData(
        ["workspaces", workspaceId, "agents", agentId],
        (prev: Agent | undefined) => {
          if (!prev) return data as Agent;
          return {
            ...prev,
            ...data,
            contextStats: data.contextStats ?? prev.contextStats,
            modelInfo: data.modelInfo ?? prev.modelInfo,
          } as Agent;
        },
      );
      // Invalidate the single-agent query so it refetches (GET returns contextStats, modelInfo, etc.)
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents", agentId],
      });
      // Invalidate only list queries (not single-agent, keys, or suggestions) so list view reflects the update without extra refetches
      queryClient.invalidateQueries({
        predicate: (query) => {
          const queryKey = query.queryKey;
          return (
            Array.isArray(queryKey) &&
            queryKey[0] === "workspaces" &&
            queryKey[1] === workspaceId &&
            queryKey[2] === "agents" &&
            (queryKey.length === 3 ||
              (queryKey.length === 4 && queryKey[3] === "infinite"))
          );
        },
      });
      queryClient.invalidateQueries({
        queryKey: ["agent-tools", workspaceId, agentId],
      });
      queryClient.invalidateQueries({
        predicate: (query) => {
          const queryKey = query.queryKey;
          return (
            Array.isArray(queryKey) &&
            queryKey.length >= 2 &&
            queryKey[0] === "mcp-server-tools" &&
            queryKey[1] === workspaceId
          );
        },
      });
      queryClient.invalidateQueries({
        queryKey: ["available-skills", workspaceId, agentId],
      });
      toast.success("Agent updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update agent");
    },
  });
}

export function useDeleteAgent(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: () => deleteAgent(workspaceId, agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents"],
      });
      queryClient.removeQueries({
        queryKey: ["workspaces", workspaceId, "agents", agentId],
      });
      toast.success("Agent deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete agent");
    },
  });
}

export function useAgentKeys(workspaceId: string, agentId: string) {
  return useSuspenseQuery({
    queryKey: ["workspaces", workspaceId, "agents", agentId, "keys"],
    queryFn: async () => {
      const result = await getAgentKeys(workspaceId, agentId);
      return result.keys;
    },
  });
}

export function useCreateAgentKey(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: CreateAgentKeyInput) =>
      createAgentKey(workspaceId, agentId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents", agentId, "keys"],
      });
      toast.success("Key created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create key");
    },
  });
}

export function useDeleteAgentKey(
  workspaceId: string,
  agentId: string,
  keyId: string,
) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: () => deleteAgentKey(workspaceId, agentId, keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents", agentId, "keys"],
      });
      toast.success("Key deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete key");
    },
  });
}

export function useGeneratePrompt(workspaceId: string) {
  const toast = useToast();

  return useMutation({
    mutationFn: (input: { goal: string; agentId?: string }) =>
      generatePrompt(workspaceId, input),
    onError: (error: Error) => {
      toast.error(error.message || "Failed to generate prompt");
    },
  });
}

export function useAgentSuggestions(workspaceId: string, agentId: string) {
  return useQuery({
    queryKey: ["workspaces", workspaceId, "agents", agentId, "suggestions"],
    queryFn: () => getAgentSuggestions(workspaceId, agentId),
    enabled: !!workspaceId && !!agentId,
  });
}

export function useDismissAgentSuggestion(
  workspaceId: string,
  agentId: string,
) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (suggestionId: string) =>
      dismissAgentSuggestion(workspaceId, agentId, suggestionId),
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["workspaces", workspaceId, "agents", agentId, "suggestions"],
        () => ({ suggestions: data.suggestions }),
      );
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to dismiss suggestion");
    },
  });
}

export function useImproveAgentPrompt(workspaceId: string, agentId: string) {
  const toast = useToast();

  return useMutation({
    mutationFn: (input: ImprovePromptFromEvalsInput) =>
      improvePromptFromEvals(workspaceId, agentId, input),
    onError: (error: Error) => {
      toast.error(error.message || "Failed to improve prompt");
    },
  });
}
