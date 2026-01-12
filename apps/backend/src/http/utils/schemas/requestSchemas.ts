import { z } from "zod";

/**
 * Schema for UIMessage content - supports both string and array formats
 * This is a flexible schema that allows the various content formats used in UIMessage
 */
const uiMessageContentSchema = z.union([
  z.string(),
  z.array(
    z.union([
      z.object({
        type: z.literal("text"),
        text: z.string(),
      }),
      z.record(z.string(), z.unknown()), // Allow other content types (tool calls, tool results, etc.)
    ])
  ),
]);

/**
 * Schema for a single UIMessage
 * Supports all UIMessage roles: user, assistant, system, tool
 * Supports both our internal format (content) and ai-sdk format (parts)
 */
const uiMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  // Support both content (our format) and parts (ai-sdk format)
  content: uiMessageContentSchema.optional(),
  parts: z.array(z.unknown()).optional(), // ai-sdk format
  awsRequestId: z.string().optional(),
  knowledgeInjection: z.literal(true).optional(),
  knowledgeSnippets: z.array(z.record(z.string(), z.unknown())).optional(),
  tokenUsage: z
    .object({
      promptTokens: z.number(),
      completionTokens: z.number(),
      totalTokens: z.number(),
      reasoningTokens: z.number().optional(),
      cachedPromptTokens: z.number().optional(),
    })
    .optional(),
  modelName: z.string().optional(),
  provider: z.string().optional(),
  openrouterGenerationId: z.string().optional(),
  provisionalCostUsd: z.number().optional(),
  finalCostUsd: z.number().optional(),
  generationTimeMs: z.number().optional(),
}).refine(
  (data) => data.content !== undefined || data.parts !== undefined,
  { message: "Message must have either 'content' or 'parts'" }
);

/**
 * Schema for stream request body
 * Used in validateRequest() and stream handlers
 */
export const streamRequestSchema = z.object({
  messages: z.array(uiMessageSchema).min(1, "messages array must not be empty"),
  conversationId: z.string().optional(),
}).strict();

/**
 * Schema for test agent request body
 * Used in POST /api/workspaces/:workspaceId/agents/:agentId/test
 */
export const testAgentRequestSchema = z.object({
  messages: z.array(uiMessageSchema).min(1, "messages array must not be empty"),
}).strict();

/**
 * Schema for scrape request body
 * Used in POST /api/scrape
 */
export const scrapeRequestSchema = z.object({
  url: z
    .string()
    .min(1, "url is required")
    .max(2048, "url too long")
    .refine(
      (url) => {
        try {
          new URL(url);
          return true;
        } catch {
          return false;
        }
      },
      { message: "invalid URL" }
    ),
}).strict();

/**
 * Schema for generate prompt request body
 * Used in POST /api/workspaces/:workspaceId/agents/generate-prompt
 */
export const generatePromptRequestSchema = z.object({
  goal: z
    .string()
    .min(1, "goal is required and must be a non-empty string")
    .refine((val) => val.trim().length > 0, {
      message: "goal must not be only whitespace",
    }),
  agentId: z.string().optional(),
}).strict();
