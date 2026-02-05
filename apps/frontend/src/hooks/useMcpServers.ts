import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";

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

export function useMcpServersInfinite(workspaceId: string, pageSize = 50) {
  return useInfiniteQuery({
    queryKey: ["workspaces", workspaceId, "mcp-servers", "infinite"],
    queryFn: async ({ pageParam }) => {
      const result = await listMcpServers(workspaceId, pageSize, pageParam);
      return result;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
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
      toast.success("Connected tool created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create connected tool");
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
      toast.success("Connected tool updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update connected tool");
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
      toast.success("Connected tool deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete connected tool");
    },
  });
}

