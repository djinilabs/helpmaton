import type { DatabaseSchema } from "../tables";
import type { WorkspaceRecord } from "../tables/schema";

import { toNanoDollars } from "./creditConversions";
import { trackEvent } from "./tracking";

/** Initial credits in USD granted to every new workspace. */
export const INITIAL_WORKSPACE_CREDITS_USD = 2;

/** PostHog event name for workspace creation. Single place for this event (sent from here). */
export const WORKSPACE_CREATED_EVENT = "workspace_created";

function idFromRef(ref: string, prefix: string): string {
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
}

export type CreateWorkspaceRecordParams = {
  pk: string;
  sk: string;
  name: string;
  description?: string;
  createdBy: string;
  subscriptionId: string;
  currency?: "usd";
  spendingLimits?: WorkspaceRecord["spendingLimits"];
  creationNotes?: string;
};

/**
 * Creates a workspace record in the database. This is the single place where
 * workspace rows are created and the only place that sends the `workspace_created`
 * PostHog event. Every new workspace is credited with 2 USD.
 *
 * Expects `pk` in the form `workspaces/{id}` and `createdBy` as `users/{id}` for
 * correct analytics attribution.
 */
export async function createWorkspaceRecord(
  db: DatabaseSchema,
  params: CreateWorkspaceRecordParams
): Promise<WorkspaceRecord> {
  const initialCredits = toNanoDollars(INITIAL_WORKSPACE_CREDITS_USD);
  const workspace = await db.workspace.create({
    pk: params.pk,
    sk: params.sk,
    name: params.name,
    description: params.description,
    createdBy: params.createdBy,
    subscriptionId: params.subscriptionId,
    currency: params.currency ?? "usd",
    creditBalance: initialCredits,
    spendingLimits: params.spendingLimits,
    creationNotes: params.creationNotes,
  });

  const workspaceId = idFromRef(params.pk, "workspaces/");
  const userId = idFromRef(params.createdBy, "users/");
  try {
    trackEvent(WORKSPACE_CREATED_EVENT, {
      workspace_id: workspaceId,
      user_id: userId,
    });
  } catch (err) {
    // Best-effort: do not block workspace creation on tracking failure
    console.warn("[workspaceCreate] Failed to send workspace_created event:", err);
  }

  return workspace as WorkspaceRecord;
}
