 
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
  ShoppingBagIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import type { FC, FormEvent, ReactNode } from "react";

import { useDialogTracking } from "../contexts/DialogContext";
import { useEscapeKey } from "../hooks/useEscapeKey";
import {
  useCreateMcpServer,
  useUpdateMcpServer,
  useMcpServer,
} from "../hooks/useMcpServers";
import type {
  CreateMcpServerInput,
  McpServer,
  UpdateMcpServerInput,
} from "../utils/api";
import { trackEvent } from "../utils/tracking";

type McpServerType =
  | "google-drive"
  | "gmail"
  | "google-calendar"
  | "notion"
  | "github"
  | "linear"
  | "hubspot"
  | "shopify"
  | "salesforce"
  | "slack"
  | "intercom"
  | "todoist"
  | "zendesk"
  | "stripe"
  | "posthog"
  | "custom";

type McpServerAuthType = "none" | "header" | "basic";
type PosthogRegion = "us" | "eu";

interface McpServerTypeMetadata {
  value: McpServerType;
  name: string;
  description: string;
  icon: FC<{ className?: string }>;
}

interface McpServerFormState {
  name: string;
  mcpType: McpServerType;
  url: string;
  authType: McpServerAuthType;
  headerValue: string;
  username: string;
  password: string;
  posthogRegion: PosthogRegion;
  posthogApiKey: string;
  zendeskSubdomain: string;
  zendeskClientId: string;
  zendeskClientSecret: string;
  shopifyShopDomain: string;
}

const MCP_SERVER_TYPES: McpServerTypeMetadata[] = [
  {
    value: "slack",
    name: "Slack",
    description:
      "Read channel history, list channels, and post messages. Perfect for team updates and collaboration.",
    icon: ChatBubbleLeftRightIcon,
  },
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
    value: "intercom",
    name: "Intercom",
    description:
      "Read and reply to conversations, and manage contacts as an admin.",
    icon: ChatBubbleLeftRightIcon,
  },
  {
    value: "zendesk",
    name: "Zendesk",
    description:
      "Search tickets, read ticket threads, draft private replies, and search Help Center articles.",
    icon: ChatBubbleLeftRightIcon,
  },
  {
    value: "shopify",
    name: "Shopify",
    description:
      "Look up orders, check product inventory, and summarize sales for a date range.",
    icon: ShoppingBagIcon,
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
    value: "todoist",
    name: "Todoist",
    description:
      "Create, list, and complete tasks. Summarize what is due today or this week.",
    icon: ClipboardDocumentListIcon,
  },
  {
    value: "custom",
    name: "Custom MCP",
    description:
      "Connect to external MCP servers with custom authentication (none, header, or basic auth).",
    icon: ServerIcon,
  },
];

const POSTHOG_BASE_URLS = {
  us: "https://us.posthog.com",
  eu: "https://eu.posthog.com",
} as const;

const OAUTH_MCP_TYPES = new Set<McpServerType>([
  "google-drive",
  "gmail",
  "google-calendar",
  "notion",
  "github",
  "linear",
  "hubspot",
  "shopify",
  "salesforce",
  "slack",
  "intercom",
  "todoist",
  "zendesk",
  "stripe",
]);

const DEFAULT_FORM_STATE: McpServerFormState = {
  name: "",
  mcpType: "google-drive",
  url: "",
  authType: "none",
  headerValue: "",
  username: "",
  password: "",
  posthogRegion: "us",
  posthogApiKey: "",
  zendeskSubdomain: "",
  zendeskClientId: "",
  zendeskClientSecret: "",
  shopifyShopDomain: "",
};

const DEFAULT_OAUTH_HELP_TEXT =
  "After creating the server, you\u2019ll need to connect your account via OAuth.";

const MCP_TYPE_HELP_TEXTS: Partial<Record<McpServerType, string>> = {
  github:
    "After creating the server, you\u2019ll need to connect your GitHub account via OAuth (read-only access).",
  linear:
    "After creating the server, you\u2019ll need to connect your Linear account via OAuth (read-only access).",
  salesforce:
    "After creating the server, you\u2019ll need to connect your Salesforce account via OAuth (read-only access).",
  intercom:
    "After creating the server, you\u2019ll need to connect your Intercom admin account via OAuth.",
  zendesk:
    "Provide your Zendesk subdomain and OAuth client credentials. After creating the server, you\u2019ll connect via OAuth.",
  shopify:
    "Provide your Shopify shop domain. After creating the server, you\u2019ll connect via OAuth.",
  posthog:
    "You\u2019ll be prompted for a PostHog personal API key and region (US or EU). This gives read-only access via the PostHog API.",
};

