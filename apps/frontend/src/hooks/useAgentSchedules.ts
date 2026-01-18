import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  listAgentSchedules,
  getAgentSchedule,
  createAgentSchedule,
  updateAgentSchedule,
  deleteAgentSchedule,
  type CreateAgentScheduleInput,
  type UpdateAgentScheduleInput,
} from "../utils/api";

import { useToast } from "./useToast";

export function useAgentSchedules(workspaceId: string, agentId: string) {
  return useQuery({
    queryKey: ["workspaces", workspaceId, "agents", agentId, "schedules"],
    queryFn: () => listAgentSchedules(workspaceId, agentId),
    enabled: !!workspaceId && !!agentId,
  });
}

export function useAgentSchedule(
  workspaceId: string,
  agentId: string,
  scheduleId: string
) {
  return useQuery({
    queryKey: [
      "workspaces",
      workspaceId,
      "agents",
      agentId,
      "schedules",
      scheduleId,
    ],
    queryFn: () => getAgentSchedule(workspaceId, agentId, scheduleId),
    enabled: !!workspaceId && !!agentId && !!scheduleId,
  });
}

export function useCreateAgentSchedule(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: CreateAgentScheduleInput) =>
      createAgentSchedule(workspaceId, agentId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents", agentId, "schedules"],
      });
      toast.success("Schedule created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create schedule");
    },
  });
}

export function useUpdateAgentSchedule(
  workspaceId: string,
  agentId: string,
  scheduleId: string
) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: UpdateAgentScheduleInput) =>
      updateAgentSchedule(workspaceId, agentId, scheduleId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents", agentId, "schedules"],
      });
      queryClient.invalidateQueries({
        queryKey: [
          "workspaces",
          workspaceId,
          "agents",
          agentId,
          "schedules",
          scheduleId,
        ],
      });
      toast.success("Schedule updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update schedule");
    },
  });
}

export function useDeleteAgentSchedule(
  workspaceId: string,
  agentId: string,
  scheduleId: string
) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: () => deleteAgentSchedule(workspaceId, agentId, scheduleId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents", agentId, "schedules"],
      });
      queryClient.removeQueries({
        queryKey: [
          "workspaces",
          workspaceId,
          "agents",
          agentId,
          "schedules",
          scheduleId,
        ],
      });
      toast.success("Schedule deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete schedule");
    },
  });
}
