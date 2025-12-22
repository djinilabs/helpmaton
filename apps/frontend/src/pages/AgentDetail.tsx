import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { useState, Suspense, useRef, useEffect, lazy } from "react";
import type { FC } from "react";
import { useParams, useNavigate } from "react-router-dom";

import { AccordionSection } from "../components/AccordionSection";
import { ClientToolEditor } from "../components/ClientToolEditor";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { LazyAccordionContent } from "../components/LazyAccordionContent";
import { LoadingScreen } from "../components/LoadingScreen";
import { QueryPanel } from "../components/QueryPanel";
import { SectionGroup } from "../components/SectionGroup";
// Lazy load accordion components
const AgentChat = lazy(() =>
  import("../components/AgentChat").then((module) => ({
    default: module.AgentChat,
  }))
);
const ConversationList = lazy(() =>
  import("../components/ConversationList").then((module) => ({
    default: module.ConversationList,
  }))
);
const SpendingLimitsManager = lazy(() =>
  import("../components/SpendingLimitsManager").then((module) => ({
    default: module.SpendingLimitsManager,
  }))
);
const UsageDashboard = lazy(() =>
  import("../components/UsageDashboard").then((module) => ({
    default: module.UsageDashboard,
  }))
);
const AgentMemoryRecords = lazy(() =>
  import("../components/AgentMemoryRecords").then((module) => ({
    default: module.AgentMemoryRecords,
  }))
);
import { useAccordion } from "../hooks/useAccordion";
import {
  useAgent,
  useDeleteAgent,
  useAgentKeys,
  useCreateAgentKey,
  useDeleteAgentKey,
  useAgents,
  useUpdateAgent,
} from "../hooks/useAgents";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useMcpServers } from "../hooks/useMcpServers";
import {
  useStreamServer,
  useCreateStreamServer,
  useUpdateStreamServer,
  useDeleteStreamServer,
} from "../hooks/useStreamServer";
import { useStreamUrl } from "../hooks/useStreamUrl";
import { useAgentUsage, useAgentDailyUsage } from "../hooks/useUsage";
import { useWorkspace } from "../hooks/useWorkspaces";
import type { ClientTool, Conversation } from "../utils/api";
import { type DateRangePreset, getDateRange } from "../utils/dateRanges";
import {
  getModelsForProvider,
  getDefaultModelForProvider,
  type Provider,
} from "../utils/modelConfig";

// Lazy load modals - only load when opened
const AgentModal = lazy(() =>
  import("../components/AgentModal").then((module) => ({
    default: module.AgentModal,
  }))
);
const ConversationDetailModal = lazy(() =>
  import("../components/ConversationDetailModal").then((module) => ({
    default: module.ConversationDetailModal,
  }))
);
const ToolsHelpDialog = lazy(() =>
  import("../components/ToolsHelpDialog").then((module) => ({
    default: module.ToolsHelpDialog,
  }))
);

// Lazy load ReactMarkdown - heavy dependency
// Create a wrapper component that loads both ReactMarkdown and remarkGfm
const LazyMarkdownRenderer = lazy(async () => {
  const [ReactMarkdownModule, remarkGfmModule] = await Promise.all([
    import("react-markdown"),
    import("remark-gfm"),
  ]);
  const ReactMarkdown = ReactMarkdownModule.default;
  const remarkGfm = remarkGfmModule.default;

  return {
    default: ({
      children,
      components,
    }: {
      children: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      components: Record<string, React.ComponentType<any>>;
    }) => (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    ),
  };
});

const PERMISSION_LEVELS = {
  READ: 1,
  WRITE: 2,
  OWNER: 3,
};

const AgentDataLoader: FC<{ workspaceId: string; agentId: string }> = ({
  workspaceId,
  agentId,
}) => {
  const { data: workspace } = useWorkspace(workspaceId);
  const { data: agent } = useAgent(workspaceId, agentId);
  const { data: keys } = useAgentKeys(workspaceId, agentId);
  return (
    <AgentDetailContent
      workspace={workspace}
      agent={agent}
      keys={keys}
      workspaceId={workspaceId}
      agentId={agentId}
    />
  );
};

interface AgentDetailContentProps {
  workspace: ReturnType<typeof useWorkspace>["data"];
  agent: ReturnType<typeof useAgent>["data"];
  keys: ReturnType<typeof useAgentKeys>["data"];
  workspaceId: string;
  agentId: string;
}

