import {
  useSuspenseQuery,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  getAgentKeys,
  createAgentKey,
  deleteAgentKey,
  generatePrompt,
  type CreateAgentInput,
  type UpdateAgentInput,
  type CreateAgentKeyInput,
} from "../utils/api";

import { useToast } from "./useToast";

export function useAgents(workspaceId: string) {
  return useSuspenseQuery({
    queryKey: ["workspaces", workspaceId, "agents"],
    queryFn: async () => {
      const result = await listAgents(workspaceId);
      return result.agents;
    },
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
  skip: boolean = false
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
        data
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
      // Update the specific agent query cache with the response data
      // This ensures the UI immediately reflects the update without waiting for a refetch
      queryClient.setQueryData(
        ["workspaces", workspaceId, "agents", agentId],
        data
      );
      // Invalidate only the list query (not the specific agent query) to ensure it reflects the update
      // We use a predicate to only match the exact list query key, not the specific agent query
      queryClient.invalidateQueries({
        predicate: (query) => {
          const queryKey = query.queryKey;
          // Only invalidate the exact list query: ["workspaces", workspaceId, "agents"]
          return (
            Array.isArray(queryKey) &&
            queryKey.length === 3 &&
            queryKey[0] === "workspaces" &&
            queryKey[1] === workspaceId &&
            queryKey[2] === "agents"
          );
        },
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
  keyId: string
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
