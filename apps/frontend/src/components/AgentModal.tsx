import { useState, useEffect } from "react";
import type { FC } from "react";
import { useNavigate } from "react-router-dom";

import { useDialogTracking } from "../contexts/DialogContext";
import { useCreateAgent, useUpdateAgent } from "../hooks/useAgents";
import { useChannels } from "../hooks/useChannels";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type { Agent, ModelCapabilities } from "../utils/api";
import {
  filterModelsByCapability,
  getCapabilitiesForProvider,
  getCapabilityLabels,
  getModelCapabilities,
  getModelsForProvider,
  getDefaultModelForProvider,
  resolveDefaultModel,
  type Provider,
} from "../utils/modelConfig";
import { trackEvent } from "../utils/tracking";

import { AvatarSelector } from "./AvatarSelector";
import { ModelPricesDialog } from "./ModelPricesDialog";
import { PromptGeneratorDialog } from "./PromptGeneratorDialog";
import { QueryPanel } from "./QueryPanel";
import { ToolsHelpDialog } from "./ToolsHelpDialog";

interface AgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  agent?: Agent | null; // If provided, we're editing; otherwise, creating
}

const AgentModalContent: FC<{
  workspaceId: string;
  isEditing: boolean;
  name: string;
  systemPrompt: string;
  notificationChannelId: string | null;
  modelName: string | null;
  avatar: string | null;
  availableModels: string[];
  defaultModel: string;
  capabilityLabels: string[];
  isLoadingModels: boolean;
  modelLoadError: string | null;
  onNameChange: (name: string) => void;
  onSystemPromptChange: (prompt: string) => void;
  onNotificationChannelChange: (id: string | null) => void;
  onModelNameChange: (modelName: string | null) => void;
  onAvatarSelectorOpen: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  isPending: boolean;
  onHelpOpen: () => void;
  onPromptGeneratorOpen: () => void;
  onModelPricesOpen: () => void;
}> = ({
  workspaceId,
  isEditing,
  name,
  systemPrompt,
  notificationChannelId,
  modelName,
  avatar,
  availableModels,
  defaultModel,
  capabilityLabels,
  isLoadingModels,
  modelLoadError,
  onNameChange,
  onSystemPromptChange,
  onNotificationChannelChange,
  onModelNameChange,
  onAvatarSelectorOpen,
  onSubmit,
  onClose,
  isPending,
  onHelpOpen,
  onPromptGeneratorOpen,
  onModelPricesOpen,
}) => {
  const { data: channels } = useChannels(workspaceId);

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label
          htmlFor="name"
          className="mb-2 block text-sm font-medium text-neutral-700"
        >
          Name *
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className="w-full rounded-lg border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
          required
          autoFocus
        />
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label
            htmlFor="systemPrompt"
            className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
          >
            System Prompt *
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onPromptGeneratorOpen}
              className="rounded-lg border-2 border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              {systemPrompt.trim() ? "✨ Improve with AI" : "✨ Generate with AI"}
            </button>
            <button
              type="button"
              onClick={onHelpOpen}
              className="rounded-lg border-2 border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              ? Available Tools
            </button>
          </div>
        </div>
        <textarea
          id="systemPrompt"
          value={systemPrompt}
          onChange={(e) => onSystemPromptChange(e.target.value)}
          className="w-full rounded-lg border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
          rows={12}
          required
        />
        <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
          Markdown is supported in the system prompt.
        </p>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label
            htmlFor="model"
            className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
          >
            Model
          </label>
          <button
            type="button"
            onClick={onModelPricesOpen}
            className="rounded-lg border-2 border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
          >
            💰 Model prices
          </button>
        </div>
        <select
          id="model"
          disabled={isLoadingModels}
          value={isLoadingModels ? "" : modelName || defaultModel}
          onChange={(e) => {
            const selectedModel = e.target.value;
            onModelNameChange(
              selectedModel === defaultModel ? null : selectedModel
            );
          }}
          className="w-full rounded-lg border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
        >
          {isLoadingModels ? (
            <option value="">Loading models...</option>
          ) : availableModels.length === 0 ? (
            <option value="">No models available</option>
          ) : (
            availableModels.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))
          )}
        </select>
        <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
          Select the AI model to use for this agent. Default: {defaultModel}
        </p>
        <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
          {capabilityLabels.length > 0
            ? `Capabilities: ${capabilityLabels.join(", ")}`
            : "Capabilities: unavailable"}
        </p>
        {modelLoadError && (
          <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
            {modelLoadError}
          </p>
        )}
      </div>
      <div>
        <label
          htmlFor="avatar"
          className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
        >
          Avatar
        </label>
        <div className="flex items-center gap-4">
          {avatar && (
            <img
              src={avatar}
              alt="Agent avatar"
              className="size-16 rounded-lg border-2 border-neutral-300 object-contain dark:border-neutral-700"
            />
          )}
          <button
            type="button"
            onClick={onAvatarSelectorOpen}
            className="rounded-lg border-2 border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
          >
            {avatar ? "Change Avatar" : "Select Avatar"}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
          Choose an avatar image for this agent. If not selected, a random
          avatar will be assigned.
        </p>
      </div>
      <div>
        <label
          htmlFor="notificationChannel"
          className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
        >
          Notification Channel
        </label>
        <select
          id="notificationChannel"
          value={notificationChannelId || ""}
          onChange={(e) => onNotificationChannelChange(e.target.value || null)}
          className="w-full rounded-lg border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
        >
          <option value="">None</option>
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.name} ({channel.type})
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
          Select a notification channel to enable the send_notification tool for
          this agent.
        </p>
      </div>
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending || !name.trim() || !systemPrompt.trim()}
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
          onClick={onClose}
          disabled={isPending}
          className="flex-1 rounded-lg border-2 border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

