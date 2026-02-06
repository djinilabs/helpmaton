import { badRequest, resourceGone } from "@hapi/boom";
import { generateText } from "ai";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import {
  checkPromptGenerationLimit,
  incrementPromptGenerationBucketSafe,
} from "../../../utils/requestTracking";
import { Sentry, ensureError } from "../../../utils/sentry";
import { trackBusinessEvent } from "../../../utils/tracking";
import { getContextFromRequestId } from "../../../utils/workspaceCreditContext";
import { getWorkspaceApiKey } from "../../utils/agentUtils";
import { validateBody } from "../../utils/bodyValidation";
import {
  adjustCreditsAfterLLMCall,
  cleanupReservationOnError,
  cleanupReservationWithoutTokenUsage,
  enqueueCostVerificationIfNeeded,
  validateAndReserveCredits,
} from "../../utils/generationCreditManagement";
import { extractTokenUsageAndCosts } from "../../utils/generationTokenExtraction";
import { createModel, getDefaultModel } from "../../utils/modelFactory";
import {
  createRequestTimeout,
  cleanupRequestTimeout,
} from "../../utils/requestTimeout";
import { improvePromptFromEvalsRequestSchema } from "../../utils/schemas/requestSchemas";
import { extractUserId } from "../../utils/session";
import { requireWorkspaceContext } from "../../utils/workspaceContext";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

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
const ENDPOINT = "improve-prompt-from-evals" as const;

export const registerPostImprovePromptFromEvals = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/agents/:agentId/improve-prompt-from-evals",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    asyncHandler(async (req, res) => {
      const body = validateBody(req.body, improvePromptFromEvalsRequestSchema);
      const { userPrompt, modelName, selectedEvaluations } = body;

      const { workspaceId } = requireWorkspaceContext(req);
      const agentId = req.params.agentId;

      const awsRequestIdRaw =
        req.headers["x-amzn-requestid"] ||
        req.headers["X-Amzn-Requestid"] ||
        req.headers["x-request-id"] ||
        req.headers["X-Request-Id"] ||
        req.apiGateway?.event?.requestContext?.requestId;
      const awsRequestId = Array.isArray(awsRequestIdRaw)
        ? awsRequestIdRaw[0]
        : awsRequestIdRaw;
      const context = getContextFromRequestId(awsRequestId);
      if (
        !context ||
        typeof context.addWorkspaceCreditTransaction !== "function"
      ) {
        const err = new Error(
          "Context not properly configured for credits. requestId=" +
            String(awsRequestId ?? "undefined")
        );
        console.error("[improve-prompt-from-evals]", err.message, {
          path: req.path,
          workspaceId,
          agentId,
          hasApiGatewayEvent: Boolean(req.apiGateway?.event),
        });
        Sentry.captureException(ensureError(err), {
          tags: {
            handler: "improve-prompt-from-evals",
            requestId: String(awsRequestId ?? "undefined"),
          },
          contexts: {
            request: {
              path: req.path,
              method: req.method,
              hasApiGatewayEvent: Boolean(req.apiGateway?.event),
            },
          },
        });
        throw err;
      }

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

      const workspaceKey = await getWorkspaceApiKey(workspaceId, "openrouter");
      const usesByok = workspaceKey !== null;
      const finalModelName = modelName ?? getDefaultModel();

      const userMessageContent = buildUserMessage({
        userPrompt,
        currentSystemPrompt,
        evaluations,
      });
      const modelMessages = [{ role: "user" as const, content: userMessageContent }];

      const reservationId = await validateAndReserveCredits(
        db,
        workspaceId,
        agentId,
        "openrouter",
        finalModelName,
        modelMessages,
        IMPROVE_PROMPT_SYSTEM_PROMPT,
        undefined,
        usesByok,
        ENDPOINT,
        context,
        undefined
      );

      const userId = extractUserId(req);
      const model = await createModel(
        "openrouter",
        finalModelName,
        workspaceId,
        "http://localhost:3000/api/improve-agent-prompt",
        userId
      );

      const requestTimeout = createRequestTimeout();
      let result: Awaited<ReturnType<typeof generateText>>;
      try {
        result = await generateText({
          model: model as unknown as Parameters<
            typeof generateText
          >[0]["model"],
          system: IMPROVE_PROMPT_SYSTEM_PROMPT,
          messages: modelMessages,
          abortSignal: requestTimeout.signal,
        });
      } catch (error) {
        if (
          reservationId &&
          reservationId !== "byok" &&
          context
        ) {
          await cleanupReservationOnError(
            db,
            reservationId,
            workspaceId,
            agentId,
            "openrouter",
            finalModelName,
            error,
            true,
            usesByok,
            ENDPOINT,
            context
          );
        }
        throw error;
      } finally {
        cleanupRequestTimeout(requestTimeout);
      }

      const extractionResult = extractTokenUsageAndCosts(
        result,
        undefined,
        finalModelName,
        ENDPOINT
      );
      const tokenUsage = extractionResult.tokenUsage;

      if (context && reservationId) {
        const dbWithAtomic = db as Parameters<
          typeof adjustCreditsAfterLLMCall
        >[0];
        await adjustCreditsAfterLLMCall(
          dbWithAtomic,
          workspaceId,
          agentId,
          reservationId,
          "openrouter",
          finalModelName,
          tokenUsage,
          usesByok,
          extractionResult.openrouterGenerationId,
          extractionResult.openrouterGenerationIds,
          ENDPOINT,
          context,
          undefined
        );
      }

      const hasGenerationIds =
        extractionResult.openrouterGenerationIds.length > 0 ||
        Boolean(extractionResult.openrouterGenerationId);
      if (
        reservationId &&
        reservationId !== "byok" &&
        (!tokenUsage ||
          (tokenUsage.promptTokens === 0 &&
            tokenUsage.completionTokens === 0)) &&
        !hasGenerationIds
      ) {
        await cleanupReservationWithoutTokenUsage(
          db,
          reservationId,
          workspaceId,
          agentId,
          ENDPOINT
        );
      } else if (
        reservationId &&
        reservationId !== "byok" &&
        (!tokenUsage ||
          (tokenUsage.promptTokens === 0 &&
            tokenUsage.completionTokens === 0)) &&
        hasGenerationIds
      ) {
        console.warn(
          "[improve-prompt-from-evals] No token usage available, keeping reservation for verification",
          { workspaceId, agentId, reservationId }
        );
      }

      await enqueueCostVerificationIfNeeded(
        extractionResult.openrouterGenerationId,
        extractionResult.openrouterGenerationIds,
        workspaceId,
        reservationId,
        undefined,
        agentId,
        ENDPOINT
      );

      await incrementPromptGenerationBucketSafe(workspaceId);

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
    })
  );
};
