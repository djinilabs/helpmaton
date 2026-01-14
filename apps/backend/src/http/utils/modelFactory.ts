import { badRequest } from "@hapi/boom";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

import { getPostHogClient } from "../../utils/posthog";
import { getModelPricing, loadPricingConfig } from "../../utils/pricing";

export type Provider = "openrouter";

/**
 * Agent configuration options for model creation
 */
export interface AgentModelConfig {
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
  maxOutputTokens?: number | null;
  stopSequences?: string[] | null;
  [key: string]: unknown;
}

/**
 * Parse OpenRouter model name to extract actual provider and model
 * @param modelName - OpenRouter model identifier (e.g., "google/gemini-2.5-flash", "openai/gpt-4")
 * @returns Object with provider and model, or null provider for edge cases
 */
function parseOpenRouterModel(modelName: string): {
  provider: string | null;
  model: string;
} {
  // Handle "auto" selection
  if (modelName === "auto") {
    return { provider: "openrouter", model: "auto" };
  }

  // Check if model name contains provider prefix (format: "provider/model-name")
  const parts = modelName.split("/");
  if (parts.length === 2) {
    return {
      provider: parts[0], // e.g., "google", "openai", "mistralai"
      model: parts[1], // e.g., "gemini-2.5-flash", "gpt-5.2"
    };
  }

  // No provider prefix found - use openrouter as provider and full name as model
  return { provider: "openrouter", model: modelName };
}

/**
 * Get system API key for OpenRouter from environment variables
 */
function getSystemApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error(
      "[modelFactory] OPENROUTER_API_KEY is not set in environment variables"
    );
    console.error(
      "[modelFactory] Available env vars:",
      Object.keys(process.env)
        .filter(
          (k) =>
            k.includes("OPENROUTER") || k.includes("API") || k.includes("KEY")
        )
        .join(", ")
    );
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  // Log first few characters for debugging (without exposing full key)
  console.log(
    "[modelFactory] Using OPENROUTER_API_KEY:",
    apiKey.substring(0, 8) + "..."
  );
  return apiKey;
}

/**
 * Get default model name for OpenRouter from pricing config
 * Ensures we only use models that exist in pricing.json
 */
export function getDefaultModel(): string {
  const pricingConfig = loadPricingConfig();
  const providerPricing = pricingConfig.providers.openrouter;

  if (!providerPricing) {
    throw new Error("No pricing found for provider: openrouter");
  }

  // Sort models for deterministic selection
  const models = Object.keys(providerPricing.models).sort();
  if (models.length === 0) {
    throw new Error(
      "No models found in pricing config for provider: openrouter"
    );
  }

  // For OpenRouter, prefer common models
  const defaultPatterns = [
    (p: string) => p === "google/gemini-2.5-flash",
    (p: string) => p === "auto",
    (p: string) => p.includes("gemini-2.5"),
    (p: string) => p.includes("claude-3.5"),
  ];

  for (const pattern of defaultPatterns) {
    const match = models.find(pattern);
    if (match) {
      return match;
    }
  }

  // Fall back to first model if no pattern matches
  return models[0];
}

/**
 * Create a model instance for OpenRouter
 * @param modelName - The model name (optional, defaults to OpenRouter's default)
 * @param workspaceId - Workspace ID to check for workspace API key
 * @param referer - Referer header (kept for compatibility, not used for OpenRouter)
 * @param userId - User ID for PostHog tracking (optional)
 * @param agentConfig - Agent configuration with advanced options (temperature, topP, etc.)
 * @returns Model instance
 */
