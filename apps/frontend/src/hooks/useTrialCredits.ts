import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  requestTrialCredits,
  getTrialStatus,
} from "../utils/api";

import { useToast } from "./useToast";

export function useTrialStatus(workspaceId: string) {
  return useQuery({
    queryKey: ["trial-status", workspaceId],
    queryFn: () => getTrialStatus(workspaceId),
    refetchInterval: 60000, // Refetch every 60 seconds for automatic updates
  });
}

export function useRequestTrialCredits() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({
      workspaceId,
      captchaToken,
      reason,
    }: {
      workspaceId: string;
      captchaToken: string;
      reason: string;
    }) => requestTrialCredits(workspaceId, captchaToken, reason),
    onSuccess: () => {
      // Invalidate trial status to refetch
      queryClient.invalidateQueries({ queryKey: ["trial-status"] });
      toast.success("Trial credit request submitted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to request trial credits");
    },
  });
}

