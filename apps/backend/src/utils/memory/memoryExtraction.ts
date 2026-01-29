import { createHash } from "crypto";

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
import { createGraphDb } from "../duckdb/graphDb";
import { parseJsonWithFallback } from "../jsonParsing";

import {
  getEffectiveMemoryExtractionPrompt,
  DEFAULT_MEMORY_EXTRACTION_PROMPT,
} from "./memoryExtractionPrompt";

const MemoryOperationSchema = z
  .object({
    operation: z.enum(["ADD", "UPDATE", "DELETE"]),
    subject: z.string().min(1),
    predicate: z.string().min(1),
    object: z.string().min(1),
    confidence: z.number().min(0).max(1).optional().default(1),
  })
  .strict();

const MemoryExtractionResponseSchema = z
  .object({
    summary: z.string().optional().default(""),
    memory_operations: z.array(MemoryOperationSchema).optional().default([]),
  })
  .strict();

export type MemoryOperation = z.infer<typeof MemoryOperationSchema>;

type MemoryExtractionResult = {
  summary: string;
  memoryOperations: MemoryOperation[];
};

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function buildFactId(
  subject: string,
  predicate: string,
  object: string,
): string {
  return createHash("sha256")
    .update(`${subject}|${predicate}|${object}`)
    .digest("hex");
}

function buildExtractionSystemPrompt(promptOverride?: string | null): string {
  const basePrompt = getEffectiveMemoryExtractionPrompt(promptOverride);
  return `${basePrompt}\n\n### SUMMARY\nAlso include a concise conversation summary in a top-level "summary" field alongside "memory_operations".`;
}

function buildExtractionMessages(conversationText: string): ModelMessage[] {
  return [
    {
      role: "user",
      content: `Current Interaction:\n${conversationText}\n\nReturn a valid JSON object with keys "summary" and "memory_operations".`,
    },
  ];
}

function parseExtractionResponse(text: string): MemoryExtractionResult {
  const parsed = parseJsonWithFallback<unknown>(text);
  const result = MemoryExtractionResponseSchema.parse(parsed);
  const summary = result.summary.trim();
  const memoryOperations = result.memory_operations.map((operation) => ({
    ...operation,
    subject: operation.subject.trim(),
    predicate: operation.predicate.trim(),
    object: operation.object.trim(),
    confidence: operation.confidence ?? 1,
  }));
  return { summary, memoryOperations };
}

async function requestJsonRepair(params: {
  model: Parameters<typeof generateText>[0]["model"];
  modelName: string;
  workspaceId: string;
  agentId: string;
  usesByok: boolean;
  rawResponse: string;
  errorMessage: string;
}): Promise<string> {
  const repairSystemPrompt =
    "You are a JSON repair assistant. Return ONLY valid JSON for the schema: " +
    '{ "summary": string, "memory_operations": Array<{ "operation": "ADD"|"UPDATE"|"DELETE", "subject": string, "predicate": string, "object": string, "confidence"?: number }> }';
  const repairMessages: ModelMessage[] = [
    {
      role: "user",
      content: `The previous response failed to parse as JSON.\nError: ${params.errorMessage}\n\nResponse:\n${params.rawResponse}\n\nFix the JSON and return only valid JSON, no markdown.`,
    },
  ];

  const db = await database();
  await validateCreditsAndLimits(
    db,
    params.workspaceId,
    params.agentId,
    "openrouter",
    params.modelName,
    repairMessages,
    repairSystemPrompt,
    undefined,
    params.usesByok,
  );

  const requestTimeout = createRequestTimeout();
  try {
    const result = await generateText({
      model: params.model,
      system: repairSystemPrompt,
      messages: repairMessages,
      abortSignal: requestTimeout.signal,
    });
    return result.text.trim();
  } finally {
    cleanupRequestTimeout(requestTimeout);
  }
}

