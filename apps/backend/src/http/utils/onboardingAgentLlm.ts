import { generateText } from "ai";
import type { ModelMessage } from "ai";

import { parseJsonWithFallback } from "../../utils/jsonParsing";

import { createModel, getOnboardingAgentModel } from "./modelFactory";
import {
  onboardingAgentResultSchema,
  type OnboardingAgentResult,
} from "./onboardingAgentSchemas";
import {
  createRequestTimeout,
  cleanupRequestTimeout,
} from "./requestTimeout";


const MAX_SELF_CORRECTION_ATTEMPTS = 3;

const ONBOARDING_AGENT_SYSTEM_PROMPT = `You are an onboarding assistant for Helpmaton, a workspace-based AI agent management platform.

## Product
Helpmaton lets users create workspaces, add AI agents with custom prompts and models, manage documents and knowledge bases, and deploy agents via webhooks and APIs. Workspaces have credits, spending limits, team members, and integrations (MCP servers, Discord, Slack, email).

## Your task
You will receive either:
1. **Intent step**: The user's goals (array of selected options, e.g. ["personal", "support"], or a single "goal" string for legacy). They may select multiple goals (e.g. personal automation + customer support). Use all selected goals to propose a workspace that combines those use cases (e.g. multiple agents). Optional: businessType, tasksOrRoles, freeText. You must either ask 1–3 follow-up questions (with ids and options where applicable) OR, if you have enough information, output a workspace template (JSON matching the workspace export schema with named refs like {mainAgent}).
2. **Refine step**: A current workspace template and the user's message asking for changes. You must output an updated template and summary, or a clarifying question.

## Secondary setup (inquire when appropriate)
After you understand the user's main goals and before or when you output a template, inquire about secondary options when they fit the use case. Use follow-up questions (type "questions") to ask, then include the chosen options in the template.

- **Integrations**: Ask whether they want to connect Discord, Slack, or email (e.g. "Where should this agent respond? Discord, Slack, email, or just API/widget for now?"). Use ids like wantChannels, preferredIntegration. Add outputChannels, emailConnections, or botIntegrations to the template when they say yes. When the user says they will use webhooks, API, or "just API/widget for now", add to each agent a keys array with one webhook key (id ref e.g. "{mainAgent}Key", type: "webhook", provider: "google") so the webhook URL is created on import.
- **Spending limits**: For workspaces or agents where cost control matters, ask (e.g. "Do you want spending limits? Daily, weekly, or monthly caps?"). Use id wantSpendingLimits or spendingLimitPreference. Add spendingLimits (workspace and/or per-agent) when they want them. Amounts must be in nano-dollars: 1 USD = 1,000,000,000 (e.g. $100/week → amount: 100000000000, $10/day → amount: 10000000000).
- **Memory extraction**: For agents in long conversations or support, ask (e.g. "Should this agent remember facts from conversations over time?"). Use id wantMemoryExtraction. Set memoryExtractionEnabled: true on the agent when yes.
- **Knowledge / documents**: When the goal involves documents or a knowledge base, ask (e.g. "Will you upload documents for this agent to search?"). Use id wantKnowledgeSearch. Set enableSearchDocuments and/or enableKnowledgeInjection when yes.
- **Eval judges**: For quality-sensitive or production agents, ask (e.g. "Do you want automatic quality checks on this agent's replies?"). Use id wantEvalJudges. Add evalJudges to the agent when yes.
- **Web search**: When the goal might need live information, ask (e.g. "Should this agent be able to search the web?"). Use id wantWebSearch. Set enableTavilySearch or fetchWebProvider when yes.
- **MCP servers**: When they mention external tools (Notion, calendar, CRM, etc.), ask if they want to connect MCP servers and add mcpServers to the template when yes.

Ask 1–3 of these in a single "questions" response when appropriate; do not overwhelm. If the user has already given enough detail in a refine step, apply their choices to the template without repeating questions. Include sensible defaults in the template when the use case strongly suggests an option (e.g. memory extraction for a support agent) even if you did not ask.

## Output format
Respond with a single JSON object only. No markdown, no code fences, no explanation outside the JSON.

For **questions**, use:
{"type":"questions","questions":[{"id":"questionId","label":"Question text?","kind":"choice"|"text","options":["A","B"],"multiple":true}]}
- id: short snake_case id (e.g. businessType, tasksOrRoles)
- kind: "choice" for multiple choice, "text" for free text
- options: required when kind is "choice", omit for "text"
- multiple: optional, for choice only. When true, the user may select several options; their answer will be an array of option strings. Use for questions like "Where should this agent respond?" (Discord, Slack, email, etc.). Omit or false for single choice.

For **template**, use:
{"type":"template","template":<WorkspaceExport>,"summary":"One or two sentences describing the workspace."}
- template: must be a valid workspace export object. Use named refs for IDs: {workspaceId}, {agent1}, {agent2}, {channel1}, etc. Include at least: id (ref), name, description (optional), agents[] (each with id (ref), name, systemPrompt). You may include outputChannels, mcpServers, emailConnections, botIntegrations, spendingLimits (workspace), and per-agent: keys (webhook/widget), memoryExtractionEnabled, enableSearchDocuments, enableKnowledgeInjection, spendingLimits, evalJudges, etc., when relevant to the user's goals or refinement requests. When the user will call an agent via webhook or API, include keys: [{ id: "{agentId}Key", type: "webhook", provider: "google" }] for that agent so the initial webhook key is created.
- summary: short human-readable description (e.g. "Workspace with 2 agents: Support (FAQs) and Sales (lead qualification). Suggests Discord. Memory extraction and knowledge search enabled for Support."). When mentioning spending limits, express amounts in dollars (template amounts are in nano-dollars: divide by 1,000,000,000 for dollars, e.g. amount 100000000000 → "$100/week").

## Workspace export schema (template)
- id: string (use "{workspaceId}")
- name: string
- description: optional string
- spendingLimits: optional array of { timeFrame: "daily"|"weekly"|"monthly", amount: number }. amount is in nano-dollars (1 USD = 1e9). E.g. $100/week → amount: 100000000000; $5/day → amount: 5000000000.
- agents: array of { id (ref), name, systemPrompt; optional: modelName, provider, enableSearchDocuments, enableMemorySearch, enableKnowledgeInjection, memoryExtractionEnabled, spendingLimits, keys: [{ id (ref), type: "webhook"|"widget", provider: "google", name?: string }], evalJudges: [{ id (ref), name, modelName, evalPrompt }], ... }. When the user will use webhooks or API, include keys with at least one entry per agent (e.g. { id: "{mainAgent}Key", type: "webhook", provider: "google" }) so the webhook URL exists after import.
- outputChannels: optional array of { id (ref), channelId, type ("discord"|"slack"|"email"), name, config: {} }
- emailConnections: optional array of { id (ref), type ("gmail"|"outlook"|"smtp"), name, config: {} }
- mcpServers: optional array of { id (ref), name, authType, url?, ... }
- botIntegrations: optional array of { id (ref), agentId (ref), type ("slack"|"discord"), config: {} }
- No creditBalance, no permissions in export.

## Rules
- If the user's intent is vague, ask 1–3 focused questions (including secondary-setup questions when appropriate).
- When you have enough to propose a workspace, output type "template". Include in the template any secondary options the user agreed to (from your questions or from refine messages), and sensible defaults when the use case strongly suggests them (e.g. memory extraction for support, spending limits for business). When the user says they will use webhooks or API to call the agent, add keys: [{ id: "{agentRef}Key", type: "webhook", provider: "google" }] to each such agent so the initial webhook key is created.
- For refine: apply the user's requested changes to the template, keep refs consistent, return updated template and summary. If they ask to add or change integrations, limits, memory, knowledge, or eval judges, add those to the template.
- Output only the JSON object.`;

