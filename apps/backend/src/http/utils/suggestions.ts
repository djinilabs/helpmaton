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
  "agent_eval_judges",
  "agent_schedules",
  "agent_document_search",
  "agent_knowledge_injection",
  "agent_delegation",
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
    evalJudgeCount?: number;
    scheduleCount?: number;
    delegatableAgentIds?: string[];
  };
};

const SUGGESTIONS_SYSTEM_PROMPT = `You are a product onboarding assistant for Helpmaton.

## Product
Helpmaton is a workspace-based AI agent management platform. Users create workspaces, add AI agents with custom prompts and models, manage documents and knowledge bases, and deploy agents via webhooks and APIs. Workspaces have credits (usage), spending limits, team members, and integrations (MCP servers, Discord, Slack, email).

## Subject and scope
You will receive a subject: either "workspace" or "agent". Your suggestions must match the subject exactly:
- When subject is **workspace**: suggest only workspace-level next steps. Use only actionTypes that start with workspace_ (workspace_api_keys, workspace_spending_limits, workspace_team, workspace_documents, workspace_agents, workspace_integrations, workspace_credits). Never suggest agent_* action types.
- When subject is **agent**: suggest only agent-level next steps for a single agent. Use only actionTypes that start with agent_ (agent_model, agent_memory, agent_tools, agent_eval_judges, agent_schedules, agent_document_search, agent_knowledge_injection, agent_delegation). Never suggest workspace_* action types.

## Workspace capabilities (suggest only when subject is "workspace")
- **API keys**: Add an OpenRouter API key so the workspace can call LLMs (bring-your-own-key; more model choices and control).
- **Agents**: Create and configure AI agents (name, system prompt, model).
- **Documents**: Upload markdown/text documents that agents can search and cite.
- **Team**: Invite members and set permissions (read/write/owner).
- **Integrations**: Connect MCP servers (tools, data sources), Discord, Slack, or email for agent workflows.
- **Credits**: Purchase or request trial credits to pay for model usage.
- **Spending limits**: Set daily/weekly/monthly caps to control cost.

## Agent capabilities (suggest only when subject is "agent")
- **Model**: Choose the LLM (e.g. OpenAI, Anthropic via OpenRouter) and parameters.
- **Memory**: Enable memory search so the agent stores and recalls facts from conversations.
- **Document search**: Let the agent search workspace documents when answering.
- **Knowledge injection**: Combine memory and documents for richer context.
- **Tools**: Enable MCP tools (from connected servers), send email, web search (Tavily/Exa), or image generation.
- **Eval judges**: In the agent's **Evaluations** section, add evaluation judges to assess conversations. Each judge uses an LLM and a prompt to score agent runs (e.g. goal completion, tool efficiency, faithfulness). Suggest only when the agent has no evaluation judges configured.
- **Schedules**: In the agent's **Schedules** section, add cron-style schedules so the agent runs periodically (e.g. daily summaries). Suggest only when the agent has no schedules.
- **Document search**: In the agent's **Document search** section, enable search over workspace documents so the agent can cite documents when answering. Suggest only when document search is not yet enabled.
- **Knowledge injection**: In the agent's **Knowledge injection** section, enable combining memory and documents for richer context. Suggest only when knowledge injection is not yet enabled.
- **Delegation**: In the agent's **Delegation** section, configure which other agents this agent can call (call_agent tool). Suggest only when no delegatable agents are configured.

## What to suggest
- Suggest the next step that adds the most value given the current configuration (e.g. no agents → create first agent; agent has no memory → enable memory).
- The "Do NOT suggest" list is authoritative: never suggest something already done.
- Suggestions must be specific and actionable (one sentence each).
- Return JSON only. Use one of these shapes:
  - {"suggestions": ["text one", "text two"]}
  - {"suggestions": [{"text": "text one", "actionType": "workspace_api_keys"}, ...]}
- actionType is optional. When the suggestion clearly maps to one UI section, set actionType so the app can show a "Go to X" link. Use exactly one of the following, and only from the list that matches the subject (workspace vs agent):

  If subject is workspace (use only these): workspace_api_keys, workspace_spending_limits, workspace_team, workspace_documents, workspace_agents, workspace_integrations, workspace_credits
  If subject is agent (use only these): agent_model, agent_memory, agent_tools, agent_eval_judges, agent_schedules, agent_document_search, agent_knowledge_injection, agent_delegation`;

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
    if (agent?.enableKnowledgeInjection === true) {
      lines.push("- Enabling knowledge injection (already enabled).");
    }
    if ((agent?.enabledMcpServerIds?.length ?? 0) > 0) {
      lines.push("- Connecting or enabling MCP tools for this agent (already configured).");
    }
    if ((agent?.evalJudgeCount ?? 0) > 0) {
      lines.push("- Adding evaluation judges (already configured).");
    }
    if ((agent?.scheduleCount ?? 0) > 0) {
      lines.push("- Adding schedules (already configured).");
    }
    if ((agent?.delegatableAgentIds?.length ?? 0) > 0) {
      lines.push("- Configuring delegation (already configured).");
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
    evalJudgeCount?: number;
    scheduleCount?: number;
    delegatableAgentIds?: string[];
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
      evalJudgeCount: params.agent.evalJudgeCount ?? 0,
      scheduleCount: params.agent.scheduleCount ?? 0,
      delegatableAgentIds: params.agent.delegatableAgentIds ?? [],
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
    evalJudgeCount?: number;
    scheduleCount?: number;
    delegatableAgentIds?: string[];
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
