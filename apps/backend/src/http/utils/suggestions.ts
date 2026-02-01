import { createHash, randomUUID } from "crypto";

import { generateText } from "ai";
import { z } from "zod";

import type { DatabaseSchema } from "../../tables/schema";
import { parseJsonWithFallback } from "../../utils/jsonParsing";

import { createModel, getDefaultModel } from "./modelFactory";
import { createRequestTimeout, cleanupRequestTimeout } from "./requestTimeout";

const MAX_SUGGESTIONS = 3;
const MAX_PROMPT_CHARS = 600;

/** Action types that map to UI sections; frontend uses these to show "Go to X" links. */
export const SUGGESTION_ACTION_TYPES = [
  "workspace_api_keys",
  "workspace_spending_limits",
  "workspace_team",
  "workspace_documents",
  "workspace_agents",
  "workspace_integrations",
  "workspace_credits",
  "agent_model",
  "agent_memory",
  "agent_tools",
] as const;

export type SuggestionActionType = (typeof SUGGESTION_ACTION_TYPES)[number];

const suggestionEntrySchema = z.union([
  z.string().min(1),
  z.object({ text: z.string().min(1), actionType: z.string().optional() }),
]);

const suggestionsResponseSchema = z
  .object({
    suggestions: z
      .array(suggestionEntrySchema)
      .min(1)
      .max(MAX_SUGGESTIONS),
  })
  .strict();

export type SuggestionItem = {
  id: string;
  text: string;
  /** Stored as string in DB; validated against SUGGESTION_ACTION_TYPES when used. */
  actionType?: string;
};

export type SuggestionsCache = {
  items: SuggestionItem[];
  generatedAt: string;
  contextHash?: string;
  dismissedIds?: string[];
};

type WorkspaceSuggestionContext = {
  workspace: {
    name: string;
    description?: string | null;
    creditBalance: number;
    spendingLimits: Array<{ timeFrame: string; amount: number }>;
    apiKeys?: {
      openrouter?: boolean;
    };
  };
  connections: {
    hasConnectedTools: boolean;
    hasEmailConnection: boolean;
  };
  resources: {
    hasAgents: boolean;
    hasDocuments: boolean;
    hasOutputChannels: boolean;
  };
};

type AgentSuggestionContext = {
  workspace: WorkspaceSuggestionContext["workspace"] & {
    connections: WorkspaceSuggestionContext["connections"];
  };
  agent: {
    name: string;
    modelName?: string | null;
    provider?: string | null;
    systemPromptPreview?: string;
    enableMemorySearch?: boolean;
    enableSearchDocuments?: boolean;
    enableKnowledgeInjection?: boolean;
    enableKnowledgeInjectionFromMemories?: boolean;
    enableKnowledgeInjectionFromDocuments?: boolean;
    enableKnowledgeReranking?: boolean;
    enableSendEmail?: boolean;
    enableImageGeneration?: boolean;
    searchWebProvider?: string | null;
    fetchWebProvider?: string | null;
    enableExaSearch?: boolean;
    enabledMcpServerIds?: string[];
    enabledMcpServerToolNames?: Record<string, string[]>;
    clientTools?: Array<{ name: string; description: string }>;
  };
};

const SUGGESTIONS_SYSTEM_PROMPT = `You are a product onboarding assistant. Given configuration data and a list of things you must NOT suggest, propose up to ${MAX_SUGGESTIONS} short, actionable suggestions a user can take in the UI.

Guidelines:
- Suggestions must be specific and actionable (one sentence each).
- Only suggest what is actually missing or would improve the setup. Never suggest something that is already done (the "Do NOT suggest" list is authoritative).
- Return JSON with one of these shapes:
  - {"suggestions": ["text one", "text two"]}
  - {"suggestions": [{"text": "text one", "actionType": "workspace_api_keys"}, ...]}
- actionType is optional. When the suggestion maps to a single UI section, set actionType so the app can show a "Go to X" link. Use exactly one of these (omit if none fit):

  Workspace (subject workspace only):
  - workspace_api_keys: suggestion is about adding or managing API keys (e.g. OpenRouter) in workspace settings
  - workspace_spending_limits: suggestion is about setting spending limits
  - workspace_team: suggestion is about inviting or managing team members
  - workspace_documents: suggestion is about uploading or managing documents
  - workspace_agents: suggestion is about creating or managing agents
  - workspace_integrations: suggestion is about connecting MCP servers, Discord, Slack, or other integrations
  - workspace_credits: suggestion is about buying or managing credits / balance

  Agent (subject agent only):
  - agent_model: suggestion is about choosing or changing the model
  - agent_memory: suggestion is about enabling or configuring memory search / memory records
  - agent_tools: suggestion is about enabling MCP tools, email, web search, or other tools for the agent`;

