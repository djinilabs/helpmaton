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
    if (level === 2) return "bg-accent-100 text-accent-700 border-accent-200";
    if (level === 1)
      return "bg-neutral-100 text-neutral-700 border-neutral-200";
    return "bg-neutral-50 text-neutral-500 border-neutral-200";
  };

  return (
    <div className="min-h-screen bg-gradient-soft p-6 lg:p-10">
      <div className="max-w-5xl mx-auto">
        <div className="bg-white rounded-2xl shadow-dramatic p-10 lg:p-12 mb-10 border-2 border-neutral-300 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-accent opacity-8 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
          <div className="relative z-10">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-8 mb-8">
              <div>
                <h1 className="text-5xl lg:text-6xl font-black text-neutral-900 mb-4 tracking-tight">
                  Workspaces
                </h1>
                <p className="text-lg font-semibold text-neutral-700 leading-relaxed max-w-2xl">
                  Workspaces help you organize your AI agents and resources.
                  Each workspace has its own agents, documents, credit balance,
                  and spending limits. Use workspaces to separate different
                  projects or teams.
                </p>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="bg-gradient-primary px-8 py-4 text-white font-bold rounded-xl hover:shadow-colored transition-all duration-200 transform hover:scale-[1.03] active:scale-[0.97] whitespace-nowrap"
              >
                Create Workspace
              </button>
            </div>
          </div>
        </div>

        {workspaces.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-large p-12 lg:p-14 border-2 border-neutral-300 text-center">
            <div className="max-w-md mx-auto">
              <div className="w-20 h-20 bg-gradient-primary/15 rounded-2xl flex items-center justify-center mx-auto mb-8">
                <svg
                  className="w-10 h-10 text-primary-600"
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
              <p className="text-3xl font-bold mb-4 text-neutral-900">
                No workspaces found.
              </p>
              <p className="mb-6 text-lg font-medium text-neutral-700">
                Create your first workspace to get started.
              </p>
              <p className="text-base text-neutral-600 mb-10">
                A workspace is where you&apos;ll create agents, upload
                documents, and manage your AI resources.
              </p>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="bg-gradient-primary px-8 py-4 text-white font-bold rounded-xl hover:shadow-colored transition-all duration-200 transform hover:scale-[1.03] active:scale-[0.97]"
              >
                Create Your First Workspace
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {workspaces.map((workspace) => (
              <div
                key={workspace.id}
                onClick={() => navigate(`/workspaces/${workspace.id}`)}
                className="bg-white rounded-2xl shadow-large p-8 lg:p-10 cursor-pointer border-2 border-neutral-300 hover:shadow-bold hover:border-primary-400 transition-all duration-200 transform hover:scale-[1.03] active:scale-[0.97] group relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-primary opacity-0 group-hover:opacity-8 rounded-full blur-3xl transition-opacity duration-200"></div>
                <div className="relative z-10">
                  <div className="flex justify-between items-start mb-5">
                    <h2 className="text-3xl font-bold text-neutral-900 group-hover:text-primary-600 transition-colors">
                      {workspace.name}
                    </h2>
                    <span
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${getPermissionColor(
                        workspace.permissionLevel
                      )}`}
                    >
                      {getPermissionLabel(workspace.permissionLevel)}
                    </span>
                  </div>
                  {workspace.description && (
                    <p className="text-base font-medium mb-5 text-neutral-700 leading-relaxed line-clamp-2">
                      {workspace.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-sm text-neutral-500">
                    <svg
                      className="w-4 h-4"
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
        <div className="flex items-center justify-center min-h-screen bg-gradient-soft p-8">
          <div className="max-w-2xl w-full bg-white rounded-2xl shadow-large p-8 lg:p-10 border border-error-200">
            <h1 className="text-4xl font-semibold text-neutral-900 mb-4">
              Error
            </h1>
            <p className="text-xl mb-6 text-error-600 font-semibold">
              {error.message || "Failed to load workspaces"}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  reset();
                  resetError();
                }}
                className="bg-gradient-primary px-6 py-3 text-white font-semibold rounded-xl hover:shadow-colored transition-all duration-200"
              >
                Try Again
              </button>
              <button
                onClick={() => (window.location.href = "/")}
                className="border border-neutral-300 bg-white px-6 py-3 text-neutral-700 font-semibold rounded-xl hover:bg-neutral-50 transition-all duration-200"
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
