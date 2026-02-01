import { badRequest, resourceGone, unauthorized } from "@hapi/boom";
import { generateText } from "ai";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import {
  checkPromptGenerationLimit,
  incrementPromptGenerationBucket,
} from "../../../utils/requestTracking";
import { trackBusinessEvent } from "../../../utils/tracking";
import { validateBody } from "../../utils/bodyValidation";
import { createModel } from "../../utils/modelFactory";
import {
  createRequestTimeout,
  cleanupRequestTimeout,
} from "../../utils/requestTimeout";
import { improvePromptFromEvalsRequestSchema } from "../../utils/schemas/requestSchemas";
import { extractUserId } from "../../utils/session";
import { handleError, requireAuth, requirePermission } from "../middleware";

const IMPROVE_PROMPT_SYSTEM_PROMPT = `You are an expert at improving AI agent system prompts using evaluation feedback.

Your task is to produce a revised system prompt based on:
1. The current system prompt
2. The user's improvement instructions
3. The selected evaluation results

Guidelines:
- Preserve important constraints and safety requirements from the current system prompt.
- Focus on actionable, clear instructions.
- Incorporate improvements suggested by the evaluation summaries and scores.
- Do not mention the evaluation results directly in the final prompt.
- Return ONLY the updated system prompt text with no extra commentary.`;

type SelectedEvaluationRef = {
  conversationId: string;
  judgeId: string;
};

type EvalPayload = {
  conversationId: string;
  judgeId: string;
  evaluatedAt?: string;
  status?: "completed" | "failed";
  summary: string;
  scoreGoalCompletion: number | null;
  scoreToolEfficiency: number | null;
  scoreFaithfulness: number | null;
  criticalFailureDetected: boolean;
};

const requireWorkspaceContext = (req: express.Request) => {
  if (!req.workspaceResource) {
    throw badRequest("Workspace resource not found");
  }
  if (!req.userRef) {
    throw unauthorized();
  }
  return { workspaceId: req.params.workspaceId };
};

const loadAgentPrompt = async (params: {
  db: Awaited<ReturnType<typeof database>>;
  workspaceId: string;
  agentId: string;
}): Promise<string> => {
  const { db, workspaceId, agentId } = params;
  const agentPk = `agents/${workspaceId}/${agentId}`;
  const agent = await db.agent.get(agentPk, "agent");
  if (!agent) {
    throw resourceGone("Agent not found");
  }
  if (agent.workspaceId !== workspaceId) {
    throw badRequest("Agent does not belong to this workspace");
  }
  return agent.systemPrompt;
};

const loadEvalResults = async (params: {
  db: Awaited<ReturnType<typeof database>>;
  workspaceId: string;
  agentId: string;
  selectedEvaluations: SelectedEvaluationRef[];
}): Promise<EvalPayload[]> => {
  const { db, workspaceId, agentId, selectedEvaluations } = params;
  const results: EvalPayload[] = [];

  for (const evaluation of selectedEvaluations) {
    const evalPk = `agent-eval-results/${workspaceId}/${agentId}/${evaluation.conversationId}/${evaluation.judgeId}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const record = await (db as any)["agent-eval-result"].get(evalPk, "result");
    if (!record) {
      throw badRequest(
        `Evaluation result not found for conversation ${evaluation.conversationId} and judge ${evaluation.judgeId}`
      );
    }

    results.push({
      conversationId: evaluation.conversationId,
      judgeId: evaluation.judgeId,
      evaluatedAt: record.evaluatedAt,
      status: record.status ?? "completed",
      summary: record.summary ?? "",
      scoreGoalCompletion:
        typeof record.scoreGoalCompletion === "number"
          ? record.scoreGoalCompletion
          : null,
      scoreToolEfficiency:
        typeof record.scoreToolEfficiency === "number"
          ? record.scoreToolEfficiency
          : null,
      scoreFaithfulness:
        typeof record.scoreFaithfulness === "number"
          ? record.scoreFaithfulness
          : null,
      criticalFailureDetected: !!record.criticalFailureDetected,
    });
  }

  return results;
};

const buildUserMessage = (params: {
  userPrompt: string;
  currentSystemPrompt: string;
  evaluations: EvalPayload[];
}): string => {
  return [
    "User improvement instructions:",
    params.userPrompt.trim(),
    "",
    "Current system prompt:",
    params.currentSystemPrompt.trim(),
    "",
    "Selected evaluation results (summary + scores):",
    JSON.stringify(params.evaluations, null, 2),
    "",
    "Return only the revised system prompt text.",
  ].join("\n");
};

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/improve-prompt-from-evals:
 *   post:
 *     summary: Improve an agent system prompt using evaluation results
 *     description: Generates a revised system prompt based on selected evaluation results and user instructions
 *     tags:
 *       - Agents
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: workspaceId
 *         in: path
 *         required: true
 *         description: Workspace ID
 *         schema:
 *           type: string
 *       - name: agentId
 *         in: path
 *         required: true
 *         description: Agent ID
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userPrompt
 *               - selectedEvaluations
 *             properties:
 *               userPrompt:
 *                 type: string
 *               modelName:
 *                 type: string
 *                 nullable: true
 *               selectedEvaluations:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - conversationId
 *                     - judgeId
 *                   properties:
 *                     conversationId:
 *                       type: string
 *                     judgeId:
 *                       type: string
 *     responses:
 *       200:
 *         description: Improved system prompt
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 prompt:
 *                   type: string
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostImprovePromptFromEvals = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/agents/:agentId/improve-prompt-from-evals",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const body = validateBody(req.body, improvePromptFromEvalsRequestSchema);
        const { userPrompt, modelName, selectedEvaluations } = body;

        const { workspaceId } = requireWorkspaceContext(req);
        const agentId = req.params.agentId;

        const db = await database();

        const currentSystemPrompt = await loadAgentPrompt({
          db,
          workspaceId,
          agentId,
        });

        const evaluations = await loadEvalResults({
          db,
          workspaceId,
          agentId,
          selectedEvaluations,
        });

        await checkPromptGenerationLimit(workspaceId);

        const userId = extractUserId(req);
        const model = await createModel(
          "openrouter",
          modelName ?? undefined,
          workspaceId,
          "http://localhost:3000/api/improve-agent-prompt",
          userId
        );

        const requestTimeout = createRequestTimeout();
        try {
          const result = await generateText({
            model: model as unknown as Parameters<
              typeof generateText
            >[0]["model"],
            system: IMPROVE_PROMPT_SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content: buildUserMessage({
                  userPrompt,
                  currentSystemPrompt,
                  evaluations,
                }),
              },
            ],
            abortSignal: requestTimeout.signal,
          });

          await incrementPromptGenerationBucket(workspaceId);

          trackBusinessEvent(
            "agent",
            "prompt_improved_from_evals",
            {
              workspace_id: workspaceId,
              agent_id: agentId,
            },
            req
          );

          res.json({ prompt: result.text.trim() });
        } finally {
          cleanupRequestTimeout(requestTimeout);
        }
      } catch (error) {
        handleError(
          error,
          next,
          "POST /api/workspaces/:workspaceId/agents/:agentId/improve-prompt-from-evals"
        );
      }
    }
  );
};
