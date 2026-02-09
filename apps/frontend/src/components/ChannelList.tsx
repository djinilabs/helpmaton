import { useState, useMemo, useRef } from "react";
import type { FC } from "react";

import {
  useChannelsInfinite,
  useDeleteChannel,
  useTestChannel,
} from "../hooks/useChannels";
import type { Channel } from "../utils/api";
import { trackEvent } from "../utils/tracking";

import { ChannelModal } from "./ChannelModal";
import { ScrollContainer } from "./ScrollContainer";
import { VirtualList } from "./VirtualList";

interface ChannelListProps {
  workspaceId: string;
  canEdit: boolean; // Based on permission level (WRITE or OWNER)
}

interface ChannelItemProps {
  channel: Channel;
  workspaceId: string;
  canEdit: boolean;
  onEdit: (channelId: string) => void;
}

const ChannelItem: FC<ChannelItemProps> = ({
  channel,
  workspaceId,
  canEdit,
  onEdit,
}) => {
  const deleteChannel = useDeleteChannel(workspaceId, channel.id);
  const testChannel = useTestChannel(workspaceId, channel.id);

  return (
    <div className="flex transform items-center justify-between rounded-xl border-2 border-neutral-300 bg-white p-6 transition-all duration-200 hover:scale-[1.01] hover:shadow-bold active:scale-[0.99] dark:border-neutral-700 dark:bg-surface-50">
      <div>
        <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          {channel.name}
        </div>
        <div className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          Type: {channel.type}
        </div>
      </div>
      {canEdit && (
        <div className="flex gap-2">
          <button
            onClick={async () => {
              try {
                await testChannel.mutateAsync();
                trackEvent("channel_tested", {
                  workspace_id: workspaceId,
                  channel_id: channel.id,
                  channel_type: channel.type,
                });
              } catch {
                // Error is handled by toast in the hook
              }
            }}
            disabled={testChannel.isPending}
            className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
          >
            {testChannel.isPending ? "✨ Testing..." : "✨ Test"}
          </button>
          <button
            onClick={() => onEdit(channel.id)}
            className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
          >
            Edit
          </button>
          <button
            onClick={async () => {
              if (
                !confirm(
                  "Are you sure you want to delete this channel? This action cannot be undone."
                )
              ) {
                return;
              }
              try {
                await deleteChannel.mutateAsync();
                trackEvent("channel_deleted", {
                  workspace_id: workspaceId,
                  channel_id: channel.id,
                  channel_type: channel.type,
                });
              } catch {
                // Error is handled by toast in the hook
              }
            }}
            disabled={deleteChannel.isPending}
            className="rounded-xl bg-error-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-error-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleteChannel.isPending ? "Deleting..." : "Delete"}
          </button>
        </div>
      )}
    </div>
  );
};

export const ChannelList: FC<ChannelListProps> = ({ workspaceId, canEdit }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useChannelsInfinite(workspaceId, 50);

  const channels = useMemo(
    () => data?.pages.flatMap((p) => p.channels) ?? [],
    [data],
  );

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<string | null>(null);

  const handleCloseModal = () => {
    setIsCreateModalOpen(false);
    setEditingChannel(null);
  };

  const handleEdit = (channelId: string) => {
    setEditingChannel(channelId);
  };

  const channelToEdit = editingChannel
    ? channels.find((c) => c.id === editingChannel)
    : null;

  return (
    <>
      <div className="mb-8 rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-large dark:border-neutral-700 dark:bg-surface-50">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
            Notification Channels
          </h2>
          {canEdit && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:shadow-colored"
            >
              Create Channel
            </button>
          )}
        </div>
        <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-300">
          Notification channels allow your agents to send messages to external
          services like Discord, Slack, or webhooks. Configure channels here and
          agents can use them to send notifications and updates.
        </p>

        {!isLoading && channels.length === 0 ? (
          <p className="text-lg text-neutral-600 dark:text-neutral-300">
            No channels yet. Create a channel to enable notifications for your
            agents.
          </p>
        ) : (
          <ScrollContainer ref={scrollRef} className="mb-4">
            <VirtualList<Channel>
              scrollRef={scrollRef}
              items={channels}
              estimateSize={() => 100}
              getItemKey={(_, c) => c.id}
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              fetchNextPage={fetchNextPage}
              empty={
                <p className="py-4 text-lg text-neutral-600 dark:text-neutral-300">
                  No channels yet. Create a channel to enable notifications for
                  your agents.
                </p>
              }
              renderRow={(channel) => (
                <div className="mb-3">
                  <ChannelItem
                    channel={channel}
                    workspaceId={workspaceId}
                    canEdit={canEdit}
                    onEdit={handleEdit}
                  />
                </div>
              )}
            />
          </ScrollContainer>
        )}
      </div>

      {(isCreateModalOpen || editingChannel) && (
        <ChannelModal
          isOpen={isCreateModalOpen || !!editingChannel}
          onClose={handleCloseModal}
          workspaceId={workspaceId}
          channel={channelToEdit || null}
        />
      )}
    </>
  );
};
