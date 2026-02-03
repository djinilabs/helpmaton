import { generateText } from "ai";
import type { ModelMessage } from "ai";

import {
  adjustCreditsAfterLLMCall,
  cleanupReservationOnError,
  cleanupReservationWithoutTokenUsage,
} from "../http/utils/generationCreditManagement";
import { extractTokenUsageAndCosts } from "../http/utils/generationTokenExtraction";
import { createModel } from "../http/utils/modelFactory";
import {
  createRequestTimeout,
  cleanupRequestTimeout,
} from "../http/utils/requestTimeout";

import { isCreditOrBudgetConversationError } from "./conversationErrorInfo";
import type { TokenUsage } from "./conversationLogger";
import { validateCreditsAndLimitsAndReserve } from "./creditValidation";
import type { UIMessage } from "./messageTypes";
import type { AugmentedContext } from "./workspaceCreditContext";

/**
 * Format conversation messages into the format expected by eval prompts
 * Exported for testing
 */
export function formatConversationForEval(
  messages: UIMessage[]
): {
  input_prompt: string;
  steps: Array<{
    step_id: string;
    type: "thought" | "tool_call" | "tool_result";
    content: unknown;
    timestamp?: string;
  }>;
  final_response: string;
} {
  const steps: Array<{
    step_id: string;
    type: "thought" | "tool_call" | "tool_result";
    content: unknown;
    timestamp?: string;
  }> = [];

  let inputPrompt = "";
  let finalResponse = "";

  // Extract input prompt from first user message
  const firstUserMessage = messages.find((m) => m.role === "user");
  if (firstUserMessage) {
    if (typeof firstUserMessage.content === "string") {
      inputPrompt = firstUserMessage.content;
    } else if (Array.isArray(firstUserMessage.content)) {
      const textParts = firstUserMessage.content
        .filter((c) => typeof c === "object" && c !== null && "type" in c && c.type === "text" && "text" in c)
        .map((c) => (typeof c === "object" && c !== null && "text" in c && typeof c.text === "string" ? c.text : ""))
        .join(" ");
      inputPrompt = textParts;
    }
  }

  // Extract final response from last assistant message with text
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
  if (lastAssistantMessage) {
    if (typeof lastAssistantMessage.content === "string") {
      finalResponse = lastAssistantMessage.content;
    } else if (Array.isArray(lastAssistantMessage.content)) {
      const textParts = lastAssistantMessage.content
        .filter((c) => typeof c === "object" && c !== null && "type" in c && c.type === "text" && "text" in c)
        .map((c) => (typeof c === "object" && c !== null && "text" in c && typeof c.text === "string" ? c.text : ""))
        .join(" ");
      finalResponse = textParts;
    }
  }

  // Process all messages to extract steps
  let stepCounter = 0;
  for (const message of messages) {
    if (message.role === "assistant") {
      if (Array.isArray(message.content)) {
        for (const item of message.content) {
          // Type guard: ensure item is a non-null object
          if (typeof item !== "object" || item === null) {
            continue;
          }
          
          // Type guard: ensure item has a type property
          if (!("type" in item)) {
            continue;
          }

          const itemWithType = item as { type: string; [key: string]: unknown };

          if (itemWithType.type === "reasoning") {
            const text = typeof itemWithType.text === "string" ? itemWithType.text : "";
            steps.push({
              step_id: `step_${stepCounter++}`,
              type: "thought",
              content: text,
              timestamp: message.generationStartedAt,
            });
          } else if (itemWithType.type === "tool-call") {
            const toolCallId = typeof itemWithType.toolCallId === "string" ? itemWithType.toolCallId : "";
            const toolName = typeof itemWithType.toolName === "string" ? itemWithType.toolName : "";
            const args = "args" in itemWithType ? itemWithType.args : ("input" in itemWithType ? itemWithType.input : {});
            steps.push({
              step_id: `step_${stepCounter++}`,
              type: "tool_call",
              content: {
                toolCallId,
                toolName,
                args,
              },
              timestamp: message.generationStartedAt,
            });
          } else if (itemWithType.type === "tool-result") {
            const toolCallId = typeof itemWithType.toolCallId === "string" ? itemWithType.toolCallId : "";
            const toolName = typeof itemWithType.toolName === "string" ? itemWithType.toolName : "";
            const result = "result" in itemWithType ? itemWithType.result : ("output" in itemWithType ? itemWithType.output : {});
            steps.push({
              step_id: `step_${stepCounter++}`,
              type: "tool_result",
              content: {
                toolCallId,
                toolName,
                result,
              },
              timestamp: message.generationEndedAt,
            });
          }
        }
      }
    }
  }

  return {
    input_prompt: inputPrompt,
    steps,
    final_response: finalResponse,
  };
}

