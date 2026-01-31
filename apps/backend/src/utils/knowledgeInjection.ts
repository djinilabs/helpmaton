import type { ModelMessage } from "ai";

import type { DatabaseSchema } from "../tables/schema";

import { fromNanoDollars, toNanoDollars } from "./creditConversions";
import { InsufficientCreditsError, isCreditUserError } from "./creditErrors";
import { searchDocuments } from "./documentSearch";
import { extractEntitiesFromPrompt } from "./knowledgeInjection/entityExtraction";
import { searchGraphByEntities } from "./knowledgeInjection/graphSearch";
import { rerankSnippets } from "./knowledgeReranking";
import {
  adjustRerankingCreditReservation,
  queueRerankingCostVerification,
  refundRerankingCredits,
  reserveRerankingCredits,
} from "./knowledgeRerankingCredits";
import { searchMemory } from "./memory/searchMemory";
import type {
  KnowledgeSnippet,
  RerankingRequestContent,
  RerankingResultContent,
  UIMessage,
} from "./messageTypes";
import { getModelPricing } from "./pricing";
import { Sentry, ensureError } from "./sentry";
import type { AugmentedContext } from "./workspaceCreditContext";

type RerankingOutcome = {
  results: KnowledgeSnippet[];
  rerankingRequestMessage?: UIMessage;
  rerankingResultMessage?: UIMessage;
};

const buildEmptyInjectionResult = (
  messages: ModelMessage[],
): KnowledgeInjectionResult => ({
  modelMessages: messages,
  knowledgeInjectionMessage: null,
  rerankingRequestMessage: undefined,
  rerankingResultMessage: undefined,
});

const resolveSnippetCount = (agent: {
  knowledgeInjectionSnippetCount?: number;
}): number => {
  const snippetCount = agent.knowledgeInjectionSnippetCount ?? 5;
  return Math.max(1, Math.min(50, snippetCount));
};

const getExistingResults = (
  existingConversationMessages?: UIMessage[],
): KnowledgeSnippet[] | undefined => {
  if (
    !existingConversationMessages ||
    existingConversationMessages.length === 0
  ) {
    return undefined;
  }

  const existingKnowledgeMessage = findExistingKnowledgeInjectionMessage(
    existingConversationMessages,
  );
  if (
    existingKnowledgeMessage &&
    existingKnowledgeMessage.role === "user" &&
    existingKnowledgeMessage.knowledgeInjection === true &&
    existingKnowledgeMessage.knowledgeSnippets &&
    Array.isArray(existingKnowledgeMessage.knowledgeSnippets)
  ) {
    console.log(
      "[knowledgeInjection] Reusing existing knowledge injection message with",
      existingKnowledgeMessage.knowledgeSnippets.length,
      "snippets",
    );
    return existingKnowledgeMessage.knowledgeSnippets.map((snippet) => ({
      ...snippet,
      source: snippet.source ?? "document",
    }));
  }

  return undefined;
};

const buildRerankingRequestMessage = (params: {
  query: string;
  model: string;
  results: KnowledgeSnippet[];
}): UIMessage => {
  const documentNames = params.results.map((result, index) => {
    if (result.source === "document") {
      return result.documentName || `Document ${index + 1}`;
    }
    if (result.source === "memory") {
      return `Memory snippet ${index + 1}`;
    }
    return `Graph fact ${index + 1}`;
  });
  const rerankingRequestContent: RerankingRequestContent = {
    type: "reranking-request",
    query: params.query,
    model: params.model,
    documentCount: params.results.length,
    documentNames,
  };

  const requestText = `**Re-ranking Request**\n\n- **Model:** ${params.model}\n- **Documents:** ${params.results.length} document${params.results.length !== 1 ? "s" : ""}\n- **Query:** "${params.query}"`;

  return {
    role: "system",
    content: [{ type: "text", text: requestText }, rerankingRequestContent],
  };
};

