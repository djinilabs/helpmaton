import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { badRequest } from "@hapi/boom";

import { getDefined } from "../../utils";
import { getPostHogClient } from "../../utils/posthog";
import { getModelPricing, loadPricingConfig } from "../../utils/pricing";

import { getWorkspaceApiKey } from "./agentUtils";

export type Provider = "google";

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
  // Currently only implemented for Google, but designed to be extensible

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
  const finalModelName = modelName || getDefaultModel(provider);

  // Validate that pricing exists for this provider and model
  const pricing = getModelPricing(provider, finalModelName);
  if (!pricing) {
    throw badRequest(
      `No pricing found for provider "${provider}" and model "${finalModelName}". ` +
        `Please ensure the model is available in the pricing configuration.`
    );
  }

  // Try to get workspace API key first, fall back to system key
  let apiKey: string;
  let usesByok = false;
  if (workspaceId) {
    const workspaceKey = await getWorkspaceApiKey(workspaceId, provider);
    usesByok = workspaceKey !== null;
    apiKey = workspaceKey || getSystemApiKey(provider);
  } else {
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
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
