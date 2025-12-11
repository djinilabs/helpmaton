# Database Schema

This document describes the DynamoDB database schema used by Helpmaton, including all tables, indexes, and data access patterns.

## Overview

Helpmaton uses DynamoDB as its primary database, with 22 tables storing different types of data. All tables use encryption at rest and support optimistic locking via version numbers.

## Table Structure

### Common Fields

All tables inherit from a base schema with these common fields:

- `pk` (String, required): Partition key - unique identifier for the record
- `sk` (String, optional): Sort key - used for composite keys and sorting
- `version` (Number, default: 1): Optimistic locking version number
- `createdAt` (String, ISO datetime): Creation timestamp
- `createdBy` (String, optional): User reference who created the record
- `updatedAt` (String, optional): Last update timestamp
- `updatedBy` (String, optional): User reference who last updated the record

### Encryption

All tables are configured with `encrypt true` in `app.arc`, meaning DynamoDB encrypts data at rest using AWS-managed keys.

## Tables

### 1. `next-auth`

**Purpose**: Authentication and user management (NextAuth.js/Auth.js)

**Partition Key**: `pk` (String)
**Sort Key**: `sk` (String)

**Fields**:

- `email` (String, optional): User email address
- `name` (String, optional): User display name
- `emailVerified` (String, optional): Email verification timestamp
- `image` (String, optional): User avatar URL
- `id` (String, optional): User ID
- `type` (String, optional): "USER" for user records, undefined for account records
- `gsi1pk` (String, optional): GSI partition key for email lookups
- `gsi1sk` (String, optional): GSI sort key for email lookups
- `expires` (Number, optional): TTL timestamp for temporary records
- `identifier` (String, optional): Account identifier
- `token` (String, optional): Session or verification token

**Global Secondary Indexes**:

- **GSI2** (`gsi1pk`, `gsi1sk`): Email-based user lookups

**Access Patterns**:

- Look up user by email: Query GSI2 with `gsi1pk = email`
- Get user by ID: Get with `pk = users/{userId}`, `sk = user`
- Get account by provider: Get with `pk = users/{userId}`, `sk = accounts/{provider}`

### 2. `webhook-logs`

**Purpose**: Temporary storage of webhook request logs

**Partition Key**: `pk` (String) - unique request ID
**Sort Key**: `sk` (String, optional)

**Fields**:

- `userId` (String): User ID who made the request
- `key` (String): Agent key used
- `body` (String): Raw webhook body text
- `expires` (Number): TTL timestamp (automatic cleanup)

**TTL**: Yes - records expire automatically

**Access Patterns**:

- Log webhook request: Create with unique request ID
- Retrieve log: Get with `pk = requestId`

### 3. `workspace`

**Purpose**: Workspace data, credit balances, and spending limits

**Partition Key**: `pk` (String) - `workspaces/{workspaceId}`
**Sort Key**: `sk` (String, optional)

**Fields**:

- `name` (String): Workspace name
- `description` (String, optional): Workspace description
- `subscriptionId` (String, optional): Subscription ID this workspace belongs to
- `currency` (Enum: "usd" | "eur" | "gbp", default: "usd"): Workspace currency
- `creditBalance` (Number, default: 0): Current credit balance
- `spendingLimits` (Array, optional): Workspace-level spending limits
  - `timeFrame`: "daily" | "weekly" | "monthly"
  - `amount`: Limit amount
- `trialCreditRequested` (Boolean, optional): Internal flag
- `trialCreditRequestedAt` (String, optional): Request timestamp
- `trialCreditApproved` (Boolean, optional): Approval status
- `trialCreditApprovedAt` (String, optional): Approval timestamp
- `trialCreditAmount` (Number, optional): Approved amount

**Global Secondary Indexes**:

- **bySubscriptionId** (`subscriptionId`, `pk`): Find all workspaces for a subscription

**Access Patterns**:

