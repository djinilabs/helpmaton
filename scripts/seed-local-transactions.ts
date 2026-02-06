#!/usr/bin/env tsx
/**
 * Seed local workspace credit transactions for a workspace and agent.
 * Inserts realistic-looking rows (text-generation, embedding-generation, tool-execution)
 * for the given workspace and agent.
 *
 * Use with local DynamoDB: start the sandbox (e.g. pnpm dev:backend) so the DB is
 * available, then from another terminal run this script. If your sandbox uses
 * ARC_DB_PATH=./db, use the same when running the script so it hits the same DB.
 *
 * Usage:
 *   pnpm seed-local-transactions [workspaceId] [agentId]
 *
 * Example (defaults to the IDs below if omitted):
 *   pnpm seed-local-transactions fdd6d5b5-2115-421f-9f11-0a63c9c8fb75 89dd8052-fcc1-4dc1-bb14-844fc993f842
 */

import { randomUUID } from "crypto";

const WORKSPACE_ID = "fdd6d5b5-2115-421f-9f11-0a63c9c8fb75";
const AGENT_ID = "89dd8052-fcc1-4dc1-bb14-844fc993f842";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

function ttl(): number {
  return Math.floor(Date.now() / 1000) + ONE_YEAR_SECONDS;
}

/** Nano USD: 1 USD = 1e9 */
function nanoUsd(dollars: number): number {
  return Math.round(dollars * 1_000_000_000);
}

async function main() {
  const args = process.argv.slice(2);
  const workspaceId = args[0] ?? WORKSPACE_ID;
  const agentId = args[1] ?? AGENT_ID;

  const { database } = await import("../apps/backend/src/tables/index.ts");
  const db = await database();

  const workspacePk = `workspaces/${workspaceId}`;
  const agentPk = `agents/${workspaceId}/${agentId}`;

  const workspace = await db.workspace.get(workspacePk, "workspace");
  if (!workspace) {
    console.error(`❌ Workspace ${workspaceId} not found`);
    process.exit(1);
  }

  const agent = await db.agent.get(agentPk, "agent");
  if (!agent) {
    console.error(`❌ Agent ${agentId} not found in workspace ${workspaceId}`);
    process.exit(1);
  }

  // Build transactions from oldest to newest (so running balance is consistent).
  // SK format: timestamp-counter-uuid for sort order (ascending time).
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  const transactions: Array<{
    ts: number;
    requestId: string;
    conversationId: string | undefined;
    source: "embedding-generation" | "text-generation" | "tool-execution";
    supplier: "openrouter" | "tavily" | "exa";
    model: string | undefined;
    tool_call: string | undefined;
    description: string;
    amountNanoUsd: number;
  }> = [
    {
      ts: now - 5 * oneHour,
      requestId: `seed-${randomUUID()}`,
      conversationId: undefined,
      source: "embedding-generation",
      supplier: "openrouter",
      model: "thenlper/gte-base",
      tool_call: undefined,
      description: "Embedding generation for knowledge base indexing (12 chunks)",
      amountNanoUsd: nanoUsd(0.00012),
    },
    {
      ts: now - 4 * oneHour,
      requestId: `seed-${randomUUID()}`,
      conversationId: `conv-${randomUUID()}`,
      source: "text-generation",
      supplier: "openrouter",
      model: "openai/gpt-4o-mini",
      tool_call: undefined,
      description: "Chat completion (user + assistant turn, 340 input / 120 output tokens)",
      amountNanoUsd: nanoUsd(0.0018),
    },
    {
      ts: now - 3 * oneHour,
      requestId: `seed-${randomUUID()}`,
      conversationId: undefined,
      source: "tool-execution",
      supplier: "tavily",
      model: undefined,
      tool_call: "search_web",
      description: "Tavily search_web (query: latest product updates)",
      amountNanoUsd: nanoUsd(0.0085),
    },
    {
      ts: now - 2 * oneHour,
      requestId: `seed-${randomUUID()}`,
      conversationId: `conv-${randomUUID()}`,
      source: "text-generation",
      supplier: "openrouter",
      model: "anthropic/claude-3-5-sonnet",
      tool_call: undefined,
      description: "Chat completion with tool use (2 rounds, 1200 input / 450 output tokens)",
      amountNanoUsd: nanoUsd(0.024),
    },
    {
      ts: now - 1 * oneHour,
      requestId: `seed-${randomUUID()}`,
      conversationId: undefined,
      source: "tool-execution",
      supplier: "exa",
      model: undefined,
      tool_call: "search",
      description: "Exa semantic search (5 results, news and research)",
      amountNanoUsd: nanoUsd(0.0042),
    },
    {
      ts: now,
      requestId: `seed-${randomUUID()}`,
      conversationId: `conv-${randomUUID()}`,
      source: "text-generation",
      supplier: "openrouter",
      model: "openai/gpt-4o",
      tool_call: undefined,
      description: "Chat completion (long context, 3200 input / 180 output tokens)",
      amountNanoUsd: nanoUsd(0.031),
    },
  ];

  // Running balance: assume we want the *newest* transaction to leave balance as current workspace balance.
  // So we work backwards: balanceAfter for newest = workspace.creditBalance, then balanceBefore = balanceAfter - amount.
  const currentBalance = (workspace as { creditBalance: number }).creditBalance;
  let runningBalance = currentBalance;
  const records: Array<{
    balanceBefore: number;
    balanceAfter: number;
    t: (typeof transactions)[0];
  }> = [];
  for (let i = transactions.length - 1; i >= 0; i--) {
    const t = transactions[i];
    const balanceAfter = runningBalance;
    const balanceBefore = balanceAfter - t.amountNanoUsd;
    runningBalance = balanceBefore;
    records.push({ balanceBefore, balanceAfter, t });
  }
  records.reverse(); // oldest first again

  const table = db["workspace-credit-transactions"];
  let created = 0;
  for (let i = 0; i < records.length; i++) {
    const { balanceBefore, balanceAfter, t } = records[i];
    const createdAt = new Date(t.ts).toISOString();
    const sk = `${t.ts}-${i}-${randomUUID()}`;
    const agentIdCreatedAt = `${agentId}#${createdAt}`;

    await table.create({
      pk: workspacePk,
      sk,
      requestId: t.requestId,
      workspaceId,
      agentId,
      agentIdCreatedAt,
      conversationId: t.conversationId,
      source: t.source,
      supplier: t.supplier,
      model: t.model,
      tool_call: t.tool_call,
      description: t.description,
      amountNanoUsd: t.amountNanoUsd,
      workspaceCreditsBeforeNanoUsd: balanceBefore,
      workspaceCreditsAfterNanoUsd: balanceAfter,
      expires: ttl(),
    });
    created++;
  }

  console.log(`✅ Created ${created} transactions for workspace ${workspaceId}, agent ${agentId}`);
  console.log(`   Workspace list: GET /api/workspaces/${workspaceId}/transactions`);
  console.log(`   Agent list:     GET /api/workspaces/${workspaceId}/agents/${agentId}/transactions`);
}

main().catch((err) => {
  console.error("❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