const resolveRerankingCostNanoDollars = (params: {
  model: string;
  costUsd?: number;
}): number => {
  if (params.costUsd !== undefined && params.costUsd >= 0) {
    return toNanoDollars(params.costUsd);
  }

  const modelPricing = getModelPricing("openrouter", params.model);
  if (modelPricing?.usd?.request !== undefined) {
    const baseCost = modelPricing.usd.request;
    const costWithMarkup = baseCost * 1.055;
    const costInNanoDollars = toNanoDollars(costWithMarkup);
    console.log(
      "[knowledgeInjection] Cost not in reranking result, calculated from pricing config:",
      {
        model: params.model,
        requestPrice: modelPricing.usd.request,
        costWithMarkup,
        costInNanoDollars,
      },
    );
    return costInNanoDollars;
  }

  const message =
    "Could not determine re-ranking cost: no cost from provider and no pricing configuration available.";
  console.error("[knowledgeInjection] " + message, {
    model: params.model,
    costUsd: params.costUsd,
  });
  Sentry.captureException(
    ensureError(
      new Error(`${message} model=${params.model}, costUsd=${params.costUsd}`),
    ),
  );
  throw new Error(message);
};

const buildRerankingResultMessage = (params: {
  model: string;
  rerankingResult: {
    snippets: KnowledgeSnippet[];
    costUsd?: number;
    generationId?: string;
  };
  executionTimeMs: number;
  costNanoDollars: number;
}): UIMessage => {
  const rerankingResultContent: RerankingResultContent = {
    type: "reranking-result",
    model: params.model,
    documentCount: params.rerankingResult.snippets.length,
    costUsd: params.costNanoDollars,
    ...(params.rerankingResult.generationId && {
      generationId: params.rerankingResult.generationId,
    }),
    executionTimeMs: params.executionTimeMs,
    rerankedDocuments: params.rerankingResult.snippets.map(
      (snippet, index) => ({
        documentName:
          snippet.source === "document"
            ? snippet.documentName || `Document ${index + 1}`
            : snippet.source === "memory"
              ? `Memory snippet ${index + 1}`
              : `Graph fact ${index + 1}`,
        relevanceScore: snippet.similarity,
      }),
    ),
  };

  const costDisplay = `$${fromNanoDollars(params.costNanoDollars).toFixed(9)}`;
  const resultText = `**Re-ranking Result**\n\n- **Model:** ${params.model}\n- **Cost:** ${costDisplay}\n- **Documents Re-ranked:** ${params.rerankingResult.snippets.length} document${params.rerankingResult.snippets.length !== 1 ? "s" : ""}`;

  return {
    role: "system",
    content: [{ type: "text", text: resultText }, rerankingResultContent],
  };
};

const buildRerankingErrorMessage = (params: {
  model: string;
  error: unknown;
  results: KnowledgeSnippet[];
  executionTimeMs: number;
}): UIMessage => {
  const errorMessage =
    params.error instanceof Error ? params.error.message : String(params.error);
  const rerankingResultContent: RerankingResultContent = {
    type: "reranking-result",
    model: params.model,
    documentCount: params.results.length,
    costUsd: 0,
    executionTimeMs: params.executionTimeMs,
    rerankedDocuments: params.results.map((snippet, index) => ({
      documentName:
        snippet.source === "document"
          ? snippet.documentName || `Document ${index + 1}`
          : snippet.source === "memory"
            ? `Memory snippet ${index + 1}`
            : `Graph fact ${index + 1}`,
      relevanceScore: snippet.similarity,
    })),
    error: errorMessage,
  };

  const errorText = `**Re-ranking Result (Failed)**\n\n- **Model:** ${params.model}\n- **Cost:** $0.000000000\n- **Error:** ${errorMessage}\n- **Action:** Using original document order`;

  return {
    role: "system",
    content: [{ type: "text", text: errorText }, rerankingResultContent],
  };
};

