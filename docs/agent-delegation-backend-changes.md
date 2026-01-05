# Agent Delegation Backend Changes

This document describes the backend changes made in the `feat/delegation-improved` branch to support enhanced agent delegation capabilities. These changes enable agents to delegate tasks to other agents both synchronously and asynchronously, with improved matching, tracking, and error handling.

## Overview

The agent delegation system allows agents to:

- **Synchronously delegate** to other agents and wait for immediate responses
- **Asynchronously delegate** to other agents via a queue system for long-running tasks
- **Find agents by semantic query** using fuzzy matching against agent names, descriptions, and capabilities
- **Track delegation calls** in conversation metadata for observability
- **Handle errors gracefully** with retry logic and proper status tracking

## Infrastructure Changes

### 1. Database Table: `agent-delegation-tasks`

A new DynamoDB table was added to track async delegation tasks:

**Table Definition** (`app.arc`):

```arc
agent-delegation-tasks
  pk *String
  sk **String
  ttl TTL
```

**GSI Definition**:

```arc
agent-delegation-tasks
  gsi1pk *String
  gsi1sk **String
  name byWorkspaceAndAgent
```

**Schema** (`apps/backend/src/tables/schema.ts`):

- `pk`: `"delegation-tasks/{taskId}"`
- `sk`: `"task"`
- `workspaceId`: Workspace identifier
- `callingAgentId`: ID of the agent that initiated the delegation
- `targetAgentId`: ID of the agent being called
- `message`: The message/task to send to the target agent
- `status`: `"pending" | "running" | "completed" | "failed" | "cancelled"`
- `result`: Optional result string (when completed)
- `error`: Optional error message (when failed)
- `createdAt`: ISO 8601 datetime
- `completedAt`: Optional ISO 8601 datetime
- `ttl`: TTL timestamp (4 days from creation)
- `gsi1pk`: `"workspace/{workspaceId}/agent/{callingAgentId}"`
- `gsi1sk`: ISO 8601 datetime (for querying by workspace and agent)

### 2. SQS Queue: `agent-delegation-queue`

A new SQS queue was added for processing async delegation tasks:

**Queue Definition** (`app.arc`):

```arc
agent-delegation-queue
  timeout 300
```

- **Timeout**: 300 seconds (5 minutes) to allow for long-running agent calls
- **Message Retention**: Default 4 days (aligned with task TTL)

### 3. Conversation Schema Enhancement

The `agent-conversations` table schema was extended to track delegation calls:

**New Field** (`apps/backend/src/tables/schema.ts`):

```typescript
delegations: z.array(
  z.object({
    callingAgentId: z.string(),
    targetAgentId: z.string(),
    taskId: z.string().optional(),
    timestamp: z.string().datetime(),
    status: z.enum(["completed", "failed", "cancelled"]),
  })
).optional();
```

This allows tracking all delegation calls made during a conversation for observability and debugging.

## Core Components

### 1. Queue Processor: `agent-delegation-queue`

**Location**: `apps/backend/src/queues/agent-delegation-queue/index.ts`

The queue processor handles async delegation tasks with the following features:

#### Retry Logic with Exponential Backoff

- **Initial delay**: 1 second
- **Max attempts**: 4 (initial + 3 retries)
- **Max delay**: 10 seconds (capped)
- **Multiplier**: 2x (delays: 1s, 2s, 4s, 8s)
- **Jitter**: Random 0-20% added to prevent thundering herd

#### Error Handling

- **Retryable errors**: Network errors, timeouts, rate limits (429), server errors (5xx)
- **Non-retryable errors**: Validation errors, not found (404), etc.
- **Task status tracking**: Updates task status to `running`, `completed`, or `failed`
- **Cancellation support**: Checks for cancelled tasks before processing

#### Timeout Management

- Uses 260-second timeout (leaving 40-second buffer for Lambda processing)
- Lambda function timeout is 300 seconds
- Prevents Lambda from timing out before agent call completes

#### Credit Management

- Integrates with workspace credit context for proper credit tracking
- Uses `getCurrentSQSContext` to maintain credit transaction context
- Delegated calls use workspace API keys if available (BYOK support)

#### Delegation Tracking

