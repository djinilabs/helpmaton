import { useInfiniteQuery, type UseInfiniteQueryOptions } from "@tanstack/react-query";

import {
  listAgentTransactions,
  listWorkspaceTransactions,
  type ListTransactionsResponse,
} from "../utils/api";

export function useWorkspaceTransactions(
  workspaceId: string,
  limit: number = 50
) {
  return useInfiniteQuery({
    queryKey: ["workspaces", workspaceId, "transactions"],
    queryFn: async ({ pageParam }) => {
      const result = await listWorkspaceTransactions(
        workspaceId,
        limit,
        pageParam
      );
      return result;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useAgentTransactions(
  workspaceId: string,
  agentId: string,
  limit: number = 50,
  options?: Omit<
    UseInfiniteQueryOptions<ListTransactionsResponse, Error>,
    "queryKey" | "queryFn" | "initialPageParam" | "getNextPageParam"
  >
) {
  return useInfiniteQuery({
    queryKey: [
      "workspaces",
      workspaceId,
      "agents",
      agentId,
      "transactions",
    ],
    queryFn: async ({ pageParam }) => {
      const result = await listAgentTransactions(
        workspaceId,
        agentId,
        limit,
        pageParam as string | undefined
      );
      return result;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: ListTransactionsResponse) => lastPage.nextCursor,
    ...options,
  });
}

