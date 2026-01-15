import { useQuery } from "@tanstack/react-query";

import {
  getWorkspaceUsage,
  getWorkspaceDailyUsage,
  getAgentUsage,
  getAgentDailyUsage,
  getUserUsage,
  getUserDailyUsage,
  type UsageOptions,
} from "../utils/api";

export function useWorkspaceUsage(
  workspaceId: string,
  options: UsageOptions = {}
) {
  return useQuery({
    queryKey: ["workspace-usage", workspaceId, options],
    queryFn: () => getWorkspaceUsage(workspaceId, options),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useWorkspaceDailyUsage(
  workspaceId: string,
  options: UsageOptions = {}
) {
  return useQuery({
    queryKey: ["workspace-daily-usage", workspaceId, options],
    queryFn: () => getWorkspaceDailyUsage(workspaceId, options),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useAgentUsage(
  workspaceId: string,
  agentId: string,
  options: UsageOptions = {}
) {
  return useQuery({
    queryKey: ["agent-usage", workspaceId, agentId, options],
    queryFn: () => getAgentUsage(workspaceId, agentId, options),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useAgentDailyUsage(
  workspaceId: string,
  agentId: string,
  options: UsageOptions = {}
) {
  return useQuery({
    queryKey: ["agent-daily-usage", workspaceId, agentId, options],
    queryFn: () => getAgentDailyUsage(workspaceId, agentId, options),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useUserUsage(options: UsageOptions = {}) {
  return useQuery({
    queryKey: ["user-usage", options],
    queryFn: () => getUserUsage(options),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useUserDailyUsage(options: UsageOptions = {}) {
  return useQuery({
    queryKey: ["user-daily-usage", options],
    queryFn: () => getUserDailyUsage(options),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