/**
 * Parse JSON response from eval judge, handling markdown code blocks
 * Exported for testing
 */
export function parseEvalResponse(text: string): {
  summary: string;
  score_goal_completion: number;
  score_tool_efficiency: number;
  score_faithfulness: number;
  critical_failure_detected: boolean;
  reasoning_trace: string;
} {
  const extractFirstJsonObject = (value: string): string | null => {
    const startIndex = value.indexOf("{");
    if (startIndex === -1) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let isEscaped = false;

    for (let i = startIndex; i < value.length; i += 1) {
      const char = value[i];

      if (inString) {
        if (isEscaped) {
          isEscaped = false;
        } else if (char === "\\") {
          isEscaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }

      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return value.slice(startIndex, i + 1);
        }
      }
    }

    return null;
  };

  // Remove markdown code blocks if present
  let cleanedText = text.trim();
  if (cleanedText.startsWith("```json")) {
    cleanedText = cleanedText.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (cleanedText.startsWith("```")) {
    cleanedText = cleanedText.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleanedText) as Record<string, unknown>;
  } catch (error) {
    const extractedJson = extractFirstJsonObject(cleanedText);
    if (!extractedJson) {
      throw error;
    }
    parsed = JSON.parse(extractedJson) as Record<string, unknown>;
  }

  // Validate required fields
  if (
    typeof parsed.summary !== "string" ||
    typeof parsed.score_goal_completion !== "number" ||
    typeof parsed.score_tool_efficiency !== "number" ||
    typeof parsed.score_faithfulness !== "number" ||
    typeof parsed.critical_failure_detected !== "boolean" ||
    typeof parsed.reasoning_trace !== "string"
  ) {
    throw new Error("Invalid evaluation response format");
  }

  // Validate score ranges
  if (
    parsed.score_goal_completion < 0 ||
    parsed.score_goal_completion > 100 ||
    parsed.score_tool_efficiency < 0 ||
    parsed.score_tool_efficiency > 100 ||
    parsed.score_faithfulness < 0 ||
    parsed.score_faithfulness > 100
  ) {
    throw new Error("Scores must be between 0 and 100");
  }

  return {
    summary: parsed.summary,
    score_goal_completion: Math.round(parsed.score_goal_completion),
    score_tool_efficiency: Math.round(parsed.score_tool_efficiency),
    score_faithfulness: Math.round(parsed.score_faithfulness),
    critical_failure_detected: parsed.critical_failure_detected,
    reasoning_trace: parsed.reasoning_trace,
  };
}

const MAX_EVAL_PARSE_ATTEMPTS = 3;

export function buildEvalParseRetryPrompt(errorMessage: string): string {
  return [
    "The previous response could not be parsed as valid JSON.",
    `Error: ${errorMessage}`,
    "Please reply ONLY with a JSON object that matches the required schema:",
    "summary (string), score_goal_completion (0-100), score_tool_efficiency (0-100), score_faithfulness (0-100), critical_failure_detected (boolean), reasoning_trace (string).",
    "Do not include any extra text, markdown, or code fences.",
  ].join("\n");
}

