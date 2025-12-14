import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import {
  getStreamServer,
  createStreamServer,
  updateStreamServer,
  deleteStreamServer,
  type CreateStreamServerInput,
  type UpdateStreamServerInput,
} from "../utils/api";

import { useToast } from "./useToast";

export function useStreamServer(workspaceId: string, agentId: string) {
  return useQuery({
    queryKey: ["workspaces", workspaceId, "agents", agentId, "stream-server"],
    queryFn: async () => {
      return await getStreamServer(workspaceId, agentId);
    },
  });
}

export function useCreateStreamServer(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: CreateStreamServerInput) =>
      createStreamServer(workspaceId, agentId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents", agentId, "stream-server"],
      });
      toast.success("Stream server created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create stream server");
    },
  });
}

export function useUpdateStreamServer(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: UpdateStreamServerInput) =>
      updateStreamServer(workspaceId, agentId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents", agentId, "stream-server"],
      });
      toast.success("Stream server updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update stream server");
    },
  });
}

export function useDeleteStreamServer(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: () => deleteStreamServer(workspaceId, agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents", agentId, "stream-server"],
      });
      toast.success("Stream server deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete stream server");
    },
  });
}

