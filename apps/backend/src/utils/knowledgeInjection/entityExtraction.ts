import type { ModelMessage } from "ai";
import { generateText } from "ai";
import { z } from "zod";

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
  cleanupRequestTimeout,
  createRequestTimeout,
} from "../../http/utils/requestTimeout";
import { database } from "../../tables";
import { validateCreditsAndLimitsAndReserve } from "../creditValidation";
import { parseJsonWithFallback } from "../jsonParsing";
import type { AugmentedContext } from "../workspaceCreditContext";

const EntityExtractionResponseSchema = z
  .object({
    entities: z.array(z.string().min(1)).optional().default([]),
  })
  .strict();

const DEFAULT_ENTITY_EXTRACTION_PROMPT = `You are an entity extraction assistant.
Extract the most relevant entities (people, organizations, products, technologies, or concepts) from the user's prompt.
Return ONLY valid JSON in the following format:

{"entities":["Entity 1","Entity 2"]}

If no entities are found, return {"entities":[]}.`;

function buildEntityExtractionMessages(prompt: string): ModelMessage[] {
  return [
    {
      role: "user",
      content: prompt.trim(),
    },
  ];
}

function parseEntityExtractionResponse(text: string): string[] {
  const parsed = EntityExtractionResponseSchema.parse(
    parseJsonWithFallback<unknown>(text),
  );
  const unique = Array.from(new Set(parsed.entities.map((e) => e.trim())));
  return unique.filter((entity) => entity.length > 0);
}

export async function extractEntitiesFromPrompt(params: {
  workspaceId: string;
  agentId: string;
  prompt: string;
  modelName?: string | null;
  context?: AugmentedContext;
  conversationId?: string;
}): Promise<string[]> {
  const { workspaceId, agentId, prompt, modelName, context, conversationId } =
    params;
  if (!prompt.trim()) {
    return [];
  }

  const resolvedModelName =
    typeof modelName === "string" && modelName.trim().length > 0
      ? modelName.trim()
      : getDefaultModel();
  const messages = buildEntityExtractionMessages(prompt);
  const systemPrompt = DEFAULT_ENTITY_EXTRACTION_PROMPT;

  const db = await database();
  const workspaceKey = await getWorkspaceApiKey(workspaceId, "openrouter");
  const usesByok = workspaceKey !== null;

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
    conversationId,
  );
  const reservationId = reservation?.reservationId;

  const requestTimeout = createRequestTimeout();
  let resultText = "";
  let llmCallAttempted = false;
  try {
    const model = await createModel(
      "openrouter",
      resolvedModelName,
      workspaceId,
      process.env.DEFAULT_REFERER || "http://localhost:3000/api/webhook",
    );
    llmCallAttempted = true;
    const result = await generateText({
      model: model as unknown as Parameters<typeof generateText>[0]["model"],
      system: systemPrompt,
      messages,
      abortSignal: requestTimeout.signal,
    });
    resultText = result.text.trim();

    const extractionResult = extractTokenUsageAndCosts(
      result,
      undefined,
      resolvedModelName,
      "knowledge-injection",
    );
    const tokenUsage = extractionResult.tokenUsage;

    if (context) {
      const dbWithAtomic = db as Parameters<typeof adjustCreditsAfterLLMCall>[0];
      await adjustCreditsAfterLLMCall(
        dbWithAtomic,
        workspaceId,
        agentId,
        reservationId,
        "openrouter",
        resolvedModelName,
        tokenUsage,
        usesByok,
        extractionResult.openrouterGenerationId,
        extractionResult.openrouterGenerationIds,
        "knowledge-injection",
        context,
        conversationId,
      );
    } else if (reservationId) {
      console.warn(
        "[Entity Extraction] No context available for credit adjustment",
        {
          workspaceId,
          agentId,
          reservationId,
        },
      );
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
        agentId,
        "knowledge-injection",
      );
    } else if (
      reservationId &&
      reservationId !== "byok" &&
      (!tokenUsage ||
        (tokenUsage.promptTokens === 0 && tokenUsage.completionTokens === 0)) &&
      hasGenerationIds
    ) {
      console.warn(
        "[Entity Extraction] No token usage available, keeping reservation for verification",
        {
          workspaceId,
          agentId,
          reservationId,
        },
      );
    }

    await enqueueCostVerificationIfNeeded(
      extractionResult.openrouterGenerationId,
      extractionResult.openrouterGenerationIds,
      workspaceId,
      reservationId,
      conversationId,
      agentId,
      "knowledge-injection",
    );
  } catch (error) {
    if (reservationId && reservationId !== "byok" && context) {
      const dbWithAtomic = db as Parameters<typeof cleanupReservationOnError>[0];
      await cleanupReservationOnError(
        dbWithAtomic,
        reservationId,
        workspaceId,
        agentId,
        "openrouter",
        resolvedModelName,
        error,
        llmCallAttempted,
        usesByok,
        "knowledge-injection",
        context,
      );
    }
    throw error;
  } finally {
    cleanupRequestTimeout(requestTimeout);
  }

  if (!resultText) {
    throw new Error("Entity extraction returned empty response");
  }

  try {
    return parseEntityExtractionResponse(resultText);
  } catch (error) {
    console.warn(
      "[Entity Extraction] Failed to parse response, returning no entities:",
      {
        error: error instanceof Error ? error.message : String(error),
        responsePreview: resultText.substring(0, 300),
      },
    );
    return [];
  }
}
