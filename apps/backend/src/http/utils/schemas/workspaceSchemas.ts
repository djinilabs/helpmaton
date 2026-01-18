import { z } from "zod";

/**
 * Common schemas reused across multiple request types
 */

// Permission level enum (1 = READ, 2 = WRITE, 3 = OWNER)
// Accepts both string and number forms
const permissionLevelSchema = z
  .union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal("1"),
    z.literal("2"),
    z.literal("3"),
  ])
  .transform((val) => (typeof val === "string" ? Number(val) : val));

// Client tool schema
const clientToolSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(
        /^[a-zA-Z_$][a-zA-Z0-9_$]*$/,
        "Tool name must be a valid JavaScript identifier (letters, numbers, underscore, $; no spaces or special characters)"
      ),
    description: z.string().min(1),
    parameters: z.record(z.string(), z.unknown()),
  })
  .strict();

// Spending limit schema
const spendingLimitSchema = z
  .object({
    timeFrame: z.enum(["daily", "weekly", "monthly"]),
    amount: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Workspace schemas
 */

export const createWorkspaceSchema = z
  .object({
    name: z.string().min(1, "name is required and must be a string"),
    description: z.string().optional(),
  })
  .strict();

export const updateWorkspaceSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
  })
  .strict();

/**
 * Agent schemas
 */

export const createAgentSchema = z
  .object({
    name: z.string().min(1, "name is required and must be a string"),
    systemPrompt: z
      .string()
      .min(1, "systemPrompt is required and must be a string"),
    notificationChannelId: z.string().nullable().optional(),
    modelName: z.string().nullable().optional(),
    clientTools: z.array(clientToolSchema).optional(),
    avatar: z.string().nullable().optional(),
  })
  .strict();

export const updateAgentSchema = z
  .object({
    name: z.string().min(1).optional(),
    systemPrompt: z.string().min(1).optional(),
    notificationChannelId: z.string().nullable().optional(),
    spendingLimits: z.array(spendingLimitSchema).optional(),
    delegatableAgentIds: z.array(z.string()).optional(),
    enabledMcpServerIds: z.array(z.string()).optional(),
    enableMemorySearch: z.boolean().optional(),
    enableSearchDocuments: z.boolean().optional(),
    enableKnowledgeInjection: z.boolean().optional(),
    knowledgeInjectionSnippetCount: z.number().int().positive().optional(),
    knowledgeInjectionMinSimilarity: z.number().min(0).max(1).optional(),
    enableKnowledgeReranking: z.boolean().optional(),
    knowledgeRerankingModel: z.string().optional(),
    enableSendEmail: z.boolean().optional(),
    enableTavilySearch: z.boolean().optional(),
    searchWebProvider: z.string().optional(),
    enableTavilyFetch: z.boolean().optional(), // Legacy field
    fetchWebProvider: z.string().optional(),
    enableExaSearch: z.boolean().optional(),
    clientTools: z.array(clientToolSchema).optional(),
    widgetConfig: z
      .object({
        enabled: z.boolean().default(false),
        allowedOrigins: z.array(z.string()).optional(),
        theme: z.enum(["light", "dark", "auto"]).optional(),
        position: z
          .enum(["bottom-right", "bottom-left", "top-right", "top-left"])
          .optional(),
      })
      .strict()
      .nullable()
      .optional(),
    temperature: z.number().nullable().optional(),
    topP: z.number().nullable().optional(),
    topK: z.number().int().nullable().optional(),
    maxOutputTokens: z.number().int().positive().nullable().optional(),
    stopSequences: z.array(z.string()).nullable().optional(),
    maxToolRoundtrips: z.number().int().positive().nullable().optional(),
    modelName: z.string().nullable().optional(),
    avatar: z.string().nullable().optional(),
  })
  .strict();

/**
 * Channel schemas
 */

export const createChannelSchema = z
  .object({
    type: z.string().min(1, "type is required and must be a string"),
    name: z.string().min(1, "name is required and must be a string"),
    config: z.record(z.string(), z.unknown()),
  })
  .strict();

