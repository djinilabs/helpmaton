import { randomUUID } from "crypto";

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { enqueueWebhookTask } from "../../utils/webhookQueue";
import { validateSubscriptionAndLimits } from "../utils/generationRequestTracking";
import { validateWebhookRequest, validateWebhookKey } from "../utils/requestValidation";

export async function handleWebhookRequest(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const { workspaceId, agentId, key, bodyText } =
    validateWebhookRequest(event);
  await validateWebhookKey(workspaceId, agentId, key);
  const subscriptionId = await validateSubscriptionAndLimits(
    workspaceId,
    "webhook"
  );

  const conversationId = randomUUID();

  await enqueueWebhookTask(
    workspaceId,
    agentId,
    bodyText,
    conversationId,
    subscriptionId
  );

  return {
    statusCode: 202,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      conversationId,
    }),
  };
}
