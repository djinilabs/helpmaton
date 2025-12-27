import {
  ArchiveBoxIcon,
  ChatBubbleLeftRightIcon,
  CurrencyDollarIcon,
  Cog6ToothIcon,
  BoltIcon,
  CpuChipIcon,
  DocumentTextIcon,
  MegaphoneIcon,
  EnvelopeIcon,
  CreditCardIcon,
  ArrowTrendingDownIcon,
  ChartBarIcon,
  KeyIcon,
  UsersIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { useQueryErrorResetBoundary, useQuery } from "@tanstack/react-query";
import { useState, Suspense, lazy } from "react";
import type { FC } from "react";
import { useParams, useNavigate } from "react-router-dom";

import { AccordionSection } from "../components/AccordionSection";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { LazyAccordionContent } from "../components/LazyAccordionContent";
import { LoadingScreen } from "../components/LoadingScreen";
import { QueryPanel } from "../components/QueryPanel";
import { SectionGroup } from "../components/SectionGroup";
import { TrialUsageBar } from "../components/TrialUsageBar";
// Lazy load modals - only load when opened
const TrialCreditRequestModal = lazy(() =>
  import("../components/TrialCreditRequestModal").then((module) => ({
    default: module.TrialCreditRequestModal,
  }))
);
const UpgradeModal = lazy(() =>
  import("../components/UpgradeModal").then((module) => ({
    default: module.UpgradeModal,
  }))
);
// Lazy load accordion components
const AgentList = lazy(() =>
  import("../components/AgentList").then((module) => ({
    default: module.AgentList,
  }))
);
const ChannelList = lazy(() =>
  import("../components/ChannelList").then((module) => ({
    default: module.ChannelList,
  }))
);
const CreditBalance = lazy(() =>
  import("../components/CreditBalance").then((module) => ({
    default: module.CreditBalance,
  }))
);
const CreditPurchase = lazy(() =>
  import("../components/CreditPurchase").then((module) => ({
    default: module.CreditPurchase,
  }))
);
const DocumentList = lazy(() =>
  import("../components/DocumentList").then((module) => ({
    default: module.DocumentList,
  }))
);
const DocumentUpload = lazy(() =>
  import("../components/DocumentUpload").then((module) => ({
    default: module.DocumentUpload,
  }))
);
const EmailConnectionCard = lazy(() =>
  import("../components/EmailConnectionCard").then((module) => ({
    default: module.EmailConnectionCard,
  }))
);
const McpServerList = lazy(() =>
  import("../components/McpServerList").then((module) => ({
    default: module.McpServerList,
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
const TeamMembers = lazy(() =>
  import("../components/TeamMembers").then((module) => ({
    default: module.TeamMembers,
  }))
);
const InviteMember = lazy(() =>
  import("../components/InviteMember").then((module) => ({
    default: module.InviteMember,
  }))
);
import { useAccordion } from "../hooks/useAccordion";
import { useTrialStatus } from "../hooks/useTrialCredits";
import { useWorkspaceUsage, useWorkspaceDailyUsage } from "../hooks/useUsage";
import { useUpdateWorkspace, useDeleteWorkspace } from "../hooks/useWorkspaces";
import { useWorkspaceUserLimit } from "../hooks/useWorkspaceUserLimit";
import {
  getWorkspace,
  setWorkspaceApiKey,
  deleteWorkspaceApiKey,
  type Workspace,
} from "../utils/api";
import { type DateRangePreset, getDateRange } from "../utils/dateRanges";

const PERMISSION_LEVELS = {
  READ: 1,
  WRITE: 2,
  OWNER: 3,
};

interface WorkspaceApiKeyManagerProps {
  workspaceId: string;
  apiKeys?: {
    openrouter?: boolean;
  };
}

const WorkspaceApiKeyManager: FC<WorkspaceApiKeyManagerProps> = ({
  workspaceId,
  apiKeys,
}) => {
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Check if OpenRouter key exists
  const hasKey = apiKeys?.openrouter || false;

  const handleSave = async () => {
    if (!apiKey.trim()) {
      return;
    }
    setIsSaving(true);
    try {
      await setWorkspaceApiKey(workspaceId, apiKey.trim(), "openrouter");
      setApiKey("");
      window.location.reload(); // Reload to update hasKey status
    } catch (error) {
      console.error("Error setting API key:", error);
      alert("Failed to set API key. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    if (!confirm("Are you sure you want to clear the API key?")) {
      return;
    }
    setIsClearing(true);
    try {
      await deleteWorkspaceApiKey(workspaceId, "openrouter");
      window.location.reload(); // Reload to update hasKey status
    } catch (error) {
      console.error("Error clearing API key:", error);
      alert("Failed to clear API key. Please try again.");
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary-200 bg-primary-50/50 p-5 dark:border-primary-800 dark:bg-primary-950/50">
        <p className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-50">Help:</p>
        <ul className="list-inside list-disc space-y-2 text-sm text-neutral-700 dark:text-neutral-300">
          <li>
            Configure your OpenRouter API key to use your own key for LLM requests
          </li>
          <li>
            By default, if you add no key, we will use workspace credits (if
            any)
          </li>
          <li>
            When you add an OpenRouter key, you are responsible for the billing and
            correctness of the key. Costs will be applied to your spending rate limits
            but will not be deducted from workspace credits.
          </li>
        </ul>
      </div>

      {hasKey && (
        <div className="rounded-xl border border-accent-200 bg-accent-50/50 p-5 dark:border-accent-800 dark:bg-accent-950/50">
          <p className="text-sm font-semibold text-accent-800 dark:text-accent-300">
            OpenRouter API Key is Configured
          </p>
          <p className="mt-1.5 text-xs text-accent-700 dark:text-accent-400">
            An OpenRouter API key is currently set for this workspace. Requests will use your key,
            costs will be applied to spending rate limits, and workspace credits will not be deducted.
          </p>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            OpenRouter API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              hasKey
                ? "Enter new key to replace existing"
                : "Enter your OpenRouter API key"
            }
            className="w-full rounded-xl border border-neutral-300 bg-white p-3 font-mono text-sm text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
            disabled={isSaving || isClearing}
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={!apiKey.trim() || isSaving || isClearing}
            className="rounded-xl bg-gradient-primary px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none"
          >
            {isSaving ? "Saving..." : "Save Key"}
          </button>
          {hasKey && (
            <button
              onClick={handleClear}
              disabled={isSaving || isClearing}
              className="rounded-xl border border-neutral-300 bg-white px-5 py-2.5 text-sm font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              {isClearing ? "Clearing..." : "Clear Key"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const WorkspaceDataLoader: FC<{ workspaceId: string }> = ({ workspaceId }) => {
  const {
    data: workspace,
    isLoading,
    isFetching,
    isPending,
    error,
  } = useQuery({
    queryKey: ["workspaces", workspaceId],
    queryFn: () => getWorkspace(workspaceId),
    refetchOnMount: "always", // Always refetch when component mounts (on navigation)
    staleTime: 0, // Consider data stale immediately to force refetch
  });

  // Check if we have data that matches the current workspaceId
  // If workspace exists but doesn't match, it's stale data from a previous workspace
  const hasMatchingData = workspace && workspace.id === workspaceId;

  // Show loading if:
  // 1. We don't have matching data for the current workspaceId
  // 2. Query is actively fetching (isFetching) - shows loading even with cached data
  // 3. Query is pending or loading
  // This ensures loading shows during navigation even if there's cached data for a different workspace
  const shouldShowLoading =
    !hasMatchingData || isLoading || isPending || isFetching;

  if (shouldShowLoading) {
    return <LoadingScreen message="Loading workspace..." />;
  }

  if (error || !workspace) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-soft p-8 dark:bg-gradient-soft-dark">
        <div className="w-full max-w-2xl rounded-2xl border border-error-200 bg-white p-8 shadow-large dark:border-error-700 dark:bg-neutral-900 lg:p-10">
          <h1 className="mb-4 text-4xl font-semibold text-neutral-900 dark:text-neutral-50">
            Error
          </h1>
          <p className="mb-6 text-xl font-semibold text-error-600 dark:text-error-400">
            {error instanceof Error
              ? error.message
              : "Failed to load workspace"}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl bg-gradient-primary px-6 py-3 font-semibold text-white transition-all duration-200 hover:shadow-colored"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return <WorkspaceDetailContent workspace={workspace} />;
};

interface WorkspaceDetailContentProps {
  workspace: Workspace;
}

const WorkspaceDetailContent: FC<WorkspaceDetailContentProps> = ({
  workspace,
}) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const updateWorkspace = useUpdateWorkspace(id!);
  const deleteWorkspace = useDeleteWorkspace(id!);

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description || "");
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentFolder, setCurrentFolder] = useState<string>("");
  const [isTrialCreditModalOpen, setIsTrialCreditModalOpen] = useState(false);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);

  const { expandedSection, toggleSection } = useAccordion("workspace-detail");
  const { data: trialStatus } = useTrialStatus(id!);
  const { data: userLimit } = useWorkspaceUserLimit(id!);

  const canEdit =
    workspace.permissionLevel &&
    workspace.permissionLevel >= PERMISSION_LEVELS.WRITE;
  const canDelete = workspace.permissionLevel === PERMISSION_LEVELS.OWNER;

  const handleEdit = () => {
    setName(workspace.name);
    setDescription(workspace.description || "");
    setIsEditing(true);
  };

  const handleSave = async () => {
    try {
      await updateWorkspace.mutateAsync({
        name,
        description: description || undefined,
      });
      setIsEditing(false);
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const handleCancel = () => {
    setName(workspace.name);
    setDescription(workspace.description || "");
    setIsEditing(false);
  };

  const handleDelete = async () => {
    if (
      !confirm(
        "Are you sure you want to delete this workspace? This action cannot be undone."
      )
    ) {
      return;
    }
    setIsDeleting(true);
    try {
      await deleteWorkspace.mutateAsync();
      navigate("/workspaces");
    } catch {
      // Error is handled by toast in the hook
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-soft p-6 dark:bg-gradient-soft-dark lg:p-10">
      <div className="mx-auto max-w-5xl">
        <div className="relative mb-8 overflow-hidden rounded-2xl border border-neutral-200 bg-white p-8 shadow-large dark:border-neutral-700 dark:bg-neutral-900 lg:p-10">
          <div className="absolute right-0 top-0 size-96 -translate-y-1/2 translate-x-1/2 rounded-full bg-gradient-primary opacity-5 blur-3xl"></div>
          <div className="relative z-10">
            <div className="mb-6 flex items-center justify-between">
              <button
                onClick={() => navigate("/workspaces")}
                className="flex items-center gap-2 rounded-xl border border-neutral-300 bg-white px-5 py-2.5 text-sm font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
              >
                <svg
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
                Back
              </button>
              {canEdit && !isEditing && (
                <button
                  onClick={handleEdit}
                  className="rounded-xl bg-gradient-primary px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:shadow-colored"
                >
                  Edit
                </button>
              )}
            </div>
            <p className="mb-6 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
              This workspace contains your agents, documents, and settings. Use
              the sections below to manage credits, spending limits, channels,
              agents, and documents.
            </p>

            {isEditing ? (
              <div className="space-y-5">
                <div>
                  <label className="mb-2.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                    required
                  />
                </div>
                <div>
                  <label className="mb-2.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                    rows={4}
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleSave}
                    disabled={updateWorkspace.isPending || !name.trim()}
                    className="rounded-xl bg-gradient-primary px-6 py-3 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none"
                  >
                    {updateWorkspace.isPending ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={updateWorkspace.isPending}
                    className="rounded-xl border border-neutral-300 bg-white px-6 py-3 font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <h1 className="mb-4 text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 lg:text-5xl">
                  {workspace.name}
                </h1>
                {workspace.description && (
                  <p className="mb-4 text-xl leading-relaxed text-neutral-700 dark:text-neutral-300">
                    {workspace.description}
                  </p>
                )}
                <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-300">
                  <svg
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <span>
                    Created {new Date(workspace.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Trial Credit Request Button - Show when balance is 0 */}
        {workspace.creditBalance === 0 && canEdit && (
          <div className="bg-gradient-accent/5 mb-8 rounded-2xl border border-accent-200/50 p-8 shadow-medium dark:border-accent-800/50 dark:bg-accent-950/50">
            <h3 className="mb-3 text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
              Trial Credits
            </h3>
            <p className="mb-6 text-base leading-relaxed text-neutral-600 dark:text-neutral-300">
              Your workspace balance is 0. Request trial credits (2 USD) to test
              the application.
            </p>
            <button
              onClick={() => setIsTrialCreditModalOpen(true)}
              className="rounded-xl bg-gradient-primary px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:shadow-colored"
            >
              Request Trial Credits
            </button>
          </div>
        )}

        {/* Trial Usage Bar */}
        {trialStatus?.creditsApproved && (
          <TrialUsageBar
            workspaceId={id!}
            onUpgradeClick={() => setIsUpgradeModalOpen(true)}
          />
        )}

        <SectionGroup
          title={
            <>
              <ArchiveBoxIcon className="mr-2 inline-block size-5" />
              Resources
            </>
          }
        >
          <AccordionSection
            id="agents"
            title={
              <>
                <CpuChipIcon className="mr-2 inline-block size-5" />
                Agents
              </>
            }
            isExpanded={expandedSection === "agents"}
            onToggle={() => toggleSection("agents")}
          >
            <LazyAccordionContent isExpanded={expandedSection === "agents"}>
              <QueryPanel
                fallback={
                  <LoadingScreen compact message="Assembling agent squad..." />
                }
              >
                <AgentList workspaceId={id!} canEdit={!!canEdit} />
              </QueryPanel>
            </LazyAccordionContent>
          </AccordionSection>

          <AccordionSection
            id="documents"
            title={
              <>
                <DocumentTextIcon className="mr-2 inline-block size-5" />
                Documents
              </>
            }
            isExpanded={expandedSection === "documents"}
            onToggle={() => toggleSection("documents")}
          >
            <LazyAccordionContent isExpanded={expandedSection === "documents"}>
              <QueryPanel
                fallback={
                  <LoadingScreen compact message="Organizing paper trail..." />
                }
              >
                <DocumentList
                  workspaceId={id!}
                  currentFolder={currentFolder}
                  onFolderChange={setCurrentFolder}
                  canEdit={!!canEdit}
                />
                {canEdit && (
                  <DocumentUpload
                    workspaceId={id!}
                    currentFolder={currentFolder}
                  />
                )}
              </QueryPanel>
            </LazyAccordionContent>
          </AccordionSection>
        </SectionGroup>

        <SectionGroup
          title={
            <>
              <ChatBubbleLeftRightIcon className="mr-2 inline-block size-5" />
              Communications
            </>
          }
        >
          <AccordionSection
            id="channels"
            title={
              <>
                <MegaphoneIcon className="mr-2 inline-block size-5" />
                Channels
              </>
            }
            isExpanded={expandedSection === "channels"}
            onToggle={() => toggleSection("channels")}
          >
            <LazyAccordionContent isExpanded={expandedSection === "channels"}>
              <QueryPanel
                fallback={
                  <LoadingScreen
                    compact
                    message="Tuning communication frequencies..."
                  />
                }
              >
                <ChannelList workspaceId={id!} canEdit={!!canEdit} />
              </QueryPanel>
            </LazyAccordionContent>
          </AccordionSection>

          <AccordionSection
            id="email-connection"
            title={
              <>
                <EnvelopeIcon className="mr-2 inline-block size-5" />
                Email Connection
              </>
            }
            isExpanded={expandedSection === "email-connection"}
            onToggle={() => toggleSection("email-connection")}
          >
            <LazyAccordionContent
              isExpanded={expandedSection === "email-connection"}
            >
              <ErrorBoundary>
                <EmailConnectionCard workspaceId={id!} />
              </ErrorBoundary>
            </LazyAccordionContent>
          </AccordionSection>
        </SectionGroup>

        <SectionGroup
          title={
            <>
              <CurrencyDollarIcon className="mr-2 inline-block size-5" />
              Billing & Usage
            </>
          }
        >
          <AccordionSection
            id="credits"
            title={
              <>
                <CreditCardIcon className="mr-2 inline-block size-5" />
                Credit Balance
              </>
            }
            isExpanded={expandedSection === "credits"}
            onToggle={() => toggleSection("credits")}
          >
            <LazyAccordionContent isExpanded={expandedSection === "credits"}>
              <CreditBalance
                workspaceId={id!}
                balance={workspace.creditBalance ?? 0}
                canEdit={!!canEdit}
              />
              {canEdit && (
                <div className="mt-6">
                  <CreditPurchase workspaceId={id!} />
                </div>
              )}
            </LazyAccordionContent>
          </AccordionSection>

          {canEdit && (
            <AccordionSection
              id="spending-limits"
              title={
                <>
                  <ArrowTrendingDownIcon className="mr-2 inline-block size-5" />
                  Spending Limits
                </>
              }
              isExpanded={expandedSection === "spending-limits"}
              onToggle={() => toggleSection("spending-limits")}
            >
              <LazyAccordionContent
                isExpanded={expandedSection === "spending-limits"}
              >
                <SpendingLimitsManager
                  workspaceId={id!}
                  spendingLimits={workspace.spendingLimits}
                  canEdit={!!canEdit}
                />
              </LazyAccordionContent>
            </AccordionSection>
          )}

          <AccordionSection
            id="usage"
            title={
              <>
                <ChartBarIcon className="mr-2 inline-block size-5" />
                Workspace Usage
              </>
            }
            isExpanded={expandedSection === "usage"}
            onToggle={() => toggleSection("usage")}
          >
            <LazyAccordionContent isExpanded={expandedSection === "usage"}>
              <WorkspaceUsageSection workspaceId={id!} />
            </LazyAccordionContent>
          </AccordionSection>
        </SectionGroup>

        <SectionGroup
          title={
            <>
              <Cog6ToothIcon className="mr-2 inline-block size-5" />
              Configuration
            </>
          }
        >
          {canEdit && (
            <AccordionSection
              id="api-key"
              title={
                <>
                  <KeyIcon className="mr-2 inline-block size-5" />
                  API Key
                </>
              }
              isExpanded={expandedSection === "api-key"}
              onToggle={() => toggleSection("api-key")}
            >
              <LazyAccordionContent isExpanded={expandedSection === "api-key"}>
                <WorkspaceApiKeyManager
                  workspaceId={id!}
                  apiKeys={workspace.apiKeys}
                />
              </LazyAccordionContent>
            </AccordionSection>
          )}

          {canEdit && (
            <AccordionSection
              id="mcp-servers"
              title={
                <>
                  <BoltIcon className="mr-2 inline-block size-5" />
                  MCP Servers
                </>
              }
              isExpanded={expandedSection === "mcp-servers"}
              onToggle={() => toggleSection("mcp-servers")}
            >
              <LazyAccordionContent
                isExpanded={expandedSection === "mcp-servers"}
              >
                <McpServerList workspaceId={id!} canEdit={!!canEdit} />
              </LazyAccordionContent>
            </AccordionSection>
          )}
        </SectionGroup>

        <AccordionSection
          id="team"
          title={
            <>
              <UsersIcon className="mr-2 inline-block size-5" />
              Team
            </>
          }
          isExpanded={expandedSection === "team"}
          onToggle={() => toggleSection("team")}
        >
          <LazyAccordionContent isExpanded={expandedSection === "team"}>
            <QueryPanel
              fallback={
                <LoadingScreen compact message="Gathering the crew..." />
              }
            >
              <div className="space-y-6">
                <TeamMembers workspaceId={id!} canManage={!!canDelete} />
                {canDelete && (
                  <div className="border-t border-neutral-200 pt-6">
                    {userLimit && !userLimit.canInvite && (
                      <div className="mb-6 border-4 border-error-600 bg-error-50 p-5">
                        <div className="mb-2 text-lg font-bold text-error-900">
                          User Limit Reached
                        </div>
                        <div className="text-sm font-semibold text-error-800">
                          Your {userLimit.plan} plan allows a maximum of{" "}
                          {userLimit.maxUsers} user
                          {userLimit.maxUsers !== 1 ? "s" : ""}. You currently
                          have {userLimit.currentUserCount} user
                          {userLimit.currentUserCount !== 1 ? "s" : ""}.
                        </div>
                        {userLimit.plan !== "pro" && (
                          <div className="mt-2 text-sm font-semibold text-error-800">
                            Upgrade to Pro plan to invite up to 5 users.
                          </div>
                        )}
                      </div>
                    )}
                    <h3 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                      Invite Member
                    </h3>
                    <InviteMember
                      workspaceId={id!}
                      canInvite={userLimit?.canInvite ?? true}
                    />
                  </div>
                )}
              </div>
            </QueryPanel>
          </LazyAccordionContent>
        </AccordionSection>

        {canDelete && (
          <AccordionSection
            id="danger"
            title={
              <>
                <ExclamationTriangleIcon className="mr-2 inline-block size-5" />
                Danger Zone
              </>
            }
            isExpanded={expandedSection === "danger"}
            onToggle={() => toggleSection("danger")}
          >
            <p className="mb-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
              This section contains destructive actions. Deleting a workspace
              will permanently remove all agents, documents, conversations, and
              settings. This action cannot be undone.
            </p>
            <p className="mb-6 font-medium text-neutral-700 dark:text-neutral-300">
              Deleting a workspace is permanent and cannot be undone.
            </p>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="rounded-xl bg-error-600 px-6 py-3 font-semibold text-white shadow-medium transition-all duration-200 hover:bg-error-700 hover:shadow-large disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isDeleting ? "Deleting..." : "Delete Workspace"}
            </button>
          </AccordionSection>
        )}
      </div>

      {/* Modals - only load when opened */}
      {isTrialCreditModalOpen && (
        <Suspense fallback={<LoadingScreen />}>
          <TrialCreditRequestModal
            isOpen={isTrialCreditModalOpen}
            onClose={() => setIsTrialCreditModalOpen(false)}
            workspaceId={id!}
          />
        </Suspense>
      )}
      {isUpgradeModalOpen && (
        <Suspense fallback={<LoadingScreen />}>
          <UpgradeModal
            isOpen={isUpgradeModalOpen}
            onClose={() => setIsUpgradeModalOpen(false)}
            onUpgrade={() => {
              // TODO: Implement upgrade flow
              setIsUpgradeModalOpen(false);
              alert("Upgrade functionality coming soon!");
            }}
          />
        </Suspense>
      )}
    </div>
  );
};

interface WorkspaceUsageSectionProps {
  workspaceId: string;
}

const WorkspaceUsageSection: FC<WorkspaceUsageSectionProps> = ({
  workspaceId,
}) => {
  const [dateRangePreset, setDateRangePreset] =
    useState<DateRangePreset>("last-30-days");
  const dateRange = getDateRange(dateRangePreset);

  const {
    data: usageData,
    isLoading: isLoadingUsage,
    error: usageError,
    refetch: refetchUsage,
    isRefetching: isRefetchingUsage,
  } = useWorkspaceUsage(workspaceId, {
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });
  const {
    data: dailyData,
    isLoading: isLoadingDaily,
    error: dailyError,
    refetch: refetchDaily,
    isRefetching: isRefetchingDaily,
  } = useWorkspaceDailyUsage(workspaceId, {
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });

  const handleRefresh = () => {
    refetchUsage();
    refetchDaily();
  };

  const isRefreshing = isRefetchingUsage || isRefetchingDaily;

  if (isLoadingUsage || isLoadingDaily) {
    return <LoadingScreen compact message="Loading usage..." />;
  }

  if (usageError) {
    return (
      <div>
        <p className="font-semibold text-red-700">
          Error loading usage:{" "}
          {usageError instanceof Error ? usageError.message : "Unknown error"}
        </p>
      </div>
    );
  }

  if (dailyError) {
    return (
      <div>
        <p className="font-semibold text-red-700">
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
      dailyData={dailyData?.daily}
      title="Workspace Usage"
      dateRange={dateRange}
      dateRangePreset={dateRangePreset}
      onDateRangeChange={setDateRangePreset}
      onRefresh={handleRefresh}
      isRefreshing={isRefreshing}
      showBorder={false}
    />
  );
};

const WorkspaceDetail: FC = () => {
  const { reset } = useQueryErrorResetBoundary();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  return (
    <ErrorBoundary
      fallback={(error, resetError) => (
        <div className="flex min-h-screen items-center justify-center bg-gradient-soft p-8 dark:bg-gradient-soft-dark">
          <div className="w-full max-w-2xl rounded-2xl border border-error-200 bg-white p-8 shadow-large dark:border-error-700 dark:bg-neutral-900 lg:p-10">
            <h1 className="mb-4 text-4xl font-semibold text-neutral-900 dark:text-neutral-50">
              Error
            </h1>
            <p className="mb-6 text-xl font-semibold text-error-600 dark:text-error-400">
              {error.message || "Failed to load workspace"}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  reset();
                  resetError();
                }}
                className="rounded-xl bg-gradient-primary px-6 py-3 font-semibold text-white transition-all duration-200 hover:shadow-colored"
              >
                Try Again
              </button>
              <button
                onClick={() => navigate("/workspaces")}
                className="rounded-xl border border-neutral-300 bg-white px-6 py-3 font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
              >
                Back to Workspaces
              </button>
            </div>
          </div>
        </div>
      )}
    >
      <WorkspaceDataLoader workspaceId={id!} />
    </ErrorBoundary>
  );
};

export default WorkspaceDetail;
