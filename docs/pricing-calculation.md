# Pricing Calculation

This document describes how Helpmaton calculates costs for LLM API calls based on token usage.

## Overview

Helpmaton uses a flexible pricing system that supports:

- **Flat pricing**: Single rate per token type (input/output/reasoning)
- **Tiered pricing**: Different rates based on token count thresholds
- **USD currency**: All pricing in USD
- **Reasoning tokens**: Separate billing for reasoning tokens when supported by the model

All prices in the configuration are specified **per 1 million tokens**.

## Pricing Structure

### Flat Pricing

Flat pricing uses a single rate for each token type. This is the default and backward-compatible format:

```json
{
  "usd": {
    "input": 0.075,
    "output": 0.3,
    "reasoning": 3.5 // Optional
  }
}
```

### Tiered Pricing

Tiered pricing allows different rates based on token count thresholds. This is useful for models that charge different rates for different usage tiers (e.g., different rates for tokens below/above 200k).

```json
{
  "usd": {
    "tiers": [
      {
        "threshold": 200000,
        "input": 1.25,
        "output": 5.0,
        "reasoning": 10.0 // Optional
      },
      {
        // No threshold means "above previous threshold"
        "input": 2.5,
        "output": 10.0,
        "reasoning": 15.0
      }
    ]
  }
}
```

**Tier Rules:**

- Tiers are sorted by threshold (ascending)
- Tiers with `threshold` apply to tokens up to that threshold
- Tiers without `threshold` apply to all remaining tokens above the previous threshold
- Tokens are charged at the rate for the tier they fall into

## Token Types

The system tracks three types of tokens:

1. **Input Tokens** (`promptTokens`): Tokens in the prompt/messages sent to the model
2. **Output Tokens** (`completionTokens`): Tokens in the model's response
3. **Reasoning Tokens** (`reasoningTokens`): Optional tokens used for reasoning (when model supports it)

### Token Extraction

Token usage is extracted from the LLM API response. The system handles multiple field name variations:

- `promptTokens` / `inputTokens` for input
- `completionTokens` / `outputTokens` for output
- `reasoningTokens` / `reasoning` for reasoning tokens

## Cost Calculation

### Basic Formula

For flat pricing:

```
cost = (inputTokens / 1,000,000) × inputPrice +
       (outputTokens / 1,000,000) × outputPrice +
       (reasoningTokens / 1,000,000) × reasoningPrice
```

### Tiered Pricing Calculation

For tiered pricing, tokens are split across tiers:

1. Tiers are sorted by threshold (ascending)
2. For each tier:
   - Calculate how many tokens fall in this tier's range
   - Apply the tier's rate to those tokens
   - Subtract those tokens from remaining count
3. If a tier has no threshold, it applies to all remaining tokens

**Example with tiered pricing:**

Given:

- Input tokens: 250,000
- Tiers:
  - Tier 1: threshold 200,000, input rate $1.25/M
  - Tier 2: no threshold, input rate $2.50/M

Calculation:

- First 200,000 tokens: 200,000 / 1,000,000 × $1.25 = $0.25
- Next 50,000 tokens: 50,000 / 1,000,000 × $2.50 = $0.125
- Total input cost: $0.375

### Reasoning Token Handling

Reasoning tokens are handled specially:

1. If reasoning pricing is specified (flat or in tiers), use that rate
2. If no reasoning pricing exists, reasoning tokens are charged at the output token rate
3. If reasoning tokens are 0 or not present, no reasoning cost is applied

### Rounding

All costs are rounded to **6 decimal places** to avoid floating point precision issues:

```typescript
totalCost =
  Math.round((inputCost + outputCost + reasoningCost) * 1_000_000) / 1_000_000;
```

## Currency Support

The system uses USD (United States Dollar) as the only currency.

All pricing is defined in USD and costs are calculated in USD.

## Model Name Normalization

The system handles model name variations through normalization:

1. **Exact match**: First tries to find an exact match for the model name
2. **Base model matching**: If no exact match, tries to match against base model names:
   - `gemini-2.5-flash`
   - `gemini-2.0-flash-exp`
   - `gemini-1.5-pro`
   - `gemini-1.5-flash`

For example, `gemini-2.5-flash-preview-05-20` would match to `gemini-2.5-flash` pricing.

## Calculation Flow

1. **Token Extraction**: Extract token counts from API response

   - Handles multiple field name variations
   - Extracts reasoning tokens if present

2. **Model Pricing Lookup**: Find pricing for the provider and model

   - Try exact model name match
   - Try normalized model name match
   - Return undefined if no match found (cost = 0)

3. **Currency Selection**: Get pricing for the requested currency

   - Defaults to USD if not specified
   - Returns 0 if currency not found

4. **Cost Calculation**:

   - Calculate input token cost (flat or tiered)
   - Calculate output token cost (flat or tiered)
   - Calculate reasoning token cost (if present)
   - Sum all costs
   - Round to 6 decimal places

