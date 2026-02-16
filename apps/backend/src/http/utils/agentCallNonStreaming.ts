import type { ModelMessage } from "ai";
import { generateText } from "ai";

import { buildSystemPromptWithSkills } from "../../utils/agentSkills";
import type {
  GenerateTextResultWithTotalUsage,
  TokenUsage,
} from "../../utils/conversationLogger";
import type { UIMessage } from "../../utils/messageTypes";
import { getMaxSafeInputTokens } from "../../utils/pricing";
import { estimateInputTokens } from "../../utils/tokenEstimation";
import type { AugmentedContext } from "../../utils/workspaceCreditContext";

import { setupAgentAndTools, type AgentSetupOptions } from "./agentSetup";
import { MODEL_NAME } from "./agentUtils";
import {
  adjustCreditsAfterLLMCall,
  cleanupReservationOnError,
  convertToolsToDefinitions,
  validateAndReserveCredits,
  enqueueCostVerificationIfNeeded,
} from "./generationCreditManagement";
import { prepareLLMCall } from "./generationLLMSetup";
import { extractTokenUsageAndCosts } from "./generationTokenExtraction";
import {
  buildObserverInputMessages,
  createLlmObserver,
  type LlmObserverEvent,
} from "./llmObserver";
import {
  convertTextToUIMessage,
  convertUIMessagesToModelMessages,
} from "./messageConversion";
import {
  resolveModelCapabilities,
  resolveToolsForCapabilities,
} from "./modelCapabilities";
import { processNonStreamingResponse } from "./streaming";

export interface AgentCallNonStreamingOptions {
  modelReferer?: string;
  context?: AugmentedContext;
  conversationId?: string;
  conversationOwnerAgentId?: string;
  userId?: string;
  endpointType?: "bridge" | "webhook" | "test" | "stream" | "scheduled";
  conversationHistory?: UIMessage[];
  abortSignal?: AbortSignal;
  llmObserver?: ReturnType<typeof createLlmObserver>;
}

export interface AgentCallNonStreamingResult {
  text: string;
  tokenUsage: TokenUsage | undefined;
  // Raw result from generateText for extracting tool calls/results
  rawResult?: Awaited<ReturnType<typeof generateText>>;
  // Extracted generation IDs and costs
  openrouterGenerationId?: string;
  openrouterGenerationIds?: string[];
  provisionalCostUsd?: number;
  observerEvents?: LlmObserverEvent[];
  usesByok?: boolean;
  modelName?: string;
}

type NonStreamingExecutionResult = {
  result: Awaited<ReturnType<typeof generateText>>;
  tokenUsage: TokenUsage | undefined;
  extractionResult: ReturnType<typeof extractTokenUsageAndCosts>;
  reservationId?: string;
};

export const buildNonStreamingSetupOptions = (
  agentId: string,
  options: AgentCallNonStreamingOptions | undefined,
  llmObserver: ReturnType<typeof createLlmObserver>,
): AgentSetupOptions => ({
  modelReferer: options?.modelReferer || "http://localhost:3000/api/bridge",
  callDepth: 0,
  maxDelegationDepth: 3,
  context: options?.context,
  conversationId: options?.conversationId,
  conversationOwnerAgentId: options?.conversationOwnerAgentId || agentId,
  userId: options?.userId,
  llmObserver,
  searchDocumentsOptions: {
    description:
      "Search workspace documents using semantic vector search. Returns the most relevant document snippets based on the query.",
    queryDescription:
      "The search query or prompt to find relevant document snippets",
    formatResults: (results) => {
      return results
        .map(
          (result, index) =>
            `[${index + 1}] Document: ${result.documentName}${
              result.folderPath ? ` (${result.folderPath})` : ""
            }\nSimilarity: ${(result.similarity * 100).toFixed(
              1,
            )}%\nContent:\n${result.snippet}\n`,
        )
        .join("\n---\n\n");
    },
  },
});

const buildNonStreamingMessages = (
  message: string,
  conversationHistory: UIMessage[] | undefined,
): { uiMessage: UIMessage; allMessages: UIMessage[] } => {
  const uiMessage = convertTextToUIMessage(message);
  const allMessages = [...(conversationHistory || []), uiMessage];
  return { uiMessage, allMessages };
};