- Get workspace: Get with `pk = workspaces/{workspaceId}`, `sk = workspace`
- List workspaces by subscription: Query GSI with `subscriptionId = {id}`
- Atomic credit update: Use `atomicUpdate` for credit reservation/adjustment

### 4. `permission`

**Purpose**: Access control permissions for resources

**Partition Key**: `pk` (String) - resource reference (e.g., `workspaces/{workspaceId}`)
**Sort Key**: `sk` (String) - user reference (e.g., `users/{userId}`)

**Fields**:

- `resourceType` (String): Type of resource ("workspaces", "subscriptions", etc.)
- `parentPk` (String, optional): Parent resource reference
- `type` (Number, min: 1): Permission level (1=READ, 2=WRITE, 3=OWNER)

**Global Secondary Indexes**:

- **byResourceTypeAndEntityId** (`resourceType`, `sk`): Find permissions by resource type and user

**Access Patterns**:

- Get user permission: Get with `pk = resourceRef`, `sk = users/{userId}`
- List permissions for resource: Query with `pk = resourceRef`
- Find user permissions by type: Query GSI with `resourceType = {type}`, `sk = users/{userId}`

### 5. `agent`

**Purpose**: AI agent configurations

**Partition Key**: `pk` (String) - `agents/{workspaceId}/{agentId}`
**Sort Key**: `sk` (String, optional)

**Fields**:

- `workspaceId` (String): Workspace ID for GSI queries
- `name` (String): Agent name
- `systemPrompt` (String): System prompt defining agent behavior
- `notificationChannelId` (String, optional): Reference to output_channel
- `delegatableAgentIds` (Array, optional): List of agent IDs this agent can delegate to
- `enabledMcpServerIds` (Array, optional): List of MCP server IDs enabled for this agent
- `spendingLimits` (Array, optional): Agent-level spending limits
- `temperature` (Number, 0-2, optional): Model temperature
- `topP` (Number, 0-1, optional): Top-p sampling
- `topK` (Number, positive, optional): Top-k sampling
- `maxOutputTokens` (Number, positive, optional): Maximum output tokens
- `stopSequences` (Array of strings, optional): Stop sequences
- `maxToolRoundtrips` (Number, positive, optional): Max tool roundtrips (default: 5)
- `provider` (Enum: "google" | "openai" | "anthropic", default: "google"): LLM provider
- `modelName` (String, optional): Model name (e.g., "gemini-2.5-flash")
- `clientTools` (Array, optional): User-defined client-side tools
  - `name`: Tool name (must be valid JavaScript identifier)
  - `description`: Tool description for AI
  - `parameters`: JSON Schema for parameters

**Global Secondary Indexes**:

- **byWorkspaceId** (`workspaceId`, `pk`): Find all agents in a workspace

**Access Patterns**:

- Get agent: Get with `pk = agents/{workspaceId}/{agentId}`, `sk = agent`
- List agents in workspace: Query GSI with `workspaceId = {id}`

### 6. `agent-key`

**Purpose**: API keys for agent webhook authentication

**Partition Key**: `pk` (String) - `agent-keys/{workspaceId}/{agentId}/{keyId}`
**Sort Key**: `sk` (String) - fixed value "key"

**Fields**:

- `workspaceId` (String): Workspace ID
- `agentId` (String): Agent ID for GSI queries
- `key` (String): The actual key value (encrypted at rest)
- `name` (String, optional): Optional key name/description
- `provider` (Enum: "google", default: "google"): Provider name

**Global Secondary Indexes**:

- **byAgentId** (`agentId`, `pk`): Find all keys for an agent

**Access Patterns**:

- Get agent key: Get with `pk = agent-keys/{workspaceId}/{agentId}/{keyId}`, `sk = key`
- List keys for agent: Query GSI with `agentId = {id}`

### 7. `workspace-api-key`