export function buildEvalFailureRecord(input: {
  pk: string;
  sk: string;
  workspaceId: string;
  agentId: string;
  conversationId: string;
  judgeId: string;
  evaluatedAt: string;
  costUsd: number | undefined;
  usesByok: boolean;
  tokenUsage: TokenUsage | undefined;
  errorMessage: string;
  errorDetails: string;
}): Record<string, unknown> {
  return {
    pk: input.pk,
    sk: input.sk,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    conversationId: input.conversationId,
    judgeId: input.judgeId,
    status: "failed",
    summary: "Evaluation failed",
    scoreGoalCompletion: null,
    scoreToolEfficiency: null,
    scoreFaithfulness: null,
    criticalFailureDetected: false,
    reasoningTrace: "",
    errorMessage: input.errorMessage,
    errorDetails: input.errorDetails,
    costUsd: input.costUsd,
    usesByok: input.usesByok,
    tokenUsage: input.tokenUsage,
    evaluatedAt: input.evaluatedAt,
    version: 1,
    createdAt: input.evaluatedAt,
  };
}

const mergeOptionalNumber = (
  base: number | undefined,
  next: number | undefined
): number | undefined => {
  if (base === undefined && next === undefined) {
    return undefined;
  }
  return (base ?? 0) + (next ?? 0);
};

const mergeTokenUsage = (
  base: TokenUsage | undefined,
  next: TokenUsage | undefined
): TokenUsage | undefined => {
  if (!next) {
    return base ? { ...base } : undefined;
  }
  if (!base) {
    return { ...next };
  }
  const reasoningTokens = mergeOptionalNumber(
    base.reasoningTokens,
    next.reasoningTokens
  );
  const cachedPromptTokens = mergeOptionalNumber(
    base.cachedPromptTokens,
    next.cachedPromptTokens
  );
  const merged: TokenUsage = {
    promptTokens: base.promptTokens + next.promptTokens,
    completionTokens: base.completionTokens + next.completionTokens,
    totalTokens: base.totalTokens + next.totalTokens,
  };
  if (reasoningTokens !== undefined) {
    merged.reasoningTokens = reasoningTokens;
  }
  if (cachedPromptTokens !== undefined) {
    merged.cachedPromptTokens = cachedPromptTokens;
  }
  return merged;
};

/**
 * Execute an evaluation using a judge on a conversation
 */
