import type { APIGatewayProxyResultV2 } from "aws-lambda";

import { database } from "../../tables/database";
import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import { initSentry } from "../../utils/sentry";

initSentry();

const HEALTHCHECK_BUCKET_PK =
  "request-buckets/healthcheck/llm/1970-01-01T00:00:00.000Z";

/**
 * @openapi
 * /api/health:
 *   get:
 *     summary: Health check
 *     description: Verifies API and database connectivity
 *     tags:
 *       - Usage
 *     responses:
 *       200:
 *         description: Health check result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 dbOk:
 *                   type: boolean
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const handler = adaptHttpHandler(
  handlingErrors(async (): Promise<APIGatewayProxyResultV2> => {
    const db = await database();
    await db["request-buckets"].get(HEALTHCHECK_BUCKET_PK);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({
        ok: true,
        dbOk: true,
      }),
    };
  })
);
