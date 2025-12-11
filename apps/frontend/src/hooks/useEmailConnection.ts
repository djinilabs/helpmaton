import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  getEmailConnection,
  createOrUpdateEmailConnection,
  updateEmailConnection,
  deleteEmailConnection,
  testEmailConnection,
  initiateOAuthFlow,
  type CreateEmailConnectionInput,
  type UpdateEmailConnectionInput,
} from "../utils/api";

import { useToast } from "./useToast";

export function useEmailConnection(workspaceId: string) {
  return useQuery({
    queryKey: ["workspaces", workspaceId, "email-connection"],
    queryFn: () => getEmailConnection(workspaceId),
  });
}

export function useCreateOrUpdateEmailConnection(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: CreateEmailConnectionInput) =>
      createOrUpdateEmailConnection(workspaceId, input),
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["workspaces", workspaceId, "email-connection"],
        data
      );
      toast.success("Email connection saved successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to save email connection");
    },
  });
}

export function useUpdateEmailConnection(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: UpdateEmailConnectionInput) =>
      updateEmailConnection(workspaceId, input),
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["workspaces", workspaceId, "email-connection"],
        data
      );
      toast.success("Email connection updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update email connection");
    },
  });
}

export function useDeleteEmailConnection(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: () => deleteEmailConnection(workspaceId),
    onSuccess: () => {
      queryClient.setQueryData(
        ["workspaces", workspaceId, "email-connection"],
        null
      );
      toast.success("Email connection deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete email connection");
    },
  });
}

export function useTestEmailConnection(workspaceId: string) {
  const toast = useToast();

  return useMutation({
    mutationFn: () => testEmailConnection(workspaceId),
    onSuccess: (data) => {
      toast.success(data.message || "Test email sent successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to send test email");
    },
  });
}

export function useInitiateOAuthFlow(workspaceId: string) {
  const toast = useToast();

  return useMutation({
    mutationFn: (provider: "gmail" | "outlook") =>
      initiateOAuthFlow(workspaceId, provider),
    onSuccess: (data) => {
      // Redirect to OAuth URL
      window.location.href = data.authUrl;
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to initiate OAuth flow");
    },
  });
}

