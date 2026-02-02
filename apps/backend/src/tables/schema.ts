import { z } from "zod";

const TableBaseSchema = z.object({
  pk: z.string(),
  sk: z.string().optional(),
  version: z.number(),
  createdAt: z.iso.datetime(),
  createdBy: z.string().optional(),
  updatedAt: z.iso.datetime().optional(),
  updatedBy: z.string().optional(),
  noMainVersion: z.boolean().optional(),
  userVersion: z.string().optional(),
  userVersions: z
    .record(
      z.string(),
      z.object({
        deleted: z.boolean().optional(),
        createdAt: z.iso.datetime().optional(),
        createdBy: z.string().optional(),
        updatedAt: z.iso.datetime().optional(),
        updatedBy: z.string().optional(),
        newProps: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
});

const suggestionItemSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    actionType: z.string().optional(),
  })
  .strict();

const suggestionsCacheSchema = z
  .object({
    items: z.array(suggestionItemSchema).max(5),
    generatedAt: z.iso.datetime(),
    // Internal-only cache fields (not exposed in API responses).
    contextHash: z.string().optional(),
    dismissedIds: z.array(z.string()).optional(),
  })
  .strict();

export const tableSchemas = {
  "next-auth": TableBaseSchema.extend({
    pk: z.string(),
    sk: z.string(),
    email: z.string().email().optional(),
    name: z.string().optional(),
    emailVerified: z.iso.datetime().optional(),
    image: z.string().optional(),
    id: z.string().optional(),
    type: z.string().optional(), // "USER" for user records, undefined for account records
    lastCreditErrorEmailSentAt: z.iso.datetime().optional(),
    lastSpendingLimitErrorEmailSentAt: z.iso.datetime().optional(),
    gsi1pk: z.string().optional(), // GSI1 partition key for email lookups (GSI2)
    gsi1sk: z.string().optional(), // GSI1 sort key for email lookups (GSI2)
    gsi2pk: z.string().optional(), // GSI2 partition key for passkey lookup by credential id (byCredentialId)
    gsi2sk: z.string().optional(), // GSI2 sort key for passkey lookup (byCredentialId)
    credentialPublicKey: z.string().optional(), // passkey: base64-encoded COSE key
    counter: z.number().int().optional(), // passkey: signature counter
    transports: z.string().optional(), // passkey
    credentialDeviceType: z.string().optional(), // passkey
    credentialBackedUp: z.boolean().optional(), // passkey
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
    expires: z.number().optional(),
    identifier: z.string().optional(),
    token: z.string().optional(),
  }),
  workspace: TableBaseSchema.extend({
    pk: z.string(), // workspace ID (e.g., "workspaces/{workspaceId}")
    sk: z.string().optional(), // optional sort key
    name: z.string(),
    description: z.string().optional(),
    subscriptionId: z.string().optional(), // subscription ID this workspace belongs to
    currency: z.enum(["usd"]).default("usd"),
    creditBalance: z.number().int().default(0), // nano-dollars
    spendingLimits: z
      .array(
        z.object({
          timeFrame: z.enum(["daily", "weekly", "monthly"]),
          amount: z.number().int(), // nano-dollars
        }),
      )
      .optional(),
    // Trial credit fields (internal only - not exposed to users)
    trialCreditRequested: z.boolean().optional(),
    trialCreditRequestedAt: z.iso.datetime().optional(),
    trialCreditApproved: z.boolean().optional(),
    trialCreditApprovedAt: z.iso.datetime().optional(),
    trialCreditAmount: z.number().int().optional(), // nano-dollars
    // Lemon Squeezy integration fields
    lemonSqueezyOrderId: z.string().optional(), // Lemon Squeezy order ID for credit purchases
    suggestions: suggestionsCacheSchema.nullable().optional(),
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  permission: TableBaseSchema.extend({
    pk: z.string(), // resource reference (e.g., "workspaces/{workspaceId}")
    sk: z.string(), // user reference (e.g., "users/{userId}")
    resourceType: z.string(), // "workspaces"
    parentPk: z.string().optional(), // optional parent resource
    type: z.number().int().min(1), // permission level (1=READ, 2=WRITE, 3=OWNER)
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  agent: TableBaseSchema.extend({
    pk: z.string(), // agent ID (e.g., "agents/{workspaceId}/{agentId}")
    sk: z.string().optional(), // optional sort key
    workspaceId: z.string(), // workspace ID for GSI queries
    name: z.string(),
    systemPrompt: z.string(),
    summarizationPrompts: z
      .object({
        daily: z.string().min(1).optional(),
        weekly: z.string().min(1).optional(),
        monthly: z.string().min(1).optional(),
        quarterly: z.string().min(1).optional(),
        yearly: z.string().min(1).optional(),
      })
      .optional(),
    memoryExtractionEnabled: z.boolean().optional(),
    memoryExtractionModel: z.string().optional(),
    memoryExtractionPrompt: z.string().optional(),
    notificationChannelId: z.string().optional(), // reference to output_channel
    delegatableAgentIds: z.array(z.string()).optional(), // list of agent IDs this agent can delegate to
    enabledMcpServerIds: z.array(z.string()).optional(), // list of MCP server IDs enabled for this agent
    enabledMcpServerToolNames: z
      .record(z.string(), z.array(z.string()))
      .optional(), // per-server tool allowlist for this agent
    enableMemorySearch: z.boolean().optional(), // enable memory search tool for this agent (default: false)
    enableSearchDocuments: z.boolean().optional(), // enable document search tool for this agent (default: false)
    enableKnowledgeInjection: z.boolean().optional(), // enable knowledge injection from workspace documents (default: false)
    enableKnowledgeInjectionFromMemories: z.boolean().optional(), // enable knowledge injection from agent memories (default: false)
    enableKnowledgeInjectionFromDocuments: z.boolean().optional(), // include workspace documents when injecting knowledge (default: true)
    knowledgeInjectionSnippetCount: z.number().int().positive().optional(), // number of document snippets to inject (default: 5)
    knowledgeInjectionMinSimilarity: z.number().min(0).max(1).optional(), // minimum similarity score (0-1) required for snippets to be included (default: 0)
    knowledgeInjectionEntityExtractorModel: z.string().optional(), // model used to extract entities from prompt for graph search
    enableKnowledgeReranking: z.boolean().optional(), // enable re-ranking of injected snippets (default: false)
    knowledgeRerankingModel: z.string().optional(), // re-ranking model name from OpenRouter (required if enableKnowledgeReranking is true)
    enableSendEmail: z.boolean().optional(), // enable email sending tool for this agent (default: false, requires workspace email connection)
    enableTavilySearch: z.boolean().optional(), // @deprecated Use searchWebProvider instead. Legacy field for backward compatibility (default: false)
    searchWebProvider: z.enum(["tavily", "jina"]).optional(), // Web search provider: "tavily" uses Tavily search API, "jina" uses Jina DeepSearch API (default: undefined, no search tool)
    enableTavilyFetch: z.boolean().optional(), // @deprecated Use fetchWebProvider instead. Legacy field for backward compatibility (default: false)
    fetchWebProvider: z.enum(["tavily", "jina", "scrape"]).optional(), // Web fetch provider: "tavily" uses Tavily extract API, "jina" uses Jina Reader API, "scrape" uses Puppeteer with residential proxies (default: undefined, no fetch tool)
    enableExaSearch: z.boolean().optional(), // enable Exa.ai search tool for this agent (default: false)
    enableImageGeneration: z.boolean().optional(), // enable image generation tool for this agent (default: false)
    imageGenerationModel: z.string().optional(), // image generation model name from OpenRouter (required if enableImageGeneration is true)
    spendingLimits: z
      .array(
        z.object({
          timeFrame: z.enum(["daily", "weekly", "monthly"]),
          amount: z.number().int(), // nano-dollars
        }),
      )
      .optional(),
    temperature: z.number().min(0).max(2).optional(), // model temperature (0-2, controls randomness)
    topP: z.number().min(0).max(1).optional(), // top-p / nucleus sampling (0-1)
    topK: z.number().int().positive().optional(), // top-k sampling (positive integer)
    maxOutputTokens: z.number().int().positive().optional(), // max output tokens (positive integer)
    stopSequences: z.array(z.string()).optional(), // stop sequences (array of strings)
    maxToolRoundtrips: z.number().int().positive().optional(), // max tool roundtrips (positive integer, default 5)
    // Accept legacy providers for backward compatibility, but default to "openrouter"
    // Legacy agents with provider="google" will still validate correctly
    provider: z
      .enum(["google", "openai", "anthropic", "openrouter"])
      .default("openrouter"), // provider name (only "openrouter" supported, but legacy values accepted)
    modelName: z.string().optional(), // model name (e.g., "gemini-2.5-flash")
    clientTools: z
      .array(
        z.object({
          name: z.string(), // Tool name and function name (must be valid JavaScript identifier)
          description: z.string(), // Tool description for AI
          parameters: z.record(z.string(), z.unknown()), // JSON Schema for parameters (compatible with AI SDK)
        }),
      )
      .optional(), // User-defined client-side tools
    widgetConfig: z
      .object({
        enabled: z.boolean().default(false), // Whether widget is enabled
        allowedOrigins: z.array(z.string()).optional(), // CORS origins, empty = all origins
        theme: z.enum(["light", "dark", "auto"]).optional(), // Widget theme
        position: z
          .enum(["bottom-right", "bottom-left", "top-right", "top-left"])
          .optional(), // Widget position
      })
      .optional(), // Widget configuration
    avatar: z.string().optional(), // Avatar image path (e.g., "/images/helpmaton_logo_10.svg")
    suggestions: suggestionsCacheSchema.nullable().optional(),
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  output_channel: TableBaseSchema.extend({
    pk: z.string(), // output_channel ID (e.g., "output-channels/{workspaceId}/{channelId}")
    sk: z.string().optional(), // optional sort key
    workspaceId: z.string(), // workspace ID for GSI queries
    channelId: z.string(), // unique identifier for the channel
    type: z.string(), // discriminator: "discord", future: "slack", "email", etc.
    name: z.string(), // user-friendly name for the channel
    config: z.record(z.string(), z.unknown()), // type-specific configuration, encrypted
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  "agent-key": TableBaseSchema.extend({
    pk: z.string(), // agent-key ID (e.g., "agent-keys/{workspaceId}/{agentId}/{keyId}")
    sk: z.string(), // sort key (e.g., "key")
    workspaceId: z.string(), // workspace ID
    agentId: z.string(), // agent ID for GSI queries
    key: z.string(), // the actual key value
    name: z.string().optional(), // optional key name/description
    provider: z.enum(["google"]).default("google"), // provider name (only "google" supported)
    type: z.enum(["webhook", "widget"]).default("webhook"), // key type: webhook or widget
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  "workspace-api-key": TableBaseSchema.extend({
    pk: z.string(), // workspace-api-key ID (e.g., "workspace-api-keys/{workspaceId}/{provider}")
    sk: z.string(), // sort key (fixed value "key")
    workspaceId: z.string(), // workspace ID for GSI queries
    key: z.string(), // the actual API key value
    provider: z.enum(["openrouter"]).default("openrouter"), // provider name (only OpenRouter is supported for BYOK)
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  "workspace-document": TableBaseSchema.extend({
    pk: z.string(), // workspace-document ID (e.g., "workspace-documents/{workspaceId}/{documentId}")
    sk: z.string().optional(), // optional sort key
    workspaceId: z.string(), // workspace ID for GSI queries
    name: z.string(), // user-friendly display name (editable)
    filename: z.string(), // actual filename in S3 (may have conflict suffix)
    folderPath: z.string(), // folder path (e.g., "folder1/subfolder" or "" for root)
    s3Key: z.string(), // S3 key for the document
    contentType: z.string(), // MIME type (e.g., "text/markdown", "text/plain")
    size: z.number(), // file size in bytes
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  "agent-conversations": TableBaseSchema.extend({
    pk: z.string(), // conversation ID (e.g., "conversations/{workspaceId}/{agentId}/{conversationId}")
    sk: z.string().optional(), // optional sort key
    workspaceId: z.string(), // workspace ID
    agentId: z.string(), // agent ID for GSI queries
    conversationId: z.string(), // unique conversation ID (UUID)
    conversationType: z.enum(["test", "webhook", "stream", "scheduled"]), // type of conversation
    messages: z.array(z.unknown()), // array of all messages in the conversation
    tokenUsage: z
      .object({
        promptTokens: z.number(),
        completionTokens: z.number(),
        totalTokens: z.number(),
        reasoningTokens: z.number().optional(), // Reasoning tokens (if model supports reasoning)
        cachedPromptTokens: z.number().optional(), // Cached prompt tokens (if prompt caching is used)
      })
      .optional(), // aggregated token usage across all API calls
    modelName: z.string().optional(), // @deprecated - Use per-message modelName instead. Kept for backward compatibility.
    provider: z.string().optional(), // @deprecated - Use per-message provider instead. Kept for backward compatibility.
    usesByok: z.boolean().optional(), // whether this conversation used BYOK (Bring Your Own Key)
    error: z
      .object({
        message: z.string(),
        name: z.string().optional(),
        stack: z.string().optional(),
        code: z.string().optional(),
        statusCode: z.number().optional(),
        provider: z.string().optional(),
        modelName: z.string().optional(),
        endpoint: z.string().optional(),
        occurredAt: z.iso.datetime().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
    costUsd: z.number().int().optional(), // cost in USD in nano-dollars
    rerankingCostUsd: z.number().int().optional(), // re-ranking cost in USD in nano-dollars (tracked separately since re-ranking happens before LLM call)
    totalGenerationTimeMs: z.number().optional(), // sum of all generation times in milliseconds
    awsRequestIds: z.array(z.string()).optional(), // array of AWS Lambda/API Gateway request IDs that added messages to this conversation
    delegations: z
      .array(
        z.object({
          callingAgentId: z.string(),
          targetAgentId: z.string(),
          targetConversationId: z.string().optional(), // conversation ID of the target agent's conversation
          taskId: z.string().optional(),
          // ISO 8601 datetime string (accepts any precision: seconds, milliseconds, microseconds)
          timestamp: z.iso.datetime(),
          status: z.enum(["completed", "failed", "cancelled"]),
        }),
      )
      .optional(), // array of delegation calls made during this conversation
    startedAt: z.iso.datetime(), // when conversation started
    lastMessageAt: z.iso.datetime(), // when last message was added
    expires: z.number(), // TTL timestamp
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  "credit-reservations": TableBaseSchema.extend({
    pk: z.string(), // reservation ID (e.g., "credit-reservations/{reservationId}")
    workspaceId: z.string(), // workspace ID
    agentId: z.string().optional(), // agent ID (if transaction is associated with an agent)
    conversationId: z.string().optional(), // conversation ID (if transaction is associated with a conversation)
    reservedAmount: z.number().int(), // amount reserved (estimated cost) in nano-dollars
    estimatedCost: z.number().int(), // estimated cost at reservation time in nano-dollars
    currency: z.enum(["usd"]), // workspace currency
    expires: z.number(), // TTL timestamp (15 minutes from creation)
    expiresHour: z.number(), // Hour bucket for GSI (expires truncated to hour)
    // OpenRouter cost verification fields
    openrouterGenerationId: z.string().optional(), // OpenRouter generation ID for cost lookup (deprecated but still used for backward compatibility)
    // New fields for multiple generation tracking
    openrouterGenerationIds: z.array(z.string()).optional(), // All generation IDs from this request
    expectedGenerationCount: z.number().optional(), // Total expected count
    verifiedGenerationIds: z.array(z.string()).optional(), // IDs that have been verified
    verifiedCosts: z.array(z.number().int()).optional(), // Costs in nano-dollars for each verified generation
    allGenerationsVerified: z.boolean().optional(), // Flag indicating all generations have been verified
    totalOpenrouterCost: z.number().int().optional(), // Sum of all verified costs (for finalization)
    provider: z.string().optional(), // Provider used (for tracking)
    modelName: z.string().optional(), // Model used (for tracking)
    tokenUsageBasedCost: z.number().int().optional(), // Cost calculated from token usage (step 2) in nano-dollars
    openrouterCost: z.number().int().optional(), // Cost from OpenRouter API (step 3) in nano-dollars
    provisionalCost: z.number().int().optional(), // Provisional cost from API response (step 2) in nano-dollars (used for re-ranking)
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  "token-usage-aggregates": TableBaseSchema.extend({
    pk: z.string(), // aggregate ID (e.g., "aggregates/{workspaceId}/{date}" or "aggregates/{userId}/{date}" or "aggregates/{agentId}/{date}")
    sk: z.string().optional(), // optional sort key
    date: z.string(), // date in YYYY-MM-DD format
    aggregateType: z.enum(["workspace", "agent", "user"]), // type of aggregation
    workspaceId: z.string().optional(), // workspace ID (required for workspace/agent aggregates)
    agentId: z.string().optional(), // agent ID (required for agent aggregates)
    userId: z.string().optional(), // user ID (required for user aggregates)
    modelName: z.string(), // model name
    provider: z.string(), // provider name (e.g., "google", "openai") - extracted from model name, not "openrouter"
    usesByok: z.boolean().optional(), // whether this aggregate includes BYOK usage
    inputTokens: z.number(), // total input tokens for this aggregate
    outputTokens: z.number(), // total output tokens for this aggregate
    totalTokens: z.number(), // total tokens
    costUsd: z.number().int(), // total cost in USD in nano-dollars
    conversationCount: z.number().int().optional(), // number of conversations for this workspace/agent/user/date (same value across all aggregates for same key)
    messagesIn: z.number().int().optional(), // number of user messages for this workspace/agent/user/date (same value across all aggregates for same key)
    messagesOut: z.number().int().optional(), // number of assistant messages for this workspace/agent/user/date (same value across all aggregates for same key)
    totalMessages: z.number().int().optional(), // total messages (user + assistant) for this workspace/agent/user/date (same value across all aggregates for same key)
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  "tool-usage-aggregates": TableBaseSchema.extend({
    pk: z.string(), // aggregate ID (e.g., "tool-aggregates/{workspaceId}/{date}" or "tool-aggregates/{agentId}/{date}" or "tool-aggregates/{userId}/{date}")
    sk: z.string().optional(), // sort key: "{toolCall}:{supplier}"
    date: z.string(), // date in YYYY-MM-DD format
    aggregateType: z.enum(["workspace", "agent", "user"]), // type of aggregation
    workspaceId: z.string().optional(), // workspace ID (required for workspace/agent aggregates)
    agentId: z.string().optional(), // agent ID (required for agent aggregates)
    userId: z.string().optional(), // user ID (required for user aggregates)
    toolCall: z.string(), // tool name (e.g., "search_web", "fetch_url")
    supplier: z.string(), // supplier name (e.g., "tavily")
    costUsd: z.number().int(), // total cost in USD in nano-dollars
    callCount: z.number().int(), // number of tool calls
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  "email-connection": TableBaseSchema.extend({
    pk: z.string(), // email-connection ID (e.g., "email-connections/{workspaceId}")
    sk: z.string().optional(), // optional sort key (fixed value "connection")
    workspaceId: z.string(), // workspace ID for GSI queries
    type: z.enum(["gmail", "outlook", "smtp"]), // provider type
    name: z.string(), // user-friendly name for the connection
    config: z.record(z.string(), z.unknown()), // type-specific configuration, encrypted
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  "mcp-server": TableBaseSchema.extend({
    pk: z.string(), // mcp-server ID (e.g., "mcp-servers/{workspaceId}/{serverId}")
    sk: z.string().optional(), // optional sort key (fixed value "server")
    workspaceId: z.string(), // workspace ID for GSI queries
    name: z.string(), // user-friendly name for the server
    url: z.url().optional(), // MCP server URL (optional for OAuth-based servers)
    authType: z.enum(["none", "header", "basic", "oauth"]), // authentication type
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
        "shopify",
        "slack",
        "stripe",
        "salesforce",
        "intercom",
        "todoist",
        "zendesk",
        "posthog",
      ])
      .optional(), // service type (defaults to "external" for backward compatibility)
    config: z.record(z.string(), z.unknown()), // authentication configuration, encrypted. For OAuth: contains accessToken, refreshToken, expiresAt, email?
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  "trial-credit-requests": TableBaseSchema.extend({
    pk: z.string(), // trial-credit-requests ID (e.g., "trial-credit-requests/{workspaceId}")
    sk: z.string().optional(), // optional sort key (fixed value "request")
    workspaceId: z.string(), // workspace ID
    userId: z.string(), // user ID who requested
    userEmail: z.string().email(), // user email
    reason: z.string().min(1), // required reason for request
    currency: z.enum(["usd"]), // workspace currency
    requestedAt: z.iso.datetime(), // when request was made
    status: z.enum(["pending", "approved", "rejected"]).default("pending"),
    approvedAt: z.iso.datetime().optional(), // when approved
    approvedBy: z.string().optional(), // Discord user ID or admin identifier
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  subscription: TableBaseSchema.extend({
    pk: z.string(), // subscription ID (e.g., "subscriptions/{subscriptionId}")
    sk: z.string().optional(), // optional sort key (fixed value "subscription")
    userId: z.string(), // user ID who owns the subscription (for GSI queries)
    plan: z.enum(["free", "starter", "pro"]),
    expiresAt: z.iso.datetime().optional(), // expiration date (deprecated - free plans no longer expire)
    apiKeyId: z.string().optional(), // API Gateway API key ID for throttling
    lastLimitEmailSentAt: z.iso.datetime().optional(), // last time limit email was sent
    lastCreditErrorEmailSentAt: z.iso.datetime().optional(), // last time credit error email was sent
    lastSpendingLimitErrorEmailSentAt: z.iso.datetime().optional(), // last time spending limit error email was sent
    // Lemon Squeezy integration fields
    lemonSqueezySubscriptionId: z.string().optional(), // Lemon Squeezy subscription ID
    lemonSqueezyCustomerId: z.string().optional(), // Lemon Squeezy customer ID
    lemonSqueezyOrderId: z.string().optional(), // Lemon Squeezy order ID (for one-time purchases)
    lemonSqueezyVariantId: z.string().optional(), // Lemon Squeezy variant ID (plan variant)
    status: z
      .enum([
        "active",
        "past_due",
        "unpaid",
        "cancelled",
        "expired",
        "on_trial",
      ])
      .default("active"), // Subscription status from Lemon Squeezy
    renewsAt: z.iso.datetime().optional(), // Next renewal date (ISO datetime)
    endsAt: z.iso.datetime().optional(), // Subscription end date if cancelled (ISO datetime)
    trialEndsAt: z.iso.datetime().optional(), // Trial end date (ISO datetime)
    gracePeriodEndsAt: z.iso.datetime().optional(), // Grace period end date for failed payments (7 days from past_due)
    lastSyncedAt: z.iso.datetime().optional(), // Last time subscription was synced from Lemon Squeezy
    lastPaymentEmailSentAt: z.iso.datetime().optional(), // Last time payment issue email was sent
    lemonSqueezySyncKey: z.string().optional(), // GSI partition key for querying all Lemon Squeezy subscriptions (set to "ACTIVE" when subscription has Lemon Squeezy ID)
    // Note: Using a single partition key value ("ACTIVE") could create a hot partition if there are many subscriptions.
    // For high-scale scenarios, consider sharding (e.g., "ACTIVE#YYYY-MM" for monthly sharding) to distribute load.
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  "request-buckets": TableBaseSchema.extend({
    pk: z.string(), // bucket ID (e.g., "request-buckets/{subscriptionId}/{category}/{hourTimestamp}")
    subscriptionId: z.string(), // subscription ID for GSI queries
    category: z.enum(["llm", "search", "fetch", "prompt-generation"]), // request category
    categoryHourTimestamp: z.string().optional(), // composite sort key for GSI: "{category}#{hourTimestamp}"
    hourTimestamp: z.iso.datetime(), // ISO timestamp truncated to hour (YYYY-MM-DDTHH:00:00.000Z)
    count: z.number().default(0), // request count for this hour
    expires: z.number(), // TTL timestamp (25 hours from bucket hour)
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  "workspace-invite": TableBaseSchema.extend({
    pk: z.string(), // workspace-invite ID (e.g., "workspace-invites/{workspaceId}/{inviteId}")
    sk: z.string(), // sort key (fixed value "invite")
    workspaceId: z.string(), // workspace ID
    email: z.string().email(), // invited user email (normalized to lowercase)
    token: z.string(), // unique, cryptographically secure token
    permissionLevel: z.number().int().min(1).max(3), // permission level (1=READ, 2=WRITE, 3=OWNER)
    invitedBy: z.string(), // userRef of inviter
    expiresAt: z.iso.datetime(), // expiration date (ISO datetime)
    acceptedAt: z.iso.datetime().optional(), // when invite was accepted
    acceptedBy: z.string().optional(), // userRef of user who accepted
    expires: z.number(), // TTL timestamp for DynamoDB
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  "agent-stream-servers": TableBaseSchema.extend({
    pk: z.string(), // stream-server ID (e.g., "stream-servers/{workspaceId}/{agentId}")
    sk: z.string(), // sort key (fixed value "config")
    workspaceId: z.string(), // workspace ID
    agentId: z.string(), // agent ID
    secret: z.string(), // secret used in path parameter (stored as plain text; encrypted at rest by DynamoDB table-level encryption)
    allowedOrigins: z.array(z.string()), // array of allowed origins or ["*"] for wildcard
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  "user-api-key": TableBaseSchema.extend({
    pk: z.string(), // composite partition key for user's API keys (e.g., "user-api-keys/{userId}")
    sk: z.string(), // sort key (keyId UUID)
    userId: z.string(), // user ID extracted from pk for reference
    keyHash: z.string(), // scrypt hash of the full key (base64 encoded)
    keySalt: z.string(), // salt used for hashing (base64 encoded)
    keyLookupHash: z.string(), // SHA256 hash of the plain key for GSI lookup (hex encoded)
    keyPrefix: z.string(), // first 12 characters for display (e.g., "hmat_abc...")
    name: z.string().optional(), // optional user-provided name/label
    lastUsedAt: z.iso.datetime().optional(), // timestamp for tracking usage
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  "user-refresh-token": TableBaseSchema.extend({
    pk: z.string(), // composite partition key for user's refresh tokens (e.g., "user-refresh-tokens/{userId}")
    sk: z.string(), // sort key (tokenId UUID)
    userId: z.string(), // user ID extracted from pk for reference
    tokenHash: z.string(), // scrypt hash of the refresh token (base64 encoded)
    tokenSalt: z.string(), // salt used for hashing (base64 encoded)
    tokenLookupHash: z.string(), // SHA256 hash of the plain token for GSI lookup (hex encoded)
    expiresAt: z.iso.datetime(), // expiration timestamp
    lastUsedAt: z.iso.datetime().optional(), // timestamp for tracking usage
    revokedAt: z.iso.datetime().optional(), // revocation timestamp (if revoked)
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  "workspace-credit-transactions": TableBaseSchema.extend({
    pk: z.string(), // workspace ID (e.g., "workspaces/{workspaceId}")
    sk: z.string(), // sort key: `${numeric_timestamp}-${unique_id}` for sorting and uniqueness
    requestId: z.string(), // AWS request id to match against the cloudwatch logs if needed
    workspaceId: z.string(),
    agentId: z.string().optional(),
    conversationId: z.string().optional(),
    source: z.enum([
      "embedding-generation",
      "text-generation",
      "tool-execution",
      "credit-purchase",
    ]),
    supplier: z.enum(["openrouter", "tavily", "exa"]), // add more when we have more suppliers
    model: z.string().optional(), // the model that originated this charge, if any
    tool_call: z.string().optional(), // the tool call that was used when originating this charge, if any
    description: z.string(),
    amountNanoUsd: z.number().int(), // should be integer
    workspaceCreditsBeforeNanoUsd: z.number().int(), // the expected credits before applying this transaction
    workspaceCreditsAfterNanoUsd: z.number().int(), // the expected credits after applying this transaction
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
    expires: z.number().optional(), // TTL timestamp (1 year from creation)
  }),
  "agent-delegation-tasks": TableBaseSchema.extend({
    pk: z.string(), // "delegation-tasks/{taskId}"
    sk: z.string(), // "task"
    workspaceId: z.string(),
    callingAgentId: z.string(),
    targetAgentId: z.string(),
    message: z.string(),
    status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
    result: z.string().optional(),
    error: z.string().optional(),
    // ISO 8601 datetime string (accepts any precision: seconds, milliseconds, microseconds)
    createdAt: z.iso.datetime(),
    // ISO 8601 datetime string (accepts any precision: seconds, milliseconds, microseconds)
    completedAt: z.iso.datetime().optional(),
    ttl: z.number().optional(), // 7 days TTL timestamp
    gsi1pk: z.string(), // "workspace/{workspaceId}/agent/{callingAgentId}"
    gsi1sk: z.string(), // "{createdAt}"
  }),
  "bot-integration": TableBaseSchema.extend({
    pk: z.string(), // bot-integration ID (e.g., "bot-integrations/{workspaceId}/{integrationId}")
    sk: z.string().optional(), // optional sort key (fixed value "integration")
    workspaceId: z.string(), // workspace ID for GSI queries
    agentId: z.string(), // agent ID this bot is connected to (for GSI queries)
    platform: z.enum(["slack", "discord"]), // platform type
    name: z.string(), // user-friendly name for the integration
    config: z.record(z.string(), z.unknown()), // platform-specific config (encrypted)
    // Slack: { botToken, signingSecret, teamId?, teamName?, botUserId?, messageHistoryCount? }
    // Discord: { botToken, publicKey, applicationId? }
    webhookUrl: z.string().url(), // the webhook URL for this integration
    status: z.enum(["active", "inactive", "error"]).default("active"), // integration status
    lastUsedAt: z.iso.datetime().optional(), // timestamp of last use
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  "agent-eval-judge": TableBaseSchema.extend({
    pk: z.string(), // judge ID (e.g., "agent-eval-judges/{workspaceId}/{agentId}/{judgeId}")
    sk: z.string().optional(), // optional sort key
    workspaceId: z.string(), // workspace ID
    agentId: z.string(), // agent ID for GSI queries
    judgeId: z.string(), // unique judge ID (UUID)
    name: z.string(), // user-friendly name for the judge
    enabled: z.boolean().default(true), // whether this judge is enabled
    samplingProbability: z.number().int().min(0).max(100).default(100), // percent (0-100) for sampling evaluations
    provider: z.enum(["openrouter"]).default("openrouter"), // LLM provider for the judge (only openrouter is supported)
    modelName: z.string(), // model name for the judge (e.g., "gpt-4o")
    evalPrompt: z.string(), // the evaluation prompt template
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  "agent-eval-result": TableBaseSchema.extend({
    pk: z.string(), // result ID (e.g., "agent-eval-results/{workspaceId}/{agentId}/{conversationId}/{judgeId}")
    sk: z.string().optional(), // optional sort key
    workspaceId: z.string(), // workspace ID
    agentId: z.string(), // agent ID for GSI queries
    conversationId: z.string(), // conversation ID being evaluated
    judgeId: z.string(), // judge ID that performed the evaluation
    status: z.enum(["completed", "failed"]).default("completed"),
    summary: z.string(), // 1-sentence summary from evaluation
    scoreGoalCompletion: z.number().int().min(0).max(100).nullable().optional(), // goal completion score (0-100)
    scoreToolEfficiency: z.number().int().min(0).max(100).nullable().optional(), // tool efficiency score (0-100)
    scoreFaithfulness: z.number().int().min(0).max(100).nullable().optional(), // faithfulness score (0-100)
    criticalFailureDetected: z.boolean(), // whether a critical failure was detected
    reasoningTrace: z.string(), // explanation of scoring logic
    errorMessage: z.string().optional(), // error summary when evaluation fails
    errorDetails: z.string().optional(), // detailed error message when evaluation fails
    costUsd: z.number().int().optional(), // cost of the evaluation call in USD nano-dollars
    usesByok: z.boolean().optional(), // whether this evaluation used BYOK
    tokenUsage: z
      .object({
        promptTokens: z.number(),
        completionTokens: z.number(),
        totalTokens: z.number(),
        reasoningTokens: z.number().optional(),
        cachedPromptTokens: z.number().optional(),
      })
      .optional(), // token usage for the evaluation call
    evaluatedAt: z.iso.datetime(), // when the evaluation was performed
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
  }),
  "agent-schedule": TableBaseSchema.extend({
    pk: z.string(), // schedule ID (e.g., "agent-schedules/{workspaceId}/{agentId}/{scheduleId}")
    sk: z.string().optional(), // optional sort key
    workspaceId: z.string(), // workspace ID
    agentId: z.string(), // agent ID for GSI queries
    scheduleId: z.string(), // unique schedule ID (UUID)
    name: z.string(), // user-friendly name for the schedule
    cronExpression: z.string(), // cron expression (UTC)
    prompt: z.string(), // first user message for the scheduled run
    enabled: z.boolean().default(true),
    duePartition: z.string(), // partition key for due schedule GSI (e.g., "due")
    nextRunAt: z.number().int(), // epoch seconds for next run
    lastRunAt: z.iso.datetime().optional(),
    version: z.number().default(1),
    createdAt: z.iso.datetime().default(new Date().toISOString()),
    updatedAt: z.iso.datetime().optional(),
  }),
} as const;

/** Schema for passkey records stored in the next-auth table (pk=USER#userId, sk=PASSKEY#credentialId). */
export const passkeyRecordSchema = TableBaseSchema.extend({
  pk: z.string(),
  sk: z.string(),
  gsi2pk: z.string().optional(),
  gsi2sk: z.string().optional(),
  credentialPublicKey: z.string(),
  counter: z.number().int(),
  transports: z.string().optional(),
  credentialDeviceType: z.string().optional(),
  credentialBackedUp: z.boolean().optional(),
  version: z.number().default(1),
  createdAt: z.iso.datetime().default(new Date().toISOString()),
});

export type TableBaseSchemaType = z.infer<typeof TableBaseSchema>;
export type TableSchemas = typeof tableSchemas;
export type TableName =
  | "next-auth"
  | "workspace"
  | "permission"
  | "agent"
  | "agent-key"
  | "workspace-api-key"
  | "workspace-document"
  | "output_channel"
  | "agent-conversations"
  | "credit-reservations"
  | "token-usage-aggregates"
  | "tool-usage-aggregates"
  | "email-connection"
  | "mcp-server"
  | "trial-credit-requests"
  | "subscription"
  | "request-buckets"
  | "workspace-invite"
  | "agent-stream-servers"
  | "user-api-key"
  | "user-refresh-token"
  | "workspace-credit-transactions"
  | "agent-delegation-tasks"
  | "bot-integration"
  | "agent-eval-judge"
  | "agent-eval-result"
  | "agent-schedule";

export type WorkspaceRecord = z.infer<typeof tableSchemas.workspace>;
export type PermissionRecord = z.infer<typeof tableSchemas.permission>;
export type AgentRecord = z.infer<typeof tableSchemas.agent>;
export type AgentKeyRecord = z.infer<(typeof tableSchemas)["agent-key"]>;
export type WorkspaceApiKeyRecord = z.infer<
  (typeof tableSchemas)["workspace-api-key"]
>;
export type WorkspaceDocumentRecord = z.infer<
  (typeof tableSchemas)["workspace-document"]
>;
export type OutputChannelRecord = z.infer<
  (typeof tableSchemas)["output_channel"]
>;
export type AgentConversationRecord = z.infer<
  (typeof tableSchemas)["agent-conversations"]
>;
export type CreditReservationRecord = z.infer<
  (typeof tableSchemas)["credit-reservations"]
>;
export type TokenUsageAggregateRecord = z.infer<
  (typeof tableSchemas)["token-usage-aggregates"]
>;
export type ToolUsageAggregateRecord = z.infer<
  (typeof tableSchemas)["tool-usage-aggregates"]
>;
export type EmailConnectionRecord = z.infer<
  (typeof tableSchemas)["email-connection"]
>;
export type McpServerRecord = z.infer<(typeof tableSchemas)["mcp-server"]>;
export type TrialCreditRequestRecord = z.infer<
  (typeof tableSchemas)["trial-credit-requests"]
>;
export type SubscriptionRecord = z.infer<(typeof tableSchemas)["subscription"]>;
export type RequestBucketRecord = z.infer<
  (typeof tableSchemas)["request-buckets"]
>;
export type WorkspaceInviteRecord = z.infer<
  (typeof tableSchemas)["workspace-invite"]
>;
export type AgentStreamServerRecord = z.infer<
  (typeof tableSchemas)["agent-stream-servers"]
>;
export type UserApiKeyRecord = z.infer<(typeof tableSchemas)["user-api-key"]>;
export type UserRefreshTokenRecord = z.infer<
  (typeof tableSchemas)["user-refresh-token"]
>;
export type WorkspaceCreditTransactionRecord = z.infer<
  (typeof tableSchemas)["workspace-credit-transactions"]
>;
export type BotIntegrationRecord = z.infer<
  (typeof tableSchemas)["bot-integration"]
>;
export type AgentScheduleRecord = z.infer<
  (typeof tableSchemas)["agent-schedule"]
>;
export type UserPasskeyRecord = z.infer<typeof passkeyRecordSchema>;

export const PERMISSION_LEVELS = {
  READ: 1,
  WRITE: 2,
  OWNER: 3,
} as const;

export type Query = {
  IndexName?: string;
  KeyConditionExpression?: string;
  FilterExpression?: string;
  ExpressionAttributeValues?: Record<string, unknown>;
  ExpressionAttributeNames?: Record<string, string>;
  ScanIndexForward?: boolean;
};

export type QueryResponse<TTableRecord extends TableBaseSchemaType> = {
  items: TTableRecord[];
  areAnyUnpublished: boolean;
};

export type TableAPI<
  TTableName extends TableName,
  TTableRecord extends z.infer<TableSchemas[TTableName]> = z.infer<
    TableSchemas[TTableName]
  >,
> = {
  delete: (
    key: string,
    sk?: string,
    version?: string | null,
  ) => Promise<TTableRecord>;
  deleteIfExists: (
    key: string,
    sk?: string,
    version?: string | null,
  ) => Promise<TTableRecord | undefined>;
  deleteAll: (key: string, version?: string | null) => Promise<void>;
  get: (
    pk: string,
    sk?: string,
    version?: string | null,
  ) => Promise<TTableRecord | undefined>;
  batchGet: (
    keys: string[],
    version?: string | null,
  ) => Promise<TTableRecord[]>;
  update: (
    item: Partial<TTableRecord>,
    version?: string | null,
  ) => Promise<TTableRecord>;
  upsert: (
    item: Omit<TTableRecord, "version">,
    version?: string | null,
  ) => Promise<TTableRecord>;
  create: (
    item: Omit<TTableRecord, "version" | "createdAt">,
    version?: string | null,
  ) => Promise<TTableRecord>;
  query: (
    query: Query,
    version?: string | null,
  ) => Promise<QueryResponse<TTableRecord>>;
  queryPaginated: (
    query: Query,
    options: {
      limit: number;
      cursor?: string | null;
      version?: string | null;
    },
  ) => Promise<{
    items: TTableRecord[];
    nextCursor: string | null;
  }>;
  queryAsync: (
    query: Query,
    version?: string | null,
  ) => AsyncGenerator<TTableRecord, void, unknown>;
  merge: (
    pk: string,
    sk: string,
    version: string | null,
  ) => Promise<TTableRecord>;
  revert: (
    pk: string,
    sk: string | undefined,
    version: string,
  ) => Promise<TTableRecord>;
  atomicUpdate: (
    pk: string,
    sk: string | undefined,
    updater: (
      current: TTableRecord | undefined,
    ) => Promise<Partial<TTableRecord> & { pk: string }>,
    options?: { maxRetries?: number },
  ) => Promise<TTableRecord>;
};

export type DatabaseSchema = {
  "next-auth": TableAPI<"next-auth">;
  workspace: TableAPI<"workspace">;
  permission: TableAPI<"permission">;
  agent: TableAPI<"agent">;
  "agent-key": TableAPI<"agent-key">;
  "workspace-api-key": TableAPI<"workspace-api-key">;
  "workspace-document": TableAPI<"workspace-document">;
  output_channel: TableAPI<"output_channel">;
  "agent-conversations": TableAPI<"agent-conversations">;
  "credit-reservations": TableAPI<"credit-reservations">;
  "token-usage-aggregates": TableAPI<"token-usage-aggregates">;
  "tool-usage-aggregates": TableAPI<"tool-usage-aggregates">;
  "email-connection": TableAPI<"email-connection">;
  "mcp-server": TableAPI<"mcp-server">;
  "trial-credit-requests": TableAPI<"trial-credit-requests">;
  subscription: TableAPI<"subscription">;
  "request-buckets": TableAPI<"request-buckets">;
  "workspace-invite": TableAPI<"workspace-invite">;
  "agent-stream-servers": TableAPI<"agent-stream-servers">;
  "user-api-key": TableAPI<"user-api-key">;
  "user-refresh-token": TableAPI<"user-refresh-token">;
  "workspace-credit-transactions": TableAPI<"workspace-credit-transactions">;
  "agent-delegation-tasks": TableAPI<"agent-delegation-tasks">;
  "bot-integration": TableAPI<"bot-integration">;
  "agent-schedule": TableAPI<"agent-schedule">;
};

/**
 * Specification for a record to fetch in an atomic update operation
 */
export type RecordSpec = {
  table: TableName;
  pk: string;
  sk?: string;
};

/**
 * Map of record specifications keyed by string identifiers
 * Used to specify which records to fetch for an atomic update
 */
export type AtomicUpdateRecordSpec = Map<string, RecordSpec>;

/**
 * Union type of all possible table record types
 */
export type TableRecord =
  | z.infer<(typeof tableSchemas)["next-auth"]>
  | z.infer<typeof tableSchemas.workspace>
  | z.infer<typeof tableSchemas.permission>
  | z.infer<typeof tableSchemas.agent>
  | z.infer<(typeof tableSchemas)["agent-key"]>
  | z.infer<(typeof tableSchemas)["workspace-api-key"]>
  | z.infer<(typeof tableSchemas)["workspace-document"]>
  | z.infer<typeof tableSchemas.output_channel>
  | z.infer<(typeof tableSchemas)["agent-conversations"]>
  | z.infer<(typeof tableSchemas)["credit-reservations"]>
  | z.infer<(typeof tableSchemas)["token-usage-aggregates"]>
  | z.infer<(typeof tableSchemas)["tool-usage-aggregates"]>
  | z.infer<(typeof tableSchemas)["email-connection"]>
  | z.infer<(typeof tableSchemas)["mcp-server"]>
  | z.infer<(typeof tableSchemas)["trial-credit-requests"]>
  | z.infer<typeof tableSchemas.subscription>
  | z.infer<(typeof tableSchemas)["request-buckets"]>
  | z.infer<(typeof tableSchemas)["workspace-invite"]>
  | z.infer<(typeof tableSchemas)["agent-stream-servers"]>
  | z.infer<(typeof tableSchemas)["user-api-key"]>
  | z.infer<(typeof tableSchemas)["user-refresh-token"]>
  | z.infer<(typeof tableSchemas)["workspace-credit-transactions"]>
  | z.infer<(typeof tableSchemas)["bot-integration"]>
  | z.infer<(typeof tableSchemas)["agent-schedule"]>;

/**
 * Callback function for atomic update operations
 * Receives a Map of fetched records (or undefined if not found) and returns
 * an array of TableRecords to put in the transaction
 */
export type AtomicUpdateCallback = (
  records: Map<string, TableRecord | undefined>,
) => Promise<TableRecord[]> | TableRecord[];

/**
 * Extended DatabaseSchema with atomicUpdate method for multi-table transactions
 */
export type DatabaseSchemaWithAtomicUpdate = DatabaseSchema & {
  atomicUpdate: (
    recordSpec: AtomicUpdateRecordSpec,
    callback: AtomicUpdateCallback,
  ) => Promise<TableRecord[]>;
};
