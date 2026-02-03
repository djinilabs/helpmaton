# Cost Reporting Audit

This document audits the pipeline from charge creation → aggregation → API → UI to ensure reported costs in the UI are accurate.

---

## a) Where charges are created and how (data completeness)

### Charge storage

All usage charges are recorded as **workspace credit transactions** in the `workspace-credit-transactions` DynamoDB table. Each transaction has:

- **Required**: `workspaceId`, `source`, `supplier`, `description`, `amountNanoUsd`, `pk`, `sk`, `createdAt`, `agentIdCreatedAt` (for GSI)
- **Optional (but set when available)**: `agentId`, `conversationId`, `model`, `tool_call`

Transactions are created in memory via `context.addWorkspaceCreditTransaction()` and committed atomically at the end of the request by `commitTransactions()` in `apps/backend/src/utils/workspaceCreditTransactions.ts`. On commit, `agentIdCreatedAt` is set to `${agentId ?? "workspace"}#${createdAt}` for the `byWorkspaceIdAndAgentId` GSI.

### Charge creation points

| Source | Where | Data set (workspaceId, agentId, conversationId, model/tool_call) | Notes |
|--------|--------|----------------------------------------------------------------|-------|
| **text-generation** | `creditManagement.ts`: `reserveCredits`, `adjustCreditReservation`, `finalizeCreditReservation` | workspaceId, agentId?, conversationId? (from reservation or args), model | Step 1 = reserve (debit estimate); Step 2 = adjust (difference from token usage); Step 3 = finalize (OpenRouter cost vs token cost). All pass agentId/conversationId when available. |
| **text-generation** (cost verification queue) | `openrouter-cost-verification-queue/index.ts` | workspaceId, agentId?, conversationId? from queue message | Queue message includes agentId/conversationId; finalizeCreditReservation uses reservation.agentId/conversationId. |
| **embedding-generation** | `embeddingCredits.ts`: `adjustEmbeddingCreditReservation` | workspaceId, agentId?, conversationId?, toolCall? | tool_call e.g. "document-search-embedding". |
| **tool-execution** (rerank) | `knowledgeRerankingCredits.ts`: reserve, adjust, refund | workspaceId, agentId?, conversationId?, tool_call: "rerank", supplier: "openrouter" | |
| **tool-execution** (Tavily) | `tavilyCredits.ts`: reserve, adjust, refund | workspaceId, agentId?, conversationId?, tool_call: "search_web" \| "fetch_url", supplier: "tavily" | |
| **tool-execution** (Exa) | `exaCredits.ts`: reserve, adjust, refund | workspaceId, agentId?, conversationId?, tool_call: "search", supplier: "exa" | |
| **tool-execution** (scrape) | `post-api-scrape` + credit flow | workspaceId, agentId?, conversationId?, tool_call, supplier | |
| **credit-purchase** | `post-api-webhooks-lemonsqueezy`: handleOrderCreated | workspaceId only | No agent/conversation. |

**Data completeness**: All request-scoped flows that have `context.addWorkspaceCreditTransaction` receive or propagate `agentId` and `conversationId` from reservations or call-site context. Reservations are created with agentId/conversationId when available (e.g. stream handlers, webhook handlers). The cost verification queue message includes `agentId` and `conversationId`; `finalizeCreditReservation` uses the reservation’s agentId/conversationId when creating the Step 3 transaction. So charges that are tied to an agent or conversation carry that data when it exists.

**Conversation-level costs (not transactions)**:

- **agent-conversations** stores `costUsd` (text generation) and `rerankingCostUsd` on the conversation record. These are **not** used for aggregation totals: text cost comes only from transactions; reranking cost comes only from tool-execution (rerank) transactions. Conversation fields are used for conversation-level display and for cost verification queue updates (reranking final cost written to conversation).

---

## b) How aggregations are performed

### Entry point: `queryUsageStats` (aggregation.ts)

- **Input**: `db`, `workspaceId?`, `agentId?`, `userId?`, `startDate`, `endDate`.
- **Output**: Single `UsageStats` (tokens, costUsd, rerankingCostUsd, evalCostUsd, costByType, byModel, byProvider, byByok, toolExpenses).

