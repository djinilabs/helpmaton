import {
  CloudArrowUpIcon,
  EnvelopeIcon,
  CalendarIcon,
  DocumentTextIcon,
  CodeBracketIcon,
  Squares2X2Icon,
  ClipboardDocumentListIcon,
  ServerIcon,
  ChartBarIcon,
  BuildingOfficeIcon,
  ChatBubbleLeftRightIcon,
  CreditCardIcon,
} from "@heroicons/react/24/outline";
import { useState, useEffect } from "react";
import type { FC } from "react";

import { useDialogTracking } from "../contexts/DialogContext";
import { useEscapeKey } from "../hooks/useEscapeKey";
import {
  useCreateMcpServer,
  useUpdateMcpServer,
  useMcpServer,
} from "../hooks/useMcpServers";
import { trackEvent } from "../utils/tracking";

type McpServerType =
  | "google-drive"
  | "gmail"
  | "google-calendar"
  | "notion"
  | "github"
  | "linear"
  | "hubspot"
  | "salesforce"
  | "slack"
  | "intercom"
  | "todoist"
  | "zendesk"
  | "stripe"
  | "posthog"
  | "custom";

interface McpServerTypeMetadata {
  value: McpServerType;
  name: string;
  description: string;
  icon: FC<{ className?: string }>;
}

const MCP_SERVER_TYPES: McpServerTypeMetadata[] = [
  {
    value: "google-drive",
    name: "Google Drive",
    description:
      "Read files from Google Drive including Google Docs (as plain text), Google Sheets (as CSV), and Google Slides (as plain text). Search and list files.",
    icon: CloudArrowUpIcon,
  },
  {
    value: "gmail",
    name: "Gmail",
    description:
      "List, search, and read emails using Gmail's powerful search syntax. Access email content, headers, and attachments.",
    icon: EnvelopeIcon,
  },
  {
    value: "google-calendar",
    name: "Google Calendar",
    description:
      "Full calendar management - list, search, read, create, update, and delete events. Perfect for scheduling assistants.",
    icon: CalendarIcon,
  },
  {
    value: "notion",
    name: "Notion",
    description:
      "Read, search, create, and update pages and databases. Query databases, create database pages, and append content blocks.",
    icon: DocumentTextIcon,
  },
  {
    value: "github",
    name: "GitHub",
    description:
      "Read-only access to repositories, issues, pull requests, commits, and file contents. Browse code and track development activity.",
    icon: CodeBracketIcon,
  },
  {
    value: "linear",
    name: "Linear",
    description:
      "Read-only access to Linear teams, projects, and issues. Search issues and review project tracking data.",
    icon: Squares2X2Icon,
  },
  {
    value: "hubspot",
    name: "HubSpot",
    description:
      "Read-only access to HubSpot CRM data. List and search contacts, companies, deals, and owners.",
    icon: BuildingOfficeIcon,
  },
  {
    value: "salesforce",
    name: "Salesforce",
    description:
      "Query Salesforce CRM data using SOQL. List objects, describe schemas, and run read-only queries.",
    icon: BuildingOfficeIcon,
  },
  {
    value: "slack",
    name: "Slack",
    description:
      "Read channel history, list channels, and post messages. Perfect for team updates and collaboration.",
    icon: ChatBubbleLeftRightIcon,
  },
  {
    value: "intercom",
    name: "Intercom",
    description:
      "Read and reply to conversations, and manage contacts as an admin.",
    icon: ChatBubbleLeftRightIcon,
  },
  {
    value: "todoist",
    name: "Todoist",
    description:
      "Create, list, and complete tasks. Summarize what is due today or this week.",
    icon: ClipboardDocumentListIcon,
  },
  {
    value: "zendesk",
    name: "Zendesk",
    description:
      "Search tickets, read ticket threads, draft private replies, and search Help Center articles.",
    icon: ChatBubbleLeftRightIcon,
  },
  {
    value: "stripe",
    name: "Stripe",
    description:
      "Read-only access to Stripe balance, refunds, and charge search via Stripe's query language.",
    icon: CreditCardIcon,
  },
  {
    value: "posthog",
    name: "PostHog",
    description:
      "Read-only access to PostHog analytics. Browse projects, events, insights, feature flags, and people.",
    icon: ChartBarIcon,
  },
  {
    value: "custom",
    name: "Custom MCP",
    description:
      "Connect to external MCP servers with custom authentication (none, header, or basic auth).",
    icon: ServerIcon,
  },
];

interface McpServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  serverId?: string; // If provided, we're editing; otherwise, creating
}