- Tracks delegation in conversation metadata (best-effort, errors don't fail the task)
- Logs delegation metrics for observability
- Updates task status atomically

### 2. Agent Utilities: Enhanced Delegation Tools

**Location**: `apps/backend/src/http/utils/agentUtils.ts`

#### New Functions

##### `callAgentInternal` (Exported)

Previously internal, now exported for use by queue processors:

```typescript
export async function callAgentInternal(
  workspaceId: string,
  targetAgentId: string,
  message: string,
  callDepth: number,
  maxDepth: number,
  context?: AugmentedContext,
  timeoutMs: number = 60000
): Promise<string>;
```

**Features**:

- Depth limit checking (prevents infinite delegation chains)
- Agent validation (existence and workspace ownership)
- Full tool support for delegated agents (documents, memory, web search, email, notifications, MCP servers, client tools)
- Recursive delegation support (delegated agents can delegate further)
- Credit reservation and adjustment
- Timeout handling with Promise.race
- Comprehensive error handling with credit refunds

##### `findAgentByQuery` (Exported)

Semantic agent matching using fuzzy keyword matching:

```typescript
export async function findAgentByQuery(
  workspaceId: string,
  query: string,
  delegatableAgentIds: string[]
): Promise<{ agentId: string; agentName: string; score: number } | null>;
```

**Matching Algorithm**:

- **Name similarity**: Weighted 15x (most important)
- **Prompt similarity**: Weighted 8x (first 500 chars for performance)
- **Token matches**: Weighted 1.5x (individual token matches in prompt)
- **Capabilities similarity**: Weighted 10x (overall capabilities match)
- **Keyword-to-capability mapping**: Weighted 4x (synonym matching)
- **Direct capability match**: Weighted 3x (exact capability name matches)

**Scoring**:

- Minimum threshold: 2.0 (requires strong match on at least two signals)
- Returns best match above threshold, or `null` if no match found
- Supports fuzzy matching with synonyms (e.g., "document" → "search_documents")

##### Agent Metadata Caching

New caching system to reduce database queries:

- **TTL**: 5 minutes
- **Key format**: `${workspaceId}:${agentId}`
- **Automatic cleanup**: Periodic cleanup every TTL period
- **Throttled cleanup**: Only runs if cache is large (>50 entries) or enough time has passed
- **Memory leak prevention**: Removes expired entries proactively

#### New Delegation Tools

##### `createListAgentsTool`

Lists all delegatable agents with their capabilities and descriptions.

##### `createCallAgentTool`

Synchronous delegation tool:

- Accepts `agentId`/`agent_id` or `query` parameter
- Validates agent is in delegatable list
- Calls agent internally and returns response
- Tracks delegation in conversation metadata
- Logs delegation metrics

##### `createCallAgentAsyncTool`

Asynchronous delegation tool:

- Accepts `agentId`/`agent_id` or `query` parameter
- Creates task record in database
- Enqueues to SQS queue
- Returns taskId immediately
- Supports query-based agent matching

##### `createCheckDelegationStatusTool`

Status checking tool:

- Queries task by taskId
- Returns current status and result/error if available
- Validates task belongs to workspace

##### `createCancelDelegationTool`

Cancellation tool:

- Updates task status to `cancelled`
- Validates task is cancellable (not already completed/failed)
- Prevents cancellation of completed tasks

### 3. Agent Setup: Integration

**Location**: `apps/backend/src/http/utils/agentSetup.ts`

#### Changes

- Delegation tools are automatically added when agent has `delegatableAgentIds` configured
- Supports both sync and async delegation tools
- Passes `callDepth` and `maxDepth` for depth limiting
- Passes `conversationId` for delegation tracking
- Passes `context` for credit management

### 4. Conversation Logger: Delegation Tracking

**Location**: `apps/backend/src/utils/conversationLogger.ts`

#### New Function: `trackDelegation`

```typescript
export async function trackDelegation(
  db: DatabaseSchema,
  workspaceId: string,
  agentId: string,
  conversationId: string,
  delegation: {
    callingAgentId: string;
    targetAgentId: string;
    taskId?: string;
    status: "completed" | "failed" | "cancelled";
  }
): Promise<void>;
```

**Features**:

- Atomic update using `atomicUpdate` API
- Best-effort tracking (errors logged but don't fail)
- Appends to existing delegations array
- Includes timestamp automatically
- Handles race conditions (conversation deleted between check and update)

## Key Features

### 1. Query-Based Agent Matching

Agents can find other agents by describing what they need:

```typescript
// Example: "find an agent that can search documents"
const match = await findAgentByQuery(workspaceId, query, delegatableAgentIds);
```

**Matching Signals**:

- Agent name similarity
- System prompt content (first 500 chars)
- Capability keywords (with synonym expansion)
- Direct capability name matching

**Synonym Support**:

- "document" → `search_documents`
- "memory" → `search_memory`
- "web" → `search_web`, `fetch_url`
- "email" → `send_email`
- "notification" → `send_notification`

### 2. Async Delegation with Status Tracking

Async delegation allows agents to:

- Fire-and-forget long-running tasks
- Check status later using taskId
- Cancel pending/running tasks
- Retrieve results when completed

**Task Lifecycle**:

1. `pending` → Created, enqueued to SQS
2. `running` → Queue processor starts execution
3. `completed` → Success with result
4. `failed` → Error with error message
5. `cancelled` → Manually cancelled (can't cancel completed/failed)

### 3. Depth Limiting

Prevents infinite delegation chains:

- `callDepth`: Current depth (starts at 0)
- `maxDepth`: Maximum allowed depth (default: 3)
- Each delegation increments `callDepth`
- Returns error if `callDepth >= maxDepth`

### 4. Credit Management Integration

Delegated calls properly handle credits:

- Uses workspace credit context from SQS message
- Reserves credits before LLM call
- Adjusts reservation based on actual token usage
- Refunds reservation if error occurs before LLM call
- Supports BYOK (workspace API keys)

### 5. Error Handling and Retries

**Queue Processor**:

- Exponential backoff with jitter
- Retries only on retryable errors
- Updates task status on failure
- Tracks delegation even on failure

**Synchronous Calls**:

- Returns error message instead of throwing
- Tracks failed delegations in conversation metadata
- Logs delegation metrics for observability

### 6. Timeout Management

- **Synchronous calls**: Default 60 seconds (configurable)
- **Async calls**: 260 seconds (with 40s buffer for Lambda)
- Uses `Promise.race` to enforce timeouts
- Cleans up timeout handles to prevent memory leaks

## Testing

Unit tests were added/updated in:

- `apps/backend/src/http/utils/__tests__/agentUtils.test.ts`

Tests cover:

- Agent matching with fuzzy scoring
- Query-based agent finding
- Delegation tool creation
- Error handling

## Observability

### Delegation Metrics

All delegations log structured metrics:

```typescript
{
  type: "sync" | "async",
  workspaceId: string,
  callingAgentId: string,
  targetAgentId: string,
  taskId?: string,
  callDepth: number,
  status: "completed" | "failed" | "pending",
  timestamp: string,
  error?: string
}
```

### Conversation Tracking

Delegations are tracked in conversation metadata:

- All delegation calls are recorded
- Includes status (completed/failed/cancelled)
- Includes timestamp
- Includes taskId for async calls
- Queryable via conversation record

## Migration Notes

### Database Schema

- New table `agent-delegation-tasks` must be created
- New GSI `byWorkspaceAndAgent` must be created
- Existing `agent-conversations` table will automatically support `delegations` field (optional)

### Queue Configuration

- New SQS queue `agent-delegation-queue` must be created
- Queue timeout set to 300 seconds

### Backward Compatibility

- All changes are backward compatible
- Existing agents without `delegatableAgentIds` are unaffected
- Delegation tools are only added when `delegatableAgentIds` is configured

## Performance Considerations

### Agent Metadata Caching

- Reduces database queries for agent lookups
- 5-minute TTL balances freshness with performance
- Automatic cleanup prevents memory leaks
- Throttled cleanup reduces overhead

### Query-Based Matching

- Limits prompt search to first 500 chars for performance
- Uses efficient token-based matching
- Caches agent metadata to avoid repeated queries

### Async Delegation

- Offloads long-running tasks to queue
- Prevents blocking synchronous calls
- Allows parallel processing of multiple delegations

## Security Considerations

### Workspace Isolation

- All queries validate workspace ownership
- Task queries verify workspace membership
- Agent validation ensures workspace consistency

### Depth Limiting

- Prevents infinite recursion
- Configurable max depth (default: 3)
- Returns clear error message when limit reached

### Credit Management

- Proper credit tracking for delegated calls
- Supports BYOK (workspace API keys)
- Refunds credits on errors before LLM call

## Future Enhancements

Potential improvements:

1. **Delegation history API**: Query delegation history by workspace/agent
2. **Delegation analytics**: Track delegation patterns and success rates
3. **Delegation limits**: Per-workspace limits on delegation depth/count
4. **Delegation webhooks**: Notify external systems of delegation events
5. **Improved matching**: ML-based agent matching for better accuracy
6. **Delegation batching**: Support for delegating to multiple agents in parallel
