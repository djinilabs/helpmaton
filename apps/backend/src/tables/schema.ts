import { z } from "zod";

const TableBaseSchema = z.object({
  pk: z.string(),
  sk: z.string().optional(),
  version: z.number(),
  createdAt: z.string().datetime(),
  createdBy: z.string().optional(),
  updatedAt: z.string().datetime().optional(),
  updatedBy: z.string().optional(),
  noMainVersion: z.boolean().optional(),
  userVersion: z.string().optional(),
  userVersions: z
    .record(
      z.string(),
      z.object({
        deleted: z.boolean().optional(),
        createdAt: z.string().datetime().optional(),
        createdBy: z.string().optional(),
        updatedAt: z.string().datetime().optional(),
        updatedBy: z.string().optional(),
        newProps: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .optional(),
});

export const tableSchemas = {
  "next-auth": TableBaseSchema.extend({
    pk: z.string(),
    sk: z.string(),
    email: z.string().email().optional(),
    name: z.string().optional(),
    emailVerified: z.string().datetime().optional(),
    image: z.string().optional(),
    id: z.string().optional(),
    type: z.string().optional(), // "USER" for user records, undefined for account records
    gsi1pk: z.string().optional(), // GSI1 partition key for email lookups
    gsi1sk: z.string().optional(), // GSI1 sort key for email lookups
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
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
    creditBalance: z.number().int().default(0), // millionths
    spendingLimits: z
      .array(
        z.object({
          timeFrame: z.enum(["daily", "weekly", "monthly"]),
          amount: z.number().int(), // millionths
        })
      )
      .optional(),
    // Trial credit fields (internal only - not exposed to users)
    trialCreditRequested: z.boolean().optional(),
    trialCreditRequestedAt: z.string().datetime().optional(),
    trialCreditApproved: z.boolean().optional(),
    trialCreditApprovedAt: z.string().datetime().optional(),
    trialCreditAmount: z.number().int().optional(), // millionths
    // Lemon Squeezy integration fields
    lemonSqueezyOrderId: z.string().optional(), // Lemon Squeezy order ID for credit purchases
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
  }),
  permission: TableBaseSchema.extend({
    pk: z.string(), // resource reference (e.g., "workspaces/{workspaceId}")
    sk: z.string(), // user reference (e.g., "users/{userId}")
    resourceType: z.string(), // "workspaces"
    parentPk: z.string().optional(), // optional parent resource
    type: z.number().int().min(1), // permission level (1=READ, 2=WRITE, 3=OWNER)
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
  }),
  agent: TableBaseSchema.extend({
    pk: z.string(), // agent ID (e.g., "agents/{workspaceId}/{agentId}")
    sk: z.string().optional(), // optional sort key
    workspaceId: z.string(), // workspace ID for GSI queries
    name: z.string(),
    systemPrompt: z.string(),
    notificationChannelId: z.string().optional(), // reference to output_channel
    delegatableAgentIds: z.array(z.string()).optional(), // list of agent IDs this agent can delegate to
    enabledMcpServerIds: z.array(z.string()).optional(), // list of MCP server IDs enabled for this agent
    enableMemorySearch: z.boolean().optional(), // enable memory search tool for this agent (default: false)
    enableSearchDocuments: z.boolean().optional(), // enable document search tool for this agent (default: false)
    enableSendEmail: z.boolean().optional(), // enable email sending tool for this agent (default: false, requires workspace email connection)
    enableTavilySearch: z.boolean().optional(), // @deprecated Use searchWebProvider instead. Legacy field for backward compatibility (default: false)
    searchWebProvider: z.enum(["tavily", "jina"]).optional(), // Web search provider: "tavily" uses Tavily search API, "jina" uses Jina DeepSearch API (default: undefined, no search tool)
    enableTavilyFetch: z.boolean().optional(), // @deprecated Use fetchWebProvider instead. Legacy field for backward compatibility (default: false)
    fetchWebProvider: z.enum(["tavily", "jina"]).optional(), // Web fetch provider: "tavily" uses Tavily extract API, "jina" uses Jina Reader API (default: undefined, no fetch tool)
    enableExaSearch: z.boolean().optional(), // enable Exa.ai search tool for this agent (default: false)
    spendingLimits: z
      .array(
        z.object({
          timeFrame: z.enum(["daily", "weekly", "monthly"]),
          amount: z.number().int(), // millionths
        })
      )
      .optional(),
    temperature: z.number().min(0).max(2).optional(), // model temperature (0-2, controls randomness)
    topP: z.number().min(0).max(1).optional(), // top-p / nucleus sampling (0-1)
    topK: z.number().int().positive().optional(), // top-k sampling (positive integer)
    maxOutputTokens: z.number().int().positive().optional(), // max output tokens (positive integer)
    stopSequences: z.array(z.string()).optional(), // stop sequences (array of strings)
    maxToolRoundtrips: z.number().int().positive().optional(), // max tool roundtrips (positive integer, default 5)
    provider: z.enum(["google", "openai", "anthropic"]).default("google"), // provider name (only "google" supported)
    modelName: z.string().optional(), // model name (e.g., "gemini-2.5-flash")
    clientTools: z
      .array(
        z.object({
          name: z.string(), // Tool name and function name (must be valid JavaScript identifier)
          description: z.string(), // Tool description for AI
          parameters: z.record(z.string(), z.unknown()), // JSON Schema for parameters (compatible with AI SDK)
        })
      )
      .optional(), // User-defined client-side tools
    avatar: z.string().optional(), // Avatar image path (e.g., "/images/helpmaton_logo_10.svg")
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
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
    createdAt: z.string().datetime().default(new Date().toISOString()),
  }),
  "agent-key": TableBaseSchema.extend({
    pk: z.string(), // agent-key ID (e.g., "agent-keys/{workspaceId}/{agentId}/{keyId}")
    sk: z.string(), // sort key (e.g., "key")
    workspaceId: z.string(), // workspace ID
    agentId: z.string(), // agent ID for GSI queries
    key: z.string(), // the actual key value
    name: z.string().optional(), // optional key name/description
    provider: z.enum(["google"]).default("google"), // provider name (only "google" supported)
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
  }),
  "workspace-api-key": TableBaseSchema.extend({
    pk: z.string(), // workspace-api-key ID (e.g., "workspace-api-keys/{workspaceId}/{provider}")
    sk: z.string(), // sort key (fixed value "key")
    workspaceId: z.string(), // workspace ID for GSI queries
    key: z.string(), // the actual API key value
    provider: z.enum(["openrouter"]).default("openrouter"), // provider name (only OpenRouter is supported for BYOK)
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
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
    createdAt: z.string().datetime().default(new Date().toISOString()),
  }),
  "agent-conversations": TableBaseSchema.extend({
    pk: z.string(), // conversation ID (e.g., "conversations/{workspaceId}/{agentId}/{conversationId}")
    sk: z.string().optional(), // optional sort key
    workspaceId: z.string(), // workspace ID
    agentId: z.string(), // agent ID for GSI queries
    conversationId: z.string(), // unique conversation ID (UUID)
    conversationType: z.enum(["test", "webhook", "stream"]), // type of conversation
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
        occurredAt: z.string().datetime().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
    costUsd: z.number().int().optional(), // cost in USD in millionths
    totalGenerationTimeMs: z.number().optional(), // sum of all generation times in milliseconds
    awsRequestIds: z.array(z.string()).optional(), // array of AWS Lambda/API Gateway request IDs that added messages to this conversation
    delegations: z
      .array(
        z.object({
          callingAgentId: z.string(),
          targetAgentId: z.string(),
          taskId: z.string().optional(),
          timestamp: z.string().datetime(),
          status: z.enum(["completed", "failed", "cancelled"]),
        })
      )
      .optional(), // array of delegation calls made during this conversation
    startedAt: z.string().datetime(), // when conversation started
    lastMessageAt: z.string().datetime(), // when last message was added
    expires: z.number(), // TTL timestamp
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
  }),
  "credit-reservations": TableBaseSchema.extend({
    pk: z.string(), // reservation ID (e.g., "credit-reservations/{reservationId}")
    workspaceId: z.string(), // workspace ID
    agentId: z.string().optional(), // agent ID (if transaction is associated with an agent)
    conversationId: z.string().optional(), // conversation ID (if transaction is associated with a conversation)
    reservedAmount: z.number().int(), // amount reserved (estimated cost) in millionths
    estimatedCost: z.number().int(), // estimated cost at reservation time in millionths
    currency: z.enum(["usd"]), // workspace currency
    expires: z.number(), // TTL timestamp (15 minutes from creation)
    expiresHour: z.number(), // Hour bucket for GSI (expires truncated to hour)
    // OpenRouter cost verification fields
    openrouterGenerationId: z.string().optional(), // OpenRouter generation ID for cost lookup (deprecated but still used for backward compatibility)
    // New fields for multiple generation tracking
    openrouterGenerationIds: z.array(z.string()).optional(), // All generation IDs from this request
    expectedGenerationCount: z.number().optional(), // Total expected count
    verifiedGenerationIds: z.array(z.string()).optional(), // IDs that have been verified
    verifiedCosts: z.array(z.number().int()).optional(), // Costs in millionths for each verified generation
    allGenerationsVerified: z.boolean().optional(), // Flag indicating all generations have been verified
    totalOpenrouterCost: z.number().int().optional(), // Sum of all verified costs (for finalization)
    provider: z.string().optional(), // Provider used (for tracking)
    modelName: z.string().optional(), // Model used (for tracking)
    tokenUsageBasedCost: z.number().int().optional(), // Cost calculated from token usage (step 2) in millionths
    openrouterCost: z.number().int().optional(), // Cost from OpenRouter API (step 3) in millionths
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
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
    provider: z.string(), // provider name (e.g., "google")
    usesByok: z.boolean().optional(), // whether this aggregate includes BYOK usage
    inputTokens: z.number(), // total input tokens for this aggregate
    outputTokens: z.number(), // total output tokens for this aggregate
    totalTokens: z.number(), // total tokens
    costUsd: z.number().int(), // total cost in USD in millionths
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
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
    costUsd: z.number().int(), // total cost in USD in millionths
    callCount: z.number().int(), // number of tool calls
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
  }),
  "email-connection": TableBaseSchema.extend({
    pk: z.string(), // email-connection ID (e.g., "email-connections/{workspaceId}")
    sk: z.string().optional(), // optional sort key (fixed value "connection")
    workspaceId: z.string(), // workspace ID for GSI queries
    type: z.enum(["gmail", "outlook", "smtp"]), // provider type
    name: z.string(), // user-friendly name for the connection
    config: z.record(z.string(), z.unknown()), // type-specific configuration, encrypted
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
  }),
  "mcp-server": TableBaseSchema.extend({
    pk: z.string(), // mcp-server ID (e.g., "mcp-servers/{workspaceId}/{serverId}")
    sk: z.string().optional(), // optional sort key (fixed value "server")
    workspaceId: z.string(), // workspace ID for GSI queries
    name: z.string(), // user-friendly name for the server
    url: z.string().url(), // MCP server URL
    authType: z.enum(["none", "header", "basic"]), // authentication type
    config: z.record(z.string(), z.unknown()), // authentication configuration, encrypted
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
  }),
  "trial-credit-requests": TableBaseSchema.extend({
    pk: z.string(), // trial-credit-requests ID (e.g., "trial-credit-requests/{workspaceId}")
    sk: z.string().optional(), // optional sort key (fixed value "request")
    workspaceId: z.string(), // workspace ID
    userId: z.string(), // user ID who requested
    userEmail: z.string().email(), // user email
    currency: z.enum(["usd"]), // workspace currency
    requestedAt: z.string().datetime(), // when request was made
    status: z.enum(["pending", "approved", "rejected"]).default("pending"),
    approvedAt: z.string().datetime().optional(), // when approved
    approvedBy: z.string().optional(), // Discord user ID or admin identifier
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
  }),
  subscription: TableBaseSchema.extend({
    pk: z.string(), // subscription ID (e.g., "subscriptions/{subscriptionId}")
    sk: z.string().optional(), // optional sort key (fixed value "subscription")
    userId: z.string(), // user ID who owns the subscription (for GSI queries)
    plan: z.enum(["free", "starter", "pro"]),
    expiresAt: z.string().datetime().optional(), // expiration date (deprecated - free plans no longer expire)
    apiKeyId: z.string().optional(), // API Gateway API key ID for throttling
    lastLimitEmailSentAt: z.string().datetime().optional(), // last time limit email was sent
    lastCreditErrorEmailSentAt: z.string().datetime().optional(), // last time credit error email was sent
    lastSpendingLimitErrorEmailSentAt: z.string().datetime().optional(), // last time spending limit error email was sent
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
    renewsAt: z.string().datetime().optional(), // Next renewal date (ISO datetime)
    endsAt: z.string().datetime().optional(), // Subscription end date if cancelled (ISO datetime)
    trialEndsAt: z.string().datetime().optional(), // Trial end date (ISO datetime)
    gracePeriodEndsAt: z.string().datetime().optional(), // Grace period end date for failed payments (7 days from past_due)
    lastSyncedAt: z.string().datetime().optional(), // Last time subscription was synced from Lemon Squeezy
    lastPaymentEmailSentAt: z.string().datetime().optional(), // Last time payment issue email was sent
    lemonSqueezySyncKey: z.string().optional(), // GSI partition key for querying all Lemon Squeezy subscriptions (set to "ACTIVE" when subscription has Lemon Squeezy ID)
    // Note: Using a single partition key value ("ACTIVE") could create a hot partition if there are many subscriptions.
    // For high-scale scenarios, consider sharding (e.g., "ACTIVE#YYYY-MM" for monthly sharding) to distribute load.
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
  }),
  "request-buckets": TableBaseSchema.extend({
    pk: z.string(), // bucket ID (e.g., "request-buckets/{subscriptionId}/{category}/{hourTimestamp}")
    subscriptionId: z.string(), // subscription ID for GSI queries
    category: z.enum(["llm", "search", "fetch"]), // request category
    categoryHourTimestamp: z.string().optional(), // composite sort key for GSI: "{category}#{hourTimestamp}"
    hourTimestamp: z.string().datetime(), // ISO timestamp truncated to hour (YYYY-MM-DDTHH:00:00.000Z)
    count: z.number().default(0), // request count for this hour
    expires: z.number(), // TTL timestamp (25 hours from bucket hour)
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
  }),
  "workspace-invite": TableBaseSchema.extend({
    pk: z.string(), // workspace-invite ID (e.g., "workspace-invites/{workspaceId}/{inviteId}")
    sk: z.string(), // sort key (fixed value "invite")
    workspaceId: z.string(), // workspace ID
    email: z.string().email(), // invited user email (normalized to lowercase)
    token: z.string(), // unique, cryptographically secure token
    permissionLevel: z.number().int().min(1).max(3), // permission level (1=READ, 2=WRITE, 3=OWNER)
    invitedBy: z.string(), // userRef of inviter
    expiresAt: z.string().datetime(), // expiration date (ISO datetime)
    acceptedAt: z.string().datetime().optional(), // when invite was accepted
    acceptedBy: z.string().optional(), // userRef of user who accepted
    expires: z.number(), // TTL timestamp for DynamoDB
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
  }),
  "agent-stream-servers": TableBaseSchema.extend({
    pk: z.string(), // stream-server ID (e.g., "stream-servers/{workspaceId}/{agentId}")
    sk: z.string(), // sort key (fixed value "config")
    workspaceId: z.string(), // workspace ID
    agentId: z.string(), // agent ID
    secret: z.string(), // secret used in path parameter (stored as plain text; encrypted at rest by DynamoDB table-level encryption)
    allowedOrigins: z.array(z.string()), // array of allowed origins or ["*"] for wildcard
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
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
    lastUsedAt: z.string().datetime().optional(), // timestamp for tracking usage
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
  }),
  "user-refresh-token": TableBaseSchema.extend({
    pk: z.string(), // composite partition key for user's refresh tokens (e.g., "user-refresh-tokens/{userId}")
    sk: z.string(), // sort key (tokenId UUID)
    userId: z.string(), // user ID extracted from pk for reference
    tokenHash: z.string(), // scrypt hash of the refresh token (base64 encoded)
    tokenSalt: z.string(), // salt used for hashing (base64 encoded)
    tokenLookupHash: z.string(), // SHA256 hash of the plain token for GSI lookup (hex encoded)
    expiresAt: z.string().datetime(), // expiration timestamp
    lastUsedAt: z.string().datetime().optional(), // timestamp for tracking usage
    revokedAt: z.string().datetime().optional(), // revocation timestamp (if revoked)
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
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
    amountMillionthUsd: z.number().int(), // should be integer
    workspaceCreditsBeforeMillionthUsd: z.number().int(), // the expected credits before applying this transaction
    workspaceCreditsAfterMillionthUsd: z.number().int(), // the expected credits after applying this transaction
    version: z.number().default(1),
    createdAt: z.string().datetime().default(new Date().toISOString()),
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
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
    ttl: z.number().optional(), // 7 days TTL timestamp
    gsi1pk: z.string(), // "workspace/{workspaceId}/agent/{callingAgentId}"
    gsi1sk: z.string(), // "{createdAt}"
  }),
} as const;

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
  | "agent-delegation-tasks";

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
  >
> = {
  delete: (
    key: string,
    sk?: string,
    version?: string | null
  ) => Promise<TTableRecord>;
  deleteIfExists: (
    key: string,
    sk?: string,
    version?: string | null
  ) => Promise<TTableRecord | undefined>;
  deleteAll: (key: string, version?: string | null) => Promise<void>;
  get: (
    pk: string,
    sk?: string,
    version?: string | null
  ) => Promise<TTableRecord | undefined>;
  batchGet: (
    keys: string[],
    version?: string | null
  ) => Promise<TTableRecord[]>;
  update: (
    item: Partial<TTableRecord>,
    version?: string | null
  ) => Promise<TTableRecord>;
  upsert: (
    item: Omit<TTableRecord, "version">,
    version?: string | null
  ) => Promise<TTableRecord>;
  create: (
    item: Omit<TTableRecord, "version" | "createdAt">,
    version?: string | null
  ) => Promise<TTableRecord>;
  query: (
    query: Query,
    version?: string | null
  ) => Promise<QueryResponse<TTableRecord>>;
  queryPaginated: (
    query: Query,
    options: {
      limit: number;
      cursor?: string | null;
      version?: string | null;
    }
  ) => Promise<{
    items: TTableRecord[];
    nextCursor: string | null;
  }>;
  queryAsync: (
    query: Query,
    version?: string | null
  ) => AsyncGenerator<TTableRecord, void, unknown>;
  merge: (
    pk: string,
    sk: string,
    version: string | null
  ) => Promise<TTableRecord>;
  revert: (
    pk: string,
    sk: string | undefined,
    version: string
  ) => Promise<TTableRecord>;
  atomicUpdate: (
    pk: string,
    sk: string | undefined,
    updater: (
      current: TTableRecord | undefined
    ) => Promise<Partial<TTableRecord> & { pk: string }>,
    options?: { maxRetries?: number }
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
  | z.infer<(typeof tableSchemas)["workspace-credit-transactions"]>;

/**
 * Callback function for atomic update operations
 * Receives a Map of fetched records (or undefined if not found) and returns
 * an array of TableRecords to put in the transaction
 */
export type AtomicUpdateCallback = (
  records: Map<string, TableRecord | undefined>
) => Promise<TableRecord[]> | TableRecord[];

/**
 * Extended DatabaseSchema with atomicUpdate method for multi-table transactions
 */
export type DatabaseSchemaWithAtomicUpdate = DatabaseSchema & {
  atomicUpdate: (
    recordSpec: AtomicUpdateRecordSpec,
    callback: AtomicUpdateCallback
  ) => Promise<TableRecord[]>;
};