const truncateText = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars).trimEnd() + "…";
};

const ALLOWED_ACTION_TYPES_SET = new Set<string>(SUGGESTION_ACTION_TYPES);

function buildProhibitionRules(
  context: WorkspaceSuggestionContext | AgentSuggestionContext,
  subject: "workspace" | "agent",
): string {
  const lines: string[] = ["Do NOT suggest any of the following (they are already set or not applicable):"];
  const w =
    "workspace" in context
      ? (context as AgentSuggestionContext).workspace
      : (context as WorkspaceSuggestionContext).workspace;
  const conn =
    "connections" in context
      ? (context as WorkspaceSuggestionContext).connections
      : (context as AgentSuggestionContext).workspace?.connections;
  const res =
    "resources" in context
      ? (context as WorkspaceSuggestionContext).resources
      : undefined;

  if (w?.apiKeys?.openrouter === true) {
    lines.push("- Adding or connecting an OpenRouter API key (already set).");
  }
  if (conn?.hasConnectedTools === true) {
    lines.push("- Connecting MCP tools or connected tools (already connected).");
  }
  if (conn?.hasEmailConnection === true) {
    lines.push("- Connecting email (already connected).");
  }
  if (res?.hasAgents === true && subject === "workspace") {
    lines.push("- Creating a first agent (workspace already has agents).");
  }
  if (res?.hasDocuments === true) {
    lines.push("- Adding documents (workspace already has documents).");
  }
  if (res?.hasOutputChannels === true) {
    lines.push("- Adding output channels (already configured).");
  }
  if ((w?.spendingLimits?.length ?? 0) > 0) {
    lines.push("- Adding spending limits (already set).");
  }
  if (subject === "agent") {
    const agent = (context as AgentSuggestionContext).agent;
    if (agent?.enableMemorySearch === true) {
      lines.push("- Enabling memory search (already enabled).");
    }
    if (agent?.enableSearchDocuments === true) {
      lines.push("- Enabling document search (already enabled).");
    }
    if ((agent?.enabledMcpServerIds?.length ?? 0) > 0) {
      lines.push("- Connecting or enabling MCP tools for this agent (already configured).");
    }
  }
  return lines.join("\n");
}

const buildContextHash = (context: unknown): string => {
  return createHash("sha256")
    .update(JSON.stringify(context))
    .digest("hex");
};

type SuggestionEntry = { text: string; actionType?: SuggestionActionType };

const generateSuggestionEntries = async (params: {
  workspaceId: string;
  context: WorkspaceSuggestionContext | AgentSuggestionContext;
  subject: "workspace" | "agent";
}): Promise<SuggestionEntry[]> => {
  const modelName = getDefaultModel();
  const model = await createModel("openrouter", modelName, params.workspaceId);
  const requestTimeout = createRequestTimeout();
  const prohibitionRules = buildProhibitionRules(params.context, params.subject);

  try {
    const result = await generateText({
      model,
      system: SUGGESTIONS_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `${prohibitionRules}\n\nConfiguration JSON:\n${JSON.stringify(
            params.context,
            null,
            2,
          )}\n\nGenerate ${params.subject} suggestions (only for what is missing).`,
        },
      ],
      abortSignal: requestTimeout.signal,
    });

    const parsed = parseJsonWithFallback<unknown>(result.text);
    const validated = suggestionsResponseSchema.parse(parsed);
    const entries: SuggestionEntry[] = [];
    const seenText = new Set<string>();
    for (const raw of validated.suggestions) {
      const text =
        typeof raw === "string"
          ? raw.replace(/\s+/g, " ").trim()
          : (raw as { text: string; actionType?: string }).text?.replace(
              /\s+/g,
              " ",
            )?.trim();
      if (!text) continue;
      const key = text.toLowerCase();
      if (seenText.has(key)) continue;
      seenText.add(key);
      let actionType: SuggestionActionType | undefined;
      if (typeof raw === "object" && raw !== null && "actionType" in raw) {
        const at = (raw as { actionType?: string }).actionType;
        if (typeof at === "string" && ALLOWED_ACTION_TYPES_SET.has(at)) {
          actionType = at as SuggestionActionType;
        }
      }
      entries.push({ text, actionType });
      if (entries.length >= MAX_SUGGESTIONS) break;
    }
    return entries;
  } finally {
    cleanupRequestTimeout(requestTimeout);
  }
};

const buildSuggestionItems = (entries: SuggestionEntry[]): SuggestionItem[] => {
  return entries.map(({ text, actionType }) => ({
    id: randomUUID(),
    text,
    ...(actionType ? { actionType } : {}),
  }));
};