export async function createModel(
  provider: Provider,
  modelName: string | undefined,
  workspaceId?: string,
  referer: string = process.env.DEFAULT_REFERER ||
    "http://localhost:3000/api/webhook",
  userId?: string,
  agentConfig?: AgentModelConfig
) {
  // Only OpenRouter is supported
  if (provider !== "openrouter") {
    throw badRequest(
      `Provider "${provider}" is not supported. Only "openrouter" is supported.`
    );
  }

  // For OpenRouter, handle auto-selection
  const isAutoSelection = modelName === "auto" || modelName === undefined;
  const finalModelName = isAutoSelection
    ? "auto"
    : modelName || getDefaultModel();

  // Validate that pricing exists for this model (skip for auto-selection)
  if (!isAutoSelection) {
    const pricing = getModelPricing("openrouter", finalModelName);
    if (!pricing) {
      throw badRequest(
        `No pricing found for model "${finalModelName}". ` +
          `Please ensure the model is available in the pricing configuration.`
      );
    }
  }

  // Try to get workspace API key first, fall back to system key
  // Lazy import to avoid pulling in documentSearch dependencies when not needed
  let apiKey: string;
  let usesByok = false;
  if (workspaceId) {
    const { getWorkspaceApiKey } = await import("./agentUtils");
    const workspaceKey = await getWorkspaceApiKey(workspaceId, "openrouter");
    usesByok = workspaceKey !== null;
    if (workspaceKey) {
      console.log(
        "[modelFactory] Using workspace API key (BYOK) for workspace:",
        workspaceId
      );
      apiKey = workspaceKey;
    } else {
      console.log(
        "[modelFactory] No workspace API key found, using system key for workspace:",
        workspaceId
      );
      apiKey = getSystemApiKey();
    }
  } else {
    console.log("[modelFactory] No workspaceId provided, using system key");
    apiKey = getSystemApiKey();
  }

  const openrouter = createOpenRouter({
    apiKey,
  });

  // For auto-selection, use "auto" as the model name
  // For specific models, use openrouter.chat('provider/model-name')
  const modelNameToUse = isAutoSelection ? "auto" : finalModelName;

  // Build model settings from agent config
  // Note: temperature, topP, etc. are typically passed to generateText/streamText,
  // but we include them here for model-level configuration if the provider supports it
  const modelSettings: Record<string, unknown> = {
    reasoning: {
      effort: "high",
      enabled: true,
    },
    usage: {
      include: true,
    },
    // Enable image generation modality (in addition to text)
    // This allows models that support image generation to generate images
    // Models that don't support it will ignore this and only generate text
    // Pass modalities via extraBody to merge into the request body at the top level
    extraBody: {
      modalities: ["image", "text"],
    },
  };

  // Apply agent config advanced options if provided
  // These will be applied at the model level and may also be used in generateText calls
  if (agentConfig) {
    // Temperature (0-2)
    if (
      agentConfig.temperature !== undefined &&
      agentConfig.temperature !== null
    ) {
      modelSettings.temperature = agentConfig.temperature;
    }

    // Top-p (0-1)
    if (agentConfig.topP !== undefined && agentConfig.topP !== null) {
      modelSettings.topP = agentConfig.topP;
    }

    // Top-k (positive integer)
    if (agentConfig.topK !== undefined && agentConfig.topK !== null) {
      modelSettings.topK = agentConfig.topK;
    }

    // Max tokens (positive integer)
    if (
      agentConfig.maxOutputTokens !== undefined &&
      agentConfig.maxOutputTokens !== null
    ) {
      modelSettings.maxTokens = agentConfig.maxOutputTokens;
    }

    // Stop sequences (array of strings)
    if (
      agentConfig.stopSequences !== undefined &&
      agentConfig.stopSequences !== null &&
      agentConfig.stopSequences.length > 0
    ) {
      modelSettings.stop = agentConfig.stopSequences;
    }
  }

  // Enable attachments support (OpenRouter supports file attachments by default)
  // The model will automatically handle file attachments in messages
  const model = openrouter.chat(
    modelNameToUse,
    modelSettings as Parameters<typeof openrouter.chat>[1]
  );

  // Wrap with PostHog tracking if available
  const phClient = getPostHogClient();
  if (phClient) {
    // Dynamically import withTracing to avoid loading Anthropic SDK wrappers
    // when we're not using them (lazy loading)
    const { withTracing } = await import("@posthog/ai");
    // Prefix distinct ID to distinguish between user, workspace, and system
    let distinctId: string;
    if (userId) {
      distinctId = `user/${userId}`;
    } else if (workspaceId) {
      distinctId = `workspace/${workspaceId}`;
    } else {
      distinctId = "system";
    }
    // Parse OpenRouter model name to extract actual provider and model
    const { provider: actualProvider, model: actualModel } =
      parseOpenRouterModel(finalModelName);
    return withTracing(model, phClient, {
      posthogDistinctId: distinctId,
      posthogProperties: {
        provider: actualProvider || "openrouter",
        modelName: actualModel,
        workspaceId: workspaceId || undefined,
        userId: userId || undefined,
        referer,
        usesByok,
      },
      posthogGroups: workspaceId ? { workspace: workspaceId } : undefined,
    });
  }

  return model;
}
