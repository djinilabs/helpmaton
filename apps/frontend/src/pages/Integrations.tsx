import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { FC } from "react";
import { useState } from "react";
import { useParams } from "react-router-dom";

import { DiscordCommandDialog } from "../components/DiscordCommandDialog";
import { DiscordConnectModal } from "../components/DiscordConnectModal";
import { IntegrationCard } from "../components/IntegrationCard";
import { LoadingScreen } from "../components/LoadingScreen";
import { SlackConnectModal } from "../components/SlackConnectModal";
import { useToast } from "../hooks/useToast";
import {
  listIntegrations,
  deleteIntegration,
  updateIntegration,
} from "../utils/api";

const Integrations: FC = () => {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [showSlackModal, setShowSlackModal] = useState(false);
  const [showDiscordModal, setShowDiscordModal] = useState(false);
  const [commandDialogState, setCommandDialogState] = useState<{
    integrationId: string;
    currentCommandName?: string;
  } | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: integrations, isLoading } = useQuery({
    queryKey: ["integrations", workspaceId],
    queryFn: () => {
      if (!workspaceId) {
        throw new Error("Workspace ID is required");
      }
      return listIntegrations(workspaceId);
    },
    enabled: !!workspaceId,
  });

  const deleteMutation = useMutation({
    mutationFn: (integrationId: string) => {
      if (!workspaceId) {
        throw new Error("Workspace ID is required");
      }
      return deleteIntegration(workspaceId, integrationId);
    },
    onSuccess: () => {
      if (workspaceId) {
        queryClient.invalidateQueries({ queryKey: ["integrations", workspaceId] });
      }
      toast.success("Integration deleted successfully");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete integration");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "inactive" | "error" }) => {
      if (!workspaceId) {
        throw new Error("Workspace ID is required");
      }
      return updateIntegration(workspaceId, id, { status });
    },
    onSuccess: () => {
      if (workspaceId) {
        queryClient.invalidateQueries({ queryKey: ["integrations", workspaceId] });
      }
      toast.success("Integration updated successfully");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update integration");
    },
  });

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this integration?")) {
      deleteMutation.mutate(id);
    }
  };

  const handleUpdate = (id: string, status: "active" | "inactive" | "error") => {
    updateMutation.mutate({ id, status });
  };

  const handleInstallCommand = (integrationId: string, currentCommandName?: string) => {
    setCommandDialogState({ integrationId, currentCommandName });
  };

  const handleCommandDialogSuccess = () => {
    if (workspaceId) {
      queryClient.invalidateQueries({ queryKey: ["integrations", workspaceId] });
    }
    setCommandDialogState(null);
  };

  if (!workspaceId) {
    return <div>Workspace ID is required</div>;
  }

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
            Integrations
          </h1>
          <p className="mt-2 text-neutral-600 dark:text-neutral-400">
            Connect your agents to Slack or Discord bots
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowSlackModal(true)}
            className="rounded-md bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
          >
            Connect Slack
          </button>
          <button
            onClick={() => setShowDiscordModal(true)}
            className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700"
          >
            Connect Discord
          </button>
        </div>
      </div>

      {integrations && integrations.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {integrations.map((integration) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              onDelete={handleDelete}
              onUpdate={handleUpdate}
              onInstallCommand={handleInstallCommand}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-neutral-200 bg-white p-12 text-center dark:border-neutral-700 dark:bg-neutral-900">
          <p className="text-neutral-600 dark:text-neutral-400">
            No integrations yet. Connect a Slack or Discord bot to get started.
          </p>
        </div>
      )}

      {showSlackModal && (
        <SlackConnectModal
          workspaceId={workspaceId}
          onClose={() => setShowSlackModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["integrations", workspaceId] });
          }}
        />
      )}

      {showDiscordModal && (
        <DiscordConnectModal
          workspaceId={workspaceId}
          onClose={() => setShowDiscordModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["integrations", workspaceId] });
          }}
        />
      )}

      {commandDialogState && (
        <DiscordCommandDialog
          workspaceId={workspaceId}
          integrationId={commandDialogState.integrationId}
          currentCommandName={commandDialogState.currentCommandName}
          onClose={() => setCommandDialogState(null)}
          onSuccess={handleCommandDialogSuccess}
        />
      )}
    </div>
  );
};

export default Integrations;