const filterDismissedSuggestions = (
  items: SuggestionItem[],
  dismissedIds?: string[],
): SuggestionItem[] => {
  if (!dismissedIds || dismissedIds.length === 0) {
    return items;
  }
  const dismissedSet = new Set(dismissedIds);
  return items.filter((item) => !dismissedSet.has(item.id));
};

const applyDismissedFilter = (
  cache: SuggestionsCache | null,
): SuggestionsCache | null => {
  if (!cache) {
    return null;
  }
  return {
    ...cache,
    items: filterDismissedSuggestions(cache.items, cache.dismissedIds),
  };
};

const hasAnyWorkspaceItems = async (
  db: Awaited<ReturnType<typeof import("../../tables").database>>,
  params: {
    table: keyof DatabaseSchema;
    workspaceId: string;
  },
): Promise<boolean> => {
  const result = await db[params.table].queryPaginated(
    {
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": params.workspaceId,
      },
    },
    { limit: 1 },
  );
  return result.items.length > 0;
};

export const buildWorkspaceSuggestionContext = async (params: {
  db: Awaited<ReturnType<typeof import("../../tables").database>>;
  workspace: {
    name: string;
    description?: string | null;
    creditBalance?: number;
    spendingLimits?: Array<{ timeFrame: string; amount: number }>;
  };
  workspaceId: string;
  apiKeys?: { openrouter?: boolean };
}): Promise<WorkspaceSuggestionContext> => {
  const { db, workspaceId, workspace, apiKeys } = params;
  const [hasConnectedTools, hasEmailConnection, hasAgents, hasDocuments, hasOutputChannels] =
    await Promise.all([
      hasAnyWorkspaceItems(db, { table: "mcp-server", workspaceId }),
      hasAnyWorkspaceItems(db, { table: "email-connection", workspaceId }),
      hasAnyWorkspaceItems(db, { table: "agent", workspaceId }),
      hasAnyWorkspaceItems(db, { table: "workspace-document", workspaceId }),
      hasAnyWorkspaceItems(db, { table: "output_channel", workspaceId }),
    ]);

  return {
    workspace: {
      name: workspace.name,
      description: workspace.description,
      creditBalance: workspace.creditBalance ?? 0,
      spendingLimits: workspace.spendingLimits ?? [],
      apiKeys,
    },
    connections: {
      hasConnectedTools,
      hasEmailConnection,
    },
    resources: {
      hasAgents,
      hasDocuments,
      hasOutputChannels,
    },
  };
};

export const buildAgentSuggestionContext = (params: {
  workspaceContext: WorkspaceSuggestionContext;
  agent: {
    name: string;
    systemPrompt: string;
    modelName?: string | null;
    provider?: string | null;
    enableMemorySearch?: boolean;
    enableSearchDocuments?: boolean;
    enableKnowledgeInjection?: boolean;
    enableKnowledgeInjectionFromMemories?: boolean;
    enableKnowledgeInjectionFromDocuments?: boolean;
    enableKnowledgeReranking?: boolean;
    enableSendEmail?: boolean;
    enableImageGeneration?: boolean;
    searchWebProvider?: string | null;
    fetchWebProvider?: string | null;
    enableExaSearch?: boolean;
    enabledMcpServerIds?: string[];
    enabledMcpServerToolNames?: Record<string, string[]>;
    clientTools?: Array<{ name: string; description: string }>;
  };
}): AgentSuggestionContext => {
  const preview = truncateText(
    params.agent.systemPrompt.replace(/\s+/g, " ").trim(),
    MAX_PROMPT_CHARS,
  );
  return {
    workspace: {
      ...params.workspaceContext.workspace,
      connections: params.workspaceContext.connections,
    },
    agent: {
      name: params.agent.name,
      modelName: params.agent.modelName ?? null,
      provider: params.agent.provider ?? null,
      systemPromptPreview: preview,
      enableMemorySearch: params.agent.enableMemorySearch ?? false,
      enableSearchDocuments: params.agent.enableSearchDocuments ?? false,
      enableKnowledgeInjection: params.agent.enableKnowledgeInjection ?? false,
      enableKnowledgeInjectionFromMemories:
        params.agent.enableKnowledgeInjectionFromMemories ?? false,
      enableKnowledgeInjectionFromDocuments:
        params.agent.enableKnowledgeInjectionFromDocuments ?? true,
      enableKnowledgeReranking: params.agent.enableKnowledgeReranking ?? false,
      enableSendEmail: params.agent.enableSendEmail ?? false,
      enableImageGeneration: params.agent.enableImageGeneration ?? false,
      searchWebProvider: params.agent.searchWebProvider ?? null,
      fetchWebProvider: params.agent.fetchWebProvider ?? null,
      enableExaSearch: params.agent.enableExaSearch ?? false,
      enabledMcpServerIds: params.agent.enabledMcpServerIds ?? [],
      enabledMcpServerToolNames: params.agent.enabledMcpServerToolNames ?? {},
      clientTools: params.agent.clientTools ?? [],
    },
  };
};