**Purpose**: Workspace-level API keys for BYOK (Bring Your Own Key)

**Partition Key**: `pk` (String) - `workspace-api-keys/{workspaceId}`
**Sort Key**: `sk` (String) - fixed value "key"

**Fields**:

- `workspaceId` (String): Workspace ID for GSI queries
- `key` (String): The actual API key value (encrypted at rest)
- `provider` (Enum: "google", default: "google"): Provider name

**Global Secondary Indexes**:

- **byWorkspaceId** (`workspaceId`, `pk`): Find workspace API key

**Access Patterns**:

- Get workspace API key: Get with `pk = workspace-api-keys/{workspaceId}`, `sk = key`
- Query by workspace: Query GSI with `workspaceId = {id}`

### 8. `workspace-document`

**Purpose**: Document metadata (actual files stored in S3)

**Partition Key**: `pk` (String) - `workspace-documents/{workspaceId}/{documentId}`
**Sort Key**: `sk` (String, optional)

**Fields**:

- `workspaceId` (String): Workspace ID for GSI queries
- `name` (String): User-friendly display name (editable)
- `filename` (String): Actual filename in S3 (may have conflict suffix)
- `folderPath` (String): Folder path (e.g., "folder1/subfolder" or "" for root)
- `s3Key` (String): S3 key for the document
- `contentType` (String): MIME type (e.g., "text/markdown", "text/plain")
- `size` (Number): File size in bytes

**Global Secondary Indexes**:

- **byWorkspaceId** (`workspaceId`, `pk`): Find all documents in a workspace

**Access Patterns**:

- Get document: Get with `pk = workspace-documents/{workspaceId}/{documentId}`, `sk = document`
- List documents in workspace: Query GSI with `workspaceId = {id}`
- Filter by folder: Query GSI and filter by `folderPath`

### 9. `output_channel`

**Purpose**: Output channels for agent notifications (Discord, etc.)

**Partition Key**: `pk` (String) - `output-channels/{workspaceId}/{channelId}`
**Sort Key**: `sk` (String, optional)

**Fields**:

- `workspaceId` (String): Workspace ID for GSI queries
- `channelId` (String): Unique identifier for the channel
- `type` (String): Discriminator ("discord", future: "slack", "email", etc.)
- `name` (String): User-friendly name for the channel
- `config` (Record): Type-specific configuration (encrypted)

**Global Secondary Indexes**:

- **byWorkspaceId** (`workspaceId`, `pk`): Find all channels in a workspace

**Access Patterns**:

- Get channel: Get with `pk = output-channels/{workspaceId}/{channelId}`, `sk = channel`
- List channels in workspace: Query GSI with `workspaceId = {id}`

### 10. `agent-conversations`

**Purpose**: Conversation history and token usage tracking

**Partition Key**: `pk` (String) - `conversations/{workspaceId}/{agentId}/{conversationId}`
**Sort Key**: `sk` (String, optional)

**Fields**:

- `workspaceId` (String): Workspace ID
- `agentId` (String): Agent ID for GSI queries
- `conversationId` (String): Unique conversation ID (UUID)
- `conversationType` (Enum: "test" | "webhook" | "stream"): Type of conversation
- `messages` (Array): Array of all messages in the conversation
- `toolCalls` (Array, optional): Array of all tool calls
- `toolResults` (Array, optional): Array of all tool results
- `tokenUsage` (Object, optional): Aggregated token usage
  - `promptTokens`: Number
  - `completionTokens`: Number
  - `totalTokens`: Number
- `modelName` (String, optional): AI model name
- `provider` (String, optional): AI provider name
- `usesByok` (Boolean, optional): Whether conversation used BYOK
- `costUsd` (Number, optional): Cost in USD
- `costEur` (Number, optional): Cost in EUR
- `costGbp` (Number, optional): Cost in GBP
- `startedAt` (String, ISO datetime): When conversation started
- `lastMessageAt` (String, ISO datetime): When last message was added
- `expires` (Number): TTL timestamp

