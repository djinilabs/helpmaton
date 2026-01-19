import { z } from "zod";

/**
 * Workspace Export/Import Schema
 * 
 * This schema defines the complete structure of a workspace configuration for export and import.
 * It uses a hierarchical GraphQL-style structure with the workspace at the root level.
 * 
 * ## Reference System
 * 
 * The schema supports two types of references:
 * 
 * 1. **Actual IDs**: Real database IDs from existing workspaces (e.g., "agent-123", "channel-456")
 * 2. **Named References**: Template placeholders using the format "{refName}" (e.g., "{agentId}", "{channelId}")
 * 
 * ### Reference Fields
 * 
 * The following fields support references:
 * 
 * - `workspace.id` - Workspace ID or reference
 * - `agent.id` - Agent ID or reference
 * - `agent.notificationChannelId` - References `outputChannels[].id`
 * - `agent.delegatableAgentIds[]` - Array of agent IDs (can mix actual IDs and references)
 * - `agent.enabledMcpServerIds[]` - Array of MCP server IDs (can mix actual IDs and references)
 * - `agent.keys[].id` - Agent key ID or reference
 * - `agent.evalJudges[].id` - Judge ID or reference
 * - `outputChannels[].id` - Output channel ID or reference
 * - `emailConnections[].id` - Email connection ID or reference
 * - `mcpServers[].id` - MCP server ID or reference
 * - `botIntegrations[].id` - Bot integration ID or reference
 * - `botIntegrations[].agentId` - References `agents[].id`
 * 
 * ### Example: Template with References
 * 
 * ```json
 * {
 *   "id": "{workspaceId}",
 *   "name": "My Workspace",
 *   "agents": [
 *     {
 *       "id": "{mainAgent}",
 *       "name": "Main Agent",
 *       "notificationChannelId": "{discordChannel}",
 *       "delegatableAgentIds": ["{helperAgent}"],
 *       "enabledMcpServerIds": ["{notionServer}"]
 *     }
 *   ],
 *   "outputChannels": [
 *     {
 *       "id": "{discordChannel}",
 *       "channelId": "discord-123",
 *       "type": "discord",
 *       "name": "Discord Channel"
 *     }
 *   ],
 *   "mcpServers": [
 *     {
 *       "id": "{notionServer}",
 *       "name": "Notion MCP",
 *       "authType": "oauth"
 *     }
 *   ]
 * }
 * ```
 * 
 * ### Example: Actual Workspace Export
 * 
 * ```json
 * {
 *   "id": "workspaces/abc123",
 *   "name": "Production Workspace",
 *   "agents": [
 *     {
 *       "id": "agents/abc123/agent-456",
 *       "name": "Support Bot",
 *       "notificationChannelId": "output-channels/abc123/channel-789"
 *     }
 *   ],
 *   "outputChannels": [
 *     {
 *       "id": "output-channels/abc123/channel-789",
 *       "channelId": "discord-789",
 *       "type": "discord",
 *       "name": "Support Channel"
 *     }
 *   ]
 * }
 * ```
 * 
 * ### Import Process
 * 
 * When importing a workspace configuration:
 * 1. Validate the structure against this schema
 * 2. For templates: Replace all `"{refName}"` references with actual IDs
 * 3. For actual exports: Use the provided IDs directly
 * 4. Create/update entities in the database
 * 5. Resolve cross-references between entities
 */

/**
 * Helper type for reference fields that can be either actual IDs or named references.
 * Named references use the format "{refName}" for templates.
 * 
 * Examples:
 * - Actual ID: "agents/workspace-123/agent-456"
 * - Named reference: "{mainAgent}"
 */
const referenceString = z
  .string()
  .describe(
    'Reference to another entity. Can be an actual ID or a named reference like "{refName}" for templates.'
  );

/**
 * Spending limit configuration
 * 
 * Example:
 * ```json
 * {
 *   "timeFrame": "daily",
 *   "amount": 1000000  // $1.00 USD (1,000,000 millionths)
 * }
 * ```
 */
const spendingLimitSchema = z
  .object({
    timeFrame: z
      .enum(["daily", "weekly", "monthly"])
      .describe("Time frame for the spending limit (daily, weekly, or monthly)"),
    amount: z
      .number()
      .int()
      .describe("Spending limit amount in millionths of USD (e.g., 1000000 = $1.00)"),
  })
  .describe("Spending limit configuration");