export async function extractConversationMemory(params: {
  workspaceId: string;
  agentId: string;
  conversationId: string;
  conversationText: string;
  modelName?: string | null;
  prompt?: string | null;
}): Promise<MemoryExtractionResult | null> {
  const {
    workspaceId,
    agentId,
    conversationId,
    conversationText,
    modelName,
    prompt,
  } = params;
  if (!conversationText.trim()) {
    return null;
  }

  const resolvedModelName =
    typeof modelName === "string" && modelName.trim().length > 0
      ? modelName.trim()
      : getDefaultModel();
  const systemPrompt = buildExtractionSystemPrompt(prompt);
  const messages = buildExtractionMessages(conversationText);

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

  console.log("[Memory Extraction] generateText arguments:", {
    workspaceId,
    agentId,
    conversationId,
    model: resolvedModelName,
    systemPromptLength: systemPrompt.length,
    messageLength: conversationText.length,
    promptPreview:
      prompt && prompt.trim().length > 0
        ? prompt.trim().substring(0, 60)
        : DEFAULT_MEMORY_EXTRACTION_PROMPT.substring(0, 60),
  });

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
    throw new Error("Memory extraction returned empty response");
  }

  try {
    return parseExtractionResponse(resultText);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn("[Memory Extraction] Failed to parse response, retrying:", {
      error: errorMessage,
      responsePreview: resultText.substring(0, 300),
    });

    const repairedText = await requestJsonRepair({
      model: model as unknown as Parameters<typeof generateText>[0]["model"],
      modelName: resolvedModelName,
      workspaceId,
      agentId,
      usesByok,
      rawResponse: resultText,
      errorMessage,
    });

    try {
      return parseExtractionResponse(repairedText);
    } catch (repairError) {
      console.error("[Memory Extraction] Failed to parse repaired response:", {
        error:
          repairError instanceof Error
            ? repairError.message
            : String(repairError),
        responsePreview: repairedText.substring(0, 300),
      });
      throw repairError;
    }
  }
}

export async function applyMemoryOperationsToGraph(params: {
  workspaceId: string;
  agentId: string;
  conversationId: string;
  memoryOperations: MemoryOperation[];
}): Promise<void> {
  const { workspaceId, agentId, conversationId, memoryOperations } = params;
  if (memoryOperations.length === 0) {
    return;
  }

  const graphDb = await createGraphDb(workspaceId, agentId);
  const now = new Date().toISOString();
  try {
    for (const operation of memoryOperations) {
      const subject = operation.subject.trim();
      const predicate = operation.predicate.trim();
      const object = operation.object.trim();
      if (!subject || !predicate || !object) {
        console.warn(
          "[Memory Extraction] Skipping invalid memory operation:",
          operation,
        );
        continue;
      }

      const properties = {
        confidence: operation.confidence ?? 1,
        workspaceId,
        agentId,
        conversationId,
        updatedAt: now,
      };

      if (operation.operation === "DELETE") {
        await graphDb.deleteFacts({
          source_id: subject,
          label: predicate,
          target_id: object,
        });
        continue;
      }

      if (operation.operation === "UPDATE") {
        const existingFacts = await graphDb.queryGraph<{ id: string }>(
          `SELECT id FROM facts WHERE source_id = '${escapeSqlString(
            subject,
          )}' AND label = '${escapeSqlString(predicate)}';`,
        );
        for (const fact of existingFacts) {
          await graphDb.deleteFacts({ id: fact.id });
        }
        await graphDb.insertFacts([
          {
            id: buildFactId(subject, predicate, object),
            source_id: subject,
            target_id: object,
            label: predicate,
            properties,
          },
        ]);
        continue;
      }

      const existing = await graphDb.queryGraph<{ id: string }>(
        `SELECT id FROM facts WHERE source_id = '${escapeSqlString(
          subject,
        )}' AND label = '${escapeSqlString(
          predicate,
        )}' AND target_id = '${escapeSqlString(object)}' LIMIT 1;`,
      );
      if (existing.length > 0) {
        await graphDb.updateFacts({ id: existing[0].id }, { properties });
      } else {
        await graphDb.insertFacts([
          {
            id: buildFactId(subject, predicate, object),
            source_id: subject,
            target_id: object,
            label: predicate,
            properties,
          },
        ]);
      }
    }

    await graphDb.save();
  } finally {
    await graphDb.close();
  }
}
