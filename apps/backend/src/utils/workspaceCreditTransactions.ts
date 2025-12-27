import { randomUUID } from "crypto";

import type { DatabaseSchemaWithAtomicUpdate, TableRecord , AtomicUpdateRecordSpec, AtomicUpdateCallback } from "../tables/schema";

/**
 * Process-level counter for transaction IDs to ensure higher time resolution
 * This counter increments monotonically for each transaction within the process
 */
let transactionCounter = 0;

/**
 * Workspace credit transaction input type
 */
export type WorkspaceCreditTransaction = {
  workspaceId: string;
  agentId?: string;
  conversationId?: string;
  source: "embedding-generation" | "text-generation" | "tool-execution";
  supplier: "openrouter" | "tavily"; // add more when we have more suppliers
  model?: string; // the model that was used when originated this charge, if any
  tool_call?: string; // the tool call that was used when originating this charge, if any
  description: string;
  amountMillionthUsd: number; // should be integer
};

/**
 * Transaction buffer that stores transactions per request
 * Groups transactions by workspace for aggregation
 */
export type TransactionBuffer = Map<string, WorkspaceCreditTransaction[]>;

/**
 * Creates a new transaction buffer
 */
export function createTransactionBuffer(): TransactionBuffer {
  return new Map<string, WorkspaceCreditTransaction[]>();
}

/**
 * Adds a transaction to the buffer
 * Groups transactions by workspace for later aggregation
 * Discards transactions with zero amount
 */
export function addTransactionToBuffer(
  buffer: TransactionBuffer,
  transaction: WorkspaceCreditTransaction
): void {
  // Discard transactions with zero amount, EXCEPT for tool-execution (we want to track usage even if cost is 0)
  if (transaction.amountMillionthUsd === 0 && transaction.source !== "tool-execution") {
    return;
  }

  const { workspaceId } = transaction;
  const existing = buffer.get(workspaceId) || [];
  existing.push(transaction);
  buffer.set(workspaceId, existing); // Set the updated array back to the buffer
  
  console.log("[addTransactionToBuffer] Added transaction:", {
    workspaceId,
    transaction,
    bufferSize: buffer.size,
    transactionsForWorkspace: existing.length,
  });
}

/**
 * Commits all transactions in the buffer using atomic multi-table transaction
 * Aggregates transactions by workspace (sums amounts) but creates separate transaction records
 * 
 * @param db - Database instance
 * @param buffer - Transaction buffer
 * @param requestId - AWS request ID from context
 * @throws Error if workspace not found or commit fails
 */
