import type { FC } from "react";
import { useState } from "react";

import { useAgents } from "../hooks/useAgents";
import { useToast } from "../hooks/useToast";
import {
  generateSlackManifest,
  createIntegration,
  type CreateIntegrationInput,
} from "../utils/api";

import { SlackManifestDisplay } from "./SlackManifestDisplay";

interface SlackConnectModalProps {
  workspaceId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const SlackConnectModal: FC<SlackConnectModalProps> = ({
  workspaceId,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<"manifest" | "credentials">("manifest");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [botToken, setBotToken] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [integrationName, setIntegrationName] = useState("");
  const [manifestData, setManifestData] = useState<Awaited<ReturnType<typeof generateSlackManifest>> | null>(null);
  const { data: agents } = useAgents(workspaceId);
  const toast = useToast();

  const handleGenerateManifest = async () => {
    if (!selectedAgentId) {
      toast.error("Please select an agent");
      return;
    }

    try {
      const agent = agents?.find((a) => a.id === selectedAgentId);
      const data = await generateSlackManifest(workspaceId, selectedAgentId, agent?.name);
      setManifestData(data);
      toast.success("Manifest generated successfully");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to generate manifest");
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

    try {
      const input: CreateIntegrationInput = {
        platform: "slack",
        name: integrationName,
        agentId: selectedAgentId,
        config: {
          botToken,
          signingSecret,
        },
      };
      await createIntegration(workspaceId, input);
      toast.success("Integration created successfully");
      onSuccess();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create integration");
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
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
              >
                <option value="">Select an agent...</option>
                {agents?.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
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
                  onCopy={() => handleCopy(JSON.stringify(manifestData.manifest, null, 2))}
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
      </div>
    </div>
  );
};

