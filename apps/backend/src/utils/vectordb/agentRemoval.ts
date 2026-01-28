import { TEMPORAL_GRAINS } from "./types";
import { purge } from "./writeClient";

/**
 * Remove all vector databases for an agent
 * Schedules purge operations for all temporal grains
 */
export async function removeAgentDatabases(agentId: string): Promise<void> {
  console.log(`[Agent Removal] Scheduling database purge for agent ${agentId}`);

  const errors: Error[] = [];

  for (const temporalGrain of TEMPORAL_GRAINS) {
    try {
      await purge(agentId, temporalGrain);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(
        `[Agent Removal] Failed to schedule purge for grain ${temporalGrain}:`,
        err,
      );
      errors.push(err);
    }
  }

  if (errors.length > 0) {
    console.warn(
      `[Agent Removal] Scheduled purge with ${errors.length} error(s)`,
    );
  } else {
    console.log(
      `[Agent Removal] Successfully scheduled purge for agent ${agentId}`,
    );
  }
}