Date range is split into **recent** vs **old** using `isRecentDate(date)` (default: last 7 days are “recent”). This controls whether we read from raw conversations/transactions or from pre-aggregated tables.

### Recent dates (conversations + transactions + eval)

1. **Conversations**  
   `queryConversationsForDateRange` → `aggregateConversations`.  
   - Uses GSI `byWorkspaceIdAndAgentId` when both workspaceId and agentId are set (key-only).  
   - **Tokens**: summed from conversation `tokenUsage`.  
   - **Cost**: **not** summed from conversation (`costUsd` and `rerankingCostUsd` on conversations are intentionally skipped to avoid double-count with transactions).

2. **Non-tool transactions**  
   `queryTransactionsForDateRange` → `aggregateTransactionsStream`.  
   - Uses GSI `byWorkspaceIdAndAgentId` when both workspaceId and agentId are set (key-only, date range on `agentIdCreatedAt`).  
   - **Included**: `source` in `text-generation`, `embedding-generation`.  
   - **Excluded**: `tool-execution`, `credit-purchase`.  
   - Each transaction’s debit (absolute value of negative `amountNanoUsd`) is added to `stats.costUsd` and to `stats.costByType` via `classifyTransactionChargeType` (textGeneration, embeddings, scrape, imageGeneration, etc.).

3. **Tool transactions**  
   Same `queryTransactionsForDateRange` (second pass) → `aggregateToolTransactionsStream`.  
   - **Included**: only `source === "tool-execution"`.  
   - **Rerank** (`tool_call === "rerank"`): cost added to `stats.rerankingCostUsd` and `stats.costByType.reranking` (and toolExpenses). **Not** added to `stats.costUsd` (avoids double-count with former conversation rerankingCostUsd).  
   - **Other tools** (Tavily, Exa, scrape, etc.): cost added to `stats.costUsd` and corresponding `costByType` and `toolExpenses`.

4. **Eval costs**  
   `queryEvalCostsForDateRange`.  
   - Uses GSI `byWorkspaceIdAndAgentId` on `agent-eval-result` when both workspaceId and agentId are set (key-only, `agentIdEvaluatedAt` BETWEEN).  
   - Sums `costUsd` from eval result records into `stats.evalCostUsd` and `stats.costByType.eval`.

5. **Merge**  
   All of the above `UsageStats` are merged with `mergeUsageStats(...)`: numeric fields and nested structures (byModel, byProvider, byByok, toolExpenses, costByType) are summed/merged.

### Old dates (aggregates + non-tool transactions)

- **Token aggregates**: `queryAggregatesForDate` (token-usage-aggregates) per date → `aggregateAggregates`.  
  Uses `byWorkspaceIdAndAgentId` when workspaceId + agentId are set.
- **Tool aggregates**: `queryToolAggregatesForDate` (tool-usage-aggregates) per date → `aggregateToolAggregates`.  
  Uses `byWorkspaceIdAndAgentId` when workspaceId + agentId are set.  
  **Rerank**: same rule as streaming path — cost goes to `stats.rerankingCostUsd` and `costByType.reranking`, not to `stats.costUsd`.
- **Non-tool transactions**: `queryTransactionsForDateRange` for the full old date range → `aggregateTransactionsStream` (same as recent).
- **Eval**: not re-queried for “old” dates in the current split; eval results are queried only for the recent date range. So for a 30-day window, eval costs are only included for the recent portion. *If evals are required for all dates, this is a gap.*

All per-date and per-range results are merged with `mergeUsageStats`.

### Total cost identity

- **costUsd**: text-generation + embedding-generation + tool-execution (non-rerank) from transactions (or from token/tool aggregates for old dates).
- **rerankingCostUsd**: only from tool-execution with `tool_call === "rerank"` (stream or tool aggregates).
- **evalCostUsd**: from agent-eval-result queries (recent dates only in current logic).

So:

`total cost = costUsd + rerankingCostUsd + evalCostUsd`.

`costByType` is populated so that:

`sum(costByType[*]) = costUsd + rerankingCostUsd + evalCostUsd`.

No double-count: conversation `costUsd` and `rerankingCostUsd` are not added into these totals.

---

## c) How they’re served and presented in the UI

### API routes

