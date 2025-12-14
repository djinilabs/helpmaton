import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  listChannels,
  getChannel,
  createChannel,
  updateChannel,
  deleteChannel,
  testChannel,
  type CreateChannelInput,
  type UpdateChannelInput,
} from "../utils/api";

import { useToast } from "./useToast";

export function useChannels(workspaceId: string) {
  return useSuspenseQuery({
    queryKey: ["workspaces", workspaceId, "channels"],
    queryFn: async () => {
      const result = await listChannels(workspaceId);
      return result.channels;
    },
  });
}

export function useChannel(workspaceId: string, channelId: string) {
  return useSuspenseQuery({
    queryKey: ["workspaces", workspaceId, "channels", channelId],
    queryFn: () => getChannel(workspaceId, channelId),
  });
}

export function useCreateChannel(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: CreateChannelInput) => createChannel(workspaceId, input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "channels"],
      });
      queryClient.setQueryData(
        ["workspaces", workspaceId, "channels", data.id],
        data
      );
      toast.success("Channel created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create channel");
    },
  });
}

export function useUpdateChannel(workspaceId: string, channelId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: UpdateChannelInput) =>
      updateChannel(workspaceId, channelId, input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "channels"],
      });
      queryClient.setQueryData(
        ["workspaces", workspaceId, "channels", channelId],
        data
      );
      toast.success("Channel updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update channel");
    },
  });
}

export function useDeleteChannel(workspaceId: string, channelId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: () => deleteChannel(workspaceId, channelId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "channels"],
      });
      queryClient.removeQueries({
        queryKey: ["workspaces", workspaceId, "channels", channelId],
      });
      toast.success("Channel deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete channel");
    },
  });
}

export function useTestChannel(workspaceId: string, channelId: string) {
  const toast = useToast();

  return useMutation({
    mutationFn: () => testChannel(workspaceId, channelId),
    onSuccess: (data) => {
      toast.success(data.message || "Test message sent successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to send test message");
    },
  });
}