/**
 * Client tool definition
 * 
 * Example:
 * ```json
 * {
 *   "name": "getWeather",
 *   "description": "Get the current weather for a location",
 *   "parameters": {
 *     "type": "object",
 *     "properties": {
 *       "location": { "type": "string" },
 *       "units": { "type": "string", "enum": ["celsius", "fahrenheit"] }
 *     },
 *     "required": ["location"]
 *   }
 * }
 * ```
 */
const clientToolSchema = z
  .object({
    name: z
      .string()
      .describe(
        "Tool name and function name (must be valid JavaScript identifier, e.g., 'getWeather')"
      ),
    description: z
      .string()
      .describe("Tool description for AI (e.g., 'Get the current weather for a location')"),
    parameters: z
      .record(z.string(), z.unknown())
      .describe("JSON Schema for parameters (compatible with AI SDK)"),
  })
  .describe("User-defined client-side tool");

/**
 * Summarization prompt overrides per temporal grain
 */
const summarizationPromptsSchema = z
  .object({
    daily: z.string().optional(),
    weekly: z.string().optional(),
    monthly: z.string().optional(),
    quarterly: z.string().optional(),
    yearly: z.string().optional(),
  })
  .optional()
  .describe("Summarization prompt overrides per temporal grain");

/**
 * Widget configuration
 */
const widgetConfigSchema = z
  .object({
    enabled: z
      .boolean()
      .default(false)
      .describe("Whether widget is enabled"),
    allowedOrigins: z
      .array(z.string())
      .optional()
      .describe("CORS origins, empty = all origins"),
    theme: z
      .enum(["light", "dark", "auto"])
      .optional()
      .describe("Widget theme"),
    position: z
      .enum(["bottom-right", "bottom-left", "top-right", "top-left"])
      .optional()
      .describe("Widget position"),
  })
  .optional()
  .describe("Widget configuration");

/**
 * Agent key (webhook/widget key)
 */
const agentKeySchema = z
  .object({
    id: referenceString.describe("Agent key ID or reference"),
    name: z.string().optional().describe("Optional key name/description"),
    type: z
      .enum(["webhook", "widget"])
      .default("webhook")
      .describe("Key type: webhook or widget"),
    provider: z
      .enum(["google"])
      .default("google")
      .describe("Provider name (only 'google' supported)"),
  })
  .describe("Agent webhook or widget key");

/**
 * Evaluation judge configuration
 */
const evalJudgeSchema = z
  .object({
    id: referenceString.describe("Judge ID or reference"),
    name: z.string().describe("User-friendly name for the judge"),
    enabled: z
      .boolean()
      .default(true)
      .describe("Whether this judge is enabled"),
    samplingProbability: z
      .number()
      .int()
      .min(0)
      .max(100)
      .optional()
      .default(100)
      .describe("Percent (0-100) probability of evaluating a conversation"),
    provider: z
      .enum(["openrouter"])
      .default("openrouter")
      .describe(
        "LLM provider for the judge (only 'openrouter' is supported)"
      ),
    modelName: z
      .string()
      .describe("Model name for the judge (e.g., 'gpt-4o', 'claude-3-5-sonnet')"),
    evalPrompt: z.string().describe("The evaluation prompt template"),
  })
  .describe("Evaluation judge configuration for an agent");

/**
 * Agent stream server configuration
 */
const agentStreamServerSchema = z
  .object({
    secret: z
      .string()
      .describe(
        "Secret used in path parameter (stored as plain text; encrypted at rest by DynamoDB table-level encryption)"
      ),
    allowedOrigins: z
      .array(z.string())
      .describe(
        "Array of allowed origins or ['*'] for wildcard"
      ),
  })
  .optional()
  .describe("Stream server configuration for an agent");

/**
 * Agent configuration
 */
