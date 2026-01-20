import { randomUUID } from "crypto";

import type { ModelMessage } from "ai";
import { generateText } from "ai";

import { database } from "../../tables";
import {
  extractTokenUsage,
  updateConversation,
} from "../../utils/conversationLogger";
import {
  adjustCreditReservation,
  refundReservation,
} from "../../utils/creditManagement";
import { validateCreditsAndLimitsAndReserve } from "../../utils/creditValidation";
import { isCreditDeductionEnabled } from "../../utils/featureFlags";
import type { UIMessage } from "../../utils/messageTypes";
import { Sentry, ensureError } from "../../utils/sentry";
import { extractTokenUsageAndCosts } from "../utils/generationTokenExtraction";

import { MODEL_NAME } from "./agent-constants";
import { getWorkspaceApiKey } from "./agent-keys";
import { buildGenerateTextOptions, createAgentModel } from "./agent-model";
import {
  buildConversationMessagesFromObserver,
  buildObserverInputMessages,
  createLlmObserver,
  getGenerationTimingFromObserver,
  wrapToolsWithObserver,
} from "./llmObserver";
import { createMcpServerTools } from "./mcpUtils";
import type { Provider } from "./modelFactory";

type CreditContext = Awaited<
  ReturnType<
    typeof import("../../utils/workspaceCreditContext").getContextFromRequestId
  >
>;

type ToolSet = NonNullable<Parameters<typeof generateText>[0]["tools"]>;
type DelegationTools = ToolSet;

