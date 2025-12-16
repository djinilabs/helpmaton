# Credit System

This document explains how the credit system works in Helpmaton, including credit reservation, adjustment, spending limits, and BYOK (Bring Your Own Key) support.

## Overview

Helpmaton uses a credit-based billing system where workspaces have credit balances that are deducted when agents make LLM API calls. Credits are reserved before calls and adjusted after calls based on actual token usage.

## Key Concepts

### Credit Balance

- Each workspace has a `creditBalance` field stored in the `workspace` table
- Credits are denominated in USD
- Credits can be added via trial credit requests or future payment methods
- Credits are deducted atomically to prevent race conditions

### Credit Reservation

Before making an LLM API call, the system:

1. Estimates the cost based on message length and model pricing
2. Atomically reserves credits by deducting the estimated amount
3. Creates a reservation record with a 15-minute TTL
4. Proceeds with the LLM call

### Credit Adjustment

After the LLM API call completes:

1. Calculates actual cost from token usage
2. Compares actual cost to reserved amount
3. Refunds difference if actual < reserved
4. Charges additional amount if actual > reserved
5. Cleans up the reservation record

### BYOK (Bring Your Own Key)

When a workspace has a workspace API key configured, requests can use the workspace's own LLM API key instead of Helpmaton's key. In this case:

- Credit reservation is skipped
- Credit adjustment is skipped
- The workspace pays directly to the LLM provider
- Token usage is still tracked for analytics

## Credit Reservation Flow

```
Request arrives
    │
    ▼
Estimate token cost
    │
    ├─ Count tokens in messages
    ├─ Count tokens in system prompt
    ├─ Estimate tool definitions tokens
    └─ Apply model pricing
    │
    ▼
Check credit balance
    │
    ├─ Insufficient → InsufficientCreditsError
    └─ Sufficient → Continue
    │
    ▼
Atomically reserve credits
    │
    ├─ DynamoDB atomicUpdate
    ├─ Deduct estimated cost
    ├─ Create reservation record
    └─ Return reservation ID
    │
    ▼
Proceed with LLM call
```

### Atomic Reservation

Credit reservation uses DynamoDB's `atomicUpdate` to ensure thread-safety:

```typescript
await db.workspace.atomicUpdate(
  workspacePk,
  "workspace",
  async (current) => {
    if (current.creditBalance < estimatedCost) {
      throw new InsufficientCreditsError(...);
    }
    return {
      pk: workspacePk,
      sk: "workspace",
      creditBalance: current.creditBalance - estimatedCost,
    };
  },
  { maxRetries: 3 }
);
```

This ensures that:

- Multiple concurrent requests don't over-deduct credits
- Credit balance is always accurate
- Race conditions are prevented

### Reservation Record

A reservation record is created in the `credit-reservations` table:

- `pk`: `credit-reservations/{reservationId}`
- `workspaceId`: Workspace ID
- `reservedAmount`: Estimated cost that was reserved
- `estimatedCost`: Same as reservedAmount (for reference)
- `currency`: Workspace currency
- `expires`: TTL timestamp (15 minutes from creation)
- `expiresHour`: Hour bucket for GSI queries

The reservation record:

- Tracks which credits are "in flight"
- Enables cleanup of expired reservations
- Allows credit adjustment after LLM call

## Credit Adjustment Flow

```
LLM call completes
    │
    ▼
Extract token usage
    │
    ├─ promptTokens (input)
    ├─ completionTokens (output)
    └─ reasoningTokens (optional)
    │
    ▼
Calculate actual cost
    │
    ├─ Apply model pricing
    ├─ Handle tiered pricing if applicable
    └─ Convert to workspace currency
    │
    ▼
Get reservation record
    │
    ├─ Not found → Assume already processed
    └─ Found → Continue
    │
    ▼
Compare actual vs reserved
    │
    ├─ actual < reserved → Refund difference
    ├─ actual > reserved → Charge additional
    └─ actual = reserved → No change
    │
    ▼
Atomically adjust credits
    │
    ├─ DynamoDB atomicUpdate
    ├─ Update credit balance
    └─ Return updated workspace
    │
    ▼
Reservation cleanup
    │
    └─ TTL automatically deletes after 15 minutes
```

