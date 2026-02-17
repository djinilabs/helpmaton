import type { DatabaseSchema } from "../tables";
import type { AgentRecord } from "../tables/schema";

import { idFromRef } from "./refUtils";
import { trackEvent } from "./tracking";

/** PostHog event name for agent creation. Single place for this event (sent from here). */
export const AGENT_CREATED_EVENT = "agent_created";

/**
 * Parameters for creating an agent record. This is the single type used by all
 * call sites that create agents (POST /api/workspaces/:workspaceId/agents,
 * workspace import, workspace agent create_agent tool).
 * Omits version and createdAt; the table API sets createdAt on create.
 */
export type CreateAgentRecordParams = Omit<
  AgentRecord,
  "version" | "createdAt"
>;

/**
 * Creates an agent record in the database. This is the single place where
 * agent rows are created and the only place that sends the `agent_created`
 * PostHog event. All callers (REST route, workspace import, workspace agent
 * create_agent tool) must use this function.
 *
 * Expects pk in the form `agents/{workspaceId}/{agentId}` and sk `"agent"`.
 * User attribution uses params.createdBy (users/{id}) when present.
 */
export async function createAgentRecord(
  db: DatabaseSchema,
  params: CreateAgentRecordParams,
): Promise<AgentRecord> {
  const record = await db.agent.create(params);
  const afterPrefix = idFromRef(params.pk, "agents/");
  const parts = afterPrefix.split("/");
  const workspaceId = parts[0];
  const agentId = parts[1];
  const userId = params.createdBy
    ? idFromRef(params.createdBy, "users/")
    : undefined;
  if (workspaceId && agentId) {
    try {
      trackEvent(AGENT_CREATED_EVENT, {
        workspace_id: workspaceId,
        agent_id: agentId,
        user_id: userId,
        provider: record.provider,
        model_name: record.modelName ?? undefined,
      });
    } catch (err) {
      // Best-effort: do not block agent creation on tracking failure
      console.warn("[agentCreate] Failed to send agent_created event:", err);
    }
  }
  return record as AgentRecord;
}
