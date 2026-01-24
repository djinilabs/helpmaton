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
      }).strict(),
      z
        .object({
          type: z.literal("file"),
          file: z
            .string()
            .refine(
              (val) => val.startsWith("http://") || val.startsWith("https://"),
              "File URL must be a valid HTTP/HTTPS URL"
            )
            .refine(
              (val) => !val.startsWith("data:") && !val.startsWith("data;"),
              "Inline file data (base64/data URLs) is not allowed. Files must be uploaded to S3 first."
            ),
          mediaType: z.string().optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal("image"),
          image: z
            .string()
            .refine(
              (val) => val.startsWith("http://") || val.startsWith("https://"),
              "Image URL must be a valid HTTP/HTTPS URL"
            )
            .refine(
              (val) => !val.startsWith("data:") && !val.startsWith("data;"),
              "Inline image data (base64/data URLs) is not allowed. Images must be uploaded to S3 first."
            ),
          mediaType: z.string().optional(),
        })
        .strict(),
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
    .strict()
    .optional(),
  modelName: z.string().optional(),
  provider: z.string().optional(),
  openrouterGenerationId: z.string().optional(),
  provisionalCostUsd: z.number().optional(),
  finalCostUsd: z.number().optional(),
  generationTimeMs: z.number().optional(),
})
  .passthrough() // Allow extra fields for ai-sdk compatibility
  .refine(
    (data) => data.content !== undefined || data.parts !== undefined,
    { message: "Message must have either 'content' or 'parts'" }
  );

/**
 * Schema for stream request body
 * Used in validateRequest() and stream handlers
 * Uses passthrough() to allow extra fields from ai-sdk (e.g., id, trigger)
 */
export const streamRequestSchema = z.object({
  messages: z.array(uiMessageSchema).min(1, "messages array must not be empty"),
  conversationId: z.string().optional(),
}).passthrough();

/**
 * Schema for test agent request body
 * Used in POST /api/streams/:workspaceId/:agentId/test
 * Uses passthrough() to allow extra fields from ai-sdk (e.g., id, trigger)
 */
export const testAgentRequestSchema = z.object({
  messages: z.array(uiMessageSchema).min(1, "messages array must not be empty"),
}).passthrough();

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