**Global Secondary Indexes**:

- **byAgentId** (`agentId`, `pk`): Find all conversations for an agent

**TTL**: Yes - conversations expire automatically

**Access Patterns**:

- Get conversation: Get with `pk = conversations/{workspaceId}/{agentId}/{conversationId}`
- List conversations for agent: Query GSI with `agentId = {id}`

### 11. `credit-reservations`

**Purpose**: Temporary credit reservations before LLM calls

**Partition Key**: `pk` (String) - `credit-reservations/{reservationId}`
**Sort Key**: None

**Fields**:

- `workspaceId` (String): Workspace ID
- `reservedAmount` (Number): Amount reserved (estimated cost)
- `estimatedCost` (Number): Estimated cost at reservation time
- `currency` (Enum: "usd" | "eur" | "gbp"): Workspace currency
- `expires` (Number): TTL timestamp (15 minutes from creation)
- `expiresHour` (Number): Hour bucket for GSI (expires truncated to hour)

**Global Secondary Indexes**:

- **byExpiresHour** (`expiresHour`, `expires`): Find reservations expiring in a time range

**TTL**: Yes - reservations expire after 15 minutes

**Access Patterns**:

- Create reservation: Create with unique reservation ID
- Get reservation: Get with `pk = credit-reservations/{reservationId}`
- Cleanup expired: Query GSI with `expiresHour = {hour}` and filter by `expires < now`

### 12. `token-usage-aggregates`

**Purpose**: Daily aggregated token usage statistics

**Partition Key**: `pk` (String) - `aggregates/{workspaceId}/{date}` or `aggregates/{userId}/{date}` or `aggregates/{agentId}/{date}`
**Sort Key**: `sk` (String, optional)

**Fields**:

- `date` (String): Date in YYYY-MM-DD format
- `aggregateType` (Enum: "workspace" | "agent" | "user"): Type of aggregation
- `workspaceId` (String, optional): Workspace ID (required for workspace/agent aggregates)
- `agentId` (String, optional): Agent ID (required for agent aggregates)
- `userId` (String, optional): User ID (required for user aggregates)
- `modelName` (String): Model name
- `provider` (String): Provider name (e.g., "google")
- `usesByok` (Boolean, optional): Whether aggregate includes BYOK usage
- `inputTokens` (Number): Total input tokens
- `outputTokens` (Number): Total output tokens
- `totalTokens` (Number): Total tokens
- `costUsd` (Number): Total cost in USD
- `costEur` (Number): Total cost in EUR
- `costGbp` (Number): Total cost in GBP

**Global Secondary Indexes**:

- **byWorkspaceIdAndDate** (`workspaceId`, `date`): Find workspace aggregates by date
- **byAgentIdAndDate** (`agentId`, `date`): Find agent aggregates by date
- **byUserIdAndDate** (`userId`, `date`): Find user aggregates by date

**Access Patterns**:

- Get workspace aggregate: Get with `pk = aggregates/{workspaceId}/{date}`
- List workspace aggregates: Query GSI with `workspaceId = {id}`, `date BETWEEN start AND end`
- Get agent aggregate: Get with `pk = aggregates/{agentId}/{date}`
- List agent aggregates: Query GSI with `agentId = {id}`, `date BETWEEN start AND end`

### 13. `email-connection`

**Purpose**: Email service connections (Gmail, Outlook, SMTP)

**Partition Key**: `pk` (String) - `email-connections/{workspaceId}`
**Sort Key**: `sk` (String, optional) - fixed value "connection"

**Fields**:

- `workspaceId` (String): Workspace ID for GSI queries
- `type` (Enum: "gmail" | "outlook" | "smtp"): Provider type
- `name` (String): User-friendly name for the connection
- `config` (Record): Type-specific configuration (encrypted)

