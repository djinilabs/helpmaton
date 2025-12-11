import { useState } from "react";
import type { FC } from "react";

import {
  useChannels,
  useDeleteChannel,
  useTestChannel,
} from "../hooks/useChannels";
import type { Channel } from "../utils/api";

import { ChannelModal } from "./ChannelModal";

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
    <div className="border-2 border-neutral-300 rounded-xl p-6 bg-white flex justify-between items-center hover:shadow-bold transition-all duration-200 transform hover:scale-[1.01] active:scale-[0.99]">
      <div>
        <div className="text-lg font-semibold text-neutral-900">
          {channel.name}
        </div>
        <div className="text-sm text-neutral-600 mt-1">
          Type: {channel.type}
        </div>
      </div>
      {canEdit && (
        <div className="flex gap-2">
          <button
            onClick={async () => {
              try {
                await testChannel.mutateAsync();
              } catch {
                // Error is handled by toast in the hook
              }
            }}
            disabled={testChannel.isPending}
            className="border border-neutral-300 bg-white px-4 py-2 text-sm font-medium rounded-xl hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {testChannel.isPending ? "Testing..." : "Test"}
          </button>
          <button
            onClick={() => onEdit(channel.id)}
            className="border border-neutral-300 bg-white px-4 py-2 text-sm font-medium rounded-xl hover:bg-neutral-50 transition-colors"
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
              } catch {
                // Error is handled by toast in the hook
              }
            }}
            disabled={deleteChannel.isPending}
            className="bg-error-600 px-4 py-2.5 text-white text-sm font-semibold rounded-xl hover:bg-error-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {deleteChannel.isPending ? "Deleting..." : "Delete"}
          </button>
        </div>
      )}
    </div>
  );
};

export const ChannelList: FC<ChannelListProps> = ({ workspaceId, canEdit }) => {
  const { data: channels } = useChannels(workspaceId);
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
      <div className="border-2 border-neutral-300 rounded-2xl p-8 mb-8 bg-white shadow-large">
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-3xl font-bold text-neutral-900">
            Notification Channels
          </h2>
          {canEdit && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="bg-gradient-primary px-4 py-2.5 text-white text-sm font-semibold rounded-xl hover:shadow-colored transition-colors"
            >
              Create Channel
            </button>
          )}
        </div>
        <p className="text-sm text-neutral-600 mb-6">
          Notification channels allow your agents to send messages to external
          services like Discord, Slack, or webhooks. Configure channels here and
          agents can use them to send notifications and updates.
        </p>

        {channels.length === 0 ? (
          <p className="text-lg text-neutral-600">
            No channels yet. Create a channel to enable notifications for your
            agents.
          </p>
        ) : (
          <div className="space-y-3">
            {channels.map((channel) => (
              <ChannelItem
                key={channel.id}
                channel={channel}
                workspaceId={workspaceId}
                canEdit={canEdit}
                onEdit={handleEdit}
              />
            ))}
          </div>
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