const LABEL_CLASSNAME =
  "mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300";
const HINT_CLASSNAME = "mt-1.5 text-xs text-neutral-600 dark:text-neutral-300";
const INPUT_CLASSNAME =
  "w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400";
const INPUT_MONO_CLASSNAME = `${INPUT_CLASSNAME} font-mono`;
const SELECT_CLASSNAME = INPUT_CLASSNAME;

const MCP_TYPE_LABELS = MCP_SERVER_TYPES.reduce(
  (labels, serverType) => ({
    ...labels,
    [serverType.value]: serverType.name,
  }),
  {} as Record<McpServerType, string>
);

const resolvePosthogRegion = (serverUrl?: string): PosthogRegion =>
  serverUrl?.includes("eu.posthog.com") ? "eu" : "us";

const resolveMcpTypeFromServer = (server: McpServer): McpServerType => {
  if (server.serviceType === "posthog") {
    return "posthog";
  }
  if (server.authType === "oauth") {
    return server.serviceType as McpServerType;
  }
  return "custom";
};

const buildFormStateFromServer = (server: McpServer): McpServerFormState => {
  const mcpType = resolveMcpTypeFromServer(server);
  if (mcpType === "posthog") {
    return {
      ...DEFAULT_FORM_STATE,
      name: server.name,
      url: server.url || "",
      mcpType,
      authType: "header",
      posthogRegion: resolvePosthogRegion(server.url || undefined),
    };
  }

  if (OAUTH_MCP_TYPES.has(mcpType)) {
    return {
      ...DEFAULT_FORM_STATE,
      name: server.name,
      url: server.url || "",
      mcpType,
    };
  }

  return {
    ...DEFAULT_FORM_STATE,
    name: server.name,
    url: server.url || "",
    mcpType: "custom",
    authType: server.authType as McpServerAuthType,
  };
};

const getCreateHelperText = (mcpType: McpServerType) => {
  const helpText: string[] = [];
  if (OAUTH_MCP_TYPES.has(mcpType)) {
    helpText.push(DEFAULT_OAUTH_HELP_TEXT);
  }
  const specificHelpText = MCP_TYPE_HELP_TEXTS[mcpType];
  if (specificHelpText) {
    helpText.push(specificHelpText);
  }
  return helpText;
};

const getTrimmedFormValues = (formState: McpServerFormState) => ({
  name: formState.name.trim(),
  url: formState.url.trim(),
  headerValue: formState.headerValue.trim(),
  username: formState.username.trim(),
  password: formState.password.trim(),
  posthogApiKey: formState.posthogApiKey.trim(),
  zendeskSubdomain: formState.zendeskSubdomain.trim(),
  zendeskClientId: formState.zendeskClientId.trim(),
  zendeskClientSecret: formState.zendeskClientSecret.trim(),
  shopifyShopDomain: formState.shopifyShopDomain.trim(),
});

const buildAuthConfig = ({
  trimmedValues,
  authType,
  isZendeskServer,
  isShopifyServer,
}: {
  trimmedValues: ReturnType<typeof getTrimmedFormValues>;
  authType: McpServerAuthType;
  isZendeskServer: boolean;
  isShopifyServer: boolean;
}): CreateMcpServerInput["config"] => {
  const config: CreateMcpServerInput["config"] = {};

  if (isZendeskServer) {
    if (trimmedValues.zendeskSubdomain) {
      config.subdomain = trimmedValues.zendeskSubdomain;
    }
    if (trimmedValues.zendeskClientId) {
      config.clientId = trimmedValues.zendeskClientId;
    }
    if (trimmedValues.zendeskClientSecret) {
      config.clientSecret = trimmedValues.zendeskClientSecret;
    }
    return config;
  }

  if (isShopifyServer) {
    if (trimmedValues.shopifyShopDomain) {
      config.shopDomain = trimmedValues.shopifyShopDomain;
    }
    return config;
  }

  if (authType === "header" && trimmedValues.headerValue) {
    config.headerValue = trimmedValues.headerValue;
  }
  if (authType === "basic") {
    if (trimmedValues.username) {
      config.username = trimmedValues.username;
    }
    if (trimmedValues.password) {
      config.password = trimmedValues.password;
    }
  }

  return config;
};

