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
    google: boolean;
    openai: boolean;
    anthropic: boolean;
  };
  hasGoogleApiKey?: boolean; // For backward compatibility
}

const WorkspaceApiKeyManager: FC<WorkspaceApiKeyManagerProps> = ({
  workspaceId,
  apiKeys,
  hasGoogleApiKey,
}) => {
  const [selectedProvider, setSelectedProvider] = useState<
    "google" | "openai" | "anthropic"
  >("google");
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Determine if current provider has a key
  const hasKey = apiKeys
    ? apiKeys[selectedProvider]
    : selectedProvider === "google" && (hasGoogleApiKey || false);

  const providerDisplayNames: Record<string, string> = {
    google: "Google AI",
    openai: "OpenAI",
    anthropic: "Anthropic",
  };

  const handleSave = async () => {
    if (!apiKey.trim()) {
      return;
    }
    setIsSaving(true);
    try {
      await setWorkspaceApiKey(workspaceId, apiKey.trim(), selectedProvider);
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
      await deleteWorkspaceApiKey(workspaceId, selectedProvider);
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
      <div className="border border-primary-200 rounded-xl p-5 bg-primary-50/50">
        <p className="text-sm font-semibold text-neutral-900 mb-3">Help:</p>
        <ul className="text-sm space-y-2 list-disc list-inside text-neutral-700">
          <li>
            Select the LLM provider for which you want to configure an API key
          </li>
          <li>
            By default, if you add no key, we will use workspace credits (if
            any)
          </li>
          <li>
            When you add a key, you are responsible for the billing and
            correctness of the key
          </li>
        </ul>
      </div>

      {hasKey && (
        <div className="border border-accent-200 rounded-xl p-5 bg-accent-50/50">
          <p className="text-sm font-semibold text-accent-800">
            API Key is Configured
          </p>
          <p className="text-xs mt-1.5 text-accent-700">
            A {providerDisplayNames[selectedProvider]} API key is currently set
            for this workspace. Requests will use your key and workspace credits
            will not be deducted.
          </p>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            LLM Provider
          </label>
          <select
            value={selectedProvider}
            onChange={(e) => {
              setSelectedProvider(
                e.target.value as "google" | "openai" | "anthropic"
              );
              setApiKey("");
            }}
            className="w-full border border-neutral-300 rounded-xl p-3 text-sm bg-white text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isSaving || isClearing}
          >
            <option value="google">Google AI</option>
            {/* OpenAI and Anthropic options are available but not yet fully supported in the UI */}
            {/* <option value="openai">OpenAI</option> */}
            {/* <option value="anthropic">Anthropic</option> */}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            {providerDisplayNames[selectedProvider]} API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              hasKey
                ? "Enter new key to replace existing"
                : `Enter your ${providerDisplayNames[selectedProvider]} API key`
            }
            className="w-full border border-neutral-300 rounded-xl p-3 font-mono text-sm bg-white text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isSaving || isClearing}
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={!apiKey.trim() || isSaving || isClearing}
            className="bg-gradient-primary px-5 py-2.5 text-white text-sm font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none transition-all duration-200"
          >
            {isSaving ? "Saving..." : "Save Key"}
          </button>
          {hasKey && (
            <button
              onClick={handleClear}
              disabled={isSaving || isClearing}
              className="border border-neutral-300 bg-white px-5 py-2.5 text-neutral-700 text-sm font-semibold rounded-xl hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
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
      <div className="flex items-center justify-center min-h-screen bg-gradient-soft p-8">
        <div className="max-w-2xl w-full bg-white rounded-2xl shadow-large p-8 lg:p-10 border border-error-200">
          <h1 className="text-4xl font-semibold text-neutral-900 mb-4">
            Error
          </h1>
          <p className="text-xl mb-6 text-error-600 font-semibold">
            {error instanceof Error
              ? error.message
              : "Failed to load workspace"}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="bg-gradient-primary px-6 py-3 text-white font-semibold rounded-xl hover:shadow-colored transition-all duration-200"
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
    <div className="min-h-screen bg-gradient-soft p-6 lg:p-10">
      <div className="max-w-5xl mx-auto">
        <div className="bg-white rounded-2xl shadow-large p-8 lg:p-10 mb-8 border border-neutral-200 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-primary opacity-5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
          <div className="relative z-10">
            <div className="flex justify-between items-center mb-6">
              <button
                onClick={() => navigate("/workspaces")}
                className="border border-neutral-300 bg-white px-5 py-2.5 text-neutral-700 text-sm font-semibold rounded-xl hover:bg-neutral-50 transition-all duration-200 flex items-center gap-2"
              >
                <svg
                  className="w-4 h-4"
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
                  className="bg-gradient-primary px-5 py-2.5 text-white text-sm font-semibold rounded-xl hover:shadow-colored transition-all duration-200"
                >
                  Edit
                </button>
              )}
            </div>
            <p className="text-sm text-neutral-600 mb-6 leading-relaxed">
              This workspace contains your agents, documents, and settings. Use
              the sections below to manage credits, spending limits, channels,
              agents, and documents.
            </p>

            {isEditing ? (
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2.5">
                    Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full border border-neutral-300 rounded-xl bg-white px-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2.5">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full border border-neutral-300 rounded-xl bg-white px-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200"
                    rows={4}
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleSave}
                    disabled={updateWorkspace.isPending || !name.trim()}
                    className="bg-gradient-primary px-6 py-3 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none transition-all duration-200"
                  >
                    {updateWorkspace.isPending ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={updateWorkspace.isPending}
                    className="border border-neutral-300 bg-white px-6 py-3 text-neutral-700 font-semibold rounded-xl hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <h1 className="text-4xl lg:text-5xl font-bold text-neutral-900 mb-4 tracking-tight">
                  {workspace.name}
                </h1>
                {workspace.description && (
                  <p className="text-xl mb-4 text-neutral-700 leading-relaxed">
                    {workspace.description}
                  </p>
                )}
                <div className="flex items-center gap-2 text-sm text-neutral-500">
                  <svg
                    className="w-4 h-4"
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
          <div className="bg-gradient-accent/5 rounded-2xl shadow-medium p-8 mb-8 border border-accent-200/50">
            <h3 className="text-2xl font-semibold text-neutral-900 mb-3">
              Trial Credits
            </h3>
            <p className="text-base text-neutral-600 mb-6 leading-relaxed">
              Your workspace balance is 0. Request trial credits (2 USD) to test
              the application.
            </p>
            <button
              onClick={() => setIsTrialCreditModalOpen(true)}
              className="bg-gradient-primary px-6 py-3 text-white text-sm font-semibold rounded-xl hover:shadow-colored transition-all duration-200"
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

        <SectionGroup title="Resources">
          <AccordionSection
            id="agents"
            title="Agents"
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
            title="Documents"
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
              </QueryPanel>
            </LazyAccordionContent>
          </AccordionSection>

          {canEdit && (
            <AccordionSection
              id="documents-upload"
              title="Document Upload"
              isExpanded={expandedSection === "documents-upload"}
              onToggle={() => toggleSection("documents-upload")}
            >
              <LazyAccordionContent
                isExpanded={expandedSection === "documents-upload"}
              >
                <QueryPanel
                  fallback={
                    <LoadingScreen
                      compact
                      message="Preparing upload portal..."
                    />
                  }
                >
                  <DocumentUpload
                    workspaceId={id!}
                    currentFolder={currentFolder}
                  />
                </QueryPanel>
              </LazyAccordionContent>
            </AccordionSection>
          )}
        </SectionGroup>

        <SectionGroup title="Communications">
          <AccordionSection
            id="channels"
            title="Channels"
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
            title="Email Connection"
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

        <SectionGroup title="Billing & Usage">
          <AccordionSection
            id="credits"
            title="Credit Balance"
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
              title="Spending Limits"
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
            title="Workspace Usage"
            isExpanded={expandedSection === "usage"}
            onToggle={() => toggleSection("usage")}
          >
            <LazyAccordionContent isExpanded={expandedSection === "usage"}>
              <WorkspaceUsageSection workspaceId={id!} />
            </LazyAccordionContent>
          </AccordionSection>
        </SectionGroup>

        <SectionGroup title="Configuration">
          {canEdit && (
            <AccordionSection
              id="api-key"
              title="API Key"
              isExpanded={expandedSection === "api-key"}
              onToggle={() => toggleSection("api-key")}
            >
              <LazyAccordionContent isExpanded={expandedSection === "api-key"}>
                <WorkspaceApiKeyManager
                  workspaceId={id!}
                  apiKeys={workspace.apiKeys}
                  hasGoogleApiKey={workspace.hasGoogleApiKey}
                />
              </LazyAccordionContent>
            </AccordionSection>
          )}

          {canEdit && (
            <AccordionSection
              id="mcp-servers"
              title="MCP Servers"
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
          title="Team"
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
                  <div className="pt-6 border-t border-neutral-200">
                    {userLimit && !userLimit.canInvite && (
                      <div className="mb-6 p-5 border-4 border-error-600 bg-error-50">
                        <div className="font-bold text-lg text-error-900 mb-2">
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
                          <div className="text-sm font-semibold text-error-800 mt-2">
                            Upgrade to Pro plan to invite up to 5 users.
                          </div>
                        )}
                      </div>
                    )}
                    <h3 className="text-lg font-semibold text-neutral-900 mb-4">
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
            title="Danger Zone"
            isExpanded={expandedSection === "danger"}
            onToggle={() => toggleSection("danger")}
          >
            <p className="text-sm text-neutral-600 mb-4 leading-relaxed">
              This section contains destructive actions. Deleting a workspace
              will permanently remove all agents, documents, conversations, and
              settings. This action cannot be undone.
            </p>
            <p className="mb-6 text-neutral-700 font-medium">
              Deleting a workspace is permanent and cannot be undone.
            </p>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-error-600 px-6 py-3 text-white font-semibold rounded-xl hover:bg-error-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-medium hover:shadow-large"
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
        <p className="text-red-700 font-semibold">
          Error loading usage:{" "}
          {usageError instanceof Error ? usageError.message : "Unknown error"}
        </p>
      </div>
    );
  }

  if (dailyError) {
    return (
      <div>
        <p className="text-red-700 font-semibold">
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
        <div className="flex items-center justify-center min-h-screen bg-gradient-soft p-8">
          <div className="max-w-2xl w-full bg-white rounded-2xl shadow-large p-8 lg:p-10 border border-error-200">
            <h1 className="text-4xl font-semibold text-neutral-900 mb-4">
              Error
            </h1>
            <p className="text-xl mb-6 text-error-600 font-semibold">
              {error.message || "Failed to load workspace"}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  reset();
                  resetError();
                }}
                className="bg-gradient-primary px-6 py-3 text-white font-semibold rounded-xl hover:shadow-colored transition-all duration-200"
              >
                Try Again
              </button>
              <button
                onClick={() => navigate("/workspaces")}
                className="border border-neutral-300 bg-white px-6 py-3 text-neutral-700 font-semibold rounded-xl hover:bg-neutral-50 transition-all duration-200"
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
