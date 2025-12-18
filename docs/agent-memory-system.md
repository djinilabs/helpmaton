# Stratified Agent Memory System

The stratified agent memory system provides long-term factual memory for AI agents by organizing conversation data into multiple temporal grains (time granularities) and progressively summarizing information as time passes. This system enables agents to remember important facts, people, and events from their interactions while maintaining efficient storage and retrieval.

## Overview

The memory system operates on a hierarchical structure where:

1. **Raw conversations** are immediately stored in **working memory** (no summarization)
2. **Working memory** is periodically summarized into **daily summaries**
3. **Daily summaries** are consolidated into **weekly summaries**
4. **Weekly summaries** are aggregated into **monthly summaries**
5. **Monthly summaries** are condensed into **quarterly summaries**
6. **Quarterly summaries** are synthesized into **yearly summaries**

This progressive summarization ensures that:

- Recent, detailed information is readily available
- Older information is preserved in increasingly abstract forms
- Storage costs are optimized through automatic summarization
- Important information is preserved across time scales

## Architecture

### Memory Grains

The system uses six temporal grains, each with its own vector database:

| Grain         | Time Format       | Description                               | Example          |
| ------------- | ----------------- | ----------------------------------------- | ---------------- |
| **working**   | (none)            | Raw conversation facts, no time component | Global per agent |
| **daily**     | `YYYY-MM-DD`      | Daily summaries of working memory         | `2024-01-15`     |
| **weekly**    | `YYYY-W{week}`    | Weekly summaries of daily summaries       | `2024-W03`       |
| **monthly**   | `YYYY-MM`         | Monthly summaries of weekly summaries     | `2024-01`        |
| **quarterly** | `YYYY-Q{quarter}` | Quarterly summaries of monthly summaries  | `2024-Q1`        |
| **yearly**    | `YYYY`            | Yearly summaries of quarterly summaries   | `2024`           |

### Database Organization

Each agent has separate vector databases (LanceDB instances) for each grain, stored in S3:

```
s3://bucket/vectordb/{agentId}/{grain}/{timeString}/
```

- **Working memory**: `vectordb/{agentId}/working/` (single database, no time component)
- **Other grains**: `vectordb/{agentId}/{grain}/{timeString}/` (one database per time period)

### Data Flow

```
Conversations
    ↓
Working Memory (raw facts, immediate storage)
    ↓ (daily summarization)
Daily Summaries
    ↓ (weekly summarization)
Weekly Summaries
    ↓ (monthly summarization)
Monthly Summaries
    ↓ (quarterly summarization)
Quarterly Summaries
    ↓ (yearly summarization)
Yearly Summaries
```

## Components

### 1. Working Memory Write

**Location**: `apps/backend/src/utils/memory/writeMemory.ts`

When a conversation is created or updated, facts are extracted and written to working memory:

- Extracts text from user and assistant messages
- Generates embeddings using Gemini API (`text-embedding-004`)
- Creates `FactRecord` objects with metadata (conversationId, workspaceId, agentId)
- Queues write operations to SQS for serialized processing

**Key Functions**:

- `writeToWorkingMemory()`: Main entry point for writing conversation facts
- `queueMemoryWrite()`: Generic function for writing to any grain

### 2. Summarization

**Location**: `apps/backend/src/utils/memory/summarizeMemory.ts`

LLM-based summarization consolidates information from finer-grained memories:

- Uses Google Gemini API via `@ai-sdk/google`
- Grain-specific prompts that focus on:
  - Important events and occurrences
  - Key people and their roles/relationships
  - Significant facts and patterns
  - Notable trends and changes

**Summarization Prompts**:

- **Daily**: Summarize working memory events, extract important facts and people
- **Weekly**: Consolidate daily summaries into week narrative
- **Monthly**: High-level overview of month's events and patterns
- **Quarterly**: Major themes and milestones across the quarter
- **Yearly**: Comprehensive overview of year's achievements and patterns

