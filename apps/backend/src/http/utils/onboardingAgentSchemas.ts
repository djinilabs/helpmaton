import { z } from "zod";

import { workspaceExportSchema } from "../../schemas/workspace-export";

const onboardingContextIntentSchema = z
  .object({
    step: z.literal("intent"),
    intent: z
      .object({
        goal: z.string().optional().describe("Legacy single goal; prefer goals"),
        goals: z.array(z.string()).optional().describe("Selected goal option values (multi-select)"),
        businessType: z.string().optional(),
        tasksOrRoles: z.array(z.string()).optional(),
        freeText: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .strict();

const onboardingContextRefineSchema = z
  .object({
    step: z.literal("refine"),
    template: workspaceExportSchema,
    chatMessage: z.string().min(1),
  })
  .strict();

/**
 * Request body for POST /api/workspaces/onboarding-agent/stream.
 * Discriminated by step: "intent" may omit intent; "refine" requires template and chatMessage.
 */
export const onboardingAgentStreamRequestSchema = z
  .object({
    onboardingContext: z.discriminatedUnion("step", [
      onboardingContextIntentSchema,
      onboardingContextRefineSchema,
    ]),
  })
  .strict();

const onboardingAgentQuestionChoiceSchema = z
  .object({
    id: z.string().describe("Unique id for the question (e.g. businessType, tasks)"),
    label: z.string().describe("Human-readable question text"),
    kind: z.literal("choice"),
    options: z.array(z.string()).min(1).describe("List of options to choose from"),
  })
  .strict();

const onboardingAgentQuestionTextSchema = z
  .object({
    id: z.string().describe("Unique id for the question"),
    label: z.string().describe("Human-readable question text"),
    kind: z.literal("text"),
  })
  .strict();

/**
 * Schema for a single question returned by the onboarding-agent LLM.
 * Discriminated by kind: "choice" requires options; "text" has no options.
 */
export const onboardingAgentQuestionSchema = z.discriminatedUnion("kind", [
  onboardingAgentQuestionChoiceSchema,
  onboardingAgentQuestionTextSchema,
]);

/**
 * Schema for the "questions" response from the onboarding-agent.
 */
export const onboardingAgentQuestionsResponseSchema = z
  .object({
    type: z.literal("questions"),
    questions: z.array(onboardingAgentQuestionSchema).min(1).max(5),
  })
  .strict();

/**
 * Schema for the "template" response from the onboarding-agent.
 * Template must pass workspaceExportSchema before being sent to the client.
 */
export const onboardingAgentTemplateResponseSchema = z
  .object({
    type: z.literal("template"),
    template: workspaceExportSchema,
    summary: z.string().describe("Short human-readable description of the workspace for the UI"),
  })
  .strict();

/**
 * Union of valid onboarding-agent result payloads.
 */
export const onboardingAgentResultSchema = z.discriminatedUnion("type", [
  onboardingAgentQuestionsResponseSchema,
  onboardingAgentTemplateResponseSchema,
]);

export type OnboardingAgentStreamRequest = z.infer<
  typeof onboardingAgentStreamRequestSchema
>;
export type OnboardingAgentQuestion = z.infer<typeof onboardingAgentQuestionSchema>;
export type OnboardingAgentQuestionsResponse = z.infer<typeof onboardingAgentQuestionsResponseSchema>;
export type OnboardingAgentTemplateResponse = z.infer<typeof onboardingAgentTemplateResponseSchema>;
export type OnboardingAgentResult = z.infer<typeof onboardingAgentResultSchema>;
