import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  addWorkspaceSpendingLimit,
  updateWorkspaceSpendingLimit,
  removeWorkspaceSpendingLimit,
  addAgentSpendingLimit,
  updateAgentSpendingLimit,
  removeAgentSpendingLimit,
  type SpendingLimit,
} from "../utils/api";

import { useToast } from "./useToast";

export function useAddWorkspaceSpendingLimit(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (limit: SpendingLimit) =>
      addWorkspaceSpendingLimit(workspaceId, limit),
    onSuccess: (data) => {
      // Update the workspace cache with the new data
      queryClient.setQueryData(["workspaces", workspaceId], data);
      queryClient.invalidateQueries({ queryKey: ["workspaces", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Spending limit added successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to add spending limit");
    },
  });
}

export function useUpdateWorkspaceSpendingLimit(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({
      timeFrame,
      amount,
    }: {
      timeFrame: "daily" | "weekly" | "monthly";
      amount: number;
    }) => updateWorkspaceSpendingLimit(workspaceId, timeFrame, amount),
    onSuccess: (data) => {
      // Update the workspace cache with the new data
      queryClient.setQueryData(["workspaces", workspaceId], data);
      queryClient.invalidateQueries({ queryKey: ["workspaces", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Spending limit updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update spending limit");
    },
  });
}

export function useRemoveWorkspaceSpendingLimit(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (timeFrame: "daily" | "weekly" | "monthly") =>
      removeWorkspaceSpendingLimit(workspaceId, timeFrame),
    onSuccess: (data) => {
      // Update the workspace cache with the new data
      queryClient.setQueryData(["workspaces", workspaceId], data);
      queryClient.invalidateQueries({ queryKey: ["workspaces", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Spending limit removed successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to remove spending limit");
    },
  });
}

export function useAddAgentSpendingLimit(
  workspaceId: string,
  agentId: string
) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (limit: SpendingLimit) =>
      addAgentSpendingLimit(workspaceId, agentId, limit),
    onSuccess: (data) => {
      // Update the agent cache with the new data - use correct query key
      queryClient.setQueryData(
        ["workspaces", workspaceId, "agents", agentId],
        data
      );
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents", agentId],
      });
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents"],
      });
      toast.success("Spending limit added successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to add spending limit");
    },
  });
}

export function useUpdateAgentSpendingLimit(
  workspaceId: string,
  agentId: string
) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({
      timeFrame,
      amount,
    }: {
      timeFrame: "daily" | "weekly" | "monthly";
      amount: number;
    }) => updateAgentSpendingLimit(workspaceId, agentId, timeFrame, amount),
    onSuccess: (data) => {
      // Update the agent cache with the new data - use correct query key
      queryClient.setQueryData(
        ["workspaces", workspaceId, "agents", agentId],
        data
      );
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents", agentId],
      });
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents"],
      });
      toast.success("Spending limit updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update spending limit");
    },
  });
}

export function useRemoveAgentSpendingLimit(
  workspaceId: string,
  agentId: string
) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (timeFrame: "daily" | "weekly" | "monthly") =>
      removeAgentSpendingLimit(workspaceId, agentId, timeFrame),
    onSuccess: (data) => {
      // Update the agent cache with the new data - use correct query key
      queryClient.setQueryData(
        ["workspaces", workspaceId, "agents", agentId],
        data
      );
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents", agentId],
      });
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents"],
      });
      toast.success("Spending limit removed successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to remove spending limit");
    },
  });
}