**Scheduled Tasks**:

- `summarize-memory-daily`: Runs daily, summarizes previous day's working memory
- `summarize-memory-weekly`: Runs weekly, summarizes previous week's daily summaries
- `summarize-memory-monthly`: Runs monthly, summarizes previous month's weekly summaries
- `summarize-memory-quarterly`: Runs quarterly, summarizes previous quarter's monthly summaries
- `summarize-memory-yearly`: Runs yearly, summarizes previous year's quarterly summaries

### 3. Retention Policies

**Location**: `apps/backend/src/utils/memory/retentionPolicies.ts`

Automatic cleanup of old memories based on subscription plans:

| Plan        | Working   | Daily    | Weekly   | Monthly   | Quarterly   | Yearly  |
| ----------- | --------- | -------- | -------- | --------- | ----------- | ------- |
| **Free**    | 48 hours  | 30 days  | 6 weeks  | 6 months  | 4 quarters  | 2 years |
| **Starter** | 120 hours | 60 days  | 12 weeks | 12 months | 8 quarters  | 4 years |
| **Pro**     | 240 hours | 120 days | 24 weeks | 24 months | 16 quarters | 8 years |

**Cleanup Process**:

- Scheduled task `cleanup-memory-retention` runs daily
- Calculates cutoff dates for each grain based on subscription plan
- Deletes records older than the retention period
- Starts from most granular grains (working → daily → weekly, etc.)

### 4. Memory Search

**Location**: `apps/backend/src/utils/memory/searchMemory.ts`

Agents can search their memory using the `search_memory` tool:

**Parameters**:

- `grain`: Which temporal grain to search (working, daily, weekly, etc.)
- `minimumDaysAgo`: Minimum age of results (default: 0)
- `maximumDaysAgo`: Maximum age of results (default: 365)
- `maxResults`: Maximum number of results (default: 10)
- `queryText`: Optional semantic search query

**Features**:

- Temporal filtering by date range
- Semantic search using vector similarity (when `queryText` provided)
- Results prefixed with date when the event occurred
- Supports all temporal grains

**Example Usage**:

```typescript
const results = await searchMemory({
  agentId: "agent-123",
  workspaceId: "workspace-456",
  grain: "daily",
  minimumDaysAgo: 0,
  maximumDaysAgo: 30,
  maxResults: 10,
  queryText: "React project discussion",
});
```

### 5. Time Formatting

**Location**: `apps/backend/src/utils/memory/timeFormats.ts`

Utilities for converting between dates and grain-specific time strings:

- `formatTimeForGrain()`: Convert Date to time string format
- `parseTimeFromGrain()`: Parse time string back to Date
- `getDateRangeForGrain()`: Get start/end dates for a time period
- `getWeekNumber()`: Calculate ISO week number
- `getQuarterNumber()`: Calculate quarter number (1-4)

## Write Operations

### SQS Message Groups

To ensure data consistency, write operations use SQS FIFO queues with message groups:

- **Message Group ID**: `{agentId}:{temporalGrain}`
- Ensures only one writer per database at a time
- Prevents race conditions and data corruption
- Serializes writes to the same vector database

### Write Flow

1. Conversation created/updated → `writeToWorkingMemory()` called
2. Facts extracted from messages
3. Embeddings generated for each fact
4. Records queued to SQS with message group `{agentId}:working`
5. SQS handler processes writes in order
6. Records stored in LanceDB vector database

## Summarization Process

### Daily Summarization

**Trigger**: Scheduled task runs daily at midnight

**Process**:

1. Query working memory from previous 24 hours
2. Extract all fact content
3. Call LLM with daily summarization prompt
4. Generate embedding for summary
5. Create daily summary record with time string `YYYY-MM-DD`
6. Queue write to daily grain database

### Weekly Summarization

**Trigger**: Scheduled task runs weekly

**Process**:

