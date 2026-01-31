import type { ModelMessage } from "ai";
import { generateText } from "ai";

import { getWorkspaceApiKey } from "../../http/utils/agent-keys";
import {
  adjustCreditsAfterLLMCall,
  cleanupReservationOnError,
  cleanupReservationWithoutTokenUsage,
  enqueueCostVerificationIfNeeded,
} from "../../http/utils/generationCreditManagement";
import { extractTokenUsageAndCosts } from "../../http/utils/generationTokenExtraction";
import { createModel, getDefaultModel } from "../../http/utils/modelFactory";
import {
  createRequestTimeout,
  cleanupRequestTimeout,
} from "../../http/utils/requestTimeout";
import { database } from "../../tables";
import { validateCreditsAndLimitsAndReserve } from "../creditValidation";
import type { TemporalGrain } from "../vectordb/types";
import type { AugmentedContext } from "../workspaceCreditContext";

export type SummarizationPromptGrain =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly";

export type SummarizationPrompts = Partial<
  Record<SummarizationPromptGrain, string>
>;

const SUMMARIZATION_PROMPT_GRAINS: SummarizationPromptGrain[] = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
];

export function normalizeSummarizationPrompts(
  prompts?: Partial<Record<SummarizationPromptGrain, string | null>> | null
): SummarizationPrompts | undefined {
  if (!prompts) {
    return undefined;
  }

  const cleaned: SummarizationPrompts = {};
  for (const grain of SUMMARIZATION_PROMPT_GRAINS) {
    const value = prompts[grain];
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      cleaned[grain] = trimmed;
    }
  }

  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

export function resolveSummarizationPrompt(
  grain: TemporalGrain,
  prompts?: SummarizationPrompts
): string {
  if (prompts && grain in prompts) {
    const override = prompts[grain as SummarizationPromptGrain];
    if (override && override.trim().length > 0) {
      return override;
    }
  }
  return getSummarizationPrompt(grain);
}

/**
 * Get the system prompt for summarizing memory at a specific grain level
 */
export function getSummarizationPrompt(grain: TemporalGrain): string {
  switch (grain) {
    case "daily":
      return `You are summarizing daily events from working memory. Extract and summarize the most important facts, occurrences, and people mentioned. Focus on:
- Important events and occurrences
- Key people mentioned and their roles/relationships
- Significant facts and information
- Any notable patterns or trends

Keep the summary concise but comprehensive. Use clear, factual language.`;
    case "weekly":
      return `You are summarizing a week's worth of daily summaries. Extract and consolidate the most important facts, occurrences, and people across the week. Focus on:
- Major events and occurrences throughout the week
- Key people and their evolving roles/relationships
- Important patterns, trends, or changes
- Significant facts that remain relevant

Create a cohesive narrative of the week's most important information.`;
    case "monthly":
      return `You are summarizing a month's worth of weekly summaries. Extract and consolidate the most important facts, occurrences, and people across the month. Focus on:
- Major events and milestones throughout the month
- Key people and their relationships/roles
- Important patterns, trends, or changes over time
- Significant facts and information that remain relevant

Create a high-level overview of the month's most important information.`;
    case "quarterly":
      return `You are summarizing a quarter's worth of monthly summaries. Extract and consolidate the most important facts, occurrences, and people across the quarter. Focus on:
- Major events and milestones throughout the quarter
- Key people and their relationships/roles
- Important patterns, trends, or changes over time
- Significant facts and information that remain relevant

Create a high-level overview of the quarter's most important information.`;
    case "yearly":
      return `You are summarizing a year's worth of quarterly summaries. Extract and consolidate the most important facts, occurrences, and people across the year. Focus on:
- Major events and milestones throughout the year
- Key people and their relationships/roles
- Important patterns, trends, or changes over time
- Significant facts and information that remain relevant

Create a high-level overview of the year's most important information.`;
    default:
      throw new Error(`Summarization not supported for grain: ${grain}`);
  }
}

/**
 * Summarize content using an LLM
 * @param content - Array of content strings to summarize
 * @param summaryType - The temporal grain type for the summary
 * @param workspaceId - Optional workspace ID for API key lookup
 * @returns Summarized text
 */