### Adjustment Calculation

```typescript
const actualCost = calculateTokenCost(
  provider,
  modelName,
  tokenUsage.promptTokens,
  tokenUsage.completionTokens,
  currency,
  tokenUsage.reasoningTokens
);

const difference = actualCost - reservedAmount;

// Refund if actual < reserved
if (difference < 0) {
  newBalance = currentBalance + Math.abs(difference);
}
// Charge additional if actual > reserved
else if (difference > 0) {
  newBalance = currentBalance - difference;
}
```

### Handling Missing Reservations

If a reservation record is not found during adjustment:

- The reservation may have already been cleaned up (expired)
- Or the reservation was never created (BYOK, error before reservation)
- The system logs a warning and returns the workspace without adjustment
- This is safe because credits were either never reserved or already adjusted

## Spending Limits

Spending limits provide an additional layer of control beyond credit balances. Limits can be set at both workspace and agent levels.

### Limit Types

- **Daily**: Rolling 24-hour window
- **Weekly**: Rolling 7-day window
- **Monthly**: Rolling 30-day window

### Limit Structure

```typescript
{
  timeFrame: "daily" | "weekly" | "monthly",
  amount: number  // Maximum spending in workspace currency
}
```

### Limit Checking

Before reserving credits, the system checks all applicable limits:

1. **Workspace Limits**: Check all workspace-level limits
2. **Agent Limits**: If agent is specified, check all agent-level limits
3. **Rolling Window**: Calculate spending in the rolling window
4. **Estimate Check**: Check if estimated cost + current spending would exceed limit

If any limit would be exceeded, a `SpendingLimitExceededError` is thrown.

### Spending Calculation

Spending is calculated from `token-usage-aggregates` table:

```typescript
// Get aggregates for the rolling window
const startDate = calculateRollingWindow(timeFrame); // e.g., 24 hours ago
const aggregates = await queryAggregates(
  workspaceId,
  agentId, // optional
  startDate,
  now
);

// Sum costs
const currentSpending = aggregates.reduce(
  (sum, agg) => sum + agg.costUsd,
  0
);
```

### Limit Enforcement

Limits are checked in `validateCreditsAndLimits()` before credit reservation:

```typescript
// Check spending limits
const limitCheck = await checkSpendingLimits(
  db,
  workspace,
  agent,
  estimatedCost
);

if (!limitCheck.passed) {
  throw new SpendingLimitExceededError(limitCheck.failedLimits);
}
```

Failed limits include:

- `scope`: "workspace" or "agent"
- `timeFrame`: "daily", "weekly", or "monthly"
- `limit`: Maximum allowed amount
- `current`: Current spending + estimated cost

## BYOK (Bring Your Own Key)

When a workspace has a `workspace-api-key` configured, requests can use the workspace's own LLM API key instead of Helpmaton's key.

### How It Works

1. **Workspace API Key**: Stored in `workspace-api-key` table, encrypted at rest
2. **Request Detection**: Handler checks if workspace has API key configured
3. **Key Usage**: If present, use workspace key for LLM API calls
4. **Credit Skipping**: Skip credit reservation and adjustment

### Benefits

- Workspaces can use their own LLM API keys
- Direct billing from LLM provider
- No credit balance required
- Token usage still tracked for analytics

### Implementation

```typescript
// Check if workspace has API key
const workspaceApiKey = await db["workspace-api-key"].get(
  `workspace-api-keys/${workspaceId}`,
  "key"
);

const usesByok = !!workspaceApiKey;

// Skip credit reservation if BYOK
if (usesByok) {
  return {
    reservationId: "byok",
    reservedAmount: 0,
    workspace,
  };
}
```

## Currency Support

Credits are stored in USD (United States Dollar).

### Cost Calculation

Token costs are calculated in USD:

```typescript
const cost = calculateTokenCost(
  provider,
  modelName,
  inputTokens,
  outputTokens,
  reasoningTokens
);
```

Pricing is stored in `apps/backend/src/config/pricing.json` with USD rates only.

## Error Handling

### InsufficientCreditsError

Thrown when credit balance is insufficient for estimated cost:

