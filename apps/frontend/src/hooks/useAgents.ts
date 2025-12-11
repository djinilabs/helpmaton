import {
  useSuspenseQuery,
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
      // Invalidate the list query to ensure it reflects the update
      // We don't invalidate the specific agent query since we've already set it with fresh data
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents"],
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
