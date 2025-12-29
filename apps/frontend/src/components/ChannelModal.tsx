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
  const [type, setType] = useState<"discord" | "slack">("discord");
  const [name, setName] = useState(channel?.name || "");
  const [botToken, setBotToken] = useState("");
  const [discordChannelId, setDiscordChannelId] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [showSlackHelp, setShowSlackHelp] = useState(false);

  // Reset form when modal opens/closes or channel changes
  useEffect(() => {
    if (isOpen) {
      if (channel) {
        setName(channel.name);
        setType(channel.type as "discord" | "slack");
        // Don't populate sensitive fields when editing
        setBotToken("");
        setDiscordChannelId("");
        setWebhookUrl("");
        setCreatedChannelId(null);
        setShowSlackHelp(false);
      } else {
        setName("");
        setType("discord");
        setBotToken("");
        setDiscordChannelId("");
        setWebhookUrl("");
        setCreatedChannelId(null);
        setShowSlackHelp(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, channel?.id]);

  const handleClose = () => {
    setName("");
    setBotToken("");
    setDiscordChannelId("");
    setWebhookUrl("");
    setCreatedChannelId(null);
    setShowSlackHelp(false);
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

    // For create, validate required fields based on type
    if (!isEditing) {
      if (type === "discord" && (!botToken.trim() || !discordChannelId.trim())) {
        return;
      }
      if (type === "slack" && !webhookUrl.trim()) {
        return;
      }
    }

    try {
      if (isEditing) {
        const updateData: {
          name?: string;
          config?: { botToken?: string; discordChannelId?: string } | { webhookUrl?: string };
        } = {
          name: name.trim(),
        };
        // Only include config fields if they were provided
        if (type === "discord" && (botToken.trim() || discordChannelId.trim())) {
          updateData.config = {};
          if (botToken.trim()) {
            (updateData.config as { botToken?: string; discordChannelId?: string }).botToken = botToken.trim();
          }
          if (discordChannelId.trim()) {
            (updateData.config as { botToken?: string; discordChannelId?: string }).discordChannelId = discordChannelId.trim();
          }
        } else if (type === "slack" && webhookUrl.trim()) {
          updateData.config = {
            webhookUrl: webhookUrl.trim(),
          };
        }
        await updateChannel.mutateAsync(updateData);
      } else {
        const config = type === "discord"
          ? {
              botToken: botToken.trim(),
              discordChannelId: discordChannelId.trim(),
            }
          : {
              webhookUrl: webhookUrl.trim(),
            };
        const newChannel = await createChannel.mutateAsync({
          type,
          name: name.trim(),
          config,
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
              onChange={(e) => setType(e.target.value as "discord" | "slack")}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              required
              disabled={isEditing}
            >
              <option value="discord">Discord</option>
              <option value="slack">Slack</option>
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
          {type === "discord" && (
            <>
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
                  required={!isEditing && type === "discord"}
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
                  required={!isEditing && type === "discord"}
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
            </>
          )}
          {type === "slack" && (
            <>
              <div>
                <label
                  htmlFor="webhookUrl"
                  className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Webhook URL {isEditing ? "(leave blank to keep current)" : "*"}
                </label>
                <input
                  id="webhookUrl"
                  type="url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                  required={!isEditing && type === "slack"}
                  placeholder="https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX"
                />
                <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  Get this from your Slack App settings → Incoming Webhooks. The
                  webhook URL should start with{" "}
                  <code className="rounded bg-neutral-200 px-1 py-0.5 text-xs dark:bg-neutral-800">
                    https://hooks.slack.com/services/
                  </code>
                </p>
              </div>
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                <button
                  type="button"
                  onClick={() => setShowSlackHelp(!showSlackHelp)}
                  className="w-full px-4 py-3 text-left text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <span>📋</span>
                      <span>How to create a Slack webhook</span>
                    </span>
                    <span className="text-lg font-bold text-neutral-500 dark:text-neutral-400">
                      {showSlackHelp ? "−" : "+"}
                    </span>
                  </div>
                </button>
                {showSlackHelp && (
                  <div className="border-t border-neutral-200 p-4 dark:border-neutral-700">
                    <div className="space-y-4 text-sm text-neutral-700 dark:text-neutral-300">
                      <div>
                        <h4 className="mb-1.5 font-semibold text-neutral-900 dark:text-neutral-50">
                          Step 1: Create a Slack App
                        </h4>
                        <ol className="ml-4 list-decimal space-y-1 text-xs">
                          <li>
                            Navigate to{" "}
                            <a
                              href="https://api.slack.com/apps"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary-600 underline hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                            >
                              api.slack.com/apps
                            </a>{" "}
                            in your web browser
                          </li>
                          <li>Click the <strong>Create New App</strong> button</li>
                          <li>Select <strong>From scratch</strong></li>
                          <li>
                            <strong>App Name:</strong> Give your app a name (e.g., &quot;Server Notifier&quot; or &quot;Daily Reports&quot;). This name will appear as the &quot;sender&quot; of the messages
                          </li>
                          <li>
                            <strong>Pick a workspace:</strong> Select the Slack workspace where you want to post messages
                          </li>
                          <li>Click <strong>Create App</strong></li>
                        </ol>
                      </div>
                      <div>
                        <h4 className="mb-1.5 font-semibold text-neutral-900 dark:text-neutral-50">
                          Step 2: Enable Incoming Webhooks
                        </h4>
                        <ol className="ml-4 list-decimal space-y-1 text-xs">
                          <li>Look at the left-hand sidebar under <strong>Features</strong></li>
                          <li>Click on <strong>Incoming Webhooks</strong></li>
                          <li>
                            Find the toggle switch labeled <strong>Activate Incoming Webhooks</strong> and switch it to <strong>On</strong>
                          </li>
                        </ol>
                      </div>
                      <div>
                        <h4 className="mb-1.5 font-semibold text-neutral-900 dark:text-neutral-50">
                          Step 3: Create the Webhook URL
                        </h4>
                        <ol className="ml-4 list-decimal space-y-1 text-xs">
                          <li>
                            Scroll down to the bottom of the &quot;Incoming Webhooks&quot; page to the section <strong>Webhook URLs for Your Workspace</strong>
                          </li>
                          <li>Click the button <strong>Add New Webhook to Workspace</strong></li>
                          <li>
                            A permission screen will pop up asking where the app should post. Select the specific <strong>Channel</strong> (e.g., #general or #alerts) from the dropdown menu
                          </li>
                          <li>Click <strong>Allow</strong></li>
                        </ol>
                      </div>
                      <div>
                        <h4 className="mb-1.5 font-semibold text-neutral-900 dark:text-neutral-50">
                          Step 4: Copy and Test Your Webhook
                        </h4>
                        <ol className="ml-4 list-decimal space-y-1 text-xs">
                          <li>You will be redirected back to the settings page. You should now see a new entry in the table with a <strong>Webhook URL</strong></li>
                          <li>
                            It will look something like{" "}
                            <code className="rounded bg-neutral-200 px-1 py-0.5 text-xs dark:bg-neutral-800">
                              https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX
                            </code>
                          </li>
                          <li>Click <strong>Copy</strong> next to your new Webhook URL</li>
                          <li>Paste it into the Webhook URL field above</li>
                        </ol>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
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
                (!isEditing &&
                  ((type === "discord" && (!botToken.trim() || !discordChannelId.trim())) ||
                   (type === "slack" && !webhookUrl.trim())))
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
