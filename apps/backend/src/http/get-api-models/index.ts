import type { APIGatewayProxyResultV2 } from "aws-lambda";

import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import { loadPricingConfig } from "../../utils/pricing";
import { getDefaultModel } from "../utils/modelFactory";

/**
 * @openapi
 * /api/models:
 *   get:
 *     summary: Get available models
 *     description: Returns a list of available OpenRouter AI models and their default model, including re-ranking models from pricing.json
 *     tags:
 *       - Usage
 *     responses:
 *       200:
 *         description: Available OpenRouter models
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ModelsResponse'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const handler = adaptHttpHandler(
  handlingErrors(async (): Promise<APIGatewayProxyResultV2> => {
    const pricingConfig = loadPricingConfig();

    // Extract available models from pricing config (OpenRouter only)
    const availableModels: Record<
      string,
      { models: string[]; defaultModel: string }
    > = {};

    // Only include OpenRouter provider
    const provider = "openrouter" as const;
    const providerPricing = pricingConfig.providers[provider];
    if (providerPricing) {
      // Get all models from pricing config - includes all models regardless of pricing values
      // Re-ranking models are now included in pricing.json, so no need to fetch from OpenRouter API
      const allModels = Object.keys(providerPricing.models).sort();

      if (allModels.length > 0) {
        // Use shared utility function to get default model
        const defaultModel = getDefaultModel(provider);

        availableModels[provider] = {
          models: allModels,
          defaultModel,
        };
      }
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(availableModels),
    };
  })
);