| Route | Handler | Scope | Total cost sent to client |
|-------|---------|--------|----------------------------|
| `GET /api/workspaces/:workspaceId/usage` | get-workspace-usage | workspaceId | `cost = sum(stats.costByType)` |
| `GET /api/workspaces/:workspaceId/agents/:agentId/usage` | get-agent-usage | workspaceId + agentId | `cost = sum(stats.costByType)` |
| `GET /api/usage` (API key usage) | get-api-usage | per-workspace, then merged | Same structure, cost = sum(costByType) |
| `GET /api/workspaces/:workspaceId/usage/daily` | get-workspace-usage-daily | workspaceId, per-day | Same for each day |
| `GET /api/workspaces/:workspaceId/agents/:agentId/usage/daily` | get-agent-usage-daily | workspaceId + agentId, per-day | Same for each day |

All usage routes call `queryUsageStats(db, { workspaceId, agentId?, startDate, endDate })` with the appropriate scope. They then compute:

```ts
const totalCost = Object.values(stats.costByType || {}).reduce((sum, value) => sum + value, 0);
```

and return `stats: { ..., cost: totalCost, costByType: stats.costByType, rerankingCostUsd: stats.rerankingCostUsd, evalCostUsd: stats.evalCostUsd, ... }`.

So the **API “cost”** equals **sum(costByType)** and is consistent with **costUsd + rerankingCostUsd + evalCostUsd**.

### Spending limits

`getSpendingInWindow` (spendingLimits.ts) uses:

```ts
return (stats.costUsd || 0) + (stats.rerankingCostUsd || 0) + (stats.evalCostUsd || 0);
```

So limits use the same total as the displayed cost (and as sum(costByType)).

### Frontend

- **UsageStats** (`apps/frontend/src/components/UsageStats.tsx`):
  - **Total Cost**: `formatCurrency(stats.cost, currency, 10)` — i.e. the API’s `cost` (nano-dollars, exponent 10 for display).
  - **Reranking Cost / Eval Cost**: shown as separate cards when `stats.rerankingCostUsd > 0` or `stats.evalCostUsd > 0`; these are the same nano-dollar values from the API.
- **formatCurrency**: expects nano-dollars (integer); the third parameter is the exponent used for conversion to display units (e.g. 10^9 for nano to dollars).

So the UI shows:

- One total = `stats.cost` = sum(costByType) = costUsd + rerankingCostUsd + evalCostUsd.
- Optional breakdown cards for reranking and eval; they are part of the total, not added twice.

### Consistency summary

| Layer | Total cost definition | Matches |
|-------|------------------------|--------|
| Aggregation | costUsd + rerankingCostUsd + evalCostUsd | sum(costByType) by design |
| API response | cost = sum(costByType) | Yes |
| Spending limits | costUsd + rerankingCostUsd + evalCostUsd | Yes |
| UI Total Cost | stats.cost (nano-dollars) | Yes |

---

## Findings and recommendations

1. **Charges have required context**  
   Transactions are created with workspaceId; agentId and conversationId are set when the flow has them (reservation, queue message, or call-site). Commit writes `agentIdCreatedAt` for the GSI so agent-scoped queries do not rely on filters.

2. **No double-count**  
   Conversation `costUsd` and `rerankingCostUsd` are not used in aggregation totals; text cost comes from transactions, reranking from tool-execution (rerank) transactions (or tool aggregates for old dates).

3. **Total cost is consistent**  
   API and UI use sum(costByType) as the single total; spending limits use costUsd + rerankingCostUsd + evalCostUsd; they match.

4. **Eval costs on old dates**  
   Eval results are only queried for the “recent” date range. If the UI shows a 30-day window, eval costs for days outside “recent” are not included. **Recommendation**: If evals should count for the full range, add a dedicated eval query (or include eval in the “old dates” path) and merge into the same UsageStats.

5. **Old dates: tool costs**  
   For old dates, tool (and reranking) costs come only from `tool-usage-aggregates`, populated by the scheduled `aggregate-token-usage` job. If the job fails or lags for a date, that date’s tool/reranking cost will be missing until backfilled. No code bug; operational consideration.

6. **API total = sum(costByType)**  
   Using sum(costByType) is correct and robust: any new charge type that is added to costByType will automatically be included in the reported total and in the UI.
