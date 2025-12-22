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
    <div className="min-h-screen bg-gradient-soft dark:bg-neutral-950 p-6 lg:p-10">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-2xl shadow-dramatic p-10 lg:p-12 mb-10 border-2 border-neutral-300 relative overflow-hidden dark:bg-neutral-900 dark:border-neutral-700">
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-primary opacity-5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
          <div className="relative z-10">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 mb-6">
              <div className="relative overflow-hidden">
                <img
                  src="/images/helpmaton_logo.svg"
                  alt="Helmaton Logo"
                  className="w-20 h-20 relative z-10"
                />
                <div
                  className="manga-shine-overlay absolute inset-0 z-20 pointer-events-none"
                  style={{
                    background:
                      "radial-gradient(circle at center, rgba(255, 255, 255, 0.6) 0%, rgba(255, 255, 255, 0.4) 15%, transparent 30%), linear-gradient(45deg, transparent 25%, rgba(255, 255, 255, 0.3) 45%, rgba(255, 255, 255, 0.4) 50%, rgba(255, 255, 255, 0.3) 55%, transparent 75%)",
                    width: "200%",
                    height: "200%",
                  }}
                ></div>
                <div className="absolute inset-0 bg-gradient-primary opacity-20 rounded-full blur-xl"></div>
              </div>
              <div>
                <h1 className="text-5xl lg:text-6xl font-black text-neutral-900 mb-3 tracking-tight dark:text-neutral-50">
                  Dashboard
                </h1>
                <p className="text-2xl font-bold text-neutral-700 dark:text-neutral-300">
                  Welcome, {session?.user?.email || "User"}
                </p>
              </div>
            </div>
            <p className="text-lg font-semibold text-neutral-700 leading-relaxed max-w-2xl dark:text-neutral-300">
              Your central hub for managing workspaces, agents, and monitoring
              usage across all your projects.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-2xl shadow-large p-10 border-2 border-neutral-300 dark:bg-neutral-900 dark:border-neutral-700">
            <h2 className="text-3xl font-bold text-neutral-900 mb-5 dark:text-neutral-50">
              Get Started
            </h2>
            <p className="text-base font-medium text-neutral-700 mb-8 leading-relaxed dark:text-neutral-300">
              Workspaces are isolated environments where you can organize your
              agents, documents, and settings. Each workspace has its own credit
              balance and spending limits.
            </p>
            <Link
              to="/workspaces"
              className="inline-flex items-center gap-3 bg-gradient-primary px-8 py-4 text-white font-bold rounded-xl hover:shadow-colored transition-all duration-200 transform hover:scale-[1.03] active:scale-[0.97]"
            >
              Manage Workspaces
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

          <Suspense fallback={<LoadingScreen compact />}>
            <SubscriptionPanel />
          </Suspense>
        </div>

        <UserUsageSection />

        <div className="bg-white rounded-2xl shadow-large p-8 border-2 border-neutral-300 flex justify-end dark:bg-neutral-900 dark:border-neutral-700">
          <button
            onClick={() => {
              // Clear tokens immediately on logout
              clearTokens();
              signOut();
            }}
            className="px-7 py-3.5 text-neutral-900 font-bold rounded-xl hover:bg-neutral-100 hover:text-neutral-900 transition-all duration-200 border-2 border-neutral-300 hover:border-neutral-400 transform hover:scale-[1.02] active:scale-[0.98] dark:text-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800 dark:hover:border-neutral-600"
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
      <div className="bg-white rounded-2xl shadow-large p-10 mb-8 border-2 border-neutral-300 dark:bg-neutral-900 dark:border-neutral-700">
        <LoadingScreen compact message="Loading usage data..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl shadow-large p-10 mb-8 border-2 border-error-300 dark:bg-neutral-900 dark:border-error-700">
        <p className="text-error-700 font-bold text-lg dark:text-error-400">
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