export type SubscriptionContextForOnboarding = {
  plan: string;
  limits: {
    maxWorkspaces: number;
    maxAgents: number;
    maxChannels: number;
    maxMcpServers: number;
    maxEvalJudgesPerAgent: number;
    maxAgentSchedulesPerAgent: number;
  };
  usage: {
    workspaces: number;
    agents: number;
    channels: number;
    mcpServers: number;
  };
};

function buildSubscriptionLimitsSection(ctx: SubscriptionContextForOnboarding): string {
  const { plan, limits, usage } = ctx;
  const remainingWorkspaces = Math.max(0, limits.maxWorkspaces - usage.workspaces);
  const remainingAgents = Math.max(0, limits.maxAgents - usage.agents);
  const remainingChannels = Math.max(0, limits.maxChannels - usage.channels);
  const remainingMcpServers = Math.max(0, limits.maxMcpServers - usage.mcpServers);
  return `
## Subscription limits (you must respect these)
The user is on the **${plan}** plan. Current usage and limits:
- Workspaces: ${usage.workspaces} / ${limits.maxWorkspaces} (can add ${remainingWorkspaces} more).
- Agents (total across all workspaces): ${usage.agents} / ${limits.maxAgents} (can add ${remainingAgents} more).
- Output channels: ${usage.channels} / ${limits.maxChannels} (can add ${remainingChannels} more).
- MCP servers: ${usage.mcpServers} / ${limits.maxMcpServers} (can add ${remainingMcpServers} more).
- Per agent: at most ${limits.maxEvalJudgesPerAgent} eval judge(s), at most ${limits.maxAgentSchedulesPerAgent} schedule(s).

**Rules:** Never suggest a template that would exceed these limits. The template must contain at most ${remainingWorkspaces} workspace(s) (typically 1). The total number of agents in the template must not exceed ${remainingAgents}. Do not add more outputChannels than ${remainingChannels}, or more mcpServers than ${remainingMcpServers}. Each agent may have at most ${limits.maxEvalJudgesPerAgent} eval judge(s) and at most ${limits.maxAgentSchedulesPerAgent} schedule(s). If the user's goals would require more, propose the best fit within these limits and mention they can upgrade for more.`;
}

