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

/**
 * Estimated tokens per injected knowledge snippet (documents + memory).
 * Matches document splitter default chunk size (documentSearch.ts DEFAULT_CHUNK_SIZE = 1000 chars)
 * so the context gauge uses the same average snippet size as document indexing.
 */
const ESTIMATED_TOKENS_PER_KNOWLEDGE_SNIPPET = Math.ceil(
  1000 / CHARS_PER_TOKEN_ESTIMATE,
); // 250

export interface AgentForContextStats {
  systemPrompt: string;
  enabledSkillIds?: string[] | null;
  modelName?: string | null;
  enableKnowledgeInjection?: boolean;
  knowledgeInjectionSnippetCount?: number | null;
}

export interface ComputeContextStatsOptions {
  /** When true, include enabled skills in system prompt length (default true). Use false for list to avoid loading skills. */
  includeSkills?: boolean;
}

export interface ContextStats {
  contextLength: number;
  estimatedSystemPromptTokens: number;
  /** Instructions only (system prompt, no skills). For segmented UI. */
  estimatedInstructionsTokens: number;
  /** Skills content only. For segmented UI. */
  estimatedSkillsTokens: number;
  /** Estimated tokens for injected knowledge (snippet count × estimate per snippet). 0 when knowledge injection disabled. */
  estimatedKnowledgeTokens: number;
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

  const instructionsChars = agent.systemPrompt.length;
  const estimatedInstructionsTokens = Math.ceil(
    instructionsChars / CHARS_PER_TOKEN_ESTIMATE
  );

  let estimatedSkillsTokens: number;
  let totalChars: number;
  if (includeSkills && agent.enabledSkillIds?.length) {
    const fullPrompt = await buildSystemPromptWithSkills(
      agent.systemPrompt,
      agent.enabledSkillIds
    );
    totalChars = fullPrompt.length;
    estimatedSkillsTokens = Math.max(
      0,
      Math.ceil(
        (fullPrompt.length - instructionsChars) / CHARS_PER_TOKEN_ESTIMATE
      )
    );
  } else {
    totalChars = instructionsChars;
    estimatedSkillsTokens = 0;
  }

  const estimatedSystemPromptTokens = Math.ceil(
    totalChars / CHARS_PER_TOKEN_ESTIMATE
  );
  // Ensure instructions + skills sum exactly to estimatedSystemPromptTokens (avoid separate ceils causing sum > total)
  estimatedSkillsTokens = Math.max(
    0,
    estimatedSystemPromptTokens - estimatedInstructionsTokens
  );

  const estimatedKnowledgeTokens = agent.enableKnowledgeInjection
    ? (agent.knowledgeInjectionSnippetCount ?? 5) *
      ESTIMATED_TOKENS_PER_KNOWLEDGE_SNIPPET
    : 0;

  const totalEstimatedInputTokens =
    estimatedSystemPromptTokens + estimatedKnowledgeTokens;
  const maxSafeInputTokens = getMaxSafeInputTokens(
    "openrouter",
    effectiveModelName
  );
  const ratio =
    contextLength > 0
      ? Math.min(1, totalEstimatedInputTokens / contextLength)
      : 0;

  return {
    contextLength,
    estimatedSystemPromptTokens,
    estimatedInstructionsTokens,
    estimatedSkillsTokens,
    estimatedKnowledgeTokens,
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
