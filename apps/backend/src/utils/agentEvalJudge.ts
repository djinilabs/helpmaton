/**
 * Shared helpers for agent eval judge create/update.
 * Used by POST /api/.../eval-judges, PUT /api/.../eval-judges/:judgeId, and meta-agent tools.
 */

export function buildAgentEvalJudgePk(
  workspaceId: string,
  agentId: string,
  judgeId: string
): string {
  return `agent-eval-judges/${workspaceId}/${agentId}/${judgeId}`;
}

/** Params for creating a new eval judge (from createEvalJudgeSchema or tool args). */
export type CreateEvalJudgeParams = {
  name: string;
  enabled?: boolean;
  samplingProbability?: number;
  provider?: "openrouter";
  modelName: string;
  evalPrompt: string;
};

/**
 * Builds the full record to create for a new agent eval judge.
 * Shared by POST /api/.../eval-judges and meta-agent create_my_eval_judge tool.
 */
export function buildEvalJudgeRecordForCreate(
  workspaceId: string,
  agentId: string,
  judgeId: string,
  params: CreateEvalJudgeParams
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    pk: buildAgentEvalJudgePk(workspaceId, agentId, judgeId),
    sk: "judge",
    workspaceId,
    agentId,
    judgeId,
    name: params.name,
    enabled: params.enabled ?? true,
    samplingProbability: params.samplingProbability ?? 100,
    provider: (params.provider ?? "openrouter") as "openrouter",
    modelName: params.modelName,
    evalPrompt: params.evalPrompt,
    version: 1,
    createdAt: now,
  };
}

/** Existing eval judge record (from DB) with fields needed for update. */
export type ExistingEvalJudgeForUpdate = {
  pk: string;
  sk?: string;
  workspaceId: string;
  agentId: string;
  judgeId: string;
  name: string;
  enabled: boolean;
  samplingProbability?: number;
  provider: string;
  modelName: string;
  evalPrompt: string;
  [key: string]: unknown;
};

/** Params for updating an eval judge (from updateEvalJudgeSchema or tool args). */
export type UpdateEvalJudgeParams = {
  name?: string;
  enabled?: boolean;
  samplingProbability?: number;
  provider?: "openrouter";
  modelName?: string;
  evalPrompt?: string;
};

/**
 * Builds the update payload for an existing eval judge (updatedAt + changed fields).
 * Shared by PUT /api/.../eval-judges/:judgeId and meta-agent update_my_eval_judge tool.
 */
export function buildEvalJudgeUpdatePayload(
  existing: ExistingEvalJudgeForUpdate,
  params: UpdateEvalJudgeParams
): Record<string, unknown> {
  const updateData: Record<string, unknown> = {
    ...existing,
    updatedAt: new Date().toISOString(),
  };
  if (params.name !== undefined) updateData.name = params.name;
  if (params.enabled !== undefined) updateData.enabled = params.enabled;
  if (params.samplingProbability !== undefined) {
    updateData.samplingProbability = params.samplingProbability;
  }
  if (params.provider !== undefined) updateData.provider = params.provider;
  if (params.modelName !== undefined) updateData.modelName = params.modelName;
  if (params.evalPrompt !== undefined) updateData.evalPrompt = params.evalPrompt;
  return updateData;
}
