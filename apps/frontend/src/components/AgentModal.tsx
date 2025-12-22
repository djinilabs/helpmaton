import { useState, useEffect } from "react";
import type { FC } from "react";

import { useCreateAgent, useUpdateAgent } from "../hooks/useAgents";
import { useChannels } from "../hooks/useChannels";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type { Agent, ClientTool } from "../utils/api";
import {
  getModelsForProvider,
  getDefaultModelForProvider,
  type Provider,
} from "../utils/modelConfig";

import { ClientToolEditor } from "./ClientToolEditor";
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
  clientTools: ClientTool[];
  availableModels: string[];
  defaultModel: string;
  isLoadingModels: boolean;
  modelLoadError: string | null;
  onNameChange: (name: string) => void;
  onSystemPromptChange: (prompt: string) => void;
  onNotificationChannelChange: (id: string | null) => void;
  onModelNameChange: (modelName: string | null) => void;
  onClientToolsChange: (tools: ClientTool[]) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  isPending: boolean;
  onHelpOpen: () => void;
  onPromptGeneratorOpen: () => void;
}> = ({
  workspaceId,
  isEditing,
  name,
  systemPrompt,
  notificationChannelId,
  modelName,
  availableModels,
  defaultModel,
  isLoadingModels,
  modelLoadError,
  onNameChange,
  onSystemPromptChange,
  onNotificationChannelChange,
  onModelNameChange,
  clientTools,
  onClientToolsChange,
  onSubmit,
  onClose,
  isPending,
  onHelpOpen,
  onPromptGeneratorOpen,
}) => {
  const { data: channels } = useChannels(workspaceId);

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label
          htmlFor="name"
          className="block text-sm font-medium text-neutral-700 mb-2"
        >
          Name *
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className="w-full border-2 border-neutral-300 rounded-lg bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-colors dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-primary-400 dark:focus:border-primary-500"
          required
          autoFocus
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
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
              className="text-xs font-medium border-2 border-neutral-300 bg-white px-2.5 py-1 rounded-lg hover:bg-neutral-50 transition-colors dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              ✨ Get Help
            </button>
            <button
              type="button"
              onClick={onHelpOpen}
              className="text-xs font-medium border-2 border-neutral-300 bg-white px-2.5 py-1 rounded-lg hover:bg-neutral-50 transition-colors dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              ? Available Tools
            </button>
          </div>
        </div>
        <textarea
          id="systemPrompt"
          value={systemPrompt}
          onChange={(e) => onSystemPromptChange(e.target.value)}
          className="w-full border-2 border-neutral-300 rounded-lg bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-colors dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-primary-400 dark:focus:border-primary-500"
          rows={12}
          required
        />
        <p className="text-xs mt-1.5 text-neutral-600 dark:text-neutral-400">
          Markdown is supported in the system prompt.
        </p>
      </div>
      <div>
        <label
          htmlFor="model"
          className="block text-sm font-medium text-neutral-700 mb-2 dark:text-neutral-300"
        >
          Model
        </label>
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
          className="w-full border-2 border-neutral-300 rounded-lg bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-primary-400 dark:focus:border-primary-500"
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
        <p className="text-xs mt-1.5 text-neutral-600 dark:text-neutral-400">
          Select the AI model to use for this agent. Default: {defaultModel}
        </p>
        {modelLoadError && (
          <p className="text-xs mt-1.5 text-red-600 dark:text-red-400">{modelLoadError}</p>
        )}
      </div>
      <div>
        <label
          htmlFor="notificationChannel"
          className="block text-sm font-medium text-neutral-700 mb-2 dark:text-neutral-300"
        >
          Notification Channel
        </label>
        <select
          id="notificationChannel"
          value={notificationChannelId || ""}
          onChange={(e) => onNotificationChannelChange(e.target.value || null)}
          className="w-full border-2 border-neutral-300 rounded-lg bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-colors dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-primary-400 dark:focus:border-primary-500"
        >
          <option value="">None</option>
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.name} ({channel.type})
            </option>
          ))}
        </select>
        <p className="text-xs mt-1.5 text-neutral-600 dark:text-neutral-400">
          Select a notification channel to enable the send_notification tool for
          this agent.
        </p>
      </div>
      <div>
        <ClientToolEditor tools={clientTools} onChange={onClientToolsChange} />
      </div>
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending || !name.trim() || !systemPrompt.trim()}
          className="flex-1 bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
          className="flex-1 border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-700 font-medium rounded-lg hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
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
  const [clientTools, setClientTools] = useState<ClientTool[]>(
    agent?.clientTools || []
  );
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isPromptGeneratorOpen, setIsPromptGeneratorOpen] = useState(false);

  // Model fetching state
  const provider: Provider = "google";
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState<string>("");
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);

  // Fetch models on mount
  useEffect(() => {
    let cancelled = false;

    async function loadModels() {
      setIsLoadingModels(true);
      try {
        const [models, defaultModelName] = await Promise.all([
          getModelsForProvider(provider),
          getDefaultModelForProvider(provider),
        ]);
        if (!cancelled) {
          setAvailableModels(models);
          setDefaultModel(defaultModelName);
        }
      } catch (error) {
        console.error("Failed to load models:", error);
        if (!cancelled) {
          setAvailableModels([]);
          setDefaultModel("");
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
        setClientTools(agent.clientTools || []);
      } else {
        setName("");
        setSystemPrompt("");
        setNotificationChannelId(null);
        setModelName(null);
        setClientTools([]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, agent?.id]);

  const handleClose = () => {
    setName("");
    setSystemPrompt("");
    setNotificationChannelId(null);
    setModelName(null);
    setClientTools([]);
    onClose();
  };

  useEscapeKey(isOpen, handleClose);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !systemPrompt.trim()) return;

    try {
      if (isEditing) {
        await updateAgent.mutateAsync({
          name: name.trim(),
          systemPrompt: systemPrompt.trim(),
          notificationChannelId: notificationChannelId || null,
          modelName: modelName || null,
          clientTools: clientTools.length > 0 ? clientTools : undefined,
        });
      } else {
        await createAgent.mutateAsync({
          name: name.trim(),
          systemPrompt: systemPrompt.trim(),
          notificationChannelId: notificationChannelId || null,
          modelName: modelName || null,
          clientTools: clientTools.length > 0 ? clientTools : undefined,
        });
      }
      handleClose();
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const isPending = isEditing ? updateAgent.isPending : createAgent.isPending;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white border-2 border-neutral-300 rounded-2xl shadow-dramatic p-10 max-w-2xl w-full max-h-[90vh] overflow-y-auto dark:bg-neutral-900 dark:border-neutral-700">
        <h2 className="text-4xl font-black text-neutral-900 mb-8 tracking-tight dark:text-neutral-50">
          {isEditing ? "Edit Agent" : "Create Agent"}
        </h2>
        <QueryPanel
          fallback={
            <div className="text-center py-8">
              <div className="text-lg font-medium text-neutral-600 dark:text-neutral-400">
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
            availableModels={availableModels}
            defaultModel={defaultModel}
            isLoadingModels={isLoadingModels}
            modelLoadError={modelLoadError}
            onNameChange={setName}
            onSystemPromptChange={setSystemPrompt}
            onNotificationChannelChange={setNotificationChannelId}
            onModelNameChange={setModelName}
            clientTools={clientTools}
            onClientToolsChange={setClientTools}
            onSubmit={handleSubmit}
            onClose={handleClose}
            isPending={isPending}
            onHelpOpen={() => setIsHelpOpen(true)}
            onPromptGeneratorOpen={() => setIsPromptGeneratorOpen(true)}
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
          onAccept={(prompt) => {
            setSystemPrompt(prompt);
            setIsPromptGeneratorOpen(false);
          }}
        />
      </div>
    </div>
  );
};
