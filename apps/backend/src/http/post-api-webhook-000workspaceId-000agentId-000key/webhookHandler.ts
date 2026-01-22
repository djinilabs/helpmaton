import { randomUUID } from "crypto";

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { database } from "../../tables";
import { InsufficientCreditsError } from "../../utils/creditErrors";
import { enqueueWebhookTask } from "../../utils/webhookQueue";
import { validateSubscriptionAndLimits } from "../utils/generationRequestTracking";
import { validateWebhookRequest, validateWebhookKey } from "../utils/requestValidation";

export async function handleWebhookRequest(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const { workspaceId, agentId, key, bodyText } =
    validateWebhookRequest(event);
  await validateWebhookKey(workspaceId, agentId, key);
  await validateSubscriptionAndLimits(workspaceId, "webhook");

  const db = await database();
  const workspace = await db.workspace.get(`workspaces/${workspaceId}`, "workspace");
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }
  if (workspace.creditBalance <= 0) {
    return new InsufficientCreditsError(
      workspaceId,
      1,
      workspace.creditBalance,
      "usd"
    ).toHTTPResponse();
  }

  const conversationId = randomUUID();

  await enqueueWebhookTask(workspaceId, agentId, bodyText, conversationId);

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
