import type { APIGatewayProxyResultV2 } from "aws-lambda";

import packageJson from "../../../../../package.json";
import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import { initSentry } from "../../utils/sentry";

initSentry();

/**
 * @openapi
 * /api/version:
 *   get:
 *     summary: Get current product version
 *     description: Returns the current product version of the frontend bundle
 *     tags:
 *       - Usage
 *     responses:
 *       200:
 *         description: Current product version
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 version:
 *                   type: string
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const handler = adaptHttpHandler(
  handlingErrors(async (): Promise<APIGatewayProxyResultV2> => {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({
        version: packageJson.version || "0.0.0",
      }),
    };
  })
);