export async function commitTransactions(
  db: DatabaseSchemaWithAtomicUpdate,
  buffer: TransactionBuffer,
  requestId: string
): Promise<void> {
  if (buffer.size === 0) {
    // No transactions to commit
    return;
  }

  // Group transactions by workspace and aggregate amounts
  const workspaceTransactions = new Map<string, {
    totalAmount: number;
    transactions: WorkspaceCreditTransaction[];
  }>();

  for (const [workspaceId, transactions] of buffer.entries()) {
    const totalAmount = transactions.reduce((sum, t) => sum + t.amountMillionthUsd, 0);
    workspaceTransactions.set(workspaceId, {
      totalAmount,
      transactions,
    });
  }

  // Generate SKs for all transaction records upfront
  const timestamp = Date.now();
  const transactionRecords: Array<{
    workspaceId: string;
    transaction: WorkspaceCreditTransaction;
    sk: string;
  }> = [];

  for (const [workspaceId, { transactions }] of workspaceTransactions.entries()) {
    for (const transaction of transactions) {
      // Increment process-level counter for higher time resolution
      // This ensures transactions created in the same millisecond are still sortable
      transactionCounter++;
      
      // Use full UUID for better uniqueness (128 bits of entropy)
      // Format: timestamp-counter-uuid
      // The timestamp ensures sortability, counter provides higher resolution, UUID ensures uniqueness
      const uniqueId = randomUUID();
      const sk = `${timestamp}-${transactionCounter}-${uniqueId}`;
      transactionRecords.push({
        workspaceId,
        transaction,
        sk,
      });
    }
  }

  // Build record specs for atomic update
  const recordSpec: AtomicUpdateRecordSpec = new Map();
  
  // Add workspace specs
  for (const workspaceId of workspaceTransactions.keys()) {
    const workspacePk = `workspaces/${workspaceId}`;
    recordSpec.set(`workspace-${workspaceId}`, {
      table: "workspace",
      pk: workspacePk,
      sk: "workspace",
    });
  }

  // Add transaction record specs (they're new, so fetched will be undefined)
  for (let i = 0; i < transactionRecords.length; i++) {
    const { workspaceId, sk } = transactionRecords[i];
    const workspacePk = `workspaces/${workspaceId}`;
    recordSpec.set(`transaction-${i}`, {
      table: "workspace-credit-transactions",
      pk: workspacePk,
      sk,
    });
  }

  // Build callback that updates workspaces and creates transaction records
  const callback: AtomicUpdateCallback = async (fetchedRecords) => {
    const recordsToPut: Array<TableRecord> = [];
    
    // Track new balances per workspace to avoid recalculating
    const workspaceNewBalances = new Map<string, number>();

    for (const [workspaceId, { totalAmount }] of workspaceTransactions.entries()) {
      const workspaceKey = `workspace-${workspaceId}`;
      const workspace = fetchedRecords.get(workspaceKey);

      if (!workspace) {
        throw new Error(
          `Workspace ${workspaceId} not found (requestId: ${requestId})`
        );
      }

      // Calculate new balance
      // Negative amounts = debit (deduct from workspace), positive amounts = credit (add to workspace)
      const currentBalance = (workspace as { creditBalance: number }).creditBalance;
      const newBalance = currentBalance + totalAmount;
      workspaceNewBalances.set(workspaceId, newBalance);

      // Update workspace balance
      const workspacePk = `workspaces/${workspaceId}`;
      recordsToPut.push({
        ...workspace,
        pk: workspacePk,
        sk: "workspace",
        creditBalance: newBalance,
        version: ((workspace as { version: number }).version || 0) + 1,
        updatedAt: new Date().toISOString(),
      });
    }

    // Create transaction records
    for (let i = 0; i < transactionRecords.length; i++) {
      const { workspaceId, transaction, sk } = transactionRecords[i];
      const workspacePk = `workspaces/${workspaceId}`;
      
      // Get the workspace to get current balance for this transaction
      const workspaceKey = `workspace-${workspaceId}`;
      const workspace = fetchedRecords.get(workspaceKey);
      if (!workspace) {
        throw new Error(
          `Workspace ${workspaceId} not found (requestId: ${requestId})`
        );
      }
      
      const currentBalance = (workspace as { creditBalance: number }).creditBalance;
      // Use the already-calculated newBalance instead of recalculating
      const newBalance = workspaceNewBalances.get(workspaceId);
      if (newBalance === undefined) {
        throw new Error(
          `New balance not calculated for workspace ${workspaceId} (requestId: ${requestId})`
        );
      }
      
      recordsToPut.push({
        pk: workspacePk,
        sk,
        requestId,
        workspaceId: transaction.workspaceId,
        agentId: transaction.agentId,
        conversationId: transaction.conversationId,
        source: transaction.source,
        supplier: transaction.supplier,
        model: transaction.model,
        tool_call: transaction.tool_call,
        description: transaction.description,
        amountMillionthUsd: transaction.amountMillionthUsd,
        workspaceCreditsBeforeMillionthUsd: currentBalance,
        workspaceCreditsAfterMillionthUsd: newBalance,
        version: 1,
        createdAt: new Date().toISOString(),
      });
    }

    return recordsToPut;
  };

  // Execute atomic update
  await db.atomicUpdate(recordSpec, callback);
}

