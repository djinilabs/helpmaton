import type { FC } from "react";
import { useEffect, useState } from "react";

import { useDialogTracking } from "../contexts/DialogContext";
import { useAgents } from "../hooks/useAgents";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useToast } from "../hooks/useToast";
import {
  generateSlackManifest,
  createIntegration,
  type CreateIntegrationInput,
  type BotIntegration,
} from "../utils/api";

import { SlackManifestDisplay } from "./SlackManifestDisplay";

interface SlackConnectModalProps {
  workspaceId: string;
  agentId?: string; // Pre-select this agent
  onClose: () => void;
  onSuccess: () => void;
}

export const SlackConnectModal: FC<SlackConnectModalProps> = ({
  workspaceId,
  agentId: preSelectedAgentId,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<"manifest" | "credentials" | "complete">(
    "manifest"
  );
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    preSelectedAgentId || ""
  );
  const [botToken, setBotToken] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [integrationName, setIntegrationName] = useState("");
  const [messageHistoryCount, setMessageHistoryCount] = useState(10);
  const [manifestData, setManifestData] = useState<Awaited<
    ReturnType<typeof generateSlackManifest>
  > | null>(null);
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

  const handleGenerateManifest = async () => {
    if (!selectedAgentId) {
      toast.error("Please select an agent");
      return;
    }

    try {
      const agent = agents?.find((a) => a.id === selectedAgentId);
      const data = await generateSlackManifest(
        workspaceId,
        selectedAgentId,
        agent?.name
      );
      setManifestData(data);
      toast.success("Manifest generated successfully");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to generate manifest"
      );
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const handleCreateIntegration = async () => {
    if (!integrationName || !botToken || !signingSecret || !selectedAgentId) {
      toast.error("Please fill in all fields");
      return;
    }

    if (
      messageHistoryCount < 0 ||
      messageHistoryCount > 100 ||
      !Number.isInteger(messageHistoryCount)
    ) {
      toast.error("Message history count must be between 0 and 100");
      return;
    }

    try {
      const input: CreateIntegrationInput = {
        platform: "slack",
        name: integrationName,
        agentId: selectedAgentId,
        config: {
          botToken,
          signingSecret,
          messageHistoryCount,
        },
      };
      const integration = await createIntegration(workspaceId, input);
      setCreatedIntegration(integration);
      toast.success("Integration created successfully");
      setStep("complete");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create integration"
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl dark:bg-neutral-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
            Connect Slack Bot
          </h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          >
            ✕
          </button>
        </div>

        {step === "manifest" && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Select Agent
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
            <button
              onClick={handleGenerateManifest}
              disabled={!selectedAgentId}
              className="w-full rounded-md bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              Generate Manifest
            </button>
            {manifestData && (
              <>
                <SlackManifestDisplay
                  manifestData={manifestData}
                  onCopy={() =>
                    handleCopy(JSON.stringify(manifestData.manifest, null, 2))
                  }
                />
                <button
                  onClick={() => setStep("credentials")}
                  className="w-full rounded-md bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
                >
                  Continue to Credentials
                </button>
              </>
            )}
          </div>
        )}

        {step === "credentials" && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Integration Name
              </label>
              <input
                type="text"
                value={integrationName}
                onChange={(e) => setIntegrationName(e.target.value)}
                placeholder="My Slack Bot"
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Bot User OAuth Token
              </label>
              <input
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="xoxb-..."
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
              />
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Found in Slack app settings → &quot;OAuth &amp; Permissions&quot; → &quot;Bot User OAuth Token&quot;.
                <br />
                <strong>Important:</strong> You must install the app to your workspace first (in &quot;Install App&quot;) before this token will appear.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Signing Secret
              </label>
              <input
                type="password"
                value={signingSecret}
                onChange={(e) => setSigningSecret(e.target.value)}
                placeholder="..."
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
              />
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Found in Slack app settings → &quot;Basic Information&quot; → &quot;App Credentials&quot; → &quot;Signing Secret&quot;
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Message History Count
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={messageHistoryCount}
                onChange={(e) =>
                  setMessageHistoryCount(parseInt(e.target.value, 10) || 0)
                }
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
              />
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Number of previous messages to include as context (0-100). Default: 10.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setStep("manifest")}
                className="flex-1 rounded-md border border-neutral-300 px-4 py-2 font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                Back
              </button>
              <button
                onClick={handleCreateIntegration}
                className="flex-1 rounded-md bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
              >
                Create Integration
              </button>
            </div>
          </div>
        )}

        {step === "complete" && createdIntegration && (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-50 p-4 dark:bg-green-900/20">
              <p className="text-sm text-green-800 dark:text-green-200">
                ✅ Your Slack integration has been created!
              </p>
            </div>
            <div className="rounded-lg border-2 border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
              <h4 className="mb-2 text-sm font-bold text-red-900 dark:text-red-200">
                ⚠️ CRITICAL: Update Webhook URL in Slack
              </h4>
              <p className="mb-2 text-sm text-red-800 dark:text-red-300">
                If your Slack app showed an error for the webhook URL when you created it, that was expected. The manifest contained a placeholder URL.
              </p>
              <p className="text-sm text-red-800 dark:text-red-300">
                <strong>You MUST update the webhook URL below in your Slack app settings, or the bot will not work.</strong>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Webhook URL (Copy this and update in Slack)
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
                Final Step: Update Webhook URL in Slack
              </h4>
              <ol className="list-inside list-decimal space-y-2 text-sm text-blue-800 dark:text-blue-300">
                <li>
                  Go to{" "}
                  <a
                    href="https://api.slack.com/apps"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline"
                  >
                    https://api.slack.com/apps
                  </a>{" "}
                  and select your app
                </li>
                <li>Go to &quot;Event Subscriptions&quot; in the left sidebar</li>
                <li>
                  In the &quot;Request URL&quot; field, paste the webhook URL above
                </li>
                <li>Click &quot;Save Changes&quot;</li>
                <li>
                  Slack will verify the URL - you should see a green checkmark ✅
                </li>
                <li>
                  Make sure &quot;Enable Events&quot; is turned ON and you have subscribed
                  to: <code>app_mentions</code> and <code>message.im</code>
                </li>
              </ol>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  onSuccess();
                  onClose();
                }}
                className="flex-1 rounded-md bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