5. **Return**: Return cost in requested currency (or all currencies if using `calculateTokenCosts`)

## Examples

### Example 1: Flat Pricing

**Model**: `gemini-1.5-flash`
**Pricing**:

- Input: $0.075 per 1M tokens
- Output: $0.30 per 1M tokens

**Usage**:

- Input tokens: 1,000,000
- Output tokens: 500,000

**Calculation**:

```
Input cost:  1,000,000 / 1,000,000 × $0.075 = $0.075
Output cost: 500,000 / 1,000,000 × $0.30 = $0.15
Total cost:  $0.225
```

### Example 2: Tiered Pricing

**Model**: `gemini-1.5-pro` (with tiered pricing)
**Pricing**:

- Tier 1 (0-200k tokens): Input $1.25/M, Output $5.00/M
- Tier 2 (200k+ tokens): Input $2.50/M, Output $10.00/M

**Usage**:

- Input tokens: 250,000
- Output tokens: 100,000

**Calculation**:

```
Input cost:
  - First 200k: 200,000 / 1,000,000 × $1.25 = $0.25
  - Next 50k:   50,000 / 1,000,000 × $2.50 = $0.125
  - Total: $0.375

Output cost:
  - 100k tokens (all in Tier 1): 100,000 / 1,000,000 × $5.00 = $0.50

Total cost: $0.875
```

### Example 3: Tiered Pricing (Simple Case)

**Model**: `gemini-2.5-pro` (with tiered pricing)
**Pricing**:

- Tier 1 (0-200k tokens): Input $1.25/M, Output $10.00/M
- Tier 2 (200k+ tokens): Input $2.50/M, Output $15.00/M

**Usage**:

- Input tokens: 150,000
- Output tokens: 100,000

**Calculation**:

```
Input cost (all in Tier 1):
  150,000 / 1,000,000 × $1.25 = $0.1875

Output cost (all in Tier 1):
  100,000 / 1,000,000 × $10.00 = $1.00

Total cost: $1.1875
```

### Example 4: Tiered Pricing with Reasoning

**Model**: `gemini-2.5-pro` (tiered with reasoning)
**Pricing**:

- Tier 1 (0-200k): Input $1.25/M, Output $5.00/M, Reasoning $10.00/M
- Tier 2 (200k+): Input $2.50/M, Output $10.00/M, Reasoning $15.00/M

**Usage**:

- Input tokens: 150,000
- Output tokens: 50,000
- Reasoning tokens: 250,000

**Calculation**:

```
Input cost (all in Tier 1):
  150,000 / 1,000,000 × $1.25 = $0.1875

Output cost (all in Tier 1):
  50,000 / 1,000,000 × $5.00 = $0.25

Reasoning cost (split across tiers):
  - First 200k: 200,000 / 1,000,000 × $10.00 = $2.00
  - Next 50k:   50,000 / 1,000,000 × $15.00 = $0.75
  - Total: $2.75

Total cost: $3.1875
```

## Error Handling

- **Missing model pricing**: Returns cost of 0 and logs a warning
- **Missing currency pricing**: Returns cost of 0 and logs a warning
- **Invalid token counts**: Negative or zero tokens are handled gracefully
- **Missing reasoning pricing**: Reasoning tokens fall back to output token pricing

## Pricing Configuration

Pricing is stored in `apps/backend/src/config/pricing.json` and is:

- Loaded at application startup
- Updated via the `update-pricing.mjs` script
- All pricing is in USD

The pricing update script:

1. Fetches available models from Google API
2. Matches models to known pricing
3. Updates USD pricing
4. Commits and pushes changes automatically

## Implementation Details

### Key Functions

- `calculateTokenCost()`: Main function for calculating cost in USD
- `calculateTokenCosts()`: Calculates costs in USD (deprecated, use calculateTokenCost directly)
- `calculateTieredCost()`: Internal function for tiered pricing calculation
- `getModelPricing()`: Retrieves pricing configuration for a model
- `normalizeModelName()`: Normalizes model names for pricing lookup

### Code Location

- Pricing logic: `apps/backend/src/utils/pricing.ts`
- Token extraction: `apps/backend/src/utils/conversationLogger.ts`
- Cost aggregation: `apps/backend/src/utils/tokenAccounting.ts`
- Credit management: `apps/backend/src/utils/creditManagement.ts`

## Testing

Comprehensive tests are available in:

- `apps/backend/src/utils/__tests__/pricing.test.ts` - Pricing calculation tests
- `apps/backend/src/utils/__tests__/conversationLogger.test.ts` - Token extraction tests

Tests cover:

- Flat pricing calculations
- Tiered pricing calculations
- Reasoning token handling
- Edge cases (zero tokens, missing pricing, etc.)
- Currency conversions
