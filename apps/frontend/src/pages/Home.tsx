import { useSession, signOut } from "next-auth/react";
import { useState, lazy, Suspense, useEffect } from "react";
import type { FC } from "react";
import { Link } from "react-router-dom";

import { LoadingScreen } from "../components/LoadingScreen";
import { useUserUsage, useUserDailyUsage } from "../hooks/useUsage";
import { clearTokens, getUserHasPasskey } from "../utils/api";
import { type DateRangePreset, getDateRange } from "../utils/dateRanges";
import { trackEvent } from "../utils/tracking";
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

const Home: FC = () => {
  const { data: session } = useSession();

  useEffect(() => {
    trackEvent("home_page_viewed", {});
  }, []);

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
                  Your dashboard
                </h1>
                <p className="text-2xl font-bold text-neutral-700 dark:text-neutral-300">
                  Welcome, {session?.user?.email || "User"}
                </p>
              </div>
            </div>
            <p className="max-w-2xl text-lg font-semibold leading-relaxed text-neutral-700 dark:text-neutral-300">
              Start here to organize your workspaces, set up agents, and see
              usage at a glance.
            </p>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border-2 border-neutral-300 bg-white p-10 shadow-large dark:border-neutral-700 dark:bg-neutral-900">
            <h2 className="mb-5 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
              Get started
            </h2>
            <p className="mb-8 text-base font-medium leading-relaxed text-neutral-700 dark:text-neutral-300">
              A workspace is a place for one team or project. It keeps your
              agents, documents, and spending in one spot.
            </p>
            <Link
              to="/workspaces"
              className="inline-flex transform items-center gap-3 rounded-xl bg-gradient-primary px-8 py-4 font-bold text-white transition-all duration-200 hover:scale-[1.03] hover:shadow-colored active:scale-[0.97]"
            >
              Go to Workspaces
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

        <AddPasskeyPrompt />

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
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Shown only when: user is logged in, device supports passkeys, and user has no passkey stored.
 * "Create passkey" opens the system passkey dialog immediately; registration code is loaded only on click.
 */
const AddPasskeyPrompt: FC = () => {
  const [deviceSupportsPasskey, setDeviceSupportsPasskey] = useState<
    boolean | null
  >(null);
  const [hasPasskey, setHasPasskey] = useState<boolean | null>(null);
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const check =
      window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.();
    if (typeof check?.then !== "function") {
      queueMicrotask(() => setDeviceSupportsPasskey(false));
      return;
    }
    check.then((available) => {
      setDeviceSupportsPasskey(available === true);
      if (!available) return;
      getUserHasPasskey()
        .then((res) => setHasPasskey(res.hasPasskey))
        .catch(() => setHasPasskey(null));
    });
  }, []);

  const handleCreatePasskey = async () => {
    setPasskeyError(null);
    setIsPasskeyLoading(true);
    try {
      const { createPasskey } = await import("../utils/passkeyRegistration");
      await createPasskey();
      trackEvent("passkey_created", {});
      setHasPasskey(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create passkey";
      const lower = message.toLowerCase();
      const isUserCancellation =
        lower.includes("cancel") ||
        lower.includes("abort") ||
        lower.includes("notallowederror") ||
        lower.includes("the operation either timed out or was not allowed");
      if (!isUserCancellation) {
        setPasskeyError(message.trim() || "Failed to create passkey.");
      }
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  const show =
    deviceSupportsPasskey === true && hasPasskey === false;
  if (!show) return null;

  return (
    <div className="mb-8 rounded-2xl border-2 border-neutral-300 bg-white p-10 shadow-large dark:border-neutral-700 dark:bg-neutral-900">
      <h2 className="mb-3 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        Sign in faster with a passkey
      </h2>
      <p className="mb-6 text-base font-medium leading-relaxed text-neutral-700 dark:text-neutral-300">
        Add a passkey to sign in without email next time. Use your device
        biometrics or security key for a quick, secure login.
      </p>
      {passkeyError && (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
        >
          {passkeyError}
        </p>
      )}
      <button
        type="button"
        disabled={isPasskeyLoading}
        onClick={handleCreatePasskey}
        className="inline-flex transform items-center gap-2 rounded-xl border-2 border-neutral-300 bg-white px-6 py-3 font-semibold text-neutral-700 transition-all duration-200 hover:scale-[1.02] hover:border-primary-500 hover:bg-primary-50 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:border-primary-500 dark:hover:bg-primary-900/20 dark:hover:text-primary-400"
      >
        {isPasskeyLoading ? "Creating passkey..." : "Create passkey"}
        {!isPasskeyLoading && (
          <svg
            className="size-4"
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
        )}
      </button>
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
    isLoading: isLoadingUsage,
    error: usageError,
    refetch: refetchUsage,
    isRefetching: isRefetchingUsage,
  } = useUserUsage({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });
  const {
    data: dailyData,
    isLoading: isLoadingDaily,
    error: dailyError,
    refetch: refetchDaily,
    isRefetching: isRefetchingDaily,
  } = useUserDailyUsage({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });

  const handleRefresh = () => {
    refetchUsage();
    refetchDaily();
  };

  const isLoading = isLoadingUsage || isLoadingDaily;
  const isRefreshing = isRefetchingUsage || isRefetchingDaily;

  if (isLoading) {
    return (
      <div className="mb-8 rounded-2xl border-2 border-neutral-300 bg-white p-10 shadow-large dark:border-neutral-700 dark:bg-neutral-900">
        <LoadingScreen compact message="Loading usage data..." />
      </div>
    );
  }

  if (usageError) {
    return (
      <div className="mb-8 rounded-2xl border-2 border-error-300 bg-white p-10 shadow-large dark:border-error-700 dark:bg-neutral-900">
        <p className="text-lg font-bold text-error-700 dark:text-error-400">
          Error loading usage:{" "}
          {usageError instanceof Error ? usageError.message : "Unknown error"}
        </p>
      </div>
    );
  }

  if (dailyError) {
    return (
      <div className="mb-8 rounded-2xl border-2 border-error-300 bg-white p-10 shadow-large dark:border-error-700 dark:bg-neutral-900">
        <p className="text-lg font-bold text-error-700 dark:text-error-400">
          Error loading daily usage:{" "}
          {dailyError instanceof Error ? dailyError.message : "Unknown error"}
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
        dailyData={dailyData?.daily}
        title="Your usage"
        dateRange={dateRange}
        dateRangePreset={dateRangePreset}
        onDateRangeChange={setDateRangePreset}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />
    </Suspense>
  );
};

export default Home;
