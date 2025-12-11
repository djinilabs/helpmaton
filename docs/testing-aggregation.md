# Testing the Token Usage Aggregation Lambda

There are several ways to test the scheduled aggregation lambda. **Note**: The current implementation is incomplete and doesn't actually query conversations yet - it's a placeholder that needs to be implemented.

## Quick Start

The easiest way to test is using the test script:

```bash
# Make sure your backend sandbox is running first
pnpm dev:backend

# In another terminal, run:
pnpm test-aggregation
```

## Available Testing Methods

## Method 1: Direct Function Call (Recommended for Development)

The aggregation functions are exported, so you can call them directly:

### Using the Test Script

```bash
# Aggregate yesterday's data (default)
pnpm test-aggregation

# Aggregate a specific date
pnpm test-aggregation 2025-01-15

# Show help
pnpm test-aggregation --help
```

**Prerequisites:**
- Make sure your backend sandbox is running (`pnpm dev:backend`) or you have proper AWS credentials configured
- The script uses `tsx` to run TypeScript directly

### Manual Testing in Node/TypeScript

You can also import and call the functions directly in a Node REPL or test file:

```typescript
import { aggregateTokenUsageForDate, aggregatePreviousDay } from './apps/backend/src/scheduled/aggregate-token-usage/index.ts';

// Aggregate yesterday
await aggregatePreviousDay();

// Aggregate a specific date
const date = new Date('2025-01-15');
await aggregateTokenUsageForDate(date);
```

## Method 2: Invoke via Architect Sandbox

When running `pnpm dev:backend`, Architect sandbox is running. You can manually trigger scheduled functions:

1. Find the function name in the sandbox logs
2. Use Architect's CLI to invoke it:

```bash
cd apps/backend
pnpm arc invoke aggregate-token-usage
```

Or create a mock scheduled event and invoke it:

```bash
cd apps/backend
echo '{"source":"aws.events","detail-type":"Scheduled Event"}' | pnpm arc invoke aggregate-token-usage
```

## Method 3: Create a Test HTTP Endpoint (For Manual Testing)

You can temporarily add a test endpoint to manually trigger aggregation:

```typescript
// In workspaces-app.ts (temporary, remove after testing)
app.post('/api/test/aggregate', requireAuth, asyncHandler(async (req, res) => {
  const { date } = req.body; // Optional: YYYY-MM-DD format
  if (date) {
    await aggregateTokenUsageForDate(new Date(date));
  } else {
    await aggregatePreviousDay();
  }
  res.json({ success: true });
}));
```

Then call it:
```bash
curl -X POST http://localhost:3333/api/test/aggregate \
  -H "Cookie: your-session-cookie" \
  -H "Content-Type: application/json" \
  -d '{"date": "2025-01-15"}'
```

## Method 4: Unit Tests

Create a proper unit test file:

```typescript
// apps/backend/src/scheduled/aggregate-token-usage/index.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { aggregateTokenUsageForDate } from './index';

describe('aggregateTokenUsageForDate', () => {
  it('should aggregate conversations for a given date', async () => {
    const date = new Date('2025-01-15');
    await aggregateTokenUsageForDate(date);
    // Add assertions here
  });
});
```

Run with:
```bash
cd apps/backend
pnpm test
```

## Current Implementation Status

✅ **Implementation Complete**: The aggregation function is fully implemented and tested. It:

1. ✅ Queries all workspaces from the permission table
2. ✅ For each workspace, queries all agents using the `byWorkspaceId` GSI
3. ✅ For each agent, queries conversations using the `byAgentId` GSI filtered by date
4. ✅ Aggregates conversations by workspace, agent, model, provider, and BYOK status
5. ✅ Creates aggregate records in the `token-usage-aggregates` table

The implementation uses efficient GSI queries instead of table scans, and includes proper error handling to continue processing even if individual workspaces/agents fail.

## Verifying Results

After running aggregation, verify the aggregates were created:

```bash
# Check aggregates for a specific date
pnpm verify-aggregates 2025-11-19

# Check aggregates for today (default)
pnpm verify-aggregates
```

This will show:
- All aggregate records for the date
- Token counts (input, output, total)
- Costs in all currencies
- BYOK status

Or query programmatically:

```typescript
const db = await database();
const aggregates = await db["token-usage-aggregates"].query({
  IndexName: "byWorkspaceIdAndDate",
  KeyConditionExpression: "workspaceId = :workspaceId AND #date = :date",
  ExpressionAttributeNames: { "#date": "date" },
  ExpressionAttributeValues: {
    ":workspaceId": "your-workspace-id",
    ":date": "2025-11-19",
  },
});
```

The usage API endpoints will automatically use aggregated data for older dates (beyond the "recent" threshold, typically 7 days).

