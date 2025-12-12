import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useState, useEffect, useRef } from "react";
import type { FC } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";

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
      // Remove success parameter from URL
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete("success");
      setSearchParams(newSearchParams, { replace: true });

      // Refresh subscription data immediately
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
      refetch();
      toast.success("Subscription activated successfully!");
    }
  }, [searchParams, setSearchParams, queryClient, refetch, toast]);

  // Sync subscription from Lemon Squeezy when page loads (only if not synced recently)
  useEffect(() => {
    if (!isLoading && subscription && !hasSyncedRef.current) {
      // Only sync if subscription has Lemon Squeezy data (status or renewsAt indicates Lemon Squeezy subscription)
      if (subscription.status || subscription.renewsAt) {
        const now = Date.now();
        const fiveMinutes = 5 * 60 * 1000; // 5 minutes in milliseconds

        // Only sync if we haven't synced in the last 5 minutes
        if (
          lastSyncTimeRef.current === null ||
          now - lastSyncTimeRef.current > fiveMinutes
        ) {
          hasSyncedRef.current = true;
          lastSyncTimeRef.current = now;
          syncMutation.mutate();
        }
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-soft p-6 lg:p-10">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl shadow-medium p-8 lg:p-10 border border-neutral-200">
            <LoadingScreen compact message="Loading subscription..." />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-soft p-6 lg:p-10">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl shadow-medium p-8 lg:p-10 border border-error-200">
            <h1 className="text-4xl lg:text-5xl font-bold text-neutral-900 mb-4 tracking-tight">
              Error
            </h1>
            <p className="text-lg font-semibold text-error-600 mb-4">
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
    <div className="min-h-screen bg-gradient-soft p-6 lg:p-10">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow-large p-8 lg:p-10 mb-8 border border-neutral-200 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-primary opacity-5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
          <div className="relative z-10">
            <h1 className="text-4xl lg:text-5xl font-bold text-neutral-900 mb-4 tracking-tight">
              Subscription Management
            </h1>
            <div className="mb-6">
              <div className="text-3xl font-bold text-neutral-900 mb-2">
                {planName} Plan
              </div>
              {subscription.status && (
                <div className="text-base mb-2">
                  {subscription.status === "past_due" && (
                    <span className="text-error-600 font-semibold">
                      Payment Past Due
                    </span>
                  )}
                  {subscription.status === "active" && (
                    <span className="text-green-600 font-semibold">Active</span>
                  )}
                  {subscription.status === "cancelled" && (
                    <span className="text-neutral-600 font-semibold">
                      Cancelled
                    </span>
                  )}
                </div>
              )}
              {subscription.gracePeriodEndsAt && (
                <div className="text-base text-orange-600 mb-2">
                  <span className="font-semibold">
                    Grace period ends:{" "}
                    {new Date(
                      subscription.gracePeriodEndsAt
                    ).toLocaleDateString()}
                  </span>
                </div>
              )}
              {subscription.renewsAt && (
                <div className="text-base text-neutral-600 mb-2">
                  Renews: {new Date(subscription.renewsAt).toLocaleDateString()}
                </div>
              )}
              {expiresAt && (
                <div className="text-base text-neutral-600 mb-2">
                  {isExpired ? (
                    <span className="text-error-600 font-semibold">
                      Expired
                    </span>
                  ) : daysUntilExpiry !== null && daysUntilExpiry <= 7 ? (
                    <span className="text-orange-600 font-semibold">
                      Expires in {daysUntilExpiry} day
                      {daysUntilExpiry !== 1 ? "s" : ""}
                    </span>
                  ) : (
                    <span>Expires: {expiresAt.toLocaleDateString()}</span>
                  )}
                </div>
              )}
              <div className="text-sm text-neutral-600 font-mono mb-4">
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
                    className="px-6 py-3 bg-error-600 text-white font-semibold rounded-xl hover:bg-error-700 transition-colors"
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
                        cancelMutation.mutate();
                      }
                    }}
                    disabled={cancelMutation.isPending}
                    className="px-6 py-3 border border-neutral-300 text-neutral-700 font-semibold rounded-xl hover:bg-neutral-50 transition-colors disabled:opacity-50"
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
                    className="px-6 py-3 border border-neutral-300 text-neutral-700 font-semibold rounded-xl hover:bg-neutral-50 transition-colors"
                  >
                    Manage Payment
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-medium p-8 mb-8 border border-neutral-200">
          <h2 className="text-2xl font-semibold text-neutral-900 mb-6">
            Upgrade or Downgrade Plan
          </h2>
          <PlanComparison
            currentPlan={subscription.plan}
            onUpgrade={(plan) => {
              // If user has an active Lemon Squeezy subscription (not free plan), change plan instead of creating checkout
              // Free plans should always go through checkout to create a new subscription
              if (
                subscription.lemonSqueezySubscriptionId &&
                subscription.status &&
                subscription.status !== "cancelled" &&
                subscription.status !== "expired"
              ) {
                changePlanMutation.mutate(plan);
              } else {
                // Free plan or cancelled/expired subscription - create new checkout
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
                  cancelMutation.mutate();
                }
              } else {
                // Downgrading to a different paid plan (e.g., pro to starter)
                if (
                  window.confirm(
                    `Are you sure you want to downgrade to ${targetPlan}? The change will take effect on your next billing cycle.`
                  )
                ) {
                  changePlanMutation.mutate(targetPlan);
                }
              }
            }}
          />
        </div>

        <div className="bg-white rounded-2xl shadow-medium p-8 mb-8 border border-neutral-200">
          <h2 className="text-2xl font-semibold text-neutral-900 mb-6">
            Subscription Limits & Usage
          </h2>

          <div className="space-y-6">
            {/* Seat Usage - Prominently Displayed */}
            <div className="border border-neutral-200 rounded-xl p-6 bg-neutral-50">
              <div className="text-sm font-semibold text-neutral-600 mb-2">
                Seats
              </div>
              <div className="text-4xl font-bold text-neutral-900 mb-2">
                {subscription.usage.users} / {subscription.limits.maxUsers}
              </div>
              <div className="text-sm font-medium text-neutral-600">
                {subscription.usage.users === subscription.limits.maxUsers
                  ? "Limit reached"
                  : `${
                      subscription.limits.maxUsers - subscription.usage.users
                    } seats remaining`}
              </div>
            </div>

            {/* Other Limits */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Workspaces */}
              <div className="border border-neutral-200 rounded-xl p-4 bg-white hover:bg-neutral-50 transition-colors duration-200">
                <div className="text-sm font-semibold text-neutral-600 mb-1">
                  Workspaces
                </div>
                <div className="text-2xl font-bold text-neutral-900">
                  {subscription.usage.workspaces} /{" "}
                  {subscription.limits.maxWorkspaces}
                </div>
              </div>

              {/* Documents */}
              <div className="border border-neutral-200 rounded-xl p-4 bg-white hover:bg-neutral-50 transition-colors duration-200">
                <div className="text-sm font-semibold text-neutral-600 mb-1">
                  Documents
                </div>
                <div className="text-2xl font-bold text-neutral-900 mb-1">
                  {subscription.usage.documents} /{" "}
                  {subscription.limits.maxDocuments}
                </div>
                <div className="text-sm font-medium text-neutral-600">
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
              <div className="border border-neutral-200 rounded-xl p-4 bg-white hover:bg-neutral-50 transition-colors duration-200">
                <div className="text-sm font-semibold text-neutral-600 mb-1">
                  Agents
                </div>
                <div className="text-2xl font-bold text-neutral-900">
                  {subscription.usage.agents} / {subscription.limits.maxAgents}
                </div>
              </div>

              {/* Managers */}
              <div className="border border-neutral-200 rounded-xl p-4 bg-white hover:bg-neutral-50 transition-colors duration-200">
                <div className="text-sm font-semibold text-neutral-600 mb-1">
                  Managers
                </div>
                <div className="text-2xl font-bold text-neutral-900">
                  {subscription.managers.length}
                  {subscription.limits.maxManagers !== undefined
                    ? ` / ${subscription.limits.maxManagers}`
                    : " (unlimited)"}
                </div>
              </div>

              {/* Agent Keys */}
              <div className="border border-neutral-200 rounded-xl p-4 bg-white hover:bg-neutral-50 transition-colors duration-200">
                <div className="text-sm font-semibold text-neutral-600 mb-1">
                  Agent Keys
                </div>
                <div className="text-2xl font-bold text-neutral-900">
                  {subscription.usage.agentKeys} /{" "}
                  {subscription.limits.maxAgentKeys}
                </div>
              </div>

              {/* Channels */}
              <div className="border border-neutral-200 rounded-xl p-4 bg-white hover:bg-neutral-50 transition-colors duration-200">
                <div className="text-sm font-semibold text-neutral-600 mb-1">
                  Channels
                </div>
                <div className="text-2xl font-bold text-neutral-900">
                  {subscription.usage.channels} /{" "}
                  {subscription.limits.maxChannels}
                </div>
              </div>

              {/* MCP Servers */}
              <div className="border border-neutral-200 rounded-xl p-4 bg-white hover:bg-neutral-50 transition-colors duration-200">
                <div className="text-sm font-semibold text-neutral-600 mb-1">
                  MCP Servers
                </div>
                <div className="text-2xl font-bold text-neutral-900">
                  {subscription.usage.mcpServers} /{" "}
                  {subscription.limits.maxMcpServers}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-medium p-8 mb-8 border border-neutral-200">
          <h2 className="text-2xl font-semibold text-neutral-900 mb-6">
            Managers
          </h2>

          {subscription.managers.length === 0 ? (
            <p className="text-neutral-600">No managers found.</p>
          ) : (
            <div className="space-y-4">
              {subscription.managers.map((manager) => {
                const canRemoveManager =
                  manager.userId !== currentUserId &&
                  subscription.managers.length > 1;
                return (
                  <div
                    key={manager.userId}
                    className="border border-neutral-200 rounded-xl p-4 flex items-center justify-between bg-neutral-50 hover:bg-neutral-100 transition-colors duration-200"
                  >
                    <div>
                      <div className="font-semibold text-neutral-900 text-lg">
                        {manager.email || "Unknown email"}
                      </div>
                      <div className="text-sm text-neutral-600 font-mono">
                        {manager.userId}
                      </div>
                    </div>
                    {canRemoveManager && (
                      <button
                        onClick={() => handleRemoveManager(manager.userId)}
                        className="px-4 py-2 text-error-600 font-semibold rounded-xl hover:bg-error-50 border border-error-200 transition-all duration-200"
                        disabled={removeManagerMutation.isPending}
                      >
                        {removeManagerMutation.isPending
                          ? "Removing..."
                          : "Remove"}
                      </button>
                    )}
                    {manager.userId === currentUserId && (
                      <span className="text-sm font-medium text-neutral-600">
                        You
                      </span>
                    )}
                    {manager.userId !== currentUserId &&
                      subscription.managers.length === 1 && (
                        <span className="text-sm font-medium text-neutral-500">
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
          <div className="bg-white rounded-2xl shadow-medium p-8 border border-neutral-200">
            <h2 className="text-2xl font-semibold text-neutral-900 mb-6">
              Add Manager
            </h2>
            <form onSubmit={handleAddManager}>
              <div className="mb-4">
                <label
                  htmlFor="email"
                  className="block text-sm font-semibold text-neutral-900 mb-2"
                >
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={handleEmailChange}
                  className="w-full border border-neutral-300 rounded-xl bg-white px-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200"
                  placeholder="user@example.com"
                  disabled={isSubmitting}
                />
                {emailError && (
                  <div className="mt-2 text-sm font-semibold text-error-600">
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
                className="bg-gradient-primary px-6 py-3 text-white font-semibold rounded-xl hover:shadow-colored transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
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
