import { database } from "../../tables";

import type { Provider } from "./modelFactory";

/**
 * Get workspace API key if it exists for OpenRouter
 * Only OpenRouter keys are supported for BYOK (Bring Your Own Key)
 * BYOK is only available for paid plans (Starter and Pro)
 */
export async function getWorkspaceApiKey(
  workspaceId: string,
  provider: Provider = "openrouter"
): Promise<string | null> {
  if (provider !== "openrouter") {
    return null;
  }

  const db = await database();
  const sk = "key";
  const pk = `workspace-api-keys/${workspaceId}/openrouter`;

  try {
    const workspaceKey = await db["workspace-api-key"].get(pk, sk);
    if (workspaceKey?.key) {
      const { getWorkspaceSubscription } = await import(
        "../../utils/subscriptionUtils"
      );
      const subscription = await getWorkspaceSubscription(workspaceId);
      if (!subscription || subscription.plan === "free") {
        return null;
      }
      return workspaceKey.key;
    }
  } catch {
    // Key doesn't exist
  }

  return null;
}