```typescript
{
  message: "Insufficient credits",
  workspaceId: string,
  required: number,
  available: number,
  currency: "usd"
}
```

### SpendingLimitExceededError

Thrown when spending limit would be exceeded:

```typescript
{
  message: "Spending limit exceeded",
  failedLimits: Array<{
    scope: "workspace" | "agent",
    timeFrame: "daily" | "weekly" | "monthly",
    limit: number,
    current: number
  }>
}
```

### CreditDeductionError

Thrown when credit adjustment fails (rare):

```typescript
{
  message: "Failed to adjust credit reservation",
  reservationId: string,
  workspaceId: string
}
```

## Cleanup and Expiration

### Reservation Cleanup

Reservations are automatically cleaned up via TTL:

- TTL set to 15 minutes from creation
- DynamoDB automatically deletes expired records
- Scheduled function also cleans up expired reservations (backup)

### Scheduled Cleanup

A scheduled function runs every 10 minutes to clean up expired reservations:

```typescript
// Query reservations expiring in current hour
const expiresHour = calculateExpiresHourBucket(now);
const reservations = await db["credit-reservations"].query({
  IndexName: "byExpiresHour",
  KeyConditionExpression: "expiresHour = :hour",
  FilterExpression: "expires < :now",
  ExpressionAttributeValues: {
    ":hour": expiresHour,
    ":now": Math.floor(Date.now() / 1000),
  },
});

// Reservations are automatically deleted by TTL
// This is a backup cleanup mechanism
```

## Feature Flags

Credit validation and spending limit checks can be disabled via environment variables:

- `ENABLE_CREDIT_VALIDATION`: Enable/disable credit validation (default: true)
- `ENABLE_SPENDING_LIMIT_CHECKS`: Enable/disable spending limit checks (default: true)

These flags are useful during deployment or testing to temporarily disable checks.

## Best Practices

1. **Always reserve before LLM calls**: Prevents over-spending
2. **Adjust after calls**: Ensures accurate billing
3. **Handle errors gracefully**: Return clear error messages to users
4. **Monitor credit balances**: Alert users when balances are low
5. **Set spending limits**: Prevent unexpected costs
6. **Use BYOK for high-volume**: Reduce credit management overhead

## API Endpoints

### Get Workspace Credits

```
GET /api/workspaces/:workspaceId
```

Returns workspace including `creditBalance` and `currency`.

### Add Credits (Admin)

Credits are added via trial credit requests or future payment integration.

### Set Spending Limits

```
POST /api/workspaces/:workspaceId/spending-limits
Body: { timeFrame: "daily" | "weekly" | "monthly", amount: number }
```

```
POST /api/workspaces/:workspaceId/agents/:agentId/spending-limits
Body: { timeFrame: "daily" | "weekly" | "monthly", amount: number }
```

### Update Spending Limits

```
PUT /api/workspaces/:workspaceId/spending-limits/:timeFrame
Body: { amount: number }
```

```
PUT /api/workspaces/:workspaceId/agents/:agentId/spending-limits/:timeFrame
Body: { amount: number }
```

### Delete Spending Limits

```
DELETE /api/workspaces/:workspaceId/spending-limits/:timeFrame
```

```
DELETE /api/workspaces/:workspaceId/agents/:agentId/spending-limits/:timeFrame
```

## Monitoring

### Credit Balance Monitoring

- Check `workspace.creditBalance` regularly
- Alert when balance is low
- Track credit consumption trends

### Spending Limit Monitoring

- Track spending against limits
- Alert when approaching limits
- Provide spending dashboards

### Reservation Monitoring

- Monitor reservation creation/cleanup
- Track reservation expiration
- Alert on stuck reservations

## Troubleshooting

### Credits Not Deducted

- Check if BYOK is enabled (skips deduction)
- Verify credit validation is enabled
- Check reservation records
- Review error logs

### Spending Limits Not Working

- Verify spending limit checks are enabled
- Check limit configuration
- Review aggregate data
- Verify rolling window calculation

### Reservation Cleanup Issues

- Check TTL configuration
- Verify scheduled function is running
- Review reservation expiration times
- Check DynamoDB TTL status
