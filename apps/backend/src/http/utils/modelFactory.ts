import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { badRequest } from "@hapi/boom";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

import { getDefined } from "../../utils";
import { getPostHogClient } from "../../utils/posthog";
import { getModelPricing, loadPricingConfig } from "../../utils/pricing";

export type Provider = "google" | "openrouter";

/**
 * Parse OpenRouter model name to extract actual provider and model
 * @param modelName - OpenRouter model identifier (e.g., "google/gemini-2.5-flash", "openai/gpt-5.2")
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
      model: parts[1],     // e.g., "gemini-2.5-flash", "gpt-5.2"
    };
  }

  // No provider prefix found - use openrouter as provider and full name as model
  return { provider: "openrouter", model: modelName };
}

/**
 * Get system API key for a provider from environment variables
 */
function getSystemApiKey(provider: Provider): string {
  switch (provider) {
    case "google":
      return getDefined(
        process.env.GEMINI_API_KEY,
        "GEMINI_API_KEY is not set"
      );
    case "openrouter": {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        console.error("[modelFactory] OPENROUTER_API_KEY is not set in environment variables");
        console.error("[modelFactory] Available env vars:", Object.keys(process.env).filter(k => k.includes("OPENROUTER") || k.includes("API") || k.includes("KEY")).join(", "));
        throw new Error("OPENROUTER_API_KEY is not set");
      }
      // Log first few characters for debugging (without exposing full key)
      console.log("[modelFactory] Using OPENROUTER_API_KEY:", apiKey.substring(0, 8) + "...");
      return apiKey;
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Get default model name for a provider from pricing config
 * Ensures we only use models that exist in pricing.json
 */
export function getDefaultModel(provider: Provider): string {
  const pricingConfig = loadPricingConfig();
  const providerPricing = pricingConfig.providers[provider];

  if (!providerPricing) {
    throw new Error(`No pricing found for provider: ${provider}`);
  }

  // Sort models for deterministic selection
  const models = Object.keys(providerPricing.models).sort();
  if (models.length === 0) {
    throw new Error(
      `No models found in pricing config for provider: ${provider}`
    );
  }

  // Try to find a default model based on explicit priority patterns
  if (provider === "google") {
    const defaultPatterns = [
      (p: string) => p === "gemini-2.5-flash",
      (p: string) => p === "gemini-1.5-flash",
      (p: string) => p.includes("flash") && !p.includes("exp"),
    ];

    for (const pattern of defaultPatterns) {
      const match = models.find(pattern);
      if (match) {
        return match;
      }
    }
  } else if (provider === "openrouter") {
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
  }

  // Fall back to first model if no pattern matches
  return models[0];
}

/**
 * Create a model instance for the specified provider and model
 * @param provider - The provider name (google)
 * @param modelName - The model name (optional, defaults to provider's default)
 * @param workspaceId - Workspace ID to check for workspace API key
 * @param referer - Referer header for Google API
 * @param userId - User ID for PostHog tracking (optional)
 * @returns Model instance
 */
export async function createModel(
  provider: Provider,
  modelName: string | undefined,
  workspaceId?: string,
  referer: string = process.env.DEFAULT_REFERER ||
    "http://localhost:3000/api/webhook",
  userId?: string
) {
  // For OpenRouter, handle auto-selection
  const isAutoSelection = provider === "openrouter" && (modelName === "auto" || modelName === undefined);
  const finalModelName = isAutoSelection ? "auto" : (modelName || getDefaultModel(provider));

  // Validate that pricing exists for this provider and model (skip for auto-selection)
  if (!isAutoSelection) {
    const pricing = getModelPricing(provider, finalModelName);
    if (!pricing) {
      throw badRequest(
        `No pricing found for provider "${provider}" and model "${finalModelName}". ` +
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
    const workspaceKey = await getWorkspaceApiKey(workspaceId, provider);
    usesByok = workspaceKey !== null;
    if (workspaceKey) {
      console.log("[modelFactory] Using workspace API key (BYOK) for workspace:", workspaceId);
      apiKey = workspaceKey;
    } else {
      console.log("[modelFactory] No workspace API key found, using system key for workspace:", workspaceId);
      apiKey = getSystemApiKey(provider);
    }
  } else {
    console.log("[modelFactory] No workspaceId provided, using system key");
    apiKey = getSystemApiKey(provider);
  }

  switch (provider) {
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey,
        headers: {
          Referer: referer,
          "Content-Type": "text/event-stream",
        },
      });
      const model = google(finalModelName);

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
        return withTracing(model, phClient, {
          posthogDistinctId: distinctId,
          posthogProperties: {
            provider: "google",
            modelName: finalModelName,
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
    case "openrouter": {
      const openrouter = createOpenRouter({
        apiKey,
      });

      // For auto-selection, use "auto" as the model name
      // For specific models, use openrouter.chat('provider/model-name')
      const modelNameToUse = isAutoSelection ? "auto" : finalModelName;
      const model = openrouter.chat(modelNameToUse);

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
        const { provider: actualProvider, model: actualModel } = parseOpenRouterModel(finalModelName);
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
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
