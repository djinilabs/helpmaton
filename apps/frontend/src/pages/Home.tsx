import { useSession, signOut } from "next-auth/react";
import { useState, lazy, Suspense } from "react";
import type { FC } from "react";
import { Link } from "react-router-dom";

import { LoadingScreen } from "../components/LoadingScreen";
// Lazy load components
const SubscriptionPanel = lazy(() =>
  import("../components/SubscriptionPanel").then((module) => ({
    default: module.SubscriptionPanel,
  }))
);
const UsageDashboard = lazy(() =>
  import("../components/UsageDashboard").then((module) => ({
    default: module.UsageDashboard,
  }))
);
import { useUserUsage } from "../hooks/useUsage";
import { clearTokens } from "../utils/api";
import { type DateRangePreset, getDateRange } from "../utils/dateRanges";

const Home: FC = () => {
  const { data: session } = useSession();

  return (
    <div className="min-h-screen bg-gradient-soft p-6 dark:bg-gradient-soft-dark lg:p-10">
      <div className="mx-auto max-w-6xl">
        <div className="relative mb-10 overflow-hidden rounded-2xl border-2 border-neutral-300 bg-white p-10 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900 lg:p-12">
          <div className="absolute right-0 top-0 size-64 -translate-y-1/2 translate-x-1/2 rounded-full bg-gradient-primary opacity-5 blur-3xl"></div>
          <div className="relative z-10">
            <div className="mb-6 flex flex-col items-start gap-6 sm:flex-row sm:items-center">
              <div className="relative">
                <img
                  src="/images/helpmaton_logo.svg"
                  alt="Helmaton Logo"
                  className="relative z-10 size-20"
                />
              </div>
              <div>
                <h1 className="mb-3 text-5xl font-black tracking-tight text-neutral-900 dark:text-neutral-50 lg:text-6xl">
                  Dashboard
                </h1>
                <p className="text-2xl font-bold text-neutral-700 dark:text-neutral-300">
                  Welcome, {session?.user?.email || "User"}
                </p>
              </div>
            </div>
            <p className="max-w-2xl text-lg font-semibold leading-relaxed text-neutral-700 dark:text-neutral-300">
              Your central hub for managing workspaces, agents, and monitoring
              usage across all your projects.
            </p>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border-2 border-neutral-300 bg-white p-10 shadow-large dark:border-neutral-700 dark:bg-neutral-900">
            <h2 className="mb-5 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
              Get Started
            </h2>
            <p className="mb-8 text-base font-medium leading-relaxed text-neutral-700 dark:text-neutral-300">
              Workspaces are isolated environments where you can organize your
              agents, documents, and settings. Each workspace has its own credit
              balance and spending limits.
            </p>
            <Link
              to="/workspaces"
              className="inline-flex transform items-center gap-3 rounded-xl bg-gradient-primary px-8 py-4 font-bold text-white transition-all duration-200 hover:scale-[1.03] hover:shadow-colored active:scale-[0.97]"
            >
              Manage Workspaces
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

          <Suspense fallback={<LoadingScreen compact />}>
            <SubscriptionPanel />
          </Suspense>
        </div>

        <UserUsageSection />

        <div className="flex justify-end rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-large dark:border-neutral-700 dark:bg-neutral-900">
          <button
            onClick={() => {
              // Clear tokens immediately on logout
              clearTokens();
              signOut();
            }}
            className="transform rounded-xl border-2 border-neutral-300 px-7 py-3.5 font-bold text-neutral-900 transition-all duration-200 hover:scale-[1.02] hover:border-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 active:scale-[0.98] dark:border-neutral-700 dark:text-neutral-50 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface UserUsageSectionProps {}

const UserUsageSection: FC<UserUsageSectionProps> = () => {
  const [dateRangePreset, setDateRangePreset] =
    useState<DateRangePreset>("last-30-days");
  const dateRange = getDateRange(dateRangePreset);

  const {
    data: usageData,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useUserUsage({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });

  if (isLoading) {
    return (
      <div className="mb-8 rounded-2xl border-2 border-neutral-300 bg-white p-10 shadow-large dark:border-neutral-700 dark:bg-neutral-900">
        <LoadingScreen compact message="Loading usage data..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-8 rounded-2xl border-2 border-error-300 bg-white p-10 shadow-large dark:border-error-700 dark:bg-neutral-900">
        <p className="text-lg font-bold text-error-700 dark:text-error-400">
          Error loading usage:{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  }

  if (!usageData) {
    return null;
  }

  return (
    <Suspense fallback={<LoadingScreen compact />}>
      <UsageDashboard
        stats={usageData.stats}
        title="YOUR USAGE"
        dateRange={dateRange}
        dateRangePreset={dateRangePreset}
        onDateRangeChange={setDateRangePreset}
        onRefresh={() => refetch()}
        isRefreshing={isRefetching}
      />
    </Suspense>
  );
};

export default Home;