export async function executeEvaluation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Database schema is dynamically generated
  db: any,
  workspaceId: string,
  agentId: string,
  conversationId: string,
  judgeId: string,
  context: AugmentedContext
): Promise<void> {
  // Get the judge configuration
  const judgePk = `agent-eval-judges/${workspaceId}/${agentId}/${judgeId}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Database schema is dynamically generated
  const judge = await (db as any)["agent-eval-judge"].get(judgePk, "judge") as {
    judgeId: string;
    enabled: boolean;
    provider: string;
    modelName: string;
    evalPrompt: string;
    name: string;
  } | null;
  if (!judge) {
    throw new Error(`Eval judge ${judgeId} not found`);
  }
  if (!judge.enabled) {
    console.log(`[Eval Execution] Judge ${judgeId} is disabled, skipping evaluation`);
    return;
  }

  // Get the conversation
  const conversationPk = `conversations/${workspaceId}/${agentId}/${conversationId}`;
  const conversation = await db["agent-conversations"].get(conversationPk);
  if (!conversation) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  // Do not evaluate conversations that failed due to credit/budget (402)
  if (
    conversation.error &&
    isCreditOrBudgetConversationError(conversation.error)
  ) {
    console.log(
      "[Eval Execution] Skipping evaluation - conversation failed due to credit/budget:",
      { workspaceId, agentId, conversationId, judgeId },
    );
    return;
  }

  // Get the agent to get the system prompt (agent goal)
  const agentPk = `agents/${workspaceId}/${agentId}`;
  const agent = await db.agent.get(agentPk, "agent");
  if (!agent) {
    throw new Error(`Agent ${agentId} not found`);
  }

  // Format conversation for eval
  const conversationData = formatConversationForEval(
    conversation.messages as UIMessage[]
  );

  // Build the eval prompt by replacing placeholders
  // The eval prompt should reference {input_prompt}, {steps}, {final_response}, and {agent_goal}
  let evalPrompt = judge.evalPrompt;
  evalPrompt = evalPrompt.replace(/{agent_goal}/g, agent.systemPrompt);
  
  // Create the full prompt with the conversation data
  const fullPrompt = `${evalPrompt}

Here is the conversation data to evaluate:

\`\`\`json
${JSON.stringify(
  {
    input_prompt: conversationData.input_prompt,
    steps: conversationData.steps,
    final_response: conversationData.final_response,
    agent_goal: agent.systemPrompt,
  },
  null,
  2
)}
\`\`\`

Please provide your evaluation as a JSON object following the specified format.`;

  // Check if workspace uses BYOK
  const { getWorkspaceApiKey } = await import("../http/utils/agentUtils");
  const workspaceKey = await getWorkspaceApiKey(workspaceId, judge.provider as "openrouter");
  const usesByok = workspaceKey !== null;

  // Create model for the judge
  // Only openrouter is supported for eval judges
  if (judge.provider !== "openrouter") {
    throw new Error(`Provider ${judge.provider} is not supported for eval judges. Only openrouter is supported.`);
  }
  const model = await createModel(
    "openrouter",
    judge.modelName,
    workspaceId,
    undefined, // referer
    undefined, // userId
    undefined // agentConfig
  );

  // Prepare messages for LLM call
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: fullPrompt,
    },
  ];

  // Validate credits and reserve (if not BYOK)
  // Only openrouter is supported for now
  if (judge.provider !== "openrouter") {
    throw new Error(`Provider ${judge.provider} is not supported for eval judges. Only openrouter is supported.`);
  }
  const reservationId = await validateCreditsAndLimitsAndReserve(
    db,
    workspaceId,
    undefined, // agentId (judge doesn't have an agent)
    "openrouter",
    judge.modelName,
    messages,
    undefined, // systemPrompt (included in user message)
    undefined, // toolDefinitions
    usesByok,
    context,
    conversationId
  );

  let evalResult:
    | ReturnType<typeof parseEvalResponse>
    | null = null;
  let parseError: Error | null = null;
  let evalError: Error | null = null;
  let totalTokenUsage: TokenUsage | undefined;
  let totalOpenrouterGenerationIds: string[] = [];
  let totalCostUsd: number | undefined;
  let llmCallAttempted = false;

  for (let attempt = 1; attempt <= MAX_EVAL_PARSE_ATTEMPTS; attempt += 1) {
    console.log("[Eval Execution] generateText arguments:", {
      model: judge.modelName,
      messagesCount: messages.length,
      attempt,
    });
    const requestTimeout = createRequestTimeout();
    let result: Awaited<ReturnType<typeof generateText>>;
    try {
      llmCallAttempted = true;
      result = await generateText({
        model: model as unknown as Parameters<typeof generateText>[0]["model"],
        messages,
        abortSignal: requestTimeout.signal,
      });
    } catch (error) {
      evalError = error instanceof Error ? error : new Error(String(error));
      break;
    } finally {
      cleanupRequestTimeout(requestTimeout);
    }

    const extractionResult = extractTokenUsageAndCosts(
      result as unknown as { totalUsage?: unknown; usage?: unknown },
      undefined,
      judge.modelName,
      "test" // endpoint type
    );

    totalTokenUsage = mergeTokenUsage(
      totalTokenUsage,
      extractionResult.tokenUsage
    );
    if (extractionResult.openrouterGenerationIds.length > 0) {
      totalOpenrouterGenerationIds = Array.from(
        new Set([
          ...totalOpenrouterGenerationIds,
          ...extractionResult.openrouterGenerationIds,
        ])
      );
    }
    if (extractionResult.provisionalCostUsd !== undefined) {
      totalCostUsd =
        (totalCostUsd ?? 0) + extractionResult.provisionalCostUsd;
    }

    try {
      evalResult = parseEvalResponse(result.text);
      parseError = null;
      break;
    } catch (error) {
      parseError = error instanceof Error ? error : new Error(String(error));
      console.error("[Eval Execution] Failed to parse evaluation response:", {
        error: parseError.message,
        text: result.text.substring(0, 500), // Log first 500 chars
        judgeId,
        conversationId,
        attempt,
      });
      if (attempt < MAX_EVAL_PARSE_ATTEMPTS) {
        messages.push({
          role: "assistant",
          content: result.text,
        });
        messages.push({
          role: "user",
          content: buildEvalParseRetryPrompt(parseError.message),
        });
      }
    }
  }

  // Adjust credits after LLM calls
  if (reservationId) {
    const dbWithAtomic = db as Parameters<typeof adjustCreditsAfterLLMCall>[0];
    await adjustCreditsAfterLLMCall(
      dbWithAtomic,
      workspaceId,
      agentId, // agentId for eval execution
      reservationId.reservationId,
      "openrouter",
      judge.modelName,
      totalTokenUsage,
      usesByok,
      totalOpenrouterGenerationIds[0],
      totalOpenrouterGenerationIds,
      "test", // endpoint type
      context,
      conversationId
    );
  }

  const reservationKey = reservationId?.reservationId;
  const hasGenerationIds = totalOpenrouterGenerationIds.length > 0;
  if (
    !evalError &&
    reservationKey &&
    reservationKey !== "byok" &&
    (!totalTokenUsage ||
      (totalTokenUsage.promptTokens === 0 &&
        totalTokenUsage.completionTokens === 0)) &&
    !hasGenerationIds
  ) {
    await cleanupReservationWithoutTokenUsage(
      db,
      reservationKey,
      workspaceId,
      agentId,
      "test"
    );
  } else if (
    !evalError &&
    reservationKey &&
    reservationKey !== "byok" &&
    (!totalTokenUsage ||
      (totalTokenUsage.promptTokens === 0 &&
        totalTokenUsage.completionTokens === 0)) &&
    hasGenerationIds
  ) {
    console.warn(
      "[Eval Execution] No token usage available, keeping reservation for verification",
      {
        workspaceId,
        agentId,
        reservationId: reservationKey,
      }
    );
  }

  if (!evalResult && evalError && reservationId) {
    const dbWithAtomic = db as Parameters<typeof cleanupReservationOnError>[0];
    await cleanupReservationOnError(
      dbWithAtomic,
      reservationId.reservationId,
      workspaceId,
      agentId,
      "openrouter",
      judge.modelName,
      evalError,
      llmCallAttempted,
      usesByok,
      "test",
      context
    );
  }

  // Store the evaluation result
  const resultPk = `agent-eval-results/${workspaceId}/${agentId}/${conversationId}/${judgeId}`;
  const resultSk = "result";
  const now = new Date().toISOString();

  let evalResultRecord: Record<string, unknown>;
  if (evalResult) {
    evalResultRecord = {
      pk: resultPk,
      sk: resultSk,
      workspaceId,
      agentId,
      conversationId,
      judgeId,
      status: "completed",
      summary: evalResult.summary,
      scoreGoalCompletion: evalResult.score_goal_completion,
      scoreToolEfficiency: evalResult.score_tool_efficiency,
      scoreFaithfulness: evalResult.score_faithfulness,
      criticalFailureDetected: evalResult.critical_failure_detected,
      reasoningTrace: evalResult.reasoning_trace,
      costUsd: totalCostUsd,
      usesByok,
      tokenUsage: totalTokenUsage,
      evaluatedAt: now,
      version: 1,
      createdAt: now,
    };
  } else {
    const failureMessage = parseError
      ? "Failed to parse evaluation response"
      : "Evaluation failed";
    const failureDetails = parseError
      ? parseError.message
      : evalError
      ? evalError.message
      : "Unknown evaluation failure";
    evalResultRecord = buildEvalFailureRecord({
      pk: resultPk,
      sk: resultSk,
      workspaceId,
      agentId,
      conversationId,
      judgeId,
      evaluatedAt: now,
      costUsd: totalCostUsd,
      usesByok,
      tokenUsage: totalTokenUsage,
      errorMessage: failureMessage,
      errorDetails: failureDetails,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any)["agent-eval-result"].create(evalResultRecord);

  console.log("[Eval Execution] Evaluation completed:", {
    judgeId,
    conversationId,
    status: evalResult ? "completed" : "failed",
    scores: evalResult
      ? {
          goalCompletion: evalResult.score_goal_completion,
          toolEfficiency: evalResult.score_tool_efficiency,
          faithfulness: evalResult.score_faithfulness,
        }
      : undefined,
    criticalFailure: evalResult?.critical_failure_detected,
    costUsd: totalCostUsd,
  });
}
