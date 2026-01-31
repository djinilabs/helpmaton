import type { AvailableModels, ModelCapabilities } from "./api";
import { getAvailableModels } from "./api";

export type Provider = "google" | "openrouter";

export interface ModelConfig {
  provider: Provider;
  models: string[];
  defaultModel: string;
  displayName: string;
  capabilities?: Record<string, ModelCapabilities>;
}

const PROVIDER_DISPLAY_NAMES: Record<Provider, string> = {
  google: "Google",
  openrouter: "OpenRouter",
};

// Cache for available models
let cachedModels: AvailableModels | null = null;
let modelsPromise: Promise<AvailableModels> | null = null;

/**
 * Fetch available models from the API
 * Uses caching to avoid multiple requests
 */
export async function fetchAvailableModels(): Promise<AvailableModels> {
  // Validate cached models structure - if it doesn't have required providers, clear cache
  if (cachedModels) {
    if (
      !cachedModels.openrouter ||
      !cachedModels.openrouter.models ||
      !Array.isArray(cachedModels.openrouter.models)
    ) {
      console.warn(
        "[modelConfig] Cached models structure invalid, clearing cache"
      );
      cachedModels = null;
      modelsPromise = null;
    } else {
      return cachedModels;
    }
  }

  if (modelsPromise) {
    return modelsPromise;
  }

  // Create promise and assign immediately to prevent race conditions
  modelsPromise = getAvailableModels()
    .then((models) => {
      // Validate the response structure - now requires OpenRouter
      if (
        !models.openrouter ||
        !models.openrouter.models ||
        !Array.isArray(models.openrouter.models)
      ) {
        console.error(
          "[modelConfig] Invalid models response structure:",
          models
        );
        throw new Error("Invalid models response structure");
      }
      if (
        models.openrouter.imageModels !== undefined &&
        !Array.isArray(models.openrouter.imageModels)
      ) {
        console.error(
          "[modelConfig] Invalid models response structure (imageModels):",
          models
        );
        throw new Error("Invalid models response structure");
      }
      // Google is optional (for backward compatibility), so we don't validate it here
      cachedModels = models;
      return models;
    })
    .catch((error) => {
      // Clear promise and cache synchronously before throwing to allow retries
      // This ensures that subsequent calls after a failure can retry instead of
      // awaiting the same failed promise
      modelsPromise = null;
      cachedModels = null;
      throw error;
    });

  return modelsPromise;
}

/**
 * Clear the models cache (useful for testing or after updates)
 */
export function clearModelsCache(): void {
  cachedModels = null;
  modelsPromise = null;
}

/**
 * Get provider config from available models
 */
export async function getProviderConfig(
  provider: Provider
): Promise<ModelConfig | undefined> {
  const availableModels = await fetchAvailableModels();
  const providerData = availableModels[provider];

  if (!providerData) {
    return undefined;
  }

  const capabilities =
    "capabilities" in providerData ? providerData.capabilities : undefined;

  return {
    provider,
    models: providerData.models,
    defaultModel: providerData.defaultModel,
    displayName: PROVIDER_DISPLAY_NAMES[provider],
    ...(capabilities ? { capabilities } : {}),
  };
}

/**
 * Get models for a provider
 */
export async function getModelsForProvider(
  provider: Provider
): Promise<string[]> {
  const config = await getProviderConfig(provider);
  return config?.models || [];
}

export async function getImageModelsForProvider(
  provider: Provider
): Promise<string[]> {
  const availableModels = await fetchAvailableModels();
  const providerData = availableModels[provider];
  if (!providerData) {
    return [];
  }
  return providerData.imageModels || [];
}

/**
 * Get default model for a provider
 */
export async function getDefaultModelForProvider(
  provider: Provider
): Promise<string> {
  const config = await getProviderConfig(provider);
  return config?.defaultModel || "";
}

/**
 * Get capabilities map for a provider
 */
export async function getCapabilitiesForProvider(
  provider: Provider
): Promise<Record<string, ModelCapabilities> | undefined> {
  const config = await getProviderConfig(provider);
  return config?.capabilities;
}

/**
 * Filter models to only those with a required capability
 */
export function filterModelsByCapability(
  models: string[],
  capabilities: Record<string, ModelCapabilities> | undefined,
  requiredCapability: keyof ModelCapabilities
): string[] {
  if (!capabilities) {
    return [];
  }

  return models.filter(
    (model) => capabilities[model]?.[requiredCapability] === true
  );
}

export function filterTextGenerationModels(
  models: string[],
  capabilities: Record<string, ModelCapabilities> | undefined
): string[] {
  if (!capabilities) {
    return [];
  }

  return models.filter((model) => {
    const modelCapabilities = capabilities[model];
    return (
      modelCapabilities?.text_generation === true &&
      modelCapabilities?.embeddings !== true
    );
  });
}

/**
 * Resolve a default model after filtering
 */
export function resolveDefaultModel(
  models: string[],
  defaultModel: string
): string {
  if (defaultModel && models.includes(defaultModel)) {
    return defaultModel;
  }
  return models[0] || "";
}

/**
 * Get capabilities for a specific model
 */
export function getModelCapabilities(
  capabilities: Record<string, ModelCapabilities> | undefined,
  modelName: string | null | undefined
): ModelCapabilities | undefined {
  if (!capabilities || !modelName) {
    return undefined;
  }
  return capabilities[modelName];
}

const BOOLEAN_CAPABILITY_KEYS: Array<keyof ModelCapabilities> = [
  "text_generation",
  "image_generation",
  "embeddings",
  "rerank",
  "tool_calling",
  "structured_output",
];

export function getCapabilityLabels(
  capabilities: ModelCapabilities | undefined
): string[] {
  if (!capabilities) {
    return [];
  }

  return BOOLEAN_CAPABILITY_KEYS.filter(
    (key) => capabilities[key] === true
  ).map((key) => String(key));
}

/**
 * Get all provider configs (OpenRouter, and Google if available)
 */
export async function getProviderConfigs(): Promise<ModelConfig[]> {
  const availableModels = await fetchAvailableModels();
  const providers: Provider[] = ["google", "openrouter"];

  return providers
    .map((provider) => {
      const providerData = availableModels[provider];
      if (!providerData) {
        return null;
      }
      const capabilities =
        "capabilities" in providerData ? providerData.capabilities : undefined;
      return {
        provider,
        models: providerData.models,
        defaultModel: providerData.defaultModel,
        displayName: PROVIDER_DISPLAY_NAMES[provider],
        ...(capabilities ? { capabilities } : {}),
      };
    })
    .filter((config): config is ModelConfig => config !== null);
}

/**
 * Filter available OpenRouter models to find re-ranking models
 * Re-ranking models are identified by containing "rerank" in their name (case-insensitive)
 * @param availableModels - Array of available model names from OpenRouter
 * @returns Array of model names that are suitable for re-ranking
 */
export function getRerankingModels(availableModels: string[]): string[] {
  return availableModels.filter((model) => {
    const lowerModel = model.toLowerCase();
    return lowerModel.includes("rerank");
  });
}
