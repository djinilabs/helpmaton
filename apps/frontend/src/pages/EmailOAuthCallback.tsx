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
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="border border-neutral-200 rounded-xl shadow-soft p-8 max-w-md w-full bg-white">
          <h1 className="text-2xl font-semibold mb-4">Connecting...</h1>
          <p className="text-sm">
            Please wait while we complete the connection.
          </p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="border border-neutral-200 rounded-xl shadow-soft p-8 max-w-md w-full bg-white">
          <h1 className="text-2xl font-semibold mb-4 text-red-600">Error</h1>
          <p className="text-sm mb-4">
            {errorMessage || "Failed to connect email account."}
          </p>
          {workspaceId && (
            <button
              onClick={() => navigate(`/workspaces/${workspaceId}`)}
              className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored transition-all duration-200"
            >
              Go Back
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="border border-neutral-200 rounded-xl shadow-soft p-8 max-w-md w-full bg-white">
        <h1 className="text-2xl font-semibold mb-4 text-green-600">Success</h1>
        <p className="text-sm mb-4">
          Your {provider === "gmail" ? "Gmail" : "Outlook"} account has been
          connected successfully!
        </p>
        <p className="text-xs text-neutral-600">Redirecting to workspace...</p>
      </div>
    </div>
  );
};

export default EmailOAuthCallback;
