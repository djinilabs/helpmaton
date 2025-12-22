import type { FC } from "react";
import { Link } from "react-router-dom";

import { useSubscription } from "../hooks/useSubscription";

import { LoadingScreen } from "./LoadingScreen";

export const SubscriptionPanel: FC = () => {
  const { data: subscription, isLoading, error } = useSubscription();

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl shadow-medium p-8 border border-neutral-200 dark:bg-neutral-900 dark:border-neutral-700">
        <h2 className="text-3xl font-bold text-neutral-900 mb-5 dark:text-neutral-50">
          Subscription
        </h2>
        <LoadingScreen compact message="Loading subscription..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl shadow-medium p-8 border border-error-200 dark:bg-neutral-900 dark:border-error-700">
        <h2 className="text-3xl font-bold text-neutral-900 mb-5 dark:text-neutral-50">
          Subscription
        </h2>
        <p className="text-error-600 font-semibold dark:text-error-400">
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
    <div className="bg-white rounded-2xl shadow-medium p-8 border border-neutral-200 dark:bg-neutral-900 dark:border-neutral-700">
      <h2 className="text-3xl font-bold text-neutral-900 mb-5 dark:text-neutral-50">Subscription</h2>
      <div className="mb-6">
        <div className="text-3xl font-bold text-neutral-900 mb-2 dark:text-neutral-50">
          {planName} Plan
        </div>
        {expiresAt && (
          <div className="text-sm text-neutral-600 mb-2 dark:text-neutral-400">
            {isExpired ? (
              <span className="text-error-600 font-semibold dark:text-error-400">Expired</span>
            ) : daysUntilExpiry !== null && daysUntilExpiry <= 7 ? (
              <span className="text-orange-600 font-semibold dark:text-orange-400">
                Expires in {daysUntilExpiry} day
                {daysUntilExpiry !== 1 ? "s" : ""}
              </span>
            ) : (
              <span>Expires: {expiresAt.toLocaleDateString()}</span>
            )}
          </div>
        )}
        <div className="text-sm text-neutral-600 dark:text-neutral-400">
          {subscription.managers.length} Manager
          {subscription.managers.length !== 1 ? "s" : ""}
        </div>
      </div>
      <Link
        to="/subscription"
        className="inline-flex items-center gap-2 bg-gradient-primary px-6 py-3 text-white font-semibold rounded-xl hover:shadow-colored transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
      >
        Manage Subscription
        <svg
          className="w-5 h-5"
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