const agentSchema = z
  .object({
    id: referenceString.describe("Agent ID or reference"),
    name: z.string().describe("Agent name"),
    systemPrompt: z.string().describe("System prompt defining agent behavior"),
    summarizationPrompts: summarizationPromptsSchema,
    notificationChannelId: referenceString
      .optional()
      .describe("Reference to output channel"),
    delegatableAgentIds: z
      .array(referenceString)
      .optional()
      .describe(
        "List of agent IDs this agent can delegate to (can use references)"
      ),
    enabledMcpServerIds: z
      .array(referenceString)
      .optional()
      .describe(
        "List of MCP server IDs enabled for this agent (can use references)"
      ),
    enableMemorySearch: z
      .boolean()
      .optional()
      .describe("Enable memory search tool for this agent (default: false)"),
    enableSearchDocuments: z
      .boolean()
      .optional()
      .describe("Enable document search tool for this agent (default: false)"),
    enableKnowledgeInjection: z
      .boolean()
      .optional()
      .describe(
        "Enable knowledge injection from workspace documents (default: false)"
      ),
    knowledgeInjectionSnippetCount: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Number of document snippets to inject (default: 5)"),
    knowledgeInjectionMinSimilarity: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        "Minimum similarity score (0-1) required for snippets to be included (default: 0)"
      ),
    enableKnowledgeReranking: z
      .boolean()
      .optional()
      .describe("Enable re-ranking of injected snippets (default: false)"),
    knowledgeRerankingModel: z
      .string()
      .optional()
      .describe(
        "Re-ranking model name from OpenRouter (required if enableKnowledgeReranking is true)"
      ),
    enableSendEmail: z
      .boolean()
      .optional()
      .describe(
        "Enable email sending tool for this agent (default: false, requires workspace email connection)"
      ),
    enableTavilySearch: z
      .boolean()
      .optional()
      .describe(
        "@deprecated Use searchWebProvider instead. Legacy field for backward compatibility (default: false)"
      ),
    searchWebProvider: z
      .enum(["tavily", "jina"])
      .optional()
      .describe(
        "Web search provider: 'tavily' uses Tavily search API, 'jina' uses Jina DeepSearch API (default: undefined, no search tool)"
      ),
    enableTavilyFetch: z
      .boolean()
      .optional()
      .describe(
        "@deprecated Use fetchWebProvider instead. Legacy field for backward compatibility (default: false)"
      ),
    fetchWebProvider: z
      .enum(["tavily", "jina", "scrape"])
      .optional()
      .describe(
        "Web fetch provider: 'tavily' uses Tavily extract API, 'jina' uses Jina Reader API, 'scrape' uses Puppeteer with residential proxies (default: undefined, no fetch tool)"
      ),
    enableExaSearch: z
      .boolean()
      .optional()
      .describe("Enable Exa.ai search tool for this agent (default: false)"),
    spendingLimits: z
      .array(spendingLimitSchema)
      .optional()
      .describe("Agent-level spending limits"),
    temperature: z
      .number()
      .min(0)
      .max(2)
      .optional()
      .describe("Model temperature (0-2, controls randomness)"),
    topP: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Top-p / nucleus sampling (0-1)"),
    topK: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Top-k sampling (positive integer)"),
    maxOutputTokens: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Max output tokens (positive integer)"),
    stopSequences: z
      .array(z.string())
      .optional()
      .describe("Stop sequences (array of strings)"),
    maxToolRoundtrips: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Max tool roundtrips (positive integer, default 5)"),
    provider: z
      .enum(["google", "openai", "anthropic", "openrouter"])
      .default("openrouter")
      .describe(
        "Provider name (only 'openrouter' supported, but legacy values accepted)"
      ),
    modelName: z
      .string()
      .optional()
      .describe("Model name (e.g., 'gemini-2.5-flash', 'gpt-4o', 'claude-3-5-sonnet')"),
    clientTools: z
      .array(clientToolSchema)
      .optional()
      .describe("User-defined client-side tools"),
    widgetConfig: widgetConfigSchema,
    avatar: z
      .string()
      .optional()
      .describe("Avatar image path (e.g., '/images/helpmaton_logo_10.svg')"),
    keys: z
      .array(agentKeySchema)
      .optional()
      .describe("Agent webhook/widget keys"),
    evalJudges: z
      .array(evalJudgeSchema)
      .optional()
      .describe("Evaluation judges for this agent"),
    streamServer: agentStreamServerSchema,
  })
  .describe("AI agent configuration");

/**
 * Output channel configuration (Discord, etc.)
 */
const outputChannelSchema = z
  .object({
    id: referenceString.describe("Output channel ID or reference"),
    channelId: z
      .string()
      .describe("Unique identifier for the channel"),
    type: z
      .string()
      .describe("Discriminator: 'discord', future: 'slack', 'email', etc."),
    name: z.string().describe("User-friendly name for the channel"),
    config: z
      .record(z.string(), z.unknown())
      .describe("Type-specific configuration, encrypted"),
  })
  .describe("Output channel configuration (Discord, etc.)");

/**
 * Email connection configuration
 */
const emailConnectionSchema = z
  .object({
    id: referenceString.describe("Email connection ID or reference"),
    type: z
      .enum(["gmail", "outlook", "smtp"])
      .describe("Provider type"),
    name: z
      .string()
      .describe("User-friendly name for the connection"),
    config: z
      .record(z.string(), z.unknown())
      .describe("Type-specific configuration, encrypted"),
  })
  .describe("Email connection configuration");