/* eslint-disable complexity */
export const McpServerModal: FC<McpServerModalProps> = ({
  isOpen,
  onClose,
  workspaceId,
  serverId,
}) => {
  const isEditing = !!serverId;
  const { data: server } = useMcpServer(workspaceId, serverId || "");
  const createServer = useCreateMcpServer(workspaceId);
  const updateServer = useUpdateMcpServer(workspaceId);

  const [name, setName] = useState("");
  const [mcpType, setMcpType] = useState<
    | "google-drive"
    | "gmail"
    | "google-calendar"
    | "notion"
    | "github"
    | "linear"
    | "hubspot"
    | "salesforce"
    | "slack"
    | "intercom"
    | "todoist"
    | "zendesk"
    | "stripe"
    | "posthog"
    | "custom"
  >("google-drive"); // Service type for new servers
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState<"none" | "header" | "basic">("none");
  const [headerValue, setHeaderValue] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [posthogRegion, setPosthogRegion] = useState<"us" | "eu">("us");
  const [posthogApiKey, setPosthogApiKey] = useState("");
  const [zendeskSubdomain, setZendeskSubdomain] = useState("");
  const [zendeskClientId, setZendeskClientId] = useState("");
  const [zendeskClientSecret, setZendeskClientSecret] = useState("");

  const posthogBaseUrls = {
    us: "https://us.posthog.com",
    eu: "https://eu.posthog.com",
  } as const;

  // Reset form when modal opens/closes or server changes
  useEffect(() => {
    if (isOpen) {
      if (server) {
        const resolvePosthogRegion = (serverUrl?: string) =>
          serverUrl?.includes("eu.posthog.com") ? "eu" : "us";

        setName(server.name);
        setUrl(server.url || "");
        // Determine MCP type based on server
        if (
          server.authType === "oauth" &&
          server.serviceType === "google-drive"
        ) {
          setMcpType("google-drive");
          // OAuth servers don't have authType in the UI
        } else if (
          server.authType === "oauth" &&
          server.serviceType === "gmail"
        ) {
          setMcpType("gmail");
          // OAuth servers don't have authType in the UI
        } else if (
          server.authType === "oauth" &&
          server.serviceType === "google-calendar"
        ) {
          setMcpType("google-calendar");
          // OAuth servers don't have authType in the UI
        } else if (
          server.authType === "oauth" &&
          server.serviceType === "notion"
        ) {
          setMcpType("notion");
          // OAuth servers don't have authType in the UI
        } else if (
          server.authType === "oauth" &&
          server.serviceType === "github"
        ) {
          setMcpType("github");
          // OAuth servers don't have authType in the UI
        } else if (
          server.authType === "oauth" &&
          server.serviceType === "linear"
        ) {
          setMcpType("linear");
          // OAuth servers don't have authType in the UI
        } else if (
          server.authType === "oauth" &&
          server.serviceType === "hubspot"
        ) {
          setMcpType("hubspot");
          // OAuth servers don't have authType in the UI
        } else if (
          server.authType === "oauth" &&
          server.serviceType === "salesforce"
        ) {
          setMcpType("salesforce");
          // OAuth servers don't have authType in the UI
        } else if (
          server.authType === "oauth" &&
          server.serviceType === "slack"
        ) {
          setMcpType("slack");
          // OAuth servers don't have authType in the UI
        } else if (
          server.authType === "oauth" &&
          server.serviceType === "intercom"
        ) {
          setMcpType("intercom");
          // OAuth servers don't have authType in the UI
        } else if (
          server.authType === "oauth" &&
          server.serviceType === "todoist"
        ) {
          setMcpType("todoist");
          // OAuth servers don't have authType in the UI
        } else if (
          server.authType === "oauth" &&
          server.serviceType === "zendesk"
        ) {
          setMcpType("zendesk");
          setZendeskSubdomain("");
          setZendeskClientId("");
          // Client secret should not be surfaced; leave blank
          setZendeskClientSecret("");
          // OAuth servers don't have authType in the UI
        } else if (
          server.authType === "oauth" &&
          server.serviceType === "stripe"
        ) {
          setMcpType("stripe");
          // OAuth servers don't have authType in the UI
        } else if (server.serviceType === "posthog") {
          setMcpType("posthog");
          setAuthType("header");
          setPosthogRegion(resolvePosthogRegion(server.url || undefined));
        } else {
          setMcpType("custom");
          // For custom servers, preserve the authType (should never be "oauth")
          setAuthType(server.authType as "none" | "header" | "basic");
        }
        // Don't populate sensitive fields when editing
        setHeaderValue("");
        setUsername("");
        setPassword("");
        setPosthogApiKey("");
        setZendeskSubdomain("");
        setZendeskClientId("");
        setZendeskClientSecret("");
      } else {
        setName("");
        setMcpType("google-drive"); // Default to Google Drive for new servers
        setUrl("");
        setAuthType("none");
        setHeaderValue("");
        setUsername("");
        setPassword("");
        setPosthogRegion("us");
        setPosthogApiKey("");
        setZendeskSubdomain("");
        setZendeskClientId("");
        setZendeskClientSecret("");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, server?.id]);

  const handleClose = () => {
    setName("");
    setMcpType("google-drive");
    setUrl("");
    setAuthType("none");
    setHeaderValue("");
    setUsername("");
    setPassword("");
    setPosthogRegion("us");
    setPosthogApiKey("");
    setZendeskSubdomain("");
    setZendeskClientId("");
    setZendeskClientSecret("");
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

  const isPosthogType = mcpType === "posthog";
  const isZendeskType = mcpType === "zendesk";
  const isOAuthType = mcpType !== "custom" && mcpType !== "posthog";
  const selectedPosthogBaseUrl = posthogBaseUrls[posthogRegion];

  /* eslint-disable complexity */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    // URL is required for custom MCP servers
    if (mcpType === "custom" && !url.trim()) return;

    // Validate auth config based on authType (only for custom MCP)
    if (mcpType === "custom") {
      // When creating, auth fields are required
      // When editing, auth fields are optional (empty = keep existing value)
      if (!isEditing) {
        if (authType === "header" && !headerValue.trim()) {
          return;
        }
        if (authType === "basic" && (!username.trim() || !password.trim())) {
          return;
        }
      } else {
        // When editing, only require auth fields if auth type changed
        if (server) {
          if (authType !== server.authType) {
            // Auth type changed, so we need new credentials
            if (authType === "header" && !headerValue.trim()) {
              return;
            }
            if (
              authType === "basic" &&
              (!username.trim() || !password.trim())
            ) {
              return;
            }
          }
        }
      }
    }

    if (isPosthogType) {
      if (!isEditing && !posthogApiKey.trim()) {
        return;
      }
    }

    if (isZendeskType) {
      if (!isEditing) {
        if (
          !zendeskSubdomain.trim() ||
          !zendeskClientId.trim() ||
          !zendeskClientSecret.trim()
        ) {
          return;
        }
      } else {
        const hasSubdomain = !!zendeskSubdomain.trim();
        const hasClientId = !!zendeskClientId.trim();
        if ((hasSubdomain || hasClientId) && (!hasSubdomain || !hasClientId)) {
          return;
        }
      }
    }

    try {
      const config: {
        apiKey?: string;
        headerValue?: string;
        username?: string;
        password?: string;
        subdomain?: string;
        clientId?: string;
        clientSecret?: string;
      } = {};

      if (isPosthogType) {
        if (posthogApiKey.trim()) {
          config.apiKey = posthogApiKey.trim();
        }
      } else if (isZendeskType) {
        if (zendeskSubdomain.trim()) {
          config.subdomain = zendeskSubdomain.trim();
        }
        if (zendeskClientId.trim()) {
          config.clientId = zendeskClientId.trim();
        }
        if (zendeskClientSecret.trim()) {
          config.clientSecret = zendeskClientSecret.trim();
        }
      } else if (authType === "header") {
        config.headerValue = headerValue.trim();
      } else if (authType === "basic") {
        config.username = username.trim();
        config.password = password.trim();
      }

      if (isEditing && serverId) {
        const updateData: {
          name?: string;
          url?: string;
          authType?: "none" | "header" | "basic" | "oauth";
          serviceType?:
            | "external"
            | "google-drive"
            | "gmail"
            | "google-calendar"
            | "notion"
            | "github"
            | "linear"
            | "hubspot"
            | "salesforce"
            | "slack"
            | "intercom"
            | "todoist"
            | "zendesk"
            | "stripe"
            | "posthog";
          config?: typeof config;
        } = {
          name: name.trim(),
        };

        const updatedFields: string[] = [];
        if (name.trim() !== server?.name) {
          updatedFields.push("name");
        }

        // Determine if this is an OAuth server
        const isOAuthServer =
          server?.authType === "oauth" &&
          (server?.serviceType === "google-drive" ||
            server?.serviceType === "gmail" ||
            server?.serviceType === "google-calendar" ||
            server?.serviceType === "notion" ||
            server?.serviceType === "github" ||
            server?.serviceType === "linear" ||
            server?.serviceType === "hubspot" ||
          server?.serviceType === "salesforce" ||
            server?.serviceType === "slack" ||
          server?.serviceType === "stripe" ||
          server?.serviceType === "intercom" ||
          server?.serviceType === "todoist" ||
          server?.serviceType === "zendesk");
        const isPosthogServer = server?.serviceType === "posthog";
        const isZendeskServer =
          server?.authType === "oauth" && server?.serviceType === "zendesk";

        // OAuth servers can only update name (OAuth connection is managed separately)
        // Custom MCP servers can update URL and auth
        if (!isOAuthServer && !isPosthogServer) {
          if (server && url !== (server.url || "")) {
            updateData.url = url.trim() || undefined;
            updatedFields.push("url");
          }
          if (server && authType !== server.authType) {
            updateData.authType = authType;
            updatedFields.push("auth_type");
          }
        }

        if (isPosthogServer) {
          if (server && selectedPosthogBaseUrl !== (server.url || "")) {
            updateData.url = selectedPosthogBaseUrl;
            updatedFields.push("region");
          }
        }
        // Only include config for custom MCP servers or Zendesk OAuth config
        if ((!isOAuthServer && !isPosthogServer) || isZendeskServer) {
          // Only include config if:
          // 1. Auth type changed (need new credentials for new auth type)
          // 2. User provided new credentials (non-empty values)
          const authTypeChanged = server && authType !== server.authType;
          const hasNewCredentials =
            isZendeskServer
              ? !!zendeskSubdomain.trim() ||
                !!zendeskClientId.trim() ||
                !!zendeskClientSecret.trim()
              : authType === "header"
              ? !!headerValue.trim()
              : authType === "basic"
              ? !!username.trim() && !!password.trim()
              : false;

          if (authTypeChanged || hasNewCredentials) {
            // If auth type changed, we need to build config for the new auth type
            if (authTypeChanged) {
              const newConfig: typeof config = {};
              if (isZendeskServer) {
                if (zendeskSubdomain.trim()) {
                  newConfig.subdomain = zendeskSubdomain.trim();
                }
                if (zendeskClientId.trim()) {
                  newConfig.clientId = zendeskClientId.trim();
                }
                if (zendeskClientSecret.trim()) {
                  newConfig.clientSecret = zendeskClientSecret.trim();
                }
              } else if (authType === "header") {
                newConfig.headerValue = headerValue.trim();
              } else if (authType === "basic") {
                newConfig.username = username.trim();
                newConfig.password = password.trim();
              }
              // Only set config if authType is not "none"
              if (authType !== "none" || isZendeskServer) {
                updateData.config = newConfig;
              }
            } else {
              // Auth type didn't change, use the config we built above
              // Only set config if authType is not "none"
              if (authType !== "none" || isZendeskServer) {
                updateData.config = config;
              }
            }
            updatedFields.push("config");
          }
          // If neither condition is true, don't send config (will keep existing)
        }

        if (isPosthogServer && posthogApiKey.trim()) {
          updateData.config = { apiKey: posthogApiKey.trim() };
          updatedFields.push("config");
        }

        await updateServer.mutateAsync({
          serverId,
          input: updateData,
        });
        trackEvent("mcp_server_updated", {
          workspace_id: workspaceId,
          server_id: serverId,
          server_name: name.trim(),
          updated_fields: updatedFields,
        });
      } else {
        // When creating, determine authType and serviceType based on mcpType
        if (mcpType === "google-drive") {
          // Google Drive - OAuth-based
          const result = await createServer.mutateAsync({
            name: name.trim(),
            authType: "oauth",
            serviceType: "google-drive",
            config: {}, // Empty config for OAuth servers (credentials set via OAuth flow)
          });
          trackEvent("mcp_server_created", {
            workspace_id: workspaceId,
            server_id: result.id,
            auth_type: "oauth",
            service_type: "google-drive",
          });
        } else if (mcpType === "gmail") {
          // Gmail - OAuth-based
          const result = await createServer.mutateAsync({
            name: name.trim(),
            authType: "oauth",
            serviceType: "gmail",
            config: {}, // Empty config for OAuth servers (credentials set via OAuth flow)
          });
          trackEvent("mcp_server_created", {
            workspace_id: workspaceId,
            server_id: result.id,
            auth_type: "oauth",
            service_type: "gmail",
          });
        } else if (mcpType === "google-calendar") {
          // Google Calendar - OAuth-based
          const result = await createServer.mutateAsync({
            name: name.trim(),
            authType: "oauth",
            serviceType: "google-calendar",
            config: {}, // Empty config for OAuth servers (credentials set via OAuth flow)
          });
          trackEvent("mcp_server_created", {
            workspace_id: workspaceId,
            server_id: result.id,
            auth_type: "oauth",
            service_type: "google-calendar",
          });
        } else if (mcpType === "notion") {
          // Notion - OAuth-based
          const result = await createServer.mutateAsync({
            name: name.trim(),
            authType: "oauth",
            serviceType: "notion",
            config: {}, // Empty config for OAuth servers (credentials set via OAuth flow)
          });
          trackEvent("mcp_server_created", {
            workspace_id: workspaceId,
            server_id: result.id,
            auth_type: "oauth",
            service_type: "notion",
          });
        } else if (mcpType === "github") {
          // GitHub - OAuth-based
          const result = await createServer.mutateAsync({
            name: name.trim(),
            authType: "oauth",
            serviceType: "github",
            config: {}, // Empty config for OAuth servers (credentials set via OAuth flow)
          });
          trackEvent("mcp_server_created", {
            workspace_id: workspaceId,
            server_id: result.id,
            auth_type: "oauth",
            service_type: "github",
          });
        } else if (mcpType === "linear") {
          // Linear - OAuth-based
          const result = await createServer.mutateAsync({
            name: name.trim(),
            authType: "oauth",
            serviceType: "linear",
            config: {}, // Empty config for OAuth servers (credentials set via OAuth flow)
          });
          trackEvent("mcp_server_created", {
            workspace_id: workspaceId,
            server_id: result.id,
            auth_type: "oauth",
            service_type: "linear",
          });
        } else if (mcpType === "hubspot") {
          // HubSpot - OAuth-based
          const result = await createServer.mutateAsync({
            name: name.trim(),
            authType: "oauth",
            serviceType: "hubspot",
            config: {}, // Empty config for OAuth servers (credentials set via OAuth flow)
          });
          trackEvent("mcp_server_created", {
            workspace_id: workspaceId,
            server_id: result.id,
            auth_type: "oauth",
            service_type: "hubspot",
          });
        } else if (mcpType === "salesforce") {
          // Salesforce - OAuth-based
          const result = await createServer.mutateAsync({
            name: name.trim(),
            authType: "oauth",
            serviceType: "salesforce",
            config: {}, // Empty config for OAuth servers (credentials set via OAuth flow)
          });
          trackEvent("mcp_server_created", {
            workspace_id: workspaceId,
            server_id: result.id,
            auth_type: "oauth",
            service_type: "salesforce",
          });
        } else if (mcpType === "slack") {
          // Slack - OAuth-based
          const result = await createServer.mutateAsync({
            name: name.trim(),
            authType: "oauth",
            serviceType: "slack",
            config: {}, // Empty config for OAuth servers (credentials set via OAuth flow)
          });
          trackEvent("mcp_server_created", {
            workspace_id: workspaceId,
            server_id: result.id,
            auth_type: "oauth",
            service_type: "slack",
          });
        } else if (mcpType === "intercom") {
          // Intercom - OAuth-based
          const result = await createServer.mutateAsync({
            name: name.trim(),
            authType: "oauth",
            serviceType: "intercom",
            config: {}, // Empty config for OAuth servers (credentials set via OAuth flow)
          });
          trackEvent("mcp_server_created", {
            workspace_id: workspaceId,
            server_id: result.id,
            auth_type: "oauth",
            service_type: "intercom",
          });
        } else if (mcpType === "todoist") {
          // Todoist - OAuth-based
          const result = await createServer.mutateAsync({
            name: name.trim(),
            authType: "oauth",
            serviceType: "todoist",
            config: {}, // Empty config for OAuth servers (credentials set via OAuth flow)
          });
          trackEvent("mcp_server_created", {
            workspace_id: workspaceId,
            server_id: result.id,
            auth_type: "oauth",
            service_type: "todoist",
          });
        } else if (mcpType === "zendesk") {
          const result = await createServer.mutateAsync({
            name: name.trim(),
            authType: "oauth",
            serviceType: "zendesk",
            config: {
              subdomain: zendeskSubdomain.trim(),
              clientId: zendeskClientId.trim(),
              clientSecret: zendeskClientSecret.trim(),
            },
          });
          trackEvent("mcp_server_created", {
            workspace_id: workspaceId,
            server_id: result.id,
            auth_type: "oauth",
            service_type: "zendesk",
          });
        } else if (mcpType === "stripe") {
          // Stripe - OAuth-based
          const result = await createServer.mutateAsync({
            name: name.trim(),
            authType: "oauth",
            serviceType: "stripe",
            config: {}, // Empty config for OAuth servers (credentials set via OAuth flow)
          });
          trackEvent("mcp_server_created", {
            workspace_id: workspaceId,
            server_id: result.id,
            auth_type: "oauth",
            service_type: "stripe",
          });
        } else if (mcpType === "posthog") {
          const result = await createServer.mutateAsync({
            name: name.trim(),
            url: selectedPosthogBaseUrl,
            authType: "header",
            serviceType: "posthog",
            config: { apiKey: posthogApiKey.trim() },
          });
          trackEvent("mcp_server_created", {
            workspace_id: workspaceId,
            server_id: result.id,
            auth_type: "header",
            service_type: "posthog",
          });
        } else {
          // Custom MCP - external server
          const result = await createServer.mutateAsync({
            name: name.trim(),
            url: url.trim(),
            authType,
            serviceType: "external",
            config: authType === "header" || authType === "basic" ? config : {},
          });
          trackEvent("mcp_server_created", {
            workspace_id: workspaceId,
            server_id: result.id,
            auth_type: authType,
            service_type: "external",
          });
        }
      }
      handleClose();
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const isPending = isEditing ? updateServer.isPending : createServer.isPending;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="mb-8 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          {isEditing ? "Edit MCP Server" : "Create MCP Server"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="name"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Name *
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              required
            />
          </div>

          {!isEditing && (
            <div>
              <label className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                MCP Server Type *
              </label>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {MCP_SERVER_TYPES.map((serverType) => {
                  const Icon = serverType.icon;
                  const isSelected = mcpType === serverType.value;
                  const isPosthogOption = serverType.value === "posthog";
                  const isOAuthType =
                    serverType.value !== "custom" && !isPosthogOption;

                  return (
                    <button
                      key={serverType.value}
                      type="button"
                      onClick={() => {
                        setMcpType(serverType.value);
                        if (serverType.value !== "zendesk") {
                          setZendeskSubdomain("");
                          setZendeskClientId("");
                          setZendeskClientSecret("");
                        }
                        // Reset auth type when switching
                        if (isOAuthType) {
                          setAuthType("none");
                          setUrl("");
                          setPosthogRegion("us");
                          setPosthogApiKey("");
                        } else if (isPosthogOption) {
                          setAuthType("header");
                          setUrl(posthogBaseUrls.us);
                          setPosthogRegion("us");
                          setPosthogApiKey("");
                        } else {
                          setAuthType("none");
                        }
                      }}
                      className={`relative flex flex-col items-center rounded-xl border-2 p-4 text-left transition-all duration-200 hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-neutral-900 ${
                        isSelected
                          ? "border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20"
                          : "border-neutral-300 bg-white hover:border-primary-400 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-primary-500"
                      }`}
                    >
                      <div className="mb-3 flex size-12 items-center justify-center">
                        <Icon
                          className={`size-8 ${
                            isSelected
                              ? "text-primary-600 dark:text-primary-400"
                              : "text-neutral-600 dark:text-neutral-400"
                          }`}
                        />
                      </div>
                      <h3
                        className={`mb-2 text-base font-semibold ${
                          isSelected
                            ? "text-primary-900 dark:text-primary-100"
                            : "text-neutral-900 dark:text-neutral-50"
                        }`}
                      >
                        {serverType.name}
                      </h3>
                      <p
                        className={`text-xs leading-relaxed ${
                          isSelected
                            ? "text-primary-700 dark:text-primary-300"
                            : "text-neutral-600 dark:text-neutral-400"
                        }`}
                      >
                        {serverType.description}
                      </p>
                      {isSelected && (
                        <div className="absolute right-2 top-2">
                          <div className="flex size-5 items-center justify-center rounded-full bg-primary-500">
                            <svg
                              className="size-3 text-white"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={3}
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              {isOAuthType && (
                <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-300">
                  After creating the server, you&apos;ll need to connect your
                  account via OAuth.
                </p>
              )}
              {mcpType === "github" && (
                <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  After creating the server, you&apos;ll need to connect your
                  GitHub account via OAuth (read-only access).
                </p>
              )}
              {mcpType === "linear" && (
                <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  After creating the server, you&apos;ll need to connect your
                  Linear account via OAuth (read-only access).
                </p>
              )}
              {mcpType === "salesforce" && (
                <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  After creating the server, you&apos;ll need to connect your
                  Salesforce account via OAuth (read-only access).
                </p>
              )}
              {mcpType === "intercom" && (
                <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  After creating the server, you&apos;ll need to connect your
                  Intercom admin account via OAuth.
                </p>
              )}
              {mcpType === "zendesk" && (
                <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  Provide your Zendesk subdomain and OAuth client credentials.
                  After creating the server, you&apos;ll connect via OAuth.
                </p>
              )}
              {mcpType === "posthog" && (
                <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  You&apos;ll be prompted for a PostHog personal API key and
                  region (US or EU). This gives read-only access via the
                  PostHog API.
                </p>
              )}
            </div>
          )}

          {mcpType === "custom" && (
            <>
              <div>
                <label
                  htmlFor="url"
                  className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  URL *
                </label>
                <input
                  id="url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-mono text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                  placeholder="https://example.com/mcp"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="authType"
                  className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Authentication Type *
                </label>
                <select
                  id="authType"
                  value={authType}
                  onChange={(e) =>
                    setAuthType(e.target.value as "none" | "header" | "basic")
                  }
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                  required
                >
                  <option value="none">None</option>
                  <option value="header">Header (Authorization)</option>
                  <option value="basic">HTTP Basic Auth</option>
                </select>
              </div>
            </>
          )}

          {mcpType === "posthog" && (
            <>
              <div>
                <label
                  htmlFor="posthogRegion"
                  className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  PostHog Region *
                </label>
                <select
                  id="posthogRegion"
                  value={posthogRegion}
                  onChange={(e) =>
                    setPosthogRegion(e.target.value as "us" | "eu")
                  }
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                  required
                >
                  <option value="us">US (us.posthog.com)</option>
                  <option value="eu">EU (eu.posthog.com)</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="posthogApiKey"
                  className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Personal API Key {!isEditing ? "*" : ""}
                </label>
                <input
                  id="posthogApiKey"
                  type="password"
                  value={posthogApiKey}
                  onChange={(e) => setPosthogApiKey(e.target.value)}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-mono text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                  placeholder={
                    isEditing
                      ? "Leave empty to keep existing key"
                      : "phx_xxxxxxxxxxxxxxxxx"
                  }
                  required={!isEditing}
                />
                <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  {isEditing
                    ? "Leave empty to keep the existing key. Enter a new key to update it."
                    : "Create a personal API key in PostHog settings."}
                </p>
              </div>
            </>
          )}

          {mcpType === "zendesk" && (
            <>
              <div>
                <label
                  htmlFor="zendeskSubdomain"
                  className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Zendesk Subdomain *
                </label>
                <input
                  id="zendeskSubdomain"
                  type="text"
                  value={zendeskSubdomain}
                  onChange={(e) => setZendeskSubdomain(e.target.value)}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-mono text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                  placeholder="yourcompany"
                  required={!isEditing}
                />
                <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  Use the subdomain from your Zendesk URL (e.g. the
                  &quot;yourcompany&quot; in
                  https://yourcompany.zendesk.com).
                </p>
              </div>
              <div>
                <label
                  htmlFor="zendeskClientId"
                  className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  OAuth Client ID *
                </label>
                <input
                  id="zendeskClientId"
                  type="text"
                  value={zendeskClientId}
                  onChange={(e) => setZendeskClientId(e.target.value)}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-mono text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                  placeholder="zendesk_client_id"
                  required={!isEditing}
                />
              </div>
              <div>
                <label
                  htmlFor="zendeskClientSecret"
                  className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  OAuth Client Secret {!isEditing ? "*" : ""}
                </label>
                <input
                  id="zendeskClientSecret"
                  type="password"
                  value={zendeskClientSecret}
                  onChange={(e) => setZendeskClientSecret(e.target.value)}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-mono text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                  placeholder={
                    isEditing
                      ? "Leave empty to keep existing secret"
                      : "zendesk_client_secret"
                  }
                  required={!isEditing}
                />
                <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  Create a Zendesk OAuth client with scopes
                  &quot;tickets:read&quot;, &quot;tickets:write&quot;, and
                  &quot;help_center:read&quot;.
                </p>
              </div>
            </>
          )}

          {isEditing && server && (
            <>
              {server.serviceType === "posthog" ? null : server.authType === "oauth" &&
              server.serviceType === "google-drive" ? (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
                  <p className="text-sm text-neutral-700 dark:text-neutral-300">
                    This is a Google Drive MCP server. OAuth connection is
                    managed separately.
                  </p>
                </div>
              ) : server.authType === "oauth" &&
                server.serviceType === "gmail" ? (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
                  <p className="text-sm text-neutral-700 dark:text-neutral-300">
                    This is a Gmail MCP server. OAuth connection is managed
                    separately.
                  </p>
                </div>
              ) : server.authType === "oauth" &&
                server.serviceType === "google-calendar" ? (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
                  <p className="text-sm text-neutral-700 dark:text-neutral-300">
                    This is a Google Calendar MCP server. OAuth connection is
                    managed separately.
                  </p>
                </div>
              ) : server.authType === "oauth" &&
                server.serviceType === "notion" ? (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
                  <p className="text-sm text-neutral-700 dark:text-neutral-300">
                    This is a Notion MCP server. OAuth connection is managed
                    separately.
                  </p>
                </div>
              ) : server.authType === "oauth" &&
                server.serviceType === "github" ? (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
                  <p className="text-sm text-neutral-700 dark:text-neutral-300">
                    This is a GitHub MCP server. OAuth connection is managed
                    separately.
                  </p>
                </div>
              ) : server.authType === "oauth" &&
                server.serviceType === "linear" ? (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
                  <p className="text-sm text-neutral-700 dark:text-neutral-300">
                    This is a Linear MCP server. OAuth connection is managed
                    separately.
                  </p>
                </div>
              ) : server.authType === "oauth" &&
                server.serviceType === "salesforce" ? (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
                  <p className="text-sm text-neutral-700 dark:text-neutral-300">
                    This is a Salesforce MCP server. OAuth connection is
                    managed separately.
                  </p>
                </div>
              ) : server.authType === "oauth" &&
                server.serviceType === "intercom" ? (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
                  <p className="text-sm text-neutral-700 dark:text-neutral-300">
                    This is an Intercom MCP server. OAuth connection is
                    managed separately.
                  </p>
                </div>
              ) : server.authType === "oauth" &&
                server.serviceType === "todoist" ? (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
                  <p className="text-sm text-neutral-700 dark:text-neutral-300">
                    This is a Todoist MCP server. OAuth connection is managed
                    separately.
                  </p>
                </div>
              ) : server.authType === "oauth" &&
                server.serviceType === "zendesk" ? (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
                  <p className="text-sm text-neutral-700 dark:text-neutral-300">
                    This is a Zendesk MCP server. OAuth connection is managed
                    separately.
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <label
                      htmlFor="url"
                      className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                    >
                      URL *
                    </label>
                    <input
                      id="url"
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-mono text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                      placeholder="https://example.com/mcp"
                      required
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="authType"
                      className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                    >
                      Authentication Type *
                    </label>
                    <select
                      id="authType"
                      value={authType}
                      onChange={(e) =>
                        setAuthType(
                          e.target.value as "none" | "header" | "basic"
                        )
                      }
                      className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                      required
                    >
                      <option value="none">None</option>
                      <option value="header">Header (Authorization)</option>
                      <option value="basic">HTTP Basic Auth</option>
                    </select>
                  </div>
                </>
              )}
            </>
          )}

          {(mcpType === "custom" ||
            (isEditing &&
              server &&
              server.authType !== "oauth" &&
              server.serviceType !== "posthog")) &&
            authType === "header" && (
              <div>
                <label
                  htmlFor="headerValue"
                  className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Authorization Header Value {!isEditing ? "*" : ""}
                </label>
                <input
                  id="headerValue"
                  type="password"
                  value={headerValue}
                  onChange={(e) => setHeaderValue(e.target.value)}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-mono text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                  placeholder={
                    isEditing
                      ? "Leave empty to keep existing value"
                      : "Bearer token123 or token123"
                  }
                  required={!isEditing && authType === "header"}
                />
                <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  {isEditing
                    ? "Leave empty to keep the existing value. Enter a new value to update it."
                    : "This value will be used in the Authorization header"}
                </p>
              </div>
            )}

          {(mcpType === "custom" ||
            (isEditing &&
              server &&
              server.authType !== "oauth" &&
              server.serviceType !== "posthog")) &&
            authType === "basic" && (
              <>
                <div>
                  <label
                    htmlFor="username"
                    className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                  >
                    Username {!isEditing ? "*" : ""}
                  </label>
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                    placeholder={
                      isEditing ? "Leave empty to keep existing value" : ""
                    }
                    required={!isEditing && authType === "basic"}
                  />
                  {isEditing && (
                    <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                      Leave empty to keep the existing value. Enter a new value
                      to update it.
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="password"
                    className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                  >
                    Password {!isEditing ? "*" : ""}
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                    placeholder={
                      isEditing ? "Leave empty to keep existing value" : ""
                    }
                    required={!isEditing && authType === "basic"}
                  />
                  {isEditing && (
                    <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                      Leave empty to keep the existing value. Enter a new value
                      to update it.
                    </p>
                  )}
                </div>
              </>
            )}

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending
                ? isEditing
                  ? "Updating..."
                  : "Creating..."
                : isEditing
                ? "Update"
                : "Create"}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={isPending}
              className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