const executeNonStreamingLLMCall = async (params: {
  db: Awaited<ReturnType<typeof import("../../tables").database>>;
  workspaceId: string;
  agentId: string;
  agent: Awaited<ReturnType<typeof setupAgentAndTools>>["agent"];
  model: Awaited<ReturnType<typeof setupAgentAndTools>>["model"];
  tools: Awaited<ReturnType<typeof setupAgentAndTools>>["tools"];
  usesByok: boolean;
  modelMessagesWithKnowledge: ModelMessage[];
  finalModelName: string;
  endpointType: NonNullable<AgentCallNonStreamingOptions["endpointType"]>;
  context?: AugmentedContext;
  conversationId?: string;
  abortSignal?: AbortSignal;
}): Promise<NonStreamingExecutionResult> => {
  let reservationId: string | undefined;
  let llmCallAttempted = false;
  let result: Awaited<ReturnType<typeof generateText>> | undefined;
  let tokenUsage: TokenUsage | undefined;
  let extractionResult:
    | ReturnType<typeof extractTokenUsageAndCosts>
    | undefined;

  const modelCapabilities = resolveModelCapabilities(
    "openrouter",
    params.finalModelName,
  );
  const effectiveTools = resolveToolsForCapabilities(
    params.tools,
    modelCapabilities,
  );

  try {
    const effectiveSystemPrompt = await buildSystemPromptWithSkills(
      params.agent.systemPrompt,
      params.agent.enabledSkillIds
    );

    const toolDefinitions = convertToolsToDefinitions(effectiveTools);
    const estimatedInputTokens = estimateInputTokens(
      params.modelMessagesWithKnowledge,
      effectiveSystemPrompt,
      toolDefinitions,
    );
    const maxSafeInputTokens = getMaxSafeInputTokens(
      "openrouter",
      params.finalModelName,
    );
    if (estimatedInputTokens > maxSafeInputTokens) {
      const error = new Error(
        `Request would exceed model context limit: estimated ${estimatedInputTokens} input tokens (max ${maxSafeInputTokens}). ` +
          "Reduce schedule prompt length, conversation history, or knowledge injection snippet count.",
      );
      (error as Error & { code?: string }).code = "CONTEXT_LENGTH_EXCEEDED";
      throw error;
    }

    reservationId = await validateAndReserveCredits(
      params.db,
      params.workspaceId,
      params.agentId,
      "openrouter",
      params.finalModelName,
      params.modelMessagesWithKnowledge,
      effectiveSystemPrompt,
      effectiveTools,
      params.usesByok,
      params.endpointType,
      params.context,
      params.conversationId,
    );

    const generateOptions = prepareLLMCall(
      params.agent,
      effectiveTools,
      params.modelMessagesWithKnowledge,
      params.endpointType,
      params.workspaceId,
      params.agentId,
    );

    console.log("[Non-Streaming Handler] generateText arguments:", {
      workspaceId: params.workspaceId,
      agentId: params.agentId,
      model: params.finalModelName,
      systemPromptLength: effectiveSystemPrompt.length,
      messagesCount: params.modelMessagesWithKnowledge.length,
      toolsCount: effectiveTools ? Object.keys(effectiveTools).length : 0,
      hasAbortSignal: Boolean(params.abortSignal),
      ...generateOptions,
    });

    llmCallAttempted = true;
    result = await generateText({
      model: params.model as unknown as Parameters<
        typeof generateText
      >[0]["model"],
      system: effectiveSystemPrompt,
      messages: params.modelMessagesWithKnowledge,
      ...(effectiveTools ? { tools: effectiveTools } : {}),
      ...generateOptions,
      ...(params.abortSignal && { abortSignal: params.abortSignal }),
    });

    extractionResult = extractTokenUsageAndCosts(
      result as unknown as GenerateTextResultWithTotalUsage,
      undefined,
      params.finalModelName,
      params.endpointType,
    );
    tokenUsage = extractionResult.tokenUsage;

    if (params.context) {
      await adjustCreditsAfterLLMCall(
        params.db,
        params.workspaceId,
        params.agentId,
        reservationId,
        "openrouter",
        params.finalModelName,
        tokenUsage,
        params.usesByok,
        extractionResult.openrouterGenerationId,
        extractionResult.openrouterGenerationIds,
        params.endpointType,
        params.context,
        params.conversationId,
      );
    } else {
      console.warn("[Bridge] No context available for credit adjustment", {
        workspaceId: params.workspaceId,
        agentId: params.agentId,
        reservationId,
      });
    }

    const hasGenerationIds =
      Boolean(extractionResult?.openrouterGenerationIds?.length) ||
      Boolean(extractionResult?.openrouterGenerationId);

    if (
      reservationId &&
      reservationId !== "byok" &&
      (!tokenUsage ||
        (tokenUsage.promptTokens === 0 && tokenUsage.completionTokens === 0)) &&
      !hasGenerationIds
    ) {
      const { cleanupReservationWithoutTokenUsage } =
        await import("./generationCreditManagement");
      await cleanupReservationWithoutTokenUsage(
        params.db,
        reservationId,
        params.workspaceId,
        params.agentId,
        params.endpointType,
      );
    } else if (
      reservationId &&
      reservationId !== "byok" &&
      (!tokenUsage ||
        (tokenUsage.promptTokens === 0 && tokenUsage.completionTokens === 0)) &&
      hasGenerationIds
    ) {
      console.warn(
        "[Non-Streaming Handler] No token usage available, keeping reservation for verification",
        {
          workspaceId: params.workspaceId,
          agentId: params.agentId,
          reservationId,
        },
      );
    }

    if (!result || !extractionResult) {
      throw new Error("LLM call succeeded but result is undefined");
    }

    await enqueueCostVerificationIfNeeded(
      extractionResult.openrouterGenerationId,
      extractionResult.openrouterGenerationIds,
      params.workspaceId,
      reservationId,
      params.conversationId,
      params.agentId,
      params.endpointType,
    );

    return {
      result,
      tokenUsage,
      extractionResult,
      reservationId,
    };
  } catch (error) {
    if (reservationId && reservationId !== "byok" && params.context) {
      await cleanupReservationOnError(
        params.db,
        reservationId,
        params.workspaceId,
        params.agentId,
        "openrouter",
        params.finalModelName,
        error,
        llmCallAttempted,
        params.usesByok,
        params.endpointType,
        params.context,
      );
    }
    throw error;
  }
};

