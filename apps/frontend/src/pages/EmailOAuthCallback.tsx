import { useEffect, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";

import { useEmailConnection } from "../hooks/useEmailConnection";

const EmailOAuthCallback = () => {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const success = searchParams.get("success");
  const provider = searchParams.get("provider");
  const error = searchParams.get("error");

  // Derive status and error message directly from URL params (no state needed)
  const { status, errorMessage } = useMemo(() => {
    if (!workspaceId) {
      return {
        status: "error" as const,
        errorMessage: "Workspace ID is missing",
      };
    }
    if (error) {
      return {
        status: "error" as const,
        errorMessage: decodeURIComponent(error),
      };
    }
    if (success === "true") {
      return { status: "success" as const, errorMessage: null };
    }
    return {
      status: "error" as const,
      errorMessage: "OAuth authorization failed",
    };
  }, [workspaceId, error, success]);

  const { refetch } = useEmailConnection(workspaceId || "");

  // Refetch on success and handle redirect
  useEffect(() => {
    if (status === "success") {
      refetch();
      const redirectTimeout = setTimeout(() => {
        navigate(`/workspaces/${workspaceId}`);
      }, 2000);
      return () => clearTimeout(redirectTimeout);
    }
  }, [status, workspaceId, navigate, refetch]);

  if (!workspaceId && !error && !success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-neutral-950">
        <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-8 shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
          <h1 className="mb-4 text-2xl font-semibold text-neutral-900 dark:text-neutral-50">Connecting...</h1>
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            Please wait while we complete the connection.
          </p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-neutral-950">
        <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-8 shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
          <h1 className="mb-4 text-2xl font-semibold text-red-600 dark:text-red-400">Error</h1>
          <p className="mb-4 text-sm text-neutral-700 dark:text-neutral-300">
            {errorMessage || "Failed to connect email account."}
          </p>
          {workspaceId && (
            <button
              onClick={() => navigate(`/workspaces/${workspaceId}`)}
              className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored"
            >
              Go Back
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white dark:bg-neutral-950">
      <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-8 shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
        <h1 className="mb-4 text-2xl font-semibold text-green-600 dark:text-green-400">Success</h1>
        <p className="mb-4 text-sm text-neutral-700 dark:text-neutral-300">
          Your {provider === "gmail" ? "Gmail" : "Outlook"} account has been
          connected successfully!
        </p>
        <p className="text-xs text-neutral-600 dark:text-neutral-400">Redirecting to workspace...</p>
      </div>
    </div>
  );
};

export default EmailOAuthCallback;