const AgentDetailContent: FC<AgentDetailContentProps> = ({
  workspace,
  agent,
  keys,
  workspaceId,
  agentId,
}) => {
  const navigate = useNavigate();
  const deleteAgent = useDeleteAgent(workspaceId, agentId);
  const createKey = useCreateAgentKey(workspaceId, agentId);
  const updateAgent = useUpdateAgent(workspaceId, agentId);
  const { data: allAgents } = useAgents(workspaceId);
  const { data: mcpServersData } = useMcpServers(workspaceId);
  const { data: streamServerConfig } = useStreamServer(workspaceId, agentId);
  const createStreamServer = useCreateStreamServer(workspaceId, agentId);
  const updateStreamServer = useUpdateStreamServer(workspaceId, agentId);
  const deleteStreamServer = useDeleteStreamServer(workspaceId, agentId);
  const { data: streamUrlData } = useStreamUrl();

  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<{
    id: string;
    key: string;
  } | null>(null);
  const [isConfiguringStreamServer, setIsConfiguringStreamServer] =
    useState(false);
  const [allowedOrigins, setAllowedOrigins] = useState<string>("");
  const [isStreamTestModalOpen, setIsStreamTestModalOpen] = useState(false);
  const [selectedConversation, setSelectedConversation] =
    useState<Conversation | null>(null);
  const [showScrollIndicator, setShowScrollIndicator] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const systemPromptRef = useRef<HTMLDivElement>(null);

  const { expandedSection, toggleSection } = useAccordion("agent-detail");

  useEscapeKey(isStreamTestModalOpen, () => setIsStreamTestModalOpen(false));

  const canEdit = !!(
    workspace.permissionLevel &&
    workspace.permissionLevel >= PERMISSION_LEVELS.WRITE
  );

  // Use agent prop directly for delegatableAgentIds, with local state for editing
  const [delegatableAgentIds, setDelegatableAgentIds] = useState<string[]>(
    () => agent?.delegatableAgentIds || []
  );

  // Use agent prop directly for enabledMcpServerIds, with local state for editing
  const [enabledMcpServerIds, setEnabledMcpServerIds] = useState<string[]>(
    () => agent?.enabledMcpServerIds || []
  );

  // Use agent prop directly for enableMemorySearch, with local state for editing
  const [enableMemorySearch, setEnableMemorySearch] = useState<boolean>(
    () => agent?.enableMemorySearch ?? false
  );

  // Use agent prop directly for clientTools, with local state for editing
  const [clientTools, setClientTools] = useState<ClientTool[]>(
    () => agent?.clientTools || []
  );

  // Model state - provider is always "google", only modelName can be changed
  const provider: Provider = "google";
  const [modelName, setModelName] = useState<string | null>(() => {
    return agent?.modelName || null;
  });

  // Model fetching state
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

  // Sync modelName with agent prop when agent changes
  // Only sync if we're not currently editing (to avoid overwriting user's changes)
  const prevAgentIdRef = useRef<string | undefined>(agent?.id);
  const prevModelNameRef = useRef<string | null | undefined>(agent?.modelName);
  const prevIsEditingRef = useRef<boolean>(isEditing);
  useEffect(() => {
    if (!agent) return;

    const currentModelName = agent.modelName || null;
    const agentIdChanged = agent.id !== prevAgentIdRef.current;
    const modelNameChanged = currentModelName !== prevModelNameRef.current;
    const justExitedEditing = prevIsEditingRef.current && !isEditing;

    // Sync when:
    // 1. Agent ID changed (different agent loaded)
    // 2. Model name changed AND we're not editing (or just exited editing mode)
    if (
      agentIdChanged ||
      (modelNameChanged && (!isEditing || justExitedEditing))
    ) {
      prevAgentIdRef.current = agent.id;
      prevModelNameRef.current = currentModelName;
      prevIsEditingRef.current = isEditing;

      setModelName(currentModelName);
    } else {
      // Update refs even if we don't sync, to track state
      prevAgentIdRef.current = agent.id;
      prevModelNameRef.current = currentModelName;
      prevIsEditingRef.current = isEditing;
    }
  }, [agent, isEditing]);

  // Advanced model configuration state
  const [temperature, setTemperature] = useState<number | undefined>(
    () => agent?.temperature ?? undefined
  );
  const [topP, setTopP] = useState<number | undefined>(
    () => agent?.topP ?? undefined
  );
  const [topK, setTopK] = useState<number | undefined>(
    () => agent?.topK ?? undefined
  );
  const [maxOutputTokens, setMaxOutputTokens] = useState<number | undefined>(
    () => agent?.maxOutputTokens ?? undefined
  );
  const [stopSequences, setStopSequences] = useState<string>(
    () => agent?.stopSequences?.join(", ") || ""
  );
  const [maxToolRoundtrips, setMaxToolRoundtrips] = useState<
    number | undefined
  >(() => agent?.maxToolRoundtrips ?? undefined);

  // Refs to track previous values and avoid unnecessary updates
  // Normalize null to undefined for consistency
  const normalizeValue = (val: number | null | undefined) => val ?? undefined;
  const normalizeArray = (val: string[] | null | undefined) => val ?? undefined;

  const prevAdvancedConfigRef = useRef<{
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    maxToolRoundtrips?: number;
  }>({
    temperature: normalizeValue(agent?.temperature),
    topP: normalizeValue(agent?.topP),
    topK: normalizeValue(agent?.topK),
    maxOutputTokens: normalizeValue(agent?.maxOutputTokens),
    stopSequences: normalizeArray(agent?.stopSequences),
    maxToolRoundtrips: normalizeValue(agent?.maxToolRoundtrips),
  });

  // Synchronize delegatableAgentIds state with agent prop using useEffect
  // Use ref to track previous value and avoid unnecessary updates
  const prevDelegatableAgentIdsRef = useRef<string[] | undefined>(
    agent?.delegatableAgentIds
  );
  useEffect(() => {
    const currentValue = agent?.delegatableAgentIds || [];
    const prevValue = prevDelegatableAgentIdsRef.current || [];
    // Only update if the value actually changed
    if (
      currentValue.length !== prevValue.length ||
      !currentValue.every((id, index) => id === prevValue[index])
    ) {
      prevDelegatableAgentIdsRef.current = currentValue;
      setDelegatableAgentIds(currentValue);
    }
  }, [agent?.id, agent?.delegatableAgentIds]);

  // Synchronize enabledMcpServerIds state with agent prop using useEffect
  const prevEnabledMcpServerIdsRef = useRef<string[] | undefined>(
    agent?.enabledMcpServerIds
  );
  useEffect(() => {
    const currentValue = agent?.enabledMcpServerIds || [];
    const prevValue = prevEnabledMcpServerIdsRef.current || [];
    // Only update if the value actually changed
    if (
      currentValue.length !== prevValue.length ||
      !currentValue.every((id, index) => id === prevValue[index])
    ) {
      prevEnabledMcpServerIdsRef.current = currentValue;
      setEnabledMcpServerIds(currentValue);
    }
  }, [agent?.id, agent?.enabledMcpServerIds]);

  // Synchronize enableMemorySearch state with agent prop using useEffect
  const prevEnableMemorySearchRef = useRef<boolean | undefined>(
    agent?.enableMemorySearch
  );
  useEffect(() => {
    const currentValue = agent?.enableMemorySearch ?? false;
    const prevValue = prevEnableMemorySearchRef.current ?? false;
    if (currentValue !== prevValue) {
      prevEnableMemorySearchRef.current = currentValue;
      setEnableMemorySearch(currentValue);
    }
  }, [agent?.id, agent?.enableMemorySearch]);

  // Synchronize clientTools state with agent prop using useEffect
  useEffect(() => {
    const currentValue = agent?.clientTools || [];
    setClientTools(currentValue);
  }, [agent?.id, agent?.clientTools]);

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleCloseModal = () => {
    setIsEditing(false);
  };

  const handleDelete = async () => {
    if (
      !confirm(
        "Are you sure you want to delete this agent? This action cannot be undone."
      )
    ) {
      return;
    }
    setIsDeleting(true);
    try {
      await deleteAgent.mutateAsync();
      navigate(`/workspaces/${workspaceId}`);
    } catch {
      // Error is handled by toast in the hook
      setIsDeleting(false);
    }
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const createdKey = await createKey.mutateAsync({
        name: newKeyName || undefined,
      });
      if (createdKey.key) {
        setNewlyCreatedKey({ id: createdKey.id, key: createdKey.key });
      }
      setNewKeyName("");
      setIsCreatingKey(false);
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const getWebhookUrl = (key?: string) => {
    if (!key)
      return `${window.location.origin}/api/webhook/${workspaceId}/${agentId}/[KEY]`;
    return `${window.location.origin}/api/webhook/${workspaceId}/${agentId}/${key}`;
  };

  const getStreamUrl = (secret?: string) => {
    // Construct the full stream URL using the Lambda Function URL from the backend
    const baseUrl = streamUrlData?.url || "";
    if (!baseUrl) {
      return secret
        ? `[STREAM_URL_NOT_CONFIGURED]/api/streams/${workspaceId}/${agentId}/${secret}`
        : `[STREAM_URL_NOT_CONFIGURED]/api/streams/${workspaceId}/${agentId}/[SECRET]`;
    }
    // Normalize base URL: remove trailing slashes to avoid double slashes
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
    if (!secret) {
      return `${normalizedBaseUrl}/api/streams/${workspaceId}/${agentId}/[SECRET]`;
    }
    return `${normalizedBaseUrl}/api/streams/${workspaceId}/${agentId}/${secret}`;
  };

  const handleCreateStreamServer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const origins = allowedOrigins
        .split(",")
        .map((o) => o.trim())
        .filter((o) => o.length > 0);
      const result = await createStreamServer.mutateAsync({
        allowedOrigins: origins.length > 0 ? origins : ["*"],
      });
      setAllowedOrigins(
        result.allowedOrigins && result.allowedOrigins.length > 0
          ? result.allowedOrigins.join(", ")
          : ""
      );
      setIsConfiguringStreamServer(false);
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const handleUpdateStreamServer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const origins = allowedOrigins
        .split(",")
        .map((o) => o.trim())
        .filter((o) => o.length > 0);
      await updateStreamServer.mutateAsync({
        allowedOrigins: origins.length > 0 ? origins : ["*"],
      });
      setIsConfiguringStreamServer(false);
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const handleDeleteStreamServer = async () => {
    if (
      !confirm(
        "Are you sure you want to delete the stream server configuration? This action cannot be undone."
      )
    ) {
      return;
    }
    try {
      await deleteStreamServer.mutateAsync();
      setAllowedOrigins("");
    } catch {
      // Error is handled by toast in the hook
    }
  };

  // Initialize allowedOrigins from streamServerConfig
  useEffect(() => {
    if (streamServerConfig && !isConfiguringStreamServer) {
      setAllowedOrigins(
        streamServerConfig.allowedOrigins
          ? streamServerConfig.allowedOrigins.join(", ")
          : ""
      );
    }
  }, [streamServerConfig, isConfiguringStreamServer]);

  // Check if system prompt content is scrollable and update indicator
  useEffect(() => {
    const checkScrollable = () => {
      if (systemPromptRef.current) {
        const { scrollHeight, clientHeight, scrollTop } =
          systemPromptRef.current;
        const isScrollable = scrollHeight > clientHeight;
        const isAtBottom = scrollTop + clientHeight >= scrollHeight - 5; // 5px threshold
        setShowScrollIndicator(isScrollable && !isAtBottom);
      }
    };

    // Check initially and after content loads
    checkScrollable();

    // Use ResizeObserver to handle content size changes
    const resizeObserver = new ResizeObserver(checkScrollable);
    if (systemPromptRef.current) {
      resizeObserver.observe(systemPromptRef.current);
    }

    // Add scroll event listener
    const scrollContainer = systemPromptRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", checkScrollable);
    }

    return () => {
      resizeObserver.disconnect();
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", checkScrollable);
      }
    };
  }, [agent?.systemPrompt]);

  const handleDelegationToggle = (targetAgentId: string) => {
    setDelegatableAgentIds((prev) => {
      if (prev.includes(targetAgentId)) {
        return prev.filter((id) => id !== targetAgentId);
      } else {
        return [...prev, targetAgentId];
      }
    });
  };

  const handleSaveDelegation = async () => {
    try {
      const updated = await updateAgent.mutateAsync({
        delegatableAgentIds,
      });
      // Sync local state with updated agent data
      // Update ref immediately so useEffect doesn't overwrite our changes
      prevDelegatableAgentIdsRef.current = updated.delegatableAgentIds;
      setDelegatableAgentIds(updated.delegatableAgentIds || []);
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const handleMcpServerToggle = (serverId: string) => {
    setEnabledMcpServerIds((prev) => {
      if (prev.includes(serverId)) {
        return prev.filter((id) => id !== serverId);
      } else {
        return [...prev, serverId];
      }
    });
  };

  const handleSaveMcpServers = async () => {
    try {
      const updated = await updateAgent.mutateAsync({
        enabledMcpServerIds,
      });
      // Sync local state with updated agent data
      prevEnabledMcpServerIdsRef.current = updated.enabledMcpServerIds;
      setEnabledMcpServerIds(updated.enabledMcpServerIds || []);
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const handleSaveMemorySearch = async () => {
    try {
      const updated = await updateAgent.mutateAsync({
        enableMemorySearch,
      });
      // Sync local state with updated agent data
      prevEnableMemorySearchRef.current = updated.enableMemorySearch;
      setEnableMemorySearch(updated.enableMemorySearch ?? false);
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const handleSaveClientTools = async () => {
    try {
      const updated = await updateAgent.mutateAsync({
        clientTools: clientTools.length > 0 ? clientTools : undefined,
      });
      // Sync local state with updated agent data
      setClientTools(updated.clientTools || []);
    } catch {
      // Error is handled by toast in the hook
    }
  };

  // Sync advanced settings with agent prop
  useEffect(() => {
    if (!agent) return;

    const current = {
      temperature: normalizeValue(agent.temperature),
      topP: normalizeValue(agent.topP),
      topK: normalizeValue(agent.topK),
      maxOutputTokens: normalizeValue(agent.maxOutputTokens),
      stopSequences: normalizeArray(agent.stopSequences),
      maxToolRoundtrips: normalizeValue(agent.maxToolRoundtrips),
    };
    const prev = prevAdvancedConfigRef.current;

    // Only update if values actually changed (using normalized values)
    const hasChanged =
      current.temperature !== prev.temperature ||
      current.topP !== prev.topP ||
      current.topK !== prev.topK ||
      current.maxOutputTokens !== prev.maxOutputTokens ||
      JSON.stringify(current.stopSequences) !==
        JSON.stringify(prev.stopSequences) ||
      current.maxToolRoundtrips !== prev.maxToolRoundtrips;

    if (hasChanged) {
      prevAdvancedConfigRef.current = current;
      setTemperature(current.temperature);
      setTopP(current.topP);
      setTopK(current.topK);
      setMaxOutputTokens(current.maxOutputTokens);
      setStopSequences(current.stopSequences?.join(", ") || "");
      setMaxToolRoundtrips(current.maxToolRoundtrips);
    }
  }, [agent]);

  const handleSaveAdvanced = async () => {
    try {
      const stopSequencesArray = stopSequences
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      // When saving from Advanced section, send all fields
      // Empty fields (undefined, null, or NaN) are sent as null to clear them
      // Fields with valid values are sent as-is
      const updated = await updateAgent.mutateAsync({
        temperature:
          temperature != null && !isNaN(temperature) ? temperature : null,
        topP: topP != null && !isNaN(topP) ? topP : null,
        topK: topK != null && !isNaN(topK) ? topK : null,
        maxOutputTokens:
          maxOutputTokens != null && !isNaN(maxOutputTokens)
            ? maxOutputTokens
            : null,
        stopSequences:
          stopSequencesArray.length > 0 ? stopSequencesArray : null,
        maxToolRoundtrips:
          maxToolRoundtrips != null && !isNaN(maxToolRoundtrips)
            ? maxToolRoundtrips
            : null,
      });
      // Sync local state with updated agent data
      const updatedConfig = {
        temperature: normalizeValue(updated.temperature),
        topP: normalizeValue(updated.topP),
        topK: normalizeValue(updated.topK),
        maxOutputTokens: normalizeValue(updated.maxOutputTokens),
        stopSequences: normalizeArray(updated.stopSequences),
        maxToolRoundtrips: normalizeValue(updated.maxToolRoundtrips),
      };

      // Update ref immediately so useEffect doesn't overwrite our changes
      prevAdvancedConfigRef.current = updatedConfig;

      setTemperature(updatedConfig.temperature);
      setTopP(updatedConfig.topP);
      setTopK(updatedConfig.topK);
      setMaxOutputTokens(updatedConfig.maxOutputTokens);
      setStopSequences(updated.stopSequences?.join(", ") || "");
      setMaxToolRoundtrips(updatedConfig.maxToolRoundtrips);
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const handleResetAdvanced = () => {
    setTemperature(undefined);
    setTopP(undefined);
    setTopK(undefined);
    setMaxOutputTokens(undefined);
    setStopSequences("");
    setMaxToolRoundtrips(undefined);
  };

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="border border-neutral-200 dark:border-neutral-700 rounded-xl p-8 mb-8 bg-white shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex justify-between items-center mb-4">
            <button
              onClick={() => navigate(`/workspaces/${workspaceId}`)}
              className="border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-700 font-semibold rounded-xl hover:bg-neutral-50 dark:bg-neutral-800 transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              ← Back
            </button>
            {canEdit && !isEditing && (
              <button
                onClick={handleEdit}
                className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored transition-all duration-200"
              >
                Edit
              </button>
            )}
          </div>
          <p className="text-sm opacity-75 dark:text-neutral-300 mb-4 dark:text-neutral-300">
            Configure your agent&apos;s behavior, system prompt, spending
            limits, and webhook keys. Use the sections below to manage
            conversations, test the agent, and monitor usage.
          </p>

          <div>
            <h1 className="text-4xl font-bold mb-4 dark:text-neutral-50">{agent.name}</h1>
            <p className="text-sm opacity-75 dark:text-neutral-300 mb-4 dark:text-neutral-300">
              Created: {new Date(agent.createdAt).toLocaleString()}
              {agent.updatedAt &&
                ` • Updated: ${new Date(agent.updatedAt).toLocaleString()}`}
            </p>
            <div className="mb-4">
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-sm font-semibold dark:text-neutral-300">Provider: </span>
                  <span className="text-sm dark:text-neutral-300">Google</span>
                </div>
                <div>
                  <span className="text-sm font-semibold dark:text-neutral-300">Model: </span>
                  <span className="text-sm dark:text-neutral-300">
                    {isEditing ? (
                      <>
                        <select
                          disabled={isLoadingModels}
                          value={
                            isLoadingModels ? "" : modelName || defaultModel
                          }
                          onChange={(e) => {
                            const selectedModel = e.target.value;
                            setModelName(
                              selectedModel === defaultModel
                                ? null
                                : selectedModel
                            );
                          }}
                          className="border-2 border-neutral-300 rounded-xl bg-white px-3 py-1.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 ml-2 disabled:opacity-50 transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-primary-400 dark:focus:border-primary-500"
                        >
                          {isLoadingModels ? (
                            <option value="">Loading...</option>
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
                        {modelLoadError && (
                          <span className="text-xs text-red-600 ml-2 dark:text-red-400">
                            {modelLoadError}
                          </span>
                        )}
                      </>
                    ) : (
                      agent.modelName || defaultModel
                    )}
                  </span>
                </div>
                {isEditing && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const updated = await updateAgent.mutateAsync({
                          modelName: modelName || null,
                        });
                        // Immediately update local state with the returned data
                        const updatedModelName = updated.modelName || null;
                        setModelName(updatedModelName);
                        // Update ref to prevent useEffect from overwriting with stale data
                        prevModelNameRef.current = updatedModelName;
                      } catch {
                        // Error handled by toast
                      }
                    }}
                    disabled={updateAgent.isPending}
                    className="text-xs font-semibold bg-gradient-primary px-3 py-1.5 text-white rounded-lg hover:shadow-colored disabled:opacity-50 transition-all duration-200"
                  >
                    {updateAgent.isPending ? "Saving..." : "Save"}
                  </button>
                )}
              </div>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold dark:text-neutral-300">System Prompt:</p>
                <button
                  type="button"
                  onClick={() => setIsHelpOpen(true)}
                  className="text-xs font-semibold border-2 border-neutral-300 bg-white px-3 py-1.5 rounded-xl hover:bg-neutral-50 dark:bg-neutral-800 transition-all duration-200"
                >
                  ? Available Tools
                </button>
              </div>
              <div className="relative border border-neutral-200 dark:border-neutral-700 rounded-lg">
                <div
                  ref={systemPromptRef}
                  className="text-sm bg-neutral-50 dark:bg-neutral-800 p-4 max-h-[400px] overflow-y-auto rounded-lg"
                >
                  <Suspense
                    fallback={
                      <LoadingScreen compact message="Loading markdown..." />
                    }
                  >
                    <LazyMarkdownRenderer
                      components={{
                        // Code blocks
                        code: (props) => {
                          const { className, children, ...rest } = props;
                          const isInline =
                            !className || !className.includes("language-");
                          if (isInline) {
                            return (
                              <code
                                className="border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-1.5 py-0.5 rounded font-mono text-xs"
                                {...rest}
                              >
                                {children}
                              </code>
                            );
                          }
                          return (
                            <code
                              className="block border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 rounded-lg p-4 font-mono text-xs overflow-x-auto"
                              {...rest}
                            >
                              {children}
                            </code>
                          );
                        },
                        // Pre blocks (code block wrapper)
                        pre: ({ children }) => {
                          return <div className="my-2">{children}</div>;
                        },
                        // Headings
                        h1: ({ children }) => (
                          <h1 className="text-2xl font-semibold mb-2 mt-4 first:mt-0 dark:text-neutral-50">
                            {children}
                          </h1>
                        ),
                        h2: ({ children }) => (
                          <h2 className="text-xl font-semibold mb-2 mt-4 first:mt-0 dark:text-neutral-50">
                            {children}
                          </h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className="text-lg font-semibold mb-2 mt-4 first:mt-0 dark:text-neutral-50">
                            {children}
                          </h3>
                        ),
                        h4: ({ children }) => (
                          <h4 className="text-base font-semibold mb-2 mt-4 first:mt-0 dark:text-neutral-50">
                            {children}
                          </h4>
                        ),
                        h5: ({ children }) => (
                          <h5 className="text-sm font-semibold mb-2 mt-4 first:mt-0 dark:text-neutral-50">
                            {children}
                          </h5>
                        ),
                        h6: ({ children }) => (
                          <h6 className="text-xs font-semibold mb-2 mt-4 first:mt-0 dark:text-neutral-50">
                            {children}
                          </h6>
                        ),
                        // Paragraphs
                        p: ({ children }) => (
                          <p className="mb-2 last:mb-0">{children}</p>
                        ),
                        // Lists
                        ul: ({ children }) => (
                          <ul className="list-none border-l-4 border-primary-500 pl-4 my-2 space-y-1">
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="list-none border-l-4 border-primary-500 pl-4 my-2 space-y-1">
                            {children}
                          </ol>
                        ),
                        li: ({ children }) => (
                          <li className="before:content-['•'] before:font-bold before:mr-2 dark:text-neutral-200">
                            {children}
                          </li>
                        ),
                        // Links
                        a: ({ href, children }) => (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="border-b-2 border-primary-500 font-semibold hover:text-primary-600 px-1 transition-colors dark:text-primary-400 dark:hover:text-primary-300"
                          >
                            {children}
                          </a>
                        ),
                        // Blockquotes
                        blockquote: ({ children }) => (
                          <blockquote className="border-l-4 border-primary-500 pl-4 my-2 italic bg-neutral-50 dark:bg-neutral-800 py-2 rounded-r">
                            {children}
                          </blockquote>
                        ),
                        // Strong/Bold
                        strong: ({ children }) => (
                          <strong className="font-bold dark:text-neutral-50">{children}</strong>
                        ),
                        // Emphasis/Italic
                        em: ({ children }) => (
                          <em className="italic">{children}</em>
                        ),
                        // Horizontal rule
                        hr: () => (
                          <hr className="border-t border-neutral-300 my-4" />
                        ),
                        // Tables
                        table: ({ children }) => (
                          <div className="overflow-x-auto my-2 rounded-lg border border-neutral-200 dark:border-neutral-700">
                            <table className="border-collapse min-w-full">
                              {children}
                            </table>
                          </div>
                        ),
                        thead: ({ children }) => (
                          <thead className="bg-gradient-primary text-white">
                            {children}
                          </thead>
                        ),
                        tbody: ({ children }) => <tbody>{children}</tbody>,
                        tr: ({ children }) => (
                          <tr className="border-b border-neutral-200 dark:border-neutral-700">
                            {children}
                          </tr>
                        ),
                        th: ({ children }) => (
                          <th className="border-r border-neutral-200 dark:border-neutral-700 p-2 font-semibold text-left last:border-r-0 dark:text-neutral-50">
                            {children}
                          </th>
                        ),
                        td: ({ children }) => (
                          <td className="border-r border-neutral-200 dark:border-neutral-700 p-2 last:border-r-0 dark:text-neutral-200">
                            {children}
                          </td>
                        ),
                      }}
                    >
                      {agent.systemPrompt}
                    </LazyMarkdownRenderer>
                  </Suspense>
                </div>
                {showScrollIndicator && (
                  <div className="absolute bottom-0 left-0 right-0 bg-neutral-50 dark:bg-neutral-800 border-t border-neutral-200 dark:border-neutral-700 py-1.5 px-4 pointer-events-none rounded-b-lg">
                    <div className="text-center">
                      <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                        ▼ More below
                      </span>
                      <div aria-live="polite" className="sr-only">
                        More content available below
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <SectionGroup title="Testing & Interactions">
          {/* Chat Test Section */}
          <AccordionSection
            id="test"
            title="TEST AGENT"
            isExpanded={expandedSection === "test"}
            onToggle={() => toggleSection("test")}
          >
            <LazyAccordionContent isExpanded={expandedSection === "test"}>
              <AgentChat workspaceId={workspaceId} agentId={agentId} />
            </LazyAccordionContent>
          </AccordionSection>

          {/* Recent Conversations Section */}
          <AccordionSection
            id="conversations"
            title="RECENT CONVERSATIONS"
            isExpanded={expandedSection === "conversations"}
            onToggle={() => toggleSection("conversations")}
          >
            <LazyAccordionContent
              isExpanded={expandedSection === "conversations"}
            >
              <ConversationList
                workspaceId={workspaceId}
                agentId={agentId}
                onConversationClick={setSelectedConversation}
              />
            </LazyAccordionContent>
          </AccordionSection>

          {/* Memory Records Section */}
          <AccordionSection
            id="memory"
            title="MEMORY RECORDS"
            isExpanded={expandedSection === "memory"}
            onToggle={() => toggleSection("memory")}
          >
            <LazyAccordionContent isExpanded={expandedSection === "memory"}>
              <AgentMemoryRecords workspaceId={workspaceId} agentId={agentId} />
            </LazyAccordionContent>
          </AccordionSection>
        </SectionGroup>

        <SectionGroup title="Configuration">
          {/* Delegation Section */}
          {canEdit && (
            <AccordionSection
              id="delegation"
              title="DELEGATION"
              isExpanded={expandedSection === "delegation"}
              onToggle={() => toggleSection("delegation")}
            >
              <LazyAccordionContent
                isExpanded={expandedSection === "delegation"}
              >
                <p className="text-sm opacity-75 dark:text-neutral-300 mb-4">
                  Configure which other agents in this workspace this agent can
                  delegate tasks to. When delegation is enabled, this agent will
                  have access to the{" "}
                  <code className="border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-1.5 py-0.5 rounded font-mono text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                    list_agents
                  </code>{" "}
                  and{" "}
                  <code className="border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-1.5 py-0.5 rounded font-mono text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                    call_agent
                  </code>{" "}
                  tools.
                </p>
                {allAgents && allAgents.length > 1 ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      {allAgents
                        .filter((a) => a.id !== agentId)
                        .map((targetAgent) => (
                          <label
                            key={targetAgent.id}
                            className="flex items-start gap-2 p-3 border border-neutral-200 dark:border-neutral-700 rounded-lg hover:bg-neutral-50 dark:bg-neutral-800 cursor-pointer transition-colors dark:border-neutral-700 dark:hover:bg-neutral-800"
                          >
                            <input
                              type="checkbox"
                              checked={delegatableAgentIds.includes(
                                targetAgent.id
                              )}
                              onChange={() =>
                                handleDelegationToggle(targetAgent.id)
                              }
                              className="mt-1 border-2 border-neutral-300 rounded dark:border-neutral-700"
                            />
                            <div className="flex-1">
                              <div className="font-bold dark:text-neutral-50">
                                {targetAgent.name}
                              </div>
                              <div className="text-xs opacity-75 dark:text-neutral-300 mt-1">
                                {targetAgent.systemPrompt.length > 100
                                  ? `${targetAgent.systemPrompt.substring(
                                      0,
                                      100
                                    )}...`
                                  : targetAgent.systemPrompt}
                              </div>
                            </div>
                          </label>
                        ))}
                    </div>
                    <button
                      onClick={handleSaveDelegation}
                      disabled={updateAgent.isPending}
                      className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                    >
                      {updateAgent.isPending ? "Saving..." : "Save Delegation"}
                    </button>
                  </div>
                ) : (
                  <p className="text-sm opacity-75 dark:text-neutral-300">
                    No other agents available in this workspace. Create another
                    agent to enable delegation.
                  </p>
                )}
              </LazyAccordionContent>
            </AccordionSection>
          )}

          {/* Advanced Section */}
          {canEdit && (
            <AccordionSection
              id="advanced"
              title="ADVANCED"
              isExpanded={expandedSection === "advanced"}
              onToggle={() => toggleSection("advanced")}
            >
              <LazyAccordionContent isExpanded={expandedSection === "advanced"}>
                <p className="text-sm opacity-75 dark:text-neutral-300 mb-4">
                  Configure advanced model generation parameters. These settings
                  control how the AI model generates responses. Leave fields
                  empty to use model defaults.
                </p>
                <div className="space-y-6">
                  {/* Temperature */}
                  <div>
                    <label className="block text-sm font-semibold mb-2 dark:text-neutral-300">
                      Temperature
                    </label>
                    <p className="text-xs opacity-75 dark:text-neutral-300 mb-2">
                      Controls the randomness of responses. Lower values (0-0.5)
                      produce more focused and deterministic outputs, while
                      higher values (1.5-2) create more creative and varied
                      responses. Default: model default (~1.0)
                    </p>
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={temperature ?? ""}
                      onChange={(e) => {
                        const value = e.target.value.trim();
                        if (!value) {
                          setTemperature(undefined);
                        } else {
                          const parsed = parseFloat(value);
                          setTemperature(isNaN(parsed) ? undefined : parsed);
                        }
                      }}
                      className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-primary-400 dark:focus:border-primary-500"
                      placeholder="Model default"
                    />
                  </div>

                  {/* Top-p */}
                  <div>
                    <label className="block text-sm font-semibold mb-2 dark:text-neutral-300">
                      Top-p / Nucleus Sampling
                    </label>
                    <p className="text-xs opacity-75 dark:text-neutral-300 mb-2">
                      Controls diversity by considering tokens with cumulative
                      probability up to this threshold. Lower values (0.1-0.5)
                      produce more focused outputs, higher values (0.9-1.0)
                      allow more diversity. Default: model default (~0.95)
                    </p>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      value={topP ?? ""}
                      onChange={(e) => {
                        const value = e.target.value.trim();
                        if (!value) {
                          setTopP(undefined);
                        } else {
                          const parsed = parseFloat(value);
                          setTopP(isNaN(parsed) ? undefined : parsed);
                        }
                      }}
                      className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-primary-400 dark:focus:border-primary-500"
                      placeholder="Model default"
                    />
                  </div>

                  {/* Top-k */}
                  <div>
                    <label className="block text-sm font-semibold mb-2 dark:text-neutral-300">
                      Top-k
                    </label>
                    <p className="text-xs opacity-75 dark:text-neutral-300 mb-2">
                      Limits token selection to the top K most probable tokens
                      at each step. Lower values (10-20) produce more focused
                      outputs, higher values (50-100) allow more diversity.
                      Default: model default
                    </p>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={topK ?? ""}
                      onChange={(e) => {
                        const value = e.target.value.trim();
                        if (!value) {
                          setTopK(undefined);
                        } else {
                          const parsed = parseInt(value, 10);
                          setTopK(isNaN(parsed) ? undefined : parsed);
                        }
                      }}
                      className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-primary-400 dark:focus:border-primary-500"
                      placeholder="Model default"
                    />
                  </div>

                  {/* Max Output Tokens */}
                  <div>
                    <label className="block text-sm font-semibold mb-2 dark:text-neutral-300">
                      Max Output Tokens
                    </label>
                    <p className="text-xs opacity-75 dark:text-neutral-300 mb-2">
                      Maximum number of tokens the model can generate in a
                      response. This limits the length of generated text. Higher
                      values allow longer responses but may increase costs.
                      Default: model default
                    </p>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={maxOutputTokens ?? ""}
                      onChange={(e) => {
                        const value = e.target.value.trim();
                        if (!value) {
                          setMaxOutputTokens(undefined);
                        } else {
                          const parsed = parseInt(value, 10);
                          setMaxOutputTokens(
                            isNaN(parsed) ? undefined : parsed
                          );
                        }
                      }}
                      className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-primary-400 dark:focus:border-primary-500"
                      placeholder="Model default"
                    />
                  </div>

                  {/* Stop Sequences */}
                  <div>
                    <label className="block text-sm font-semibold mb-2 dark:text-neutral-300">
                      Stop Sequences
                    </label>
                    <p className="text-xs opacity-75 dark:text-neutral-300 mb-2">
                      Text sequences that will stop generation when encountered.
                      The model will stop immediately after generating any of
                      these sequences. Enter multiple sequences separated by
                      commas. Default: none
                    </p>
                    <input
                      type="text"
                      value={stopSequences}
                      onChange={(e) => setStopSequences(e.target.value)}
                      className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-primary-400 dark:focus:border-primary-500"
                      placeholder="e.g., END, STOP, ###"
                    />
                  </div>

                  {/* Max Tool Roundtrips */}
                  <div>
                    <label className="block text-sm font-semibold mb-2 dark:text-neutral-300">
                      Max Tool Roundtrips
                    </label>
                    <p className="text-xs opacity-75 dark:text-neutral-300 mb-2">
                      Maximum number of tool call iterations allowed before
                      stopping. Each roundtrip allows the agent to call tools,
                      receive results, and continue processing. Higher values
                      allow more complex multi-step operations. Default: 5
                    </p>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={maxToolRoundtrips ?? ""}
                      onChange={(e) => {
                        const value = e.target.value.trim();
                        if (!value) {
                          setMaxToolRoundtrips(undefined);
                        } else {
                          const parsed = parseInt(value, 10);
                          setMaxToolRoundtrips(
                            isNaN(parsed) ? undefined : parsed
                          );
                        }
                      }}
                      className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-primary-400 dark:focus:border-primary-500"
                      placeholder="5"
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleSaveAdvanced}
                      disabled={updateAgent.isPending}
                      className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                    >
                      {updateAgent.isPending
                        ? "Saving..."
                        : "Save Advanced Settings"}
                    </button>
                    <button
                      onClick={handleResetAdvanced}
                      disabled={updateAgent.isPending}
                      className="border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-700 font-semibold rounded-xl hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50 dark:hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                    >
                      Reset to Defaults
                    </button>
                  </div>
                </div>
              </LazyAccordionContent>
            </AccordionSection>
          )}
        </SectionGroup>

        <SectionGroup title="Integration">
          {/* MCP Servers Section */}
          {canEdit && (
            <AccordionSection
              id="mcp-servers"
              title="MCP SERVERS"
              isExpanded={expandedSection === "mcp-servers"}
              onToggle={() => toggleSection("mcp-servers")}
            >
              <LazyAccordionContent
                isExpanded={expandedSection === "mcp-servers"}
              >
                <p className="text-sm opacity-75 dark:text-neutral-300 mb-4">
                  Enable MCP servers from your workspace to make them available
                  as tools to this agent. When enabled, the agent will be able
                  to call the MCP server methods.
                </p>
                {mcpServersData && mcpServersData.servers.length > 0 ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      {mcpServersData.servers.map((server) => (
                        <label
                          key={server.id}
                          className="flex items-start gap-2 p-3 border border-neutral-200 dark:border-neutral-700 rounded-lg hover:bg-neutral-50 dark:bg-neutral-800 cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={enabledMcpServerIds.includes(server.id)}
                            onChange={() => handleMcpServerToggle(server.id)}
                            className="mt-1 border-2 border-neutral-300 rounded"
                          />
                          <div className="flex-1">
                            <div className="font-bold">{server.name}</div>
                            <div className="text-xs font-mono mt-1 opacity-75 dark:text-neutral-300">
                              {server.url}
                            </div>
                            <div className="text-xs uppercase mt-1">
                              Auth: {server.authType}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                    <button
                      onClick={handleSaveMcpServers}
                      disabled={updateAgent.isPending}
                      className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                    >
                      {updateAgent.isPending ? "Saving..." : "Save MCP Servers"}
                    </button>
                  </div>
                ) : (
                  <p className="text-sm opacity-75 dark:text-neutral-300">
                    No MCP servers available in this workspace. Create MCP
                    servers in the workspace settings to enable them for agents.
                  </p>
                )}
              </LazyAccordionContent>
            </AccordionSection>
          )}

          {/* Memory Search Tool Section */}
          {canEdit && (
            <AccordionSection
              id="memory-search"
              title="MEMORY SEARCH TOOL"
              isExpanded={expandedSection === "memory-search"}
              onToggle={() => toggleSection("memory-search")}
            >
              <LazyAccordionContent
                isExpanded={expandedSection === "memory-search"}
              >
                <div className="space-y-4">
                  <p className="text-sm opacity-75 dark:text-neutral-300">
                    Enable the memory search tool to allow this agent to search
                    its factual memory across different time periods and recall
                    past conversations.
                  </p>
                  <div className="p-4 border-2 border-yellow-400 bg-yellow-50 rounded-lg">
                    <p className="text-sm font-semibold text-yellow-900 mb-2">
                      ⚠️ Privacy Warning
                    </p>
                    <p className="text-sm text-yellow-900">
                      Activating the memory search tool may result in data
                      leakage between users. The agent will be able to search
                      and recall information from all conversations, which could
                      expose sensitive information across different user
                      sessions. Only enable this if you understand the privacy
                      implications.
                    </p>
                  </div>
                  <label className="flex items-start gap-3 p-4 border border-neutral-200 dark:border-neutral-700 rounded-lg hover:bg-neutral-50 dark:bg-neutral-800 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={enableMemorySearch}
                      onChange={(e) => setEnableMemorySearch(e.target.checked)}
                      className="mt-1 border-2 border-neutral-300 rounded"
                    />
                    <div className="flex-1">
                      <div className="font-bold">Enable Memory Search</div>
                      <div className="text-sm opacity-75 dark:text-neutral-300 mt-1">
                        Allow this agent to use the search_memory tool to recall
                        past conversations and information
                      </div>
                    </div>
                  </label>
                  <button
                    onClick={handleSaveMemorySearch}
                    disabled={updateAgent.isPending}
                    className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                  >
                    {updateAgent.isPending
                      ? "Saving..."
                      : "Save Memory Search Setting"}
                  </button>
                </div>
              </LazyAccordionContent>
            </AccordionSection>
          )}

          {/* Client-Side Tools Section */}
          {canEdit && (
            <AccordionSection
              id="client-tools"
              title="CLIENT-SIDE TOOLS"
              isExpanded={expandedSection === "client-tools"}
              onToggle={() => toggleSection("client-tools")}
            >
              <LazyAccordionContent
                isExpanded={expandedSection === "client-tools"}
              >
                <p className="text-sm opacity-75 dark:text-neutral-300 mb-4">
                  Define client-side tools that will be executed in the browser.
                  These tools are available to the AI model, but execution
                  happens on the client side.
                </p>
                <div className="space-y-4">
                  <ClientToolEditor
                    tools={clientTools}
                    onChange={setClientTools}
                  />
                  <button
                    onClick={handleSaveClientTools}
                    disabled={updateAgent.isPending}
                    className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                  >
                    {updateAgent.isPending ? "Saving..." : "Save Client Tools"}
                  </button>
                </div>
              </LazyAccordionContent>
            </AccordionSection>
          )}
        </SectionGroup>

        <SectionGroup title="Servers">
          {/* Stream Server Section */}
          {canEdit && (
            <AccordionSection
              id="stream-server"
              title="STREAM SERVER"
              isExpanded={expandedSection === "stream-server"}
              onToggle={() => toggleSection("stream-server")}
            >
              <div className="text-sm opacity-75 dark:text-neutral-300 mb-4 space-y-3">
                <p>
                  Stream servers enable real-time streaming responses from your
                  agent using Lambda Function URLs. Configure allowed origins
                  for CORS and manage the secret used to authenticate requests.
                </p>
                {!streamUrlData && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <p className="font-semibold text-amber-800 mb-1">
                      ⚠️ Streaming Function URL Not Configured
                    </p>
                    <p className="text-xs text-yellow-700">
                      The Lambda Function URL may not be deployed yet, or the
                      URL could not be found in CloudFormation stack outputs.
                      This is normal when developing locally. The stream server
                      configuration will work once the Lambda Function URL is
                      deployed.
                    </p>
                  </div>
                )}
                <div>
                  <p className="font-semibold mb-2">
                    Server-Sent Events (SSE) Format
                  </p>
                  <p className="mb-2">
                    Stream servers use <strong>Server-Sent Events (SSE)</strong>{" "}
                    format compatible with the{" "}
                    <a
                      href="https://sdk.vercel.ai/docs"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:opacity-100"
                    >
                      AI SDK
                    </a>
                    . Send a <strong>POST</strong> request with a JSON array of
                    messages in the request body.
                  </p>
                  <p className="mb-2">
                    The response stream uses SSE format with JSON objects:
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-2 mb-2">
                    <li>
                      Text chunks:{" "}
                      <code className="bg-neutral-100 dark:bg-neutral-800 px-1">
                        data: {`{"type":"text-delta","textDelta":"Hello"}`}\n\n
                      </code>
                    </li>
                    <li>
                      Tool calls:{" "}
                      <code className="bg-neutral-100 dark:bg-neutral-800 px-1">
                        data:{" "}
                        {`{"type":"tool-call","toolCallId":"...","toolName":"...","args":{...}}`}
                        \n\n
                      </code>
                    </li>
                  </ul>
                  <p className="mb-2">To build a client:</p>
                  <ul className="list-disc list-inside space-y-1 ml-2 mb-2">
                    <li>
                      <strong>React apps:</strong> Use the{" "}
                      <a
                        href="https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat#usechat"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:opacity-100"
                      >
                        useChat hook
                      </a>{" "}
                      from{" "}
                      <code className="bg-neutral-100 dark:bg-neutral-800 px-1">@ai-sdk/react</code>{" "}
                      - it handles SSE parsing automatically
                    </li>
                    <li>
                      <strong>Other frameworks:</strong> Parse SSE format by
                      reading lines starting with{" "}
                      <code className="bg-neutral-100 dark:bg-neutral-800 px-1">data: </code>, then
                      parse the JSON object
                    </li>
                  </ul>
                  <p className="mb-0">
                    For complete documentation, examples, and integration
                    guides, see the{" "}
                    <a
                      href="https://sdk.vercel.ai/docs"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:opacity-100"
                    >
                      AI SDK documentation
                    </a>
                    .
                  </p>
                </div>
              </div>
              {!streamServerConfig ? (
                <div>
                  {!isConfiguringStreamServer ? (
                    <button
                      onClick={() => setIsConfiguringStreamServer(true)}
                      className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored transition-all duration-200"
                    >
                      Create Stream Server
                    </button>
                  ) : (
                    <form
                      onSubmit={handleCreateStreamServer}
                      className="p-4 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg"
                    >
                      <div className="mb-4">
                        <label className="block text-sm font-semibold mb-2 dark:text-neutral-300">
                          Allowed Origins
                        </label>
                        <p className="text-xs opacity-75 dark:text-neutral-300 mb-2">
                          Comma-separated list of allowed origins for CORS. Use
                          &quot;*&quot; to allow all origins.
                        </p>
                        <input
                          type="text"
                          value={allowedOrigins}
                          onChange={(e) => setAllowedOrigins(e.target.value)}
                          className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200"
                          placeholder="* or https://example.com, https://app.example.com"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={createStreamServer.isPending}
                          className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                        >
                          {createStreamServer.isPending
                            ? "Creating..."
                            : "Create"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsConfiguringStreamServer(false);
                            setAllowedOrigins("");
                          }}
                          className="border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-700 font-semibold rounded-xl hover:bg-neutral-50 dark:bg-neutral-800 transition-all duration-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold mb-2">Stream URL:</p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-neutral-50 dark:bg-neutral-800 p-2 border border-neutral-200 dark:border-neutral-700 rounded-lg flex-1 break-all">
                        {getStreamUrl(streamServerConfig?.secret)}
                      </code>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(
                            getStreamUrl(streamServerConfig?.secret)
                          );
                        }}
                        className="bg-gradient-primary px-4 py-2 text-white text-xs font-semibold rounded-lg hover:shadow-colored whitespace-nowrap transition-all duration-200"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                  {!isConfiguringStreamServer ? (
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs font-semibold mb-2">
                          Allowed Origins:
                        </p>
                        <p className="text-xs bg-neutral-50 dark:bg-neutral-800 p-2 border border-neutral-200 dark:border-neutral-700 rounded-lg">
                          {streamServerConfig.allowedOrigins.join(", ")}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setIsStreamTestModalOpen(true)}
                          disabled={!streamServerConfig || !streamUrlData?.url}
                          title={
                            !streamServerConfig && !streamUrlData?.url
                              ? "Cannot test: Stream server is not configured and the stream URL is not available."
                              : !streamServerConfig
                              ? "Cannot test: Stream server is not configured. Create a stream server configuration first."
                              : !streamUrlData?.url
                              ? "Cannot test: The stream URL is not configured."
                              : undefined
                          }
                          aria-label={
                            !streamServerConfig && !streamUrlData?.url
                              ? "Cannot test: Stream server is not configured and the stream URL is not available."
                              : !streamServerConfig
                              ? "Cannot test: Stream server is not configured. Create a stream server configuration first."
                              : !streamUrlData?.url
                              ? "Cannot test: The stream URL is not configured."
                              : "Test stream server"
                          }
                          className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                        >
                          Test
                        </button>
                        <button
                          onClick={() => setIsConfiguringStreamServer(true)}
                          className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored transition-all duration-200"
                        >
                          Edit
                        </button>
                        <button
                          onClick={handleDeleteStreamServer}
                          disabled={deleteStreamServer.isPending}
                          className="bg-error-600 px-4 py-2.5 text-white font-semibold rounded-xl hover:bg-error-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                        >
                          {deleteStreamServer.isPending
                            ? "Deleting..."
                            : "Delete"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <form
                      onSubmit={handleUpdateStreamServer}
                      className="p-4 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg"
                    >
                      <div className="mb-4">
                        <label className="block text-sm font-semibold mb-2 dark:text-neutral-300">
                          Allowed Origins
                        </label>
                        <p className="text-xs opacity-75 dark:text-neutral-300 mb-2">
                          Comma-separated list of allowed origins for CORS. Use
                          &quot;*&quot; to allow all origins.
                        </p>
                        <input
                          type="text"
                          value={allowedOrigins}
                          onChange={(e) => setAllowedOrigins(e.target.value)}
                          className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200"
                          placeholder="* or https://example.com, https://app.example.com"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={updateStreamServer.isPending}
                          className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                        >
                          {updateStreamServer.isPending ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsConfiguringStreamServer(false);
                            if (streamServerConfig) {
                              setAllowedOrigins(
                                streamServerConfig.allowedOrigins.join(", ")
                              );
                            }
                          }}
                          className="border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-700 font-semibold rounded-xl hover:bg-neutral-50 dark:bg-neutral-800 transition-all duration-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </AccordionSection>
          )}

          {/* Webhooks Management Section */}
          <AccordionSection
            id="keys"
            title="WEBHOOKS"
            isExpanded={expandedSection === "keys"}
            onToggle={() => toggleSection("keys")}
          >
            <LazyAccordionContent isExpanded={expandedSection === "keys"}>
              <p className="text-sm opacity-75 dark:text-neutral-300 mb-4">
                Webhook keys allow external services to send requests to this
                agent. Each key generates a unique webhook URL that can be used
                to trigger the agent from external systems. Keep your keys
                secure and rotate them regularly.
              </p>
              {canEdit && (
                <div className="flex justify-between items-center mb-4">
                  <button
                    onClick={() => setIsCreatingKey(true)}
                    className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored transition-all duration-200"
                  >
                    Create Key
                  </button>
                </div>
              )}

              {isCreatingKey && canEdit && (
                <form
                  onSubmit={handleCreateKey}
                  className="mb-4 p-4 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg"
                >
                  <div className="mb-4">
                    <label className="block text-sm font-semibold mb-2">
                      Key Name (optional)
                    </label>
                    <input
                      type="text"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200"
                      placeholder="e.g., Production Key"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={createKey.isPending}
                      className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                    >
                      {createKey.isPending ? "Creating..." : "Create"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreatingKey(false);
                        setNewKeyName("");
                      }}
                      className="border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-700 font-semibold rounded-xl hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50 dark:hover:bg-neutral-700 transition-all duration-200"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {keys.length === 0 ? (
                <p className="text-sm opacity-75 dark:text-neutral-300">No keys created yet.</p>
              ) : (
                <div className="space-y-4">
                  {keys.map((key) => {
                    // Use newly created key if this is the one we just created
                    const keyValue =
                      newlyCreatedKey?.id === key.id
                        ? newlyCreatedKey.key
                        : key.key;
                    return (
                      <KeyItem
                        key={key.id}
                        keyData={{ ...key, key: keyValue }}
                        workspaceId={workspaceId}
                        agentId={agentId}
                        canEdit={canEdit}
                        webhookUrl={getWebhookUrl(keyValue)}
                      />
                    );
                  })}
                </div>
              )}
            </LazyAccordionContent>
          </AccordionSection>
        </SectionGroup>

        <SectionGroup title="Billing & Usage">
          {/* Spending Limits Section */}
          {canEdit && (
            <AccordionSection
              id="spending-limits"
              title="SPENDING LIMITS"
              isExpanded={expandedSection === "spending-limits"}
              onToggle={() => toggleSection("spending-limits")}
            >
              <LazyAccordionContent
                isExpanded={expandedSection === "spending-limits"}
              >
                <SpendingLimitsManager
                  workspaceId={workspaceId}
                  agentId={agentId}
                  spendingLimits={agent.spendingLimits}
                  canEdit={!!canEdit}
                />
              </LazyAccordionContent>
            </AccordionSection>
          )}

          {/* Usage Section */}
          <AccordionSection
            id="usage"
            title="AGENT USAGE"
            isExpanded={expandedSection === "usage"}
            onToggle={() => toggleSection("usage")}
          >
            <LazyAccordionContent isExpanded={expandedSection === "usage"}>
              <AgentUsageSection workspaceId={workspaceId} agentId={agentId} />
            </LazyAccordionContent>
          </AccordionSection>
        </SectionGroup>

        {canEdit && (
          <AccordionSection
            id="danger"
            title="DANGER ZONE"
            isExpanded={expandedSection === "danger"}
            onToggle={() => toggleSection("danger")}
          >
            <LazyAccordionContent isExpanded={expandedSection === "danger"}>
              <p className="text-sm opacity-75 dark:text-neutral-300 mb-4">
                This section contains destructive actions. Deleting an agent
                will permanently remove all its conversations, webhook keys, and
                settings. This action cannot be undone.
              </p>
              <p className="mb-4 dark:text-neutral-300">
                Deleting an agent is permanent and cannot be undone.
              </p>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="bg-error-600 px-4 py-2.5 text-white font-semibold rounded-xl hover:bg-error-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {isDeleting ? "Deleting..." : "Delete Agent"}
              </button>
            </LazyAccordionContent>
          </AccordionSection>
        )}

        {/* Modals - only load when opened */}
        {isEditing && (
          <Suspense fallback={<LoadingScreen />}>
            <AgentModal
              isOpen={isEditing}
              onClose={handleCloseModal}
              workspaceId={workspaceId}
              agent={agent}
            />
          </Suspense>
        )}

        {selectedConversation && (
          <Suspense
            fallback={
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                <div className="bg-white border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-xl p-8">
                  <div className="text-2xl font-semibold">
                    Loading conversation...
                  </div>
                </div>
              </div>
            }
          >
            <QueryPanel
              fallback={
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                  <div className="bg-white border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-xl p-8">
                    <div className="text-2xl font-semibold">
                      Loading conversation...
                    </div>
                  </div>
                </div>
              }
            >
              <ConversationDetailModal
                isOpen={!!selectedConversation}
                onClose={() => setSelectedConversation(null)}
                workspaceId={workspaceId}
                agentId={agentId}
                conversation={selectedConversation}
              />
            </QueryPanel>
          </Suspense>
        )}

        {isHelpOpen && (
          <Suspense fallback={<LoadingScreen />}>
            <ToolsHelpDialog
              isOpen={isHelpOpen}
              onClose={() => setIsHelpOpen(false)}
              workspaceId={workspaceId}
              agent={agent}
            />
          </Suspense>
        )}

        {isStreamTestModalOpen &&
          streamServerConfig &&
          streamUrlData?.url &&
          streamServerConfig.secret && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-xl p-6 max-w-4xl w-full max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center mb-4 border-b border-neutral-200 dark:border-neutral-700 pb-4">
                  <h2 className="text-2xl font-semibold text-neutral-900">
                    Test Stream Server
                  </h2>
                  <button
                    onClick={() => setIsStreamTestModalOpen(false)}
                    className="border-2 border-neutral-300 bg-white px-4 py-2 text-neutral-700 font-semibold rounded-xl hover:bg-neutral-50 dark:bg-neutral-800 transition-all duration-200"
                  >
                    Close
                  </button>
                </div>
                <Suspense fallback={<LoadingScreen />}>
                  <AgentChat
                    workspaceId={workspaceId}
                    agentId={agentId}
                    api={`${streamUrlData.url.replace(
                      /\/+$/,
                      ""
                    )}/api/streams/${workspaceId}/${agentId}/${
                      streamServerConfig.secret
                    }`}
                  />
                </Suspense>
              </div>
            </div>
          )}
      </div>
    </div>
  );
};

interface KeyItemProps {
  keyData: {
    id: string;
    key?: string;
    name?: string;
    provider?: string;
    createdAt: string;
  };
  workspaceId: string;
  agentId: string;
  canEdit: boolean;
  webhookUrl: string;
}

const KeyItem: FC<KeyItemProps> = ({
  keyData,
  workspaceId,
  agentId,
  canEdit,
  webhookUrl,
}) => {
  const deleteKey = useDeleteAgentKey(workspaceId, agentId, keyData.id);
  const [isDeleting, setIsDeleting] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleDelete = async () => {
    if (
      !confirm(
        "Are you sure you want to delete this key? This action cannot be undone."
      )
    ) {
      return;
    }
    setIsDeleting(true);
    try {
      await deleteKey.mutateAsync();
    } catch {
      // Error is handled by toast in the hook
      setIsDeleting(false);
    }
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border border-neutral-200 dark:border-neutral-700 rounded-lg p-4 bg-white">
      <div className="flex justify-between items-start mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-semibold text-lg">
              {keyData.name || `Key ${keyData.id.slice(0, 8)}`}
            </h3>
            {keyData.name && (
              <span className="text-xs opacity-75 dark:text-neutral-300">
                ({keyData.id.slice(0, 8)})
              </span>
            )}
          </div>
          <p className="text-xs opacity-75 dark:text-neutral-300 mb-2">
            Created: {new Date(keyData.createdAt).toLocaleString()}
          </p>
          <div className="mb-2">
            <p className="text-xs font-semibold mb-1">Webhook URL:</p>
            <div className="flex items-center gap-2">
              <code
                onClick={handleCopyUrl}
                className="text-xs bg-neutral-50 dark:bg-neutral-800 p-2 border border-neutral-200 dark:border-neutral-700 rounded-lg flex-1 break-all cursor-pointer hover:bg-neutral-100 dark:bg-neutral-800 select-all transition-colors"
                title="Click to copy"
              >
                {webhookUrl}
              </code>
              <button
                onClick={handleCopyUrl}
                className="bg-gradient-primary px-4 py-2 text-white text-xs font-semibold rounded-lg hover:shadow-colored whitespace-nowrap transition-all duration-200"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold mb-1">Key Value:</p>
            {keyData.key ? (
              <code className="text-xs bg-neutral-50 dark:bg-neutral-800 p-2 border border-neutral-200 dark:border-neutral-700 rounded-lg block break-all">
                {keyData.key}
              </code>
            ) : (
              <div className="text-xs bg-amber-50 p-2 border border-amber-200 rounded-lg">
                <p className="font-semibold mb-1">Key Value Not Available</p>
                <p className="opacity-75 dark:text-neutral-300">
                  For security, key values are only shown once when created. If
                  you need the key value again, please create a new key.
                </p>
              </div>
            )}
          </div>
        </div>
        {canEdit && (
          <button
            onClick={handleDelete}
            disabled={isDeleting || deleteKey.isPending}
            className="bg-red-600 px-3 py-1 text-white text-xs font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed ml-4 transition-all duration-200"
          >
            {isDeleting || deleteKey.isPending ? "Deleting..." : "Delete"}
          </button>
        )}
      </div>
    </div>
  );
};

interface AgentUsageSectionProps {
  workspaceId: string;
  agentId: string;
}

const AgentUsageSection: FC<AgentUsageSectionProps> = ({
  workspaceId,
  agentId,
}) => {
  const [dateRangePreset, setDateRangePreset] =
    useState<DateRangePreset>("last-30-days");
  const dateRange = getDateRange(dateRangePreset);

  const {
    data: usageData,
    isLoading,
    error,
    refetch: refetchUsage,
    isRefetching: isRefetchingUsage,
  } = useAgentUsage(workspaceId, agentId, {
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });

  const {
    data: dailyUsageData,
    isLoading: isLoadingDaily,
    error: dailyError,
    refetch: refetchDaily,
    isRefetching: isRefetchingDaily,
  } = useAgentDailyUsage(workspaceId, agentId, {
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });

  const handleRefresh = () => {
    refetchUsage();
    refetchDaily();
  };

  const isRefreshing = isRefetchingUsage || isRefetchingDaily;

  if (isLoading || isLoadingDaily) {
    return <LoadingScreen compact message="Loading usage..." />;
  }

  if (error) {
    return (
      <div>
        <p className="text-red-600 font-bold">
          Error loading usage:{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  }

  if (dailyError) {
    return (
      <div>
        <p className="text-red-600 font-bold">
          Error loading daily usage:{" "}
          {dailyError instanceof Error ? dailyError.message : "Unknown error"}
        </p>
      </div>
    );
  }

  if (!usageData) {
    return null;
  }

  return (
    <UsageDashboard
      stats={usageData.stats}
      dailyData={dailyUsageData?.daily}
      title="AGENT USAGE"
      dateRange={dateRange}
      dateRangePreset={dateRangePreset}
      onDateRangeChange={setDateRangePreset}
      onRefresh={handleRefresh}
      isRefreshing={isRefreshing}
      showBorder={false}
    />
  );
};

const AgentLoadingFallback: FC = () => {
  return <LoadingScreen />;
};

const AgentDetail: FC = () => {
  const { reset } = useQueryErrorResetBoundary();
  const navigate = useNavigate();
  const { workspaceId, agentId } = useParams<{
    workspaceId: string;
    agentId: string;
  }>();

  return (
    <ErrorBoundary
      fallback={(error, resetError) => (
        <div className="flex items-center justify-center min-h-screen bg-white dark:bg-neutral-950 p-8">
          <div className="max-w-2xl w-full border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-xl p-8 bg-white dark:border-neutral-700 dark:bg-neutral-900">
            <h1 className="text-4xl font-semibold mb-4 dark:text-neutral-50">Error</h1>
            <p className="text-xl mb-4 text-red-600 font-semibold dark:text-red-400">
              {error.message || "Failed to load agent"}
            </p>
            <div className="space-y-4">
              <button
                onClick={() => {
                  reset();
                  resetError();
                }}
                className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored transition-all duration-200"
              >
                Try Again
              </button>
              <button
                onClick={() => navigate(`/workspaces/${workspaceId || ""}`)}
                className="ml-4 border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-700 font-semibold rounded-xl hover:bg-neutral-50 dark:bg-neutral-800 transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
              >
                Back to Workspace
              </button>
            </div>
          </div>
        </div>
      )}
    >
      <Suspense fallback={<AgentLoadingFallback />}>
        <AgentDataLoader workspaceId={workspaceId!} agentId={agentId!} />
      </Suspense>
    </ErrorBoundary>
  );
};

export default AgentDetail;