const reserveRerankingCreditsIfNeeded = async (params: {
  db?: DatabaseSchema;
  context?: AugmentedContext;
  workspaceId: string;
  model: string;
  documentCount: number;
  agentId?: string;
  conversationId?: string;
  usesByok?: boolean;
}): Promise<string | undefined> => {
  if (params.usesByok) {
    console.log(
      "[knowledgeInjection] BYOK enabled, skipping credit reservation for re-ranking",
    );
    if (!params.model) {
      const byokConfigError = new Error(
        "BYOK is enabled for this workspace, but no knowledge reranking model is configured. " +
          "Please configure a reranking provider/API key in the workspace settings.",
      );

      Sentry.captureException(byokConfigError, {
        tags: {
          context: "knowledge-injection",
          operation: "reserve-reranking-credits",
          errorType: "ByokConfigurationError",
        },
        extra: {
          workspaceId: params.workspaceId,
          agentId: params.agentId,
          conversationId: params.conversationId,
        },
      });

      throw byokConfigError;
    }
    return undefined;
  }

  if (!params.db || !params.context) {
    throw new Error(
      "Database and context are required for re-ranking credit reservation",
    );
  }

  try {
    const reservation = await reserveRerankingCredits(
      params.db,
      params.workspaceId,
      params.model,
      params.documentCount,
      3,
      params.context,
      params.agentId,
      params.conversationId,
      params.usesByok,
    );
    console.log("[knowledgeInjection] Reserved credits for re-ranking:", {
      reservationId: reservation.reservationId,
      reservedAmount: reservation.reservedAmount,
    });
    return reservation.reservationId;
  } catch (error) {
    const errorObj = ensureError(error);

    if (isCreditUserError(errorObj)) {
      console.info(
        "[knowledgeInjection] Credit limits prevented re-ranking, returning original messages:",
        {
          error: errorObj.message,
          errorType: errorObj.name,
          workspaceId: params.workspaceId,
          agentId: params.agentId,
          conversationId: params.conversationId,
          model: params.model,
          documentCount: params.documentCount,
          required:
            errorObj instanceof InsufficientCreditsError
              ? errorObj.required
              : undefined,
          available:
            errorObj instanceof InsufficientCreditsError
              ? errorObj.available
              : undefined,
        },
      );
      throw errorObj;
    }

    console.error(
      "[knowledgeInjection] Failed to reserve credits for re-ranking:",
      errorObj.message,
    );
    Sentry.captureException(errorObj, {
      tags: {
        context: "knowledge-injection",
        operation: "reserve-reranking-credits",
      },
      extra: {
        workspaceId: params.workspaceId,
        agentId: params.agentId,
        conversationId: params.conversationId,
        model: params.model,
        documentCount: params.documentCount,
      },
    });
    throw errorObj;
  }
};

const adjustRerankingCreditsIfNeeded = async (params: {
  db?: DatabaseSchema;
  context?: AugmentedContext;
  reservationId?: string;
  workspaceId: string;
  agentId?: string;
  conversationId?: string;
  costUsd?: number;
  generationId?: string;
}) => {
  if (!params.db || !params.context || !params.reservationId) {
    return;
  }

  try {
    await adjustRerankingCreditReservation(
      params.db,
      params.reservationId,
      params.workspaceId,
      params.costUsd,
      params.generationId,
      params.context,
      3,
      params.agentId,
      params.conversationId,
    );

    if (params.generationId) {
      await queueRerankingCostVerification(
        params.reservationId,
        params.generationId,
        params.workspaceId,
        params.agentId,
        params.conversationId,
      );
    }
  } catch (error) {
    console.error(
      "[knowledgeInjection] Error adjusting re-ranking credits:",
      error instanceof Error ? error.message : String(error),
    );
    Sentry.captureException(ensureError(error), {
      tags: {
        context: "knowledge-injection",
        operation: "adjust-reranking-credits",
      },
      extra: {
        workspaceId: params.workspaceId,
        agentId: params.agentId,
        conversationId: params.conversationId,
        reservationId: params.reservationId,
        costUsd: params.costUsd,
        generationId: params.generationId,
      },
    });
  }
};

