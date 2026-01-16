import type { ModelMessage } from "ai";
import { generateText } from "ai";

import type {
  GenerateTextResultWithTotalUsage,
  TokenUsage,
} from "../../utils/conversationLogger";
import type { UIMessage } from "../../utils/messageTypes";
import type { AugmentedContext } from "../../utils/workspaceCreditContext";

import { setupAgentAndTools, type AgentSetupOptions } from "./agentSetup";
import { MODEL_NAME } from "./agentUtils";
import {
  adjustCreditsAfterLLMCall,
  cleanupReservationOnError,
  validateAndReserveCredits,
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
import { processNonStreamingResponse } from "./streaming";

export interface AgentCallNonStreamingOptions {
  modelReferer?: string;
  context?: AugmentedContext;
  conversationId?: string;
  conversationOwnerAgentId?: string;
  userId?: string;
  endpointType?: "bridge" | "webhook" | "test" | "stream";
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
}

/**
 * Calls an agent with a message and returns the complete text response (non-streaming).
 * This is used by bridge services (Slack, Discord) that need complete responses.
 */
export async function callAgentNonStreaming(
  workspaceId: string,
  agentId: string,
  message: string,
  options?: AgentCallNonStreamingOptions
): Promise<AgentCallNonStreamingResult> {
  const { database } = await import("../../tables");
  const db = await database();
  const llmObserver = options?.llmObserver || createLlmObserver();

  // Setup agent, model, and tools
  const setupOptions: AgentSetupOptions = {
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
                1
              )}%\nContent:\n${result.snippet}\n`
          )
          .join("\n---\n\n");
      },
    },
  };

  // Build conversation history: previous messages + current message
  const conversationHistory = options?.conversationHistory || [];
  const uiMessage = convertTextToUIMessage(message);
  const allMessages = [...conversationHistory, uiMessage];

  // Fetch existing conversation messages to check for existing knowledge injection
  let existingConversationMessages: UIMessage[] | undefined;
  if (options?.conversationId) {
    try {
      const conversationPk = `conversations/${workspaceId}/${agentId}/${options.conversationId}`;
      const existingConversation = await db["agent-conversations"].get(
        conversationPk
      );
      if (existingConversation && existingConversation.messages) {
        existingConversationMessages = existingConversation.messages as UIMessage[];
      }
    } catch (error) {
      // If conversation doesn't exist yet or fetch fails, that's okay - we'll create new knowledge injection
      console.log(
        "[callAgentNonStreaming] Could not fetch existing conversation messages:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  const { agent, model, tools, usesByok } = await setupAgentAndTools(
    workspaceId,
    agentId,
    allMessages, // Pass conversation history including current message
    setupOptions
  );

  // Convert messages to ModelMessage format
  const modelMessages: ModelMessage[] = convertUIMessagesToModelMessages(
    allMessages
  );

  // Inject knowledge from workspace documents if enabled
  const { injectKnowledgeIntoMessages } = await import(
    "../../utils/knowledgeInjection"
  );
  const knowledgeInjectionResult = await injectKnowledgeIntoMessages(
    workspaceId,
    agent,
    modelMessages,
    db,
    options?.context,
    agentId,
    options?.conversationId,
    usesByok,
    existingConversationMessages
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
    })
  );

  // Derive the model name from the agent's modelName if set, otherwise use default
  const finalModelName =
    typeof agent.modelName === "string" ? agent.modelName : MODEL_NAME;

  let reservationId: string | undefined;
  let llmCallAttempted = false;
  let result: Awaited<ReturnType<typeof generateText>> | undefined;
  let tokenUsage: TokenUsage | undefined;
  let extractionResult:
    | ReturnType<typeof extractTokenUsageAndCosts>
    | undefined;

  try {
    // Validate credits, spending limits, and reserve credits before LLM call
    reservationId = await validateAndReserveCredits(
      db,
      workspaceId,
      agentId,
      "openrouter", // provider
      finalModelName,
      modelMessagesWithKnowledge,
      agent.systemPrompt,
      tools,
      usesByok,
      options?.endpointType || "bridge", // endpoint type
      options?.context
    );

    // Prepare LLM call
    const generateOptions = prepareLLMCall(
      agent,
      tools,
      modelMessagesWithKnowledge,
      options?.endpointType || "bridge",
      workspaceId,
      agentId
    );

    // Generate response
    llmCallAttempted = true;
    result = await generateText({
      model: model as unknown as Parameters<typeof generateText>[0]["model"],
      system: agent.systemPrompt,
      messages: modelMessagesWithKnowledge,
      tools,
      ...generateOptions,
      ...(options?.abortSignal && { abortSignal: options.abortSignal }),
    });

    // Extract token usage and costs
    extractionResult = extractTokenUsageAndCosts(
      result as unknown as GenerateTextResultWithTotalUsage,
      undefined,
      finalModelName,
      options?.endpointType || "bridge"
    );
    tokenUsage = extractionResult.tokenUsage;

    // Adjust credit reservation based on actual cost
    if (options?.context) {
      await adjustCreditsAfterLLMCall(
        db,
        workspaceId,
        agentId,
        reservationId,
        "openrouter",
        finalModelName,
        tokenUsage,
        usesByok,
        extractionResult.openrouterGenerationId,
        extractionResult.openrouterGenerationIds,
        options?.endpointType || "bridge",
        options.context
      );
    } else {
      // Without context, we can't adjust credits - this should not happen in production
      // but we log a warning instead of throwing
      console.warn("[Bridge] No context available for credit adjustment", {
        workspaceId,
        agentId,
        reservationId,
      });
    }

    // Handle case where no token usage is available
    if (
      reservationId &&
      reservationId !== "byok" &&
      (!tokenUsage ||
        (tokenUsage.promptTokens === 0 && tokenUsage.completionTokens === 0))
    ) {
      const { cleanupReservationWithoutTokenUsage } = await import(
        "./generationCreditManagement"
      );
      await cleanupReservationWithoutTokenUsage(
        db,
        reservationId,
        workspaceId,
        agentId,
        options?.endpointType || "bridge"
      );
    }
  } catch (error) {
    // Error after reservation but before or during LLM call
    if (reservationId && reservationId !== "byok" && options?.context) {
      await cleanupReservationOnError(
        db,
        reservationId,
        workspaceId,
        agentId,
        "openrouter",
        finalModelName,
        error,
        llmCallAttempted,
        usesByok,
        options?.endpointType || "bridge",
        options.context
      );
    }

    // Re-throw error to be handled by caller
    throw error;
  }

  if (!result) {
    throw new Error("LLM call succeeded but result is undefined");
  }

  // Process response and handle tool continuation if needed
  const processedResult = await processNonStreamingResponse(
    result as unknown as GenerateTextResultWithTotalUsage,
    agent,
    model,
    modelMessages,
    tools
  );

  // Use token usage from processedResult if available (includes continuation tokens),
  // otherwise fall back to initial extraction
  const finalTokenUsage = processedResult.tokenUsage || tokenUsage;

  return {
    text: processedResult.text,
    tokenUsage: finalTokenUsage,
    rawResult: result,
    openrouterGenerationId: extractionResult?.openrouterGenerationId,
    openrouterGenerationIds: extractionResult?.openrouterGenerationIds,
    provisionalCostUsd: extractionResult?.provisionalCostUsd,
    observerEvents: llmObserver.getEvents(),
  };
}