const buildDelegationTools = async (params: {
  workspaceId: string;
  targetAgentId: string;
  extractedTargetAgentId: string;
  targetAgentConversationId: string;
  targetAgent: {
    enableSearchDocuments?: boolean;
    enableMemorySearch?: boolean;
    searchWebProvider?: "tavily" | "jina" | null;
    fetchWebProvider?: "tavily" | "jina" | "scrape" | null;
    enableExaSearch?: boolean;
    notificationChannelId?: string;
    enableSendEmail?: boolean;
    enabledMcpServerIds?: string[];
    clientTools?: Array<Record<string, unknown>>;
    delegatableAgentIds?: string[];
    [key: string]: unknown;
  };
  message: string;
  context?: CreditContext;
  conversationId?: string;
  conversationOwnerAgentId?: string;
  callDepth: number;
  maxDepth: number;
}): Promise<DelegationTools> => {
  const {
    workspaceId,
    targetAgentId,
    extractedTargetAgentId,
    targetAgentConversationId,
    targetAgent,
    message,
    context,
    conversationId,
    conversationOwnerAgentId,
    callDepth,
    maxDepth,
  } = params;

  const {
    createGetDatetimeTool,
    createSearchDocumentsTool,
    createSendNotificationTool,
    createSendEmailTool,
    createListAgentsTool,
    createCallAgentTool,
    createCallAgentAsyncTool,
    createCheckDelegationStatusTool,
  } = await import("./agentUtils");

   
  const tools: ToolSet = {} as ToolSet;

  tools.get_datetime = createGetDatetimeTool();

  if (targetAgent.enableSearchDocuments === true) {
    tools.search_documents = createSearchDocumentsTool(workspaceId, {
      messages: [{ role: "user", content: message }],
    });
  }

  if (targetAgent.enableMemorySearch === true) {
    const { createSearchMemoryTool } = await import("./memorySearchTool");
    tools.search_memory = createSearchMemoryTool(
      extractedTargetAgentId,
      workspaceId
    );
  }

  if (targetAgent.searchWebProvider === "tavily") {
    const { createTavilySearchTool } = await import("./tavilyTools");
    tools.search_web = createTavilySearchTool(workspaceId, context, targetAgentId);
  } else if (targetAgent.searchWebProvider === "jina") {
    const { createJinaSearchTool } = await import("./tavilyTools");
    tools.search_web = createJinaSearchTool(workspaceId, targetAgentId);
  }

  if (targetAgent.fetchWebProvider === "tavily") {
    const { createTavilyFetchTool } = await import("./tavilyTools");
    tools.fetch_url = createTavilyFetchTool(workspaceId, context, targetAgentId);
  } else if (targetAgent.fetchWebProvider === "jina") {
    const { createJinaFetchTool } = await import("./tavilyTools");
    tools.fetch_url = createJinaFetchTool(workspaceId, targetAgentId);
  } else if (targetAgent.fetchWebProvider === "scrape") {
    if (targetAgentId) {
      const { createScrapeFetchTool } = await import("./tavilyTools");
      tools.fetch_url = createScrapeFetchTool(
        workspaceId,
        context,
        targetAgentId,
        targetAgentConversationId
      );
    } else {
      console.warn(
        "[Agent Delegation] Scrape tool not created - targetAgentId not available:",
        {
          workspaceId,
          targetAgentId,
        }
      );
    }
  }

  if (targetAgent.enableExaSearch === true) {
    const { createExaSearchTool } = await import("./exaTools");
    tools.search = createExaSearchTool(workspaceId, context, targetAgentId);
  }

  if (targetAgent.notificationChannelId) {
    tools.send_notification = createSendNotificationTool(
      workspaceId,
      targetAgent.notificationChannelId
    );
  }

  if (targetAgent.enableSendEmail === true) {
    const db = await database();
    const emailConnectionPk = `email-connections/${workspaceId}`;
    const emailConnection = await db["email-connection"].get(
      emailConnectionPk,
      "connection"
    );
    if (emailConnection) {
      tools.send_email = createSendEmailTool(workspaceId);
    }
  }

  if (
    targetAgent.enabledMcpServerIds &&
    Array.isArray(targetAgent.enabledMcpServerIds) &&
    targetAgent.enabledMcpServerIds.length > 0
  ) {
    const mcpTools = await createMcpServerTools(
      workspaceId,
      targetAgent.enabledMcpServerIds
    );
    Object.assign(tools, mcpTools);
  }

  if (
    targetAgent.clientTools &&
    Array.isArray(targetAgent.clientTools) &&
    targetAgent.clientTools.length > 0
  ) {
    const { createClientTools } = await import("./agentSetup");
    const clientTools = createClientTools(
      targetAgent.clientTools as Parameters<typeof createClientTools>[0]
    );
    Object.assign(tools, clientTools);
  }

  if (
    targetAgent.delegatableAgentIds &&
    Array.isArray(targetAgent.delegatableAgentIds) &&
    targetAgent.delegatableAgentIds.length > 0
  ) {
    tools.list_agents = createListAgentsTool(
      workspaceId,
      targetAgent.delegatableAgentIds
    );
    tools.call_agent = createCallAgentTool(
      workspaceId,
      targetAgent.delegatableAgentIds,
      targetAgentId,
      callDepth + 1,
      maxDepth,
      context,
      conversationId,
      conversationOwnerAgentId
    );
    tools.call_agent_async = createCallAgentAsyncTool(
      workspaceId,
      targetAgent.delegatableAgentIds,
      targetAgentId,
      callDepth + 1,
      maxDepth,
      context,
      conversationId
    );
    tools.check_delegation_status = createCheckDelegationStatusTool(workspaceId);
  }

  return tools;
};

const fetchExistingConversationMessages = async (params: {
  workspaceId: string;
  targetAgentId: string;
  conversationId?: string;
}): Promise<UIMessage[] | undefined> => {
  const { workspaceId, targetAgentId, conversationId } = params;
  if (!conversationId) return undefined;

  const db = await database();
  try {
    const conversationPk = `conversations/${workspaceId}/${targetAgentId}/${conversationId}`;
    const existingConversation = await db["agent-conversations"].get(
      conversationPk
    );
    if (existingConversation && existingConversation.messages) {
      return existingConversation.messages as UIMessage[];
    }
  } catch (error) {
    console.log(
      "[callAgentInternal] Could not fetch existing conversation messages:",
      error instanceof Error ? error.message : String(error)
    );
    Sentry.captureException(ensureError(error), {
      tags: {
        context: "agent-delegation",
        operation: "fetch-conversation",
      },
      extra: {
        workspaceId,
        targetAgentId,
        conversationId,
      },
      level: "warning",
    });
  }

  return undefined;
};

