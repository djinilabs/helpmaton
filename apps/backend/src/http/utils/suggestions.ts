import { createHash, randomUUID } from "crypto";

import { generateText } from "ai";
import { z } from "zod";

import type { DatabaseSchema } from "../../tables/schema";
import { parseJsonWithFallback } from "../../utils/jsonParsing";

import { createModel, getDefaultModel } from "./modelFactory";
import { createRequestTimeout, cleanupRequestTimeout } from "./requestTimeout";

const MAX_SUGGESTIONS = 3;
const MAX_PROMPT_CHARS = 600;

const suggestionsResponseSchema = z
  .object({
    suggestions: z.array(z.string().min(1)).min(1).max(MAX_SUGGESTIONS),
  })
  .strict();

export type SuggestionItem = {
  id: string;
  text: string;
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

const SUGGESTIONS_SYSTEM_PROMPT = `You are a product onboarding assistant. Given configuration data, propose up to ${MAX_SUGGESTIONS} short, actionable suggestions a user can take in the UI.

Guidelines:
- Suggestions must be specific and actionable (one sentence each).
- Tailor to what is missing or could improve the setup.
- Avoid repeating existing configuration that is already set.
- Avoid generic advice. Focus on next steps in this product.
- Return JSON only with the exact shape: {"suggestions": ["..."]}`.trim();

const truncateText = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars).trimEnd() + "…";
};

const normalizeSuggestions = (suggestions: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of suggestions) {
    const cleaned = raw.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(cleaned);
    if (normalized.length >= MAX_SUGGESTIONS) break;
  }
  return normalized;
};

const buildContextHash = (context: unknown): string => {
  return createHash("sha256")
    .update(JSON.stringify(context))
    .digest("hex");
};

const generateSuggestionTexts = async (params: {
  workspaceId: string;
  context: object;
  subject: "workspace" | "agent";
}): Promise<string[]> => {
  const modelName = getDefaultModel();
  const model = await createModel("openrouter", modelName, params.workspaceId);
  const requestTimeout = createRequestTimeout();

  try {
    const result = await generateText({
      model,
      system: SUGGESTIONS_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Generate ${params.subject} suggestions based on this configuration JSON:\n\n${JSON.stringify(
            params.context,
            null,
            2,
          )}`,
        },
      ],
      abortSignal: requestTimeout.signal,
    });

    const parsed = parseJsonWithFallback<unknown>(result.text);
    const validated = suggestionsResponseSchema.parse(parsed);
    return normalizeSuggestions(validated.suggestions);
  } finally {
    cleanupRequestTimeout(requestTimeout);
  }
};

const buildSuggestionItems = (suggestions: string[]): SuggestionItem[] => {
  return suggestions.map((text) => ({
    id: randomUUID(),
    text,
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
  // Skip suggestion generation in test environments
  if (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "testing") {
    return null;
  }

  const context = await buildWorkspaceSuggestionContext(params);
  const contextHash = buildContextHash(context);
  const existingCache = params.workspace.suggestions ?? null;

  if (
    existingCache &&
    existingCache.items.length > 0 &&
    existingCache.contextHash === contextHash
  ) {
    return {
      ...existingCache,
      items: filterDismissedSuggestions(
        existingCache.items,
        existingCache.dismissedIds,
      ),
    };
  }

  try {
    const suggestions = await generateSuggestionTexts({
      workspaceId: params.workspaceId,
      context,
      subject: "workspace",
    });

    if (suggestions.length === 0) {
      return applyDismissedFilter(existingCache);
    }

    const cache: SuggestionsCache = {
      items: buildSuggestionItems(suggestions),
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
  // Skip suggestion generation in test environments
  if (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "testing") {
    return null;
  }

  const context = buildAgentSuggestionContext({
    workspaceContext: params.workspaceContext,
    agent: params.agent,
  });
  const contextHash = buildContextHash(context);
  const existingCache = params.agent.suggestions ?? null;

  if (
    existingCache &&
    existingCache.items.length > 0 &&
    existingCache.contextHash === contextHash
  ) {
    return {
      ...existingCache,
      items: filterDismissedSuggestions(
        existingCache.items,
        existingCache.dismissedIds,
      ),
    };
  }

  try {
    const suggestions = await generateSuggestionTexts({
      workspaceId: params.workspaceId,
      context,
      subject: "agent",
    });

    if (suggestions.length === 0) {
      return applyDismissedFilter(existingCache);
    }

    const cache: SuggestionsCache = {
      items: buildSuggestionItems(suggestions),
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
