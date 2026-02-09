import { useSession, signOut } from "next-auth/react";
import { useState, lazy, Suspense, useEffect } from "react";
import type { FC } from "react";
import { Link } from "react-router-dom";

import { LoadingScreen } from "../components/LoadingScreen";
import { Logo } from "../components/Logo";
import { useDialogTracking } from "../contexts/DialogContext";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useSubscription } from "../hooks/useSubscription";
import { useUserUsage, useUserDailyUsage } from "../hooks/useUsage";
import { useWorkspaces } from "../hooks/useWorkspaces";
import { clearTokens, getUserHasPasskey } from "../utils/api";
import { type DateRangePreset, getDateRange } from "../utils/dateRanges";
import { trackEvent } from "../utils/tracking";
// Lazy load components
const CreateWorkspaceModal = lazy(() =>
  import("../components/CreateWorkspaceModal").then((module) => ({
    default: module.CreateWorkspaceModal,
  }))
);
const OnboardingAgentModal = lazy(() =>
  import("../components/OnboardingAgentModal").then((module) => ({
    default: module.OnboardingAgentModal,
  }))
);
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
  const { data: workspaces } = useWorkspaces();
  const { data: subscription } = useSubscription();
  const { registerDialog, unregisterDialog } = useDialogTracking();
  const [isCreateChoiceOpen, setIsCreateChoiceOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState(false);
  const hasWorkspaces = workspaces.length > 0;
  const canCreateWorkspace =
    subscription == null ||
    subscription.usage.workspaces < subscription.limits.maxWorkspaces;

  const closeCreateChoice = () => setIsCreateChoiceOpen(false);
  useEscapeKey(isCreateChoiceOpen, closeCreateChoice);
  useEffect(() => {
    if (isCreateChoiceOpen) {
      registerDialog();
      return () => unregisterDialog();
    }
  }, [isCreateChoiceOpen, registerDialog, unregisterDialog]);

  useEffect(() => {
    trackEvent("home_page_viewed", {});
  }, []);

  return (
    <div className="bg-page min-h-screen p-6 lg:p-10">
      <div className="mx-auto max-w-6xl">
        <div className="relative mb-10 overflow-hidden rounded-2xl border-2 border-neutral-300 bg-white p-10 shadow-dramatic dark:border-neutral-700 dark:bg-surface-50 lg:p-12">
          <div className="absolute right-0 top-0 size-64 -translate-y-1/2 translate-x-1/2 rounded-full bg-gradient-primary opacity-5 blur-3xl"></div>
          <div className="relative z-10">
            <div className="mb-6 flex flex-col items-start gap-6 sm:flex-row sm:items-center">
              <div className="relative size-20 shrink-0">
                <Logo className="relative z-10 size-full" aria-label="Helpmaton Logo" />
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
              {hasWorkspaces
                ? "Start here to organize your workspaces, set up agents, and see usage at a glance."
                : "Get started by creating your first workspace."}
            </p>
          </div>
        </div>

        {hasWorkspaces ? (
          <>
            <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border-2 border-neutral-300 bg-white p-10 shadow-large dark:border-neutral-700 dark:bg-surface-50">
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
          </>
        ) : (
          <div className="mb-8 rounded-2xl border-2 border-neutral-300 bg-white p-12 text-center shadow-large dark:border-neutral-700 dark:bg-surface-50 lg:p-14">
            <div className="mx-auto max-w-md">
              <div className="bg-gradient-primary/15 mx-auto mb-8 flex size-20 items-center justify-center rounded-2xl">
                <svg
                  className="size-10 text-primary-600 dark:text-primary-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                  />
                </svg>
              </div>
              <p className="mb-4 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
                No workspaces yet.
              </p>
              <p className="mb-6 text-lg font-medium text-neutral-700 dark:text-neutral-300">
                Create your first workspace to get started.
              </p>
              <p className="mb-10 text-base text-neutral-600 dark:text-neutral-300">
                A workspace is where you&apos;ll create agents, upload
                documents, and manage spending.
              </p>
              {canCreateWorkspace ? (
                <button
                  type="button"
                  onClick={() => setIsCreateChoiceOpen(true)}
                  className="transform rounded-xl bg-gradient-primary px-8 py-4 font-bold text-white transition-all duration-200 hover:scale-[1.03] hover:shadow-colored active:scale-[0.97]"
                >
                  Create your first workspace
                </button>
              ) : (
                <p className="mb-4 text-base font-medium text-neutral-600 dark:text-neutral-400">
                  You&apos;ve reached your workspace limit (
                  {subscription?.usage.workspaces ?? 0}/
                  {subscription?.limits.maxWorkspaces ?? 1}). Upgrade your plan
                  to create more.
                </p>
              )}
              {!canCreateWorkspace && subscription && (
                <Link
                  to="/subscription"
                  className="inline-flex transform items-center gap-2 rounded-xl border-2 border-primary-500 bg-primary-50 px-6 py-3 font-semibold text-primary-700 transition-all duration-200 hover:bg-primary-100 dark:border-primary-500 dark:bg-primary-900/20 dark:text-primary-400 dark:hover:bg-primary-900/30"
                >
                  View subscription
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
                </Link>
              )}
            </div>
          </div>
        )}

        <AddPasskeyPrompt />

        {isCreateChoiceOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border-2 border-neutral-300 bg-white p-6 shadow-dramatic dark:border-neutral-700 dark:bg-surface-50">
              <h2 className="mb-2 text-xl font-bold text-neutral-900 dark:text-neutral-50">
                Create a workspace
              </h2>
              <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-400">
                Choose how you&apos;d like to create your workspace.
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => {
                    setIsCreateChoiceOpen(false);
                    setIsOnboardingModalOpen(true);
                  }}
                  className="rounded-xl border-2 border-neutral-300 bg-white px-6 py-4 text-left font-semibold text-neutral-900 transition-colors hover:border-primary-400 hover:bg-primary-50 dark:border-neutral-700 dark:bg-surface-100 dark:text-neutral-50 dark:hover:border-primary-500 dark:hover:bg-primary-900/20"
                >
                  <span className="block">✨ Guided setup</span>
                  <span className="mt-1 block text-sm font-normal text-neutral-600 dark:text-neutral-400">
                    Answer a few questions and get a suggested workspace with
                    agents.
                  </span>
                </button>
                <button
                  onClick={() => {
                    setIsCreateChoiceOpen(false);
                    setIsCreateModalOpen(true);
                  }}
                  className="rounded-xl border-2 border-neutral-300 bg-white px-6 py-4 text-left font-semibold text-neutral-900 transition-colors hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-surface-100 dark:text-neutral-50 dark:hover:border-neutral-600 dark:hover:bg-neutral-700"
                >
                  <span className="block">Name and description only</span>
                  <span className="mt-1 block text-sm font-normal text-neutral-600 dark:text-neutral-400">
                    Create an empty workspace and add agents yourself.
                  </span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateChoiceOpen(false)}
                className="mt-4 w-full rounded-xl border-2 border-neutral-300 bg-neutral-100 px-4 py-2 font-medium text-neutral-700 hover:bg-neutral-200 dark:border-neutral-700 dark:bg-surface-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <Suspense fallback={<LoadingScreen />}>
          <CreateWorkspaceModal
            isOpen={isCreateModalOpen}
            onClose={() => setIsCreateModalOpen(false)}
          />
        </Suspense>

        <Suspense fallback={<LoadingScreen />}>
          <OnboardingAgentModal
            isOpen={isOnboardingModalOpen}
            onClose={() => setIsOnboardingModalOpen(false)}
            onSkipToSimpleCreate={() => {
              setIsOnboardingModalOpen(false);
              setIsCreateModalOpen(true);
            }}
          />
        </Suspense>

        <div className="flex justify-end rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-large dark:border-neutral-700 dark:bg-surface-50">
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
    <div className="mb-8 rounded-2xl border-2 border-neutral-300 bg-white p-10 shadow-large dark:border-neutral-700 dark:bg-surface-50">
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
        className="inline-flex transform items-center gap-2 rounded-xl border-2 border-neutral-300 bg-white px-6 py-3 font-semibold text-neutral-700 transition-all duration-200 hover:scale-[1.02] hover:border-primary-500 hover:bg-primary-50 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-surface-100 dark:text-neutral-200 dark:hover:border-primary-500 dark:hover:bg-primary-900/20 dark:hover:text-primary-400"
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
      <div className="mb-8 rounded-2xl border-2 border-neutral-300 bg-white p-10 shadow-large dark:border-neutral-700 dark:bg-surface-50">
        <LoadingScreen compact message="Loading usage data..." />
      </div>
    );
  }

  if (usageError) {
    return (
      <div className="mb-8 rounded-2xl border-2 border-error-300 bg-white p-10 shadow-large dark:border-error-700 dark:bg-surface-50">
        <p className="text-lg font-bold text-error-700 dark:text-error-400">
          Error loading usage:{" "}
          {usageError instanceof Error ? usageError.message : "Unknown error"}
        </p>
      </div>
    );
  }

  if (dailyError) {
    return (
      <div className="mb-8 rounded-2xl border-2 border-error-300 bg-white p-10 shadow-large dark:border-error-700 dark:bg-surface-50">
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