const buildCreatePayload = ({
  formState,
  trimmedValues,
  selectedPosthogBaseUrl,
}: {
  formState: McpServerFormState;
  trimmedValues: ReturnType<typeof getTrimmedFormValues>;
  selectedPosthogBaseUrl: string;
}): {
  input: CreateMcpServerInput;
  authType: CreateMcpServerInput["authType"];
  serviceType: NonNullable<CreateMcpServerInput["serviceType"]>;
} => {
  const name = trimmedValues.name;

  if (formState.mcpType === "posthog") {
    return {
      input: {
        name,
        url: selectedPosthogBaseUrl,
        authType: "header",
        serviceType: "posthog",
        config: { apiKey: trimmedValues.posthogApiKey },
      },
      authType: "header",
      serviceType: "posthog",
    };
  }

  if (formState.mcpType === "custom") {
    const config = buildAuthConfig({
      trimmedValues,
      authType: formState.authType,
      isZendeskServer: false,
      isShopifyServer: false,
    });
    return {
      input: {
        name,
        url: trimmedValues.url,
        authType: formState.authType,
        serviceType: "external",
        config:
          formState.authType === "header" || formState.authType === "basic"
            ? config
            : {},
      },
      authType: formState.authType,
      serviceType: "external",
    };
  }

  if (formState.mcpType === "zendesk") {
    return {
      input: {
        name,
        authType: "oauth",
        serviceType: "zendesk",
        config: {
          subdomain: trimmedValues.zendeskSubdomain,
          clientId: trimmedValues.zendeskClientId,
          clientSecret: trimmedValues.zendeskClientSecret,
        },
      },
      authType: "oauth",
      serviceType: "zendesk",
    };
  }

  if (formState.mcpType === "shopify") {
    return {
      input: {
        name,
        authType: "oauth",
        serviceType: "shopify",
        config: {
          shopDomain: trimmedValues.shopifyShopDomain,
        },
      },
      authType: "oauth",
      serviceType: "shopify",
    };
  }

  return {
    input: {
      name,
      authType: "oauth",
      serviceType: formState.mcpType,
      config: {},
    },
    authType: "oauth",
    serviceType: formState.mcpType,
  };
};

const buildUpdatePayload = ({
  formState,
  trimmedValues,
  server,
  selectedPosthogBaseUrl,
}: {
  formState: McpServerFormState;
  trimmedValues: ReturnType<typeof getTrimmedFormValues>;
  server?: McpServer;
  selectedPosthogBaseUrl: string;
}): {
  updateData: UpdateMcpServerInput;
  updatedFields: string[];
} => {
  const updateData: UpdateMcpServerInput = {
    name: trimmedValues.name,
  };
  const updatedFields: string[] = [];

  if (trimmedValues.name !== server?.name) {
    updatedFields.push("name");
  }

  const isOAuthServer =
    server?.authType === "oauth" && server?.serviceType !== "posthog";
  const isPosthogServer = server?.serviceType === "posthog";
  const isZendeskServer =
    server?.authType === "oauth" && server?.serviceType === "zendesk";
  const isShopifyServer =
    server?.authType === "oauth" && server?.serviceType === "shopify";

  if (!isOAuthServer && !isPosthogServer) {
    if (server && trimmedValues.url !== (server.url || "")) {
      updateData.url = trimmedValues.url || undefined;
      updatedFields.push("url");
    }
    if (server && formState.authType !== server.authType) {
      updateData.authType = formState.authType;
      updatedFields.push("auth_type");
    }
  }

  if (isPosthogServer) {
    if (server && selectedPosthogBaseUrl !== (server.url || "")) {
      updateData.url = selectedPosthogBaseUrl;
      updatedFields.push("region");
    }
  }

  if (
    (!isOAuthServer && !isPosthogServer) ||
    isZendeskServer ||
    isShopifyServer
  ) {
    const authTypeChanged = server && formState.authType !== server.authType;
    const hasNewCredentials = isZendeskServer
      ? !!trimmedValues.zendeskSubdomain ||
        !!trimmedValues.zendeskClientId ||
        !!trimmedValues.zendeskClientSecret
      : isShopifyServer
      ? !!trimmedValues.shopifyShopDomain
      : formState.authType === "header"
      ? !!trimmedValues.headerValue
      : formState.authType === "basic"
      ? !!trimmedValues.username && !!trimmedValues.password
      : false;

    if (authTypeChanged || hasNewCredentials) {
      const config = buildAuthConfig({
        trimmedValues,
        authType: formState.authType,
        isZendeskServer,
        isShopifyServer,
      });

      if (formState.authType !== "none" || isZendeskServer || isShopifyServer) {
        updateData.config = config;
      }
      updatedFields.push("config");
    }
  }

  if (isPosthogServer && trimmedValues.posthogApiKey) {
    updateData.config = { apiKey: trimmedValues.posthogApiKey };
    updatedFields.push("config");
  }

  return { updateData, updatedFields };
};

