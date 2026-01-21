import { stepCountIs } from "ai";

import { MODEL_NAME } from "./agent-constants";
import type { LlmObserver } from "./llmObserver";
import { createModel } from "./modelFactory";
import type { Provider } from "./modelFactory";

/**
 * Create an AI model instance (OpenRouter by default, Google for backward compatibility)
 */
export async function createAgentModel(
  referer: string = "http://localhost:3000/api/webhook",
  apiKey?: string,
  modelName?: string,
  workspaceId?: string,
  agentId?: string,
  usesByok?: boolean,
  userId?: string,
  provider: Provider = "openrouter",
  agentConfig?: {
    temperature?: number | null;
    topP?: number | null;
    topK?: number | null;
    maxOutputTokens?: number | null;
    stopSequences?: string[] | null;
    [key: string]: unknown;
  },
  llmObserver?: LlmObserver
) {
  const finalModelName = modelName || MODEL_NAME;

  return createModel(
    provider,
    finalModelName,
    workspaceId,
    referer,
    userId,
    agentConfig,
    llmObserver
  );
}

/**
 * Build generateText options from agent configuration
 */
export type GenerateTextOptions = {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  stopSequences?: string[];
  stopWhen?: ReturnType<typeof stepCountIs>;
};

export function buildGenerateTextOptions(agent: {
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
  maxOutputTokens?: number | null;
  stopSequences?: string[] | null;
  maxToolRoundtrips?: number | null;
  [key: string]: unknown;
}): GenerateTextOptions {
  const options: GenerateTextOptions = {};

  if (agent.temperature !== undefined && agent.temperature !== null) {
    options.temperature = agent.temperature;
  }
  if (agent.topP !== undefined && agent.topP !== null) {
    options.topP = agent.topP;
  }
  if (agent.topK !== undefined && agent.topK !== null) {
    options.topK = agent.topK;
  }
  if (agent.maxOutputTokens !== undefined && agent.maxOutputTokens !== null) {
    options.maxTokens = agent.maxOutputTokens;
  }
  if (
    agent.stopSequences !== undefined &&
    agent.stopSequences !== null &&
    agent.stopSequences.length > 0
  ) {
    options.stopSequences = agent.stopSequences;
  }
  if (agent.maxToolRoundtrips !== undefined && agent.maxToolRoundtrips !== null) {
    options.stopWhen = stepCountIs(agent.maxToolRoundtrips);
  } else {
    options.stopWhen = stepCountIs(5);
  }

  const maxToolRoundtrips = agent.maxToolRoundtrips ?? 5;
  console.log("[Model Configuration] Generated options:", {
    temperature: options.temperature ?? "default",
    topP: options.topP ?? "default",
    topK: options.topK ?? "default",
    maxTokens: options.maxTokens ?? "default",
    stopSequences: options.stopSequences ?? "none",
    maxToolRoundtrips,
    stopWhen: `stepCountIs(${maxToolRoundtrips})`,
    agentConfig: {
      temperature: agent.temperature,
      topP: agent.topP,
      topK: agent.topK,
      maxOutputTokens: agent.maxOutputTokens,
      stopSequences: agent.stopSequences,
      maxToolRoundtrips: agent.maxToolRoundtrips,
    },
  });

  return options;
}
