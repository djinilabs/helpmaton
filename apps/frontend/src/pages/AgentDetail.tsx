import {
  ChatBubbleLeftRightIcon,
  ChatBubbleLeftIcon,
  LightBulbIcon,
  Cog6ToothIcon,
  UserGroupIcon,
  BoltIcon,
  MagnifyingGlassIcon,
  DocumentMagnifyingGlassIcon,
  EnvelopeIcon,
  GlobeAltIcon,
  LinkIcon,
  ComputerDesktopIcon,
  ServerIcon,
  SignalIcon,
  CreditCardIcon,
  ChartBarIcon,
  ExclamationTriangleIcon,
  CurrencyDollarIcon,
  BeakerIcon,
  WrenchScrewdriverIcon,
  ArrowTopRightOnSquareIcon,
  ArrowPathIcon,
  ClockIcon,
  ChevronRightIcon,
  PhotoIcon,
  ShareIcon,
} from "@heroicons/react/24/outline";
import {
  useQueryErrorResetBoundary,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  useState,
  Suspense,
  useRef,
  useEffect,
  useMemo,
  lazy,
  useCallback,
} from "react";
import type { FC, ReactNode } from "react";
import { useParams, useNavigate } from "react-router-dom";


import { AccordionSection } from "../components/AccordionSection";
import { AgentSuggestions } from "../components/AgentSuggestions";
import { ClientToolEditor } from "../components/ClientToolEditor";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { LazyAccordionContent } from "../components/LazyAccordionContent";
import { LoadingScreen } from "../components/LoadingScreen";
import { QueryPanel } from "../components/QueryPanel";
import { SectionGroup } from "../components/SectionGroup";
import { Slider } from "../components/Slider";
// Lazy load accordion components
const AgentChatWithFunctionUrl = lazy(() =>
  import("../components/AgentChatWithFunctionUrl").then((module) => ({
    default: module.AgentChatWithFunctionUrl,
  }))
);
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
const AgentKnowledgeGraph = lazy(() =>
  import("../components/AgentKnowledgeGraph").then((module) => ({
    default: module.AgentKnowledgeGraph,
  }))
);
const TransactionTable = lazy(() =>
  import("../components/TransactionTable").then((module) => ({
    default: module.TransactionTable,
  }))
);
const EvalJudgeList = lazy(() =>
  import("../components/EvalJudgeList").then((module) => ({
    default: module.EvalJudgeList,
  }))
);
const EvalResultsChart = lazy(() =>
  import("../components/EvalResultsChart").then((module) => ({
    default: module.EvalResultsChart,
  }))
);
const EvalResultsList = lazy(() =>
  import("../components/EvalResultsList").then((module) => ({
    default: module.EvalResultsList,
  }))
);
const AgentScheduleList = lazy(() =>
  import("../components/AgentScheduleList").then((module) => ({
    default: module.AgentScheduleList,
  }))
);
const IntegrationCard = lazy(() =>
  import("../components/IntegrationCard").then((module) => ({
    default: module.IntegrationCard,
  }))
);
const SlackConnectModal = lazy(() =>
  import("../components/SlackConnectModal").then((module) => ({
    default: module.SlackConnectModal,
  }))
);
const DiscordConnectModal = lazy(() =>
  import("../components/DiscordConnectModal").then((module) => ({
    default: module.DiscordConnectModal,
  }))
);
const DiscordCommandDialog = lazy(() =>
  import("../components/DiscordCommandDialog").then((module) => ({
    default: module.DiscordCommandDialog,
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
import { useEmailConnection } from "../hooks/useEmailConnection";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useLocalPreference } from "../hooks/useLocalPreference";
import { useMcpServers } from "../hooks/useMcpServers";
import {
  useStreamServer,
  useCreateStreamServer,
  useUpdateStreamServer,
  useDeleteStreamServer,
} from "../hooks/useStreamServer";
import { useStreamUrl } from "../hooks/useStreamUrl";
import { useToast } from "../hooks/useToast";
import { useAgentUsage, useAgentDailyUsage } from "../hooks/useUsage";
import { useWorkspace } from "../hooks/useWorkspaces";
import type {
  ClientTool,
  GroupedToolMetadata,
  ModelCapabilities,
  SummarizationPromptGrain,
  SummarizationPromptsInput,
  ToolMetadata,
} from "../utils/api";
import {
  getMcpServerTools,
  listIntegrations,
  deleteIntegration,
  updateIntegration,
} from "../utils/api";
import { getDefaultAvatar } from "../utils/avatarUtils";
import { type DateRangePreset, getDateRange } from "../utils/dateRanges";
import {
  DEFAULT_MEMORY_EXTRACTION_PROMPT,
  getEffectiveMemoryExtractionPrompt,
} from "../utils/memoryExtractionPrompt";
import {
  DEFAULT_SUMMARIZATION_PROMPTS,
  getEffectiveSummarizationPrompts,
} from "../utils/memoryPrompts";
import {
  filterModelsByCapability,
  filterTextGenerationModels,
  getCapabilitiesForProvider,
  getCapabilityLabels,
  getModelCapabilities,
  getModelsForProvider,
  getDefaultModelForProvider,
  fetchAvailableModels,
  getRerankingModels,
  getImageModelsForProvider,
  resolveDefaultModel,
  type Provider,
} from "../utils/modelConfig";
import { trackEvent } from "../utils/tracking";
import {
  DEFAULT_WIDGET_PREVIEW_SETTINGS,
  PREVIEW_FONT_FAMILIES,
  PREVIEW_FONT_SIZE_RANGE,
  normalizeWidgetPreviewSettings,
  resolveWidgetPreviewFontFamily,
  widgetPreviewSettingsToSearchParams,
  type WidgetPreviewSettings,
} from "../utils/widgetPreviewSettings";

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
const ModelPricesDialog = lazy(() =>
  import("../components/ModelPricesDialog").then((module) => ({
    default: module.ModelPricesDialog,
  }))
);
const ImproveAgentPromptDialog = lazy(() =>
  import("../components/ImproveAgentPromptDialog").then((module) => ({
    default: module.ImproveAgentPromptDialog,
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

const MODEL_PROVIDER: Provider = "openrouter";

const DEFAULT_WIDGET_CONFIG = {
  enabled: false,
  allowedOrigins: undefined,
  theme: "auto",
} as const;

const DEFAULT_WIDGET_CUSTOMIZATION = {
  primaryColor: "#3b82f6",
  backgroundColor: "#ffffff",
  textColor: "#1f2937",
  borderColor: "#e5e7eb",
  borderRadius: "8px",
  outerBorderEnabled: true,
  internalBorderThickness: "2px",
  internalBorderColor: "#e5e7eb",
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontSize: "16px",
  enableFileUpload: true,
};

const parseColor = (color?: string) => {
  if (!color) {
    return { hex: "#000000", opacity: 1 };
  }
  const rgbaMatch = color.match(
    /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/
  );
  if (rgbaMatch) {
    const r = parseInt(rgbaMatch[1], 10);
    const g = parseInt(rgbaMatch[2], 10);
    const b = parseInt(rgbaMatch[3], 10);
    const a = rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1;
    const hex = `#${[r, g, b]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")}`;
    return { hex, opacity: a };
  }
  const trimmedColor = color.trim();
  const hexPattern = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  if (hexPattern.test(trimmedColor)) {
    const normalizedHex =
      trimmedColor.length === 4
        ? `#${trimmedColor
            .slice(1)
            .split("")
            .map((ch) => ch + ch)
            .join("")}`
        : trimmedColor;
    return { hex: normalizedHex, opacity: 1 };
  }
  return { hex: "#000000", opacity: 1 };
};

const hexToRgba = (hex: string, opacity: number) => {
  if (typeof hex !== "string") {
    return "";
  }
  const trimmed = hex.trim();
  const match = trimmed.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!match) {
    return trimmed;
  }
  let hexValue = match[1];
  if (hexValue.length === 3) {
    hexValue = hexValue
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  const r = parseInt(hexValue.slice(0, 2), 16);
  const g = parseInt(hexValue.slice(2, 4), 16);
  const b = parseInt(hexValue.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

const DEFAULT_KNOWLEDGE_SNIPPET_COUNT = 5;
const DEFAULT_KNOWLEDGE_MIN_SIMILARITY = 0;

const SUMMARIZATION_PROMPT_GRAINS: SummarizationPromptGrain[] = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
];

const SUMMARIZATION_PROMPT_LABELS: Record<SummarizationPromptGrain, string> = {
  daily: "Daily summaries",
  weekly: "Weekly summaries",
  monthly: "Monthly summaries",
  quarterly: "Quarterly summaries",
  yearly: "Yearly summaries",
};

const normalizeValue = (val: number | null | undefined) => val ?? undefined;
const normalizeArray = (val: string[] | null | undefined) => val ?? undefined;

function useStreamUrlErrorToast(
  streamUrlError: unknown,
  toast: ReturnType<typeof useToast>
) {
  useEffect(() => {
    if (!streamUrlError) {
      return;
    }
    const errorMessage =
      streamUrlError instanceof Error
        ? streamUrlError.message
        : "Failed to fetch streaming function URL";
    toast.error(
      `Unable to fetch streaming function URL: ${errorMessage}. Stream server features may be unavailable.`
    );
  }, [streamUrlError, toast]);
}

function useSyncDelegatableAgentIds(
  agent: ReturnType<typeof useAgent>["data"],
  setDelegatableAgentIds: (value: string[]) => void
) {
  const prevDelegatableAgentIdsRef = useRef<string[] | undefined>(
    agent?.delegatableAgentIds
  );
  useEffect(() => {
    const currentValue = agent?.delegatableAgentIds || [];
    const prevValue = prevDelegatableAgentIdsRef.current || [];
    if (
      currentValue.length !== prevValue.length ||
      !currentValue.every((id, index) => id === prevValue[index])
    ) {
      prevDelegatableAgentIdsRef.current = currentValue;
      setDelegatableAgentIds(currentValue);
    }
  }, [agent?.id, agent?.delegatableAgentIds, setDelegatableAgentIds]);
}

function areToolNameMapsEqual(
  current: Record<string, string[]> | undefined,
  next: Record<string, string[]> | undefined
): boolean {
  const currentKeys = Object.keys(current ?? {});
  const nextKeys = Object.keys(next ?? {});
  if (currentKeys.length !== nextKeys.length) {
    return false;
  }
  const nextKeySet = new Set(nextKeys);
  if (!currentKeys.every((key) => nextKeySet.has(key))) {
    return false;
  }
  return currentKeys.every((key) => {
    const currentValues = current?.[key] ?? [];
    const nextValues = next?.[key] ?? [];
    if (currentValues.length !== nextValues.length) {
      return false;
    }
    return currentValues.every((value, index) => value === nextValues[index]);
  });
}

function useSyncEnabledMcpServerIds(
  agent: ReturnType<typeof useAgent>["data"],
  setEnabledMcpServerIds: (value: string[]) => void
) {
  const prevEnabledMcpServerIdsRef = useRef<string[] | undefined>(
    agent?.enabledMcpServerIds
  );
  useEffect(() => {
    const currentValue = agent?.enabledMcpServerIds || [];
    const prevValue = prevEnabledMcpServerIdsRef.current || [];
    if (
      currentValue.length !== prevValue.length ||
      !currentValue.every((id, index) => id === prevValue[index])
    ) {
      prevEnabledMcpServerIdsRef.current = currentValue;
      setEnabledMcpServerIds(currentValue);
    }
  }, [agent?.id, agent?.enabledMcpServerIds, setEnabledMcpServerIds]);
}

function useSyncEnabledMcpServerToolNames(
  agent: ReturnType<typeof useAgent>["data"],
  setEnabledMcpServerToolNames: (value: Record<string, string[]>) => void
) {
  const prevToolNamesRef = useRef<Record<string, string[]> | undefined>(
    agent?.enabledMcpServerToolNames
  );
  useEffect(() => {
    const currentValue = agent?.enabledMcpServerToolNames ?? {};
    const prevValue = prevToolNamesRef.current ?? {};
    if (!areToolNameMapsEqual(currentValue, prevValue)) {
      prevToolNamesRef.current = currentValue;
      setEnabledMcpServerToolNames(currentValue);
    }
  }, [agent?.id, agent?.enabledMcpServerToolNames, setEnabledMcpServerToolNames]);
}

function useSyncEnableMemorySearch(
  agent: ReturnType<typeof useAgent>["data"],
  setEnableMemorySearch: (value: boolean) => void
) {
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
  }, [agent?.id, agent?.enableMemorySearch, setEnableMemorySearch]);
}

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

interface AgentAccordionSectionProps {
  id: string;
  title: ReactNode;
  expandedSection: string | null;
  onToggle: (id: string) => void;
  children: ReactNode;
  lazy?: boolean;
  contentClassName?: string;
}

const AgentAccordionSection: FC<AgentAccordionSectionProps> = ({
  id,
  title,
  expandedSection,
  onToggle,
  children,
  lazy = true,
  contentClassName,
}) => {
  const isExpanded = expandedSection === id;
  return (
    <AccordionSection
      id={id}
      title={title}
      isExpanded={isExpanded}
      onToggle={() => onToggle(id)}
      contentClassName={contentClassName}
    >
      {lazy ? (
        <LazyAccordionContent isExpanded={isExpanded}>
          {children}
        </LazyAccordionContent>
      ) : (
        children
      )}
    </AccordionSection>
  );
};

interface WidgetKeyListProps {
  keys: Array<{
    id: string;
    key?: string;
    name?: string;
  }>;
  workspaceId: string;
  agentId: string;
}

const WidgetKeyList: FC<WidgetKeyListProps> = ({
  keys,
  workspaceId,
  agentId,
}) => {
  if (keys.length === 0) {
    return (
      <p className="text-sm opacity-75">
        No widget keys yet. Create one to get started.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {keys.map((keyData) => {
        const WidgetKeyItem: FC = () => {
          const deleteKey = useDeleteAgentKey(
            workspaceId,
            agentId,
            keyData.id
          );
          return (
            <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <div>
                <p className="text-sm font-medium">
                  {keyData.name || "Widget Key"}
                </p>
                <p className="text-xs opacity-75">
                  {keyData.key
                    ? `${keyData.key.substring(0, 20)}...`
                    : "Key hidden"}
                </p>
              </div>
              <button
                onClick={async () => {
                  if (
                    confirm(
                      "Are you sure you want to delete this widget key?"
                    )
                  ) {
                    try {
                      await deleteKey.mutateAsync();
                    } catch {
                      // Error handled by toast
                    }
                  }
                }}
                disabled={deleteKey.isPending}
                className="text-xs text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
              >
                {deleteKey.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          );
        };
        return <WidgetKeyItem key={keyData.id} />;
      })}
    </div>
  );
};

interface AgentDetailContentProps {
  workspace: ReturnType<typeof useWorkspace>["data"];
  agent: ReturnType<typeof useAgent>["data"];
  keys: ReturnType<typeof useAgentKeys>["data"];
  workspaceId: string;
  agentId: string;
}

function useAgentDetailState({
  workspace,
  agent,
  keys,
  workspaceId,
  agentId,
}: AgentDetailContentProps) {
  const navigate = useNavigate();
  const deleteAgent = useDeleteAgent(workspaceId, agentId);
  const createKey = useCreateAgentKey(workspaceId, agentId);
  const updateAgent = useUpdateAgent(workspaceId, agentId);
  const { data: allAgents } = useAgents(workspaceId);
  const { data: mcpServersData } = useMcpServers(workspaceId);
  const mcpServerIds = useMemo(
    () => mcpServersData?.servers.map((server) => server.id) ?? [],
    [mcpServersData]
  );
  const {
    data: mcpServerToolsById = {},
    isLoading: isLoadingMcpServerTools,
  } = useQuery({
    queryKey: ["mcp-server-tools", workspaceId, mcpServerIds.join(",")],
    queryFn: async () => {
      if (!mcpServersData?.servers?.length) {
        return {} as Record<string, GroupedToolMetadata[]>;
      }
      const entries = await Promise.all(
        mcpServersData.servers.map(async (server) => {
          const tools = await getMcpServerTools(workspaceId, server.id);
          return [server.id, tools] as const;
        })
      );
      return Object.fromEntries(entries);
    },
    enabled: mcpServerIds.length > 0,
    staleTime: 30 * 1000,
  });
  const { data: emailConnection } = useEmailConnection(workspaceId);
  const { data: streamServerConfig } = useStreamServer(workspaceId, agentId);
  const createStreamServer = useCreateStreamServer(workspaceId, agentId);
  const updateStreamServer = useUpdateStreamServer(workspaceId, agentId);
  const deleteStreamServer = useDeleteStreamServer(workspaceId, agentId);
  const { data: streamUrlData, error: streamUrlError } = useStreamUrl();

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
  const [isModelPricesOpen, setIsModelPricesOpen] = useState(false);
  const [isImprovePromptOpen, setIsImprovePromptOpen] = useState(false);
  const [modelPricesFilter, setModelPricesFilter] = useState<
    keyof ModelCapabilities | undefined
  >("text_generation");
  const [selectedConversationId, setSelectedConversationId] =
    useState<string | null>(null);
  const [showScrollIndicator, setShowScrollIndicator] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [showSlackModal, setShowSlackModal] = useState(false);
  const [showDiscordModal, setShowDiscordModal] = useState(false);
  const [commandDialogState, setCommandDialogState] = useState<{
    integrationId: string;
    currentCommandName?: string;
  } | null>(null);
  const systemPromptRef = useRef<HTMLDivElement>(null);

  const { expandedSection, toggleSection } = useAccordion(
    `agent-detail-${agentId}`
  );
  const lastScrolledAgentIdRef = useRef<string | null>(null);
  const [chatClearKey, setChatClearKey] = useState(0);
  const toast = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (lastScrolledAgentIdRef.current === agentId) {
      return;
    }

    lastScrolledAgentIdRef.current = agentId;
    if (!expandedSection) {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [agentId, expandedSection]);

  // Fetch integrations for this agent
  const { data: allIntegrations } = useQuery({
    queryKey: ["integrations", workspaceId],
    queryFn: () => listIntegrations(workspaceId),
    enabled: !!workspaceId,
  });

  // Filter integrations for this agent
  const agentIntegrations =
    allIntegrations?.filter((integration) => integration.agentId === agentId) ||
    [];

  // Mutations for integrations
  const deleteIntegrationMutation = useMutation({
    mutationFn: (integrationId: string) =>
      deleteIntegration(workspaceId, integrationId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integrations", workspaceId],
      });
      toast.success("Integration deleted successfully");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete integration"
      );
    },
  });

  const updateIntegrationMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: "active" | "inactive" | "error";
    }) => updateIntegration(workspaceId, id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integrations", workspaceId],
      });
      toast.success("Integration updated successfully");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to update integration"
      );
    },
  });

  const handleDeleteIntegration = (id: string) => {
    if (confirm("Are you sure you want to delete this integration?")) {
      deleteIntegrationMutation.mutate(id);
    }
  };

  const handleUpdateIntegration = (
    id: string,
    status: "active" | "inactive" | "error"
  ) => {
    updateIntegrationMutation.mutate({ id, status });
  };

  const handleInstallCommand = (
    integrationId: string,
    currentCommandName?: string
  ) => {
    setCommandDialogState({ integrationId, currentCommandName });
  };

  const handleCommandDialogSuccess = () => {
    queryClient.invalidateQueries({
      queryKey: ["integrations", workspaceId],
    });
    setCommandDialogState(null);
  };

  const handleMcpWarningClick = useCallback(() => {
    if (expandedSection !== "mcp-servers") {
      toggleSection("mcp-servers");
    }

    requestAnimationFrame(() => {
      const target = document.getElementById("agent-mcp-servers-section");
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }, [expandedSection, toggleSection]);

  useEscapeKey(isStreamTestModalOpen, () => setIsStreamTestModalOpen(false));

  useStreamUrlErrorToast(streamUrlError, toast);

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
  const [enabledMcpServerToolNames, setEnabledMcpServerToolNames] = useState<
    Record<string, string[]>
  >(() => agent?.enabledMcpServerToolNames || {});

  const [isMcpWarningDismissed, setIsMcpWarningDismissed] =
    useLocalPreference<boolean>(
      `agent-detail-${agentId}-mcp-warning-dismissed`,
      false
    );

  const hasWorkspaceMcpServers = (mcpServersData?.servers.length ?? 0) > 0;
  const hasEnabledMcpServers = enabledMcpServerIds.length > 0;
  const showMcpServersWarning =
    canEdit &&
    hasWorkspaceMcpServers &&
    !hasEnabledMcpServers &&
    !isMcpWarningDismissed;

  // Use agent prop directly for enableMemorySearch, with local state for editing
  const [enableMemorySearch, setEnableMemorySearch] = useState<boolean>(
    () => agent?.enableMemorySearch ?? false
  );

  const [summarizationPrompts, setSummarizationPrompts] = useState<
    Record<SummarizationPromptGrain, string>
  >(() => getEffectiveSummarizationPrompts(agent?.summarizationPrompts));

  const [memoryExtractionEnabled, setMemoryExtractionEnabled] =
    useState<boolean>(() => agent?.memoryExtractionEnabled ?? false);
  const [memoryExtractionModel, setMemoryExtractionModel] = useState<
    string | null
  >(() => agent?.memoryExtractionModel || null);
  const [memoryExtractionPrompt, setMemoryExtractionPrompt] =
    useState<string>(() =>
      getEffectiveMemoryExtractionPrompt(agent?.memoryExtractionPrompt)
    );

  // Use agent prop directly for enableSearchDocuments, with local state for editing
  const [enableSearchDocuments, setEnableSearchDocuments] = useState<boolean>(
    () => agent?.enableSearchDocuments ?? false
  );

  // Use agent prop directly for enableSendEmail, with local state for editing
  const [enableSendEmail, setEnableSendEmail] = useState<boolean>(
    () => agent?.enableSendEmail ?? false
  );

  // Use agent prop directly for searchWebProvider, with local state for editing
  const [searchWebProvider, setSearchWebProvider] = useState<
    "tavily" | "jina" | null
  >(() => {
    // Migrate from enableTavilySearch for backward compatibility
    if (agent?.searchWebProvider !== undefined) {
      return agent.searchWebProvider;
    }
    if (agent?.enableTavilySearch === true) {
      return "tavily";
    }
    return null;
  });

  // Use agent prop directly for fetchWebProvider, with local state for editing
  const [fetchWebProvider, setFetchWebProvider] = useState<
    "tavily" | "jina" | "scrape" | null
  >(() => agent?.fetchWebProvider ?? null);

  // Use agent prop directly for enableExaSearch, with local state for editing
  const [enableExaSearch, setEnableExaSearch] = useState<boolean>(
    () => agent?.enableExaSearch ?? false
  );

  const [enableImageGeneration, setEnableImageGeneration] = useState<boolean>(
    () => agent?.enableImageGeneration ?? false
  );
  const [imageGenerationModel, setImageGenerationModel] = useState<
    string | null
  >(() => agent?.imageGenerationModel || null);
  const [imageModels, setImageModels] = useState<string[]>([]);
  const [isLoadingImageModels, setIsLoadingImageModels] = useState(false);
  const [imageModelLoadError, setImageModelLoadError] = useState<string | null>(
    null
  );
  const imageGenerationModelInputRef = useRef<string | null>(
    agent?.imageGenerationModel || null
  );
  const isImageModelUnavailable =
    enableImageGeneration &&
    !!imageGenerationModel &&
    !isLoadingImageModels &&
    !imageModels.includes(imageGenerationModel);

  // Knowledge injection state
  const [enableKnowledgeInjection, setEnableKnowledgeInjection] =
    useState<boolean>(() => agent?.enableKnowledgeInjection ?? false);
  const [
    enableKnowledgeInjectionFromMemories,
    setEnableKnowledgeInjectionFromMemories,
  ] = useState<boolean>(() => agent?.enableKnowledgeInjectionFromMemories ?? false);
  const [
    enableKnowledgeInjectionFromDocuments,
    setEnableKnowledgeInjectionFromDocuments,
  ] = useState<boolean>(() => agent?.enableKnowledgeInjectionFromDocuments ?? true);
  const [knowledgeInjectionSnippetCount, setKnowledgeInjectionSnippetCount] =
    useState<number>(
      () =>
        agent?.knowledgeInjectionSnippetCount ?? DEFAULT_KNOWLEDGE_SNIPPET_COUNT
    );
  const [knowledgeInjectionMinSimilarity, setKnowledgeInjectionMinSimilarity] =
    useState<number>(
      () =>
        agent?.knowledgeInjectionMinSimilarity ??
        DEFAULT_KNOWLEDGE_MIN_SIMILARITY
    );
  const [
    knowledgeInjectionEntityExtractorModel,
    setKnowledgeInjectionEntityExtractorModel,
  ] = useState<string | null>(
    () => agent?.knowledgeInjectionEntityExtractorModel || null
  );
  const [enableKnowledgeReranking, setEnableKnowledgeReranking] =
    useState<boolean>(() => agent?.enableKnowledgeReranking ?? false);
  const [knowledgeRerankingModel, setKnowledgeRerankingModel] = useState<
    string | null
  >(() => agent?.knowledgeRerankingModel || null);
  const [rerankingModels, setRerankingModels] = useState<string[]>([]);
  const [isLoadingRerankingModels, setIsLoadingRerankingModels] =
    useState(false);

  // Use agent prop directly for clientTools, with local state for editing
  const [clientTools, setClientTools] = useState<ClientTool[]>(
    () => agent?.clientTools || []
  );

  // Widget configuration state
  const [widgetConfig, setWidgetConfig] = useState<{
    enabled: boolean;
    allowedOrigins?: string[];
    theme?: "light" | "dark" | "auto";
  }>(() => ({
    ...DEFAULT_WIDGET_CONFIG,
    enabled: agent?.widgetConfig?.enabled || DEFAULT_WIDGET_CONFIG.enabled,
    allowedOrigins: agent?.widgetConfig?.allowedOrigins,
    theme: agent?.widgetConfig?.theme || DEFAULT_WIDGET_CONFIG.theme,
  }));

  // Widget customization options (saved locally per agent)
  const [widgetCustomization, setWidgetCustomization] = useLocalPreference<{
    primaryColor?: string;
    backgroundColor?: string;
    textColor?: string;
    borderColor?: string;
    borderRadius?: string;
    outerBorderEnabled?: boolean;
    internalBorderThickness?: string;
    internalBorderColor?: string;
    fontFamily?: string;
    fontSize?: string;
  enableFileUpload?: boolean;
  }>(`widget-customization-${agentId}`, DEFAULT_WIDGET_CUSTOMIZATION);

  const [widgetPreviewSettings, setWidgetPreviewSettings] =
    useLocalPreference<WidgetPreviewSettings>(
      `widget-preview-settings-${agentId}`,
      DEFAULT_WIDGET_PREVIEW_SETTINGS
    );
  const normalizedPreviewSettings = normalizeWidgetPreviewSettings(
    widgetPreviewSettings
  );
  const previewFontFamilyValue = resolveWidgetPreviewFontFamily(
    normalizedPreviewSettings.fontFamily
  );
  const updateWidgetPreviewSettings = (
    updates: Partial<WidgetPreviewSettings>
  ) => {
    setWidgetPreviewSettings({
      ...widgetPreviewSettings,
      ...updates,
    });
  };

  // Model state - provider is always "openrouter", only modelName can be changed
  const provider: Provider = MODEL_PROVIDER;
  const [modelName, setModelName] = useState<string | null>(() => {
    return agent?.modelName || null;
  });

  // Model fetching state
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
      setIsLoadingImageModels(true);
      setImageModelLoadError(null);
      try {
        const [models, defaultModelName, imageCapableModels, capabilities] =
          await Promise.all([
            getModelsForProvider(provider),
            getDefaultModelForProvider(provider),
            getImageModelsForProvider(provider),
            getCapabilitiesForProvider(provider),
          ]);

        const capabilityFilteredModels = filterTextGenerationModels(
          models,
          capabilities
        );
        const resolvedModels =
          capabilityFilteredModels.length > 0 ? capabilityFilteredModels : models;
        const resolvedDefaultModel = resolveDefaultModel(
          resolvedModels,
          defaultModelName
        );

        if (!cancelled) {
          setAvailableModels(resolvedModels);
          setDefaultModel(resolvedDefaultModel);
          setImageModels(imageCapableModels);
          setModelCapabilities(capabilities);
          setModelName((current) =>
            current && !resolvedModels.includes(current) ? null : current
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
          setImageModels([]);
          setImageModelLoadError(
            "Failed to load image-capable models. Please refresh the page."
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingModels(false);
          setIsLoadingImageModels(false);
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

  useSyncDelegatableAgentIds(agent, setDelegatableAgentIds);
  useSyncEnabledMcpServerIds(agent, setEnabledMcpServerIds);
  useSyncEnabledMcpServerToolNames(agent, setEnabledMcpServerToolNames);
  useSyncEnableMemorySearch(agent, setEnableMemorySearch);

  const prevSummarizationPromptsRef = useRef(agent?.summarizationPrompts);
  useEffect(() => {
    const currentValue = agent?.summarizationPrompts;
    const currentSerialized = JSON.stringify(currentValue ?? {});
    const prevSerialized = JSON.stringify(
      prevSummarizationPromptsRef.current ?? {}
    );
    if (currentSerialized !== prevSerialized) {
      prevSummarizationPromptsRef.current = currentValue;
      setSummarizationPrompts(getEffectiveSummarizationPrompts(currentValue));
    }
  }, [agent?.id, agent?.summarizationPrompts]);

  const prevMemoryExtractionRef = useRef({
    enabled: agent?.memoryExtractionEnabled ?? false,
    model: agent?.memoryExtractionModel ?? null,
    prompt: agent?.memoryExtractionPrompt ?? null,
  });
  useEffect(() => {
    const current = {
      enabled: agent?.memoryExtractionEnabled ?? false,
      model: agent?.memoryExtractionModel ?? null,
      prompt: agent?.memoryExtractionPrompt ?? null,
    };
    const prev = prevMemoryExtractionRef.current;
    if (
      current.enabled !== prev.enabled ||
      current.model !== prev.model ||
      current.prompt !== prev.prompt
    ) {
      prevMemoryExtractionRef.current = current;
      setMemoryExtractionEnabled(current.enabled);
      setMemoryExtractionModel(current.model);
      setMemoryExtractionPrompt(getEffectiveMemoryExtractionPrompt(current.prompt));
    }
  }, [
    agent?.id,
    agent?.memoryExtractionEnabled,
    agent?.memoryExtractionModel,
    agent?.memoryExtractionPrompt,
  ]);

  // Synchronize enableSearchDocuments state with agent prop using useEffect
  const prevEnableSearchDocumentsRef = useRef<boolean | undefined>(
    agent?.enableSearchDocuments
  );
  useEffect(() => {
    const currentValue = agent?.enableSearchDocuments ?? false;
    const prevValue = prevEnableSearchDocumentsRef.current ?? false;
    if (currentValue !== prevValue) {
      prevEnableSearchDocumentsRef.current = currentValue;
      setEnableSearchDocuments(currentValue);
    }
  }, [agent?.id, agent?.enableSearchDocuments]);

  // Synchronize enableSendEmail state with agent prop using useEffect
  const prevEnableSendEmailRef = useRef<boolean | undefined>(
    agent?.enableSendEmail
  );
  useEffect(() => {
    const currentValue = agent?.enableSendEmail ?? false;
    const prevValue = prevEnableSendEmailRef.current ?? false;
    if (currentValue !== prevValue) {
      prevEnableSendEmailRef.current = currentValue;
      setEnableSendEmail(currentValue);
    }
  }, [agent?.id, agent?.enableSendEmail]);

  // Synchronize knowledge injection state with agent prop
  useEffect(() => {
    setEnableKnowledgeInjection(agent?.enableKnowledgeInjection ?? false);
    setEnableKnowledgeInjectionFromMemories(
      agent?.enableKnowledgeInjectionFromMemories ?? false
    );
    setEnableKnowledgeInjectionFromDocuments(
      agent?.enableKnowledgeInjectionFromDocuments ?? true
    );
    setKnowledgeInjectionSnippetCount(
      agent?.knowledgeInjectionSnippetCount ?? DEFAULT_KNOWLEDGE_SNIPPET_COUNT
    );
    setKnowledgeInjectionMinSimilarity(
      agent?.knowledgeInjectionMinSimilarity ?? DEFAULT_KNOWLEDGE_MIN_SIMILARITY
    );
    setKnowledgeInjectionEntityExtractorModel(
      agent?.knowledgeInjectionEntityExtractorModel ?? null
    );
    setEnableKnowledgeReranking(agent?.enableKnowledgeReranking ?? false);
    setKnowledgeRerankingModel(agent?.knowledgeRerankingModel || null);
  }, [
    agent?.id,
    agent?.enableKnowledgeInjection,
    agent?.enableKnowledgeInjectionFromMemories,
    agent?.enableKnowledgeInjectionFromDocuments,
    agent?.knowledgeInjectionSnippetCount,
    agent?.knowledgeInjectionMinSimilarity,
    agent?.knowledgeInjectionEntityExtractorModel,
    agent?.enableKnowledgeReranking,
    agent?.knowledgeRerankingModel,
  ]);

  // Load re-ranking models when re-ranking is enabled
  useEffect(() => {
    if (enableKnowledgeReranking) {
      setIsLoadingRerankingModels(true);
      fetchAvailableModels()
        .then((models) => {
          const openrouterModels = models.openrouter?.models || [];
          const capabilities = models.openrouter?.capabilities;
          const capabilityFiltered = capabilities
            ? filterModelsByCapability(openrouterModels, capabilities, "rerank")
            : [];
          const resolvedRerankModels =
            capabilityFiltered.length > 0
              ? capabilityFiltered
              : getRerankingModels(openrouterModels);
          setRerankingModels(resolvedRerankModels);
          setIsLoadingRerankingModels(false);
          setKnowledgeRerankingModel((current) =>
            current && !resolvedRerankModels.includes(current) ? null : current
          );
        })
        .catch((error) => {
          console.error("Failed to load re-ranking models:", error);
          setIsLoadingRerankingModels(false);
        });
    } else {
      setRerankingModels([]);
    }
  }, [enableKnowledgeReranking]);

  // Synchronize searchWebProvider state with agent prop using useEffect
  const prevSearchWebProviderRef = useRef<"tavily" | "jina" | null | undefined>(
    agent?.searchWebProvider ??
      (agent?.enableTavilySearch === true ? "tavily" : null)
  );
  useEffect(() => {
    // Migrate from enableTavilySearch for backward compatibility
    let currentValue: "tavily" | "jina" | null = null;
    if (agent?.searchWebProvider !== undefined) {
      currentValue = agent.searchWebProvider;
    } else if (agent?.enableTavilySearch === true) {
      currentValue = "tavily";
    }
    const prevValue = prevSearchWebProviderRef.current ?? null;
    if (currentValue !== prevValue) {
      prevSearchWebProviderRef.current = currentValue;
      setSearchWebProvider(currentValue);
    }
  }, [agent?.id, agent?.searchWebProvider, agent?.enableTavilySearch]);

  // Synchronize fetchWebProvider state with agent prop using useEffect
  const prevFetchWebProviderRef = useRef<
    "tavily" | "jina" | "scrape" | null | undefined
  >(agent?.fetchWebProvider);
  useEffect(() => {
    const currentValue = agent?.fetchWebProvider ?? null;
    const prevValue = prevFetchWebProviderRef.current ?? null;
    if (currentValue !== prevValue) {
      prevFetchWebProviderRef.current = currentValue;
      setFetchWebProvider(currentValue);
    }
  }, [agent?.id, agent?.fetchWebProvider]);

  // Synchronize enableExaSearch state with agent prop using useEffect
  const prevEnableExaSearchRef = useRef<boolean | undefined>(
    agent?.enableExaSearch
  );
  useEffect(() => {
    const currentValue = agent?.enableExaSearch ?? false;
    const prevValue = prevEnableExaSearchRef.current ?? false;
    if (currentValue !== prevValue) {
      prevEnableExaSearchRef.current = currentValue;
      setEnableExaSearch(currentValue);
    }
  }, [agent?.id, agent?.enableExaSearch]);

  // Synchronize image generation state with agent prop using useEffect
  const prevEnableImageGenerationRef = useRef<boolean | undefined>(
    agent?.enableImageGeneration
  );
  useEffect(() => {
    const currentValue = agent?.enableImageGeneration ?? false;
    const prevValue = prevEnableImageGenerationRef.current ?? false;
    if (currentValue !== prevValue) {
      prevEnableImageGenerationRef.current = currentValue;
      setEnableImageGeneration(currentValue);
    }
  }, [agent?.id, agent?.enableImageGeneration]);

  const prevImageGenerationModelRef = useRef<string | null | undefined>(
    agent?.imageGenerationModel
  );
  useEffect(() => {
    const currentValue = agent?.imageGenerationModel || null;
    const prevValue = prevImageGenerationModelRef.current ?? null;
    if (currentValue !== prevValue) {
      prevImageGenerationModelRef.current = currentValue;
      setImageGenerationModel(currentValue);
    }
  }, [agent?.id, agent?.imageGenerationModel]);

  useEffect(() => {
    imageGenerationModelInputRef.current = imageGenerationModel || null;
  }, [imageGenerationModel]);

  useEffect(() => {
    if (
      enableImageGeneration &&
      !imageGenerationModel &&
      imageModels.length > 0
    ) {
      const fallbackModel = imageModels[0] || null;
      imageGenerationModelInputRef.current = fallbackModel;
      setImageGenerationModel(fallbackModel);
    }
  }, [enableImageGeneration, imageGenerationModel, imageModels]);

  // Synchronize clientTools state with agent prop using useEffect
  useEffect(() => {
    const currentValue = agent?.clientTools || [];
    setClientTools(currentValue);
  }, [agent?.id, agent?.clientTools]);

  // Synchronize widgetConfig state with agent prop using useEffect
  useEffect(() => {
    if (agent?.widgetConfig) {
      setWidgetConfig({
        ...DEFAULT_WIDGET_CONFIG,
        enabled: agent.widgetConfig.enabled || DEFAULT_WIDGET_CONFIG.enabled,
        allowedOrigins: agent.widgetConfig.allowedOrigins,
        theme: agent.widgetConfig.theme || DEFAULT_WIDGET_CONFIG.theme,
      });
    } else {
      setWidgetConfig({ ...DEFAULT_WIDGET_CONFIG });
    }
  }, [agent?.id, agent?.widgetConfig]);

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
      trackEvent("agent_deleted", {
        workspace_id: workspaceId,
        agent_id: agentId,
      });
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
      trackEvent("agent_key_added", {
        workspace_id: workspaceId,
        agent_id: agentId,
        key_id: createdKey.id,
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
      trackEvent("stream_server_created", {
        workspace_id: workspaceId,
        agent_id: agentId,
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
      trackEvent("stream_server_updated", {
        workspace_id: workspaceId,
        agent_id: agentId,
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
      trackEvent("stream_server_deleted", {
        workspace_id: workspaceId,
        agent_id: agentId,
      });
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

  const handleMcpServerToolToggle = (
    serverId: string,
    toolName: string,
    allToolNames: string[]
  ) => {
    if (allToolNames.length === 0) {
      return;
    }
    setEnabledMcpServerToolNames((prev) => {
      const currentToolNames = prev[serverId] ?? allToolNames;
      const nextToolNames = currentToolNames.includes(toolName)
        ? currentToolNames.filter((name) => name !== toolName)
        : [...currentToolNames, toolName];
      return {
        ...prev,
        [serverId]: nextToolNames,
      };
    });
  };

  const handleSaveMcpServers = async () => {
    try {
      const updated = await updateAgent.mutateAsync({
        enabledMcpServerIds,
        enabledMcpServerToolNames,
      });
      setEnabledMcpServerIds(updated.enabledMcpServerIds || []);
      setEnabledMcpServerToolNames(updated.enabledMcpServerToolNames || {});
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const getMcpServerToolsForServer = (serverId: string): ToolMetadata[] => {
    const groupedTools = mcpServerToolsById[serverId] ?? [];
    const toolsGroup =
      groupedTools.find((group) => group.category === "MCP Server Tools") ??
      groupedTools[0];
    return toolsGroup?.tools ?? [];
  };

  const handleSaveMemorySearch = async () => {
    try {
      const updated = await updateAgent.mutateAsync({
        enableMemorySearch,
      });
      setEnableMemorySearch(updated.enableMemorySearch ?? false);
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const handleSaveMemoryExtraction = async () => {
    try {
      const trimmedPrompt = memoryExtractionPrompt.trim();
      const defaultPrompt = DEFAULT_MEMORY_EXTRACTION_PROMPT.trim();
      const resolvedModel =
        memoryExtractionModel && memoryExtractionModel.trim().length > 0
          ? memoryExtractionModel.trim()
          : null;
      const updated = await updateAgent.mutateAsync({
        memoryExtractionEnabled,
        memoryExtractionModel: resolvedModel,
        memoryExtractionPrompt:
          trimmedPrompt && trimmedPrompt !== defaultPrompt
            ? trimmedPrompt
            : null,
      });
      prevMemoryExtractionRef.current = {
        enabled: updated.memoryExtractionEnabled ?? false,
        model: updated.memoryExtractionModel ?? null,
        prompt: updated.memoryExtractionPrompt ?? null,
      };
      setMemoryExtractionEnabled(updated.memoryExtractionEnabled ?? false);
      setMemoryExtractionModel(updated.memoryExtractionModel ?? null);
      setMemoryExtractionPrompt(
        getEffectiveMemoryExtractionPrompt(updated.memoryExtractionPrompt)
      );
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const handleSummarizationPromptChange = (
    grain: SummarizationPromptGrain,
    value: string
  ) => {
    setSummarizationPrompts((prev) => ({
      ...prev,
      [grain]: value,
    }));
  };

  const handleResetSummarizationPrompt = (grain: SummarizationPromptGrain) => {
    setSummarizationPrompts((prev) => ({
      ...prev,
      [grain]: DEFAULT_SUMMARIZATION_PROMPTS[grain],
    }));
  };

  const handleSaveSummarizationPrompts = async () => {
    try {
      const payload: SummarizationPromptsInput = {};
      for (const grain of SUMMARIZATION_PROMPT_GRAINS) {
        const value = summarizationPrompts[grain]?.trim() ?? "";
        const defaultValue = DEFAULT_SUMMARIZATION_PROMPTS[grain].trim();
        payload[grain] = value && value !== defaultValue ? value : null;
      }

      const updated = await updateAgent.mutateAsync({
        summarizationPrompts: payload,
      });
      prevSummarizationPromptsRef.current = updated.summarizationPrompts;
      setSummarizationPrompts(
        getEffectiveSummarizationPrompts(updated.summarizationPrompts)
      );
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const handleSaveSearchDocuments = async () => {
    try {
      const valueToSave = enableSearchDocuments;
      // Update ref immediately to prevent useEffect from overwriting our changes
      prevEnableSearchDocumentsRef.current = valueToSave;
      const updated = await updateAgent.mutateAsync({
        enableSearchDocuments: valueToSave,
      });
      // Sync local state with updated agent data
      const savedValue = updated.enableSearchDocuments ?? false;
      prevEnableSearchDocumentsRef.current = savedValue;
      setEnableSearchDocuments(savedValue);
    } catch {
      // Error is handled by toast in the hook
      // Reset ref on error so useEffect can sync properly
      prevEnableSearchDocumentsRef.current = agent?.enableSearchDocuments;
    }
  };

  const handleSaveKnowledgeInjection = async () => {
    try {
      const trimmedEntityModel =
        knowledgeInjectionEntityExtractorModel?.trim() || null;
      const updated = await updateAgent.mutateAsync({
        enableKnowledgeInjection,
        enableKnowledgeInjectionFromMemories: enableKnowledgeInjection
          ? enableKnowledgeInjectionFromMemories
          : false,
        enableKnowledgeInjectionFromDocuments: enableKnowledgeInjection
          ? enableKnowledgeInjectionFromDocuments
          : false,
        knowledgeInjectionSnippetCount: enableKnowledgeInjection
          ? Math.max(1, Math.min(50, knowledgeInjectionSnippetCount))
          : undefined,
        knowledgeInjectionMinSimilarity: enableKnowledgeInjection
          ? Math.max(0, Math.min(1, knowledgeInjectionMinSimilarity))
          : undefined,
        knowledgeInjectionEntityExtractorModel:
          enableKnowledgeInjection && enableKnowledgeInjectionFromMemories
            ? trimmedEntityModel
            : null,
        enableKnowledgeReranking: enableKnowledgeInjection
          ? enableKnowledgeReranking
          : false,
        knowledgeRerankingModel:
          enableKnowledgeInjection && enableKnowledgeReranking
            ? knowledgeRerankingModel
            : null,
      });
      // Sync local state with updated agent data
      setEnableKnowledgeInjection(updated.enableKnowledgeInjection ?? false);
      setEnableKnowledgeInjectionFromMemories(
        updated.enableKnowledgeInjectionFromMemories ?? false
      );
      setEnableKnowledgeInjectionFromDocuments(
        updated.enableKnowledgeInjectionFromDocuments ?? true
      );
      setKnowledgeInjectionSnippetCount(
        updated.knowledgeInjectionSnippetCount ?? DEFAULT_KNOWLEDGE_SNIPPET_COUNT
      );
      setKnowledgeInjectionMinSimilarity(
        updated.knowledgeInjectionMinSimilarity ??
          DEFAULT_KNOWLEDGE_MIN_SIMILARITY
      );
      setKnowledgeInjectionEntityExtractorModel(
        updated.knowledgeInjectionEntityExtractorModel ?? null
      );
      setEnableKnowledgeReranking(updated.enableKnowledgeReranking ?? false);
      setKnowledgeRerankingModel(updated.knowledgeRerankingModel || null);
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const handleSaveSendEmail = async () => {
    try {
      const valueToSave = enableSendEmail;
      // Update ref immediately to prevent useEffect from overwriting our changes
      prevEnableSendEmailRef.current = valueToSave;
      const updated = await updateAgent.mutateAsync({
        enableSendEmail: valueToSave,
      });
      // Sync local state with updated agent data
      const savedValue = updated.enableSendEmail ?? false;
      prevEnableSendEmailRef.current = savedValue;
      setEnableSendEmail(savedValue);
    } catch {
      // Error is handled by toast in the hook
      // Reset ref on error so useEffect can sync properly
      prevEnableSendEmailRef.current = agent?.enableSendEmail;
    }
  };

  const handleSaveSearchWebProvider = async () => {
    try {
      const valueToSave = searchWebProvider;
      // Update ref immediately to prevent useEffect from overwriting our changes
      prevSearchWebProviderRef.current = valueToSave;
      const updated = await updateAgent.mutateAsync({
        searchWebProvider: valueToSave,
      });
      // Sync local state with updated agent data
      const savedValue = updated.searchWebProvider ?? null;
      prevSearchWebProviderRef.current = savedValue;
      setSearchWebProvider(savedValue);
    } catch {
      // Error is handled by toast in the hook
      // Reset ref on error so useEffect can sync properly
      prevSearchWebProviderRef.current =
        agent?.searchWebProvider ??
        (agent?.enableTavilySearch === true ? "tavily" : null);
    }
  };

  const handleSaveFetchWebProvider = async () => {
    try {
      const valueToSave = fetchWebProvider;
      // Update ref immediately to prevent useEffect from overwriting our changes
      prevFetchWebProviderRef.current = valueToSave;
      const updated = await updateAgent.mutateAsync({
        fetchWebProvider: valueToSave,
      });
      // Sync local state with updated agent data
      const savedValue = updated.fetchWebProvider ?? null;
      prevFetchWebProviderRef.current = savedValue;
      setFetchWebProvider(savedValue);
    } catch {
      // Error is handled by toast in the hook
      // Reset ref on error so useEffect can sync properly
      prevFetchWebProviderRef.current = agent?.fetchWebProvider;
    }
  };

  const handleSaveExaSearch = async () => {
    try {
      const valueToSave = enableExaSearch;
      // Update ref immediately to prevent useEffect from overwriting our changes
      prevEnableExaSearchRef.current = valueToSave;
      const updated = await updateAgent.mutateAsync({
        enableExaSearch: valueToSave,
      });
      // Sync local state with updated agent data
      const savedValue = updated.enableExaSearch ?? false;
      prevEnableExaSearchRef.current = savedValue;
      setEnableExaSearch(savedValue);
    } catch {
      // Error is handled by toast in the hook
      // Reset ref on error so useEffect can sync properly
      prevEnableExaSearchRef.current = agent?.enableExaSearch;
    }
  };

  const handleSaveImageGeneration = async () => {
    try {
      const trimmedModel =
        imageGenerationModelInputRef.current?.trim() ||
        imageGenerationModel?.trim() ||
        imageModels[0]?.trim() ||
        null;
      if (enableImageGeneration && !trimmedModel) {
        toast.error("Please select an image model before saving.");
        return;
      }
      // Update refs immediately to prevent useEffect from overwriting changes
      prevEnableImageGenerationRef.current = enableImageGeneration;
      prevImageGenerationModelRef.current = trimmedModel;
      const updated = await updateAgent.mutateAsync({
        enableImageGeneration,
        imageGenerationModel: trimmedModel,
      });
      // Sync local state with updated agent data
      const savedEnable = updated.enableImageGeneration ?? false;
      const savedModel = updated.imageGenerationModel ?? null;
      prevEnableImageGenerationRef.current = savedEnable;
      prevImageGenerationModelRef.current = savedModel;
      setEnableImageGeneration(savedEnable);
      setImageGenerationModel(savedModel);
    } catch {
      // Error is handled by toast in the hook
      // Reset refs on error so useEffect can sync properly
      prevEnableImageGenerationRef.current = agent?.enableImageGeneration;
      prevImageGenerationModelRef.current = agent?.imageGenerationModel;
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

  const handleSaveWidgetConfig = async () => {
    try {
      const updated = await updateAgent.mutateAsync({
        widgetConfig: widgetConfig.enabled ? widgetConfig : null,
      });
      // Sync local state with updated agent data
      if (updated.widgetConfig) {
        setWidgetConfig(updated.widgetConfig);
      } else {
        setWidgetConfig({ ...DEFAULT_WIDGET_CONFIG });
      }
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

  const handleSaveModelName = async () => {
    try {
      const updated = await updateAgent.mutateAsync({
        modelName: modelName || null,
      });
      const updatedModelName = updated.modelName || null;
      setModelName(updatedModelName);
      prevModelNameRef.current = updatedModelName;
    } catch {
      // Error handled by toast
    }
  };

  const selectedModelName = modelName || defaultModel;
  const selectedModelCapabilities = getModelCapabilities(
    modelCapabilities,
    selectedModelName
  );
  const modelCapabilityLabels = getCapabilityLabels(selectedModelCapabilities);
  const isToolCallingSupported = selectedModelCapabilities?.tool_calling === true;
  const rerankingCapabilityLabels = getCapabilityLabels(
    getModelCapabilities(modelCapabilities, knowledgeRerankingModel)
  );

  return {
    agent,
    keys,
    workspaceId,
    agentId,
    navigate,
    createKey,
    updateAgent,
    allAgents,
    mcpServersData,
    mcpServerToolsById,
    isLoadingMcpServerTools,
    emailConnection,
    streamServerConfig,
    createStreamServer,
    updateStreamServer,
    deleteStreamServer,
    streamUrlData,
    isEditing,
    setIsEditing,
    isDeleting,
    setIsDeleting,
    isCreatingKey,
    setIsCreatingKey,
    newKeyName,
    setNewKeyName,
    newlyCreatedKey,
    setNewlyCreatedKey,
    isConfiguringStreamServer,
    setIsConfiguringStreamServer,
    allowedOrigins,
    setAllowedOrigins,
    isStreamTestModalOpen,
    setIsStreamTestModalOpen,
    isModelPricesOpen,
    setIsModelPricesOpen,
    isImprovePromptOpen,
    setIsImprovePromptOpen,
    modelPricesFilter,
    setModelPricesFilter,
    selectedConversationId,
    setSelectedConversationId,
    showScrollIndicator,
    setShowScrollIndicator,
    isHelpOpen,
    setIsHelpOpen,
    showSlackModal,
    setShowSlackModal,
    showDiscordModal,
    setShowDiscordModal,
    commandDialogState,
    setCommandDialogState,
    systemPromptRef,
    expandedSection,
    toggleSection,
    chatClearKey,
    setChatClearKey,
    queryClient,
    agentIntegrations,
    canEdit,
    showMcpServersWarning,
    handleMcpWarningClick,
    setIsMcpWarningDismissed,
    delegatableAgentIds,
    enabledMcpServerIds,
    enabledMcpServerToolNames,
    enableMemorySearch,
    setEnableMemorySearch,
    summarizationPrompts,
    memoryExtractionEnabled,
    setMemoryExtractionEnabled,
    memoryExtractionModel,
    setMemoryExtractionModel,
    memoryExtractionPrompt,
    setMemoryExtractionPrompt,
    enableSearchDocuments,
    setEnableSearchDocuments,
    enableSendEmail,
    setEnableSendEmail,
    searchWebProvider,
    setSearchWebProvider,
    fetchWebProvider,
    setFetchWebProvider,
    enableExaSearch,
    setEnableExaSearch,
    enableKnowledgeInjection,
    setEnableKnowledgeInjection,
    enableKnowledgeInjectionFromMemories,
    setEnableKnowledgeInjectionFromMemories,
    enableKnowledgeInjectionFromDocuments,
    setEnableKnowledgeInjectionFromDocuments,
    knowledgeInjectionSnippetCount,
    setKnowledgeInjectionSnippetCount,
    knowledgeInjectionMinSimilarity,
    setKnowledgeInjectionMinSimilarity,
    knowledgeInjectionEntityExtractorModel,
    setKnowledgeInjectionEntityExtractorModel,
    enableKnowledgeReranking,
    setEnableKnowledgeReranking,
    knowledgeRerankingModel,
    setKnowledgeRerankingModel,
    rerankingModels,
    isLoadingRerankingModels,
    enableImageGeneration,
    setEnableImageGeneration,
    imageGenerationModel,
    setImageGenerationModel,
    imageModels,
    isLoadingImageModels,
    imageModelLoadError,
    imageGenerationModelInputRef,
    isImageModelUnavailable,
    rerankingCapabilityLabels,
    clientTools,
    setClientTools,
    widgetConfig,
    setWidgetConfig,
    widgetCustomization,
    setWidgetCustomization,
    widgetPreviewSettings,
    normalizedPreviewSettings,
    previewFontFamilyValue,
    updateWidgetPreviewSettings,
    provider,
    modelName,
    setModelName,
    availableModels,
    defaultModel,
    isLoadingModels,
    modelLoadError,
    modelCapabilityLabels,
    isToolCallingSupported,
    temperature,
    setTemperature,
    topP,
    setTopP,
    topK,
    setTopK,
    maxOutputTokens,
    setMaxOutputTokens,
    stopSequences,
    setStopSequences,
    maxToolRoundtrips,
    setMaxToolRoundtrips,
    handleDeleteIntegration,
    handleUpdateIntegration,
    handleInstallCommand,
    handleCommandDialogSuccess,
    handleEdit,
    handleCloseModal,
    handleDelete,
    handleCreateKey,
    getWebhookUrl,
    getStreamUrl,
    handleCreateStreamServer,
    handleUpdateStreamServer,
    handleDeleteStreamServer,
    handleDelegationToggle,
    handleSaveDelegation,
    handleMcpServerToggle,
    handleMcpServerToolToggle,
    handleSaveMcpServers,
    getMcpServerToolsForServer,
    handleSaveMemorySearch,
    handleSaveMemoryExtraction,
    handleSummarizationPromptChange,
    handleResetSummarizationPrompt,
    handleSaveSummarizationPrompts,
    handleSaveSearchDocuments,
    handleSaveKnowledgeInjection,
    handleSaveSendEmail,
    handleSaveSearchWebProvider,
    handleSaveFetchWebProvider,
    handleSaveExaSearch,
    handleSaveClientTools,
    handleSaveImageGeneration,
    handleSaveWidgetConfig,
    handleSaveModelName,
    handleSaveAdvanced,
    handleResetAdvanced,
  };
}

/*
interface AgentHeaderCardProps {
  agent: NonNullable<AgentDetailContentProps["agent"]>;
  canEdit: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onBack: () => void;
  systemPromptRef: React.RefObject<HTMLDivElement | null>;
  showScrollIndicator: boolean;
  setShowScrollIndicator: (value: boolean) => void;
}

const AgentHeaderCard: FC<AgentHeaderCardProps> = ({
  agent,
  canEdit,
  isEditing,
  onEdit,
  onBack,
  systemPromptRef,
  showScrollIndicator,
  setShowScrollIndicator,
}) => {
  return (
    <div className="mb-8 rounded-xl border border-neutral-200 bg-white p-8 shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={onBack}
          className="rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
        >
          ← Back to workspace
        </button>
        {canEdit && !isEditing && (
          <button
            onClick={onEdit}
            className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored"
          >
            Edit settings
          </button>
        )}
      </div>
      <p className="mb-4 text-sm opacity-75 dark:text-neutral-300">
        Set how this assistant behaves, its instructions, and spending limits.
        Use the sections below to test it, view conversations, and check usage.
      </p>

      <div>
        <div className="mb-4 flex items-center gap-4">
          <img
            src={agent.avatar || getDefaultAvatar()}
            alt={`${agent.name} avatar`}
            className="size-16 rounded-lg border-2 border-neutral-300 object-contain dark:border-neutral-700"
          />
          <h1 className="text-4xl font-bold dark:text-neutral-50">
            {agent.name}
          </h1>
        </div>
        <p className="mb-4 text-sm opacity-75 dark:text-neutral-300">
          Created: {new Date(agent.createdAt).toLocaleString()}
          {agent.updatedAt &&
            ` • Updated: ${new Date(agent.updatedAt).toLocaleString()}`}
        </p>
        <div className="mb-4 rounded-lg border-2 border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
          <h3 className="mb-2 text-lg font-semibold dark:text-neutral-50">
            System Prompt
          </h3>
          <div
            ref={systemPromptRef}
            onScroll={(e) => {
              const element = e.currentTarget;
              const isAtBottom =
                element.scrollHeight - element.scrollTop <=
                element.clientHeight + 10;
              setShowScrollIndicator(!isAtBottom);
            }}
            className="relative max-h-64 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <Suspense fallback={<LoadingScreen compact />}>
                <LazyMarkdownRenderer
                  components={{
                    // Code blocks
                    code: ({ children }) => (
                      <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-sm dark:bg-neutral-800">
                        {children}
                      </code>
                    ),
                    pre: ({ children }) => (
                      <pre className="overflow-x-auto rounded-lg bg-neutral-100 p-4 dark:bg-neutral-800">
                        {children}
                      </pre>
                    ),
                    // Lists
                    ul: ({ children }) => (
                      <ul className="list-disc space-y-1 pl-6">{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="list-decimal space-y-1 pl-6">
                        {children}
                      </ol>
                    ),
                    // Blockquotes
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-4 border-neutral-300 pl-4 italic text-neutral-600 dark:border-neutral-600 dark:text-neutral-400">
                        {children}
                      </blockquote>
                    ),
                    // Links
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {children}
                      </a>
                    ),
                    // Headers
                    h1: ({ children }) => (
                      <h1 className="text-2xl font-bold">{children}</h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="text-xl font-semibold">{children}</h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="text-lg font-semibold">{children}</h3>
                    ),
                    h4: ({ children }) => (
                      <h4 className="text-base font-semibold">{children}</h4>
                    ),
                    h5: ({ children }) => (
                      <h5 className="text-sm font-semibold">{children}</h5>
                    ),
                    h6: ({ children }) => (
                      <h6 className="text-xs font-semibold">{children}</h6>
                    ),
                    // Paragraphs
                    p: ({ children }) => <p className="mb-2">{children}</p>,
                    // Horizontal rule
                    hr: () => (
                      <hr className="my-4 border-t border-neutral-300" />
                    ),
                    // Tables
                    table: ({ children }) => (
                      <div className="my-2 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
                        <table className="min-w-full border-collapse">
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
                      <th className="border-r border-neutral-200 p-2 text-left font-semibold last:border-r-0 dark:border-neutral-700 dark:text-neutral-50">
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="border-r border-neutral-200 p-2 last:border-r-0 dark:border-neutral-700 dark:text-neutral-200">
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
              <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-lg border-t border-neutral-200 bg-neutral-50 px-4 py-1.5 dark:border-neutral-700 dark:bg-neutral-800">
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
  );
};

*/
interface AgentDetailModalsProps {
  workspaceId: string;
  agentId: string;
  agent: NonNullable<AgentDetailContentProps["agent"]>;
  isEditing: boolean;
  onCloseEdit: () => void;
  selectedConversationId: string | null;
  onCloseConversation: () => void;
  isHelpOpen: boolean;
  onCloseHelp: () => void;
  isImprovePromptOpen: boolean;
  onCloseImprovePrompt: () => void;
  isModelPricesOpen: boolean;
  onCloseModelPrices: () => void;
  modelPricesFilter?: keyof ModelCapabilities;
  isStreamTestModalOpen: boolean;
  onCloseStreamTestModal: () => void;
  streamServerConfig: ReturnType<typeof useStreamServer>["data"];
  streamUrlData: ReturnType<typeof useStreamUrl>["data"];
  showSlackModal: boolean;
  onCloseSlackModal: () => void;
  onSlackSuccess: () => void;
  showDiscordModal: boolean;
  onCloseDiscordModal: () => void;
  onDiscordSuccess: () => void;
  commandDialogState: {
    integrationId: string;
    currentCommandName?: string;
  } | null;
  onCloseCommandDialog: () => void;
  onCommandDialogSuccess: () => void;
}

const AgentDetailModals: FC<AgentDetailModalsProps> = ({
  workspaceId,
  agentId,
  agent,
  isEditing,
  onCloseEdit,
  selectedConversationId,
  onCloseConversation,
  isHelpOpen,
  onCloseHelp,
  isImprovePromptOpen,
  onCloseImprovePrompt,
  isModelPricesOpen,
  onCloseModelPrices,
  modelPricesFilter,
  isStreamTestModalOpen,
  onCloseStreamTestModal,
  streamServerConfig,
  streamUrlData,
  showSlackModal,
  onCloseSlackModal,
  onSlackSuccess,
  showDiscordModal,
  onCloseDiscordModal,
  onDiscordSuccess,
  commandDialogState,
  onCloseCommandDialog,
  onCommandDialogSuccess,
}) => {
  return (
    <>
      {isEditing && (
        <Suspense fallback={<LoadingScreen />}>
          <AgentModal
            isOpen={isEditing}
            onClose={onCloseEdit}
            workspaceId={workspaceId}
            agent={agent}
          />
        </Suspense>
      )}

      {selectedConversationId && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
              <div className="rounded-xl border border-neutral-200 bg-white p-8 shadow-xl dark:border-neutral-700">
                <div className="text-2xl font-semibold">
                  Loading conversation...
                </div>
              </div>
            </div>
          }
        >
          <QueryPanel
            fallback={
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
                <div className="rounded-xl border border-neutral-200 bg-white p-8 shadow-xl dark:border-neutral-700">
                  <div className="text-2xl font-semibold">
                    Loading conversation...
                  </div>
                </div>
              </div>
            }
          >
            <ConversationDetailModal
              isOpen={!!selectedConversationId}
              onClose={onCloseConversation}
              workspaceId={workspaceId}
              agentId={agentId}
              conversationId={selectedConversationId}
            />
          </QueryPanel>
        </Suspense>
      )}

      {isHelpOpen && (
        <Suspense fallback={<LoadingScreen />}>
          <ToolsHelpDialog
            isOpen={isHelpOpen}
            onClose={onCloseHelp}
            workspaceId={workspaceId}
            agent={agent}
          />
        </Suspense>
      )}

      {isImprovePromptOpen && (
        <Suspense fallback={<LoadingScreen />}>
          <ImproveAgentPromptDialog
            isOpen={isImprovePromptOpen}
            onClose={onCloseImprovePrompt}
            workspaceId={workspaceId}
            agentId={agentId}
          />
        </Suspense>
      )}

      {isModelPricesOpen && (
        <Suspense fallback={<LoadingScreen />}>
          <ModelPricesDialog
            isOpen={isModelPricesOpen}
            onClose={onCloseModelPrices}
            capabilityFilter={modelPricesFilter}
          />
        </Suspense>
      )}

      {isStreamTestModalOpen &&
        streamServerConfig &&
        streamUrlData?.url &&
        streamServerConfig.secret && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
            <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-neutral-200 bg-white p-6 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
              <div className="mb-4 flex items-center justify-between border-b border-neutral-200 pb-4 dark:border-neutral-700">
                <h2 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
                  Test Stream Server
                </h2>
                <button
                  onClick={onCloseStreamTestModal}
                  className="rounded-xl border-2 border-neutral-300 bg-white px-4 py-2 font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50 dark:hover:bg-neutral-800"
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

      {showSlackModal && (
        <Suspense fallback={<LoadingScreen />}>
          <SlackConnectModal
            workspaceId={workspaceId}
            agentId={agentId}
            onClose={onCloseSlackModal}
            onSuccess={onSlackSuccess}
          />
        </Suspense>
      )}

      {showDiscordModal && (
        <Suspense fallback={<LoadingScreen />}>
          <DiscordConnectModal
            workspaceId={workspaceId}
            agentId={agentId}
            onClose={onCloseDiscordModal}
            onSuccess={onDiscordSuccess}
          />
        </Suspense>
      )}

      {commandDialogState && (
        <Suspense fallback={<LoadingScreen />}>
          <DiscordCommandDialog
            workspaceId={workspaceId}
            integrationId={commandDialogState.integrationId}
            currentCommandName={commandDialogState.currentCommandName}
            onClose={onCloseCommandDialog}
            onSuccess={onCommandDialogSuccess}
          />
        </Suspense>
      )}
    </>
  );
};

interface AgentOverviewCardProps {
  agent: NonNullable<AgentDetailContentProps["agent"]>;
  canEdit: boolean;
  isEditing: boolean;
  isLoadingModels: boolean;
  modelName: string | null;
  defaultModel: string;
  availableModels: string[];
  modelLoadError: string | null;
  capabilityLabels: string[];
  isToolCallingSupported: boolean;
  isSavingModel: boolean;
  onSaveModelName: () => void;
  onOpenModelPrices: () => void;
  onOpenToolsHelp: () => void;
  onEdit: () => void;
  onBack: () => void;
  showMcpServersWarning: boolean;
  onMcpWarningClick: () => void;
  onMcpWarningDismiss: () => void;
  systemPromptRef: React.RefObject<HTMLDivElement | null>;
  showScrollIndicator: boolean;
  setShowScrollIndicator: (value: boolean) => void;
  setModelName: (value: string | null) => void;
}

const AgentOverviewCard: FC<AgentOverviewCardProps> = ({
  agent,
  canEdit,
  isEditing,
  isLoadingModels,
  modelName,
  defaultModel,
  availableModels,
  modelLoadError,
  capabilityLabels,
  isToolCallingSupported,
  isSavingModel,
  onSaveModelName,
  onOpenModelPrices,
  onOpenToolsHelp,
  onEdit,
  onBack,
  showMcpServersWarning,
  onMcpWarningClick,
  onMcpWarningDismiss,
  systemPromptRef,
  showScrollIndicator,
  setShowScrollIndicator,
  setModelName,
}) => (
  <div className="mb-8 rounded-xl border border-neutral-200 bg-white p-8 shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
    <div className="mb-4 flex items-center justify-between">
      <button
        onClick={onBack}
        className="rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
      >
        ← Back to workspace
      </button>
      {canEdit && !isEditing && (
        <button
          onClick={onEdit}
          className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored"
        >
          Edit settings
        </button>
      )}
    </div>
    <p className="mb-4 text-sm opacity-75 dark:text-neutral-300">
      Set how this assistant behaves, its instructions, and spending limits. Use
      the sections below to test it, view conversations, and check usage.
    </p>
    {showMcpServersWarning && (
      <div className="mb-4 rounded-lg border-2 border-yellow-400 bg-yellow-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-yellow-900">
            <ExclamationTriangleIcon className="size-4" />
            Connected Tools Not Enabled
          </p>
          <button
            type="button"
            onClick={onMcpWarningDismiss}
            className="text-xs font-semibold text-yellow-900 underline decoration-2 underline-offset-4 transition-colors hover:text-yellow-800"
          >
            Dismiss
          </button>
        </div>
        <p className="mt-1 text-sm text-yellow-800">
          This workspace has connected tools, but none are enabled for this
          agent.
        </p>
        <button
          type="button"
          onClick={onMcpWarningClick}
          className="mt-2 text-sm font-semibold text-yellow-900 underline decoration-2 underline-offset-4 transition-colors hover:text-yellow-800"
        >
          Go to Connected Tools
        </button>
      </div>
    )}

    <div>
      <div className="mb-4 flex items-center gap-4">
        <img
          src={agent.avatar || getDefaultAvatar()}
          alt={`${agent.name} avatar`}
          className="size-16 rounded-lg border-2 border-neutral-300 object-contain dark:border-neutral-700"
        />
        <h1 className="text-4xl font-bold dark:text-neutral-50">
          {agent.name}
        </h1>
      </div>
      <p className="mb-4 text-sm opacity-75 dark:text-neutral-300">
        Created: {new Date(agent.createdAt).toLocaleString()}
        {agent.updatedAt &&
          ` • Updated: ${new Date(agent.updatedAt).toLocaleString()}`}
      </p>
      <div className="mb-4">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-sm font-semibold dark:text-neutral-300">
              AI provider:{" "}
            </span>
            <span className="text-sm dark:text-neutral-300">Google</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold dark:text-neutral-300">
                Model:{" "}
              </span>
              <span className="text-sm dark:text-neutral-300">
                {isEditing ? (
                  <>
                    <select
                      disabled={isLoadingModels}
                      value={isLoadingModels ? "" : modelName || defaultModel}
                      onChange={(e) => {
                        const selectedModel = e.target.value;
                        setModelName(
                          selectedModel === defaultModel ? null : selectedModel
                        );
                      }}
                      className="ml-2 rounded-xl border-2 border-neutral-300 bg-white px-3 py-1.5 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
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
                      <span className="ml-2 text-xs text-red-600 dark:text-red-400">
                        {modelLoadError}
                      </span>
                    )}
                  </>
                ) : (
                  agent.modelName || defaultModel
                )}
              </span>
              <button
                type="button"
                onClick={onOpenModelPrices}
                className="rounded-lg border-2 border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
              >
                See model prices
              </button>
            </div>
          </div>
          {isEditing && (
            <button
              type="button"
              onClick={onSaveModelName}
              disabled={isSavingModel}
              className="rounded-lg bg-gradient-primary px-3 py-1.5 text-xs font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:opacity-50"
            >
              {isSavingModel ? "Saving..." : "Save"}
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          The provider is the company that runs the model. The model is the
          specific AI engine your assistant uses.
        </p>
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          {capabilityLabels.length > 0
            ? `Capabilities: ${capabilityLabels.join(", ")}`
            : "Capabilities: unavailable"}
        </p>
        {!isToolCallingSupported && (
          <div className="mt-3 rounded-lg border-2 border-yellow-400 bg-yellow-50 p-3">
            <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-yellow-900">
              <ExclamationTriangleIcon className="size-4" />
              Tool calling unavailable
            </p>
            <p className="text-sm text-yellow-900">
              This model does not support tool calling. Built-in tools,
              connected tool integrations, and client tools will be disabled.
            </p>
          </div>
        )}
      </div>
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold dark:text-neutral-300">
            Agent instructions:
          </p>
          <button
            type="button"
            onClick={onOpenToolsHelp}
            className="rounded-xl border-2 border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold transition-all duration-200 hover:bg-neutral-50 dark:bg-neutral-800"
          >
            Tools this assistant can use
          </button>
        </div>
        <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
          This is the main guidance the assistant follows for every
          conversation.
        </p>
        <div className="relative rounded-lg border border-neutral-200 dark:border-neutral-700">
          <div
            ref={systemPromptRef}
            onScroll={(e) => {
              const element = e.currentTarget;
              const isAtBottom =
                element.scrollHeight - element.scrollTop <=
                element.clientHeight + 10;
              setShowScrollIndicator(!isAtBottom);
            }}
            className="max-h-[400px] overflow-y-auto rounded-lg bg-neutral-50 p-4 text-sm dark:bg-neutral-800"
          >
            <Suspense
              fallback={<LoadingScreen compact message="Loading markdown..." />}
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
                          className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-800"
                          {...rest}
                        >
                          {children}
                        </code>
                      );
                    }
                    return (
                      <code
                        className="block overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 p-4 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-800"
                        {...rest}
                      >
                        {children}
                      </code>
                    );
                  },
                  // Lists
                  ul: ({ children }) => (
                    <ul className="list-disc space-y-1 pl-6">{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal space-y-1 pl-6">{children}</ol>
                  ),
                  // Blockquotes
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-4 border-neutral-300 pl-4 italic text-neutral-600 dark:border-neutral-600 dark:text-neutral-400">
                      {children}
                    </blockquote>
                  ),
                  // Links
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {children}
                    </a>
                  ),
                  // Headers
                  h1: ({ children }) => (
                    <h1 className="text-2xl font-bold">{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-xl font-semibold">{children}</h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-lg font-semibold">{children}</h3>
                  ),
                  h4: ({ children }) => (
                    <h4 className="text-base font-semibold">{children}</h4>
                  ),
                  h5: ({ children }) => (
                    <h5 className="text-sm font-semibold">{children}</h5>
                  ),
                  h6: ({ children }) => (
                    <h6 className="text-xs font-semibold">{children}</h6>
                  ),
                  // Paragraphs
                  p: ({ children }) => <p className="mb-2">{children}</p>,
                  // Horizontal rule
                  hr: () => <hr className="my-4 border-t border-neutral-300" />,
                  // Tables
                  table: ({ children }) => (
                    <div className="my-2 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
                      <table className="min-w-full border-collapse">
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
                    <th className="border-r border-neutral-200 p-2 text-left font-semibold last:border-r-0 dark:border-neutral-700 dark:text-neutral-50">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="border-r border-neutral-200 p-2 last:border-r-0 dark:border-neutral-700 dark:text-neutral-200">
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
            <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-lg border-t border-neutral-200 bg-neutral-50 px-4 py-1.5 dark:border-neutral-700 dark:bg-neutral-800">
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
);

const AgentDetailContent: FC<AgentDetailContentProps> = (props) => {
  const {
    agent,
    keys,
    workspaceId,
    agentId,
    navigate,
    createKey,
    updateAgent,
    allAgents,
    mcpServersData,
    emailConnection,
    streamServerConfig,
    createStreamServer,
    updateStreamServer,
    deleteStreamServer,
    streamUrlData,
    isEditing,
    setIsEditing,
    isDeleting,
    isCreatingKey,
    setIsCreatingKey,
    newKeyName,
    setNewKeyName,
    newlyCreatedKey,
    isConfiguringStreamServer,
    setIsConfiguringStreamServer,
    allowedOrigins,
    setAllowedOrigins,
    isStreamTestModalOpen,
    setIsStreamTestModalOpen,
    isModelPricesOpen,
    setIsModelPricesOpen,
    isImprovePromptOpen,
    setIsImprovePromptOpen,
    modelPricesFilter,
    setModelPricesFilter,
    selectedConversationId,
    setSelectedConversationId,
    showScrollIndicator,
    setShowScrollIndicator,
    isHelpOpen,
    setIsHelpOpen,
    showSlackModal,
    setShowSlackModal,
    showDiscordModal,
    setShowDiscordModal,
    commandDialogState,
    setCommandDialogState,
    systemPromptRef,
    expandedSection,
    toggleSection,
    chatClearKey,
    setChatClearKey,
    queryClient,
    agentIntegrations,
    canEdit,
    showMcpServersWarning,
    handleMcpWarningClick,
    setIsMcpWarningDismissed,
    delegatableAgentIds,
    enabledMcpServerIds,
    enabledMcpServerToolNames,
    isLoadingMcpServerTools,
    enableMemorySearch,
    setEnableMemorySearch,
    summarizationPrompts,
    memoryExtractionEnabled,
    setMemoryExtractionEnabled,
    memoryExtractionModel,
    setMemoryExtractionModel,
    memoryExtractionPrompt,
    setMemoryExtractionPrompt,
    enableSearchDocuments,
    setEnableSearchDocuments,
    enableSendEmail,
    setEnableSendEmail,
    searchWebProvider,
    setSearchWebProvider,
    fetchWebProvider,
    setFetchWebProvider,
    enableExaSearch,
    setEnableExaSearch,
    enableKnowledgeInjection,
    setEnableKnowledgeInjection,
    enableKnowledgeInjectionFromMemories,
    setEnableKnowledgeInjectionFromMemories,
    enableKnowledgeInjectionFromDocuments,
    setEnableKnowledgeInjectionFromDocuments,
    knowledgeInjectionSnippetCount,
    setKnowledgeInjectionSnippetCount,
    knowledgeInjectionMinSimilarity,
    setKnowledgeInjectionMinSimilarity,
    knowledgeInjectionEntityExtractorModel,
    setKnowledgeInjectionEntityExtractorModel,
    enableKnowledgeReranking,
    setEnableKnowledgeReranking,
    knowledgeRerankingModel,
    setKnowledgeRerankingModel,
    rerankingModels,
    isLoadingRerankingModels,
    enableImageGeneration,
    setEnableImageGeneration,
    imageGenerationModel,
    setImageGenerationModel,
    imageModels,
    isLoadingImageModels,
    imageModelLoadError,
    imageGenerationModelInputRef,
    isImageModelUnavailable,
    rerankingCapabilityLabels,
    clientTools,
    setClientTools,
    widgetConfig,
    setWidgetConfig,
    widgetCustomization,
    setWidgetCustomization,
    widgetPreviewSettings,
    normalizedPreviewSettings,
    previewFontFamilyValue,
    updateWidgetPreviewSettings,
    modelName,
    setModelName,
    availableModels,
    defaultModel,
    isLoadingModels,
    modelLoadError,
    modelCapabilityLabels,
    isToolCallingSupported,
    temperature,
    setTemperature,
    topP,
    setTopP,
    topK,
    setTopK,
    maxOutputTokens,
    setMaxOutputTokens,
    stopSequences,
    setStopSequences,
    maxToolRoundtrips,
    setMaxToolRoundtrips,
    handleDeleteIntegration,
    handleUpdateIntegration,
    handleInstallCommand,
    handleCommandDialogSuccess,
    handleEdit,
    handleCloseModal,
    handleDelete,
    handleCreateKey,
    getWebhookUrl,
    getStreamUrl,
    handleCreateStreamServer,
    handleUpdateStreamServer,
    handleDeleteStreamServer,
    handleDelegationToggle,
    handleSaveDelegation,
    handleMcpServerToggle,
    handleMcpServerToolToggle,
    handleSaveMcpServers,
    getMcpServerToolsForServer,
    handleSaveMemorySearch,
    handleSaveMemoryExtraction,
    handleSummarizationPromptChange,
    handleResetSummarizationPrompt,
    handleSaveSummarizationPrompts,
    handleSaveSearchDocuments,
    handleSaveKnowledgeInjection,
    handleSaveSendEmail,
    handleSaveSearchWebProvider,
    handleSaveFetchWebProvider,
    handleSaveExaSearch,
    handleSaveClientTools,
    handleSaveImageGeneration,
    handleSaveWidgetConfig,
    handleSaveModelName,
    handleSaveAdvanced,
    handleResetAdvanced,
  } = useAgentDetailState(props);

  return (
    <div className="min-h-screen bg-white p-8 dark:bg-neutral-950">
      <div className="mx-auto max-w-4xl">
        <AgentOverviewCard
          agent={agent}
          canEdit={canEdit}
          isEditing={isEditing}
          isLoadingModels={isLoadingModels}
          modelName={modelName}
          defaultModel={defaultModel}
          availableModels={availableModels}
          modelLoadError={modelLoadError}
          capabilityLabels={modelCapabilityLabels}
          isToolCallingSupported={isToolCallingSupported}
          isSavingModel={updateAgent.isPending}
          onSaveModelName={handleSaveModelName}
          onOpenModelPrices={() => {
            setModelPricesFilter("text_generation");
            setIsModelPricesOpen(true);
          }}
          onOpenToolsHelp={() => setIsHelpOpen(true)}
          onEdit={handleEdit}
          onBack={() => navigate(`/workspaces/${workspaceId}`)}
          showMcpServersWarning={showMcpServersWarning}
          onMcpWarningClick={handleMcpWarningClick}
          onMcpWarningDismiss={() => setIsMcpWarningDismissed(true)}
          systemPromptRef={systemPromptRef}
          showScrollIndicator={showScrollIndicator}
          setShowScrollIndicator={setShowScrollIndicator}
          setModelName={setModelName}
        />

        <AgentSuggestions
          workspaceId={workspaceId}
          agentId={agentId}
          onGoToAction={(action) => {
            if ("openEdit" in action && action.openEdit) {
              setIsEditing(true);
            } else if ("sectionId" in action && action.sectionId) {
              if (expandedSection !== action.sectionId) {
                toggleSection(action.sectionId);
              }
              requestAnimationFrame(() => {
                setTimeout(() => {
                  document
                    .getElementById(action.sectionId)
                    ?.scrollIntoView({ behavior: "smooth" });
                }, 150);
              });
            }
          }}
        />

        {/*
        <div className="mb-8 rounded-xl border border-neutral-200 bg-white p-8 shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
          <div className="mb-4 flex items-center justify-between">
            <button
              onClick={() => navigate(`/workspaces/${workspaceId}`)}
              className="rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              ← Back to workspace
            </button>
            {canEdit && !isEditing && (
              <button
                onClick={handleEdit}
                className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored"
              >
                Edit settings
              </button>
            )}
          </div>
          <p className="mb-4 text-sm opacity-75 dark:text-neutral-300">
            Set how this assistant behaves, its instructions, and spending
            limits. Use the sections below to test it, view conversations, and
            check usage.
          </p>

          <div>
            <div className="mb-4 flex items-center gap-4">
              <img
                src={agent.avatar || getDefaultAvatar()}
                alt={`${agent.name} avatar`}
                className="size-16 rounded-lg border-2 border-neutral-300 object-contain dark:border-neutral-700"
              />
              <h1 className="text-4xl font-bold dark:text-neutral-50">
                {agent.name}
              </h1>
            </div>
            <p className="mb-4 text-sm opacity-75 dark:text-neutral-300">
              Created: {new Date(agent.createdAt).toLocaleString()}
              {agent.updatedAt &&
                ` • Updated: ${new Date(agent.updatedAt).toLocaleString()}`}
            </p>
            <div className="mb-4">
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-sm font-semibold dark:text-neutral-300">
                    AI provider:{" "}
                  </span>
                  <span className="text-sm dark:text-neutral-300">Google</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold dark:text-neutral-300">
                      Model:{" "}
                    </span>
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
                            className="ml-2 rounded-xl border-2 border-neutral-300 bg-white px-3 py-1.5 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
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
                            <span className="ml-2 text-xs text-red-600 dark:text-red-400">
                              {modelLoadError}
                            </span>
                          )}
                        </>
                      ) : (
                        agent.modelName || defaultModel
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsModelPricesOpen(true)}
                      className="rounded-lg border-2 border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
                    >
                      See model prices
                    </button>
                  </div>
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
                    className="rounded-lg bg-gradient-primary px-3 py-1.5 text-xs font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:opacity-50"
                  >
                    {updateAgent.isPending ? "Saving..." : "Save"}
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                The provider is the company that runs the model. The model is
                the specific AI engine your assistant uses.
              </p>
            </div>
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold dark:text-neutral-300">
                  Agent instructions:
                </p>
                <button
                  type="button"
                  onClick={() => setIsHelpOpen(true)}
                  className="rounded-xl border-2 border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold transition-all duration-200 hover:bg-neutral-50 dark:bg-neutral-800"
                >
                  Tools this assistant can use
                </button>
              </div>
              <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
                This is the main guidance the assistant follows for every
                conversation.
              </p>
              <div className="relative rounded-lg border border-neutral-200 dark:border-neutral-700">
                <div
                  ref={systemPromptRef}
                  className="max-h-[400px] overflow-y-auto rounded-lg bg-neutral-50 p-4 text-sm dark:bg-neutral-800"
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
                                className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-800"
                                {...rest}
                              >
                                {children}
                              </code>
                            );
                          }
                          return (
                            <code
                              className="block overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 p-4 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-800"
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
                          <h1 className="mb-2 mt-4 text-2xl font-semibold first:mt-0 dark:text-neutral-50">
                            {children}
                          </h1>
                        ),
                        h2: ({ children }) => (
                          <h2 className="mb-2 mt-4 text-xl font-semibold first:mt-0 dark:text-neutral-50">
                            {children}
                          </h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className="mb-2 mt-4 text-lg font-semibold first:mt-0 dark:text-neutral-50">
                            {children}
                          </h3>
                        ),
                        h4: ({ children }) => (
                          <h4 className="mb-2 mt-4 text-base font-semibold first:mt-0 dark:text-neutral-50">
                            {children}
                          </h4>
                        ),
                        h5: ({ children }) => (
                          <h5 className="mb-2 mt-4 text-sm font-semibold first:mt-0 dark:text-neutral-50">
                            {children}
                          </h5>
                        ),
                        h6: ({ children }) => (
                          <h6 className="mb-2 mt-4 text-xs font-semibold first:mt-0 dark:text-neutral-50">
                            {children}
                          </h6>
                        ),
                        // Paragraphs
                        p: ({ children }) => (
                          <p className="mb-2 last:mb-0">{children}</p>
                        ),
                        // Lists
                        ul: ({ children }) => (
                          <ul className="my-2 list-none space-y-1 border-l-4 border-primary-500 pl-4">
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="my-2 list-none space-y-1 border-l-4 border-primary-500 pl-4">
                            {children}
                          </ol>
                        ),
                        li: ({ children }) => (
                          <li className="before:mr-2 before:font-bold before:content-['•'] dark:text-neutral-200">
                            {children}
                          </li>
                        ),
                        // Links
                        a: ({ href, children }) => (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="border-b-2 border-primary-500 px-1 font-semibold transition-colors hover:text-primary-600 dark:text-primary-400 dark:hover:text-primary-300"
                          >
                            {children}
                          </a>
                        ),
                        // Blockquotes
                        blockquote: ({ children }) => (
                          <blockquote className="my-2 rounded-r border-l-4 border-primary-500 bg-neutral-50 py-2 pl-4 italic dark:bg-neutral-800">
                            {children}
                          </blockquote>
                        ),
                        // Strong/Bold
                        strong: ({ children }) => (
                          <strong className="font-bold dark:text-neutral-50">
                            {children}
                          </strong>
                        ),
                        // Emphasis/Italic
                        em: ({ children }) => (
                          <em className="italic">{children}</em>
                        ),
                        // Horizontal rule
                        hr: () => (
                          <hr className="my-4 border-t border-neutral-300" />
                        ),
                        // Tables
                        table: ({ children }) => (
                          <div className="my-2 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
                            <table className="min-w-full border-collapse">
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
                          <th className="border-r border-neutral-200 p-2 text-left font-semibold last:border-r-0 dark:border-neutral-700 dark:text-neutral-50">
                            {children}
                          </th>
                        ),
                        td: ({ children }) => (
                          <td className="border-r border-neutral-200 p-2 last:border-r-0 dark:border-neutral-700 dark:text-neutral-200">
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
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-lg border-t border-neutral-200 bg-neutral-50 px-4 py-1.5 dark:border-neutral-700 dark:bg-neutral-800">
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
        */}

        <SectionGroup
          title={
            <>
              <BeakerIcon className="mr-2 inline-block size-5" />
              Testing & Interactions
            </>
          }
        >
          {/* Chat Test Section */}
          <AgentAccordionSection
            id="test"
            title={
              <>
                <ChatBubbleLeftRightIcon className="mr-2 inline-block size-5" />
                TEST AGENT
              </>
            }
            expandedSection={expandedSection}
            onToggle={toggleSection}
            contentClassName="p-0 lg:p-0"
          >
            <AgentChatWithFunctionUrl
              key={chatClearKey}
              workspaceId={workspaceId}
              agentId={agentId}
              onClear={() => setChatClearKey((prev) => prev + 1)}
              isEmbedded
            />
          </AgentAccordionSection>

          {/* Recent Conversations Section */}
          <AgentAccordionSection
            id="conversations"
            title={
              <>
                <ChatBubbleLeftIcon className="mr-2 inline-block size-5" />
                RECENT CONVERSATIONS
              </>
            }
            expandedSection={expandedSection}
            onToggle={toggleSection}
          >
            <ConversationList
              workspaceId={workspaceId}
              agentId={agentId}
              onConversationClick={setSelectedConversationId}
            />
          </AgentAccordionSection>

          {/* Evaluations Section */}
          <AgentAccordionSection
            id="evaluations"
            title={
              <>
                <BeakerIcon className="mr-2 inline-block size-5" />
                EVALUATIONS
              </>
            }
            expandedSection={expandedSection}
            onToggle={toggleSection}
          >
            <QueryPanel
              fallback={
                <LoadingScreen compact message="Loading evaluations..." />
              }
            >
              <EvaluationsRefreshButton
                workspaceId={workspaceId}
                agentId={agentId}
                canEdit={canEdit}
                onImprovePrompt={() => setIsImprovePromptOpen(true)}
              />
              <div className="space-y-6">
                <div>
                  <h3 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                    Evaluation Judges
                  </h3>
                  <EvalJudgeList
                    workspaceId={workspaceId}
                    agentId={agentId}
                    canEdit={canEdit}
                  />
                </div>
                <div>
                  <h3 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                    Evaluation Progress
                  </h3>
                  <EvalResultsChart
                    workspaceId={workspaceId}
                    agentId={agentId}
                  />
                </div>
                <div>
                  <h3 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                    Evaluation Results
                  </h3>
                  <EvalResultsList
                    workspaceId={workspaceId}
                    agentId={agentId}
                    onConversationOpen={setSelectedConversationId}
                  />
                </div>
              </div>
            </QueryPanel>
          </AgentAccordionSection>

          {/* Schedules Section */}
          <AgentAccordionSection
            id="schedules"
            title={
              <>
                <ClockIcon className="mr-2 inline-block size-5" />
                SCHEDULES
              </>
            }
            expandedSection={expandedSection}
            onToggle={toggleSection}
          >
            <AgentScheduleList
              workspaceId={workspaceId}
              agentId={agentId}
              canEdit={canEdit}
            />
          </AgentAccordionSection>
        </SectionGroup>

        <SectionGroup
          title={
            <>
              <LightBulbIcon className="mr-2 inline-block size-5" />
              Knowledge and Memory
            </>
          }
        >
          {/* Memory Records Section */}
          <AgentAccordionSection
            id="memory"
            title={
              <>
                <LightBulbIcon className="mr-2 inline-block size-5" />
                MEMORY RECORDS
              </>
            }
            expandedSection={expandedSection}
            onToggle={toggleSection}
          >
            <AgentMemoryRecords workspaceId={workspaceId} agentId={agentId} />
          </AgentAccordionSection>

          <AgentAccordionSection
            id="knowledge-graph"
            title={
              <>
                <ShareIcon className="mr-2 inline-block size-5" />
                KNOWLEDGE GRAPH
              </>
            }
            expandedSection={expandedSection}
            onToggle={toggleSection}
          >
            <AgentKnowledgeGraph
              workspaceId={workspaceId}
              agentId={agentId}
              memoryExtractionEnabled={memoryExtractionEnabled}
            />
          </AgentAccordionSection>

          {canEdit && (
            <AgentAccordionSection
              id="memory-extraction"
              title={
                <>
                  <WrenchScrewdriverIcon className="mr-2 inline-block size-5" />
                  MEMORY EXTRACTION
                </>
              }
              expandedSection={expandedSection}
              onToggle={toggleSection}
            >
              <div className="space-y-4">
                <p className="text-sm opacity-75 dark:text-neutral-300">
                  Summarize each conversation and extract long-term facts into the
                  graph database. When enabled, this will update the working
                  memory record for the conversation on every update.
                </p>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                  <input
                    type="checkbox"
                    checked={memoryExtractionEnabled}
                    onChange={(e) =>
                      setMemoryExtractionEnabled(e.target.checked)
                    }
                    className="mt-1 rounded border-2 border-neutral-300"
                  />
                  <div className="flex-1">
                    <div className="font-bold">Enable Memory Extraction</div>
                    <div className="mt-1 text-sm opacity-75 dark:text-neutral-300">
                      Generate a summary and structured memory operations for
                      each conversation update.
                    </div>
                  </div>
                </label>
                <div className="space-y-2">
                  <label className="text-sm font-semibold dark:text-neutral-300">
                    Extraction model
                  </label>
                  <select
                    value={memoryExtractionModel ?? ""}
                    onChange={(e) =>
                      setMemoryExtractionModel(
                        e.target.value.length > 0 ? e.target.value : null
                      )
                    }
                    className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                  >
                    <option value="">
                      {defaultModel
                        ? `Default (${defaultModel})`
                        : "Default model"}
                    </option>
                    {availableModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                  {isLoadingModels && (
                    <p className="text-xs opacity-75 dark:text-neutral-300">
                      Loading models...
                    </p>
                  )}
                  {modelLoadError && (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      {modelLoadError}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-sm font-semibold dark:text-neutral-300">
                      Extraction prompt
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-neutral-200 px-2 py-0.5 text-xs font-semibold text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
                        {memoryExtractionPrompt.trim() ===
                        DEFAULT_MEMORY_EXTRACTION_PROMPT.trim()
                          ? "Default"
                          : "Customized"}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setMemoryExtractionPrompt(
                            DEFAULT_MEMORY_EXTRACTION_PROMPT
                          )
                        }
                        className="rounded-lg border-2 border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
                      >
                        Use default
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={memoryExtractionPrompt}
                    onChange={(e) => setMemoryExtractionPrompt(e.target.value)}
                    rows={8}
                    className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                  />
                </div>
                <button
                  onClick={handleSaveMemoryExtraction}
                  disabled={updateAgent.isPending}
                  className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {updateAgent.isPending
                    ? "Saving..."
                    : "Save Memory Extraction Settings"}
                </button>
              </div>
            </AgentAccordionSection>
          )}

          {canEdit && (
            <AgentAccordionSection
              id="summarization-prompts"
              title={
                <>
                  <WrenchScrewdriverIcon className="mr-2 inline-block size-5" />
                  SUMMARIZATION PROMPTS
                </>
              }
              expandedSection={expandedSection}
              onToggle={toggleSection}
            >
              <div className="space-y-4">
                <p className="text-sm opacity-75 dark:text-neutral-300">
                  Customize the prompts used to summarize this agent&apos;s
                  memory for each time period. If a prompt matches the default,
                  the default will be used and stored prompts will be cleared.
                </p>
                <div className="space-y-4">
                  {SUMMARIZATION_PROMPT_GRAINS.map((grain) => {
                    const currentValue = summarizationPrompts[grain] ?? "";
                    const isDefault =
                      currentValue.trim() ===
                      DEFAULT_SUMMARIZATION_PROMPTS[grain].trim();
                    return (
                      <div key={grain} className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <label className="text-sm font-semibold dark:text-neutral-300">
                            {SUMMARIZATION_PROMPT_LABELS[grain]} prompt
                          </label>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full border border-neutral-200 px-2 py-0.5 text-xs font-semibold text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
                              {isDefault ? "Default" : "Customized"}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                handleResetSummarizationPrompt(grain)
                              }
                              className="rounded-lg border-2 border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
                            >
                              Use default
                            </button>
                          </div>
                        </div>
                        <textarea
                          value={currentValue}
                          onChange={(e) =>
                            handleSummarizationPromptChange(
                              grain,
                              e.target.value
                            )
                          }
                          rows={6}
                          className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                        />
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={handleSaveSummarizationPrompts}
                  disabled={updateAgent.isPending}
                  className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {updateAgent.isPending
                    ? "Saving..."
                    : "Save Summarization Prompts"}
                </button>
              </div>
            </AgentAccordionSection>
          )}

          {/* Memory Search Tool Section */}
          {canEdit && (
            <AgentAccordionSection
              id="memory-search"
              title={
                <>
                  <MagnifyingGlassIcon className="mr-2 inline-block size-5" />
                  MEMORY SEARCH TOOL
                </>
              }
              expandedSection={expandedSection}
              onToggle={toggleSection}
            >
              <div className="space-y-4">
                <p className="text-sm opacity-75 dark:text-neutral-300">
                  Enable the memory search tool to allow this agent to search
                  its factual memory across different time periods and recall
                  past conversations.
                </p>
                <div className="rounded-lg border-2 border-yellow-400 bg-yellow-50 p-4">
                  <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-yellow-900">
                    <ExclamationTriangleIcon className="size-4" />
                    Privacy Warning
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
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                  <input
                    type="checkbox"
                    checked={enableMemorySearch}
                    onChange={(e) => setEnableMemorySearch(e.target.checked)}
                    className="mt-1 rounded border-2 border-neutral-300"
                  />
                  <div className="flex-1">
                    <div className="font-bold">Enable Memory Search</div>
                    <div className="mt-1 text-sm opacity-75 dark:text-neutral-300">
                      Allow this agent to use the search_memory tool to recall
                      past conversations and information
                    </div>
                  </div>
                </label>
                <button
                  onClick={handleSaveMemorySearch}
                  disabled={updateAgent.isPending}
                  className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {updateAgent.isPending
                    ? "Saving..."
                    : "Save Memory Search Setting"}
                </button>
              </div>
            </AgentAccordionSection>
          )}

          {/* Inject Knowledge Section */}
          {canEdit && (
            <AgentAccordionSection
              id="inject-knowledge"
              title={
                <>
                  <LightBulbIcon className="mr-2 inline-block size-5" />
                  INJECT KNOWLEDGE
                </>
              }
              expandedSection={expandedSection}
              onToggle={toggleSection}
            >
                <div className="space-y-4">
                  <p className="text-sm opacity-75 dark:text-neutral-300">
                    Enable knowledge injection to retrieve and inject relevant
                    knowledge from agent memories and workspace documents into
                    user prompts before they are sent to the agent.
                  </p>
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
                    <p className="text-sm font-semibold dark:text-neutral-300">
                      What are snippets?
                    </p>
                    <p className="mt-1 text-sm opacity-75 dark:text-neutral-300">
                      Snippets are chunks of knowledge retrieved from workspace
                      documents and agent memories. Document snippets are
                      extracted from uploaded files and indexed in the vector
                      database. Memory snippets are pulled from the agent’s
                      working memory and knowledge graph.
                    </p>
                  </div>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                    <input
                      type="checkbox"
                      checked={enableKnowledgeInjection}
                      onChange={(e) =>
                        setEnableKnowledgeInjection(e.target.checked)
                      }
                      className="mt-1 rounded border-2 border-neutral-300"
                    />
                    <div className="flex-1">
                      <div className="font-bold">
                        Enable Knowledge Injection
                      </div>
                      <div className="mt-1 text-sm opacity-75 dark:text-neutral-300">
                        Automatically inject relevant document snippets into
                        user prompts
                      </div>
                    </div>
                  </label>
                  {enableKnowledgeInjection && (
                    <>
                      <div className="space-y-3">
                        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                          <input
                            type="checkbox"
                            checked={enableKnowledgeInjectionFromMemories}
                            onChange={(e) =>
                              setEnableKnowledgeInjectionFromMemories(
                                e.target.checked
                              )
                            }
                            aria-label="Inject from memories"
                            className="mt-1 rounded border-2 border-neutral-300"
                          />
                          <div className="flex-1">
                            <div className="font-bold">
                              Inject from memories
                            </div>
                            <div className="mt-1 text-sm opacity-75 dark:text-neutral-300">
                              Use the agent’s working memory and knowledge graph
                              to inject relevant facts.
                            </div>
                          </div>
                        </label>
                        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                          <input
                            type="checkbox"
                            checked={enableKnowledgeInjectionFromDocuments}
                            onChange={(e) =>
                              setEnableKnowledgeInjectionFromDocuments(
                                e.target.checked
                              )
                            }
                            aria-label="Inject from documents"
                            className="mt-1 rounded border-2 border-neutral-300"
                          />
                          <div className="flex-1">
                            <div className="font-bold">
                              Inject from documents
                            </div>
                            <div className="mt-1 text-sm opacity-75 dark:text-neutral-300">
                              Retrieve relevant snippets from workspace documents.
                            </div>
                          </div>
                        </label>
                        {!enableKnowledgeInjectionFromDocuments &&
                          !enableKnowledgeInjectionFromMemories && (
                            <p className="text-xs text-yellow-600 dark:text-yellow-400">
                              Select at least one source to inject knowledge.
                            </p>
                          )}
                      </div>
                      {enableKnowledgeInjectionFromMemories && (
                        <div className="space-y-2">
                          <label className="block text-sm font-semibold dark:text-neutral-300">
                            Entity extractor model
                          </label>
                          <select
                            value={knowledgeInjectionEntityExtractorModel ?? ""}
                            onChange={(e) =>
                              setKnowledgeInjectionEntityExtractorModel(
                                e.target.value.length > 0 ? e.target.value : null
                              )
                            }
                            className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                          >
                            <option value="">
                              {defaultModel
                                ? `Default (${defaultModel})`
                                : "Default model"}
                            </option>
                            {availableModels.map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                          </select>
                          {isLoadingModels && (
                            <p className="text-xs opacity-75 dark:text-neutral-300">
                              Loading models...
                            </p>
                          )}
                          {modelLoadError && (
                            <p className="text-xs text-red-600 dark:text-red-400">
                              {modelLoadError}
                            </p>
                          )}
                        </div>
                      )}
                      <div className="space-y-2">
                        <Slider
                          label="Number of Snippets to Inject"
                          value={knowledgeInjectionSnippetCount}
                          min={1}
                          max={50}
                          step={1}
                          onChange={(value) =>
                            setKnowledgeInjectionSnippetCount(
                              value ?? DEFAULT_KNOWLEDGE_SNIPPET_COUNT
                            )
                          }
                        />
                        <p className="text-xs opacity-75 dark:text-neutral-300">
                          Number of knowledge snippets to retrieve and inject
                          (1-50, default: 5)
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Slider
                          label="Minimum Similarity Score"
                          value={knowledgeInjectionMinSimilarity}
                          min={0}
                          max={1}
                          step={0.01}
                          onChange={(value) =>
                            setKnowledgeInjectionMinSimilarity(
                              value ?? DEFAULT_KNOWLEDGE_MIN_SIMILARITY
                            )
                          }
                          formatValue={(v) => `${Math.round(v * 100)}%`}
                        />
                        <p className="text-xs opacity-75 dark:text-neutral-300">
                          Similarity score (0-1) measures how closely a
                          document snippet matches your query. Higher scores
                          (closer to 1) indicate more relevant content.
                          Snippets below this threshold will be excluded.
                          (default: 0)
                        </p>
                      </div>
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                        <input
                          type="checkbox"
                          checked={enableKnowledgeReranking}
                          onChange={(e) =>
                            setEnableKnowledgeReranking(e.target.checked)
                          }
                          className="mt-1 rounded border-2 border-neutral-300"
                        />
                        <div className="flex-1">
                          <div className="font-bold">Enable Re-ranking</div>
                          <div className="mt-1 text-sm opacity-75 dark:text-neutral-300">
                            Re-rank retrieved snippets to prioritize the most
                            relevant ones using a specialized re-ranking model
                          </div>
                        </div>
                      </label>
                      {enableKnowledgeReranking && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <label className="block text-sm font-semibold dark:text-neutral-300">
                              Re-ranking Model
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                setModelPricesFilter("rerank");
                                setIsModelPricesOpen(true);
                              }}
                              className="rounded-lg border-2 border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
                            >
                              💰 Model prices
                            </button>
                          </div>
                          {isLoadingRerankingModels ? (
                            <div className="text-sm opacity-75 dark:text-neutral-300">
                              Loading re-ranking models...
                            </div>
                          ) : rerankingModels.length === 0 ? (
                            <div className="rounded-lg border-2 border-yellow-400 bg-yellow-50 p-4">
                              <p className="text-sm font-semibold text-yellow-900">
                                No Re-ranking Models Available
                              </p>
                              <p className="mt-1 text-sm text-yellow-800">
                                No re-ranking models were found in the available
                                OpenRouter models. Re-ranking will be disabled.
                              </p>
                            </div>
                          ) : (
                            <select
                              value={knowledgeRerankingModel || ""}
                              onChange={(e) =>
                                setKnowledgeRerankingModel(
                                  e.target.value || null
                                )
                              }
                              className="w-full rounded-xl border-2 border-neutral-300 bg-white px-3 py-2 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                            >
                              <option value="">
                                Select a re-ranking model
                              </option>
                              {rerankingModels.map((model) => (
                                <option key={model} value={model}>
                                  {model}
                                </option>
                              ))}
                            </select>
                          )}
                          {!isLoadingRerankingModels && (
                            <p className="text-xs text-neutral-600 dark:text-neutral-300">
                              {rerankingCapabilityLabels.length > 0
                                ? `Capabilities: ${rerankingCapabilityLabels.join(
                                    ", "
                                  )}`
                                : "Capabilities: unavailable"}
                            </p>
                          )}
                          {!knowledgeRerankingModel &&
                            enableKnowledgeReranking &&
                            rerankingModels.length > 0 && (
                              <p className="text-xs text-yellow-600 dark:text-yellow-400">
                                Please select a re-ranking model to enable
                                re-ranking.
                              </p>
                            )}
                        </div>
                      )}
                    </>
                  )}
                  <button
                    onClick={handleSaveKnowledgeInjection}
                    disabled={
                      updateAgent.isPending ||
                      (enableKnowledgeInjection &&
                        !enableKnowledgeInjectionFromDocuments &&
                        !enableKnowledgeInjectionFromMemories) ||
                      (enableKnowledgeInjection &&
                        enableKnowledgeReranking &&
                        ((!knowledgeRerankingModel &&
                          rerankingModels.length > 0) ||
                          rerankingModels.length === 0))
                    }
                    className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updateAgent.isPending
                      ? "Saving..."
                      : "Save Knowledge Injection Settings"}
                  </button>
                </div>
            </AgentAccordionSection>
          )}

          {/* Document Search Tool Section */}
          {canEdit && (
            <AgentAccordionSection
              id="document-search"
              title={
                <>
                  <DocumentMagnifyingGlassIcon className="mr-2 inline-block size-5" />
                  DOCUMENT SEARCH TOOL
                </>
              }
              expandedSection={expandedSection}
              onToggle={toggleSection}
            >
                <div className="space-y-4">
                  <p className="text-sm opacity-75 dark:text-neutral-300">
                    Enable the document search tool to allow this agent to
                    search workspace documents using semantic vector search.
                  </p>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                    <input
                      type="checkbox"
                      checked={enableSearchDocuments}
                      onChange={(e) =>
                        setEnableSearchDocuments(e.target.checked)
                      }
                      className="mt-1 rounded border-2 border-neutral-300"
                    />
                    <div className="flex-1">
                      <div className="font-bold">Enable Document Search</div>
                      <div className="mt-1 text-sm opacity-75 dark:text-neutral-300">
                        Allow this agent to use the search_documents tool to
                        search workspace documents
                      </div>
                    </div>
                  </label>
                  <button
                    onClick={handleSaveSearchDocuments}
                    disabled={updateAgent.isPending}
                    className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updateAgent.isPending
                      ? "Saving..."
                      : "Save Document Search Setting"}
                  </button>
                </div>
            </AgentAccordionSection>
          )}
        </SectionGroup>

        <SectionGroup
          title={
            <>
              <Cog6ToothIcon className="mr-2 inline-block size-5" />
              Configuration
            </>
          }
        >
          {/* Delegation Section */}
          {canEdit && (
            <AgentAccordionSection
              id="delegation"
              title={
                <>
                  <UserGroupIcon className="mr-2 inline-block size-5" />
                  DELEGATION
                </>
              }
              expandedSection={expandedSection}
              onToggle={toggleSection}
            >
                <p className="mb-4 text-sm opacity-75 dark:text-neutral-300">
                  Configure which other agents in this workspace this agent can
                  delegate tasks to. When delegation is enabled, this agent will
                  have access to the{" "}
                  <code className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                    list_agents
                  </code>{" "}
                  and{" "}
                  <code className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
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
                            className="flex cursor-pointer items-start gap-2 rounded-lg border border-neutral-200 p-3 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-800"
                          >
                            <input
                              type="checkbox"
                              checked={delegatableAgentIds.includes(
                                targetAgent.id
                              )}
                              onChange={() =>
                                handleDelegationToggle(targetAgent.id)
                              }
                              className="mt-1 rounded border-2 border-neutral-300 dark:border-neutral-700"
                            />
                            <div className="flex-1">
                              <div className="font-bold dark:text-neutral-50">
                                {targetAgent.name}
                              </div>
                              <div className="mt-1 text-xs opacity-75 dark:text-neutral-300">
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
                      className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
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
            </AgentAccordionSection>
          )}
          {/* Advanced Section */}
          {canEdit && (
            <AgentAccordionSection
              id="advanced"
              title={
                <>
                  <WrenchScrewdriverIcon className="mr-2 inline-block size-5" />
                  ADVANCED
                </>
              }
              expandedSection={expandedSection}
              onToggle={toggleSection}
            >
                <p className="mb-4 text-sm opacity-75 dark:text-neutral-300">
                  Configure advanced model generation parameters. These settings
                  control how the AI model generates responses. Leave fields
                  empty to use model defaults.
                </p>
                <div className="space-y-6">
                  {/* Temperature */}
                  <div>
                    <label className="mb-2 block text-sm font-semibold dark:text-neutral-300">
                      Temperature
                    </label>
                    <p className="mb-2 text-xs opacity-75 dark:text-neutral-300">
                      Controls the randomness of responses. Lower values (0-0.5)
                      produce more focused and deterministic outputs, while
                      higher values (1.5-2) create more creative and varied
                      responses. Default: model default (~1.0)
                    </p>
                    <Slider
                      value={temperature}
                      min={0}
                      max={2}
                      step={0.1}
                      onChange={setTemperature}
                      placeholder="Model default"
                    />
                  </div>

                  {/* Top-p */}
                  <div>
                    <label className="mb-2 block text-sm font-semibold dark:text-neutral-300">
                      Top-p / Nucleus Sampling
                    </label>
                    <p className="mb-2 text-xs opacity-75 dark:text-neutral-300">
                      Controls diversity by considering tokens with cumulative
                      probability up to this threshold. Lower values (0.1-0.5)
                      produce more focused outputs, higher values (0.9-1.0)
                      allow more diversity. Default: model default (~0.95)
                    </p>
                    <Slider
                      value={topP}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={setTopP}
                      placeholder="Model default"
                    />
                  </div>

                  {/* Top-k */}
                  <div>
                    <label className="mb-2 block text-sm font-semibold dark:text-neutral-300">
                      Top-k
                    </label>
                    <p className="mb-2 text-xs opacity-75 dark:text-neutral-300">
                      Limits token selection to the top K most probable tokens
                      at each step. Lower values (10-20) produce more focused
                      outputs, higher values (50-100) allow more diversity.
                      Default: model default
                    </p>
                    <Slider
                      value={topK}
                      min={1}
                      max={100}
                      step={1}
                      onChange={setTopK}
                      placeholder="Model default"
                    />
                  </div>

                  {/* Max Output Tokens */}
                  <div>
                    <label className="mb-2 block text-sm font-semibold dark:text-neutral-300">
                      Max Output Tokens
                    </label>
                    <p className="mb-2 text-xs opacity-75 dark:text-neutral-300">
                      Maximum number of tokens the model can generate in a
                      response. This limits the length of generated text. Higher
                      values allow longer responses but may increase costs.
                      Default: model default
                    </p>
                    <Slider
                      value={maxOutputTokens}
                      min={1}
                      max={8192}
                      step={1}
                      onChange={setMaxOutputTokens}
                      placeholder="Model default"
                    />
                  </div>

                  {/* Stop Sequences */}
                  <div>
                    <label className="mb-2 block text-sm font-semibold dark:text-neutral-300">
                      Stop Sequences
                    </label>
                    <p className="mb-2 text-xs opacity-75 dark:text-neutral-300">
                      Text sequences that will stop generation when encountered.
                      The model will stop immediately after generating any of
                      these sequences. Enter multiple sequences separated by
                      commas. Default: none
                    </p>
                    <input
                      type="text"
                      value={stopSequences}
                      onChange={(e) => setStopSequences(e.target.value)}
                      className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                      placeholder="e.g., END, STOP, ###"
                    />
                  </div>

                  {/* Max Tool Roundtrips */}
                  <div>
                    <label className="mb-2 block text-sm font-semibold dark:text-neutral-300">
                      Max Tool Roundtrips
                    </label>
                    <p className="mb-2 text-xs opacity-75 dark:text-neutral-300">
                      Maximum number of tool call iterations allowed before
                      stopping. Each roundtrip allows the agent to call tools,
                      receive results, and continue processing. Higher values
                      allow more complex multi-step operations. Default: 5
                    </p>
                    <Slider
                      value={maxToolRoundtrips}
                      min={1}
                      max={50}
                      step={1}
                      onChange={setMaxToolRoundtrips}
                      placeholder="5"
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleSaveAdvanced}
                      disabled={updateAgent.isPending}
                      className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {updateAgent.isPending
                        ? "Saving..."
                        : "Save Advanced Settings"}
                    </button>
                    <button
                      onClick={handleResetAdvanced}
                      disabled={updateAgent.isPending}
                      className="rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50 dark:hover:bg-neutral-700"
                    >
                      Reset to Defaults
                    </button>
                  </div>
                </div>
            </AgentAccordionSection>
          )}
        </SectionGroup>

        <SectionGroup
          title={
            <>
              <WrenchScrewdriverIcon className="mr-2 inline-block size-5" />
              Tools
            </>
          }
        >
          {/* MCP Servers Section */}
          {canEdit && (
            <div id="agent-mcp-servers-section" className="scroll-mt-8">
              <AgentAccordionSection
                id="mcp-servers"
                title={
                  <>
                    <BoltIcon className="mr-2 inline-block size-5" />
                    CONNECTED TOOLS
                  </>
                }
                expandedSection={expandedSection}
                onToggle={toggleSection}
              >
                <p className="mb-4 text-sm opacity-75 dark:text-neutral-300">
                  Enable connected tools from your workspace to make them available
                  as tools to this agent. When enabled, the agent will be able
                  to call the connected tool methods.
                </p>
                {mcpServersData && mcpServersData.servers.length > 0 ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      {mcpServersData.servers.map((server) => {
                        const serverTools = getMcpServerToolsForServer(
                          server.id
                        );
                        const allToolNames = serverTools.map(
                          (tool) => tool.name
                        );
                        const enabledToolNames =
                          enabledMcpServerToolNames[server.id];
                        const isServerEnabled = enabledMcpServerIds.includes(
                          server.id
                        );

                        return (
                          <div
                            key={server.id}
                            className="space-y-3 rounded-lg border border-neutral-200 p-3 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800"
                          >
                            <label className="flex cursor-pointer items-start gap-2">
                              <input
                                type="checkbox"
                                checked={isServerEnabled}
                                onChange={() =>
                                  handleMcpServerToggle(server.id)
                                }
                                className="mt-1 rounded border-2 border-neutral-300"
                              />
                              <div className="flex-1">
                                <div className="font-bold">{server.name}</div>
                                <div className="mt-1 font-mono text-xs opacity-75 dark:text-neutral-300">
                                  {server.url}
                                </div>
                                <div className="mt-1 text-xs uppercase">
                                  Auth: {server.authType}
                                </div>
                              </div>
                            </label>
                            {isServerEnabled && (
                              <div className="space-y-2 border-t border-neutral-200 pt-3 text-xs dark:border-neutral-700">
                                <div className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
                                  Tools
                                </div>
                                {isLoadingMcpServerTools ? (
                                  <p className="text-xs opacity-70">
                                    Loading tools...
                                  </p>
                                ) : serverTools.length === 0 ? (
                                  <p className="text-xs opacity-70">
                                    No tools available for this server.
                                  </p>
                                ) : (
                                  <div className="space-y-2">
                                    {serverTools.map((tool) => {
                                      const isToolEnabled = enabledToolNames
                                        ? enabledToolNames.includes(tool.name)
                                        : true;
                                      return (
                                        <label
                                          key={tool.name}
                                          className="flex cursor-pointer items-start gap-2"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isToolEnabled}
                                            onChange={() =>
                                              handleMcpServerToolToggle(
                                                server.id,
                                                tool.name,
                                                allToolNames
                                              )
                                            }
                                            className="mt-0.5 rounded border-2 border-neutral-300"
                                          />
                                          <div className="flex-1">
                                            <div className="font-mono text-xs font-semibold">
                                              {tool.name}
                                            </div>
                                            <div className="mt-0.5 text-xs opacity-70">
                                              {tool.description}
                                            </div>
                                          </div>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <button
                      onClick={handleSaveMcpServers}
                      disabled={updateAgent.isPending}
                      className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {updateAgent.isPending
                        ? "Saving..."
                        : "Save Connected Tools"}
                    </button>
                  </div>
                ) : (
                  <p className="text-sm opacity-75 dark:text-neutral-300">
                    No connected tools available in this workspace. Create
                    connected tools in the workspace settings to enable them for
                    agents.
                  </p>
                )}
              </AgentAccordionSection>
            </div>
          )}

          {/* Email Tool Section */}
          {canEdit && (
            <AgentAccordionSection
              id="email-tool"
              title={
                <>
                  <EnvelopeIcon className="mr-2 inline-block size-5" />
                  EMAIL TOOL
                </>
              }
              expandedSection={expandedSection}
              onToggle={toggleSection}
            >
                <div className="space-y-4">
                  <p className="text-sm opacity-75 dark:text-neutral-300">
                    Enable the email tool to allow this agent to send emails
                    using the workspace email connection.
                  </p>
                  {!emailConnection && (
                    <div className="rounded-lg border-2 border-yellow-400 bg-yellow-50 p-4">
                      <p className="flex items-center gap-2 text-sm font-semibold text-yellow-900">
                        <ExclamationTriangleIcon className="size-4" />
                        Email Connection Required
                      </p>
                      <p className="mt-1 text-sm text-yellow-800">
                        This workspace does not have an email connection
                        configured. Please configure an email connection in the
                        workspace settings before enabling this tool.
                      </p>
                    </div>
                  )}
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                    <input
                      type="checkbox"
                      checked={enableSendEmail}
                      onChange={(e) => setEnableSendEmail(e.target.checked)}
                      disabled={!emailConnection}
                      className="mt-1 rounded border-2 border-neutral-300 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <div className="flex-1">
                      <div className="font-bold">Enable Email Sending</div>
                      <div className="mt-1 text-sm opacity-75 dark:text-neutral-300">
                        Allow this agent to use the send_email tool to send
                        emails using the workspace email connection
                        {!emailConnection && " (requires email connection)"}
                      </div>
                    </div>
                  </label>
                  <button
                    onClick={handleSaveSendEmail}
                    disabled={updateAgent.isPending || !emailConnection}
                    className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updateAgent.isPending
                      ? "Saving..."
                      : "Save Email Tool Setting"}
                  </button>
                </div>
            </AgentAccordionSection>
          )}

          {/* Web Search Tool Section */}
          {canEdit && (
            <AgentAccordionSection
              id="tavily-search"
              title={
                <>
                  <GlobeAltIcon className="mr-2 inline-block size-5" />
                  WEB SEARCH TOOL
                </>
              }
              expandedSection={expandedSection}
              onToggle={toggleSection}
            >
                <div className="space-y-4">
                  <p className="text-sm opacity-75 dark:text-neutral-300">
                    Choose a provider for the search_web tool. Tavily: $0.008
                    per call (first 10 calls/day free for paid tiers). Jina:
                    Free (no credits charged).
                  </p>
                  <div className="space-y-3">
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                      <input
                        type="radio"
                        name="searchWebProvider"
                        value=""
                        checked={searchWebProvider === null}
                        onChange={() => setSearchWebProvider(null)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="font-bold">None</div>
                        <div className="mt-1 text-sm opacity-75 dark:text-neutral-300">
                          Disable the search_web tool for this agent.
                        </div>
                      </div>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                      <input
                        type="radio"
                        name="searchWebProvider"
                        value="tavily"
                        checked={searchWebProvider === "tavily"}
                        onChange={() => setSearchWebProvider("tavily")}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="font-bold">Tavily</div>
                        <div className="mt-1 text-sm opacity-75 dark:text-neutral-300">
                          Use Tavily search API. Cost: $0.008 per call (first 10
                          calls/day free for paid tiers).
                        </div>
                      </div>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                      <input
                        type="radio"
                        name="searchWebProvider"
                        value="jina"
                        checked={searchWebProvider === "jina"}
                        onChange={() => setSearchWebProvider("jina")}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="font-bold">Jina</div>
                        <div className="mt-1 text-sm opacity-75 dark:text-neutral-300">
                          Use Jina Search API. Free to use (no credits charged).
                          Rate limits may apply.
                        </div>
                      </div>
                    </label>
                  </div>
                  <button
                    onClick={handleSaveSearchWebProvider}
                    disabled={updateAgent.isPending}
                    className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updateAgent.isPending
                      ? "Saving..."
                      : "Save Web Search Provider"}
                  </button>
                </div>
            </AgentAccordionSection>
          )}

          {/* Web Fetch Tool Section */}
          {canEdit && (
            <AgentAccordionSection
              id="tavily-fetch"
              title={
                <>
                  <LinkIcon className="mr-2 inline-block size-5" />
                  WEB FETCH TOOL
                </>
              }
              expandedSection={expandedSection}
              onToggle={toggleSection}
            >
                <div className="space-y-4">
                  <p className="text-sm opacity-75 dark:text-neutral-300">
                    Choose a provider for the fetch_url tool. Tavily: $0.008 per
                    call (first 10 calls/day free for paid tiers). Jina: Free
                    (no credits charged).
                  </p>
                  <div className="space-y-3">
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                      <input
                        type="radio"
                        name="fetchWebProvider"
                        value=""
                        checked={fetchWebProvider === null}
                        onChange={() => setFetchWebProvider(null)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="font-bold">None</div>
                        <div className="mt-1 text-sm opacity-75 dark:text-neutral-300">
                          Disable the fetch_url tool for this agent.
                        </div>
                      </div>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                      <input
                        type="radio"
                        name="fetchWebProvider"
                        value="tavily"
                        checked={fetchWebProvider === "tavily"}
                        onChange={() => setFetchWebProvider("tavily")}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="font-bold">Tavily</div>
                        <div className="mt-1 text-sm opacity-75 dark:text-neutral-300">
                          Use Tavily extract API. Cost: $0.008 per call (first
                          10 calls/day free for paid tiers).
                        </div>
                      </div>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                      <input
                        type="radio"
                        name="fetchWebProvider"
                        value="jina"
                        checked={fetchWebProvider === "jina"}
                        onChange={() => setFetchWebProvider("jina")}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="font-bold">Jina</div>
                        <div className="mt-1 text-sm opacity-75 dark:text-neutral-300">
                          Use Jina Reader API. Free to use (no credits charged).
                          Rate limits may apply.
                        </div>
                      </div>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                      <input
                        type="radio"
                        name="fetchWebProvider"
                        value="scrape"
                        checked={fetchWebProvider === "scrape"}
                        onChange={() => setFetchWebProvider("scrape")}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="font-bold">Scrape</div>
                        <div className="mt-1 text-sm opacity-75 dark:text-neutral-300">
                          Use Puppeteer with residential proxies to scrape web
                          pages and extract Accessibility Object Model (AOM) as
                          XML. Supports JavaScript-rendered content. Uses
                          stealth techniques and attempts to solve captchas
                          automatically. Note: This service can take longer to
                          fetch content compared to other providers. Cost:
                          $0.005 per call.
                        </div>
                      </div>
                    </label>
                  </div>
                  <button
                    onClick={handleSaveFetchWebProvider}
                    disabled={updateAgent.isPending}
                    className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updateAgent.isPending
                      ? "Saving..."
                      : "Save URL Fetching Provider"}
                  </button>
                </div>
            </AgentAccordionSection>
          )}

          {/* Exa Search Tool Section */}
          {canEdit && (
            <AgentAccordionSection
              id="exa-search"
              title={
                <>
                  <MagnifyingGlassIcon className="mr-2 inline-block size-5" />
                  ADVANCED SEARCH TOOL
                </>
              }
              expandedSection={expandedSection}
              onToggle={toggleSection}
            >
                <div className="space-y-4">
                  <p className="text-sm opacity-75 dark:text-neutral-300">
                    Enable Exa.ai search tool for category-specific searches.
                    Supports searching for companies, research papers, news,
                    PDFs, GitHub repos, tweets, personal sites, people, and
                    financial reports. Charges based on usage (cost varies by
                    number of results).
                  </p>
                  <div className="space-y-3">
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                      <input
                        type="checkbox"
                        checked={enableExaSearch}
                        onChange={(e) => setEnableExaSearch(e.target.checked)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="font-bold">Enable Exa Search</div>
                        <div className="mt-1 text-sm opacity-75 dark:text-neutral-300">
                          Enable the search tool for category-specific searches
                          using Exa.ai. Charges apply based on usage.
                        </div>
                      </div>
                    </label>
                  </div>
                  <button
                    onClick={handleSaveExaSearch}
                    disabled={updateAgent.isPending}
                    className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updateAgent.isPending
                      ? "Saving..."
                      : "Save Exa Search Setting"}
                  </button>
                </div>
            </AgentAccordionSection>
          )}

          {/* Image Generation Section */}
          {canEdit && (
            <AccordionSection
              id="image-generation"
              title={
                <>
                  <PhotoIcon className="mr-2 inline-block size-5" />
                  IMAGE GENERATION
                </>
              }
              isExpanded={expandedSection === "image-generation"}
              onToggle={() => toggleSection("image-generation")}
            >
              <LazyAccordionContent
                isExpanded={expandedSection === "image-generation"}
              >
                <p className="mb-4 text-sm opacity-75 dark:text-neutral-300">
                  Enable the <span className="font-semibold">generate_image</span>{" "}
                  tool so this assistant can create images from text prompts.
                  Only OpenRouter models that support image output are listed.
                </p>
                <div className="space-y-4">
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                    <input
                      type="checkbox"
                      checked={enableImageGeneration}
                      onChange={(e) =>
                        setEnableImageGeneration(e.target.checked)
                      }
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="font-bold">Enable Image Generation</div>
                      <div className="mt-1 text-sm opacity-75 dark:text-neutral-300">
                        Allow this agent to call <span className="font-mono">generate_image</span>{" "}
                        and receive an image URL in tool output.
                      </div>
                    </div>
                  </label>

                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                        Image Model
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setModelPricesFilter("image_generation");
                          setIsModelPricesOpen(true);
                        }}
                        className="rounded-lg border-2 border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
                      >
                        💰 Model prices
                      </button>
                    </div>
                    <select
                      disabled={!enableImageGeneration || isLoadingImageModels}
                      value={
                        enableImageGeneration
                          ? imageGenerationModel || ""
                          : ""
                      }
                      onChange={(e) => {
                        const value = e.target.value || null;
                        imageGenerationModelInputRef.current = value;
                        setImageGenerationModel(value);
                      }}
                      className="w-full rounded-lg border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                    >
                      {isLoadingImageModels ? (
                        <option value="">Loading image models...</option>
                      ) : imageModels.length === 0 ? (
                        <option value="">
                          No image-capable models available
                        </option>
                      ) : (
                        imageModels.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))
                      )}
                    </select>
                    <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                      Choose a model that supports image output. These are
                      filtered from OpenRouter based on capabilities.
                    </p>
                    {isImageModelUnavailable && (
                      <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                        The currently selected model is not image-capable.
                        Please choose a supported model.
                      </p>
                    )}
                    {imageModelLoadError && (
                      <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                        {imageModelLoadError}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={handleSaveImageGeneration}
                    disabled={updateAgent.isPending}
                    className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updateAgent.isPending
                      ? "Saving..."
                      : "Save Image Generation Settings"}
                  </button>
                </div>
              </LazyAccordionContent>
            </AccordionSection>
          )}

          {/* Client-Side Tools Section */}
          {canEdit && (
            <AgentAccordionSection
              id="client-tools"
              title={
                <>
                  <ComputerDesktopIcon className="mr-2 inline-block size-5" />
                  CLIENT-SIDE TOOLS
                </>
              }
              expandedSection={expandedSection}
              onToggle={toggleSection}
            >
                <p className="mb-4 text-sm opacity-75 dark:text-neutral-300">
                  Define client-side tools that will be executed in the browser.
                  These tools should be made available to the AI model by the
                  client.
                </p>
                <div className="space-y-4">
                  <ClientToolEditor
                    tools={clientTools}
                    onChange={setClientTools}
                  />
                  <button
                    onClick={handleSaveClientTools}
                    disabled={updateAgent.isPending}
                    className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updateAgent.isPending ? "Saving..." : "Save Client Tools"}
                  </button>
                </div>
            </AgentAccordionSection>
          )}
        </SectionGroup>

        <SectionGroup
          title={
            <>
              <ServerIcon className="mr-2 inline-block size-5" />
              Servers
            </>
          }
        >
          {/* Embeddable Widget Section */}
          {canEdit && (
            <AgentAccordionSection
              id="embeddable-widget"
              title={
                <>
                  <LinkIcon className="mr-2 inline-block size-5" />
                  EMBEDDABLE WIDGET
                </>
              }
              expandedSection={expandedSection}
              onToggle={toggleSection}
            >
                <p className="mb-4 text-sm opacity-75 dark:text-neutral-300">
                  Embed a chat interface in your website or web app. The widget
                  uses a Web Component with Shadow DOM for style isolation and
                  supports client-side tool execution.
                </p>
                <div className="space-y-4">
                  {/* Enable Widget Toggle */}
                  <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
                    <div>
                      <label
                        htmlFor="widget-enabled"
                        className="text-sm font-medium"
                      >
                        Enable Widget
                      </label>
                      <p className="text-xs opacity-75">
                        Allow this agent to be embedded as a widget
                      </p>
                    </div>
                    <input
                      id="widget-enabled"
                      type="checkbox"
                      checked={widgetConfig.enabled}
                      onChange={(e) =>
                        setWidgetConfig({
                          ...widgetConfig,
                          enabled: e.target.checked,
                        })
                      }
                      className="text-primary focus:ring-primary size-5 rounded border-neutral-300 dark:border-neutral-700"
                    />
                  </div>

                  {widgetConfig.enabled && (
                    <>
                      {/* Allowed Origins */}
                      <div>
                        <label
                          htmlFor="widget-allowed-origins"
                          className="mb-2 block text-sm font-medium"
                        >
                          Allowed CORS Origins
                        </label>
                        <input
                          id="widget-allowed-origins"
                          type="text"
                          placeholder='e.g., https://example.com, https://app.example.com or "*" for all'
                          value={
                            widgetConfig.allowedOrigins?.join(", ") || ""
                          }
                          onChange={(e) => {
                            const value = e.target.value.trim();
                            setWidgetConfig({
                              ...widgetConfig,
                              allowedOrigins:
                                value === "" || value === "*"
                                  ? value === "*"
                                    ? ["*"]
                                    : undefined
                                  : value.split(",").map((s) => s.trim()),
                            });
                          }}
                          className="focus:border-primary focus:ring-primary w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 dark:border-neutral-800 dark:bg-neutral-900"
                        />
                        <p className="mt-1 text-xs opacity-75">
                          Comma-separated list of allowed origins, or &quot;*&quot; for
                          all origins
                        </p>
                      </div>

                      {/* Theme Selector */}
                      <div>
                        <label
                          htmlFor="widget-theme"
                          className="mb-2 block text-sm font-medium"
                        >
                          Theme
                        </label>
                        <select
                          id="widget-theme"
                          value={widgetConfig.theme || "auto"}
                          onChange={(e) =>
                            setWidgetConfig({
                              ...widgetConfig,
                              theme: e.target.value as
                                | "light"
                                | "dark"
                                | "auto",
                            })
                          }
                          className="focus:border-primary focus:ring-primary w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 dark:border-neutral-800 dark:bg-neutral-900"
                        >
                          <option value="auto">Auto (system preference)</option>
                          <option value="light">Light</option>
                          <option value="dark">Dark</option>
                        </select>
                      </div>

                      {/* Widget Customization Options */}
                      <details className="group rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
                        <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800 [&::-webkit-details-marker]:hidden">
                          <span>Customization Options</span>
                          <ChevronRightIcon className="size-4 shrink-0 text-neutral-400 transition-transform group-open:rotate-90 dark:text-neutral-500" />
                        </summary>
                        <div className="space-y-4 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
                          <p className="text-xs opacity-75">
                            These options are included in the embed code and preview.
                            They are saved locally in your browser and persist across sessions.
                            Colors support hex (#rrggbb) or rgba(r, g, b, a) format.
                          </p>

                          {(() => (
                            <>
                              {/* Colors */}
                              <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label
                              htmlFor="widget-primary-color"
                              className="mb-1 block text-xs font-medium"
                            >
                              Primary Color
                            </label>
                            {(() => {
                              const { hex, opacity } = parseColor(widgetCustomization.primaryColor);
                              return (
                                <div className="space-y-2">
                                  <div className="flex gap-2">
                                    <div className="relative">
                                      <input
                                        id="widget-primary-color"
                                        type="color"
                                        value={hex}
                                        onChange={(e) => {
                                          const newColor = opacity < 1 
                                            ? hexToRgba(e.target.value, opacity)
                                            : e.target.value;
                                          setWidgetCustomization({
                                            ...widgetCustomization,
                                            primaryColor: newColor,
                                          });
                                        }}
                                        className="h-8 w-16 cursor-pointer rounded border border-neutral-300 dark:border-neutral-700"
                                      />
                                      {/* Preview with opacity */}
                                      <div
                                        className="pointer-events-none absolute inset-0 rounded border border-neutral-300 dark:border-neutral-700"
                                        style={{
                                          background: `linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)`,
                                          backgroundSize: "8px 8px",
                                          backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0px",
                                        }}
                                      >
                                        <div
                                          className="size-full rounded"
                                          style={{
                                            backgroundColor: hexToRgba(hex, opacity),
                                          }}
                                        />
                                      </div>
                                    </div>
                                    <input
                                      type="text"
                                      value={widgetCustomization.primaryColor || "#3b82f6"}
                                      onChange={(e) =>
                                        setWidgetCustomization({
                                          ...widgetCustomization,
                                          primaryColor: e.target.value,
                                        })
                                      }
                                      placeholder="#3b82f6 or rgba(...)"
                                      className="focus:border-primary focus:ring-primary flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 dark:border-neutral-800 dark:bg-neutral-900"
                                    />
                                  </div>
                                  <Slider
                                    label="Opacity"
                                    value={opacity}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    onChange={(value) => {
                                      const newOpacity = value ?? 1;
                                      setWidgetCustomization({
                                        ...widgetCustomization,
                                        primaryColor: hexToRgba(hex, newOpacity),
                                      });
                                    }}
                                    formatValue={(v) => `${Math.round(v * 100)}%`}
                                    className="text-xs"
                                  />
                                </div>
                              );
                            })()}
                          </div>

                          <div>
                            <label
                              htmlFor="widget-background-color"
                              className="mb-1 block text-xs font-medium"
                            >
                              Background Color
                            </label>
                            {(() => {
                              const { hex, opacity } = parseColor(widgetCustomization.backgroundColor);
                              return (
                                <div className="space-y-2">
                                  <div className="flex gap-2">
                                    <div className="relative">
                                      <input
                                        id="widget-background-color"
                                        type="color"
                                        value={hex}
                                        onChange={(e) => {
                                          const newColor = opacity < 1 
                                            ? hexToRgba(e.target.value, opacity)
                                            : e.target.value;
                                          setWidgetCustomization({
                                            ...widgetCustomization,
                                            backgroundColor: newColor,
                                          });
                                        }}
                                        className="h-8 w-16 cursor-pointer rounded border border-neutral-300 dark:border-neutral-700"
                                      />
                                      {/* Preview with opacity */}
                                      <div
                                        className="pointer-events-none absolute inset-0 rounded border border-neutral-300 dark:border-neutral-700"
                                        style={{
                                          background: `linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)`,
                                          backgroundSize: "8px 8px",
                                          backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0px",
                                        }}
                                      >
                                        <div
                                          className="size-full rounded"
                                          style={{
                                            backgroundColor: hexToRgba(hex, opacity),
                                          }}
                                        />
                                      </div>
                                    </div>
                                    <input
                                      type="text"
                                      value={widgetCustomization.backgroundColor || "#ffffff"}
                                      onChange={(e) =>
                                        setWidgetCustomization({
                                          ...widgetCustomization,
                                          backgroundColor: e.target.value,
                                        })
                                      }
                                      placeholder="#ffffff or rgba(...)"
                                      className="focus:border-primary focus:ring-primary flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 dark:border-neutral-800 dark:bg-neutral-900"
                                    />
                                  </div>
                                  <Slider
                                    label="Opacity"
                                    value={opacity}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    onChange={(value) => {
                                      const newOpacity = value ?? 1;
                                      setWidgetCustomization({
                                        ...widgetCustomization,
                                        backgroundColor: hexToRgba(hex, newOpacity),
                                      });
                                    }}
                                    formatValue={(v) => `${Math.round(v * 100)}%`}
                                    className="text-xs"
                                  />
                                </div>
                              );
                            })()}
                          </div>

                          <div>
                            <label
                              htmlFor="widget-text-color"
                              className="mb-1 block text-xs font-medium"
                            >
                              Text Color
                            </label>
                            {(() => {
                              const { hex, opacity } = parseColor(widgetCustomization.textColor);
                              return (
                                <div className="space-y-2">
                                  <div className="flex gap-2">
                                    <div className="relative">
                                      <input
                                        id="widget-text-color"
                                        type="color"
                                        value={hex}
                                        onChange={(e) => {
                                          const newColor = opacity < 1 
                                            ? hexToRgba(e.target.value, opacity)
                                            : e.target.value;
                                          setWidgetCustomization({
                                            ...widgetCustomization,
                                            textColor: newColor,
                                          });
                                        }}
                                        className="h-8 w-16 cursor-pointer rounded border border-neutral-300 dark:border-neutral-700"
                                      />
                                      {/* Preview with opacity */}
                                      <div
                                        className="pointer-events-none absolute inset-0 rounded border border-neutral-300 dark:border-neutral-700"
                                        style={{
                                          background: `linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)`,
                                          backgroundSize: "8px 8px",
                                          backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0px",
                                        }}
                                      >
                                        <div
                                          className="size-full rounded"
                                          style={{
                                            backgroundColor: hexToRgba(hex, opacity),
                                          }}
                                        />
                                      </div>
                                    </div>
                                    <input
                                      type="text"
                                      value={widgetCustomization.textColor || "#1f2937"}
                                      onChange={(e) =>
                                        setWidgetCustomization({
                                          ...widgetCustomization,
                                          textColor: e.target.value,
                                        })
                                      }
                                      placeholder="#1f2937 or rgba(...)"
                                      className="focus:border-primary focus:ring-primary flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 dark:border-neutral-800 dark:bg-neutral-900"
                                    />
                                  </div>
                                  <Slider
                                    label="Opacity"
                                    value={opacity}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    onChange={(value) => {
                                      const newOpacity = value ?? 1;
                                      setWidgetCustomization({
                                        ...widgetCustomization,
                                        textColor: hexToRgba(hex, newOpacity),
                                      });
                                    }}
                                    formatValue={(v) => `${Math.round(v * 100)}%`}
                                    className="text-xs"
                                  />
                                </div>
                              );
                            })()}
                          </div>

                          <div>
                            <label
                              htmlFor="widget-border-color"
                              className="mb-1 block text-xs font-medium"
                            >
                              Outer Border Color
                            </label>
                            {(() => {
                              const { hex, opacity } = parseColor(widgetCustomization.borderColor);
                              return (
                                <div className="space-y-2">
                                  <div className="flex gap-2">
                                    <div className="relative">
                                      <input
                                        id="widget-border-color"
                                        type="color"
                                        value={hex}
                                        onChange={(e) => {
                                          const newColor = opacity < 1 
                                            ? hexToRgba(e.target.value, opacity)
                                            : e.target.value;
                                          setWidgetCustomization({
                                            ...widgetCustomization,
                                            borderColor: newColor,
                                          });
                                        }}
                                        className="h-8 w-16 cursor-pointer rounded border border-neutral-300 dark:border-neutral-700"
                                      />
                                      {/* Preview with opacity */}
                                      <div
                                        className="pointer-events-none absolute inset-0 rounded border border-neutral-300 dark:border-neutral-700"
                                        style={{
                                          background: `linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)`,
                                          backgroundSize: "8px 8px",
                                          backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0px",
                                        }}
                                      >
                                        <div
                                          className="size-full rounded"
                                          style={{
                                            backgroundColor: hexToRgba(hex, opacity),
                                          }}
                                        />
                                      </div>
                                    </div>
                                    <input
                                      type="text"
                                      value={widgetCustomization.borderColor || "#e5e7eb"}
                                      onChange={(e) =>
                                        setWidgetCustomization({
                                          ...widgetCustomization,
                                          borderColor: e.target.value,
                                        })
                                      }
                                      placeholder="#e5e7eb or rgba(...)"
                                      className="focus:border-primary focus:ring-primary flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 dark:border-neutral-800 dark:bg-neutral-900"
                                    />
                                  </div>
                                  <Slider
                                    label="Opacity"
                                    value={opacity}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    onChange={(value) => {
                                      const newOpacity = value ?? 1;
                                      setWidgetCustomization({
                                        ...widgetCustomization,
                                        borderColor: hexToRgba(hex, newOpacity),
                                      });
                                    }}
                                    formatValue={(v) => `${Math.round(v * 100)}%`}
                                    className="text-xs"
                                  />
                                </div>
                              );
                            })()}
                          </div>
                          </div>

                        {/* Border Radius */}
                        <div>
                          <label
                            htmlFor="widget-border-radius"
                            className="mb-1 block text-xs font-medium"
                          >
                            Border Radius
                          </label>
                          <input
                            id="widget-border-radius"
                            type="text"
                            value={widgetCustomization.borderRadius || "8px"}
                            onChange={(e) =>
                              setWidgetCustomization({
                                ...widgetCustomization,
                                borderRadius: e.target.value,
                              })
                            }
                            placeholder="8px"
                            className="focus:border-primary focus:ring-primary w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 dark:border-neutral-800 dark:bg-neutral-900"
                          />
                        </div>

                        {/* Outer Border Toggle */}
                        <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
                          <div>
                            <label
                              htmlFor="widget-outer-border"
                              className="text-xs font-medium"
                            >
                              Outer Border
                            </label>
                            <p className="text-xs opacity-75">
                              Show border around the widget container
                            </p>
                          </div>
                          <input
                            id="widget-outer-border"
                            type="checkbox"
                            checked={widgetCustomization.outerBorderEnabled !== false}
                            onChange={(e) =>
                              setWidgetCustomization({
                                ...widgetCustomization,
                                outerBorderEnabled: e.target.checked,
                              })
                            }
                            className="text-primary focus:ring-primary size-5 rounded border-neutral-300 dark:border-neutral-700"
                          />
                        </div>

                        {/* Internal Border */}
                        <div className="space-y-2">
                          <label className="block text-xs font-medium">
                            Internal Border
                          </label>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label
                                htmlFor="widget-internal-border-thickness"
                                className="mb-1 block text-xs font-medium"
                              >
                                Thickness
                              </label>
                              {(() => {
                                const thicknessValue = widgetCustomization.internalBorderThickness || "2px";
                                const numericValue = parseInt(thicknessValue.replace("px", "")) || 2;
                                return (
                                  <Slider
                                    id="widget-internal-border-thickness"
                                    value={numericValue}
                                    min={0}
                                    max={10}
                                    step={1}
                                    onChange={(value) => {
                                      const newValue = value ?? 2;
                                      setWidgetCustomization({
                                        ...widgetCustomization,
                                        internalBorderThickness: `${newValue}px`,
                                      });
                                    }}
                                    formatValue={(v) => `${v}px`}
                                    className="text-xs"
                                  />
                                );
                              })()}
                            </div>
                            <div>
                              <label
                                htmlFor="widget-internal-border-color"
                                className="mb-1 block text-xs font-medium"
                              >
                                Color
                              </label>
                              {(() => {
                                const { hex, opacity } = parseColor(widgetCustomization.internalBorderColor);
                                return (
                                  <div className="space-y-2">
                                    <div className="flex gap-2">
                                      <div className="relative">
                                        <input
                                          id="widget-internal-border-color"
                                          type="color"
                                          value={hex}
                                          onChange={(e) => {
                                            const newColor = opacity < 1 
                                              ? hexToRgba(e.target.value, opacity)
                                              : e.target.value;
                                            setWidgetCustomization({
                                              ...widgetCustomization,
                                              internalBorderColor: newColor,
                                            });
                                          }}
                                          className="h-8 w-16 cursor-pointer rounded border border-neutral-300 dark:border-neutral-700"
                                        />
                                        {/* Preview with opacity */}
                                        <div
                                          className="pointer-events-none absolute inset-0 rounded border border-neutral-300 dark:border-neutral-700"
                                          style={{
                                            background: `linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)`,
                                            backgroundSize: "8px 8px",
                                            backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0px",
                                          }}
                                        >
                                          <div
                                            className="size-full rounded"
                                            style={{
                                              backgroundColor: hexToRgba(hex, opacity),
                                            }}
                                          />
                                        </div>
                                      </div>
                                      <input
                                        type="text"
                                        value={widgetCustomization.internalBorderColor || "#e5e7eb"}
                                        onChange={(e) =>
                                          setWidgetCustomization({
                                            ...widgetCustomization,
                                            internalBorderColor: e.target.value,
                                          })
                                        }
                                        placeholder="#e5e7eb or rgba(...)"
                                        className="focus:border-primary focus:ring-primary flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 dark:border-neutral-800 dark:bg-neutral-900"
                                      />
                                    </div>
                                    <Slider
                                      label="Opacity"
                                      value={opacity}
                                      min={0}
                                      max={1}
                                      step={0.01}
                                      onChange={(value) => {
                                        const newOpacity = value ?? 1;
                                        setWidgetCustomization({
                                          ...widgetCustomization,
                                          internalBorderColor: hexToRgba(hex, newOpacity),
                                        });
                                      }}
                                      formatValue={(v) => `${Math.round(v * 100)}%`}
                                      className="text-xs"
                                    />
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        </div>

                        {/* Typography */}
                        <div className="space-y-2">
                          <label className="block text-xs font-medium">
                            Widget Typography
                          </label>
                          <p className="text-xs text-neutral-600 dark:text-neutral-400">
                            These font settings apply to the widget chat UI.
                          </p>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <label
                                htmlFor="widget-font-family"
                                className="mb-1 block text-xs font-medium"
                              >
                                Font Family
                              </label>
                              <input
                                id="widget-font-family"
                                type="text"
                                value={
                                  widgetCustomization.fontFamily ||
                                  DEFAULT_WIDGET_CUSTOMIZATION.fontFamily
                                }
                                onChange={(e) =>
                                  setWidgetCustomization({
                                    ...widgetCustomization,
                                    fontFamily: e.target.value,
                                  })
                                }
                                placeholder="Inter, system-ui, sans-serif"
                                className="focus:border-primary focus:ring-primary w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 dark:border-neutral-800 dark:bg-neutral-900"
                              />
                            </div>
                            <div>
                              <label
                                htmlFor="widget-font-size"
                                className="mb-1 block text-xs font-medium"
                              >
                                Base Font Size
                              </label>
                              {(() => {
                                const fontSizeValue =
                                  widgetCustomization.fontSize || "16px";
                                const numericValue =
                                  parseInt(fontSizeValue.replace("px", ""), 10) ||
                                  16;
                                return (
                                  <Slider
                                    id="widget-font-size"
                                    value={numericValue}
                                    min={12}
                                    max={20}
                                    step={1}
                                    onChange={(value) => {
                                      const newValue = value ?? 16;
                                      setWidgetCustomization({
                                        ...widgetCustomization,
                                        fontSize: `${newValue}px`,
                                      });
                                    }}
                                    formatValue={(v) => `${v}px`}
                                    className="text-xs"
                                  />
                                );
                              })()}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
                          <div>
                            <label
                              htmlFor="widget-upload-toggle"
                              className="text-xs font-medium"
                            >
                              Upload Button
                            </label>
                            <p className="text-xs opacity-75">
                              Allow users to attach files in the widget
                            </p>
                          </div>
                          <input
                            id="widget-upload-toggle"
                            type="checkbox"
                            checked={widgetCustomization.enableFileUpload !== false}
                            onChange={(e) =>
                              setWidgetCustomization({
                                ...widgetCustomization,
                                enableFileUpload: e.target.checked,
                              })
                            }
                            className="text-primary focus:ring-primary size-5 rounded border-neutral-300 dark:border-neutral-700"
                          />
                        </div>

                          </>
                        ))()}
                      </div>

                      </details>

                      {/* Preview Page Styling */}
                      <details className="group rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
                        <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800 [&::-webkit-details-marker]:hidden">
                          <span>Preview Page Styling</span>
                          <ChevronRightIcon className="size-4 shrink-0 text-neutral-400 transition-transform group-open:rotate-90 dark:text-neutral-500" />
                        </summary>
                        <div className="space-y-4 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
                          <div className="flex items-center justify-end">
                            <button
                              type="button"
                              onClick={() =>
                                updateWidgetPreviewSettings(
                                  DEFAULT_WIDGET_PREVIEW_SETTINGS
                                )
                              }
                              className="text-xs font-semibold text-primary-600 transition-colors hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                            >
                              Reset to defaults
                            </button>
                          </div>
                        <p className="text-xs opacity-75">
                          These settings only affect the widget preview page and
                          the optional site styles snippet.
                        </p>
                        <p className="text-xs text-neutral-600 dark:text-neutral-400">
                          The preview font controls the surrounding demo website,
                          not the widget UI.
                        </p>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <label
                              htmlFor="preview-theme"
                              className="mb-1 block text-xs font-medium"
                            >
                              Theme
                            </label>
                            <select
                              id="preview-theme"
                              value={normalizedPreviewSettings.theme}
                              onChange={(e) =>
                                updateWidgetPreviewSettings({
                                  theme: e.target.value as WidgetPreviewSettings["theme"],
                                })
                              }
                              className="focus:border-primary focus:ring-primary w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 dark:border-neutral-800 dark:bg-neutral-900"
                            >
                              <option value="light">Light</option>
                              <option value="dark">Dark</option>
                            </select>
                          </div>
                          <div>
                            <label
                              htmlFor="preview-font-family"
                              className="mb-1 block text-xs font-medium"
                            >
                              Font Family
                            </label>
                            <select
                              id="preview-font-family"
                              value={normalizedPreviewSettings.fontFamily}
                              onChange={(e) =>
                                updateWidgetPreviewSettings({
                                  fontFamily:
                                    e.target.value as WidgetPreviewSettings["fontFamily"],
                                })
                              }
                              className="focus:border-primary focus:ring-primary w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 dark:border-neutral-800 dark:bg-neutral-900"
                            >
                              {Object.entries(PREVIEW_FONT_FAMILIES).map(
                                ([value, option]) => (
                                  <option key={value} value={value}>
                                    {option.label}
                                  </option>
                                )
                              )}
                            </select>
                          </div>
                          <div className="md:col-span-2">
                            <Slider
                              label="Base Font Size"
                              value={normalizedPreviewSettings.fontSize}
                              min={PREVIEW_FONT_SIZE_RANGE.min}
                              max={PREVIEW_FONT_SIZE_RANGE.max}
                              step={1}
                              onChange={(value) =>
                                updateWidgetPreviewSettings({
                                  fontSize:
                                    value ??
                                    DEFAULT_WIDGET_PREVIEW_SETTINGS.fontSize,
                                })
                              }
                              formatValue={(value) => `${value}px`}
                              className="text-xs"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label
                              htmlFor="preview-bg-color"
                              className="mb-1 block text-xs font-medium"
                            >
                              Page Background
                            </label>
                            {(() => {
                              const { hex } = parseColor(
                                normalizedPreviewSettings.backgroundColor
                              );
                              return (
                                <div className="flex gap-2">
                                  <input
                                    id="preview-bg-color"
                                    type="color"
                                    value={hex}
                                    onChange={(e) =>
                                      updateWidgetPreviewSettings({
                                        backgroundColor: e.target.value,
                                      })
                                    }
                                    className="h-8 w-16 cursor-pointer rounded border border-neutral-300 dark:border-neutral-700"
                                  />
                                  <input
                                    type="text"
                                    value={normalizedPreviewSettings.backgroundColor}
                                    onChange={(e) => {
                                      const value = e.target.value.trim();
                                      updateWidgetPreviewSettings({
                                        backgroundColor:
                                          value ||
                                          DEFAULT_WIDGET_PREVIEW_SETTINGS.backgroundColor,
                                      });
                                    }}
                                    className="focus:border-primary focus:ring-primary flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 dark:border-neutral-800 dark:bg-neutral-900"
                                  />
                                </div>
                              );
                            })()}
                          </div>
                          <div>
                            <label
                              htmlFor="preview-surface-color"
                              className="mb-1 block text-xs font-medium"
                            >
                              Surface Color
                            </label>
                            {(() => {
                              const { hex } = parseColor(
                                normalizedPreviewSettings.surfaceColor
                              );
                              return (
                                <div className="flex gap-2">
                                  <input
                                    id="preview-surface-color"
                                    type="color"
                                    value={hex}
                                    onChange={(e) =>
                                      updateWidgetPreviewSettings({
                                        surfaceColor: e.target.value,
                                      })
                                    }
                                    className="h-8 w-16 cursor-pointer rounded border border-neutral-300 dark:border-neutral-700"
                                  />
                                  <input
                                    type="text"
                                    value={normalizedPreviewSettings.surfaceColor}
                                    onChange={(e) => {
                                      const value = e.target.value.trim();
                                      updateWidgetPreviewSettings({
                                        surfaceColor:
                                          value ||
                                          DEFAULT_WIDGET_PREVIEW_SETTINGS.surfaceColor,
                                      });
                                    }}
                                    className="focus:border-primary focus:ring-primary flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 dark:border-neutral-800 dark:bg-neutral-900"
                                  />
                                </div>
                              );
                            })()}
                          </div>
                          <div>
                            <label
                              htmlFor="preview-text-color"
                              className="mb-1 block text-xs font-medium"
                            >
                              Text Color
                            </label>
                            {(() => {
                              const { hex } = parseColor(
                                normalizedPreviewSettings.textColor
                              );
                              return (
                                <div className="flex gap-2">
                                  <input
                                    id="preview-text-color"
                                    type="color"
                                    value={hex}
                                    onChange={(e) =>
                                      updateWidgetPreviewSettings({
                                        textColor: e.target.value,
                                      })
                                    }
                                    className="h-8 w-16 cursor-pointer rounded border border-neutral-300 dark:border-neutral-700"
                                  />
                                  <input
                                    type="text"
                                    value={normalizedPreviewSettings.textColor}
                                    onChange={(e) => {
                                      const value = e.target.value.trim();
                                      updateWidgetPreviewSettings({
                                        textColor:
                                          value ||
                                          DEFAULT_WIDGET_PREVIEW_SETTINGS.textColor,
                                      });
                                    }}
                                    className="focus:border-primary focus:ring-primary flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 dark:border-neutral-800 dark:bg-neutral-900"
                                  />
                                </div>
                              );
                            })()}
                          </div>
                          <div>
                            <label
                              htmlFor="preview-muted-text-color"
                              className="mb-1 block text-xs font-medium"
                            >
                              Muted Text
                            </label>
                            {(() => {
                              const { hex } = parseColor(
                                normalizedPreviewSettings.mutedTextColor
                              );
                              return (
                                <div className="flex gap-2">
                                  <input
                                    id="preview-muted-text-color"
                                    type="color"
                                    value={hex}
                                    onChange={(e) =>
                                      updateWidgetPreviewSettings({
                                        mutedTextColor: e.target.value,
                                      })
                                    }
                                    className="h-8 w-16 cursor-pointer rounded border border-neutral-300 dark:border-neutral-700"
                                  />
                                  <input
                                    type="text"
                                    value={normalizedPreviewSettings.mutedTextColor}
                                    onChange={(e) => {
                                      const value = e.target.value.trim();
                                      updateWidgetPreviewSettings({
                                        mutedTextColor:
                                          value ||
                                          DEFAULT_WIDGET_PREVIEW_SETTINGS.mutedTextColor,
                                      });
                                    }}
                                    className="focus:border-primary focus:ring-primary flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 dark:border-neutral-800 dark:bg-neutral-900"
                                  />
                                </div>
                              );
                            })()}
                          </div>
                          <div>
                            <label
                              htmlFor="preview-accent-color"
                              className="mb-1 block text-xs font-medium"
                            >
                              Accent Color
                            </label>
                            {(() => {
                              const { hex } = parseColor(
                                normalizedPreviewSettings.accentColor
                              );
                              return (
                                <div className="flex gap-2">
                                  <input
                                    id="preview-accent-color"
                                    type="color"
                                    value={hex}
                                    onChange={(e) =>
                                      updateWidgetPreviewSettings({
                                        accentColor: e.target.value,
                                      })
                                    }
                                    className="h-8 w-16 cursor-pointer rounded border border-neutral-300 dark:border-neutral-700"
                                  />
                                  <input
                                    type="text"
                                    value={normalizedPreviewSettings.accentColor}
                                    onChange={(e) => {
                                      const value = e.target.value.trim();
                                      updateWidgetPreviewSettings({
                                        accentColor:
                                          value ||
                                          DEFAULT_WIDGET_PREVIEW_SETTINGS.accentColor,
                                      });
                                    }}
                                    className="focus:border-primary focus:ring-primary flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 dark:border-neutral-800 dark:bg-neutral-900"
                                  />
                                </div>
                              );
                            })()}
                          </div>
                          <div>
                            <label
                              htmlFor="preview-border-color"
                              className="mb-1 block text-xs font-medium"
                            >
                              Border Color
                            </label>
                            {(() => {
                              const { hex } = parseColor(
                                normalizedPreviewSettings.borderColor
                              );
                              return (
                                <div className="flex gap-2">
                                  <input
                                    id="preview-border-color"
                                    type="color"
                                    value={hex}
                                    onChange={(e) =>
                                      updateWidgetPreviewSettings({
                                        borderColor: e.target.value,
                                      })
                                    }
                                    className="h-8 w-16 cursor-pointer rounded border border-neutral-300 dark:border-neutral-700"
                                  />
                                  <input
                                    type="text"
                                    value={normalizedPreviewSettings.borderColor}
                                    onChange={(e) => {
                                      const value = e.target.value.trim();
                                      updateWidgetPreviewSettings({
                                        borderColor:
                                          value ||
                                          DEFAULT_WIDGET_PREVIEW_SETTINGS.borderColor,
                                      });
                                    }}
                                    className="focus:border-primary focus:ring-primary flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 dark:border-neutral-800 dark:bg-neutral-900"
                                  />
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                      </details>

                      {/* Widget Keys */}
                      <div>
                        <div className="mb-2 flex items-center justify-between">
                          <label className="text-sm font-medium">
                            Widget Keys
                          </label>
                          <button
                            onClick={async () => {
                              try {
                                await createKey.mutateAsync({
                                  type: "widget",
                                  name: "Widget Key",
                                });
                                // Key creation handled by toast in hook
                              } catch {
                                // Error handled by toast
                              }
                            }}
                            disabled={createKey.isPending}
                            className="bg-primary hover:bg-primary/90 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {createKey.isPending
                              ? "Creating..."
                              : "Generate Widget Key"}
                          </button>
                        </div>
                        <WidgetKeyList
                          keys={keys?.filter((k) => k.type === "widget") || []}
                          workspaceId={workspaceId}
                          agentId={agentId}
                        />
                      </div>

                      {/* Code Snippet */}
                      {keys?.some((k) => k.type === "widget") && (() => {
                        const widgetKey = keys?.find((k) => k.type === "widget")?.key || "YOUR_WIDGET_KEY";
                        const customizationOptions = [
                          widgetCustomization.primaryColor ? `    primaryColor: "${widgetCustomization.primaryColor}",` : null,
                          widgetCustomization.backgroundColor ? `    backgroundColor: "${widgetCustomization.backgroundColor}",` : null,
                          widgetCustomization.textColor ? `    textColor: "${widgetCustomization.textColor}",` : null,
                          widgetCustomization.borderColor ? `    borderColor: "${widgetCustomization.borderColor}",` : null,
                          widgetCustomization.borderRadius ? `    borderRadius: "${widgetCustomization.borderRadius}",` : null,
                          widgetCustomization.outerBorderEnabled !== undefined ? `    outerBorderEnabled: ${widgetCustomization.outerBorderEnabled},` : null,
                          widgetCustomization.internalBorderThickness ? `    internalBorderThickness: "${widgetCustomization.internalBorderThickness}",` : null,
                          widgetCustomization.internalBorderColor ? `    internalBorderColor: "${widgetCustomization.internalBorderColor}",` : null,
                          widgetCustomization.fontFamily ? `    fontFamily: "${widgetCustomization.fontFamily}",` : null,
                          widgetCustomization.fontSize ? `    fontSize: "${widgetCustomization.fontSize}",` : null,
                          widgetCustomization.enableFileUpload === false ? `    enableFileUpload: false,` : null,
                        ].filter(Boolean).join("\n");
                        
                        const embedCode = `<!-- Create a container for the widget -->
<!-- The widget will expand to fill the container's available space -->
<div id="helpmaton-widget-container" style="width: 100%; height: 100%;"></div>

<script src="https://app.helpmaton.com/widget.js"></script>
<script>
  AgentWidget.init({
    apiKey: "${widgetKey}",
    workspaceId: "${workspaceId}",
    agentId: "${agentId}",
    containerId: "helpmaton-widget-container", // Must match the container div ID above${customizationOptions ? `\n${customizationOptions}` : ""}
    tools: {
      // Add your tool functions here
      // Example:
      // addToCart: async ({ productId, quantity }) => {
      //   await myAppStore.dispatch('addToCart', productId, quantity);
      //   return "Added to cart successfully";
      // }
    }
  });
</script>`;
                        
                        return (
                          <details className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-50 dark:text-neutral-100 dark:hover:bg-neutral-800">
                              Embed Code
                            </summary>
                            <div className="border-t border-neutral-200 px-4 py-3 text-sm dark:border-neutral-800">
                              <p className="mb-3 text-xs opacity-75">
                                Add the container div where you want the widget to
                                appear, include the script tag once, then call
                                <code className="mx-1 rounded bg-neutral-100 px-1 py-0.5 text-[10px] dark:bg-neutral-800">
                                  AgentWidget.init
                                </code>
                                with your IDs and widget key. The widget expands to
                                fill the container size you provide.
                              </p>
                              <div className="relative">
                                <pre className="overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-xs dark:border-neutral-800 dark:bg-neutral-900">
                                  <code>{embedCode}</code>
                                </pre>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(embedCode);
                                    // You might want to add a toast here
                                  }}
                                  className="bg-primary hover:bg-primary/90 absolute right-2 top-2 rounded px-2 py-1 text-xs text-white"
                                >
                                  Copy
                                </button>
                              </div>
                            </div>
                          </details>
                        );
                      })()}

                      {(() => {
                        const previewStylesSnippet = `:root {
  --preview-bg: ${normalizedPreviewSettings.backgroundColor};
  --preview-surface: ${normalizedPreviewSettings.surfaceColor};
  --preview-text: ${normalizedPreviewSettings.textColor};
  --preview-muted: ${normalizedPreviewSettings.mutedTextColor};
  --preview-accent: ${normalizedPreviewSettings.accentColor};
  --preview-border: ${normalizedPreviewSettings.borderColor};
  --preview-font-family: ${previewFontFamilyValue};
  --preview-font-size: ${normalizedPreviewSettings.fontSize}px;
}

body {
  background: var(--preview-bg);
  color: var(--preview-text);
  font-family: var(--preview-font-family);
  font-size: var(--preview-font-size);
}`;

                        return (
                          <details className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-50 dark:text-neutral-100 dark:hover:bg-neutral-800">
                              Site Styles Snippet (Optional)
                            </summary>
                            <div className="border-t border-neutral-200 px-4 py-3 text-sm dark:border-neutral-800">
                              <div className="relative">
                                <pre className="overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-xs dark:border-neutral-800 dark:bg-neutral-900">
                                  <code>{previewStylesSnippet}</code>
                                </pre>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(previewStylesSnippet);
                                  }}
                                  className="bg-primary hover:bg-primary/90 absolute right-2 top-2 rounded px-2 py-1 text-xs text-white"
                                >
                                  Copy
                                </button>
                              </div>
                              <p className="mt-2 text-xs opacity-75">
                                Use these CSS variables to match the preview styling in
                                your own site.
                              </p>
                            </div>
                          </details>
                        );
                      })()}

                      {/* Preview and Save Buttons */}
                      <div className="flex gap-3">
                        {keys?.some((k) => k.type === "widget") && (
                          <button
                            onClick={() => {
                              const params = new URLSearchParams();
                              if (widgetCustomization.primaryColor) {
                                params.set("primaryColor", widgetCustomization.primaryColor);
                              }
                              if (widgetCustomization.backgroundColor) {
                                params.set("backgroundColor", widgetCustomization.backgroundColor);
                              }
                              if (widgetCustomization.textColor) {
                                params.set("textColor", widgetCustomization.textColor);
                              }
                              if (widgetCustomization.borderColor) {
                                params.set("borderColor", widgetCustomization.borderColor);
                              }
                              if (widgetCustomization.borderRadius) {
                                params.set("borderRadius", widgetCustomization.borderRadius);
                              }
                              if (widgetCustomization.outerBorderEnabled !== undefined) {
                                params.set("outerBorderEnabled", String(widgetCustomization.outerBorderEnabled));
                              }
                              if (widgetCustomization.internalBorderThickness) {
                                params.set("internalBorderThickness", widgetCustomization.internalBorderThickness);
                              }
                              if (widgetCustomization.internalBorderColor) {
                                params.set("internalBorderColor", widgetCustomization.internalBorderColor);
                              }
                              if (widgetCustomization.fontFamily) {
                                params.set("fontFamily", widgetCustomization.fontFamily);
                              }
                              if (widgetCustomization.fontSize) {
                                params.set("fontSize", widgetCustomization.fontSize);
                              }
                              if (widgetCustomization.enableFileUpload === false) {
                                params.set("enableFileUpload", "false");
                              }
                              const previewParams = widgetPreviewSettingsToSearchParams(
                                widgetPreviewSettings
                              );
                              previewParams.forEach((value, key) => {
                                params.set(key, value);
                              });
                              const queryString = params.toString();
                              const previewUrl = `/workspaces/${workspaceId}/agents/${agentId}/widget-preview${queryString ? `?${queryString}` : ""}`;
                              window.open(previewUrl, "_blank", "noopener,noreferrer");
                            }}
                            className="flex items-center gap-2 rounded-xl border-2 border-primary-600 bg-white px-4 py-2.5 font-semibold text-primary-600 transition-all duration-200 hover:bg-primary-50 dark:border-primary-400 dark:bg-neutral-900 dark:text-primary-400 dark:hover:bg-neutral-800"
                          >
                            <ArrowTopRightOnSquareIcon className="size-5" />
                            Preview Widget
                          </button>
                        )}
                        <button
                          onClick={handleSaveWidgetConfig}
                          disabled={updateAgent.isPending}
                          className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {updateAgent.isPending
                            ? "Saving..."
                            : "Save Widget Configuration"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
            </AgentAccordionSection>
          )}

          {/* Stream Server Section */}
          {canEdit && (
            <AgentAccordionSection
              id="stream-server"
              title={
                <>
                  <SignalIcon className="mr-2 inline-block size-5" />
                  STREAM SERVER
                </>
              }
              expandedSection={expandedSection}
              onToggle={toggleSection}
              // Render eagerly so warnings and CORS guidance are immediate.
              lazy={false}
            >
              <div className="mb-4 space-y-3 text-sm opacity-75 dark:text-neutral-300">
                <p>
                  Stream servers enable real-time streaming responses from your
                  agent using Lambda Function URLs. Configure allowed origins
                  for CORS and manage the secret used to authenticate requests.
                </p>
                {!streamUrlData && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="mb-1 flex items-center gap-2 font-semibold text-amber-800">
                      <ExclamationTriangleIcon className="size-4" />
                      Streaming Function URL Not Configured
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
                  <p className="mb-2 font-semibold">
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
                  <ul className="mb-2 ml-2 list-inside list-disc space-y-1">
                    <li>
                      Text chunks:{" "}
                      <code className="bg-neutral-100 px-1 dark:bg-neutral-800">
                        data: {`{"type":"text-delta","textDelta":"Hello"}`}\n\n
                      </code>
                    </li>
                    <li>
                      Tool calls:{" "}
                      <code className="bg-neutral-100 px-1 dark:bg-neutral-800">
                        data:{" "}
                        {`{"type":"tool-call","toolCallId":"...","toolName":"...","args":{...}}`}
                        \n\n
                      </code>
                    </li>
                  </ul>
                  <p className="mb-2">To build a client:</p>
                  <ul className="mb-2 ml-2 list-inside list-disc space-y-1">
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
                      <code className="bg-neutral-100 px-1 dark:bg-neutral-800">
                        @ai-sdk/react
                      </code>{" "}
                      - it handles SSE parsing automatically
                    </li>
                    <li>
                      <strong>Other frameworks:</strong> Parse SSE format by
                      reading lines starting with{" "}
                      <code className="bg-neutral-100 px-1 dark:bg-neutral-800">
                        data:{" "}
                      </code>
                      , then parse the JSON object
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
                      className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored"
                    >
                      Create Stream Server
                    </button>
                  ) : (
                    <form
                      onSubmit={handleCreateStreamServer}
                      className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800"
                    >
                      <div className="mb-4">
                        <label className="mb-2 block text-sm font-semibold dark:text-neutral-300">
                          Allowed Origins
                        </label>
                        <p className="mb-2 text-xs opacity-75 dark:text-neutral-300">
                          Comma-separated list of allowed origins for CORS. Use
                          &quot;*&quot; to allow all origins.
                        </p>
                        <input
                          type="text"
                          value={allowedOrigins}
                          onChange={(e) => setAllowedOrigins(e.target.value)}
                          className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500"
                          placeholder="* or https://example.com, https://app.example.com"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={createStreamServer.isPending}
                          className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
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
                          className="rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 dark:bg-neutral-800"
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
                    <p className="mb-2 text-xs font-semibold">Stream URL:</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 break-all rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-800">
                        {getStreamUrl(streamServerConfig?.secret)}
                      </code>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(
                            getStreamUrl(streamServerConfig?.secret)
                          );
                        }}
                        className="whitespace-nowrap rounded-lg bg-gradient-primary px-4 py-2 text-xs font-semibold text-white transition-all duration-200 hover:shadow-colored"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                  {!isConfiguringStreamServer ? (
                    <div className="space-y-2">
                      <div>
                        <p className="mb-2 text-xs font-semibold">
                          Allowed Origins:
                        </p>
                        <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-800">
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
                          className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Test
                        </button>
                        <button
                          onClick={() => setIsConfiguringStreamServer(true)}
                          className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored"
                        >
                          Edit
                        </button>
                        <button
                          onClick={handleDeleteStreamServer}
                          disabled={deleteStreamServer.isPending}
                          className="rounded-xl bg-error-600 px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:bg-error-700 disabled:cursor-not-allowed disabled:opacity-50"
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
                      className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800"
                    >
                      <div className="mb-4">
                        <label className="mb-2 block text-sm font-semibold dark:text-neutral-300">
                          Allowed Origins
                        </label>
                        <p className="mb-2 text-xs opacity-75 dark:text-neutral-300">
                          Comma-separated list of allowed origins for CORS. Use
                          &quot;*&quot; to allow all origins.
                        </p>
                        <input
                          type="text"
                          value={allowedOrigins}
                          onChange={(e) => setAllowedOrigins(e.target.value)}
                          className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500"
                          placeholder="* or https://example.com, https://app.example.com"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={updateStreamServer.isPending}
                          className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
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
                          className="rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 dark:bg-neutral-800"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </AgentAccordionSection>
          )}

          {/* Webhooks Management Section */}
          <AgentAccordionSection
            id="keys"
            title={
              <>
                <LinkIcon className="mr-2 inline-block size-5" />
                WEBHOOKS
              </>
            }
            expandedSection={expandedSection}
            onToggle={toggleSection}
          >
              <p className="mb-4 text-sm opacity-75 dark:text-neutral-300">
                Webhook keys allow external services to send requests to this
                agent. Each key generates a unique webhook URL that can be used
                to trigger the agent from external systems. Keep your keys
                secure and rotate them regularly.
              </p>
              {canEdit && (
                <div className="mb-4 flex items-center justify-between">
                  <button
                    onClick={() => setIsCreatingKey(true)}
                    className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored"
                  >
                    Create Key
                  </button>
                </div>
              )}

              {isCreatingKey && canEdit && (
                <form
                  onSubmit={handleCreateKey}
                  className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800"
                >
                  <div className="mb-4">
                    <label className="mb-2 block text-sm font-semibold dark:text-neutral-300">
                      Key Name (optional)
                    </label>
                    <input
                      type="text"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-50"
                      placeholder="e.g., Production Key"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={createKey.isPending}
                      className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {createKey.isPending ? "Creating..." : "Create"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreatingKey(false);
                        setNewKeyName("");
                      }}
                      className="rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50 dark:hover:bg-neutral-700"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {keys.length === 0 ? (
                <p className="text-sm opacity-75 dark:text-neutral-300">
                  No keys created yet.
                </p>
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
          </AgentAccordionSection>

          {/* Bot Integrations Section */}
          <AgentAccordionSection
            id="bot-integrations"
            title={
              <>
                <ChatBubbleLeftRightIcon className="mr-2 inline-block size-5" />
                BOT INTEGRATIONS
              </>
            }
            expandedSection={expandedSection}
            onToggle={toggleSection}
          >
              <p className="mb-4 text-sm opacity-75 dark:text-neutral-300">
                Connect this agent to Slack or Discord bots to make it available
                to your team or community. Each integration creates a bot that
                responds to messages in the connected platform.
              </p>
              {canEdit && (
                <div className="mb-4 flex gap-2">
                  <button
                    onClick={() => setShowSlackModal(true)}
                    className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored"
                  >
                    Connect to Slack
                  </button>
                  <button
                    onClick={() => setShowDiscordModal(true)}
                    className="rounded-xl bg-indigo-600 px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:bg-indigo-700"
                  >
                    Connect to Discord
                  </button>
                </div>
              )}

              {agentIntegrations.length === 0 ? (
                <p className="text-sm opacity-75 dark:text-neutral-300">
                  No bot integrations yet. Connect to Slack or Discord to get
                  started.
                </p>
              ) : (
                <div className="space-y-4">
                  {agentIntegrations.map((integration) => (
                    <Suspense
                      key={integration.id}
                      fallback={<LoadingScreen compact />}
                    >
                      <IntegrationCard
                        integration={integration}
                        onDelete={handleDeleteIntegration}
                        onUpdate={handleUpdateIntegration}
                        onInstallCommand={handleInstallCommand}
                      />
                    </Suspense>
                  ))}
                </div>
              )}
          </AgentAccordionSection>
        </SectionGroup>

        <SectionGroup
          title={
            <>
              <CurrencyDollarIcon className="mr-2 inline-block size-5" />
              Billing & Usage
            </>
          }
        >
          {/* Spending Limits Section */}
          {canEdit && (
            <AgentAccordionSection
              id="spending-limits"
              title={
                <>
                  <CreditCardIcon className="mr-2 inline-block size-5" />
                  SPENDING LIMITS
                </>
              }
              expandedSection={expandedSection}
              onToggle={toggleSection}
            >
              <SpendingLimitsManager
                workspaceId={workspaceId}
                agentId={agentId}
                spendingLimits={agent.spendingLimits}
                canEdit={!!canEdit}
              />
            </AgentAccordionSection>
          )}

          {/* Usage Section */}
          <AgentAccordionSection
            id="usage"
            title={
              <>
                <ChartBarIcon className="mr-2 inline-block size-5" />
                Assistant usage
              </>
            }
            expandedSection={expandedSection}
            onToggle={toggleSection}
          >
            <AgentUsageSection workspaceId={workspaceId} agentId={agentId} />
          </AgentAccordionSection>

          {/* Transactions Section */}
          <AgentAccordionSection
            id="transactions"
            title={
              <>
                <CurrencyDollarIcon className="mr-2 inline-block size-5" />
                Payment history
              </>
            }
            expandedSection={expandedSection}
            onToggle={toggleSection}
          >
            <QueryPanel
              fallback={
                <LoadingScreen compact message="Loading transactions..." />
              }
            >
              <TransactionTable workspaceId={workspaceId} agentId={agentId} />
            </QueryPanel>
          </AgentAccordionSection>
        </SectionGroup>

        {canEdit && (
          <AgentAccordionSection
            id="danger"
            title={
              <>
                <ExclamationTriangleIcon className="mr-2 inline-block size-5" />
                DANGER ZONE
              </>
            }
            expandedSection={expandedSection}
            onToggle={toggleSection}
          >
              <p className="mb-4 text-sm opacity-75 dark:text-neutral-300">
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
                className="rounded-xl bg-error-600 px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:bg-error-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDeleting ? "Deleting..." : "Delete Agent"}
              </button>
          </AgentAccordionSection>
        )}

        <AgentDetailModals
          workspaceId={workspaceId}
          agentId={agentId}
          agent={agent}
          isEditing={isEditing}
          onCloseEdit={handleCloseModal}
          selectedConversationId={selectedConversationId}
          onCloseConversation={() => setSelectedConversationId(null)}
          isHelpOpen={isHelpOpen}
          onCloseHelp={() => setIsHelpOpen(false)}
          isImprovePromptOpen={isImprovePromptOpen}
          onCloseImprovePrompt={() => setIsImprovePromptOpen(false)}
          isModelPricesOpen={isModelPricesOpen}
          onCloseModelPrices={() => setIsModelPricesOpen(false)}
          modelPricesFilter={modelPricesFilter}
          isStreamTestModalOpen={isStreamTestModalOpen}
          onCloseStreamTestModal={() => setIsStreamTestModalOpen(false)}
          streamServerConfig={streamServerConfig}
          streamUrlData={streamUrlData}
          showSlackModal={showSlackModal}
          onCloseSlackModal={() => setShowSlackModal(false)}
          onSlackSuccess={() => {
            queryClient.invalidateQueries({
              queryKey: ["integrations", workspaceId],
            });
            setShowSlackModal(false);
          }}
          showDiscordModal={showDiscordModal}
          onCloseDiscordModal={() => setShowDiscordModal(false)}
          onDiscordSuccess={() => {
            queryClient.invalidateQueries({
              queryKey: ["integrations", workspaceId],
            });
            setShowDiscordModal(false);
          }}
          commandDialogState={commandDialogState}
          onCloseCommandDialog={() => setCommandDialogState(null)}
          onCommandDialogSuccess={handleCommandDialogSuccess}
        />
        {/*
        Modals - only load when opened
        */}
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
      trackEvent("agent_key_removed", {
        workspace_id: workspaceId,
        agent_id: agentId,
        key_id: keyData.id,
      });
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
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800">
      <div className="mb-2 flex items-start justify-between">
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-lg font-semibold dark:text-neutral-50">
              {keyData.name || `Key ${keyData.id.slice(0, 8)}`}
            </h3>
            {keyData.name && (
              <span className="text-xs opacity-75 dark:text-neutral-300">
                ({keyData.id.slice(0, 8)})
              </span>
            )}
          </div>
          <p className="mb-2 text-xs opacity-75 dark:text-neutral-300">
            Created: {new Date(keyData.createdAt).toLocaleString()}
          </p>
          <div className="mb-2">
            <p className="mb-1 text-xs font-semibold dark:text-neutral-300">
              Webhook URL:
            </p>
            <div className="flex items-center gap-2">
              <code
                onClick={handleCopyUrl}
                className="flex-1 cursor-pointer select-all break-all rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                title="Click to copy"
              >
                {webhookUrl}
              </code>
              <button
                onClick={handleCopyUrl}
                className="whitespace-nowrap rounded-lg bg-gradient-primary px-4 py-2 text-xs font-semibold text-white transition-all duration-200 hover:shadow-colored"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold dark:text-neutral-300">
              Key Value:
            </p>
            {keyData.key ? (
              <code className="block break-all rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                {keyData.key}
              </code>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-800 dark:bg-amber-900">
                <p className="mb-1 font-semibold dark:text-amber-200">
                  Key Value Not Available
                </p>
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
            className="ml-4 rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white transition-all duration-200 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDeleting || deleteKey.isPending ? "Deleting..." : "Delete"}
          </button>
        )}
      </div>
    </div>
  );
};

// Refresh button component for evaluations section
const EvaluationsRefreshButton: FC<{
  workspaceId: string;
  agentId: string;
  canEdit?: boolean;
  onImprovePrompt?: () => void;
}> = ({ workspaceId, agentId, canEdit = false, onImprovePrompt }) => {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Invalidate all evaluation-related queries
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [
            "workspaces",
            workspaceId,
            "agents",
            agentId,
            "eval-judges",
          ],
        }),
        queryClient.invalidateQueries({
          queryKey: [
            "workspaces",
            workspaceId,
            "agents",
            agentId,
            "eval-results",
          ],
        }),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="mb-4 flex items-center justify-end gap-2">
      {canEdit && onImprovePrompt && (
        <button
          onClick={onImprovePrompt}
          className="rounded-xl bg-gradient-primary px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:shadow-colored"
        >
          Improve Agent Prompt
        </button>
      )}
      <button
        onClick={handleRefresh}
        disabled={isRefreshing}
        className="flex items-center gap-2 rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
        title="Refresh all evaluation data"
      >
        <ArrowPathIcon
          className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
        />
        {isRefreshing ? "Refreshing..." : "Refresh"}
      </button>
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
  const hasTrackedUsage = useRef(false);
  const hasTrackedDailyUsage = useRef(false);
  const lastTrackedKey = useRef<string>("");

  // Track usage viewing - only once per data load
  useEffect(() => {
    const trackingKey = `${workspaceId}-${agentId}-${dateRangePreset}`;
    if (
      usageData &&
      !isLoading &&
      (!hasTrackedUsage.current || lastTrackedKey.current !== trackingKey)
    ) {
      trackEvent("agent_usage_viewed", {
        workspace_id: workspaceId,
        agent_id: agentId,
        date_range_preset: dateRangePreset,
      });
      hasTrackedUsage.current = true;
      lastTrackedKey.current = trackingKey;
    }
    if (isLoading) {
      hasTrackedUsage.current = false;
    }
  }, [usageData, isLoading, workspaceId, agentId, dateRangePreset]);

  // Track daily usage viewing - only once per data load
  useEffect(() => {
    if (dailyUsageData && !isLoadingDaily && !hasTrackedDailyUsage.current) {
      trackEvent("agent_usage_daily_viewed", {
        workspace_id: workspaceId,
        agent_id: agentId,
        date_range_preset: dateRangePreset,
      });
      hasTrackedDailyUsage.current = true;
    }
    if (isLoadingDaily) {
      hasTrackedDailyUsage.current = false;
    }
  }, [dailyUsageData, isLoadingDaily, workspaceId, agentId, dateRangePreset]);

  if (isLoading || isLoadingDaily) {
    return <LoadingScreen compact message="Loading usage..." />;
  }

  if (error) {
    return (
      <div>
        <p className="font-bold text-red-600">
          Error loading usage:{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  }

  if (dailyError) {
    return (
      <div>
        <p className="font-bold text-red-600">
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
      title="Usage over time"
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
        <div className="flex min-h-screen items-center justify-center bg-white p-8 dark:bg-neutral-950">
          <div className="w-full max-w-2xl rounded-xl border border-neutral-200 bg-white p-8 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
            <h1 className="mb-4 text-4xl font-semibold dark:text-neutral-50">
              Error
            </h1>
            <p className="mb-4 text-xl font-semibold text-red-600 dark:text-red-400">
              {error.message || "Failed to load agent"}
            </p>
            <div className="space-y-4">
              <button
                onClick={() => {
                  reset();
                  resetError();
                }}
                className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored"
              >
                Try Again
              </button>
              <button
                onClick={() => navigate(`/workspaces/${workspaceId || ""}`)}
                className="ml-4 rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
              >
                Back to Workspace
              </button>
            </div>
          </div>
        </div>
      )}
    >
      <Suspense fallback={<AgentLoadingFallback />}>
        <AgentDataLoader
          workspaceId={workspaceId!}
          agentId={agentId!}
          key={`${workspaceId}-${agentId}`}
        />
      </Suspense>
    </ErrorBoundary>
  );
};

export default AgentDetail;