1. Query all daily summaries from previous week
2. Combine daily summary content
3. Call LLM with weekly summarization prompt
4. Generate embedding for summary
5. Create weekly summary record with time string `YYYY-W{week}`
6. Queue write to weekly grain database

Similar processes for monthly, quarterly, and yearly summarization.

## Retention Cleanup

**Trigger**: Scheduled task runs daily

**Process**:

1. For each workspace:
   - Get subscription plan
   - For each agent:
     - For each grain:
       - Calculate retention cutoff date
       - Query records older than cutoff
       - Delete old records in batches
2. Starts from most granular grains (working memory first)

**Benefits**:

- Reduces storage costs
- Maintains relevance by removing outdated information
- Different retention based on subscription tier

## Agent Tool Integration

The `search_memory` tool is automatically available to agents during conversations:

**Tool Definition**:

```typescript
tool({
  description:
    "Search the agent's factual memory across different time periods...",
  parameters: z.object({
    grain: z.enum([
      "working",
      "daily",
      "weekly",
      "monthly",
      "quarterly",
      "yearly",
    ]),
    minimumDaysAgo: z.number().optional(),
    maximumDaysAgo: z.number().optional(),
    maxResults: z.number().optional(),
    queryText: z.string().optional(),
  }),
  execute: async (args) => {
    // Search memory and return results
  },
});
```

**Integration Points**:

- `apps/backend/src/http/utils/memorySearchTool.ts`: Tool definition
- `apps/backend/src/http/post-api-workspaces-000workspaceId-agents-000agentId-test/utils/agentSetup.ts`: Added to agent tools
- `apps/backend/src/http/utils/agentUtils.ts`: Added to delegated agent tools

## Scheduled Tasks

All scheduled tasks are defined in `app.arc`:

```arc
@scheduled
summarize-memory-daily rate(1 day)
summarize-memory-weekly rate(7 days)
summarize-memory-monthly rate(30 days)
summarize-memory-quarterly rate(90 days)
summarize-memory-yearly rate(365 days)
cleanup-memory-retention rate(1 day)
```

## Testing

Comprehensive integration tests are available in:
`apps/backend/src/utils/memory/__tests__/memorySystem.integration.test.ts`

**Test Coverage**:

- Complete lifecycle simulation (conversations → working → day → week → month → quarter → year)
- Retention policy cleanup for different subscription plans
- Memory search across different grains and time ranges
- Information preservation through summarization hierarchy

**Mocking**:

- LLM summarization (extracts people, events, facts)
- Vector database operations (in-memory storage)
- Embedding generation (deterministic based on text)
- SQS operations (tracks and stores records)

## Configuration

### Environment Variables

- `GEMINI_API_KEY`: Required for embedding generation and LLM summarization
- Workspace API keys: Can override system key for embedding generation

### S3 Configuration

- Bucket name: Retrieved from `getS3BucketName()` in `vectordb/config.ts`
- Region: `eu-west-2` (default)
- Path structure: `vectordb/{agentId}/{grain}/{timeString}/`

## Performance Considerations

1. **Asynchronous Writes**: Working memory writes are non-blocking to avoid impacting conversation performance
2. **Batch Processing**: Summarization processes multiple agents in batches
3. **SQS Serialization**: Message groups ensure safe concurrent access
4. **Retention Cleanup**: Runs daily to maintain storage efficiency
5. **Vector Search**: Uses LanceDB for efficient semantic search

## Future Enhancements

Potential improvements:

- Configurable summarization prompts per agent
- Custom retention policies per workspace
- Memory export/import functionality
- Advanced search filters (by person, event type, etc.)
- Memory analytics and insights
- Cross-agent memory sharing (for team workspaces)

## Related Documentation

- [Vector Database](./vector-database.md): Details on LanceDB integration
- [Subscription Management](./subscription-management.md): Subscription plans and features
- [Agent Configuration](./agent-configuration.md): Agent setup and tools

