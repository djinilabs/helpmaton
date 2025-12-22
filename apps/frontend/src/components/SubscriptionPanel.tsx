import type { FC } from "react";
import { Link } from "react-router-dom";

import { useSubscription } from "../hooks/useSubscription";

import { LoadingScreen } from "./LoadingScreen";

export const SubscriptionPanel: FC = () => {
  const { data: subscription, isLoading, error } = useSubscription();

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-medium dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="mb-5 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          Subscription
        </h2>
        <LoadingScreen compact message="Loading subscription..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-error-200 bg-white p-8 shadow-medium dark:border-error-700 dark:bg-neutral-900">
        <h2 className="mb-5 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          Subscription
        </h2>
        <p className="font-semibold text-error-600 dark:text-error-400">
          Error loading subscription:{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
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

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-medium dark:border-neutral-700 dark:bg-neutral-900">
      <h2 className="mb-5 text-3xl font-bold text-neutral-900 dark:text-neutral-50">Subscription</h2>
      <div className="mb-6">
        <div className="mb-2 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          {planName} Plan
        </div>
        {expiresAt && (
          <div className="mb-2 text-sm text-neutral-600 dark:text-neutral-300">
            {isExpired ? (
              <span className="font-semibold text-error-600 dark:text-error-400">Expired</span>
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
        <div className="text-sm text-neutral-600 dark:text-neutral-300">
          {subscription.managers.length} Manager
          {subscription.managers.length !== 1 ? "s" : ""}
        </div>
      </div>
      <Link
        to="/subscription"
        className="inline-flex transform items-center gap-2 rounded-xl bg-gradient-primary px-6 py-3 font-semibold text-white transition-all duration-200 hover:scale-[1.02] hover:shadow-colored active:scale-[0.98]"
      >
        Manage Subscription
        <svg
          className="size-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </Link>
    </div>
  );
};
