import type { APIGatewayProxyResultV2 } from "aws-lambda";

import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import { loadPricingConfig, type CurrencyPricing } from "../../utils/pricing";

/**
 * @openapi
 * /api/pricing:
 *   get:
 *     summary: Get OpenRouter model pricing
 *     description: Returns pricing information for all available OpenRouter AI models
 *     tags:
 *       - Usage
 *     responses:
 *       200:
 *         description: OpenRouter model pricing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 openrouter:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       input:
 *                         type: number
 *                         description: Price per 1M input tokens (USD)
 *                       output:
 *                         type: number
 *                         description: Price per 1M output tokens (USD)
 *                       cachedInput:
 *                         type: number
 *                         description: Price per 1M cached input tokens (USD, optional)
 *                       tiers:
 *                         type: array
 *                         description: Tiered pricing structure (optional)
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const handler = adaptHttpHandler(
  handlingErrors(async (): Promise<APIGatewayProxyResultV2> => {
    const pricingConfig = loadPricingConfig();

    // Extract OpenRouter pricing
    const openrouterPricing: Record<string, CurrencyPricing> = {};

    const provider = "openrouter" as const;
    const providerPricing = pricingConfig.providers[provider];
    if (providerPricing) {
      // Get all models from pricing config
      const models = Object.keys(providerPricing.models).sort();
      for (const modelName of models) {
        const modelPricing = providerPricing.models[modelName];
        if (modelPricing?.usd) {
          // Return the currency pricing structure directly
          openrouterPricing[modelName] = modelPricing.usd;
        }
      }
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        openrouter: openrouterPricing,
      }),
    };
  })
);

