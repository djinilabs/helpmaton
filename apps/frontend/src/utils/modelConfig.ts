import type { AvailableModels } from "./api";
import { getAvailableModels } from "./api";

export type Provider = "google" | "openrouter";

export interface ModelConfig {
  provider: Provider;
  models: string[];
  defaultModel: string;
  displayName: string;
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
      !cachedModels.google ||
      !cachedModels.google.models ||
      !Array.isArray(cachedModels.google.models)
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
      // Validate the response structure
      if (
        !models.google ||
        !models.google.models ||
        !Array.isArray(models.google.models)
      ) {
        console.error(
          "[modelConfig] Invalid models response structure:",
          models
        );
        throw new Error("Invalid models response structure");
      }
      // OpenRouter is optional, so we don't validate it here
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

  return {
    provider,
    models: providerData.models,
    defaultModel: providerData.defaultModel,
    displayName: PROVIDER_DISPLAY_NAMES[provider],
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
 * Get all provider configs (Google and OpenRouter)
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
      return {
        provider,
        models: providerData.models,
        defaultModel: providerData.defaultModel,
        displayName: PROVIDER_DISPLAY_NAMES[provider],
      };
    })
    .filter((config): config is ModelConfig => config !== null);
}
