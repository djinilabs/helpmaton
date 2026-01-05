import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useState, useEffect, useRef } from "react";
import type { FC } from "react";
import { useSearchParams } from "react-router-dom";

import { LoadingScreen } from "../components/LoadingScreen";
import { PlanComparison } from "../components/PlanComparison";
import {
  useSubscription,
  useUserByEmail,
  useAddSubscriptionManager,
  useRemoveSubscriptionManager,
  useSubscriptionCheckout,
  useSubscriptionCancel,
  useSubscriptionChangePlan,
  useSubscriptionPortal,
  useSubscriptionSync,
} from "../hooks/useSubscription";
import { useToast } from "../hooks/useToast";
import { trackEvent } from "../utils/tracking";

const SubscriptionManagement: FC = () => {
  const { data: session } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: subscription, isLoading, error, refetch } = useSubscription();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const addManagerMutation = useAddSubscriptionManager();
  const removeManagerMutation = useRemoveSubscriptionManager();
  const checkoutMutation = useSubscriptionCheckout();
  const cancelMutation = useSubscriptionCancel();
  const changePlanMutation = useSubscriptionChangePlan();
  const portalQuery = useSubscriptionPortal();
  const syncMutation = useSubscriptionSync();
  const hasSyncedRef = useRef(false);
  const lastSyncTimeRef = useRef<number | null>(null);

  // Check for success parameter from checkout redirect and refresh subscription
  useEffect(() => {
    const success = searchParams.get("success");
    if (success === "true") {
      console.log(
        "[SubscriptionManagement] Checkout success detected, syncing subscription"
      );
      // Remove success parameter from URL
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete("success");
      setSearchParams(newSearchParams, { replace: true });

      // Immediately sync subscription from Lemon Squeezy to get latest data
      // This ensures we get the updated plan even if webhook hasn't processed yet
      console.log(
        "[SubscriptionManagement] Calling sync mutation after checkout success"
      );
      syncMutation.mutate(undefined, {
        onSuccess: (data) => {
          console.log(
            "[SubscriptionManagement] Sync mutation succeeded:",
            data
          );
          // After sync, refresh subscription data
          console.log(
            "[SubscriptionManagement] Invalidating subscription query and refetching"
          );
          queryClient.invalidateQueries({ queryKey: ["subscription"] });
          refetch().then((result) => {
            console.log(
              "[SubscriptionManagement] Refetch completed:",
              result.data
                ? {
                    plan: result.data.plan,
                    status: result.data.status,
                    subscriptionId: result.data.subscriptionId,
                  }
                : "no data"
            );
            toast.success("Subscription activated successfully!");
          });
        },
        onError: (error) => {
          console.error(
            "[SubscriptionManagement] Error syncing after checkout:",
            error
          );
          // Still refresh subscription data even if sync fails
          console.log(
            "[SubscriptionManagement] Sync failed, but still refreshing subscription data"
          );
          queryClient.invalidateQueries({ queryKey: ["subscription"] });
          refetch().then((result) => {
            console.log(
              "[SubscriptionManagement] Refetch after sync error completed:",
              result.data
                ? {
                    plan: result.data.plan,
                    status: result.data.status,
                    subscriptionId: result.data.subscriptionId,
                  }
                : "no data"
            );
            toast.success("Subscription activated successfully!");
          });
        },
      });
    }
  }, [
    searchParams,
    setSearchParams,
    queryClient,
    refetch,
    toast,
    syncMutation,
  ]);

  // Sync subscription from Lemon Squeezy when page loads (only if not synced recently)
  useEffect(() => {
    if (!isLoading && subscription && !hasSyncedRef.current) {
      console.log(
        "[SubscriptionManagement] Checking if subscription needs sync:",
        {
          hasStatus: !!subscription.status,
          hasRenewsAt: !!subscription.renewsAt,
          plan: subscription.plan,
          subscriptionId: subscription.subscriptionId,
        }
      );
      // Only sync if subscription has Lemon Squeezy data (status or renewsAt indicates Lemon Squeezy subscription)
      // OR if subscription is free but might have just completed checkout (webhook might not have processed yet)
      if (subscription.status || subscription.renewsAt) {
        const now = Date.now();
        const fiveMinutes = 5 * 60 * 1000; // 5 minutes in milliseconds

        // Only sync if we haven't synced in the last 5 minutes
        if (
          lastSyncTimeRef.current === null ||
          now - lastSyncTimeRef.current > fiveMinutes
        ) {
          console.log(
            "[SubscriptionManagement] Auto-syncing subscription on page load"
          );
          hasSyncedRef.current = true;
          lastSyncTimeRef.current = now;
          syncMutation.mutate();
        } else {
          console.log(
            `[SubscriptionManagement] Skipping auto-sync (last sync was ${Math.round(
              (now - (lastSyncTimeRef.current || 0)) / 1000
            )}s ago)`
          );
        }
      } else {
        console.log(
          "[SubscriptionManagement] Subscription has no Lemon Squeezy data, skipping auto-sync"
        );
      }
    }
    // Note: syncMutation.mutate is stable and doesn't need to be in deps
    // hasSyncedRef and lastSyncTimeRef are refs and don't need to be in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, subscription?.subscriptionId]);

  // Only query user by email when email is provided and valid format
  const shouldQueryUser = email.trim().length > 0 && email.includes("@");
  const { data: userByEmail, isLoading: isLoadingUser } = useUserByEmail(
    shouldQueryUser ? email : null
  );

  // Log subscription data whenever it changes
  useEffect(() => {
    if (subscription) {
      console.log("[SubscriptionManagement] Subscription data received:", {
        subscriptionId: subscription.subscriptionId,
        plan: subscription.plan,
        status: subscription.status,
        renewsAt: subscription.renewsAt,
        expiresAt: subscription.expiresAt,
        lemonSqueezySubscriptionId: subscription.lemonSqueezySubscriptionId,
        hasStatus: !!subscription.status,
        hasRenewsAt: !!subscription.renewsAt,
        timestamp: new Date().toISOString(),
      });
    }
  }, [subscription]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-soft p-6 dark:bg-gradient-soft-dark lg:p-10">
        <div className="mx-auto max-w-4xl">
          <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-medium dark:border-neutral-700 dark:bg-neutral-900 lg:p-10">
            <LoadingScreen compact message="Loading subscription..." />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-soft p-6 dark:bg-gradient-soft-dark lg:p-10">
        <div className="mx-auto max-w-4xl">
          <div className="rounded-2xl border border-error-200 bg-white p-8 shadow-medium dark:border-error-700 dark:bg-neutral-900 lg:p-10">
            <h1 className="mb-4 text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 lg:text-5xl">
              Error
            </h1>
            <p className="mb-4 text-lg font-semibold text-error-600 dark:text-error-400">
              Failed to load subscription:{" "}
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!subscription) {
    return null;
  }

  const planName =
    subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1);
  const expiresAt = subscription.expiresAt
    ? new Date(subscription.expiresAt)
    : null;
  const isExpired = expiresAt && expiresAt < new Date();
  const daysUntilExpiry = expiresAt
    ? Math.ceil(
        (expiresAt.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
      )
    : null;

  console.log("[SubscriptionManagement] Rendering with plan:", {
    plan: subscription.plan,
    planName,
    status: subscription.status,
    isExpired,
    daysUntilExpiry,
  });

  // Check if manager limit is reached
  const maxManagers = subscription.limits.maxManagers;
  const isManagerLimitReached =
    maxManagers !== undefined && subscription.managers.length >= maxManagers;
  const currentUserId = session?.user?.id;

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value;
    setEmail(newEmail);
    setEmailError(null);
  };

  const hasBasicEmailFormat = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleAddManager = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);

    if (!email.trim()) {
      setEmailError("Email is required");
      return;
    }

    if (!hasBasicEmailFormat(email)) {
      setEmailError("Invalid email format");
      return;
    }

    if (isManagerLimitReached) {
      setEmailError("Manager limit reached for this plan");
      return;
    }

    setIsSubmitting(true);
    try {
      // Check if user exists
      if (!userByEmail) {
        setEmailError(
          "User not found. The user must have an account in the app."
        );
        setIsSubmitting(false);
        return;
      }

      // Check if user is already a manager
      if (subscription.managers.some((m) => m.userId === userByEmail.userId)) {
        setEmailError("This user is already a manager");
        setIsSubmitting(false);
        return;
      }

      await addManagerMutation.mutateAsync(userByEmail.userId);
      setEmail("");
    } catch (error) {
      if (error instanceof Error) {
        setEmailError(error.message);
      } else {
        setEmailError("Failed to add manager");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveManager = async (userId: string) => {
    if (
      !window.confirm(
        "Are you sure you want to remove this manager? They will lose access to this subscription."
      )
    ) {
      return;
    }

    try {
      await removeManagerMutation.mutateAsync(userId);
    } catch (error) {
      // Error is handled by the mutation's onError
      console.error("Failed to remove manager:", error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-soft p-6 dark:bg-gradient-soft-dark lg:p-10">
      <div className="mx-auto max-w-4xl">
        <div className="relative mb-8 overflow-hidden rounded-2xl border border-neutral-200 bg-white p-8 shadow-large dark:border-neutral-700 dark:bg-neutral-900 lg:p-10">
          <div className="absolute right-0 top-0 size-64 -translate-y-1/2 translate-x-1/2 rounded-full bg-gradient-primary opacity-5 blur-3xl"></div>
          <div className="relative z-10">
            <h1 className="mb-4 text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 lg:text-5xl">
              Subscription Management
            </h1>
            <div className="mb-6">
              <div className="mb-2 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
                {planName} Plan
              </div>
              {subscription.status && (
                <div className="mb-2 text-base">
                  {subscription.status === "past_due" && (
                    <span className="font-semibold text-error-600 dark:text-error-400">
                      Payment Past Due
                    </span>
                  )}
                  {subscription.status === "active" && (
                    <span className="font-semibold text-green-600 dark:text-green-400">Active</span>
                  )}
                  {subscription.status === "cancelled" &&
                    subscription.plan !== "free" && (
                      <span className="font-semibold text-neutral-600 dark:text-neutral-300">
                        Cancelled
                      </span>
                    )}
                </div>
              )}
              {subscription.gracePeriodEndsAt && (
                <div className="mb-2 text-base text-orange-600 dark:text-orange-400">
                  <span className="font-semibold">
                    Grace period ends:{" "}
                    {new Date(
                      subscription.gracePeriodEndsAt
                    ).toLocaleDateString()}
                  </span>
                </div>
              )}
              {subscription.renewsAt && subscription.plan !== "free" && (
                <div className="mb-2 text-base text-neutral-600 dark:text-neutral-300">
                  Renews: {new Date(subscription.renewsAt).toLocaleDateString()}
                </div>
              )}
              {expiresAt && (
                <div className="mb-2 text-base text-neutral-600 dark:text-neutral-300">
                  {isExpired ? (
                    <span className="font-semibold text-error-600 dark:text-error-400">
                      Expired
                    </span>
                  ) : daysUntilExpiry !== null && daysUntilExpiry <= 7 ? (
                    <span className="font-semibold text-orange-600 dark:text-orange-400">
                      Expires in {daysUntilExpiry} day
                      {daysUntilExpiry !== 1 ? "s" : ""}
                    </span>
                  ) : (
                    <span>Expires: {expiresAt.toLocaleDateString()}</span>
                  )}
                </div>
              )}
              <div className="mb-4 font-mono text-sm text-neutral-600 dark:text-neutral-300">
                Subscription ID: {subscription.subscriptionId}
              </div>
              <div className="flex gap-4">
                {subscription.status === "past_due" && (
                  <button
                    onClick={() => {
                      portalQuery.refetch().then((result) => {
                        if (result.data?.portalUrl) {
                          window.open(result.data.portalUrl, "_blank");
                        }
                      });
                    }}
                    className="rounded-xl bg-error-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-error-700"
                  >
                    Update Payment Method
                  </button>
                )}
                {(subscription.plan === "starter" ||
                  subscription.plan === "pro") && (
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          "Are you sure you want to cancel your subscription? It will remain active until the end of the billing period."
                        )
                      ) {
                        trackEvent("subscription_downgraded", {
                        from_plan: subscription.plan,
                        to_plan: "free",
                      });
                      cancelMutation.mutate();
                      }
                    }}
                    disabled={cancelMutation.isPending}
                    className="rounded-xl border border-neutral-300 px-6 py-3 font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-50 dark:hover:bg-neutral-800"
                  >
                    {cancelMutation.isPending
                      ? "Cancelling..."
                      : "Cancel Subscription"}
                  </button>
                )}
                {(subscription.status || subscription.renewsAt) && (
                  <button
                    onClick={() => {
                      portalQuery.refetch().then((result) => {
                        if (result.data?.portalUrl) {
                          window.open(result.data.portalUrl, "_blank");
                        }
                      });
                    }}
                    className="rounded-xl border border-neutral-300 px-6 py-3 font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-50 dark:hover:bg-neutral-800"
                  >
                    Manage Payment
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mb-8 rounded-2xl border border-neutral-200 bg-white p-8 shadow-medium dark:border-neutral-700 dark:bg-neutral-900">
          <h2 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
            Upgrade or Downgrade Plan
          </h2>
          <PlanComparison
            currentPlan={subscription.plan}
            isLoading={
              checkoutMutation.isPending ||
              changePlanMutation.isPending ||
              cancelMutation.isPending
            }
            onUpgrade={(plan) => {
              // If user has an active Lemon Squeezy subscription (not free plan), change plan instead of creating checkout
              // Free plans should always go through checkout to create a new subscription
              if (
                subscription.lemonSqueezySubscriptionId &&
                subscription.status &&
                subscription.status !== "cancelled" &&
                subscription.status !== "expired"
              ) {
                trackEvent("subscription_upgraded", {
                  from_plan: subscription.plan,
                  to_plan: plan,
                });
                changePlanMutation.mutate(plan);
              } else {
                // Free plan or cancelled/expired subscription - create new checkout
                trackEvent("subscription_upgraded", {
                  from_plan: subscription.plan,
                  to_plan: plan,
                });
                checkoutMutation.mutate(plan);
              }
            }}
            onDowngrade={(targetPlan) => {
              if (targetPlan === "free") {
                // Downgrading to free = cancel subscription
                if (
                  window.confirm(
                    "Are you sure you want to cancel your subscription? It will remain active until the end of the billing period."
                  )
                ) {
                  trackEvent("subscription_downgraded", {
                    from_plan: subscription.plan,
                    to_plan: "free",
                  });
                  cancelMutation.mutate();
                }
              } else {
                // Downgrading to a different paid plan (e.g., pro to starter)
                if (
                  window.confirm(
                    `Are you sure you want to downgrade to ${targetPlan}?`
                  )
                ) {
                  trackEvent("subscription_downgraded", {
                    from_plan: subscription.plan,
                    to_plan: targetPlan,
                  });
                  changePlanMutation.mutate(targetPlan);
                }
              }
            }}
          />
        </div>

        <div className="mb-8 rounded-2xl border border-neutral-200 bg-white p-8 shadow-medium dark:border-neutral-700 dark:bg-neutral-900">
          <h2 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
            Subscription Limits & Usage
          </h2>

          <div className="space-y-6">
            {/* Seat Usage - Prominently Displayed */}
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-6 dark:border-neutral-700 dark:bg-neutral-800">
              <div className="mb-2 text-sm font-semibold text-neutral-600 dark:text-neutral-300">
                Seats
              </div>
              <div className="mb-2 text-4xl font-bold text-neutral-900 dark:text-neutral-50">
                {subscription.usage.users} / {subscription.limits.maxUsers}
              </div>
              <div className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
                {subscription.usage.users === subscription.limits.maxUsers
                  ? "Limit reached"
                  : `${
                      subscription.limits.maxUsers - subscription.usage.users
                    } seats remaining`}
              </div>
            </div>

            {/* Other Limits */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Workspaces */}
              <div className="rounded-xl border border-neutral-200 bg-white p-4 transition-colors duration-200 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800">
                <div className="mb-1 text-sm font-semibold text-neutral-600 dark:text-neutral-300">
                  Workspaces
                </div>
                <div className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
                  {subscription.usage.workspaces} /{" "}
                  {subscription.limits.maxWorkspaces}
                </div>
              </div>

              {/* Documents */}
              <div className="rounded-xl border border-neutral-200 bg-white p-4 transition-colors duration-200 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800">
                <div className="mb-1 text-sm font-semibold text-neutral-600 dark:text-neutral-300">
                  Documents
                </div>
                <div className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
                  {subscription.usage.documents} /{" "}
                  {subscription.limits.maxDocuments}
                </div>
                <div className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
                  {(
                    subscription.usage.documentSizeBytes /
                    (1024 * 1024)
                  ).toFixed(2)}{" "}
                  MB /{" "}
                  {(
                    subscription.limits.maxDocumentSizeBytes /
                    (1024 * 1024)
                  ).toFixed(0)}{" "}
                  MB
                </div>
              </div>

              {/* Agents */}
              <div className="rounded-xl border border-neutral-200 bg-white p-4 transition-colors duration-200 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800">
                <div className="mb-1 text-sm font-semibold text-neutral-600 dark:text-neutral-300">
                  Agents
                </div>
                <div className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
                  {subscription.usage.agents} / {subscription.limits.maxAgents}
                </div>
              </div>

              {/* Managers */}
              <div className="rounded-xl border border-neutral-200 bg-white p-4 transition-colors duration-200 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800">
                <div className="mb-1 text-sm font-semibold text-neutral-600 dark:text-neutral-300">
                  Managers
                </div>
                <div className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
                  {subscription.managers.length}
                  {subscription.limits.maxManagers !== undefined
                    ? ` / ${subscription.limits.maxManagers}`
                    : " (unlimited)"}
                </div>
              </div>

              {/* Webhooks */}
              <div className="rounded-xl border border-neutral-200 bg-white p-4 transition-colors duration-200 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800">
                <div className="mb-1 text-sm font-semibold text-neutral-600 dark:text-neutral-300">
                  Webhooks
                </div>
                <div className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
                  {subscription.usage.agentKeys} /{" "}
                  {subscription.limits.maxAgentKeys}
                </div>
              </div>

              {/* Channels */}
              <div className="rounded-xl border border-neutral-200 bg-white p-4 transition-colors duration-200 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800">
                <div className="mb-1 text-sm font-semibold text-neutral-600 dark:text-neutral-300">
                  Channels
                </div>
                <div className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
                  {subscription.usage.channels} /{" "}
                  {subscription.limits.maxChannels}
                </div>
              </div>

              {/* MCP Servers */}
              <div className="rounded-xl border border-neutral-200 bg-white p-4 transition-colors duration-200 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800">
                <div className="mb-1 text-sm font-semibold text-neutral-600 dark:text-neutral-300">
                  MCP Servers
                </div>
                <div className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
                  {subscription.usage.mcpServers} /{" "}
                  {subscription.limits.maxMcpServers}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-8 rounded-2xl border border-neutral-200 bg-white p-8 shadow-medium dark:border-neutral-700 dark:bg-neutral-900">
          <h2 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
            Managers
          </h2>

          {subscription.managers.length === 0 ? (
            <p className="text-neutral-600 dark:text-neutral-300">No managers found.</p>
          ) : (
            <div className="space-y-4">
              {subscription.managers.map((manager) => {
                const canRemoveManager =
                  manager.userId !== currentUserId &&
                  subscription.managers.length > 1;
                return (
                  <div
                    key={manager.userId}
                    className="flex items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 p-4 transition-colors duration-200 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                  >
                    <div>
                      <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                        {manager.email || "Unknown email"}
                      </div>
                      <div className="font-mono text-sm text-neutral-600 dark:text-neutral-300">
                        {manager.userId}
                      </div>
                    </div>
                    {canRemoveManager && (
                      <button
                        onClick={() => handleRemoveManager(manager.userId)}
                        className="dark:hover:bg-error-950 rounded-xl border border-error-200 px-4 py-2 font-semibold text-error-600 transition-all duration-200 hover:bg-error-50 dark:border-error-800 dark:text-error-400"
                        disabled={removeManagerMutation.isPending}
                      >
                        {removeManagerMutation.isPending
                          ? "Removing..."
                          : "Remove"}
                      </button>
                    )}
                    {manager.userId === currentUserId && (
                      <span className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
                        You
                      </span>
                    )}
                    {manager.userId !== currentUserId &&
                      subscription.managers.length === 1 && (
                        <span className="text-sm font-medium text-neutral-500 dark:text-neutral-500">
                          Cannot remove last manager
                        </span>
                      )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {!isManagerLimitReached && (
          <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-medium dark:border-neutral-700 dark:bg-neutral-900">
            <h2 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
              Add Manager
            </h2>
            <form onSubmit={handleAddManager}>
              <div className="mb-4">
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-semibold text-neutral-900 dark:text-neutral-300"
                >
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={handleEmailChange}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                  placeholder="user@example.com"
                  disabled={isSubmitting}
                />
                {emailError && (
                  <div className="mt-2 text-sm font-semibold text-error-600 dark:text-error-400">
                    {emailError}
                  </div>
                )}
                {shouldQueryUser && isLoadingUser && (
                  <div className="mt-2 text-sm text-neutral-600">
                    Checking user...
                  </div>
                )}
                {shouldQueryUser && !isLoadingUser && userByEmail && (
                  <div className="mt-2 text-sm font-semibold text-green-600">
                    User found: {userByEmail.email}
                  </div>
                )}
                {shouldQueryUser &&
                  !isLoadingUser &&
                  !userByEmail &&
                  emailError === null && (
                    <div className="mt-2 text-sm font-semibold text-orange-600">
                      User not found. They must have an account in the app.
                    </div>
                  )}
              </div>
              <button
                type="submit"
                disabled={isSubmitting || !email.trim() || !userByEmail}
                className="transform rounded-xl bg-gradient-primary px-6 py-3 font-semibold text-white transition-all duration-200 hover:scale-[1.02] hover:shadow-colored active:scale-[0.98] disabled:transform-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? "Adding..." : "Add Manager"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

export default SubscriptionManagement;
