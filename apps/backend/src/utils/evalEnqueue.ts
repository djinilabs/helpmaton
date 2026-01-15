import { queues } from "@architect/functions";

/**
 * Enqueue evaluation tasks for all enabled judges for a conversation
 */
export async function enqueueEvaluations(
  workspaceId: string,
  agentId: string,
  conversationId: string
): Promise<void> {
  // Lazy import to avoid pulling in database dependencies when not needed
  const { database } = await import("../tables");

  const db = await database();

  // Query all enabled judges for this agent using queryAsync for memory efficiency
  const judges: Array<{ judgeId: string; name: string }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const judge of (db as any)["agent-eval-judge"].queryAsync({
    IndexName: "byAgentId",
    KeyConditionExpression: "agentId = :agentId",
    FilterExpression: "#enabled = :enabled",
    ExpressionAttributeNames: {
      "#enabled": "enabled",
    },
    ExpressionAttributeValues: {
      ":agentId": agentId,
      ":enabled": true,
    },
  })) {
    judges.push({
      judgeId: judge.judgeId,
      name: judge.name,
    });
  }

  if (judges.length === 0) {
    console.log("[Eval Enqueue] No enabled judges found for agent:", {
      workspaceId,
      agentId,
      conversationId,
    });
    return;
  }

  // Enqueue evaluation task for each judge
  const enqueuePromises = judges.map(async (judge: {
    judgeId: string;
    name: string;
  }) => {
    const message = {
      workspaceId,
      agentId,
      conversationId,
      judgeId: judge.judgeId,
    };

    try {
      await queues.publish({
        name: "agent-eval-queue",
        payload: message,
      });

      console.log("[Eval Enqueue] Enqueued evaluation task:", {
        workspaceId,
        agentId,
        conversationId,
        judgeId: judge.judgeId,
        judgeName: judge.name,
      });
    } catch (error) {
      console.error("[Eval Enqueue] Failed to enqueue evaluation task:", {
        error: error instanceof Error ? error.message : String(error),
        workspaceId,
        agentId,
        conversationId,
        judgeId: judge.judgeId,
      });
      // Don't throw - we want to continue enqueueing other judges even if one fails
    }
  });

  await Promise.allSettled(enqueuePromises);

  console.log("[Eval Enqueue] Completed enqueueing evaluations:", {
    workspaceId,
    agentId,
    conversationId,
    judgeCount: judges.length,
  });
}