const refundRerankingCreditsIfNeeded = async (params: {
  db?: DatabaseSchema;
  context?: AugmentedContext;
  reservationId?: string;
  workspaceId: string;
  agentId?: string;
  conversationId?: string;
  originalError: unknown;
}) => {
  if (!params.db || !params.context || !params.reservationId) {
    return;
  }

  try {
    await refundRerankingCredits(
      params.db,
      params.reservationId,
      params.workspaceId,
      params.context,
      3,
      params.agentId,
      params.conversationId,
    );
  } catch (refundError) {
    console.error(
      "[knowledgeInjection] Error refunding re-ranking credits:",
      refundError instanceof Error ? refundError.message : String(refundError),
    );
    Sentry.captureException(ensureError(refundError), {
      tags: {
        context: "knowledge-injection",
        operation: "refund-reranking-credits",
      },
      extra: {
        workspaceId: params.workspaceId,
        agentId: params.agentId,
        conversationId: params.conversationId,
        reservationId: params.reservationId,
        originalError:
          params.originalError instanceof Error
            ? params.originalError.message
            : String(params.originalError),
      },
    });
  }
};

const performReranking = async (params: {
  workspaceId: string;
  agent: {
    enableKnowledgeReranking?: boolean;
    knowledgeRerankingModel?: string;
  };
  query: string;
  searchResults: KnowledgeSnippet[];
  db?: DatabaseSchema;
  context?: AugmentedContext;
  agentId?: string;
  conversationId?: string;
  usesByok?: boolean;
}): Promise<RerankingOutcome> => {
  if (
    !params.agent.enableKnowledgeReranking ||
    !params.agent.knowledgeRerankingModel
  ) {
    return { results: params.searchResults };
  }

  const model = params.agent.knowledgeRerankingModel;
  const rerankingReservationId = await reserveRerankingCreditsIfNeeded({
    db: params.db,
    context: params.context,
    workspaceId: params.workspaceId,
    model,
    documentCount: params.searchResults.length,
    agentId: params.agentId,
    conversationId: params.conversationId,
    usesByok: params.usesByok,
  });

  const rerankingRequestMessage = buildRerankingRequestMessage({
    query: params.query,
    model,
    results: params.searchResults,
  });

  const rerankingStartTime = Date.now();
  try {
    const rerankingResult = await rerankSnippets(
      params.query,
      params.searchResults,
      model,
      params.workspaceId,
    );
    const executionTimeMs = Date.now() - rerankingStartTime;
    const costNanoDollars = resolveRerankingCostNanoDollars({
      model,
      costUsd: rerankingResult.costUsd,
    });

    const rerankingResultMessage = buildRerankingResultMessage({
      model,
      rerankingResult,
      executionTimeMs,
      costNanoDollars,
    });

    await adjustRerankingCreditsIfNeeded({
      db: params.db,
      context: params.context,
      reservationId: rerankingReservationId,
      workspaceId: params.workspaceId,
      agentId: params.agentId,
      conversationId: params.conversationId,
      costUsd: rerankingResult.costUsd,
      generationId: rerankingResult.generationId,
    });

    return {
      results: rerankingResult.snippets,
      rerankingRequestMessage,
      rerankingResultMessage,
    };
  } catch (error) {
    const executionTimeMs = Date.now() - rerankingStartTime;
    console.error(
      "[knowledgeInjection] Error during re-ranking, using original results:",
      error instanceof Error ? error.message : String(error),
    );
    Sentry.captureException(ensureError(error), {
      tags: {
        context: "knowledge-injection",
        operation: "rerank-snippets",
      },
      extra: {
        workspaceId: params.workspaceId,
        agentId: params.agentId,
        conversationId: params.conversationId,
        model,
        documentCount: params.searchResults.length,
        reservationId: rerankingReservationId,
      },
    });

    const rerankingResultMessage = buildRerankingErrorMessage({
      model,
      error,
      results: params.searchResults,
      executionTimeMs,
    });

    await refundRerankingCreditsIfNeeded({
      db: params.db,
      context: params.context,
      reservationId: rerankingReservationId,
      workspaceId: params.workspaceId,
      agentId: params.agentId,
      conversationId: params.conversationId,
      originalError: error,
    });

    return {
      results: params.searchResults,
      rerankingRequestMessage,
      rerankingResultMessage,
    };
  }
};

