import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { useState, Suspense, lazy } from "react";
import type { FC } from "react";
import { useNavigate } from "react-router-dom";

import { ErrorBoundary } from "../components/ErrorBoundary";
import { LoadingScreen } from "../components/LoadingScreen";
// Lazy load modal - only load when opened
const CreateWorkspaceModal = lazy(() =>
  import("../components/CreateWorkspaceModal").then((module) => ({
    default: module.CreateWorkspaceModal,
  }))
);
import { useWorkspaces } from "../hooks/useWorkspaces";

const WorkspacesList: FC = () => {
  const { data: workspaces } = useWorkspaces();
  const navigate = useNavigate();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const getPermissionLabel = (level: number | null): string => {
    if (level === 3) return "Owner";
    if (level === 2) return "Write";
    if (level === 1) return "Read";
    return "None";
  };

  const getPermissionColor = (level: number | null): string => {
    if (level === 3) return "bg-gradient-primary text-white";
    if (level === 2) return "bg-accent-100 text-accent-700 border-accent-200 dark:bg-accent-900 dark:text-accent-300 dark:border-accent-700";
    if (level === 1)
      return "bg-neutral-100 text-neutral-700 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:border-neutral-700";
    return "bg-neutral-50 text-neutral-500 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:border-neutral-700";
  };

  return (
    <div className="min-h-screen bg-gradient-soft p-6 dark:bg-gradient-soft-dark lg:p-10">
      <div className="mx-auto max-w-5xl">
        <div className="relative mb-10 overflow-hidden rounded-2xl border-2 border-neutral-300 bg-white p-10 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900 lg:p-12">
          <div className="opacity-8 absolute right-0 top-0 size-96 -translate-y-1/2 translate-x-1/2 rounded-full bg-gradient-accent blur-3xl"></div>
          <div className="relative z-10">
            <div className="mb-8 flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
              <div>
                <h1 className="mb-4 text-5xl font-black tracking-tight text-neutral-900 dark:text-neutral-50 lg:text-6xl">
                  Workspaces
                </h1>
                <p className="max-w-2xl text-lg font-semibold leading-relaxed text-neutral-700 dark:text-neutral-300">
                  Workspaces help you organize your AI agents and resources.
                  Each workspace has its own agents, documents, credit balance,
                  and spending limits. Use workspaces to separate different
                  projects or teams.
                </p>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="transform whitespace-nowrap rounded-xl bg-gradient-primary px-8 py-4 font-bold text-white transition-all duration-200 hover:scale-[1.03] hover:shadow-colored active:scale-[0.97]"
              >
                Create Workspace
              </button>
            </div>
          </div>
        </div>

        {workspaces.length === 0 ? (
          <div className="rounded-2xl border-2 border-neutral-300 bg-white p-12 text-center shadow-large dark:border-neutral-700 dark:bg-neutral-900 lg:p-14">
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
                No workspaces found.
              </p>
              <p className="mb-6 text-lg font-medium text-neutral-700 dark:text-neutral-300">
                Create your first workspace to get started.
              </p>
              <p className="mb-10 text-base text-neutral-600 dark:text-neutral-300">
                A workspace is where you&apos;ll create agents, upload
                documents, and manage your AI resources.
              </p>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="transform rounded-xl bg-gradient-primary px-8 py-4 font-bold text-white transition-all duration-200 hover:scale-[1.03] hover:shadow-colored active:scale-[0.97]"
              >
                Create Your First Workspace
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {workspaces.map((workspace) => (
              <div
                key={workspace.id}
                onClick={() => navigate(`/workspaces/${workspace.id}`)}
                className="group relative transform cursor-pointer overflow-hidden rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-large transition-all duration-200 hover:scale-[1.03] hover:border-primary-400 hover:shadow-bold active:scale-[0.97] dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-primary-500 lg:p-10"
              >
                <div className="group-hover:opacity-8 absolute right-0 top-0 size-40 rounded-full bg-gradient-primary opacity-0 blur-3xl transition-opacity duration-200"></div>
                <div className="relative z-10">
                  <div className="mb-5 flex items-start justify-between">
                    <h2 className="text-3xl font-bold text-neutral-900 transition-colors group-hover:text-primary-600 dark:text-neutral-50 dark:group-hover:text-primary-400">
                      {workspace.name}
                    </h2>
                    <span
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${getPermissionColor(
                        workspace.permissionLevel
                      )}`}
                    >
                      {getPermissionLabel(workspace.permissionLevel)}
                    </span>
                  </div>
                  {workspace.description && (
                    <p className="mb-5 line-clamp-2 text-base font-medium leading-relaxed text-neutral-700 dark:text-neutral-300">
                      {workspace.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-300">
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
                        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    <span>
                      Created{" "}
                      {new Date(workspace.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {isCreateModalOpen && (
          <Suspense fallback={<LoadingScreen />}>
            <CreateWorkspaceModal
              isOpen={isCreateModalOpen}
              onClose={() => setIsCreateModalOpen(false)}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
};

const LoadingFallback: FC = () => {
  return <LoadingScreen />;
};

const Workspaces: FC = () => {
  const { reset } = useQueryErrorResetBoundary();

  return (
    <ErrorBoundary
      fallback={(error, resetError) => (
        <div className="flex min-h-screen items-center justify-center bg-gradient-soft p-8 dark:bg-gradient-soft-dark">
          <div className="w-full max-w-2xl rounded-2xl border border-error-200 bg-white p-8 shadow-large dark:border-error-700 dark:bg-neutral-900 lg:p-10">
            <h1 className="mb-4 text-4xl font-semibold text-neutral-900 dark:text-neutral-50">
              Error
            </h1>
            <p className="mb-6 text-xl font-semibold text-error-600 dark:text-error-400">
              {error.message || "Failed to load workspaces"}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  reset();
                  resetError();
                }}
                className="rounded-xl bg-gradient-primary px-6 py-3 font-semibold text-white transition-all duration-200 hover:shadow-colored"
              >
                Try Again
              </button>
              <button
                onClick={() => (window.location.href = "/")}
                className="rounded-xl border border-neutral-300 bg-white px-6 py-3 font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
              >
                Go Home
              </button>
            </div>
          </div>
        </div>
      )}
    >
      <Suspense fallback={<LoadingFallback />}>
        <WorkspacesList />
      </Suspense>
    </ErrorBoundary>
  );
};

export default Workspaces;
