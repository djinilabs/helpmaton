import type { FC } from "react";
import { useEffect, useState } from "react";

import { useDialogTracking } from "../contexts/DialogContext";
import { useAgents } from "../hooks/useAgents";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useToast } from "../hooks/useToast";
import {
  createIntegration,
  type CreateIntegrationInput,
  type BotIntegration,
} from "../utils/api";
import { trackEvent } from "../utils/tracking";

interface DiscordConnectModalProps {
  workspaceId: string;
  agentId?: string; // Pre-select this agent
  onClose: () => void;
  onSuccess: () => void;
}

export const DiscordConnectModal: FC<DiscordConnectModalProps> = ({
  workspaceId,
  agentId: preSelectedAgentId,
  onClose,
  onSuccess,
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    preSelectedAgentId || ""
  );
  const [botToken, setBotToken] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [integrationName, setIntegrationName] = useState("");
  const [createdIntegration, setCreatedIntegration] =
    useState<BotIntegration | null>(null);
  const { data: agents } = useAgents(workspaceId);
  const toast = useToast();
  const { registerDialog, unregisterDialog } = useDialogTracking();

  // Handle Escape key to close modal
  useEscapeKey(true, onClose);

  // Register dialog for focus management
  useEffect(() => {
    registerDialog();
    return () => unregisterDialog();
  }, [registerDialog, unregisterDialog]);

  const handleCreateIntegration = async () => {
    if (!integrationName || !botToken || !publicKey || !selectedAgentId) {
      toast.error("Please fill in all required fields");
      return;
    }

    // Validate public key format (64 hex characters)
    if (!/^[0-9a-fA-F]{64}$/.test(publicKey)) {
      toast.error("Public key must be a 64-character hex string");
      return;
    }

    try {
      const input: CreateIntegrationInput = {
        platform: "discord",
        name: integrationName,
        agentId: selectedAgentId,
        config: {
          botToken,
          publicKey,
          applicationId: applicationId || undefined,
        },
      };
      const integration = await createIntegration(workspaceId, input);
      setCreatedIntegration(integration);
      trackEvent("integration_created", {
        workspace_id: workspaceId,
        integration_id: integration.id,
        platform: "discord",
        agent_id: selectedAgentId,
        integration_name: integrationName,
      });
      toast.success("Integration created successfully");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create integration"
      );
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const handleFinish = () => {
    onSuccess();
    onClose();
  };

  // If integration was created, show the webhook URL
  if (createdIntegration) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-neutral-900">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
              Integration Created Successfully
            </h2>
            <button
              onClick={handleFinish}
              className="text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              ✕
            </button>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg bg-green-50 p-4 dark:bg-green-900/20">
              <p className="text-sm text-green-800 dark:text-green-200">
                Your Discord integration has been created. Copy the webhook URL
                below and paste it into Discord&apos;s &quot;Interactions
                Endpoint URL&quot; field.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Webhook URL
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={createdIntegration.webhookUrl}
                  className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
                />
                <button
                  onClick={() => handleCopy(createdIntegration.webhookUrl)}
                  className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
                >
                  Copy
                </button>
              </div>
            </div>

            <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
              <h4 className="mb-2 text-sm font-semibold text-blue-900 dark:text-blue-200">
                Next Steps
              </h4>
              <ol className="list-inside list-decimal space-y-1 text-sm text-blue-800 dark:text-blue-300">
                <li>
                  Go to your Discord app settings at
                  https://discord.com/developers/applications
                </li>
                <li>Navigate to &quot;General Information&quot;</li>
                <li>Scroll to &quot;Interactions Endpoint URL&quot;</li>
                <li>Paste the webhook URL above</li>
                <li>Click &quot;Save Changes&quot;</li>
                <li>
                  Discord will verify the endpoint (you should see a checkmark)
                </li>
              </ol>
            </div>

            <button
              onClick={handleFinish}
              className="w-full rounded-md bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-neutral-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
            Connect Discord Bot
          </h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
            <h4 className="mb-2 text-sm font-semibold text-blue-900 dark:text-blue-200">
              Setup Instructions
            </h4>
            <ol className="list-inside list-decimal space-y-1 text-sm text-blue-800 dark:text-blue-300">
              <li>Go to https://discord.com/developers/applications</li>
              <li>Create a new application or select an existing one</li>
              <li>Go to the &quot;Bot&quot; section and copy the Bot Token</li>
              <li>
                Go to the &quot;General Information&quot; section and copy the
                Public Key
              </li>
              <li>Copy the Application ID (optional but recommended)</li>
              <li>Fill in the form below and create the integration</li>
              <li>
                Copy the webhook URL and paste it into Discord&apos;s
                &quot;Interactions Endpoint URL&quot; field
              </li>
            </ol>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Select Agent *
            </label>
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              disabled={!!preSelectedAgentId}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 disabled:bg-neutral-100 disabled:text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-400"
            >
              <option value="">Select an agent...</option>
              {agents?.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            {preSelectedAgentId && (
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Agent is pre-selected for this integration
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Integration Name *
            </label>
            <input
              type="text"
              value={integrationName}
              onChange={(e) => setIntegrationName(e.target.value)}
              placeholder="My Discord Bot"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Bot Token *
            </label>
            <input
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="..."
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Public Key (64 hex characters) *
            </label>
            <input
              type="text"
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              placeholder="..."
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Application ID (optional)
            </label>
            <input
              type="text"
              value={applicationId}
              onChange={(e) => setApplicationId(e.target.value)}
              placeholder="..."
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-md border border-neutral-300 px-4 py-2 font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateIntegration}
              className="flex-1 rounded-md bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
            >
              Create Integration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
