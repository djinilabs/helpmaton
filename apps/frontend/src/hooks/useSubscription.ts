import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  getSubscription,
  getUserByEmail,
  addSubscriptionManager,
  removeSubscriptionManager,
} from "../utils/api";

import { useToast } from "./useToast";

export function useSubscription() {
  return useQuery({
    queryKey: ["subscription"],
    queryFn: () => getSubscription(),
  });
}

export function useUserByEmail(email: string | null) {
  return useQuery({
    queryKey: ["userByEmail", email],
    queryFn: () => getUserByEmail(email!),
    enabled: !!email && email.trim().length > 0,
    retry: false,
  });
}

export function useAddSubscriptionManager() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (userId: string) => addSubscriptionManager(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
      toast.success("Manager added successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to add manager");
    },
  });
}

export function useRemoveSubscriptionManager() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (userId: string) => removeSubscriptionManager(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
      toast.success("Manager removed successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to remove manager");
    },
  });
}