export const updateChannelSchema = z
  .object({
    name: z.string().min(1).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/**
 * Document schemas
 */

// Note: post-workspace-documents uses multipart/form-data, so textDocuments is a JSON string
// We'll handle that in the route handler, not in the schema
export const createDocumentSchema = z
  .object({
    folderPath: z.string().optional(),
    // textDocuments is parsed separately from multipart form data
  })
  .strict();

// Schema for textDocuments array (used in post-workspace-documents)
export const textDocumentSchema = z
  .object({
    name: z.string().min(1),
    content: z.string().min(1),
  })
  .strict();

export const textDocumentsArraySchema = z.array(textDocumentSchema);

export const updateDocumentSchema = z
  .object({
    name: z.string().min(1).optional(),
    content: z.string().optional(),
    folderPath: z.string().optional(),
  })
  .strict();

export const renameDocumentSchema = z
  .object({
    name: z.string().min(1, "name is required"),
  })
  .strict();

/**
 * Member schemas
 */

export const createMemberSchema = z
  .object({
    userId: z.string().min(1, "userId is required and must be a string"),
    permissionLevel: permissionLevelSchema.optional(),
  })
  .strict();

export const updateMemberSchema = z
  .object({
    permissionLevel: permissionLevelSchema,
  })
  .strict();

/**
 * Invite schemas
 */

export const createInviteSchema = z
  .object({
    email: z.string().email("email is required and must be a valid email"),
    permissionLevel: permissionLevelSchema.optional(),
  })
  .strict();

/**
 * Integration schemas
 */

export const createIntegrationSchema = z
  .object({
    platform: z.enum(["slack", "discord"]),
    name: z.string().min(1, "name is required and must be a string"),
    agentId: z.string().min(1, "agentId is required and must be a string"),
    config: z.record(z.string(), z.unknown()),
  })
  .strict();

export const updateIntegrationSchema = z
  .object({
    name: z.string().min(1).optional(),
    status: z.enum(["active", "inactive"]).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const createIntegrationDiscordCommandSchema = z
  .object({
    commandName: z
      .string()
      .min(1, "commandName is required and must be a string"),
  })
  .strict();

export const createIntegrationSlackManifestSchema = z
  .object({
    agentId: z.string().min(1, "agentId is required and must be a string"),
    agentName: z.string().min(1).optional(),
  })
  .strict();

/**
 * Spending limits schemas
 */

export const createSpendingLimitSchema = z
  .object({
    timeFrame: z.enum(["daily", "weekly", "monthly"]),
    amount: z
      .number()
      .int()
      .nonnegative(
        "amount is required and must be a non-negative integer (millionths)"
      ),
  })
  .strict();

export const updateSpendingLimitSchema = z
  .object({
    amount: z
      .number()
      .int()
      .nonnegative(
        "amount is required and must be a non-negative integer (millionths)"
      ),
  })
  .strict();

export const createAgentSpendingLimitSchema = z
  .object({
    timeFrame: z.enum(["daily", "weekly", "monthly"]),
    amount: z
      .number()
      .int()
      .nonnegative(
        "amount is required and must be a non-negative integer (millionths)"
      ),
  })
  .strict();

export const updateAgentSpendingLimitSchema = z
  .object({
    amount: z
      .number()
      .int()
      .nonnegative(
        "amount is required and must be a non-negative integer (millionths)"
      ),
  })
  .strict();

/**
 * MCP Server schemas
 */

export const createMcpServerSchema = z
  .object({
    name: z.string().min(1, "name is required and must be a string"),
    url: z.string().url("url must be a valid URL").optional(),
    authType: z.enum(["none", "header", "basic", "oauth"]),
    serviceType: z
      .enum([
        "external",
        "google-drive",
        "gmail",
        "google-calendar",
        "notion",
        "github",
        "linear",
        "hubspot",
        "stripe",
        "posthog",
      ])
      .optional(),
    config: z.record(z.string(), z.unknown()),
  })
  .strict()
  .refine(
    (data) => {
      // For OAuth authType, url is optional
      // For non-OAuth authType, url is required
      if (data.authType !== "oauth" && !data.url) {
        return false;
      }
      return true;
    },
    {
      message: "url is required when authType is not 'oauth'",
    }
  );

export const updateMcpServerSchema = z
  .object({
    name: z.string().min(1).optional(),
    url: z.string().url().optional(),
    authType: z.enum(["none", "header", "basic", "oauth"]).optional(),
    serviceType: z
      .enum([
        "external",
        "google-drive",
        "gmail",
        "google-calendar",
        "notion",
        "github",
        "linear",
        "hubspot",
        "stripe",
        "posthog",
      ])
      .optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/**
 * Email connection schemas
 */

export const createEmailConnectionSchema = z
  .object({
    type: z.enum(["gmail", "outlook", "smtp"]),
    name: z.string().min(1, "name is required and must be a string"),
    config: z.record(z.string(), z.unknown()),
  })
  .strict();

export const updateEmailConnectionSchema = z
  .object({
    name: z.string().min(1).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/**
 * Stream server schemas
 */

const originSchema = z
  .string()
  .refine((val) => val === "*" || /^https?:\/\/.+/.test(val), {
    message: "Each origin must be '*' or a valid URL",
  });

export const createStreamServerSchema = z
  .object({
    allowedOrigins: z
      .array(originSchema)
      .min(1, "allowedOrigins must be an array with at least one origin"),
  })
  .strict();

export const updateStreamServerSchema = z
  .object({
    allowedOrigins: z
      .array(originSchema)
      .min(1, "allowedOrigins must be an array with at least one origin"),
  })
  .strict();

/**
 * Agent key schemas
 */

export const createAgentKeySchema = z
  .object({
    name: z.string().min(1).optional(),
    provider: z.enum(["google"]).optional(), // Only "google" is supported for agent keys
    type: z.enum(["webhook", "widget"]).optional(),
  })
  .strict();

/**
 * API key schemas
 */

export const updateApiKeySchema = z
  .object({
    key: z.string(), // Allow empty string for deletion
    provider: z.enum(["openrouter"], {
      message: "Only OpenRouter is supported for BYOK (Bring Your Own Key)",
    }),
  })
  .strict();

/**
 * Credits purchase schema
 */

export const purchaseCreditsSchema = z
  .object({
    amount: z
      .number()
      .positive("Amount must be a positive number")
      .refine((val) => val >= 1, {
        message: "Minimum purchase amount is 1 USD",
      })
      .refine((val) => Math.round(val * 100) === val * 100, {
        message: "Amount must have at most 2 decimal places",
      }),
  })
  .strict();

/**
 * Trial credit request schema
 */

export const trialCreditRequestSchema = z
  .object({
    captchaToken: z.string().min(1, "CAPTCHA token is required"),
  })
  .strict();

/**
 * Eval Judge schemas
 */

export const createEvalJudgeSchema = z
  .object({
    name: z.string().min(1, "name is required and must be a string"),
    enabled: z.boolean().optional().default(true),
    samplingProbability: z.number().int().min(0).max(100).optional().default(100),
    provider: z.enum(["openrouter"]).default("openrouter"), // Only openrouter is supported for eval judges
    modelName: z.string().min(1, "modelName is required and must be a string"),
    evalPrompt: z.string().min(1, "evalPrompt is required and must be a string"),
  })
  .strict();

export const updateEvalJudgeSchema = z
  .object({
    name: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    samplingProbability: z.number().int().min(0).max(100).optional(),
    provider: z.enum(["openrouter"]).optional(), // Only openrouter is supported for eval judges
    modelName: z.string().min(1).optional(),
    evalPrompt: z.string().min(1).optional(),
  })
  .strict();
