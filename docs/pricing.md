# Pricing System

This document explains how Helpmaton calculates and charges for LLM API calls, including the integration with OpenRouter, model price management, cost calculation, and credit deduction system.

## Overview

Helpmaton uses a sophisticated 3-step pricing verification system that ensures accurate billing for LLM API calls. The system integrates with OpenRouter as the primary LLM provider, maintains up-to-date model pricing, and uses a credit reservation system to prevent over-spending.

## OpenRouter Integration

Helpmaton relies on [OpenRouter](https://openrouter.ai/) as the primary LLM provider. OpenRouter provides:

- **Unified API**: Single API to access multiple LLM providers (OpenAI, Anthropic, Google, etc.)
- **Cost Transparency**: Detailed cost information for each API call
- **Generation Tracking**: Unique generation IDs for each API response to track costs

### Why OpenRouter?

1. **Multi-Provider Support**: Access to models from multiple providers through a single API
2. **Cost Tracking**: OpenRouter provides detailed cost information via their API
3. **Reliability**: OpenRouter handles provider failover and rate limiting
4. **BYOK Support**: Workspaces can use their own OpenRouter API keys (Bring Your Own Key)

### OpenRouter API Key

Helpmaton uses a system-level OpenRouter API key (`OPENROUTER_API_KEY`) for:
- Making LLM API calls on behalf of workspaces
- Fetching model pricing information
- Verifying costs for completed generations

## Model Price Management

### Recurrent Price Downloads

Model prices are automatically downloaded and updated on a **daily schedule** via GitHub Actions:

- **Schedule**: Runs daily at midnight UTC (`0 0 * * *`)
- **Workflow**: `.github/workflows/update-pricing.yml`
- **Script**: `scripts/update-pricing.mjs`

### Price Update Process

The pricing update script performs the following steps:

1. **Fetch OpenRouter Models**: Queries OpenRouter API (`https://openrouter.ai/api/v1/models`) to get all available models
2. **Extract Pricing**: Extracts pricing information from each model's `pricing` object:
   - `prompt` (input tokens per token, as string)
   - `completion` (output tokens per token, as string)
   - `prompt_cached` (cached input tokens per token, optional)
   - `request` (fixed cost per request, optional)
3. **Convert to Per-Million Format**: Converts per-token prices to per-1M-token prices (multiplies by 1,000,000)
4. **Apply 5.5% Markup**: Applies a 5.5% markup to all OpenRouter prices to account for OpenRouter's credit purchase fee
5. **Update Configuration**: Updates `apps/backend/src/config/pricing.json` with new pricing
6. **Commit Changes**: Automatically commits and pushes changes to the repository

### Pricing Configuration Format

Pricing is stored in `apps/backend/src/config/pricing.json`:

```json
{
  "providers": {
    "openrouter": {
      "models": {
        "google/gemini-2.5-flash": {
          "usd": {
            "input": 0.075,
            "output": 0.3,
            "cachedInput": 0.0075,
            "reasoning": 3.5
          }
        }
      }
    }
  },
  "lastUpdated": "2025-01-15T00:00:00.000Z"
}
```

### Model Exclusions

Certain models are excluded from pricing updates:

- **Exact matches**: `gemini-1.5-flash`, `gemini-1.5-pro`
- **Pattern matches**: Models containing `-tts`, `tts-`, `-image`, `image-` (TTS and image generation models)

### Manual Price Updates

The pricing update can also be triggered manually:

```bash
pnpm update-pricing
```

This requires:
- `OPENROUTER_API_KEY` environment variable
- `GEMINI_API_KEY` environment variable (for Google model pricing)

## 3-Step Pricing Verification

Helpmaton uses a 3-step pricing verification process to ensure accurate billing:

### Step 1: Estimate and Reserve

**When**: Before making the LLM API call

**Process**:
1. Estimate token usage based on message length, system prompt, and tool definitions
2. Calculate estimated cost using current model pricing
3. Atomically reserve credits from workspace balance
4. Create a reservation record with 15-minute TTL

**Code Location**: `apps/backend/src/utils/creditManagement.ts` - `reserveCredits()`

**Key Features**:
- Uses DynamoDB `atomicUpdate` to prevent race conditions
- Validates credit balance before reservation
- Creates reservation record for tracking
- Skips reservation for BYOK requests

### Step 2: Adjust Based on Token Usage

**When**: Immediately after LLM API call completes

**Process**:
1. Extract actual token usage from API response:
   - `promptTokens` (input)
   - `completionTokens` (output)
   - `reasoningTokens` (optional)
   - `cachedPromptTokens` (optional)
2. Calculate actual cost from token usage using model pricing
3. Compare actual cost to reserved amount
4. Adjust workspace balance:
   - If actual > reserved: Deduct additional amount
   - If actual < reserved: Refund difference
5. Store token usage-based cost and OpenRouter generation ID in reservation record

**Code Location**: `apps/backend/src/utils/creditManagement.ts` - `adjustCreditReservation()`

**Key Features**:
- Handles all token types (input, output, reasoning, cached)
- Supports tiered pricing models
- Applies 5.5% OpenRouter markup
- Stores generation ID for final verification

### Step 3: Finalize with OpenRouter Cost

**When**: Background job (SQS queue) after OpenRouter API provides final cost

**Process**:
1. Queue processor receives OpenRouter generation ID
2. Fetches actual cost from OpenRouter API (`https://openrouter.ai/api/v1/generation?id={generationId}`)
3. Extracts `total_cost` from OpenRouter response
4. Applies 5.5% markup to OpenRouter cost
5. Compares OpenRouter cost to token usage-based cost (from Step 2)
6. Makes final adjustment to workspace balance
7. Updates conversation message with `finalCostUsd`
8. Deletes reservation record

**Code Location**: 
- Queue: `apps/backend/src/queues/openrouter-cost-verification-queue/index.ts`
- Finalization: `apps/backend/src/utils/creditManagement.ts` - `finalizeCreditReservation()`

**Key Features**:
- Asynchronous processing via SQS FIFO queue
- Handles missing generations gracefully
- Updates conversation records with final costs
- Ensures billing accuracy with OpenRouter's authoritative cost data

### Why 3 Steps?

1. **Step 1 (Estimate)**: Prevents over-spending by reserving credits upfront
2. **Step 2 (Token Usage)**: Provides quick adjustment based on actual token counts
3. **Step 3 (OpenRouter)**: Ensures final accuracy using OpenRouter's authoritative cost data

This approach balances:
- **User Experience**: Quick response times (Steps 1-2 are synchronous)
- **Accuracy**: Final verification ensures correct billing (Step 3 is asynchronous)
- **Reliability**: Handles edge cases where token counts might not match OpenRouter's billing

## Cost Calculation

### Token Cost Formula

Costs are calculated using the following formula:

```typescript
// All prices are per 1M tokens
inputCost = (inputTokens / 1_000_000) × inputPrice
cachedInputCost = (cachedTokens / 1_000_000) × cachedInputPrice
outputCost = (outputTokens / 1_000_000) × outputPrice
reasoningCost = (reasoningTokens / 1_000_000) × reasoningPrice
requestCost = requestPrice (fixed per request)

baseCost = inputCost + cachedInputCost + outputCost + reasoningCost + requestCost

// Apply 5.5% markup for OpenRouter
if (provider === "openrouter") {
  totalCost = Math.ceil(baseCost × 1.055)
} else {
  totalCost = baseCost
}
```

### Currency Representation

All costs are stored as **integer millionths** to avoid floating-point precision issues:

- `$0.001` = `1,000` millionths
- `$1.00` = `1,000,000` millionths
- `$0.000001` = `1` millionth

This ensures:
- No precision loss in calculations
- Accurate credit balance tracking
- Consistent rounding (always rounds up using `Math.ceil()`)

### Rounding Policy

**All costs are rounded UP** using `Math.ceil()` to ensure Helpmaton never undercharges:

```typescript
// Example: $0.0001234 becomes $0.000124 (rounded up)
costInMillionths = Math.ceil(actualCost * 1_000_000)
```

This policy applies to:
- Step 1: Estimated costs
- Step 2: Token usage-based costs
- Step 3: OpenRouter costs

### Tiered Pricing

Some models use tiered pricing (different rates for different token count ranges):

```json
{
  "usd": {
    "tiers": [
      {
        "threshold": 200000,
        "input": 1.25,
        "output": 5.0
      },
      {
        "input": 2.5,
        "output": 10.0
      }
    ]
  }
}
```

The system:
1. Sorts tiers by threshold (ascending)
2. Calculates cost for tokens in each tier range
3. Sums costs across all tiers

See `docs/pricing-calculation.md` for detailed tiered pricing examples.

### 5.5% OpenRouter Markup

All OpenRouter costs include a 5.5% markup to account for OpenRouter's credit purchase fee:

```typescript
if (provider === "openrouter") {
  totalCost = Math.ceil(baseCost * 1.055)
}
```

This markup is applied:
- In Step 1: Estimated costs
- In Step 2: Token usage-based costs
- In Step 3: OpenRouter API costs

## Credit Reservation System

The credit reservation system ensures accurate billing and prevents over-spending.

### Reservation Lifecycle

```
1. Request arrives
   ↓
2. Estimate cost (Step 1)
   ↓
3. Reserve credits atomically
   ├─ Check balance
   ├─ Deduct estimated amount
   └─ Create reservation record
   ↓
4. Make LLM API call
   ↓
5. Adjust based on token usage (Step 2)
   ├─ Calculate actual cost
   ├─ Adjust balance (refund/charge difference)
   └─ Store generation ID
   ↓
6. Queue cost verification (Step 3)
   ↓
7. Finalize with OpenRouter cost
   ├─ Fetch cost from OpenRouter API
   ├─ Make final adjustment
   ├─ Update conversation
   └─ Delete reservation
```

### Reservation Record

Reservations are stored in the `credit-reservations` table:

```typescript
{
  pk: "credit-reservations/{reservationId}",
  workspaceId: string,
  reservedAmount: number,        // Estimated cost (Step 1)
  estimatedCost: number,         // Same as reservedAmount
  tokenUsageBasedCost?: number,  // Actual cost from tokens (Step 2)
  openrouterCost?: number,        // Final cost from OpenRouter (Step 3)
  openrouterGenerationId?: string, // For Step 3 lookup
  provider?: string,
  modelName?: string,
  currency: "usd",
  expires: number,               // TTL timestamp (15 minutes)
  expiresHour: number            // For GSI queries
}
```

### Atomic Operations

All credit operations use DynamoDB's `atomicUpdate` to ensure thread-safety:

```typescript
await db.workspace.atomicUpdate(
  workspacePk,
  "workspace",
  async (current) => {
    if (current.creditBalance < estimatedCost) {
      throw new InsufficientCreditsError(...)
    }
    return {
      pk: workspacePk,
      sk: "workspace",
      creditBalance: current.creditBalance - estimatedCost,
    }
  },
  { maxRetries: 3 }
)
```

This ensures:
- **No race conditions**: Multiple concurrent requests don't over-deduct
- **Accurate balances**: Credit balance is always correct
- **Automatic retries**: Handles version conflicts automatically

### Reservation TTL

Reservations have a 15-minute TTL to prevent orphaned records:

- **TTL**: 15 minutes from creation
- **Automatic cleanup**: DynamoDB automatically deletes expired records
- **Backup cleanup**: Scheduled function also cleans up expired reservations

### Error Handling

**Insufficient Credits**:
- Thrown when balance < estimated cost
- Prevents LLM call from proceeding
- Returns clear error message to user

**Missing Reservation**:
- If reservation not found during adjustment, assumes already processed
- Logs warning but doesn't fail the request
- Safe because credits were either never reserved or already adjusted

**Failed Cost Verification**:
- If OpenRouter API fails, reservation expires via TTL
- Token usage-based cost (Step 2) is used as final cost
- No user impact, but may result in slight cost discrepancy

## Credit Deduction in Workspace

### Workspace Credit Balance

Each workspace maintains a credit balance:

```typescript
{
  pk: "workspaces/{workspaceId}",
  sk: "workspace",
  creditBalance: number,  // In millionths (integer)
  currency: "usd"
}
```

### Deduction Flow

1. **Reservation (Step 1)**: Credits are deducted immediately when reservation is created
2. **Adjustment (Step 2)**: Balance is adjusted based on actual token usage
3. **Finalization (Step 3)**: Final adjustment based on OpenRouter cost

### Negative Balances

Negative credit balances are **allowed**:

- Workspaces can go into negative balance
- Prevents blocking legitimate requests due to timing issues
- Workspaces should monitor balance and add credits

### BYOK (Bring Your Own Key)

When a workspace uses their own OpenRouter API key:

- **Reservation**: Skipped (no credit deduction)
- **Adjustment**: Skipped (no credit adjustment)
- **Finalization**: Skipped (no cost verification)
- **Token Tracking**: Still tracked for analytics

The workspace pays directly to OpenRouter, bypassing Helpmaton's credit system.

## Cost Verification Queue

The cost verification queue (`openrouter-cost-verification-queue`) processes Step 3 verifications:

### Queue Configuration

- **Type**: SQS FIFO queue
- **Message Group**: Per workspace (ensures sequential processing)
- **Visibility Timeout**: 30 seconds
- **Dead Letter Queue**: Configured for failed messages

### Message Format

```typescript
{
  reservationId?: string,           // Optional (not required for BYOK)
  openrouterGenerationId: string,      // Required
  workspaceId: string,               // Required
  conversationId?: string,            // Optional (for message updates)
  agentId?: string                    // Optional (for message updates)
}
```

### Processing

1. **Fetch Cost**: Queries OpenRouter API for generation cost
2. **Finalize Reservation**: Calls `finalizeCreditReservation()` if reservationId provided
3. **Update Message**: Updates conversation message with `finalCostUsd` if conversation context available
4. **Error Handling**: Logs errors but doesn't fail (best-effort verification)

### Partial Batch Failures

The queue supports partial batch failures:
- Successful messages are deleted immediately
- Failed messages are retried individually
- Prevents reprocessing of successful messages

## Feature Flags

Credit system behavior can be controlled via environment variables:

- **`ENABLE_CREDIT_VALIDATION`**: Controls credit balance validation (default: `true`)
  - When disabled: Skips credit balance checks
  - Still allows reservation creation if `ENABLE_CREDIT_DEDUCTION` is enabled

- **`ENABLE_CREDIT_DEDUCTION`**: Controls credit reservation and deduction (default: `true`)
  - When disabled: No reservations created, no credits deducted
  - Useful for testing or maintenance

- **`ENABLE_SPENDING_LIMIT_CHECKS`**: Controls spending limit validation (default: `true`)
  - When disabled: Skips spending limit checks
  - Limits are still stored but not enforced

## Monitoring and Troubleshooting

### Key Metrics

- **Reservation Creation Rate**: Number of reservations created per minute
- **Reservation Expiration Rate**: Number of reservations expiring without finalization
- **Cost Verification Success Rate**: Percentage of successful Step 3 verifications
- **Credit Balance Trends**: Average credit balance over time

### Common Issues

**Credits Not Deducted**:
- Check if BYOK is enabled (skips deduction)
- Verify `ENABLE_CREDIT_DEDUCTION` is enabled
- Check reservation records in DynamoDB
- Review error logs for atomic update failures

**Cost Verification Failures**:
- Check OpenRouter API availability
- Verify `OPENROUTER_API_KEY` is set correctly
- Review queue processing logs
- Check for generation ID mismatches

**Pricing Out of Date**:
- Verify GitHub Actions workflow is running
- Check `lastUpdated` in `pricing.json`
- Manually trigger pricing update: `pnpm update-pricing`
- Review pricing update logs for errors

## Related Documentation

- [Credit System](./credit-system.md) - Detailed credit reservation and adjustment flows
- [Pricing Calculation](./pricing-calculation.md) - Token cost calculation formulas and examples
- [Database Schema](./database-schema.md) - Database table structures

## Implementation Files

- **Pricing Configuration**: `apps/backend/src/config/pricing.json`
- **Pricing Logic**: `apps/backend/src/utils/pricing.ts`
- **Credit Management**: `apps/backend/src/utils/creditManagement.ts`
- **Cost Verification Queue**: `apps/backend/src/queues/openrouter-cost-verification-queue/index.ts`
- **Price Update Script**: `scripts/update-pricing.mjs`
- **Price Update Workflow**: `.github/workflows/update-pricing.yml`

