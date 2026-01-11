import type { APIGatewayProxyResultV2 } from "aws-lambda";

import { getDefined } from "../../utils";
import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import { getRerankingModels } from "../../utils/knowledgeReranking";
import { loadPricingConfig } from "../../utils/pricing";
import { getDefaultModel } from "../utils/modelFactory";

/**
 * @openapi
 * /api/models:
 *   get:
 *     summary: Get available models
 *     description: Returns a list of available OpenRouter AI models and their default model, including re-ranking models fetched from OpenRouter API
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
      const pricingModels = Object.keys(providerPricing.models).sort();
      
      // Fetch re-ranking models from OpenRouter API
      // Re-ranking models are not in pricing config since they use a different API endpoint
      let rerankingModels: string[] = [];
      try {
        const apiKey = getDefined(
          process.env.OPENROUTER_API_KEY,
          "OPENROUTER_API_KEY is not set"
        );
        
        const response = await fetch("https://openrouter.ai/api/v1/models", {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        });

        if (response.ok) {
          const data = (await response.json()) as {
            data?: Array<{ id: string }>;
          };
          
          if (data.data && Array.isArray(data.data)) {
            const allOpenRouterModels = data.data
              .map((model) => model.id)
              .filter((id): id is string => typeof id === "string");
            
            // Filter to only re-ranking models
            rerankingModels = getRerankingModels(allOpenRouterModels);
          }
        } else {
          console.warn(
            "[get-api-models] Failed to fetch re-ranking models from OpenRouter:",
            response.status,
            response.statusText
          );
        }
      } catch (error) {
        // Log but don't fail - re-ranking models are optional
        console.warn(
          "[get-api-models] Error fetching re-ranking models from OpenRouter:",
          error instanceof Error ? error.message : String(error)
        );
      }

      // Combine pricing models with re-ranking models, removing duplicates
      const allModels = Array.from(
        new Set([...pricingModels, ...rerankingModels])
      ).sort();

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
