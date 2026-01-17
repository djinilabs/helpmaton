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
  ArrowDownTrayIcon,
} from "@heroicons/react/24/outline";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { useState, Suspense, lazy, useEffect, useRef } from "react";
import type { FC } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";

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
const TransactionTable = lazy(() =>
  import("../components/TransactionTable").then((module) => ({
    default: module.TransactionTable,
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
import { useSubscription } from "../hooks/useSubscription";
import { useTrialStatus } from "../hooks/useTrialCredits";
import { useWorkspaceUsage, useWorkspaceDailyUsage } from "../hooks/useUsage";
import {
  useWorkspace,
  useUpdateWorkspace,
  useDeleteWorkspace,
  useExportWorkspace,
} from "../hooks/useWorkspaces";
import { useWorkspaceUserLimit } from "../hooks/useWorkspaceUserLimit";
import {
  setWorkspaceApiKey,
  deleteWorkspaceApiKey,
  type Workspace,
} from "../utils/api";
import { getBalanceColor } from "../utils/colorUtils";
import { formatCurrency } from "../utils/currency";
import { type DateRangePreset, getDateRange } from "../utils/dateRanges";
import { trackEvent } from "../utils/tracking";

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
  const { data: subscription } = useSubscription();

  // Check if OpenRouter key exists
  const hasKey = apiKeys?.openrouter || false;

  // Check if user is on free plan
  const isFreePlan = subscription?.plan === "free";

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
      {isFreePlan ? (
        <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-5 dark:border-orange-800 dark:bg-orange-950/50">
          <p className="mb-2 text-sm font-semibold text-orange-900 dark:text-orange-50">
            Using your own key is available on Starter and Pro
          </p>
          <p className="mb-3 text-sm text-orange-800 dark:text-orange-200">
            Upgrade to use your own provider key and pay the provider directly
            while still using Helpmaton&apos;s tools and dashboards.
          </p>
          <Link
            to="/subscription"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-primary px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:shadow-colored"
          >
            Upgrade plan
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
                d="M9 5l7 7-7 7"
              />
            </svg>
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-primary-200 bg-primary-50/50 p-5 dark:border-primary-800 dark:bg-primary-950/50">
          <p className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-50">
            Using your own AI key
          </p>
          <ul className="list-inside list-disc space-y-2 text-sm text-neutral-700 dark:text-neutral-300">
            <li>
              Add your OpenRouter key to use your own AI account for requests.
            </li>
            <li>
              If you don&apos;t add a key, we use your workspace credits (if
              available).
            </li>
            <li>
              When you use your own key, charges go to your OpenRouter account.
              We still track spending limits here.
            </li>
          </ul>
        </div>
      )}

      {hasKey && (
        <div className="rounded-xl border border-accent-200 bg-accent-50/50 p-5 dark:border-accent-800 dark:bg-accent-950/50">
          <p className="text-sm font-semibold text-accent-800 dark:text-accent-300">
            OpenRouter key is connected
          </p>
          <p className="mt-1.5 text-xs text-accent-700 dark:text-accent-400">
            This workspace will use your OpenRouter key. Workspace credits
            won&apos;t be used for requests.
          </p>
        </div>
      )}

      {!isFreePlan && (
        <div className="space-y-3">
          <div>
            <label className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              OpenRouter key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                hasKey
                  ? "Paste a new key to replace the current one"
                  : "Paste your OpenRouter key"
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
              {isSaving ? "Saving..." : "Save key"}
            </button>
            {hasKey && (
              <button
                onClick={handleClear}
                disabled={isSaving || isClearing}
                className="rounded-xl border border-neutral-300 bg-white px-5 py-2.5 text-sm font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
              >
                {isClearing ? "Removing..." : "Remove key"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const WorkspaceDataLoader: FC<{ workspaceId: string }> = ({ workspaceId }) => {
  // useWorkspace uses useSuspenseQuery, which will suspend until data is available
  const { data: workspace } = useWorkspace(workspaceId);

  // Verify workspace ID matches (safety check)
  if (workspace.id !== workspaceId) {
    return null;
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
  const exportWorkspace = useExportWorkspace(id!);

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
  const { data: subscription } = useSubscription();

  const canRead =
    workspace.permissionLevel &&
    workspace.permissionLevel >= PERMISSION_LEVELS.READ;
  const canEdit =
    workspace.permissionLevel &&
    workspace.permissionLevel >= PERMISSION_LEVELS.WRITE;
  const canDelete = workspace.permissionLevel === PERMISSION_LEVELS.OWNER;
  const isFreePlan = subscription?.plan === "free";

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
      trackEvent("workspace_deleted", {
        workspace_id: id,
      });
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
                Back to workspaces
              </button>
              <div className="flex items-center gap-3">
                {canRead && !isEditing && (
                  <button
                    onClick={() => exportWorkspace.mutate()}
                    disabled={exportWorkspace.isPending}
                    className="flex items-center gap-2 rounded-xl border border-neutral-300 bg-white px-5 py-2.5 text-sm font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
                  >
                    <ArrowDownTrayIcon className="size-4" />
                    {exportWorkspace.isPending ? "Exporting..." : "Export workspace"}
                  </button>
                )}
                {canEdit && !isEditing && (
                  <button
                    onClick={handleEdit}
                    className="rounded-xl bg-gradient-primary px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:shadow-colored"
                  >
                    Edit details
                  </button>
                )}
              </div>
            </div>
            <p className="mb-6 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
              This workspace is where your assistants, documents, and settings
              live. Use the sections below to manage spending, channels, and
              content.
            </p>

            {isEditing ? (
              <div className="space-y-5">
                <div>
                  <label className="mb-2.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    Workspace name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                    required
                  />
                  <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                    Keep it short so teammates can recognize it quickly.
                  </p>
                </div>
                <div>
                  <label className="mb-2.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    Description (optional)
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                    rows={4}
                  />
                  <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                    Add a short note about who this workspace is for.
                  </p>
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
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
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
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-neutral-500 dark:text-neutral-300">
                      Credit balance:
                    </span>
                    <span
                      className={`rounded-lg border px-3 py-1.5 text-lg font-semibold ${getBalanceColor(workspace.creditBalance ?? 0)}`}
                    >
                      {formatCurrency(workspace.creditBalance ?? 0, "usd", 10)}
                    </span>
                    <a
                      href="#credit-balance-section"
                      onClick={(e) => {
                        e.preventDefault();
                        const element = document.getElementById(
                          "credit-balance-section"
                        );
                        if (element) {
                          // Expand the section if it's collapsed
                          if (expandedSection !== "credits") {
                            toggleSection("credits");
                          }
                          // Scroll to the section after a brief delay to allow expansion
                          setTimeout(() => {
                            element.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                          }, 100);
                        }
                      }}
                      className="text-sm font-semibold text-primary-600 transition-colors duration-200 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                    >
                      Buy credits
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Trial Credit Request Button - Show when balance is 0 */}
        {workspace.creditBalance === 0 && canEdit && (
          <div className="bg-gradient-accent/5 mb-8 rounded-2xl border border-accent-200/50 p-8 shadow-medium dark:border-accent-800/50 dark:bg-accent-950/50">
            <h3 className="mb-3 text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
              Try with free credits
            </h3>
            <p className="mb-6 text-base leading-relaxed text-neutral-600 dark:text-neutral-300">
              Your balance is $0. Get a small set of trial credits ($2) to test
              the app.
            </p>
            <button
              onClick={() => setIsTrialCreditModalOpen(true)}
              className="rounded-xl bg-gradient-primary px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:shadow-colored"
            >
              Get trial credits
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
              Workspace items
            </>
          }
        >
          <AccordionSection
            id="agents"
            title={
              <>
                <CpuChipIcon className="mr-2 inline-block size-5" />
                Assistants (agents)
              </>
            }
            isExpanded={expandedSection === "agents"}
            onToggle={() => toggleSection("agents")}
          >
            <LazyAccordionContent isExpanded={expandedSection === "agents"}>
              <QueryPanel
                fallback={
                  <LoadingScreen compact message="Loading assistants..." />
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
                  <LoadingScreen compact message="Loading documents..." />
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
              Messages & channels
            </>
          }
        >
          <AccordionSection
            id="channels"
            title={
              <>
                <MegaphoneIcon className="mr-2 inline-block size-5" />
                Message channels
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
                    message="Loading channels..."
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
                Email connection
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
              Spending & usage
            </>
          }
        >
          <div id="credit-balance-section" className="scroll-mt-8">
            <AccordionSection
              id="credits"
              title={
                <>
                  <CreditCardIcon className="mr-2 inline-block size-5" />
                  Credit balance
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
                  {isFreePlan ? (
                    <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-5 dark:border-orange-800 dark:bg-orange-950/50">
                      <p className="mb-2 text-sm font-semibold text-orange-900 dark:text-orange-50">
                        Buying credits is only available on Starter and Pro
                      </p>
                      <p className="mb-3 text-sm text-orange-800 dark:text-orange-200">
                        Upgrade to buy credits and add funds to your workspace
                        balance.
                      </p>
                      <Link
                        to="/subscription"
                        className="inline-flex items-center gap-2 rounded-xl bg-gradient-primary px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:shadow-colored"
                      >
                        Upgrade plan
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
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </Link>
                    </div>
                  ) : (
                    <CreditPurchase workspaceId={id!} />
                  )}
                </div>
              )}
            </LazyAccordionContent>
          </AccordionSection>
          </div>

          {canEdit && (
            <AccordionSection
              id="spending-limits"
              title={
                <>
                  <ArrowTrendingDownIcon className="mr-2 inline-block size-5" />
                  Spending limits
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
                Usage over time
              </>
            }
            isExpanded={expandedSection === "usage"}
            onToggle={() => toggleSection("usage")}
          >
            <LazyAccordionContent isExpanded={expandedSection === "usage"}>
              <WorkspaceUsageSection workspaceId={id!} />
            </LazyAccordionContent>
          </AccordionSection>

          <AccordionSection
            id="transactions"
            title={
              <>
                <CurrencyDollarIcon className="mr-2 inline-block size-5" />
                Payment history
              </>
            }
            isExpanded={expandedSection === "transactions"}
            onToggle={() => toggleSection("transactions")}
          >
            <LazyAccordionContent
              isExpanded={expandedSection === "transactions"}
            >
              <QueryPanel
                fallback={
                  <LoadingScreen compact message="Loading transactions..." />
                }
              >
                <TransactionTable workspaceId={id!} />
              </QueryPanel>
            </LazyAccordionContent>
          </AccordionSection>
        </SectionGroup>

        <SectionGroup
          title={
            <>
              <Cog6ToothIcon className="mr-2 inline-block size-5" />
              Settings
            </>
          }
        >
          {canEdit && (
            <AccordionSection
              id="api-key"
              title={
                <>
                  <KeyIcon className="mr-2 inline-block size-5" />
                  Workspace API key
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
                  Connected tools (MCP)
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
              Team members
            </>
          }
          isExpanded={expandedSection === "team"}
          onToggle={() => toggleSection("team")}
        >
          <LazyAccordionContent isExpanded={expandedSection === "team"}>
            <QueryPanel
              fallback={
                <LoadingScreen compact message="Loading team..." />
              }
            >
              <div className="space-y-6">
                <TeamMembers workspaceId={id!} canManage={!!canDelete} />
                {canDelete && (
                  <div className="border-t border-neutral-200 pt-6">
                    {userLimit && !userLimit.canInvite && (
                      <div className="mb-6 border-4 border-error-600 bg-error-50 p-5">
                        <div className="mb-2 text-lg font-bold text-error-900">
                      Team limit reached
                        </div>
                        <div className="text-sm font-semibold text-error-800">
                      Your {userLimit.plan} plan allows up to{" "}
                      {userLimit.maxUsers} teammate
                      {userLimit.maxUsers !== 1 ? "s" : ""}. You currently
                      have {userLimit.currentUserCount} teammate
                      {userLimit.currentUserCount !== 1 ? "s" : ""}.
                        </div>
                        {userLimit.plan !== "pro" && (
                          <div className="mt-2 text-sm font-semibold text-error-800">
                        Upgrade to Pro to invite up to 5 teammates.
                          </div>
                        )}
                      </div>
                    )}
                    <h3 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                  Invite a teammate
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
                Delete workspace
              </>
            }
            isExpanded={expandedSection === "danger"}
            onToggle={() => toggleSection("danger")}
          >
            <p className="mb-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
              Deleting a workspace permanently removes all assistants,
              documents, conversations, and settings.
            </p>
            <p className="mb-6 font-medium text-neutral-700 dark:text-neutral-300">
              This can&apos;t be undone.
            </p>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="rounded-xl bg-error-600 px-6 py-3 font-semibold text-white shadow-medium transition-all duration-200 hover:bg-error-700 hover:shadow-large disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isDeleting ? "Deleting..." : "Delete workspace"}
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
  const hasTrackedUsage = useRef(false);
  const hasTrackedDailyUsage = useRef(false);
  const lastTrackedKey = useRef<string>("");

  // Track workspace usage viewing - only once per data load
  useEffect(() => {
    const trackingKey = `${workspaceId}-${dateRangePreset}`;
    if (
      usageData &&
      !isLoadingUsage &&
      (!hasTrackedUsage.current || lastTrackedKey.current !== trackingKey)
    ) {
      trackEvent("workspace_usage_viewed", {
        workspace_id: workspaceId,
        date_range_preset: dateRangePreset,
      });
      hasTrackedUsage.current = true;
      lastTrackedKey.current = trackingKey;
    }
    if (isLoadingUsage) {
      hasTrackedUsage.current = false;
    }
  }, [usageData, isLoadingUsage, workspaceId, dateRangePreset]);

  // Track workspace daily usage viewing - only once per data load
  useEffect(() => {
    if (dailyData && !isLoadingDaily && !hasTrackedDailyUsage.current) {
      trackEvent("workspace_usage_daily_viewed", {
        workspace_id: workspaceId,
        date_range_preset: dateRangePreset,
      });
      hasTrackedDailyUsage.current = true;
    }
    if (isLoadingDaily) {
      hasTrackedDailyUsage.current = false;
    }
  }, [dailyData, isLoadingDaily, workspaceId, dateRangePreset]);

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
      <Suspense fallback={<LoadingScreen message="Loading workspace..." />}>
        <WorkspaceDataLoader workspaceId={id!} key={id} />
      </Suspense>
    </ErrorBoundary>
  );
};

export default WorkspaceDetail;
