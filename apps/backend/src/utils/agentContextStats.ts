import { getDefaultModel } from "../http/utils/modelFactory";

import { buildSystemPromptWithSkills } from "./agentSkills";
import type { CurrencyPricing, ModelCapabilities } from "./pricing";
import {
  getMaxSafeInputTokens,
  getModelContextLength,
  getModelPricing,
  OPENROUTER_DEFAULT_CONTEXT_LENGTH,
} from "./pricing";

const CHARS_PER_TOKEN_ESTIMATE = 4;

export interface AgentForContextStats {
  systemPrompt: string;
  enabledSkillIds?: string[] | null;
  modelName?: string | null;
}

export interface ComputeContextStatsOptions {
  /** When true, include enabled skills in system prompt length (default true). Use false for list to avoid loading skills. */
  includeSkills?: boolean;
}

export interface ContextStats {
  contextLength: number;
  estimatedSystemPromptTokens: number;
  maxSafeInputTokens: number;
  ratio: number;
  modelName: string;
}

/**
 * Compute context stats for an agent: estimated system prompt tokens,
 * model context length, and ratio for UI gauge.
 */
export async function computeContextStats(
  agent: AgentForContextStats,
  options: ComputeContextStatsOptions = {}
): Promise<ContextStats> {
  const { includeSkills = true } = options;
  const effectiveModelName =
    agent.modelName && agent.modelName.trim() !== ""
      ? agent.modelName
      : getDefaultModel();

  const contextLength =
    getModelContextLength("openrouter", effectiveModelName) ??
    OPENROUTER_DEFAULT_CONTEXT_LENGTH;

  let totalChars: number;
  if (includeSkills && agent.enabledSkillIds?.length) {
    const fullPrompt = await buildSystemPromptWithSkills(
      agent.systemPrompt,
      agent.enabledSkillIds
    );
    totalChars = fullPrompt.length;
  } else {
    totalChars = agent.systemPrompt.length;
  }

  const estimatedSystemPromptTokens = Math.ceil(
    totalChars / CHARS_PER_TOKEN_ESTIMATE
  );
  const maxSafeInputTokens = getMaxSafeInputTokens(
    "openrouter",
    effectiveModelName
  );
  const ratio =
    contextLength > 0
      ? Math.min(1, estimatedSystemPromptTokens / contextLength)
      : 0;

  return {
    contextLength,
    estimatedSystemPromptTokens,
    maxSafeInputTokens,
    ratio,
    modelName: effectiveModelName,
  };
}

export interface ModelInfoForResponse {
  modelName: string;
  contextLength: number;
  pricing?: CurrencyPricing;
  capabilities?: ModelCapabilities;
}

/**
 * Get model info for API response: context length, pricing, capabilities.
 */
export function getModelInfoForResponse(
  modelName: string | null | undefined
): ModelInfoForResponse {
  const effectiveModelName =
    modelName && modelName.trim() !== "" ? modelName : getDefaultModel();

  const pricing = getModelPricing("openrouter", effectiveModelName);
  const contextLength =
    pricing?.context_length ??
    getModelContextLength("openrouter", effectiveModelName) ??
    OPENROUTER_DEFAULT_CONTEXT_LENGTH;

  return {
    modelName: effectiveModelName,
    contextLength,
    pricing: pricing?.usd,
    capabilities: pricing?.capabilities,
  };
}