/**
 * Calls an agent with a message and returns the complete text response (non-streaming).
 * This is used by bridge services (Slack, Discord) that need complete responses.
 */
export async function callAgentNonStreaming(
  workspaceId: string,
  agentId: string,
  message: string,
  options?: AgentCallNonStreamingOptions,
): Promise<AgentCallNonStreamingResult> {
  const { database } = await import("../../tables");
  const db = await database();
  const llmObserver = options?.llmObserver || createLlmObserver();
  const endpointType = options?.endpointType || "bridge";

  // Setup agent, model, and tools
  const setupOptions = buildNonStreamingSetupOptions(
    agentId,
    options,
    llmObserver,
  );

  // Build conversation history: previous messages + current message
  const { allMessages } = buildNonStreamingMessages(
    message,
    options?.conversationHistory,
  );

  const { agent, model, tools, usesByok } = await setupAgentAndTools(
    workspaceId,
    agentId,
    allMessages, // Pass conversation history including current message
    setupOptions,
  );

  // Convert messages to ModelMessage format
  const modelMessages: ModelMessage[] =
    convertUIMessagesToModelMessages(allMessages);

  // Inject knowledge from workspace documents if enabled
  const { injectKnowledgeIntoMessages } =
    await import("../../utils/knowledgeInjection");
  const knowledgeInjectionResult = await injectKnowledgeIntoMessages(
    workspaceId,
    agent,
    modelMessages,
    db,
    options?.context,
    agentId,
    options?.conversationId,
    usesByok,
  );

  const modelMessagesWithKnowledge = knowledgeInjectionResult.modelMessages;
  const knowledgeInjectionMessage =
    knowledgeInjectionResult.knowledgeInjectionMessage;
  const rerankingRequestMessage =
    knowledgeInjectionResult.rerankingRequestMessage;
  const rerankingResultMessage =
    knowledgeInjectionResult.rerankingResultMessage;

  llmObserver.recordInputMessages(
    buildObserverInputMessages({
      baseMessages: allMessages,
      rerankingRequestMessage: rerankingRequestMessage ?? undefined,
      rerankingResultMessage: rerankingResultMessage ?? undefined,
      knowledgeInjectionMessage: knowledgeInjectionMessage ?? undefined,
    }),
  );

  // Derive the model name from the agent's modelName if set, otherwise use default
  const finalModelName =
    typeof agent.modelName === "string" && agent.modelName.length > 0
      ? agent.modelName
      : MODEL_NAME;

  try {
    const execution = await executeNonStreamingLLMCall({
      db,
      workspaceId,
      agentId,
      agent,
      model,
      tools,
      usesByok,
      modelMessagesWithKnowledge,
      finalModelName,
      endpointType,
      context: options?.context,
      conversationId: options?.conversationId,
      abortSignal: options?.abortSignal,
    });

    // Process response and handle tool continuation if needed
    const processedResult = await processNonStreamingResponse(
      execution.result as unknown as GenerateTextResultWithTotalUsage,
      agent,
      model,
      modelMessages,
      tools,
      options?.abortSignal,
    );
    console.log("[Non-Streaming Handler] LLM response received:", {
      workspaceId,
      agentId,
      conversationId: options?.conversationId,
      endpointType: options?.endpointType || "bridge",
      receivedAt: new Date().toISOString(),
      text: processedResult.text,
    });

    // Use token usage from processedResult if available (includes continuation tokens),
    // otherwise fall back to initial extraction
    const finalTokenUsage = processedResult.tokenUsage || execution.tokenUsage;

    return {
      text: processedResult.text,
      tokenUsage: finalTokenUsage,
      rawResult: execution.result,
      openrouterGenerationId: execution.extractionResult.openrouterGenerationId,
      openrouterGenerationIds:
        execution.extractionResult.openrouterGenerationIds,
      provisionalCostUsd: execution.extractionResult.provisionalCostUsd,
      observerEvents: llmObserver.getEvents(),
      usesByok,
      modelName: finalModelName,
    };
  } catch (error) {
    if (error && typeof error === "object") {
      const errorAny = error as Record<string, unknown>;
      if (!("usesByok" in errorAny)) {
        errorAny.usesByok = usesByok;
      }
      if (!("modelName" in errorAny)) {
        errorAny.modelName = finalModelName;
      }
    }
    throw error;
  }
}
