import { useState } from "react";
import type { FC } from "react";
import { toast } from "sonner";

import { useMcpServers, useDeleteMcpServer } from "../hooks/useMcpServers";
import type { McpServer } from "../utils/api";
import {
  initiateMcpOAuthFlow,
  disconnectMcpOAuth,
} from "../utils/api";
import { trackEvent } from "../utils/tracking";

import { McpServerModal } from "./McpServerModal";

interface McpServerListProps {
  workspaceId: string;
  canEdit: boolean;
}

interface McpServerItemProps {
  server: McpServer;
  workspaceId: string;
  canEdit: boolean;
  onEdit: (serverId: string) => void;
}

const McpServerItem: FC<McpServerItemProps> = ({
  server,
  workspaceId,
  canEdit,
  onEdit,
}) => {
  const deleteServer = useDeleteMcpServer(workspaceId);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleConnect = async () => {
    try {
      setIsConnecting(true);
      const { authUrl } = await initiateMcpOAuthFlow(workspaceId, server.id);
      window.location.href = authUrl;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to initiate OAuth flow"
      );
      setIsConnecting(false);
    }
  };

  const handleReconnect = async () => {
    try {
      setIsReconnecting(true);
      const { authUrl } = await initiateMcpOAuthFlow(workspaceId, server.id);
      window.location.href = authUrl;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to initiate OAuth flow"
      );
      setIsReconnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (
      !confirm(
        "Are you sure you want to disconnect this OAuth connection? You'll need to reconnect to use this MCP server."
      )
    ) {
      return;
    }
    try {
      setIsDisconnecting(true);
      await disconnectMcpOAuth(workspaceId, server.id);
      toast.success("OAuth connection disconnected");
      trackEvent("mcp_server_oauth_disconnected", {
        workspace_id: workspaceId,
        server_id: server.id,
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to disconnect OAuth connection"
      );
    } finally {
      setIsDisconnecting(false);
    }
  };

  const isOAuth = server.authType === "oauth";
  const serviceName =
    server.serviceType === "google-drive"
      ? "Google Drive"
      : server.serviceType === "gmail"
      ? "Gmail"
      : server.serviceType === "google-calendar"
      ? "Google Calendar"
      : server.serviceType === "notion"
      ? "Notion"
      : server.serviceType === "github"
      ? "GitHub"
      : server.serviceType === "linear"
      ? "Linear"
      : server.serviceType === "hubspot"
      ? "HubSpot"
      : server.serviceType === "salesforce"
      ? "Salesforce"
      : server.serviceType === "slack"
      ? "Slack"
      : server.serviceType === "stripe"
      ? "Stripe"
      : server.serviceType === "posthog"
      ? "PostHog"
      : "Unknown";

  return (
    <div className="flex transform items-center justify-between rounded-xl border-2 border-neutral-300 bg-white p-6 transition-all duration-200 hover:scale-[1.01] hover:shadow-bold active:scale-[0.99] dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex-1">
        <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          {server.name}
        </div>
        {server.url && (
          <div className="mt-1 font-mono text-sm text-neutral-600 dark:text-neutral-400">
            {server.url}
          </div>
        )}
        <div className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Auth: {server.authType}
          {isOAuth && ` (${serviceName})`}
        </div>
        {isOAuth && (
          <div className="mt-1 text-sm">
            {server.oauthConnected ? (
              <span className="text-green-600 dark:text-green-400">✓ Connected</span>
            ) : (
              <span className="text-orange-600 dark:text-orange-400">⚠ Not connected</span>
            )}
          </div>
        )}
      </div>
      {canEdit && (
        <div className="flex gap-2">
          {isOAuth && (
            <>
              {server.oauthConnected ? (
                <>
                  <button
                    onClick={handleReconnect}
                    disabled={isReconnecting}
                    className="rounded-xl bg-gradient-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isReconnecting ? "Reconnecting..." : "Reconnect"}
                  </button>
                  <button
                    onClick={handleDisconnect}
                    disabled={isDisconnecting}
                    className="rounded-xl border border-orange-300 bg-white px-4 py-2 text-sm font-medium text-orange-600 transition-colors hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-orange-600 dark:bg-neutral-900 dark:text-orange-400 dark:hover:bg-orange-950"
                  >
                    {isDisconnecting ? "Disconnecting..." : "Disconnect"}
                  </button>
                </>
              ) : (
                <button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="rounded-xl bg-gradient-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isConnecting ? "Connecting..." : "Connect"}
                </button>
              )}
            </>
          )}
          <button
            onClick={() => onEdit(server.id)}
            className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Edit
          </button>
          <button
            onClick={async () => {
              if (
                !confirm(
                  "Are you sure you want to delete this MCP server? This action cannot be undone."
                )
              ) {
                return;
              }
              try {
                await deleteServer.mutateAsync(server.id);
                trackEvent("mcp_server_deleted", {
                  workspace_id: workspaceId,
                  server_id: server.id,
                });
              } catch {
                // Error is handled by toast in the hook
              }
            }}
            disabled={deleteServer.isPending}
            className="rounded-xl bg-error-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-error-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleteServer.isPending ? "Deleting..." : "Delete"}
          </button>
        </div>
      )}
    </div>
  );
};

export const McpServerList: FC<McpServerListProps> = ({
  workspaceId,
  canEdit,
}) => {
  const { data: serversData, isLoading } = useMcpServers(workspaceId);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<string | null>(null);

  const handleCloseModal = () => {
    setIsCreateModalOpen(false);
    setEditingServer(null);
  };

  const handleEdit = (serverId: string) => {
    setEditingServer(serverId);
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border-2 border-neutral-300 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-900">
        <p className="text-lg font-bold text-neutral-900 dark:text-neutral-50">Loading MCP servers...</p>
      </div>
    );
  }

  const servers = serversData?.servers || [];

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:shadow-colored"
          >
            Create MCP Server
          </button>
        </div>
      )}

      {servers.length === 0 ? (
        <div className="rounded-xl border-2 border-neutral-300 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-900">
          <p className="text-base font-bold text-neutral-700 dark:text-neutral-300">
            No MCP servers configured.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {servers.map((server) => (
            <McpServerItem
              key={server.id}
              server={server}
              workspaceId={workspaceId}
              canEdit={canEdit}
              onEdit={handleEdit}
            />
          ))}
        </div>
      )}

      {(isCreateModalOpen || editingServer) && (
        <McpServerModal
          isOpen={isCreateModalOpen || !!editingServer}
          onClose={handleCloseModal}
          workspaceId={workspaceId}
          serverId={editingServer || undefined}
        />
      )}
    </div>
  );
};
