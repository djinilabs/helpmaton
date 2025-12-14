import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  listMcpServers,
  getMcpServer,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  type CreateMcpServerInput,
  type UpdateMcpServerInput,
} from "../utils/api";

import { useToast } from "./useToast";

export function useMcpServers(workspaceId: string) {
  return useQuery({
    queryKey: ["workspaces", workspaceId, "mcp-servers"],
    queryFn: () => listMcpServers(workspaceId),
  });
}

export function useMcpServer(workspaceId: string, serverId: string) {
  return useQuery({
    queryKey: ["workspaces", workspaceId, "mcp-servers", serverId],
    queryFn: () => getMcpServer(workspaceId, serverId),
    enabled: !!serverId,
  });
}

export function useCreateMcpServer(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: CreateMcpServerInput) =>
      createMcpServer(workspaceId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "mcp-servers"],
      });
      toast.success("MCP server created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create MCP server");
    },
  });
}

export function useUpdateMcpServer(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({
      serverId,
      input,
    }: {
      serverId: string;
      input: UpdateMcpServerInput;
    }) => updateMcpServer(workspaceId, serverId, input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "mcp-servers"],
      });
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "mcp-servers", variables.serverId],
      });
      toast.success("MCP server updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update MCP server");
    },
  });
}

export function useDeleteMcpServer(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (serverId: string) => deleteMcpServer(workspaceId, serverId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "mcp-servers"],
      });
      toast.success("MCP server deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete MCP server");
    },
  });
}