const buildAbortSignal = (params: {
  abortSignal?: AbortSignal;
  timeoutMs: number;
}): { signal?: AbortSignal; timeoutHandle?: NodeJS.Timeout } => {
  const { abortSignal, timeoutMs } = params;
  if (abortSignal) {
    return { signal: abortSignal };
  }
  if (timeoutMs <= 0) {
    return {};
  }
  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    timeoutController.abort();
  }, timeoutMs);
  return { signal: timeoutController.signal, timeoutHandle };
};

type GenerateTextResult = Awaited<ReturnType<typeof generateText>>;
type TokenUsage = ReturnType<typeof extractTokenUsage>;

const buildToolDefinitionsForReservation = (
  wrappedTools: DelegationTools
):
  | Array<{ name: string; description: string; parameters: unknown }>
  | undefined => {
  if (!wrappedTools || Object.keys(wrappedTools).length === 0) {
    return undefined;
  }
  return Object.entries(wrappedTools).map(([name, tool]) => ({
    name,
    description: (tool as { description?: string }).description || "",
    parameters: (tool as { inputSchema?: unknown }).inputSchema || {},
  }));
};

const executeGenerateTextWithTimeout = async (params: {
  model: Parameters<typeof generateText>[0]["model"];
  system: string;
  messages: ModelMessage[];
  tools: DelegationTools;
  generateOptions: ReturnType<typeof buildGenerateTextOptions>;
  abortSignal?: AbortSignal;
  timeoutMs: number;
}): Promise<GenerateTextResult> => {
  const { signal: effectiveSignal, timeoutHandle } = buildAbortSignal({
    abortSignal: params.abortSignal,
    timeoutMs: params.timeoutMs,
  });

  try {
    return await generateText({
      model: params.model,
      system: params.system,
      messages: params.messages,
      tools: params.tools,
      ...params.generateOptions,
      ...(effectiveSignal && { abortSignal: effectiveSignal }),
    });
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const adjustReservationAfterSuccess = async (params: {
  db: Awaited<ReturnType<typeof database>>;
  reservationId?: string;
  tokenUsage?: TokenUsage;
  workspaceId: string;
  targetAgentId: string;
  agentProvider: Provider;
  modelName: string;
  context?: CreditContext;
  openrouterGenerationId?: string;
  openrouterGenerationIds?: string[];
}): Promise<void> => {
  const {
    db,
    reservationId,
    tokenUsage,
    workspaceId,
    targetAgentId,
    agentProvider,
    modelName,
    context,
    openrouterGenerationId,
    openrouterGenerationIds,
  } = params;

  if (
    isCreditDeductionEnabled() &&
    reservationId &&
    reservationId !== "byok" &&
    tokenUsage &&
    (tokenUsage.promptTokens > 0 || tokenUsage.completionTokens > 0)
  ) {
    try {
      if (context) {
        await adjustCreditReservation(
          db,
          reservationId,
          workspaceId,
          agentProvider,
          modelName,
          tokenUsage,
          context,
          3,
          false,
          openrouterGenerationId,
          openrouterGenerationIds,
          targetAgentId
        );
      } else {
        console.warn(
          "[callAgentInternal] Context not available, skipping credit adjustment"
        );
      }
      console.log(
        "[Agent Delegation] Credit reservation adjusted successfully"
      );
    } catch (error) {
      console.error(
        "[callAgentInternal] Error adjusting credit reservation:",
        {
          error: error instanceof Error ? error.message : String(error),
          workspaceId,
          targetAgentId,
          reservationId,
          tokenUsage,
        }
      );
      Sentry.captureException(ensureError(error), {
        tags: {
          context: "credit-management",
          operation: "adjust-reservation",
        },
        extra: {
          workspaceId,
          targetAgentId,
          reservationId,
        },
        level: "warning",
      });
    }
  } else if (
    reservationId &&
    reservationId !== "byok" &&
    (!tokenUsage ||
      (tokenUsage.promptTokens === 0 && tokenUsage.completionTokens === 0))
  ) {
    console.warn(
      "[callAgentInternal] No token usage available after successful call, keeping estimated cost:",
      {
        workspaceId,
        targetAgentId,
        reservationId,
      }
    );
    try {
      const reservationPk = `credit-reservations/${reservationId}`;
      await db["credit-reservations"].delete(reservationPk);
    } catch (deleteError) {
      console.warn(
        "[callAgentInternal] Error deleting reservation:",
        deleteError
      );
      Sentry.captureException(ensureError(deleteError), {
        tags: {
          context: "credit-management",
          operation: "delete-reservation",
        },
      });
    }
  }
};

const logTargetAgentConversation = async (params: {
  db: Awaited<ReturnType<typeof database>>;
  workspaceId: string;
  targetAgentId: string;
  targetAgentConversationId: string;
  llmObserver: ReturnType<typeof createLlmObserver>;
  inputUserMessage: UIMessage;
  tokenUsage?: TokenUsage;
  usesByok: boolean;
  modelName: string;
  openrouterGenerationId?: string;
  provisionalCostUsd?: number;
  message: string;
  responseText: string;
}): Promise<void> => {
  const {
    db,
    workspaceId,
    targetAgentId,
    targetAgentConversationId,
    llmObserver,
    inputUserMessage,
    tokenUsage,
    usesByok,
    modelName,
    openrouterGenerationId,
    provisionalCostUsd,
    message,
    responseText,
  } = params;

  try {
    const observerTiming = getGenerationTimingFromObserver(
      llmObserver.getEvents()
    );
    const generationTimeMs =
      observerTiming.generationStartedAt && observerTiming.generationEndedAt
        ? new Date(observerTiming.generationEndedAt).getTime() -
          new Date(observerTiming.generationStartedAt).getTime()
        : undefined;

    const targetAgentMessages = buildConversationMessagesFromObserver({
      observerEvents: llmObserver.getEvents(),
      fallbackInputMessages: [inputUserMessage],
      assistantMeta: {
        tokenUsage,
        modelName,
        provider: "openrouter",
        openrouterGenerationId,
        provisionalCostUsd,
        generationTimeMs,
      },
    });

    await updateConversation(
      db,
      workspaceId,
      targetAgentId,
      targetAgentConversationId,
      targetAgentMessages,
      tokenUsage,
      usesByok,
      undefined,
      undefined,
      "test"
    );

    console.log("[Agent Delegation] Created conversation for target agent:", {
      workspaceId,
      targetAgentId,
      targetAgentConversationId,
      messageLength: message.length,
      responseLength: responseText.length,
      tokenUsage: tokenUsage
        ? {
            promptTokens: tokenUsage.promptTokens,
            completionTokens: tokenUsage.completionTokens,
            totalTokens: tokenUsage.totalTokens,
          }
        : undefined,
    });
  } catch (conversationError) {
    const errorMessage =
      conversationError instanceof Error
        ? conversationError.message
        : String(conversationError);
    const errorName =
      conversationError instanceof Error ? conversationError.name : "Error";

    console.error(
      "[callAgentInternal] Error creating conversation for target agent:",
      {
        error: errorMessage,
        errorName,
        workspaceId,
        targetAgentId,
      }
    );

    if (conversationError instanceof Error) {
      const wrappedError = new Error(
        `Failed to create conversation for target agent: ${errorMessage}`
      );
      wrappedError.name = errorName;
      wrappedError.cause = conversationError;
      throw wrappedError;
    }

    throw new Error(
      `Failed to create conversation for target agent: ${errorMessage}`
    );
  }
};

const handleReservationAfterError = async (params: {
  db: Awaited<ReturnType<typeof database>>;
  reservationId?: string;
  llmCallAttempted: boolean;
  error: unknown;
  workspaceId: string;
  targetAgentId: string;
  agentProvider: Provider;
  modelName: string;
  context?: CreditContext;
}): Promise<void> => {
  const {
    db,
    reservationId,
    llmCallAttempted,
    error,
    workspaceId,
    targetAgentId,
    agentProvider,
    modelName,
    context,
  } = params;

  if (!reservationId || reservationId === "byok") {
    return;
  }

  if (!llmCallAttempted) {
    try {
      console.log(
        "[callAgentInternal] Error before LLM call, refunding reservation:",
        {
          workspaceId,
          targetAgentId,
          reservationId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      if (context) {
        await refundReservation(db, reservationId, context);
      } else {
        console.warn(
          "[callAgentInternal] Context not available, skipping refund transaction"
        );
      }
    } catch (refundError) {
      console.error("[callAgentInternal] Error refunding reservation:", {
        reservationId,
        error:
          refundError instanceof Error
            ? refundError.message
            : String(refundError),
      });
      Sentry.captureException(ensureError(refundError), {
        tags: {
          context: "credit-management",
          operation: "refund-credits",
        },
      });
    }
    return;
  }

  let errorTokenUsage: TokenUsage | undefined;
  try {
    if (error && typeof error === "object" && "result" in error && error.result) {
      errorTokenUsage = extractTokenUsage(error.result);
    }
  } catch {
    // Ignore extraction errors
  }

  if (
    isCreditDeductionEnabled() &&
    errorTokenUsage &&
    (errorTokenUsage.promptTokens > 0 || errorTokenUsage.completionTokens > 0)
  ) {
    try {
      if (context) {
        await adjustCreditReservation(
          db,
          reservationId,
          workspaceId,
          agentProvider,
          modelName,
          errorTokenUsage,
          context,
          3,
          false,
          undefined,
          undefined,
          targetAgentId
        );
      } else {
        console.warn(
          "[callAgentInternal] Context not available, skipping credit adjustment"
        );
      }
    } catch (adjustError) {
      console.error(
        "[callAgentInternal] Error adjusting reservation after error:",
        adjustError
      );
      Sentry.captureException(ensureError(adjustError), {
        tags: {
          context: "credit-management",
          operation: "adjust-reservation-after-error",
        },
        extra: {
          workspaceId,
          targetAgentId,
          reservationId,
        },
      });
    }
  } else {
    console.warn(
      "[callAgentInternal] Model error without token usage, assuming reserved credits consumed:",
      {
        workspaceId,
        targetAgentId,
        reservationId,
      }
    );
    try {
      const reservationPk = `credit-reservations/${reservationId}`;
      await db["credit-reservations"].delete(reservationPk);
    } catch (deleteError) {
      console.warn(
        "[callAgentInternal] Error deleting reservation:",
        deleteError
      );
      Sentry.captureException(ensureError(deleteError), {
        tags: {
          context: "credit-management",
          operation: "delete-reservation-after-error",
        },
      });
    }
  }
};

const logDelegationErrorConversation = async (params: {
  db: Awaited<ReturnType<typeof database>>;
  workspaceId: string;
  targetAgentId: string;
  targetAgentConversationId: string;
  message: string;
  usesByok: boolean;
  modelName: string;
  error: unknown;
}): Promise<void> => {
  const {
    db,
    workspaceId,
    targetAgentId,
    targetAgentConversationId,
    message,
    usesByok,
    modelName,
    error,
  } = params;
  try {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorInfo = {
      message: errorMessage,
      name: error instanceof Error ? error.name : "Error",
      stack: error instanceof Error ? error.stack : undefined,
      occurredAt: new Date().toISOString(),
      provider: "openrouter",
      modelName,
      endpoint: "test",
    };

    await updateConversation(
      db,
      workspaceId,
      targetAgentId,
      targetAgentConversationId,
      [
        {
          role: "user",
          content: message,
        },
      ],
      undefined,
      usesByok,
      errorInfo,
      undefined,
      "test"
    );
  } catch (logError) {
    console.error("[callAgentInternal] Failed to log error conversation:", {
      error: logError instanceof Error ? logError.message : String(logError),
      workspaceId,
      targetAgentId,
      targetAgentConversationId,
    });
    Sentry.captureException(ensureError(logError), {
      tags: {
        context: "agent-delegation",
        operation: "log-error-conversation",
      },
    });
  }
};

export async function callAgentInternal(
  workspaceId: string,
  targetAgentId: string,
  message: string,
  callDepth: number,
  maxDepth: number,
  context?: CreditContext,
  timeoutMs: number = 60000,
  conversationId?: string,
  conversationOwnerAgentId?: string,
  abortSignal?: AbortSignal
): Promise<{
  response: string;
  targetAgentConversationId: string;
  shouldTrackRequest: boolean;
}> {
  if (callDepth >= maxDepth) {
    return {
      response: `Error: Maximum delegation depth (${maxDepth}) reached. Cannot delegate further.`,
      targetAgentConversationId: randomUUID(),
      shouldTrackRequest: false,
    };
  }

  const db = await database();
  const llmObserver = createLlmObserver();

  const targetAgentConversationId = randomUUID();
  const targetAgentPk = `agents/${workspaceId}/${targetAgentId}`;
  const targetAgent = await db.agent.get(targetAgentPk, "agent");
  if (!targetAgent) {
    return {
      response: `Error: Target agent ${targetAgentId} not found.`,
      targetAgentConversationId,
      shouldTrackRequest: false,
    };
  }
  if (targetAgent.workspaceId !== workspaceId) {
    return {
      response: `Error: Target agent ${targetAgentId} does not belong to this workspace.`,
      targetAgentConversationId,
      shouldTrackRequest: false,
    };
  }

  const extractedTargetAgentId = targetAgent.pk.replace(
    `agents/${workspaceId}/`,
    ""
  );

  const agentProvider: Provider = "openrouter";
  const workspaceApiKey = await getWorkspaceApiKey(workspaceId, agentProvider);
  const usesByok = workspaceApiKey !== null;
  const modelName =
    typeof targetAgent.modelName === "string" ? targetAgent.modelName : undefined;

  const agentConfig = {
    temperature: targetAgent.temperature,
    topP: targetAgent.topP,
    topK: targetAgent.topK,
    maxOutputTokens: targetAgent.maxOutputTokens,
    stopSequences: targetAgent.stopSequences,
  };

  const model = await createAgentModel(
    "http://localhost:3000/api/agent-delegation",
    workspaceApiKey || undefined,
    modelName,
    workspaceId,
    targetAgentId,
    usesByok,
    undefined,
    agentProvider,
    agentConfig,
    llmObserver
  );

  const tools = await buildDelegationTools({
    workspaceId,
    targetAgentId,
    extractedTargetAgentId,
    targetAgentConversationId,
    targetAgent,
    message,
    context,
    conversationId,
    conversationOwnerAgentId,
    callDepth,
    maxDepth,
  });

  const wrappedTools = wrapToolsWithObserver(tools, llmObserver);

  const modelMessages: ModelMessage[] = [
    {
      role: "user",
      content: message,
    },
  ];

  const existingConversationMessages = await fetchExistingConversationMessages({
    workspaceId,
    targetAgentId,
    conversationId,
  });

  const { injectKnowledgeIntoMessages } = await import(
    "../../utils/knowledgeInjection"
  );
  const knowledgeInjectionResult = await injectKnowledgeIntoMessages(
    workspaceId,
    targetAgent,
    modelMessages,
    db,
    context,
    targetAgentId,
    conversationId,
    usesByok,
    existingConversationMessages
  );

  const modelMessagesWithKnowledge = knowledgeInjectionResult.modelMessages;
  const knowledgeInjectionMessage =
    knowledgeInjectionResult.knowledgeInjectionMessage;
  const rerankingRequestMessage =
    knowledgeInjectionResult.rerankingRequestMessage;
  const rerankingResultMessage = knowledgeInjectionResult.rerankingResultMessage;

  const inputUserMessage: UIMessage = {
    role: "user",
    content: message,
  };
  llmObserver.recordInputMessages(
    buildObserverInputMessages({
      baseMessages: [inputUserMessage],
      rerankingRequestMessage: rerankingRequestMessage ?? undefined,
      rerankingResultMessage: rerankingResultMessage ?? undefined,
      knowledgeInjectionMessage: knowledgeInjectionMessage ?? undefined,
    })
  );

  let reservationId: string | undefined;
  let llmCallAttempted = false;
  let shouldTrackRequest = false;
  let result: GenerateTextResult | undefined;
  let tokenUsage: TokenUsage | undefined;

  try {
    const toolDefinitions = buildToolDefinitionsForReservation(wrappedTools);

    const reservation = await validateCreditsAndLimitsAndReserve(
      db,
      workspaceId,
      targetAgentId,
      agentProvider,
      modelName || MODEL_NAME,
      modelMessagesWithKnowledge,
      targetAgent.systemPrompt,
      toolDefinitions,
      false
    );

    if (reservation) {
      reservationId = reservation.reservationId;
      console.log("[Agent Delegation] Credits reserved:", {
        workspaceId,
        targetAgentId,
        reservationId,
        reservedAmount: reservation.reservedAmount,
      });
    }

    const generateOptions = buildGenerateTextOptions(targetAgent);
    console.log("[Agent Delegation] Executing generateText with parameters:", {
      workspaceId,
      targetAgentId,
      model: MODEL_NAME,
      systemPromptLength: targetAgent.systemPrompt.length,
      messagesCount: modelMessagesWithKnowledge.length,
      toolsCount: wrappedTools ? Object.keys(wrappedTools).length : 0,
      hasAbortSignal: Boolean(abortSignal || timeoutMs > 0),
      ...generateOptions,
    });
    if (wrappedTools) {
      const { logToolDefinitions } = await import("./agentSetup");
      logToolDefinitions(wrappedTools, "Agent Delegation", targetAgent);
    }

    result = await executeGenerateTextWithTimeout({
      model: model as unknown as Parameters<typeof generateText>[0]["model"],
      system: targetAgent.systemPrompt,
      messages: modelMessagesWithKnowledge,
      tools: wrappedTools,
      generateOptions,
      abortSignal,
      timeoutMs,
    });

    llmCallAttempted = true;
    shouldTrackRequest = true;
    if (result) {
      llmObserver.recordFromResult(result);
    }

    const extractionResult = extractTokenUsageAndCosts(
      result,
      undefined,
      modelName || MODEL_NAME,
      "test"
    );
    tokenUsage = extractionResult.tokenUsage;
    const openrouterGenerationId = extractionResult.openrouterGenerationId;
    const openrouterGenerationIds = extractionResult.openrouterGenerationIds;
    const provisionalCostUsd = extractionResult.provisionalCostUsd;

    await adjustReservationAfterSuccess({
      db,
      reservationId,
      tokenUsage,
      workspaceId,
      targetAgentId,
      agentProvider,
      modelName: modelName || MODEL_NAME,
      context,
      openrouterGenerationId,
      openrouterGenerationIds,
    });

    if (!result) {
      throw new Error("LLM call succeeded but result is undefined");
    }

    await logTargetAgentConversation({
      db,
      workspaceId,
      targetAgentId,
      targetAgentConversationId,
      llmObserver,
      inputUserMessage,
      tokenUsage,
      usesByok,
      modelName: modelName || MODEL_NAME,
      openrouterGenerationId,
      provisionalCostUsd,
      message,
      responseText: result.text,
    });

    return {
      response: result.text,
      targetAgentConversationId,
      shouldTrackRequest,
    };
  } catch (error) {
    await handleReservationAfterError({
      db,
      reservationId,
      llmCallAttempted,
      error,
      workspaceId,
      targetAgentId,
      agentProvider,
      modelName: modelName || MODEL_NAME,
      context,
    });

    console.error(
      `[callAgentInternal] Error calling agent ${targetAgentId}:`,
      error
    );
    Sentry.captureException(ensureError(error), {
      tags: {
        context: "agent-delegation",
        operation: "call-agent-internal",
      },
      extra: {
        workspaceId,
        targetAgentId,
      },
    });

    await logDelegationErrorConversation({
      db,
      workspaceId,
      targetAgentId,
      targetAgentConversationId,
      message,
      usesByok,
      modelName: modelName || MODEL_NAME,
      error,
    });

    return {
      response: `Error calling agent: ${
        error instanceof Error ? error.message : String(error)
      }`,
      targetAgentConversationId,
      shouldTrackRequest: llmCallAttempted,
    };
  }
}