**Global Secondary Indexes**:

- **byWorkspaceId** (`workspaceId`, `pk`): Find email connection for workspace

**Access Patterns**:

- Get email connection: Get with `pk = email-connections/{workspaceId}`, `sk = connection`
- Query by workspace: Query GSI with `workspaceId = {id}`

### 14. `mcp-server`

**Purpose**: MCP (Model Context Protocol) server configurations

**Partition Key**: `pk` (String) - `mcp-servers/{workspaceId}/{serverId}`
**Sort Key**: `sk` (String, optional) - fixed value "server"

**Fields**:

- `workspaceId` (String): Workspace ID for GSI queries
- `name` (String): User-friendly name for the server
- `url` (String, URL): MCP server URL
- `authType` (Enum: "none" | "header" | "basic"): Authentication type
- `config` (Record): Authentication configuration (encrypted)

**Global Secondary Indexes**:

- **byWorkspaceId** (`workspaceId`, `pk`): Find all MCP servers in a workspace

**Access Patterns**:

- Get MCP server: Get with `pk = mcp-servers/{workspaceId}/{serverId}`, `sk = server`
- List MCP servers in workspace: Query GSI with `workspaceId = {id}`

### 15. `trial-credit-requests`

**Purpose**: Trial credit request tracking

**Partition Key**: `pk` (String) - `trial-credit-requests/{workspaceId}`
**Sort Key**: `sk` (String, optional) - fixed value "request"

**Fields**:

- `workspaceId` (String): Workspace ID
- `userId` (String): User ID who requested
- `userEmail` (String, email): User email
- `currency` (Enum: "usd" | "eur" | "gbp"): Workspace currency
- `requestedAt` (String, ISO datetime): When request was made
- `status` (Enum: "pending" | "approved" | "rejected", default: "pending"): Request status
- `approvedAt` (String, optional): When approved
- `approvedBy` (String, optional): Discord user ID or admin identifier

**Access Patterns**:

- Get trial credit request: Get with `pk = trial-credit-requests/{workspaceId}`, `sk = request`
- Create request: Create with workspace ID

### 16. `subscription`

**Purpose**: User subscription plans and limits

**Partition Key**: `pk` (String) - `subscriptions/{subscriptionId}`
**Sort Key**: `sk` (String, optional) - fixed value "subscription"

**Fields**:

- `userId` (String): User ID who owns the subscription (for GSI queries)
- `plan` (Enum: "free" | "starter" | "pro"): Subscription plan
- `expiresAt` (String, optional): Expiration date (deprecated - free plans no longer expire)
- `apiKeyId` (String, optional): API Gateway API key ID for throttling
- `lastLimitEmailSentAt` (String, optional): Last time limit email was sent

**Global Secondary Indexes**:

- **byUserId** (`userId`, `pk`): Find subscription for a user

**Access Patterns**:

- Get subscription: Get with `pk = subscriptions/{subscriptionId}`, `sk = subscription`
- Get user subscription: Query GSI with `userId = {id}`

### 17. `llm-request-buckets`

**Purpose**: Hourly request count buckets for rate limiting

**Partition Key**: `pk` (String) - `llm-request-buckets/{subscriptionId}/{hourTimestamp}`
**Sort Key**: None

**Fields**:

- `subscriptionId` (String): Subscription ID for GSI queries
- `hourTimestamp` (String, ISO datetime): ISO timestamp truncated to hour (YYYY-MM-DDTHH:00:00.000Z)
- `count` (Number, default: 0): Request count for this hour
- `expires` (Number): TTL timestamp (25 hours from bucket hour)

**Global Secondary Indexes**:

- **bySubscriptionIdAndHour** (`subscriptionId`, `hourTimestamp`): Find buckets for a subscription

**TTL**: Yes - buckets expire after 25 hours

**Access Patterns**:

