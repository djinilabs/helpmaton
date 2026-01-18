import { badRequest } from "@hapi/boom";

import type { DatabaseSchema } from "../../tables/schema";

export async function requireAgentInWorkspace(
  db: DatabaseSchema,
  workspaceId: string,
  agentId: string
): Promise<void> {
  const agentPk = `agents/${workspaceId}/${agentId}`;
  const agent = await db.agent.get(agentPk, "agent");
  if (!agent) {
    throw badRequest("Agent not found");
  }
  if (agent.workspaceId !== workspaceId) {
    throw badRequest("Agent does not belong to this workspace");
  }
}
