import type { GenerationEndpoint } from "./generationErrorHandling";
import {
  trackSuccessfulRequest,
  validateSubscriptionAndLimits,
} from "./generationRequestTracking";

export async function executeWithRequestLimits<T>(options: {
  workspaceId: string;
  agentId: string;
  endpoint: GenerationEndpoint;
  execute: () => Promise<T>;
  shouldTrack?: (result: T) => boolean;
}): Promise<T> {
  const { workspaceId, agentId, endpoint, execute, shouldTrack } = options;
  const subscriptionId = await validateSubscriptionAndLimits(
    workspaceId,
    endpoint
  );
  const result = await execute();
  const track = shouldTrack ? shouldTrack(result) : true;
  if (track) {
    await trackSuccessfulRequest(subscriptionId, workspaceId, agentId, endpoint);
  }
  return result;
}
