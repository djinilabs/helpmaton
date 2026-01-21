import type { ModelCapabilities } from "../../utils/pricing";
import { getModelPricing } from "../../utils/pricing";

import type { GenerateTextOptions } from "./agent-model";

type ModelSettings = {
  reasoning?: unknown;
  usage?: unknown;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  stop?: string[];
};

const PARAMETER_KEY_MAP: Record<keyof Omit<ModelSettings, "reasoning" | "usage">, string> =
  {
    temperature: "temperature",
    topP: "top_p",
    topK: "top_k",
    maxTokens: "max_tokens",
    stop: "stop",
  };

const REASONING_PARAMETERS = new Set(["reasoning", "include_reasoning"]);

export function resolveModelCapabilities(
  provider: string,
  modelName?: string
): ModelCapabilities | undefined {
  if (!modelName) {
    return undefined;
  }
  const pricing = getModelPricing(provider, modelName);
  return pricing?.capabilities;
}

/**
 * Check if a model capability supports a parameter name.
 * Missing capabilities are treated as unsupported.
 */
export function supportsParameter(
  capabilities: ModelCapabilities | undefined,
  parameter: string
): boolean {
  if (!capabilities?.supported_parameters) {
    return false;
  }
  return capabilities.supported_parameters.includes(parameter);
}

/**
 * Determine whether reasoning parameters are supported.
 * Missing capabilities are treated as unsupported.
 */
export function supportsReasoning(
  capabilities: ModelCapabilities | undefined
): boolean {
  if (!capabilities?.supported_parameters) {
    return false;
  }
  return capabilities.supported_parameters.some((param) =>
    REASONING_PARAMETERS.has(param)
  );
}

/**
 * Determine whether tool calling is supported.
 * Missing capabilities are treated as unsupported.
 */
export function supportsToolCalling(
  capabilities: ModelCapabilities | undefined
): boolean {
  return capabilities?.tool_calling === true;
}

/**
 * Filter model-level settings to only include supported parameters.
 * Reasoning and tool settings are dropped when unsupported or unknown.
 */
export function filterModelSettingsForCapabilities(
  modelSettings: ModelSettings,
  capabilities: ModelCapabilities | undefined
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};

  if (modelSettings.usage !== undefined) {
    filtered.usage = modelSettings.usage;
  }

  if (modelSettings.reasoning !== undefined && supportsReasoning(capabilities)) {
    filtered.reasoning = modelSettings.reasoning;
  }

  (Object.keys(PARAMETER_KEY_MAP) as Array<keyof typeof PARAMETER_KEY_MAP>).forEach(
    (settingKey) => {
      const parameterKey = PARAMETER_KEY_MAP[settingKey];
      const value = modelSettings[settingKey];
      if (value !== undefined && supportsParameter(capabilities, parameterKey)) {
        filtered[settingKey] = value;
      }
    }
  );

  return filtered;
}

/**
 * Filter generateText options to only include supported parameters.
 * stopWhen is always preserved since it is client-side logic.
 */
export function filterGenerateTextOptionsForCapabilities(
  options: GenerateTextOptions,
  capabilities: ModelCapabilities | undefined
): GenerateTextOptions {
  const filtered: GenerateTextOptions = { ...options };

  if (!supportsParameter(capabilities, "temperature")) {
    delete filtered.temperature;
  }
  if (!supportsParameter(capabilities, "top_p")) {
    delete filtered.topP;
  }
  if (!supportsParameter(capabilities, "top_k")) {
    delete filtered.topK;
  }
  if (!supportsParameter(capabilities, "max_tokens")) {
    delete filtered.maxTokens;
  }
  if (!supportsParameter(capabilities, "stop")) {
    delete filtered.stopSequences;
  }

  return filtered;
}

/**
 * Resolve tools for a model, returning undefined when tool calling is unsupported
 * or when no tools are provided.
 */
export function resolveToolsForCapabilities<T extends Record<string, unknown>>(
  tools: T | undefined,
  capabilities: ModelCapabilities | undefined
): T | undefined {
  if (!tools || Object.keys(tools).length === 0) {
    return undefined;
  }
  if (!supportsToolCalling(capabilities)) {
    return undefined;
  }
  return tools;
}