const FormField = ({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}) => (
  <div>
    <label htmlFor={htmlFor} className={LABEL_CLASSNAME}>
      {label}
    </label>
    {children}
    {hint ? <p className={HINT_CLASSNAME}>{hint}</p> : null}
  </div>
);

const OAuthManagedNotice = ({ name }: { name: string }) => (
  <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
    <p className="text-sm text-neutral-700 dark:text-neutral-300">
      This is a {name} MCP server. OAuth connection is managed separately.
    </p>
  </div>
);

const ServerTypeCard = ({
  serverType,
  isSelected,
  onSelect,
}: {
  serverType: McpServerTypeMetadata;
  isSelected: boolean;
  onSelect: () => void;
}) => {
  const Icon = serverType.icon;

  return (
    <button
      type="button"
      onClick={onSelect}
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
};

interface McpServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  serverId?: string; // If provided, we're editing; otherwise, creating
}

interface McpServerModalStateProps extends McpServerModalProps {
  server?: McpServer;
}

const useMcpServerModalState = ({
  isOpen,
  onClose,
  workspaceId,
  serverId,
  server,
}: McpServerModalStateProps) => {
  const isEditing = !!serverId;
  const createServer = useCreateMcpServer(workspaceId);
  const updateServer = useUpdateMcpServer(workspaceId);
  const [formState, setFormState] = useState<McpServerFormState>(() =>
    server ? buildFormStateFromServer(server) : DEFAULT_FORM_STATE
  );

  const updateFormState = (patch: Partial<McpServerFormState>) => {
    setFormState((previous) => ({
      ...previous,
      ...patch,
    }));
  };

  const handleClose = () => {
    setFormState(DEFAULT_FORM_STATE);
    onClose();
  };

  useEscapeKey(isOpen, handleClose);

  const { registerDialog, unregisterDialog } = useDialogTracking();
  useEffect(() => {
    if (isOpen) {
      registerDialog();
      return () => unregisterDialog();
    }
  }, [isOpen, registerDialog, unregisterDialog]);

  const isPosthogType = formState.mcpType === "posthog";
  const isZendeskType = formState.mcpType === "zendesk";
  const isShopifyType = formState.mcpType === "shopify";
  const selectedPosthogBaseUrl = POSTHOG_BASE_URLS[formState.posthogRegion];
  const createHelperText = getCreateHelperText(formState.mcpType);
  const oauthNoticeName =
    server && server.authType === "oauth" && server.serviceType !== "posthog"
      ? MCP_TYPE_LABELS[resolveMcpTypeFromServer(server)]
      : null;
  const canEditAuthFields =
    formState.mcpType === "custom" ||
    (isEditing &&
      server &&
      server.authType !== "oauth" &&
      server.serviceType !== "posthog");

  const handleTypeSelect = (nextType: McpServerType) => {
    const isPosthogOption = nextType === "posthog";
    const isOAuthOption = nextType !== "custom" && !isPosthogOption;

    updateFormState({
      mcpType: nextType,
      ...(nextType !== "zendesk"
        ? {
            zendeskSubdomain: "",
            zendeskClientId: "",
            zendeskClientSecret: "",
          }
        : {}),
      ...(isOAuthOption
        ? {
            authType: "none",
            url: "",
            posthogRegion: "us",
            posthogApiKey: "",
          }
        : isPosthogOption
        ? {
            authType: "header",
            url: POSTHOG_BASE_URLS.us,
            posthogRegion: "us",
            posthogApiKey: "",
          }
        : { authType: "none" }),
    });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedValues = getTrimmedFormValues(formState);

    if (!trimmedValues.name) return;
    if (formState.mcpType === "custom" && !trimmedValues.url) return;

    if (formState.mcpType === "custom") {
      if (!isEditing) {
        if (formState.authType === "header" && !trimmedValues.headerValue) {
          return;
        }
        if (
          formState.authType === "basic" &&
          (!trimmedValues.username || !trimmedValues.password)
        ) {
          return;
        }
      } else if (server && formState.authType !== server.authType) {
        if (formState.authType === "header" && !trimmedValues.headerValue) {
          return;
        }
        if (
          formState.authType === "basic" &&
          (!trimmedValues.username || !trimmedValues.password)
        ) {
          return;
        }
      }
    }

    if (isPosthogType && !isEditing && !trimmedValues.posthogApiKey) {
      return;
    }

    if (isZendeskType) {
      if (!isEditing) {
        if (
          !trimmedValues.zendeskSubdomain ||
          !trimmedValues.zendeskClientId ||
          !trimmedValues.zendeskClientSecret
        ) {
          return;
        }
      } else {
        const hasSubdomain = !!trimmedValues.zendeskSubdomain;
        const hasClientId = !!trimmedValues.zendeskClientId;
        if ((hasSubdomain || hasClientId) && (!hasSubdomain || !hasClientId)) {
          return;
        }
      }
    }

    if (isShopifyType && !isEditing && !trimmedValues.shopifyShopDomain) {
      return;
    }

    try {
      if (isEditing && serverId) {
        const { updateData, updatedFields } = buildUpdatePayload({
          formState,
          trimmedValues,
          server,
          selectedPosthogBaseUrl,
        });

        await updateServer.mutateAsync({
          serverId,
          input: updateData,
        });

        trackEvent("mcp_server_updated", {
          workspace_id: workspaceId,
          server_id: serverId,
          server_name: trimmedValues.name,
          updated_fields: updatedFields,
        });
      } else {
        const { input, authType, serviceType } = buildCreatePayload({
          formState,
          trimmedValues,
          selectedPosthogBaseUrl,
        });

        const result = await createServer.mutateAsync(input);
        trackEvent("mcp_server_created", {
          workspace_id: workspaceId,
          server_id: result.id,
          auth_type: authType,
          service_type: serviceType,
        });
      }

      handleClose();
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const isPending = isEditing ? updateServer.isPending : createServer.isPending;

  return {
    isEditing,
    server,
    formState,
    updateFormState,
    handleTypeSelect,
    handleSubmit,
    handleClose,
    isPosthogType,
    isZendeskType,
    isShopifyType,
    canEditAuthFields,
    createHelperText,
    oauthNoticeName,
    isPending,
  };
};

const McpServerModalContent: FC<McpServerModalStateProps> = (props) => {
  const { isOpen } = props;
  const {
    isEditing,
    server,
    formState,
    updateFormState,
    handleTypeSelect,
    handleSubmit,
    handleClose,
    isPosthogType,
    isZendeskType,
    isShopifyType,
    canEditAuthFields,
    createHelperText,
    oauthNoticeName,
    isPending,
  } = useMcpServerModalState(props);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="mb-8 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          {isEditing ? "Edit MCP Server" : "Create MCP Server"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          <FormField label="Name *" htmlFor="name">
            <input
              id="name"
              type="text"
              value={formState.name}
              onChange={(event) =>
                updateFormState({ name: event.target.value })
              }
              className={INPUT_CLASSNAME}
              required
            />
          </FormField>

          {!isEditing && (
            <div>
              <label className={LABEL_CLASSNAME}>MCP Server Type *</label>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {MCP_SERVER_TYPES.map((serverType) => (
                  <ServerTypeCard
                    key={serverType.value}
                    serverType={serverType}
                    isSelected={formState.mcpType === serverType.value}
                    onSelect={() => handleTypeSelect(serverType.value)}
                  />
                ))}
              </div>
              {createHelperText.map((text, index) => (
                <p
                  key={text}
                  className={`text-xs text-neutral-600 dark:text-neutral-300 ${
                    index === 0 ? "mt-3" : "mt-1.5"
                  }`}
                >
                  {text}
                </p>
              ))}
            </div>
          )}

          {formState.mcpType === "custom" && !isEditing && (
            <>
              <FormField label="URL *" htmlFor="url">
                <input
                  id="url"
                  type="url"
                  value={formState.url}
                  onChange={(event) =>
                    updateFormState({ url: event.target.value })
                  }
                  className={INPUT_MONO_CLASSNAME}
                  placeholder="https://example.com/mcp"
                  required
                />
              </FormField>

              <FormField label="Authentication Type *" htmlFor="authType">
                <select
                  id="authType"
                  value={formState.authType}
                  onChange={(event) =>
                    updateFormState({
                      authType: event.target.value as McpServerAuthType,
                    })
                  }
                  className={SELECT_CLASSNAME}
                  required
                >
                  <option value="none">None</option>
                  <option value="header">Header (Authorization)</option>
                  <option value="basic">HTTP Basic Auth</option>
                </select>
              </FormField>
            </>
          )}

          {isPosthogType && (
            <>
              <FormField label="PostHog Region *" htmlFor="posthogRegion">
                <select
                  id="posthogRegion"
                  value={formState.posthogRegion}
                  onChange={(event) =>
                    updateFormState({
                      posthogRegion: event.target.value as PosthogRegion,
                    })
                  }
                  className={SELECT_CLASSNAME}
                  required
                >
                  <option value="us">US (us.posthog.com)</option>
                  <option value="eu">EU (eu.posthog.com)</option>
                </select>
              </FormField>
              <FormField
                label={
                  <>
                    Personal API Key {!isEditing ? "*" : ""}
                  </>
                }
                htmlFor="posthogApiKey"
                hint={
                  isEditing
                    ? "Leave empty to keep the existing key. Enter a new key to update it."
                    : "Create a personal API key in PostHog settings."
                }
              >
                <input
                  id="posthogApiKey"
                  type="password"
                  value={formState.posthogApiKey}
                  onChange={(event) =>
                    updateFormState({ posthogApiKey: event.target.value })
                  }
                  className={INPUT_MONO_CLASSNAME}
                  placeholder={
                    isEditing
                      ? "Leave empty to keep existing key"
                      : "phx_xxxxxxxxxxxxxxxxx"
                  }
                  required={!isEditing}
                />
              </FormField>
            </>
          )}

          {isZendeskType && (
            <>
              <FormField
                label="Zendesk Subdomain *"
                htmlFor="zendeskSubdomain"
                hint={
                  <>
                    Use the subdomain from your Zendesk URL (e.g. the
                    &quot;yourcompany&quot; in{" "}
                    https://yourcompany.zendesk.com).
                  </>
                }
              >
                <input
                  id="zendeskSubdomain"
                  type="text"
                  value={formState.zendeskSubdomain}
                  onChange={(event) =>
                    updateFormState({ zendeskSubdomain: event.target.value })
                  }
                  className={INPUT_MONO_CLASSNAME}
                  placeholder="yourcompany"
                  required={!isEditing}
                />
              </FormField>
              <FormField label="OAuth Client ID *" htmlFor="zendeskClientId">
                <input
                  id="zendeskClientId"
                  type="text"
                  value={formState.zendeskClientId}
                  onChange={(event) =>
                    updateFormState({ zendeskClientId: event.target.value })
                  }
                  className={INPUT_MONO_CLASSNAME}
                  placeholder="zendesk_client_id"
                  required={!isEditing}
                />
              </FormField>
              <FormField
                label={
                  <>
                    OAuth Client Secret {!isEditing ? "*" : ""}
                  </>
                }
                htmlFor="zendeskClientSecret"
                hint={
                  <>
                    Create a Zendesk OAuth client with scopes{" "}
                    &quot;tickets:read&quot;, &quot;tickets:write&quot;, and
                    &quot;help_center:read&quot;.
                  </>
                }
              >
                <input
                  id="zendeskClientSecret"
                  type="password"
                  value={formState.zendeskClientSecret}
                  onChange={(event) =>
                    updateFormState({ zendeskClientSecret: event.target.value })
                  }
                  className={INPUT_MONO_CLASSNAME}
                  placeholder={
                    isEditing
                      ? "Leave empty to keep existing secret"
                      : "zendesk_client_secret"
                  }
                  required={!isEditing}
                />
              </FormField>
            </>
          )}

          {isShopifyType && (
            <FormField
              label="What is your shop domain? *"
              htmlFor="shopifyShopDomain"
              hint="Enter the full Shopify domain (e.g. my-cool-store.myshopify.com)."
            >
              <input
                id="shopifyShopDomain"
                type="text"
                value={formState.shopifyShopDomain}
                onChange={(event) =>
                  updateFormState({ shopifyShopDomain: event.target.value })
                }
                className={INPUT_MONO_CLASSNAME}
                placeholder="my-cool-store.myshopify.com"
                required={!isEditing}
              />
            </FormField>
          )}

          {isEditing && server && (
            <>
              {server.serviceType === "posthog" ? null : server.authType ===
                "oauth" ? (
                oauthNoticeName ? (
                  <OAuthManagedNotice name={oauthNoticeName} />
                ) : null
              ) : (
                <>
                  <FormField label="URL *" htmlFor="url">
                    <input
                      id="url"
                      type="url"
                      value={formState.url}
                      onChange={(event) =>
                        updateFormState({ url: event.target.value })
                      }
                      className={INPUT_MONO_CLASSNAME}
                      placeholder="https://example.com/mcp"
                      required
                    />
                  </FormField>

                  <FormField label="Authentication Type *" htmlFor="authType">
                    <select
                      id="authType"
                      value={formState.authType}
                      onChange={(event) =>
                        updateFormState({
                          authType: event.target.value as McpServerAuthType,
                        })
                      }
                      className={SELECT_CLASSNAME}
                      required
                    >
                      <option value="none">None</option>
                      <option value="header">Header (Authorization)</option>
                      <option value="basic">HTTP Basic Auth</option>
                    </select>
                  </FormField>
                </>
              )}
            </>
          )}

          {canEditAuthFields && formState.authType === "header" && (
            <FormField
              label={
                <>
                  Authorization Header Value {!isEditing ? "*" : ""}
                </>
              }
              htmlFor="headerValue"
              hint={
                isEditing
                  ? "Leave empty to keep the existing value. Enter a new value to update it."
                  : "This value will be used in the Authorization header"
              }
            >
              <input
                id="headerValue"
                type="password"
                value={formState.headerValue}
                onChange={(event) =>
                  updateFormState({ headerValue: event.target.value })
                }
                className={INPUT_MONO_CLASSNAME}
                placeholder={
                  isEditing
                    ? "Leave empty to keep existing value"
                    : "Bearer token123 or token123"
                }
                required={!isEditing}
              />
            </FormField>
          )}

          {canEditAuthFields && formState.authType === "basic" && (
            <>
              <FormField
                label={
                  <>
                    Username {!isEditing ? "*" : ""}
                  </>
                }
                htmlFor="username"
                hint={
                  isEditing
                    ? "Leave empty to keep the existing value. Enter a new value to update it."
                    : undefined
                }
              >
                <input
                  id="username"
                  type="text"
                  value={formState.username}
                  onChange={(event) =>
                    updateFormState({ username: event.target.value })
                  }
                  className={INPUT_CLASSNAME}
                  placeholder={isEditing ? "Leave empty to keep existing value" : ""}
                  required={!isEditing}
                />
              </FormField>
              <FormField
                label={
                  <>
                    Password {!isEditing ? "*" : ""}
                  </>
                }
                htmlFor="password"
                hint={
                  isEditing
                    ? "Leave empty to keep the existing value. Enter a new value to update it."
                    : undefined
                }
              >
                <input
                  id="password"
                  type="password"
                  value={formState.password}
                  onChange={(event) =>
                    updateFormState({ password: event.target.value })
                  }
                  className={INPUT_CLASSNAME}
                  placeholder={isEditing ? "Leave empty to keep existing value" : ""}
                  required={!isEditing}
                />
              </FormField>
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

export const McpServerModal: FC<McpServerModalProps> = (props) => {
  const { isOpen, workspaceId, serverId } = props;
  const { data: server } = useMcpServer(workspaceId, serverId || "");

  if (!isOpen) return null;

  const contentKey = serverId ? server?.id ?? "loading" : "new";

  return (
    <McpServerModalContent
      key={contentKey}
      {...props}
      server={server}
    />
  );
};