const buildKnowledgeMessages = (
  knowledgePrompt: string,
  results: KnowledgeSnippet[],
) => {
  const knowledgeModelMessage: ModelMessage = {
    role: "user",
    content: knowledgePrompt,
  };

  const knowledgeUIMessage: UIMessage = {
    role: "user",
    content: knowledgePrompt,
    knowledgeInjection: true,
    knowledgeSnippets: results,
  };

  return { knowledgeModelMessage, knowledgeUIMessage };
};

const insertKnowledgeMessage = (
  messages: ModelMessage[],
  knowledgeMessage: ModelMessage,
): ModelMessage[] => {
  const firstUserIndex = messages.findIndex((msg) => msg.role === "user");
  if (firstUserIndex === -1) {
    return [knowledgeMessage, ...messages];
  }

  const updatedMessages = [...messages];
  updatedMessages.splice(firstUserIndex, 0, knowledgeMessage);
  return updatedMessages;
};

/**
 * Format search results into a structured knowledge prompt
 * @param results - Array of search results (snippets)
 * @returns Formatted knowledge prompt text
 */
function formatKnowledgePrompt(results: KnowledgeSnippet[]): string {
  if (results.length === 0) {
    return "";
  }

  const documentSnippets = results.filter(
    (result) => result.source === "document",
  );
  const memorySnippets = results.filter((result) => result.source === "memory");
  const graphSnippets = results.filter((result) => result.source === "graph");

  const sections: string[] = [];
  let globalIndex = 1;

  if (documentSnippets.length > 0) {
    const snippetsText = documentSnippets
      .map((result) => {
        const folderPathText = result.folderPath
          ? ` (${result.folderPath})`
          : "";
        const similarityPercent = (result.similarity * 100).toFixed(1);
        const snippetIndex = globalIndex++;

        return `[${snippetIndex}] Document: ${result.documentName}${folderPathText}
Similarity: ${similarityPercent}%
Content:
${result.snippet}

---`;
      })
      .join("\n\n");
    sections.push(`## Knowledge from Workspace Documents

${snippetsText}`);
  }

  if (memorySnippets.length > 0) {
    const snippetsText = memorySnippets
      .map((result) => {
        const dateLabel = result.date || result.timestamp || "Unknown date";
        const similarityPercent = (result.similarity * 100).toFixed(1);
        const snippetIndex = globalIndex++;

        return `[${snippetIndex}] Memory (${dateLabel})
Similarity: ${similarityPercent}%
Content:
${result.snippet}

---`;
      })
      .join("\n\n");
    sections.push(`## Knowledge from Agent Memories

${snippetsText}`);
  }

  if (graphSnippets.length > 0) {
    const snippetsText = graphSnippets
      .map((result) => {
        const similarityPercent = (result.similarity * 100).toFixed(1);
        const triple =
          result.subject && result.predicate && result.object
            ? `Subject: ${result.subject}\nPredicate: ${result.predicate}\nObject: ${result.object}`
            : result.snippet;
        const snippetIndex = globalIndex++;

        return `[${snippetIndex}] Fact
Similarity: ${similarityPercent}%
${triple}

---`;
      })
      .join("\n\n");
    sections.push(`## Knowledge from Agent Graph Facts

${snippetsText}`);
  }

  return `${sections.join("\n\n")}\n\n---\n\nPlease use this information to provide a comprehensive and accurate response to the user's query below.`;
}

/**
 * Find existing knowledge injection message in conversation
 * @param messages - Array of UI messages from conversation
 * @returns Knowledge injection message if found, null otherwise
 */
function findExistingKnowledgeInjectionMessage(
  messages: UIMessage[],
): UIMessage | null {
  return (
    messages.find(
      (msg) =>
        msg.role === "user" &&
        "knowledgeInjection" in msg &&
        msg.knowledgeInjection === true,
    ) || null
  );
}

/**
 * Extract query text from the first user message in the conversation
 * @param messages - Array of model messages
 * @returns Query text extracted from the first user message, or empty string if not found
 */