/**
 * MCP server configuration
 */
const mcpServerSchema = z
  .object({
    id: referenceString.describe("MCP server ID or reference"),
    name: z.string().describe("User-friendly name for the server"),
    url: z
      .string()
      .url()
      .optional()
      .describe("MCP server URL (optional for OAuth-based servers)"),
    authType: z
      .enum(["none", "header", "basic", "oauth"])
      .describe("Authentication type"),
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
        "slack",
        "stripe",
        "salesforce",
        "intercom",
        "posthog",
      ])
      .optional()
      .describe(
        "Service type (defaults to 'external' for backward compatibility)"
      ),
    config: z
      .record(z.string(), z.unknown())
      .describe(
        "Authentication configuration, encrypted. For OAuth: contains accessToken, refreshToken, expiresAt, email?"
      ),
  })
  .describe("MCP server configuration");

/**
 * Bot integration configuration (Slack, Discord)
 */
const botIntegrationSchema = z
  .object({
    id: referenceString.describe("Bot integration ID or reference"),
    agentId: referenceString.describe(
      "Agent ID this bot is connected to (can use reference)"
    ),
    platform: z
      .enum(["slack", "discord"])
      .describe("Platform type"),
    name: z
      .string()
      .describe("User-friendly name for the integration"),
    config: z
      .record(z.string(), z.unknown())
      .describe(
        "Platform-specific config (encrypted). Slack: { botToken, signingSecret, teamId?, teamName?, botUserId?, messageHistoryCount? }. Discord: { botToken, publicKey, applicationId? }"
      ),
    webhookUrl: z
      .string()
      .url()
      .describe("The webhook URL for this integration"),
    status: z
      .enum(["active", "inactive", "error"])
      .default("active")
      .describe("Integration status"),
    lastUsedAt: z
      .string()
      .datetime()
      .optional()
      .describe("Timestamp of last use"),
  })
  .describe("Bot integration configuration (Slack, Discord)");

/**
 * Workspace export schema
 * 
 * This schema describes a complete workspace configuration in a hierarchical structure.
 * It supports both actual workspace exports (with real IDs) and templates (with named references like "{refName}").
 * 
 * When importing a template, references will be resolved to actual IDs.
 * 
 * ## Structure
 * 
 * The schema follows a GraphQL-style hierarchy:
 * - Workspace is the root object
 * - Agents are nested under workspace, each containing:
 *   - Agent configuration fields
 *   - `keys[]` - Agent webhook/widget keys
 *   - `evalJudges[]` - Evaluation judges
 *   - `streamServer` - Stream server configuration (optional)
 * - Output channels, email connections, MCP servers, and bot integrations are at workspace level
 * 
 * ## Excluded Entities
 * 
 * The following entities are NOT included in exports:
 * - Workspace API keys (excluded for security)
 * - Workspace documents (excluded - S3 file references)
 * - Workspace invites (excluded - user references and expiration)
 * - Permissions (excluded - user references)
 * - Runtime data (conversations, credit reservations, usage aggregates, etc.)
 */
export const workspaceExportSchema = z
  .object({
    id: referenceString.describe("Workspace ID or reference"),
    name: z.string().describe("Workspace name"),
    description: z.string().optional().describe("Workspace description"),
    currency: z
      .enum(["usd"])
      .default("usd")
      .describe("Workspace currency (always USD)"),
    // creditBalance is excluded from exports - it's runtime data, not configuration
    spendingLimits: z
      .array(spendingLimitSchema)
      .optional()
      .describe("Workspace-level spending limits"),
    agents: z
      .array(agentSchema)
      .optional()
      .describe("Array of agent configurations"),
    outputChannels: z
      .array(outputChannelSchema)
      .optional()
      .describe("Array of output channels (Discord, etc.)"),
    emailConnections: z
      .array(emailConnectionSchema)
      .optional()
      .describe("Array of email connections"),
    mcpServers: z
      .array(mcpServerSchema)
      .optional()
      .describe("Array of MCP server configurations"),
    botIntegrations: z
      .array(botIntegrationSchema)
      .optional()
      .describe("Array of bot integrations (Slack, Discord)"),
  })
  .describe(
    "Complete workspace configuration schema for export/import. Supports both actual IDs and named references (like '{refName}') for templates."
  );

/**
 * TypeScript type inferred from the workspace export schema
 */
export type WorkspaceExport = z.infer<typeof workspaceExportSchema>;
