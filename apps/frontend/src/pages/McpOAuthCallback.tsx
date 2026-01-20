import { useEffect, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";

import { useMcpServers } from "../hooks/useMcpServers";

const McpOAuthCallback = () => {
  const { workspaceId, serverId } = useParams<{
    workspaceId: string;
    serverId: string;
  }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const success = searchParams.get("success");
  const serviceType = searchParams.get("serviceType");
  const error = searchParams.get("error");

  const { refetch } = useMcpServers(workspaceId || "");

  // Derive status and error message directly from URL params (no state needed)
  const { status, errorMessage } = useMemo(() => {
    if (!workspaceId || !serverId) {
      return {
        status: "error" as const,
        errorMessage: "Workspace ID or Server ID is missing",
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
  }, [workspaceId, serverId, error, success]);

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

  const serviceName =
    serviceType === "google-drive"
      ? "Google Drive"
      : serviceType === "gmail"
      ? "Gmail"
      : serviceType === "google-calendar"
      ? "Google Calendar"
      : serviceType === "notion"
      ? "Notion"
      : serviceType === "github"
      ? "GitHub"
      : serviceType === "linear"
      ? "Linear"
      : serviceType === "hubspot"
      ? "HubSpot"
      : serviceType === "shopify"
      ? "Shopify"
      : serviceType === "salesforce"
      ? "Salesforce"
      : serviceType === "slack"
      ? "Slack"
    : serviceType === "intercom"
      ? "Intercom"
      : serviceType === "todoist"
      ? "Todoist"
      : serviceType === "zendesk"
      ? "Zendesk"
      : serviceType || "service";

  if (!workspaceId || !serverId) {
    if (!error && !success) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-white dark:bg-neutral-950">
          <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
            <h1 className="mb-4 text-2xl font-semibold text-neutral-900 dark:text-neutral-50">Connecting...</h1>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              Please wait while we complete the connection.
            </p>
          </div>
        </div>
      );
    }
  }

  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-neutral-950">
        <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
          <h1 className="mb-4 text-2xl font-semibold text-red-600 dark:text-red-400">Error</h1>
          <p className="mb-4 text-sm text-neutral-700 dark:text-neutral-300">
            {errorMessage || "Failed to connect OAuth account."}
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
      <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
        <h1 className="mb-4 text-2xl font-semibold text-green-600 dark:text-green-400">Success</h1>
        <p className="mb-4 text-sm text-neutral-700 dark:text-neutral-300">
          Your {serviceName} account has been connected successfully!
        </p>
        <p className="text-xs text-neutral-600 dark:text-neutral-400">Redirecting to workspace...</p>
      </div>
    </div>
  );
};

export default McpOAuthCallback;