function extractQueryFromMessages(messages: ModelMessage[]): string {
  // Find the first user message (skip knowledge injection messages)
  const firstUserMessage = messages.find((msg) => msg.role === "user");

  if (!firstUserMessage) {
    return "";
  }

  // Extract text content from user message
  if (typeof firstUserMessage.content === "string") {
    return firstUserMessage.content.trim();
  }

  if (Array.isArray(firstUserMessage.content)) {
    // Extract text from content array
    const textParts = firstUserMessage.content
      .filter((part) => part.type === "text")
      .map((part) => (typeof part === "string" ? part : part.text))
      .join("");
    return textParts.trim();
  }

  return "";
}

/**
 * Result from knowledge injection
 */
export interface KnowledgeInjectionResult {
  modelMessages: ModelMessage[];
  knowledgeInjectionMessage: UIMessage | null;
  rerankingRequestMessage?: UIMessage; // Message showing the re-ranking request
  rerankingResultMessage?: UIMessage; // Message showing the re-ranking response with cost
}

/**
 * Inject knowledge from workspace documents into the conversation messages
 * Knowledge is injected as a new user message before the first user message
 * @param workspaceId - Workspace ID for document search
 * @param agent - Agent configuration
 * @param messages - Array of model messages to inject knowledge into
 * @param db - Database instance (optional, required for credit management)
 * @param context - Augmented Lambda context (optional, required for credit transactions)
 * @param agentId - Agent ID (optional, for credit tracking)
 * @param conversationId - Conversation ID (optional, for credit tracking)
 * @param usesByok - Whether workspace is using their own API key (optional)
 * @param existingConversationMessages - Existing UI messages from conversation (optional, for reuse)
 * @returns Updated array of model messages with knowledge injected, and knowledge injection UI message
 */
