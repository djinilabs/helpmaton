/**
 * Meta-agent: tools and setup for configuring a single agent (config mode).
 * Used when the workspace agent delegates via configure_agent or when the user
 * chats with the agent in config mode on the Agent Detail page.
 */

import { randomUUID } from "crypto";

import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import {
  buildEvalJudgeRecordForCreate,
  buildEvalJudgeUpdatePayload,
  type ExistingEvalJudgeForUpdate,
} from "../../utils/agentEvalJudge";
import {
  buildAgentSchedulePk,
  buildScheduleRecordForCreate,
  buildScheduleUpdatePayload,
  type ExistingScheduleForUpdate,
} from "../../utils/agentSchedule";
import {
  ensureAgentEvalJudgeCreationAllowed,
  ensureAgentScheduleCreationAllowed,
} from "../../utils/subscriptionUtils";
import type { AugmentedContext } from "../../utils/workspaceCreditContext";


import { createGetDatetimeTool } from "./agentUtils";
import {
  getInternalDocsPromptSection,
  READ_INTERNAL_DOC_TOOL_DESCRIPTION,
} from "./internalDocsPrompt";
import {
  executeReadInternalDoc,
  type ReadInternalDocState,
} from "./internalDocTool";
import type { LlmObserver } from "./llmObserver";
import { wrapToolsWithObserver } from "./llmObserver";
import {
  createAgentScheduleSchema,
  updateAgentScheduleSchema,
  createEvalJudgeSchema,
  updateEvalJudgeSchema,
} from "./schemas/workspaceSchemas";


/** Agent record shape needed for config tools */
export type AgentRecordForConfig = {
  pk: string;
  workspaceId: string;
  name: string;
  systemPrompt: string;
  modelName?: string | null;
  temperature?: number | null;
  topP?: number | null;
  enableSearchDocuments?: boolean;
  enableMemorySearch?: boolean;
  enableKnowledgeInjection?: boolean;
  enableSendEmail?: boolean;
  searchWebProvider?: string | null;
  fetchWebProvider?: string | null;
  enableExaSearch?: boolean;
  enableImageGeneration?: boolean;
  notificationChannelId?: string | null;
  delegatableAgentIds?: string[];
  enabledMcpServerIds?: string[];
  enabledMcpServerToolNames?: Record<string, string[]>;
  memoryExtractionEnabled?: boolean;
  memoryExtractionModel?: string | null;
  memoryExtractionPrompt?: string | null;
  [key: string]: unknown;
};

const META_AGENT_PRODUCT_AND_CONFIG = `This agent belongs to a Helpmaton workspace. Users deploy agents via webhooks and widgets and configure document search, memory, tools (MCP, email, web search), schedules, eval judges, and delegation.

## What you can configure (use get_my_config first, then the relevant tools)
- **Identity**: name, system prompt, model (modelName, temperature, topP) — update_my_config
- **Document search**: enableSearchDocuments — update_my_config
- **Memory**: enableMemorySearch; memory extraction (memoryExtractionEnabled, model, prompt) — get_my_memory_settings, update_my_memory_settings
- **Knowledge injection**: enableKnowledgeInjection — update_my_config
- **Web search / fetch**: searchWebProvider (tavily/jina), fetchWebProvider (tavily/jina/scrape), enableExaSearch — update_my_config (and get_my_config to see current)
- **Image generation, send email**: enableImageGeneration, enableSendEmail — update_my_config
- **MCP tools**: enabledMcpServerIds (and tool allowlists) — configured in UI; use get_my_config to see current
- **Delegation**: delegatableAgentIds (which agents this one can call via call_agent) — update_my_config
- **Schedules**: list_my_schedules, create_my_schedule, update_my_schedule, delete_my_schedule (cron, prompt, enabled)
- **Eval judges**: list_my_eval_judges, create_my_eval_judge, update_my_eval_judge, delete_my_eval_judge
- **API keys**: list_my_keys (webhook and widget keys)`;

