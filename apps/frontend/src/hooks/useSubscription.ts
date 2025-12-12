import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  getSubscription,
  getUserByEmail,
  addSubscriptionManager,
  removeSubscriptionManager,
  createSubscriptionCheckout,
  cancelSubscription,
  changeSubscriptionPlan,
  getSubscriptionPortalUrl,
  purchaseCredits,
  syncSubscription,
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

export function useSubscriptionCheckout() {
  const toast = useToast();

  return useMutation({
    mutationFn: (plan: "starter" | "pro") => createSubscriptionCheckout(plan),
    onSuccess: (data) => {
      // Redirect to checkout URL
      window.location.href = data.checkoutUrl;
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create checkout");
    },
  });
}

export function useSubscriptionCancel() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: () => cancelSubscription(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
      toast.success("Subscription cancelled successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to cancel subscription");
    },
  });
}

export function useSubscriptionChangePlan() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (plan: "starter" | "pro") => changeSubscriptionPlan(plan),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
      toast.success(data.message || "Plan changed successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to change plan");
    },
  });
}

export function useSubscriptionPortal() {
  return useQuery({
    queryKey: ["subscription", "portal"],
    queryFn: () => getSubscriptionPortalUrl(),
    enabled: false, // Only fetch when explicitly called
  });
}

// Note: queryClient is intentionally unused in useSubscriptionCheckout
// as we redirect immediately and don't need to invalidate queries

export function useCreditPurchase() {
  const toast = useToast();

  return useMutation({
    mutationFn: ({
      workspaceId,
      amount,
    }: {
      workspaceId: string;
      amount: number;
    }) => purchaseCredits(workspaceId, amount),
    onSuccess: (data) => {
      // Redirect to checkout URL
      window.location.href = data.checkoutUrl;
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create checkout");
    },
  });
}

export function useSubscriptionSync() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: () => syncSubscription(),
    onSuccess: (data) => {
      // Invalidate subscription query to refetch fresh data
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
      if (data.synced) {
        toast.success("Subscription synced successfully");
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to sync subscription");
    },
  });
}
