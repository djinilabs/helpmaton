import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import {
  getWorkspaceMembers,
  getWorkspaceInvites,
} from "../utils/api";

const PAGE_SIZE = 50;

export function useWorkspaceMembers(workspaceId: string) {
  return useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: () => getWorkspaceMembers(workspaceId),
  });
}

export function useWorkspaceMembersInfinite(workspaceId: string, pageSize = PAGE_SIZE) {
  return useInfiniteQuery({
    queryKey: ["workspace-members", workspaceId, "infinite"],
    queryFn: async ({ pageParam }) => {
      const result = await getWorkspaceMembers(workspaceId, pageSize, pageParam);
      return result;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useWorkspaceInvites(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: ["workspace-invites", workspaceId],
    queryFn: () => getWorkspaceInvites(workspaceId),
    enabled,
  });
}

export function useWorkspaceInvitesInfinite(
  workspaceId: string,
  options: { enabled?: boolean; pageSize?: number } = {}
) {
  const { enabled = true, pageSize = PAGE_SIZE } = options;
  return useInfiniteQuery({
    queryKey: ["workspace-invites", workspaceId, "infinite"],
    queryFn: async ({ pageParam }) => {
      const result = await getWorkspaceInvites(workspaceId, pageSize, pageParam);
      return result;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
  });
}
