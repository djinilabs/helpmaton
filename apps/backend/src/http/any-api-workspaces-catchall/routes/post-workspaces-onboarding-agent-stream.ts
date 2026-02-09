import { unauthorized } from "@hapi/boom";
import express from "express";

import { getPlanLimits } from "../../../utils/subscriptionPlans";
import {
  getSubscriptionAgents,
  getSubscriptionChannels,
  getSubscriptionMcpServers,
  getSubscriptionWorkspaces,
  getUserSubscription,
} from "../../../utils/subscriptionUtils";
import { validateBody } from "../../utils/bodyValidation";
import { runOnboardingAgentLlm } from "../../utils/onboardingAgentLlm";
import {
  onboardingAgentStreamRequestSchema,
  type OnboardingAgentStreamRequest,
} from "../../utils/onboardingAgentSchemas";
import { handleError, requireAuth } from "../middleware";

const ONBOARDING_AGENT_VALIDATION_FAILED = "onboarding_agent_validation_failed";

/**
 * @openapi
 * /api/workspaces/onboarding-agent/stream:
 *   post:
 *     summary: Onboarding agent stream
 *     description: |
 *       Onboarding-agent flow. Accepts onboardingContext (step intent or refine with template + chatMessage),
 *       runs the LLM with self-correction (up to 3 validation retries), and returns assistantText and
 *       finalEvent (onboarding_agent_result or onboarding_agent_validation_failed). Subscription limits
 *       are passed to the LLM so it respects plan limits.
 *     tags:
 *       - Workspaces
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - onboardingContext
 *             properties:
 *               onboardingContext:
 *                 type: object
 *                 description: Discriminated by step; "intent" may include intent; "refine" requires template and chatMessage
 *                 properties:
 *                   step:
 *                     type: string
 *                     enum: [intent, refine]
 *                   intent:
 *                     type: object
 *                     description: For step intent; goals, businessType, tasksOrRoles, freeText
 *                   template:
 *                     type: object
 *                     description: For step refine; workspace export schema
 *                   chatMessage:
 *                     type: string
 *                     description: For step refine; user message
 *     responses:
 *       200:
 *         description: Streamed or final result with assistantText and finalEvent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 assistantText:
 *                   type: string
 *                 finalEvent:
 *                   type: object
 *                   description: onboarding_agent_result or onboarding_agent_validation_failed
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostWorkspacesOnboardingAgentStream = (
  app: express.Application,
): void => {
  app.post(
    "/api/workspaces/onboarding-agent/stream",
    requireAuth,
    async (req, res, next) => {
      try {
        if (!req.userRef) {
          throw unauthorized();
        }

        const userId = req.userRef.replace("users/", "");
        const subscription = await getUserSubscription(userId);
        const subscriptionId = subscription.pk.replace("subscriptions/", "");
        const limits = getPlanLimits(subscription.plan);
        const workspaces = await getSubscriptionWorkspaces(subscriptionId);
        const agentCount = await getSubscriptionAgents(subscriptionId);
        const channelCount = await getSubscriptionChannels(subscriptionId);
        const mcpServerCount = await getSubscriptionMcpServers(subscriptionId);

        const subscriptionContext = limits
          ? {
              plan: subscription.plan,
              limits: {
                maxWorkspaces: limits.maxWorkspaces,
                maxAgents: limits.maxAgents,
                maxChannels: limits.maxChannels,
                maxMcpServers: limits.maxMcpServers,
                maxEvalJudgesPerAgent: limits.maxEvalJudgesPerAgent,
                maxAgentSchedulesPerAgent: limits.maxAgentSchedulesPerAgent,
              },
              usage: {
                workspaces: workspaces.length,
                agents: agentCount,
                channels: channelCount,
                mcpServers: mcpServerCount,
              },
            }
          : undefined;

        const body = validateBody(
          req.body,
          onboardingAgentStreamRequestSchema,
        ) as OnboardingAgentStreamRequest;

        const ctx = body.onboardingContext;
        const step = ctx.step;
        const intent = ctx.step === "intent" ? ctx.intent : undefined;
        const template = ctx.step === "refine" ? ctx.template : undefined;
        const chatMessage = ctx.step === "refine" ? ctx.chatMessage : undefined;

        const output = await runOnboardingAgentLlm({
          step,
          intent,
          template,
          chatMessage,
          subscriptionContext,
        });

        if (output.success) {
          res.status(200).json({
            assistantText: output.assistantText,
            finalEvent: {
              type: "onboarding_agent_result",
              payload: output.result,
            },
          });
          return;
        }

        // Return 200 so the client can read finalEvent and show recovery (try again / create without guided setup)
        res.status(200).json({
          assistantText: output.assistantText,
          finalEvent: {
            type: ONBOARDING_AGENT_VALIDATION_FAILED,
            error: output.error,
          },
        });
      } catch (error) {
        handleError(
          error,
          next,
          "POST /api/workspaces/onboarding-agent/stream",
        );
      }
    },
  );
};