- Get bucket: Get with `pk = llm-request-buckets/{subscriptionId}/{hourTimestamp}`
- List buckets for subscription: Query GSI with `subscriptionId = {id}`, `hourTimestamp BETWEEN start AND end`
- Increment count: Atomic update to increment `count`

### 18. `workspace-invite`

**Purpose**: Workspace invitation tokens

**Partition Key**: `pk` (String) - `workspace-invites/{workspaceId}/{inviteId}`
**Sort Key**: `sk` (String) - fixed value "invite"

**Fields**:

- `workspaceId` (String): Workspace ID
- `email` (String, email): Invited user email (normalized to lowercase)
- `token` (String): Unique, cryptographically secure token
- `permissionLevel` (Number, 1-3): Permission level (1=READ, 2=WRITE, 3=OWNER)
- `invitedBy` (String): User reference of inviter
- `expiresAt` (String, ISO datetime): Expiration date
- `acceptedAt` (String, optional): When invite was accepted
- `acceptedBy` (String, optional): User reference of user who accepted
- `expires` (Number): TTL timestamp for DynamoDB

**Global Secondary Indexes**:

- **byWorkspaceId** (`workspaceId`, `pk`): Find all invites for a workspace

**TTL**: Yes - invites expire automatically

**Access Patterns**:

- Get invite: Get with `pk = workspace-invites/{workspaceId}/{inviteId}`, `sk = invite`
- List invites for workspace: Query GSI with `workspaceId = {id}`

### 19. `agent-stream-servers`

**Purpose**: Lambda URL streaming server configurations

**Partition Key**: `pk` (String) - `stream-servers/{workspaceId}/{agentId}`
**Sort Key**: `sk` (String) - fixed value "config"

**Fields**:

- `workspaceId` (String): Workspace ID
- `agentId` (String): Agent ID
- `secret` (String): Secret used in path parameter (encrypted at rest)
- `allowedOrigins` (Array of strings): Array of allowed origins or ["*"] for wildcard

**Access Patterns**:

- Get stream server config: Get with `pk = stream-servers/{workspaceId}/{agentId}`, `sk = config`
- Create/update config: Upsert with workspace and agent IDs

### 20. `user-api-key`

**Purpose**: User-level API keys for authentication

**Partition Key**: `pk` (String) - `user-api-keys/{userId}`
**Sort Key**: `sk` (String) - keyId UUID

**Fields**:

- `userId` (String): User ID extracted from pk for reference
- `keyHash` (String): scrypt hash of the full key (base64 encoded)
- `keySalt` (String): Salt used for hashing (base64 encoded)
- `keyLookupHash` (String): SHA256 hash of the plain key for GSI lookup (hex encoded)
- `keyPrefix` (String): First 12 characters for display (e.g., "hmat_abc...")
- `name` (String, optional): Optional user-provided name/label
- `lastUsedAt` (String, optional): Timestamp for tracking usage

**Global Secondary Indexes**:

- **byKeyHash** (`keyLookupHash`, `pk`): Fast O(1) lookup of API key by hash

**Access Patterns**:

- Create API key: Create with `pk = user-api-keys/{userId}`, `sk = {keyId}`
- Get API key: Get with `pk = user-api-keys/{userId}`, `sk = {keyId}`
- Lookup by hash: Query GSI with `keyLookupHash = {hash}` (for authentication)
- List user keys: Query with `pk = user-api-keys/{userId}`

### 21. `user-refresh-token`

**Purpose**: Refresh tokens for JWT authentication

**Partition Key**: `pk` (String) - `user-refresh-tokens/{userId}`
**Sort Key**: `sk` (String) - tokenId UUID

**Fields**:

- `userId` (String): User ID extracted from pk for reference
- `tokenHash` (String): scrypt hash of the refresh token (base64 encoded)
- `tokenSalt` (String): Salt used for hashing (base64 encoded)
- `tokenLookupHash` (String): SHA256 hash of the plain token for GSI lookup (hex encoded)
- `expiresAt` (String, ISO datetime): Expiration timestamp
- `lastUsedAt` (String, optional): Timestamp for tracking usage
- `revokedAt` (String, optional): Revocation timestamp (if revoked)