const META_AGENT_SYSTEM_PROMPT_PREFIX = `You are the configuration assistant for this agent. The user can ask you questions about this agent's settings and request changes. Use the provided tools to read and update this agent's configuration. Do not make up data—use get_my_config to see current values before updating.

${META_AGENT_PRODUCT_AND_CONFIG}

## Rules
- Always use get_my_config (or the relevant list/get tool) before updating so you do not suggest what is already set or overwrite blindly.
- If create_my_schedule or create_my_eval_judge returns an error about limits, the workspace subscription caps the number of schedules or eval judges per agent; inform the user and suggest upgrading if they need more.
${getInternalDocsPromptSection()}
`;

/** Sanitize agent name for use in system prompt to avoid breaking quote structure or injecting newlines. */
function sanitizeAgentNameForPrompt(agentName: string): string {
  const noQuotes = agentName.replace(/"/g, '\\"');
  return noQuotes.replace(/[\r\n]+/g, " ").trim();
}

export function getMetaAgentSystemPrompt(agentName: string): string {
  const safeName = sanitizeAgentNameForPrompt(agentName);
  return `${META_AGENT_SYSTEM_PROMPT_PREFIX}\n\nThis agent is named "${safeName}".`;
}

/** Options passed into createAgentConfigTools (e.g. userId for subscription limit checks). */
type CreateAgentConfigToolsOptions = { userId?: string };

/**
 * Creates the meta-agent tool set (get_my_config, update_my_config, get_datetime, etc.)
 */
function createAgentConfigTools(
  workspaceId: string,
  agentId: string,
  agent: AgentRecordForConfig,
  options?: CreateAgentConfigToolsOptions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool types
): Record<string, any> {
  const userId = options?.userId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool types
  const tools: Record<string, any> = {};
  const readInternalDocState: ReadInternalDocState = { callCount: 0 };

  tools.read_internal_doc = tool({
    description: READ_INTERNAL_DOC_TOOL_DESCRIPTION,
    parameters: z.object({ docId: z.string().min(1) }).strict(),
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const { docId } = z.object({ docId: z.string().min(1) }).parse(args);
      return await executeReadInternalDoc(readInternalDocState, docId);
    },
  });

  tools.get_datetime = createGetDatetimeTool();

  tools.get_my_config = tool({
    description:
      "Get the current configuration of this agent: name, system prompt, model, enabled tools (document search, memory, web search, etc.), delegatable agents, and memory settings.",
    parameters: z.object({}).strict(),
    // @ts-expect-error - AI SDK execute signature
    execute: async () => {
      const summary = {
        name: agent.name,
        systemPrompt: agent.systemPrompt,
        modelName: agent.modelName ?? "default",
        temperature: agent.temperature,
        topP: agent.topP,
        enableSearchDocuments: agent.enableSearchDocuments ?? false,
        enableMemorySearch: agent.enableMemorySearch ?? false,
        enableKnowledgeInjection: agent.enableKnowledgeInjection ?? false,
        enableSendEmail: agent.enableSendEmail ?? false,
        searchWebProvider: agent.searchWebProvider ?? null,
        fetchWebProvider: agent.fetchWebProvider ?? null,
        enableExaSearch: agent.enableExaSearch ?? false,
        enableImageGeneration: agent.enableImageGeneration ?? false,
        notificationChannelId: agent.notificationChannelId ?? null,
        delegatableAgentIds: agent.delegatableAgentIds ?? [],
        enabledMcpServerIds: agent.enabledMcpServerIds ?? [],
        memoryExtractionEnabled: agent.memoryExtractionEnabled ?? false,
        memoryExtractionModel: agent.memoryExtractionModel ?? null,
        memoryExtractionPrompt: agent.memoryExtractionPrompt ?? null,
      };
      return JSON.stringify(summary, null, 2);
    },
  });

  const updateMyConfigSchema = z
    .object({
      name: z.string().min(1).optional(),
      systemPrompt: z.string().min(1).optional(),
      modelName: z.string().nullable().optional(),
      temperature: z.number().min(0).max(2).nullable().optional(),
      topP: z.number().min(0).max(1).nullable().optional(),
      enableSearchDocuments: z.boolean().optional(),
      enableMemorySearch: z.boolean().optional(),
      enableKnowledgeInjection: z.boolean().optional(),
      enableSendEmail: z.boolean().optional(),
    })
    .strict();

  tools.update_my_config = tool({
    description:
      "Update this agent's configuration. Pass only the fields you want to change (e.g. name, systemPrompt, modelName, temperature, or feature flags like enableSearchDocuments).",
    parameters: updateMyConfigSchema,
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const parsed = updateMyConfigSchema.parse(args);
      const db = await database();
      const pk = `agents/${workspaceId}/${agentId}`;
      const existing = await db.agent.get(pk, "agent");
      if (!existing) {
        return JSON.stringify({ error: "Agent not found" });
      }
      const temperature =
        parsed.temperature !== undefined
          ? parsed.temperature
          : existing.temperature;
      const topP =
        parsed.topP !== undefined ? parsed.topP : existing.topP;
      const modelNameValue =
        parsed.modelName === undefined
          ? existing.modelName
          : parsed.modelName === null
            ? undefined
            : parsed.modelName;
      const updatePayload = {
        pk,
        sk: "agent" as const,
        name: parsed.name ?? existing.name,
        systemPrompt: parsed.systemPrompt ?? existing.systemPrompt,
        modelName: modelNameValue,
        temperature: temperature ?? undefined,
        topP: topP ?? undefined,
        enableSearchDocuments: parsed.enableSearchDocuments ?? existing.enableSearchDocuments,
        enableMemorySearch: parsed.enableMemorySearch ?? existing.enableMemorySearch,
        enableKnowledgeInjection: parsed.enableKnowledgeInjection ?? existing.enableKnowledgeInjection,
        enableSendEmail: parsed.enableSendEmail ?? existing.enableSendEmail,
        updatedAt: new Date().toISOString(),
      };
      await db.agent.update(
        updatePayload as Parameters<typeof db.agent.update>[0]
      );
      return "Agent configuration updated successfully.";
    },
  });

  tools.list_my_schedules = tool({
    description: "List all schedules configured for this agent.",
    parameters: z.object({}).strict(),
    // @ts-expect-error - AI SDK execute signature
    execute: async () => {
      const db = await database();
      const result = await db["agent-schedule"].query({
        IndexName: "byAgentId",
        KeyConditionExpression: "agentId = :agentId",
        ExpressionAttributeValues: { ":agentId": agentId },
      });
      const schedules = (result.items ?? []).map(
        (s: {
          scheduleId: string;
          name: string;
          cronExpression: string;
          prompt: string;
          enabled: boolean;
          nextRunAt: number;
          lastRunAt?: string;
          createdAt: string;
          updatedAt?: string;
        }) => ({
          id: s.scheduleId,
          name: s.name,
          cronExpression: s.cronExpression,
          prompt: s.prompt,
          enabled: s.enabled,
          nextRunAt: s.nextRunAt,
          lastRunAt: s.lastRunAt ?? null,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt ?? null,
        })
      );
      return JSON.stringify(schedules, null, 2);
    },
  });

  tools.create_my_schedule = tool({
    description:
      "Create a new schedule for this agent. name, cronExpression (UTC cron), prompt (first user message for the run), enabled (default true).",
    parameters: createAgentScheduleSchema,
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const parsed = createAgentScheduleSchema.parse(args);
      if (userId) {
        try {
          await ensureAgentScheduleCreationAllowed(
            workspaceId,
            userId,
            agentId
          );
        } catch (err) {
          const message =
            err && typeof err === "object" && "message" in err
              ? String((err as { message: unknown }).message)
              : "Subscription or schedule limit check failed.";
          return JSON.stringify({ error: message });
        }
      }
      const db = await database();
      const scheduleId = randomUUID();
      const scheduleRecord = buildScheduleRecordForCreate(
        workspaceId,
        agentId,
        scheduleId,
        {
          name: parsed.name,
          cronExpression: parsed.cronExpression,
          prompt: parsed.prompt,
          enabled: parsed.enabled,
        }
      );
      await db["agent-schedule"].create(
        scheduleRecord as Parameters<typeof db["agent-schedule"]["create"]>[0]
      );
      const enabled = parsed.enabled ?? true;
      return JSON.stringify({
        id: scheduleId,
        name: parsed.name,
        cronExpression: parsed.cronExpression,
        prompt: parsed.prompt,
        enabled,
        nextRunAt: (scheduleRecord as { nextRunAt: number }).nextRunAt,
        message: "Schedule created.",
      });
    },
  });

  const updateScheduleSchema = z
    .object({
      scheduleId: z.string().min(1),
      name: z.string().min(1).optional(),
      cronExpression: z.string().min(1).optional(),
      prompt: z.string().min(1).optional(),
      enabled: z.boolean().optional(),
    })
    .strict();
  tools.update_my_schedule = tool({
    description:
      "Update an existing schedule. Pass scheduleId and the fields to change.",
    parameters: updateScheduleSchema,
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const parsed = updateScheduleSchema.parse(args);
      const db = await database();
      const schedulePk = buildAgentSchedulePk(
        workspaceId,
        agentId,
        parsed.scheduleId
      );
      const schedule = await db["agent-schedule"].get(schedulePk, "schedule");
      if (!schedule) {
        return JSON.stringify({ error: "Schedule not found" });
      }
      const body: Record<string, unknown> = {};
      if (parsed.name !== undefined) body.name = parsed.name;
      if (parsed.prompt !== undefined) body.prompt = parsed.prompt;
      if (parsed.cronExpression !== undefined)
        body.cronExpression = parsed.cronExpression;
      if (parsed.enabled !== undefined) body.enabled = parsed.enabled;
      const updatePayload = updateAgentScheduleSchema.parse(body);
      const updateData = buildScheduleUpdatePayload(
        schedule as ExistingScheduleForUpdate,
        updatePayload
      );
      const scheduleTable = db["agent-schedule"];
      await scheduleTable.update(
        updateData as Parameters<typeof scheduleTable.update>[0]
      );
      return "Schedule updated successfully.";
    },
  });

  tools.delete_my_schedule = tool({
    description: "Delete a schedule for this agent.",
    parameters: z.object({ scheduleId: z.string().min(1) }).strict(),
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const { scheduleId } = z
        .object({ scheduleId: z.string().min(1) })
        .strict()
        .parse(args);
      const db = await database();
      const schedulePk = buildAgentSchedulePk(workspaceId, agentId, scheduleId);
      const schedule = await db["agent-schedule"].get(schedulePk, "schedule");
      if (!schedule) {
        return JSON.stringify({ error: "Schedule not found" });
      }
      await db["agent-schedule"].delete(schedulePk, "schedule");
      return "Schedule deleted successfully.";
    },
  });

  tools.list_my_eval_judges = tool({
    description: "List all evaluation judges configured for this agent.",
    parameters: z.object({}).strict(),
    // @ts-expect-error - AI SDK execute signature
    execute: async () => {
      const db = await database();
      const judgesList: Array<{
        id: string;
        name: string;
        enabled: boolean;
        samplingProbability: number;
        provider: string;
        modelName: string;
        evalPrompt: string;
        createdAt: string;
      }> = [];
      const table = (db as unknown as Record<string, { query: (q: {
        IndexName: string;
        KeyConditionExpression: string;
        ExpressionAttributeValues: Record<string, string>;
      }) => Promise<{ items?: unknown[] }> }>)["agent-eval-judge"];
      const result = await table.query({
        IndexName: "byAgentId",
        KeyConditionExpression: "agentId = :agentId",
        ExpressionAttributeValues: { ":agentId": agentId },
      });
      for (const judge of result.items ?? []) {
        const j = judge as {
          judgeId: string;
          name: string;
          enabled: boolean;
          samplingProbability?: number;
          provider: string;
          modelName: string;
          evalPrompt: string;
          createdAt: string;
        };
        judgesList.push({
          id: j.judgeId,
          name: j.name,
          enabled: j.enabled,
          samplingProbability: j.samplingProbability ?? 100,
          provider: j.provider,
          modelName: j.modelName,
          evalPrompt: j.evalPrompt,
          createdAt: j.createdAt,
        });
      }
      return JSON.stringify(judgesList, null, 2);
    },
  });

  tools.create_my_eval_judge = tool({
    description:
      "Create an evaluation judge for this agent. name, modelName, evalPrompt required; enabled, samplingProbability (0-100), provider (openrouter) optional.",
    parameters: createEvalJudgeSchema,
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const parsed = createEvalJudgeSchema.parse(args);
      if (userId) {
        try {
          await ensureAgentEvalJudgeCreationAllowed(
            workspaceId,
            userId,
            agentId
          );
        } catch (err) {
          const message =
            err && typeof err === "object" && "message" in err
              ? String((err as { message: unknown }).message)
              : "Subscription or eval judge limit check failed.";
          return JSON.stringify({ error: message });
        }
      }
      const db = await database();
      const judgeId = randomUUID();
      const judgeRecord = buildEvalJudgeRecordForCreate(
        workspaceId,
        agentId,
        judgeId,
        {
          name: parsed.name,
          enabled: parsed.enabled,
          samplingProbability: parsed.samplingProbability,
          provider: parsed.provider,
          modelName: parsed.modelName,
          evalPrompt: parsed.evalPrompt,
        }
      );
      await (db as unknown as Record<string, { create: (r: unknown) => Promise<unknown> }>)[
        "agent-eval-judge"
      ].create(judgeRecord);
      return JSON.stringify({
        id: judgeId,
        name: parsed.name,
        enabled: parsed.enabled ?? true,
        message: "Eval judge created.",
      });
    },
  });

  const updateJudgeSchema = z
    .object({
      judgeId: z.string().min(1),
      name: z.string().min(1).optional(),
      enabled: z.boolean().optional(),
      samplingProbability: z.number().int().min(0).max(100).optional(),
      provider: z.enum(["openrouter"]).optional(),
      modelName: z.string().min(1).optional(),
      evalPrompt: z.string().min(1).optional(),
    })
    .strict();
  tools.update_my_eval_judge = tool({
    description: "Update an eval judge. Pass judgeId and fields to change.",
    parameters: updateJudgeSchema,
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const parsed = updateJudgeSchema.parse(args);
      const db = await database();
      const judgePk = `agent-eval-judges/${workspaceId}/${agentId}/${parsed.judgeId}`;
      const judge = await (
        db as unknown as Record<string, { get: (pk: string, sk: string) => Promise<unknown> }>
      )["agent-eval-judge"].get(judgePk, "judge");
      if (!judge) {
        return JSON.stringify({ error: "Eval judge not found" });
      }
      const updatePayload = updateEvalJudgeSchema.parse({
        name: parsed.name,
        enabled: parsed.enabled,
        samplingProbability: parsed.samplingProbability,
        provider: parsed.provider,
        modelName: parsed.modelName,
        evalPrompt: parsed.evalPrompt,
      });
      const updateData = buildEvalJudgeUpdatePayload(
        judge as ExistingEvalJudgeForUpdate,
        updatePayload
      );
      await (db as unknown as Record<string, { update: (r: unknown) => Promise<unknown> }>)[
        "agent-eval-judge"
      ].update(updateData);
      return "Eval judge updated successfully.";
    },
  });

  tools.delete_my_eval_judge = tool({
    description: "Delete an evaluation judge for this agent.",
    parameters: z.object({ judgeId: z.string().min(1) }).strict(),
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const { judgeId } = z
        .object({ judgeId: z.string().min(1) })
        .strict()
        .parse(args);
      const db = await database();
      const judgePk = `agent-eval-judges/${workspaceId}/${agentId}/${judgeId}`;
      const judge = await (
        db as unknown as Record<string, { get: (pk: string, sk: string) => Promise<unknown> }>
      )["agent-eval-judge"].get(judgePk, "judge");
      if (!judge) {
        return JSON.stringify({ error: "Eval judge not found" });
      }
      await (
        db as unknown as Record<
          string,
          { delete: (pk: string, sk: string) => Promise<unknown> }
        >
      )["agent-eval-judge"].delete(judgePk, "judge");
      return "Eval judge deleted successfully.";
    },
  });

  tools.list_my_keys = tool({
    description:
      "List API keys for this agent (id, name, provider, type, createdAt). Key values are not returned.",
    parameters: z.object({}).strict(),
    // @ts-expect-error - AI SDK execute signature
    execute: async () => {
      const db = await database();
      const result = await db["agent-key"].query({
        IndexName: "byAgentId",
        KeyConditionExpression: "agentId = :agentId",
        ExpressionAttributeValues: { ":agentId": agentId },
      });
      const keys = (result.items ?? [])
        .filter((k: { workspaceId: string }) => k.workspaceId === workspaceId)
        .map((k: { pk: string; name?: string; provider?: string; type?: string; createdAt: string }) => {
          const keyId = k.pk.split("/")[3];
          return {
            id: keyId,
            name: k.name ?? null,
            provider: k.provider ?? "google",
            type: k.type ?? "webhook",
            createdAt: k.createdAt,
          };
        });
      return JSON.stringify(keys, null, 2);
    },
  });

  tools.get_my_memory_settings = tool({
    description:
      "Get this agent's memory extraction settings: enabled, model, prompt.",
    parameters: z.object({}).strict(),
    // @ts-expect-error - AI SDK execute signature
    execute: async () => {
      return JSON.stringify(
        {
          memoryExtractionEnabled: agent.memoryExtractionEnabled ?? false,
          memoryExtractionModel: agent.memoryExtractionModel ?? null,
          memoryExtractionPrompt: agent.memoryExtractionPrompt ?? null,
        },
        null,
        2
      );
    },
  });

  const updateMemorySettingsSchema = z
    .object({
      memoryExtractionEnabled: z.boolean().optional(),
      memoryExtractionModel: z.string().nullable().optional(),
      memoryExtractionPrompt: z.string().nullable().optional(),
    })
    .strict();
  tools.update_my_memory_settings = tool({
    description:
      "Update this agent's memory extraction settings. Pass only the fields to change.",
    parameters: updateMemorySettingsSchema,
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const parsed = updateMemorySettingsSchema.parse(args);
      const db = await database();
      const pk = `agents/${workspaceId}/${agentId}`;
      const existing = await db.agent.get(pk, "agent");
      if (!existing) {
        return JSON.stringify({ error: "Agent not found" });
      }
      const updatePayload = {
        ...existing,
        memoryExtractionEnabled:
          parsed.memoryExtractionEnabled ?? existing.memoryExtractionEnabled,
        memoryExtractionModel:
          parsed.memoryExtractionModel !== undefined
            ? parsed.memoryExtractionModel
            : existing.memoryExtractionModel,
        memoryExtractionPrompt:
          parsed.memoryExtractionPrompt !== undefined
            ? parsed.memoryExtractionPrompt
            : existing.memoryExtractionPrompt,
        updatedAt: new Date().toISOString(),
      };
      await db.agent.update(
        updatePayload as Parameters<typeof db.agent.update>[0]
      );
      return "Memory settings updated successfully.";
    },
  });

  return tools;
}

export type SetupAgentConfigToolsOptions = {
  llmObserver?: LlmObserver;
  context?: AugmentedContext;
  /** When set, create_my_schedule and create_my_eval_judge enforce subscription limits. */
  userId?: string;
};

export type SetupAgentConfigToolsResult = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool types
  tools: Record<string, any>;
  systemPrompt: string;
};

/**
 * Sets up the meta-agent for a given agent: config-only tools and system prompt.
 */
export function setupAgentConfigTools(
  workspaceId: string,
  agentId: string,
  agent: AgentRecordForConfig,
  options?: SetupAgentConfigToolsOptions
): SetupAgentConfigToolsResult {
  const rawTools = createAgentConfigTools(workspaceId, agentId, agent, options);
  const tools = wrapToolsWithObserver(rawTools, options?.llmObserver);
  const systemPrompt = getMetaAgentSystemPrompt(agent.name);
  return { tools, systemPrompt };
}
