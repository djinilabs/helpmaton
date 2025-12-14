import { useState } from "react";
import type { FC } from "react";

import { useMcpServers, useDeleteMcpServer } from "../hooks/useMcpServers";
import type { McpServer } from "../utils/api";

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

  return (
    <div className="border-2 border-neutral-300 rounded-xl p-6 bg-white flex justify-between items-center hover:shadow-bold transition-all duration-200 transform hover:scale-[1.01] active:scale-[0.99]">
      <div>
        <div className="text-lg font-semibold text-neutral-900">
          {server.name}
        </div>
        <div className="text-sm mt-1 text-neutral-600 font-mono">
          {server.url}
        </div>
        <div className="text-sm text-neutral-600 mt-1">
          Auth: {server.authType}
        </div>
      </div>
      {canEdit && (
        <div className="flex gap-2">
          <button
            onClick={() => onEdit(server.id)}
            className="border border-neutral-300 bg-white px-4 py-2 text-sm font-medium rounded-xl hover:bg-neutral-50 transition-colors"
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
              } catch {
                // Error is handled by toast in the hook
              }
            }}
            disabled={deleteServer.isPending}
            className="bg-error-600 px-4 py-2.5 text-white text-sm font-semibold rounded-xl hover:bg-error-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
      <div className="border-2 border-neutral-300 rounded-xl p-6 bg-white">
        <p className="font-bold text-lg">Loading MCP servers...</p>
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
            className="bg-gradient-primary px-4 py-2.5 text-white text-sm font-semibold rounded-xl hover:shadow-colored transition-colors"
          >
            Create MCP Server
          </button>
        </div>
      )}

      {servers.length === 0 ? (
        <div className="border-2 border-neutral-300 rounded-xl p-6 bg-white">
          <p className="text-base font-bold text-neutral-700">
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
