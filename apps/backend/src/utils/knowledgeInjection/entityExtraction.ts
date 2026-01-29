import type { ModelMessage } from "ai";
import { generateText } from "ai";
import { z } from "zod";

import { getWorkspaceApiKey } from "../../http/utils/agent-keys";
import { createModel, getDefaultModel } from "../../http/utils/modelFactory";
import {
  cleanupRequestTimeout,
  createRequestTimeout,
} from "../../http/utils/requestTimeout";
import { database } from "../../tables";
import { validateCreditsAndLimits } from "../creditValidation";

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
  const parsed = EntityExtractionResponseSchema.parse(JSON.parse(text));
  const unique = Array.from(new Set(parsed.entities.map((e) => e.trim())));
  return unique.filter((entity) => entity.length > 0);
}

export async function extractEntitiesFromPrompt(params: {
  workspaceId: string;
  agentId: string;
  prompt: string;
  modelName?: string | null;
}): Promise<string[]> {
  const { workspaceId, agentId, prompt, modelName } = params;
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

  await validateCreditsAndLimits(
    db,
    workspaceId,
    agentId,
    "openrouter",
    resolvedModelName,
    messages,
    systemPrompt,
    undefined,
    usesByok,
  );

  const model = await createModel(
    "openrouter",
    resolvedModelName,
    workspaceId,
    process.env.DEFAULT_REFERER || "http://localhost:3000/api/webhook",
  );

  const requestTimeout = createRequestTimeout();
  let resultText = "";
  try {
    const result = await generateText({
      model: model as unknown as Parameters<typeof generateText>[0]["model"],
      system: systemPrompt,
      messages,
      abortSignal: requestTimeout.signal,
    });
    resultText = result.text.trim();
  } finally {
    cleanupRequestTimeout(requestTimeout);
  }

  if (!resultText) {
    throw new Error("Entity extraction returned empty response");
  }

  try {
    return parseEntityExtractionResponse(resultText);
  } catch (error) {
    console.error("[Entity Extraction] Failed to parse response:", {
      error: error instanceof Error ? error.message : String(error),
      responsePreview: resultText.substring(0, 300),
    });
    throw error;
  }
}