export const resolveWorkspaceSuggestions = async (params: {
  db: Awaited<ReturnType<typeof import("../../tables").database>>;
  workspaceId: string;
  workspacePk: string;
  workspace: {
    name: string;
    description?: string | null;
    creditBalance?: number;
    spendingLimits?: Array<{ timeFrame: string; amount: number }>;
    suggestions?: SuggestionsCache | null;
  };
  apiKeys?: { openrouter?: boolean };
}): Promise<SuggestionsCache | null> => {
  const context = await buildWorkspaceSuggestionContext(params);
  const contextHash = buildContextHash(context);
  const existingCache = params.workspace.suggestions ?? null;

  if (existingCache && existingCache.contextHash === contextHash) {
    return {
      ...existingCache,
      items: filterDismissedSuggestions(
        existingCache.items,
        existingCache.dismissedIds,
      ),
    };
  }

  try {
    const entries = await generateSuggestionEntries({
      workspaceId: params.workspaceId,
      context,
      subject: "workspace",
    });

    if (entries.length === 0) {
      return applyDismissedFilter(existingCache);
    }

    const cache: SuggestionsCache = {
      items: buildSuggestionItems(entries),
      generatedAt: new Date().toISOString(),
      contextHash,
      dismissedIds: [],
    };

    await params.db.workspace.update({
      pk: params.workspacePk,
      sk: "workspace",
      suggestions: cache,
    });

    return cache;
  } catch (error) {
    console.warn("[Suggestions] Failed to generate workspace suggestions:", {
      error: error instanceof Error ? error.message : String(error),
      workspaceId: params.workspaceId,
    });
    return applyDismissedFilter(existingCache);
  }
};

export const resolveAgentSuggestions = async (params: {
  db: Awaited<ReturnType<typeof import("../../tables").database>>;
  workspaceId: string;
  agentId: string;
  agentPk: string;
  workspaceContext: WorkspaceSuggestionContext;
  agent: {
    name: string;
    systemPrompt: string;
    modelName?: string | null;
    provider?: string | null;
    enableMemorySearch?: boolean;
    enableSearchDocuments?: boolean;
    enableKnowledgeInjection?: boolean;
    enableKnowledgeInjectionFromMemories?: boolean;
    enableKnowledgeInjectionFromDocuments?: boolean;
    enableKnowledgeReranking?: boolean;
    enableSendEmail?: boolean;
    enableImageGeneration?: boolean;
    searchWebProvider?: string | null;
    fetchWebProvider?: string | null;
    enableExaSearch?: boolean;
    enabledMcpServerIds?: string[];
    enabledMcpServerToolNames?: Record<string, string[]>;
    clientTools?: Array<{ name: string; description: string }>;
    suggestions?: SuggestionsCache | null;
  };
}): Promise<SuggestionsCache | null> => {
  const context = buildAgentSuggestionContext({
    workspaceContext: params.workspaceContext,
    agent: params.agent,
  });
  const contextHash = buildContextHash(context);
  const existingCache = params.agent.suggestions ?? null;

  if (existingCache && existingCache.contextHash === contextHash) {
    return {
      ...existingCache,
      items: filterDismissedSuggestions(
        existingCache.items,
        existingCache.dismissedIds,
      ),
    };
  }

  try {
    const entries = await generateSuggestionEntries({
      workspaceId: params.workspaceId,
      context,
      subject: "agent",
    });

    if (entries.length === 0) {
      return applyDismissedFilter(existingCache);
    }

    const cache: SuggestionsCache = {
      items: buildSuggestionItems(entries),
      generatedAt: new Date().toISOString(),
      contextHash,
      dismissedIds: [],
    };

    await params.db.agent.update({
      pk: params.agentPk,
      sk: "agent",
      suggestions: cache,
    });

    return cache;
  } catch (error) {
    console.warn("[Suggestions] Failed to generate agent suggestions:", {
      error: error instanceof Error ? error.message : String(error),
      workspaceId: params.workspaceId,
      agentId: params.agentId,
    });
    return applyDismissedFilter(existingCache);
  }
};

export const dismissSuggestion = (
  cache: SuggestionsCache | null,
  suggestionId: string,
): SuggestionsCache | null => {
  if (!cache) return null;
  const hasSuggestion = cache.items.some((item) => item.id === suggestionId);
  if (!hasSuggestion) {
    return cache;
  }
  const dismissed = new Set(cache.dismissedIds ?? []);
  dismissed.add(suggestionId);
  const dismissedIds = Array.from(dismissed);
  return {
    ...cache,
    dismissedIds,
    items: filterDismissedSuggestions(cache.items, dismissedIds),
  };
};