export async function injectKnowledgeIntoMessages(
  workspaceId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Agent type varies across codebase
  agent: any,
  messages: ModelMessage[],
  db?: DatabaseSchema,
  context?: AugmentedContext,
  agentId?: string,
  conversationId?: string,
  usesByok?: boolean,
  existingConversationMessages?: UIMessage[],
): Promise<KnowledgeInjectionResult> {
  // Check if knowledge injection is enabled
  if (!agent.enableKnowledgeInjection) {
    return buildEmptyInjectionResult(messages);
  }

  const enableKnowledgeInjectionFromDocuments =
    agent.enableKnowledgeInjectionFromDocuments ?? true;
  const enableKnowledgeInjectionFromMemories =
    agent.enableKnowledgeInjectionFromMemories ?? false;
  const canInjectFromMemories =
    enableKnowledgeInjectionFromMemories && !!agentId;
  if (enableKnowledgeInjectionFromMemories && !agentId) {
    console.warn(
      "[knowledgeInjection] Memory injection enabled but agentId is missing; skipping memory and graph search.",
      {
        workspaceId,
        conversationId,
      },
    );
  }

  if (
    !enableKnowledgeInjectionFromDocuments &&
    !enableKnowledgeInjectionFromMemories
  ) {
    return buildEmptyInjectionResult(messages);
  }

  // Check for existing knowledge injection message in conversation
  let finalResults = getExistingResults(existingConversationMessages);
  let rerankingRequestMessage: UIMessage | undefined;
  let rerankingResultMessage: UIMessage | undefined;

  // Extract query from first user message
  const query = extractQueryFromMessages(messages);
  if (!query || query.length === 0) {
    // No query to search for, skip injection
    return buildEmptyInjectionResult(messages);
  }

  // If we don't have existing results, perform search
  if (!finalResults) {
    try {
      const validSnippetCount = resolveSnippetCount(agent);
      const fetchLimit = Math.min(50, validSnippetCount * 2);

      const documentSnippets = enableKnowledgeInjectionFromDocuments
        ? (
            await searchDocuments(workspaceId, query, fetchLimit, {
              db,
              context,
              agentId,
              conversationId,
            })
          ).map((result) => ({
            ...result,
            source: "document" as const,
          }))
        : [];

      let memorySnippets: KnowledgeSnippet[] = [];
      let graphSnippets: KnowledgeSnippet[] = [];
      if (canInjectFromMemories) {
        const memoryResults = await searchMemory({
          agentId,
          workspaceId,
          grain: "working",
          maxResults: fetchLimit,
          queryText: query,
          db,
          context,
          conversationId,
        });
        memorySnippets = memoryResults.map((result) => ({
          snippet: result.content,
          similarity: result.similarity ?? 1,
          source: "memory",
          timestamp: result.timestamp,
          date: result.date,
        }));

        const entities = await extractEntitiesFromPrompt({
          workspaceId,
          agentId,
          prompt: query,
          modelName: agent.knowledgeInjectionEntityExtractorModel,
          context,
          conversationId,
        });
        const graphResults = await searchGraphByEntities({
          workspaceId,
          agentId,
          entities,
        });
        graphSnippets = graphResults.map((result) => ({
          snippet: result.snippet,
          similarity: result.similarity,
          source: "graph",
          subject: result.subject,
          predicate: result.predicate,
          object: result.object,
        }));
      }

      const searchResults = [
        ...documentSnippets,
        ...memorySnippets,
        ...graphSnippets,
      ];

      if (searchResults.length === 0) {
        return buildEmptyInjectionResult(messages);
      }

      const rerankingOutcome = await performReranking({
        workspaceId,
        agent,
        query,
        searchResults,
        db,
        context,
        agentId,
        conversationId,
        usesByok,
      });

      finalResults = rerankingOutcome.results.slice(0, validSnippetCount);
      rerankingRequestMessage = rerankingOutcome.rerankingRequestMessage;
      rerankingResultMessage = rerankingOutcome.rerankingResultMessage;
    } catch (error) {
      const errorObj = ensureError(error);
      if (isCreditUserError(errorObj)) {
        console.info(
          "[knowledgeInjection] Credit limits prevented knowledge injection, returning original messages:",
          {
            error: errorObj.message,
            errorType: errorObj.name,
            workspaceId,
            agentId,
            conversationId,
          },
        );
        return buildEmptyInjectionResult(messages);
      }

      console.error("[knowledgeInjection] Error during knowledge search:", {
        message: errorObj.message,
      });
      Sentry.captureException(errorObj, {
        tags: {
          context: "knowledge-injection",
          operation: "search-knowledge",
        },
        extra: {
          workspaceId,
          agentId,
          conversationId,
          query,
        },
      });
      // Return original messages if search fails
      return buildEmptyInjectionResult(messages);
    }
  }

  // At this point, finalResults should be set
  if (!finalResults || finalResults.length === 0) {
    return buildEmptyInjectionResult(messages);
  }

  // Filter snippets by minimum similarity score
  const minSimilarity = agent.knowledgeInjectionMinSimilarity ?? 0;
  const filteredResults = finalResults.filter(
    (result) => result.similarity >= minSimilarity,
  );

  // If filtering results in empty array, return early
  if (filteredResults.length === 0) {
    return buildEmptyInjectionResult(messages);
  }

  try {
    // Format knowledge prompt
    const knowledgePrompt = formatKnowledgePrompt(filteredResults);
    if (!knowledgePrompt || knowledgePrompt.length === 0) {
      return buildEmptyInjectionResult(messages);
    }

    const { knowledgeModelMessage, knowledgeUIMessage } =
      buildKnowledgeMessages(knowledgePrompt, filteredResults);

    const updatedMessages = insertKnowledgeMessage(
      messages,
      knowledgeModelMessage,
    );

    return {
      modelMessages: updatedMessages,
      knowledgeInjectionMessage: knowledgeUIMessage,
      rerankingRequestMessage,
      rerankingResultMessage,
    };
  } catch (error) {
    console.error(
      "[knowledgeInjection] Error during knowledge injection:",
      error instanceof Error ? error.message : String(error),
    );
    Sentry.captureException(ensureError(error), {
      tags: {
        context: "knowledge-injection",
        operation: "inject-knowledge",
      },
      extra: {
        workspaceId,
        agentId,
        conversationId,
        enableKnowledgeInjection: agent.enableKnowledgeInjection,
        enableKnowledgeReranking: agent.enableKnowledgeReranking,
      },
    });
    // Return original messages if injection fails
    return buildEmptyInjectionResult(messages);
  }
}