**Global Secondary Indexes**:

- **byTokenHash** (`tokenLookupHash`, `pk`): Fast O(1) lookup of refresh token by hash

**Access Patterns**:

- Create refresh token: Create with `pk = user-refresh-tokens/{userId}`, `sk = {tokenId}`
- Get refresh token: Get with `pk = user-refresh-tokens/{userId}`, `sk = {tokenId}`
- Lookup by hash: Query GSI with `tokenLookupHash = {hash}` (for token validation)
- List user tokens: Query with `pk = user-refresh-tokens/{userId}`

## Key Patterns

### Partition Key Patterns

Most tables use composite partition keys with the format:

- `{resource-type}/{id}` - Single resource
- `{resource-type}/{parentId}/{id}` - Nested resource

Examples:

- `workspaces/{workspaceId}`
- `agents/{workspaceId}/{agentId}`
- `workspace-documents/{workspaceId}/{documentId}`

### Sort Key Patterns

- **Fixed values**: Used when there's only one record per partition key (e.g., `"workspace"`, `"key"`, `"config"`)
- **UUIDs**: Used for multiple records per partition (e.g., API keys, refresh tokens)
- **Optional**: Many tables have optional sort keys for flexibility

### Global Secondary Indexes (GSI)

GSIs enable efficient queries on non-primary key attributes:

1. **Workspace-based queries**: Most resources have a `byWorkspaceId` GSI
2. **User-based queries**: Subscriptions and tokens have `byUserId` GSI
3. **Date-based queries**: Aggregates have date-based GSIs
4. **Lookup hashes**: API keys and tokens have hash-based GSIs for fast authentication

### TTL (Time To Live)

Several tables use TTL for automatic cleanup:

- `webhook-logs`: Temporary request logs
- `agent-conversations`: Conversation history
- `credit-reservations`: Expired reservations (15 minutes)
- `llm-request-buckets`: Old request buckets (25 hours)
- `workspace-invite`: Expired invitations

### Atomic Operations

The `workspace` table uses atomic updates for credit management:

- `atomicUpdate`: Atomically reserve credits before LLM calls
- Prevents race conditions in concurrent requests
- Uses optimistic locking with version numbers

## Data Access Patterns

### Common Queries

1. **Get workspace and all resources**:

   - Get workspace: `workspace.get("workspaces/{id}", "workspace")`
   - List agents: `agent.query({ IndexName: "byWorkspaceId", KeyConditionExpression: "workspaceId = :id" })`
   - List documents: `workspace-document.query({ IndexName: "byWorkspaceId", ... })`

2. **Permission checks**:

   - Get permission: `permission.get("workspaces/{id}", "users/{userId}")`
   - Check if user has access: Query permission table

3. **Credit management**:

   - Reserve credits: `workspace.atomicUpdate(...)` with credit deduction
   - Adjust reservation: Get reservation, calculate difference, update workspace

4. **Token usage tracking**:
   - Create conversation: `agent-conversations.create(...)`
   - Aggregate daily: Scheduled function queries conversations and creates aggregates

## Best Practices

1. **Always use indexes**: Query GSIs instead of scanning tables
2. **Use atomic updates**: For credit management and concurrent operations
3. **Leverage TTL**: Let DynamoDB automatically clean up temporary data
4. **Optimize partition keys**: Design keys for your access patterns
5. **Version control**: Use version numbers for optimistic locking
6. **Encryption**: All tables are encrypted at rest automatically

## Migration Notes

- Tables are created automatically by Architect Framework
- Schema changes require careful migration planning
- Version numbers help with backward compatibility
- GSI changes require table recreation (data migration needed)