export async function summarizeWithLLM(
  content: string[],
  summaryType: TemporalGrain,
  workspaceId?: string,
  agentId?: string,
  summarizationPrompts?: SummarizationPrompts,
  context?: AugmentedContext
): Promise<string> {
  if (content.length === 0) {
    return "";
  }

  // Combine all content into a single text
  const combinedContent = content.join("\n\n---\n\n");

  // Get the system prompt for this grain type
  const systemPrompt = resolveSummarizationPrompt(
    summaryType,
    summarizationPrompts
  );

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: `Please summarize the following information:\n\n${combinedContent}`,
    },
  ];

  const resolvedModelName = getDefaultModel();
  let reservationId: string | undefined;
  let usesByok = false;
  const db = await database();

  if (workspaceId) {
    const workspaceKey = await getWorkspaceApiKey(workspaceId, "openrouter");
    usesByok = workspaceKey !== null;

    const reservation = await validateCreditsAndLimitsAndReserve(
      db,
      workspaceId,
      agentId,
      "openrouter",
      resolvedModelName,
      messages,
      systemPrompt,
      undefined,
      usesByok,
      context,
      undefined
    );
    reservationId = reservation?.reservationId;
  } else {
    console.warn(
      "[Memory Summarization] No workspaceId provided; skipping credit validation and reservation."
    );
  }

  // Create model (will use workspace API key if available, otherwise system key)
  // Use DEFAULT_REFERER env var or fallback to webhook endpoint
  const model = await createModel(
    "openrouter",
    resolvedModelName,
    workspaceId,
    process.env.DEFAULT_REFERER || "http://localhost:3000/api/webhook"
  );

  // Generate summary
  console.log("[Memory Summarization] generateText arguments:", {
    model: "default",
    systemPromptLength: systemPrompt.length,
    messagesCount: 1,
  });
  const requestTimeout = createRequestTimeout();
  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    result = await generateText({
      model: model as unknown as Parameters<typeof generateText>[0]["model"],
      system: systemPrompt,
    messages,
      abortSignal: requestTimeout.signal,
    });
  } catch (error) {
    if (
      reservationId &&
      reservationId !== "byok" &&
      context &&
      workspaceId
    ) {
      await cleanupReservationOnError(
        db,
        reservationId,
        workspaceId,
        agentId ?? "unknown",
        "openrouter",
        resolvedModelName,
        error,
        true,
        usesByok,
        "scheduled",
        context
      );
    }
    throw error;
  } finally {
    cleanupRequestTimeout(requestTimeout);
  }

  if (!workspaceId) {
    return result.text.trim();
  }

  const extractionResult = extractTokenUsageAndCosts(
    result,
    undefined,
    resolvedModelName,
    "scheduled"
  );
  const tokenUsage = extractionResult.tokenUsage;

  if (context && reservationId) {
    const dbWithAtomic = db as Parameters<typeof adjustCreditsAfterLLMCall>[0];
    await adjustCreditsAfterLLMCall(
      dbWithAtomic,
      workspaceId,
      agentId ?? "unknown",
      reservationId,
      "openrouter",
      resolvedModelName,
      tokenUsage,
      usesByok,
      extractionResult.openrouterGenerationId,
      extractionResult.openrouterGenerationIds,
      "scheduled",
      context,
      undefined
    );
  } else if (reservationId) {
    console.warn("[Memory Summarization] No context for credit adjustment", {
      workspaceId,
      agentId,
      reservationId,
    });
  }

  const hasGenerationIds =
    extractionResult.openrouterGenerationIds.length > 0 ||
    Boolean(extractionResult.openrouterGenerationId);
  if (
    reservationId &&
    reservationId !== "byok" &&
    (!tokenUsage ||
      (tokenUsage.promptTokens === 0 && tokenUsage.completionTokens === 0)) &&
    !hasGenerationIds
  ) {
    await cleanupReservationWithoutTokenUsage(
      db,
      reservationId,
      workspaceId,
      agentId ?? "unknown",
      "scheduled"
    );
  } else if (
    reservationId &&
    reservationId !== "byok" &&
    (!tokenUsage ||
      (tokenUsage.promptTokens === 0 && tokenUsage.completionTokens === 0)) &&
    hasGenerationIds
  ) {
    console.warn(
      "[Memory Summarization] No token usage available, keeping reservation for verification",
      {
        workspaceId,
        agentId,
        reservationId,
      }
    );
  }

  await enqueueCostVerificationIfNeeded(
    extractionResult.openrouterGenerationId,
    extractionResult.openrouterGenerationIds,
    workspaceId,
    reservationId,
    undefined,
    agentId,
    "scheduled"
  );

  return result.text.trim();
}
