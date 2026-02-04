import { unauthorized } from "@hapi/boom";
import express from "express";

import { validateBody } from "../../utils/bodyValidation";
import { runOnboardingAgentLlm } from "../../utils/onboardingAgentLlm";
import {
  onboardingAgentStreamRequestSchema,
  type OnboardingAgentStreamRequest,
} from "../../utils/onboardingAgentSchemas";
import { handleError, requireAuth } from "../middleware";

const ONBOARDING_AGENT_VALIDATION_FAILED = "onboarding_agent_validation_failed";

/**
 * POST /api/workspaces/onboarding-agent/stream
 *
 * Onboarding-agent flow: accepts onboardingContext (step, intent, template, chatMessage),
 * runs the LLM with self-correction (up to 3 validation retries), and returns
 * assistantText + finalEvent (onboarding_agent_result or onboarding_agent_validation_failed).
 * Template output is always validated against workspaceExportSchema before being sent.
 */
export const registerPostWorkspacesOnboardingAgentStream = (
  app: express.Application
): void => {
  app.post(
    "/api/workspaces/onboarding-agent/stream",
    requireAuth,
    async (req, res, next) => {
      try {
        if (!req.userRef) {
          throw unauthorized();
        }

        const body = validateBody(
          req.body,
          onboardingAgentStreamRequestSchema
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
          "POST /api/workspaces/onboarding-agent/stream"
        );
      }
    }
  );
};
