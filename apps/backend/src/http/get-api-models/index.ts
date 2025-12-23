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
 *     description: Returns a list of available AI models and their default model for each provider
 *     tags:
 *       - Usage
 *     responses:
 *       200:
 *         description: Available models
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

    // Extract available models from pricing config (Google and OpenRouter)
    const availableModels: Record<
      string,
      { models: string[]; defaultModel: string }
    > = {};

    // Include both Google and OpenRouter providers
    const providers: Array<"google" | "openrouter"> = ["google", "openrouter"];
    for (const provider of providers) {
      const providerPricing = pricingConfig.providers[provider];
      if (providerPricing) {
        const models = Object.keys(providerPricing.models);
        if (models.length > 0) {
          // Use shared utility function to get default model
          const defaultModel = getDefaultModel(provider);

          availableModels[provider] = {
            models,
            defaultModel,
          };
        }
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