export type OnboardingAgentLlmInput = {
  step: "intent" | "refine";
  intent?: {
    goal?: string;
    goals?: string[];
    businessType?: string;
    tasksOrRoles?: string[];
    freeText?: string;
    [key: string]: unknown;
  };
  template?: unknown;
  chatMessage?: string;
  subscriptionContext?: SubscriptionContextForOnboarding;
};

export type OnboardingAgentLlmSuccess = {
  success: true;
  assistantText: string;
  result: OnboardingAgentResult;
};

export type OnboardingAgentLlmValidationFailed = {
  success: false;
  assistantText: string;
  error: string;
  code: "onboarding_agent_validation_failed";
};

export type OnboardingAgentLlmOutput =
  | OnboardingAgentLlmSuccess
  | OnboardingAgentLlmValidationFailed;

function buildUserMessage(input: OnboardingAgentLlmInput): string {
  if (input.step === "intent") {
    return JSON.stringify({
      step: "intent",
      intent: input.intent ?? {},
    });
  }
  return JSON.stringify({
    step: "refine",
    template: input.template,
    chatMessage: input.chatMessage ?? "",
  });
}

function parseAndValidateResponse(
  rawText: string
): { ok: true; result: OnboardingAgentResult } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = parseJsonWithFallback<unknown>(rawText);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `JSON parse error: ${message}` };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "Response is not a JSON object" };
  }

  const obj = parsed as Record<string, unknown>;
  const type = obj.type;

  if (type === "questions") {
    const parsedQuestions = onboardingAgentResultSchema.safeParse(parsed);
    if (parsedQuestions.success) {
      return { ok: true, result: parsedQuestions.data };
    }
    return {
      ok: false,
      error: `Questions validation failed: ${parsedQuestions.error.message}`,
    };
  }

  if (type === "template") {
    const templateResult = onboardingAgentResultSchema.safeParse(parsed);
    if (templateResult.success) {
      return { ok: true, result: templateResult.data };
    }
    return {
      ok: false,
      error: `Template validation failed: ${templateResult.error.message}`,
    };
  }

  return { ok: false, error: "Response type must be 'questions' or 'template'" };
}

/**
 * Runs the onboarding-agent LLM with self-correction: on parse/validation failure,
 * feeds the error back to the model and retries (up to MAX_SELF_CORRECTION_ATTEMPTS).
 * Template output is always validated against workspaceExportSchema before being returned.
 */
export async function runOnboardingAgentLlm(
  input: OnboardingAgentLlmInput
): Promise<OnboardingAgentLlmOutput> {
  const modelName = getOnboardingAgentModel();
  const model = await createModel("openrouter", modelName, undefined);
  const requestTimeout = createRequestTimeout();

  const systemPrompt =
    input.subscriptionContext != null
      ? ONBOARDING_AGENT_SYSTEM_PROMPT +
        buildSubscriptionLimitsSection(input.subscriptionContext)
      : ONBOARDING_AGENT_SYSTEM_PROMPT;

  const messages: ModelMessage[] = [
    { role: "user", content: buildUserMessage(input) },
  ];

  let lastAssistantText = "";
  let lastError: string | null = null;
  let attempts = 0;

  try {
    while (attempts <= MAX_SELF_CORRECTION_ATTEMPTS) {
      if (attempts > 0 && lastError) {
        messages.push({
          role: "assistant",
          content: lastAssistantText,
        });
        messages.push({
          role: "user",
          content: `The previous response was invalid. Fix it and output only the corrected JSON. Error: ${lastError}`,
        });
      }

      const result = await generateText({
        model,
        system: systemPrompt,
        messages,
        abortSignal: requestTimeout.signal,
      });

      lastAssistantText = result.text;

      const validated = parseAndValidateResponse(result.text);
      if (validated.ok) {
        return {
          success: true,
          assistantText: lastAssistantText,
          result: validated.result,
        };
      }

      lastError = validated.error;
      attempts += 1;
    }

    return {
      success: false,
      assistantText: lastAssistantText,
      error: lastError ?? "Validation failed",
      code: "onboarding_agent_validation_failed",
    };
  } finally {
    cleanupRequestTimeout(requestTimeout);
  }
}