export const AgentModal: FC<AgentModalProps> = ({
  isOpen,
  onClose,
  workspaceId,
  agent,
}) => {
  const navigate = useNavigate();
  const isEditing = !!agent;
  const createAgent = useCreateAgent(workspaceId);
  const updateAgent = useUpdateAgent(workspaceId, agent?.id || "");
  // Initialize state from agent prop
  const [name, setName] = useState(agent?.name || "");
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt || "");
  const [notificationChannelId, setNotificationChannelId] = useState<
    string | null
  >(agent?.notificationChannelId || null);
  const [modelName, setModelName] = useState<string | null>(
    agent?.modelName || null
  );
  const [avatar, setAvatar] = useState<string | null>(agent?.avatar || null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isPromptGeneratorOpen, setIsPromptGeneratorOpen] = useState(false);
  const [isAvatarSelectorOpen, setIsAvatarSelectorOpen] = useState(false);
  const [isModelPricesOpen, setIsModelPricesOpen] = useState(false);

  // Model fetching state
  const provider: Provider = "openrouter";
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState<string>("");
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [modelCapabilities, setModelCapabilities] = useState<
    Record<string, ModelCapabilities> | undefined
  >(undefined);

  // Fetch models on mount
  useEffect(() => {
    let cancelled = false;

    async function loadModels() {
      setIsLoadingModels(true);
      try {
        const [models, defaultModelName, capabilities] = await Promise.all([
          getModelsForProvider(provider),
          getDefaultModelForProvider(provider),
          getCapabilitiesForProvider(provider),
        ]);
        const filteredModels = filterModelsByCapability(
          models,
          capabilities,
          "text_generation"
        );
        const resolvedDefaultModel = resolveDefaultModel(
          filteredModels,
          defaultModelName
        );
        if (!cancelled) {
          setAvailableModels(filteredModels);
          setDefaultModel(resolvedDefaultModel);
          setModelCapabilities(capabilities);
          setModelName((current) =>
            current && !filteredModels.includes(current) ? null : current
          );
        }
      } catch (error) {
        console.error("Failed to load models:", error);
        if (!cancelled) {
          setAvailableModels([]);
          setDefaultModel("");
          setModelCapabilities(undefined);
          setModelLoadError(
            "Failed to load available models. Please refresh the page."
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingModels(false);
        }
      }
    }

    loadModels();

    return () => {
      cancelled = true;
    };
  }, [provider]);

  // Reset form when modal opens/closes or agent changes
  useEffect(() => {
    if (isOpen) {
      if (agent) {
        setName(agent.name);
        setSystemPrompt(agent.systemPrompt);
        setNotificationChannelId(agent.notificationChannelId || null);
        setModelName(agent.modelName || null);
        setAvatar(agent.avatar || null);
      } else {
        setName("");
        setSystemPrompt("");
        setNotificationChannelId(null);
        setModelName(null);
        setAvatar(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, agent?.id]);

  const handleClose = () => {
    setName("");
    setSystemPrompt("");
    setNotificationChannelId(null);
    setModelName(null);
    setAvatar(null);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !systemPrompt.trim()) return;

    try {
      if (isEditing) {
        const updatedAgent = await updateAgent.mutateAsync({
          name: name.trim(),
          systemPrompt: systemPrompt.trim(),
          notificationChannelId: notificationChannelId || null,
          modelName: modelName || null,
          avatar: avatar || null,
        });
        trackEvent("agent_updated", {
          workspace_id: workspaceId,
          agent_id: updatedAgent.id || agent?.id,
          model_name: updatedAgent.modelName || modelName || undefined,
          has_notification_channel: !!notificationChannelId,
          has_avatar: !!avatar,
        });
        handleClose();
      } else {
        const createdAgent = await createAgent.mutateAsync({
          name: name.trim(),
          systemPrompt: systemPrompt.trim(),
          notificationChannelId: notificationChannelId || null,
          modelName: modelName || null,
          avatar: avatar || null,
        });
        trackEvent("agent_created", {
          workspace_id: workspaceId,
          agent_id: createdAgent.id,
          model_name: createdAgent.modelName || modelName || undefined,
          has_notification_channel: !!notificationChannelId,
          has_avatar: !!avatar,
        });
        handleClose();
        navigate(`/workspaces/${workspaceId}/agents/${createdAgent.id}`);
      }
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const isPending = isEditing ? updateAgent.isPending : createAgent.isPending;
  const selectedModelName = modelName || defaultModel;
  const selectedCapabilities = getModelCapabilities(
    modelCapabilities,
    selectedModelName
  );
  const capabilityLabels = getCapabilityLabels(selectedCapabilities);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border-2 border-neutral-300 bg-white p-10 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="mb-8 text-4xl font-black tracking-tight text-neutral-900 dark:text-neutral-50">
          {isEditing ? "Edit Agent" : "Create Agent"}
        </h2>
        <QueryPanel
          fallback={
            <div className="py-8 text-center">
              <div className="text-lg font-medium text-neutral-600 dark:text-neutral-300">
                Loading channels...
              </div>
            </div>
          }
        >
          <AgentModalContent
            workspaceId={workspaceId}
            isEditing={isEditing}
            name={name}
            systemPrompt={systemPrompt}
            notificationChannelId={notificationChannelId}
            modelName={modelName}
            avatar={avatar}
            availableModels={availableModels}
            defaultModel={defaultModel}
            capabilityLabels={capabilityLabels}
            isLoadingModels={isLoadingModels}
            modelLoadError={modelLoadError}
            onNameChange={setName}
            onSystemPromptChange={setSystemPrompt}
            onNotificationChannelChange={setNotificationChannelId}
            onModelNameChange={setModelName}
            onAvatarSelectorOpen={() => setIsAvatarSelectorOpen(true)}
            onSubmit={handleSubmit}
            onClose={handleClose}
            isPending={isPending}
            onHelpOpen={() => setIsHelpOpen(true)}
            onPromptGeneratorOpen={() => setIsPromptGeneratorOpen(true)}
            onModelPricesOpen={() => setIsModelPricesOpen(true)}
          />
        </QueryPanel>
        <ToolsHelpDialog
          isOpen={isHelpOpen}
          onClose={() => setIsHelpOpen(false)}
          workspaceId={workspaceId}
          agent={agent}
        />
        <PromptGeneratorDialog
          isOpen={isPromptGeneratorOpen}
          onClose={() => setIsPromptGeneratorOpen(false)}
          workspaceId={workspaceId}
          agentId={agent?.id}
          hasExistingPrompt={!!(systemPrompt?.trim())}
          onAccept={(prompt) => {
            setSystemPrompt(prompt);
            setIsPromptGeneratorOpen(false);
          }}
        />
        <AvatarSelector
          isOpen={isAvatarSelectorOpen}
          onClose={() => setIsAvatarSelectorOpen(false)}
          onSelect={setAvatar}
          currentAvatar={avatar}
        />
        <ModelPricesDialog
          isOpen={isModelPricesOpen}
          onClose={() => setIsModelPricesOpen(false)}
          capabilityFilter="text_generation"
        />
      </div>
    </div>
  );
};
