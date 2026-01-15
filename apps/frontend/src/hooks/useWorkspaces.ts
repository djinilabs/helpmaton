import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  exportWorkspace,
  importWorkspace,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  type WorkspaceExport,
} from "../utils/api";

import { useToast } from "./useToast";

export function useWorkspaces() {
  return useSuspenseQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const result = await listWorkspaces();
      return result.workspaces;
    },
  });
}

export function useWorkspace(id: string) {
  return useSuspenseQuery({
    queryKey: ["workspaces", id],
    queryFn: () => getWorkspace(id),
    refetchOnMount: "always", // Always refetch when component mounts (on navigation)
    staleTime: 0, // Consider data stale immediately to force refetch
  });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: CreateWorkspaceInput) => createWorkspace(input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.setQueryData(["workspaces", data.id], data);
      toast.success("Workspace created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create workspace");
    },
  });
}

export function useUpdateWorkspace(id: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: UpdateWorkspaceInput) => updateWorkspace(id, input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.setQueryData(["workspaces", id], data);
      toast.success("Workspace updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update workspace");
    },
  });
}

export function useDeleteWorkspace(id: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: () => deleteWorkspace(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.removeQueries({ queryKey: ["workspaces", id] });
      toast.success("Workspace deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete workspace");
    },
  });
}

export function useExportWorkspace(workspaceId: string) {
  const toast = useToast();

  return useMutation({
    mutationFn: () => exportWorkspace(workspaceId),
    onSuccess: () => {
      toast.success("Workspace exported successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to export workspace");
    },
  });
}

export function useImportWorkspace() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (exportData: WorkspaceExport) => importWorkspace(exportData),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.setQueryData(["workspaces", data.id], data);
      toast.success("Workspace imported successfully");
      return data;
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to import workspace");
    },
  });
}

