import { useState, useEffect } from "react";
import type { FC } from "react";

import { useDialogTracking } from "../contexts/DialogContext";
import {
  useCreateChannel,
  useUpdateChannel,
  useTestChannel,
} from "../hooks/useChannels";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type { Channel } from "../utils/api";

interface ChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  channel?: Channel | null; // If provided, we're editing; otherwise, creating
}

export const ChannelModal: FC<ChannelModalProps> = ({
  isOpen,
  onClose,
  workspaceId,
  channel,
}) => {
  const isEditing = !!channel;
  const createChannel = useCreateChannel(workspaceId);
  const updateChannel = useUpdateChannel(workspaceId, channel?.id || "");
  const [createdChannelId, setCreatedChannelId] = useState<string | null>(null);
  const channelIdForTest = channel?.id || createdChannelId;
  const testChannel = useTestChannel(workspaceId, channelIdForTest || "");
  // Initialize state from channel prop
  const [type, setType] = useState<"discord">("discord");
  const [name, setName] = useState(channel?.name || "");
  const [botToken, setBotToken] = useState("");
  const [discordChannelId, setDiscordChannelId] = useState("");

  // Reset form when modal opens/closes or channel changes
  useEffect(() => {
    if (isOpen) {
      if (channel) {
        setName(channel.name);
        setType(channel.type as "discord");
        // Don't populate sensitive fields when editing
        setBotToken("");
        setDiscordChannelId("");
        setCreatedChannelId(null);
      } else {
        setName("");
        setType("discord");
        setBotToken("");
        setDiscordChannelId("");
        setCreatedChannelId(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, channel?.id]);

  const handleClose = () => {
    setName("");
    setBotToken("");
    setDiscordChannelId("");
    setCreatedChannelId(null);
    onClose();
  };

  const { registerDialog, unregisterDialog } = useDialogTracking();
  useEscapeKey(isOpen, handleClose);

  useEffect(() => {
    if (isOpen) {
      registerDialog();
      return () => unregisterDialog();
    }
  }, [isOpen, registerDialog, unregisterDialog]);

  const canTest = (isEditing && channel?.id) || createdChannelId;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    // For create, both fields are required
    if (!isEditing && (!botToken.trim() || !discordChannelId.trim())) {
      return;
    }

    try {
      if (isEditing) {
        const updateData: {
          name?: string;
          config?: { botToken?: string; discordChannelId?: string };
        } = {
          name: name.trim(),
        };
        // Only include config fields if they were provided
        if (botToken.trim() || discordChannelId.trim()) {
          updateData.config = {};
          if (botToken.trim()) {
            updateData.config.botToken = botToken.trim();
          }
          if (discordChannelId.trim()) {
            updateData.config.discordChannelId = discordChannelId.trim();
          }
        }
        await updateChannel.mutateAsync(updateData);
      } else {
        const newChannel = await createChannel.mutateAsync({
          type: "discord",
          name: name.trim(),
          config: {
            botToken: botToken.trim(),
            discordChannelId: discordChannelId.trim(),
          },
        });
        setCreatedChannelId(newChannel.id);
        // Don't close immediately - allow user to test
        return;
      }
      handleClose();
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const isPending = isEditing
    ? updateChannel.isPending
    : createChannel.isPending;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="mb-8 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          {isEditing ? "Edit Channel" : "Create Channel"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="type"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Type *
            </label>
            <select
              id="type"
              value={type}
              onChange={(e) => setType(e.target.value as "discord")}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              required
              disabled={isEditing}
            >
              <option value="discord">Discord</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="name"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Name *
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              required
              autoFocus
            />
          </div>
          <div>
            <label
              htmlFor="discordChannelId"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Discord Channel ID{" "}
              {isEditing ? "(leave blank to keep current)" : "*"}
            </label>
            <input
              id="discordChannelId"
              type="text"
              value={discordChannelId}
              onChange={(e) => setDiscordChannelId(e.target.value)}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              required={!isEditing}
              placeholder="123456789012345678"
            />
            <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
              Right-click the Discord channel and select &quot;Copy ID&quot;
              (Developer Mode must be enabled). See{" "}
              <a
                href="/docs/discord-setup.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 underline hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
              >
                setup guide
              </a>{" "}
              for details.
            </p>
          </div>
          <div>
            <label
              htmlFor="botToken"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Bot Token {isEditing ? "(leave blank to keep current)" : "*"}
            </label>
            <input
              id="botToken"
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              required={!isEditing}
              placeholder={
                isEditing ? "Enter new token to update" : "MTIzNDU2..."
              }
            />
            <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
              Get this from the Discord Developer Portal. See{" "}
              <a
                href="/docs/discord-setup.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 underline hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
              >
                setup guide
              </a>{" "}
              for details.
            </p>
          </div>
          {canTest && (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                  Test Channel
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    if (!channelIdForTest) return;
                    try {
                      await testChannel.mutateAsync();
                    } catch {
                      // Error is handled by toast in the hook
                    }
                  }}
                  disabled={
                    testChannel.isPending || isPending || !channelIdForTest
                  }
                  className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
                >
                  {testChannel.isPending ? "Testing..." : "Send Test Message"}
                </button>
              </div>
              <p className="text-xs text-neutral-600 dark:text-neutral-300">
                Send a test message to verify your channel configuration is
                working correctly.
              </p>
            </div>
          )}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={
                isPending ||
                !name.trim() ||
                (!isEditing && (!botToken.trim() || !discordChannelId.trim()))
              }
              className="flex-1 rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending
                ? isEditing
                  ? "Saving..."
                  : "Creating..."
                : isEditing
                ? "Save"
                : "Create"}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={isPending}
              className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              {createdChannelId ? "Done" : "Cancel"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
