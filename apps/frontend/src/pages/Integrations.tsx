import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { FC } from "react";
import { useRef, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { DiscordCommandDialog } from "../components/DiscordCommandDialog";
import { DiscordConnectModal } from "../components/DiscordConnectModal";
import { IntegrationCard } from "../components/IntegrationCard";
import { LoadingScreen } from "../components/LoadingScreen";
import { ScrollContainer } from "../components/ScrollContainer";
import { SlackConnectModal } from "../components/SlackConnectModal";
import { VirtualList } from "../components/VirtualList";
import { useToast } from "../hooks/useToast";
import {
  listIntegrations,
  deleteIntegration,
  updateIntegration,
} from "../utils/api";
import { trackEvent } from "../utils/tracking";

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

  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    data: integrationsData,
    isLoading,
    hasNextPage: hasNextIntegrationsPage,
    isFetchingNextPage: isFetchingNextIntegrations,
    fetchNextPage: fetchNextIntegrationsPage,
  } = useInfiniteQuery({
    queryKey: ["integrations", workspaceId, "infinite"],
    queryFn: async ({ pageParam }) => {
      if (!workspaceId) {
        throw new Error("Workspace ID is required");
      }
      return listIntegrations(workspaceId, 50, pageParam);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!workspaceId,
  });

  const integrations = integrationsData?.pages.flatMap((p) => p.integrations) ?? [];

  // Track page view
  useEffect(() => {
    if (workspaceId) {
      trackEvent("integration_page_viewed", {
        workspace_id: workspaceId,
      });
    }
  }, [workspaceId]);

  const deleteMutation = useMutation({
    mutationFn: (integrationId: string) => {
      if (!workspaceId) {
        throw new Error("Workspace ID is required");
      }
      return deleteIntegration(workspaceId, integrationId);
    },
    onSuccess: (_, integrationId) => {
      if (workspaceId) {
        const state = queryClient.getQueryData<{
          pages: Array<{ integrations: Array<{ id: string; platform?: string; agentId?: string }> }>;
        }>(["integrations", workspaceId, "infinite"]);
        const integration = state?.pages
          .flatMap((p) => p.integrations)
          .find((i) => i.id === integrationId);
        queryClient.invalidateQueries({ queryKey: ["integrations", workspaceId] });
        trackEvent("integration_deleted", {
          workspace_id: workspaceId,
          integration_id: integrationId,
          platform: integration?.platform,
          agent_id: integration?.agentId,
        });
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
    onSuccess: (_, { id, status }) => {
      if (workspaceId) {
        const state = queryClient.getQueryData<{
          pages: Array<{ integrations: Array<{ id: string; platform?: string; agentId?: string }> }>;
        }>(["integrations", workspaceId, "infinite"]);
        const integration = state?.pages
          .flatMap((p) => p.integrations)
          .find((i) => i.id === id);
        queryClient.invalidateQueries({ queryKey: ["integrations", workspaceId] });
        trackEvent("integration_updated", {
          workspace_id: workspaceId,
          integration_id: id,
          platform: integration?.platform,
          agent_id: integration?.agentId,
          status,
          updated_fields: ["status"],
        });
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
            Connect your agents to Slack or Discord so they can respond in
            your channels.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              trackEvent("slack_connect_modal_opened", {
                workspace_id: workspaceId,
              });
              setShowSlackModal(true);
            }}
            className="rounded-md bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
          >
            Connect Slack
          </button>
          <button
            onClick={() => {
              trackEvent("discord_connect_modal_opened", {
                workspace_id: workspaceId,
              });
              setShowDiscordModal(true);
            }}
            className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700"
          >
            Connect Discord
          </button>
        </div>
      </div>

      <ScrollContainer ref={scrollRef} maxHeight="70vh">
        <VirtualList
          scrollRef={scrollRef}
          items={integrations}
          estimateSize={() => 180}
          getItemKey={(_i, integration) => integration.id}
          renderRow={(integration) => (
            <div className="border-b border-neutral-200 p-4 last:border-b-0 dark:border-neutral-700">
              <IntegrationCard
                integration={integration}
                onDelete={handleDelete}
                onUpdate={handleUpdate}
                onInstallCommand={handleInstallCommand}
              />
            </div>
          )}
          hasNextPage={hasNextIntegrationsPage ?? false}
          isFetchingNextPage={isFetchingNextIntegrations}
          fetchNextPage={fetchNextIntegrationsPage}
          empty={
            <div className="rounded-lg border border-neutral-200 bg-white p-12 text-center dark:border-neutral-700 dark:bg-neutral-900">
              <p className="text-neutral-600 dark:text-neutral-400">
                No integrations yet. Connect Slack or Discord to let your agent
                reply there.
              </p>
            </div>
          }
        />
      </ScrollContainer>

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

