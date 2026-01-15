import { generateText } from "ai";
import type { ModelMessage } from "ai";

import { adjustCreditsAfterLLMCall } from "../http/utils/generationCreditManagement";
import { extractTokenUsageAndCosts } from "../http/utils/generationTokenExtraction";
import { createModel } from "../http/utils/modelFactory";

import { validateCreditsAndLimitsAndReserve } from "./creditValidation";
import type { UIMessage } from "./messageTypes";
import type { AugmentedContext } from "./workspaceCreditContext";

/**
 * Format conversation messages into the format expected by eval prompts
 */
function formatConversationForEval(
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
          if (typeof item === "object" && item !== null && "type" in item && item.type === "reasoning") {
            steps.push({
              step_id: `step_${stepCounter++}`,
              type: "thought",
              content: (typeof item === "object" && item !== null && "text" in item && typeof item.text === "string") ? item.text : "",
              timestamp: message.generationStartedAt,
            });
          } else if (typeof item === "object" && item !== null && "type" in item && item.type === "tool-call") {
            steps.push({
              step_id: `step_${stepCounter++}`,
              type: "tool_call",
              content: {
                toolCallId: (typeof item === "object" && item !== null && "toolCallId" in item && typeof item.toolCallId === "string") ? item.toolCallId : "",
                toolName: (typeof item === "object" && item !== null && "toolName" in item && typeof item.toolName === "string") ? item.toolName : "",
                args: (typeof item === "object" && item !== null && "args" in item) ? (item as { args: unknown }).args : (typeof item === "object" && item !== null && "input" in item) ? (item as { input: unknown }).input : {},
              },
              timestamp: message.generationStartedAt,
            });
          } else if (typeof item === "object" && item !== null && "type" in item && item.type === "tool-result") {
            steps.push({
              step_id: `step_${stepCounter++}`,
              type: "tool_result",
              content: {
                toolCallId: (typeof item === "object" && item !== null && "toolCallId" in item && typeof item.toolCallId === "string") ? item.toolCallId : "",
                toolName: (typeof item === "object" && item !== null && "toolName" in item && typeof item.toolName === "string") ? item.toolName : "",
                result: (typeof item === "object" && item !== null && "result" in item) ? (item as { result: unknown }).result : (typeof item === "object" && item !== null && "output" in item) ? (item as { output: unknown }).output : {},
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
 */
function parseEvalResponse(text: string): {
  summary: string;
  score_goal_completion: number;
  score_tool_efficiency: number;
  score_faithfulness: number;
  critical_failure_detected: boolean;
  reasoning_trace: string;
} {
  // Remove markdown code blocks if present
  let cleanedText = text.trim();
  if (cleanedText.startsWith("```json")) {
    cleanedText = cleanedText.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (cleanedText.startsWith("```")) {
    cleanedText = cleanedText.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }

  const parsed = JSON.parse(cleanedText);

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

  // Make LLM call
  const result = await generateText({
    model: model as unknown as Parameters<typeof generateText>[0]["model"],
    messages,
  });

  // Extract token usage and costs
  const extractionResult = extractTokenUsageAndCosts(
    result as unknown as { totalUsage?: unknown; usage?: unknown },
    undefined,
    judge.modelName,
    "test" // endpoint type
  );

  // Adjust credits after LLM call
  if (reservationId) {
     
    const dbWithAtomic = db as Parameters<typeof adjustCreditsAfterLLMCall>[0];
    await adjustCreditsAfterLLMCall(
      dbWithAtomic,
      workspaceId,
      agentId, // agentId for eval execution
      reservationId.reservationId,
      "openrouter",
      judge.modelName,
      extractionResult.tokenUsage,
      usesByok,
      extractionResult.openrouterGenerationId,
      extractionResult.openrouterGenerationIds,
      "test", // endpoint type
      context
    );
  }

  // Parse the evaluation response
  let evalResult;
  try {
    evalResult = parseEvalResponse(result.text);
  } catch (error) {
    console.error("[Eval Execution] Failed to parse evaluation response:", {
      error: error instanceof Error ? error.message : String(error),
      text: result.text.substring(0, 500), // Log first 500 chars
      judgeId,
      conversationId,
    });
    throw new Error(
      `Failed to parse evaluation response: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Calculate cost in millionths (use provisionalCostUsd from extraction result)
  const costUsd = extractionResult.provisionalCostUsd;

  // Store the evaluation result
  const resultPk = `agent-eval-results/${workspaceId}/${agentId}/${conversationId}/${judgeId}`;
  const resultSk = "result";
  const now = new Date().toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Database schema is dynamically generated
  const evalResultRecord: any = {
    pk: resultPk,
    sk: resultSk,
    workspaceId,
    agentId,
    conversationId,
    judgeId,
    summary: evalResult.summary,
    scoreGoalCompletion: evalResult.score_goal_completion,
    scoreToolEfficiency: evalResult.score_tool_efficiency,
    scoreFaithfulness: evalResult.score_faithfulness,
    criticalFailureDetected: evalResult.critical_failure_detected,
    reasoningTrace: evalResult.reasoning_trace,
    costUsd,
    usesByok,
    tokenUsage: extractionResult.tokenUsage,
    evaluatedAt: now,
    version: 1,
    createdAt: now,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any)["agent-eval-result"].create(evalResultRecord);

  console.log("[Eval Execution] Evaluation completed:", {
    judgeId,
    conversationId,
    scores: {
      goalCompletion: evalResult.score_goal_completion,
      toolEfficiency: evalResult.score_tool_efficiency,
      faithfulness: evalResult.score_faithfulness,
    },
    criticalFailure: evalResult.critical_failure_detected,
    costUsd,
  });
}
