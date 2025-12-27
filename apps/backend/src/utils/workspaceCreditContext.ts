import type { Context } from "aws-lambda";

import type { DatabaseSchemaWithAtomicUpdate } from "../tables/schema";

import {
  type WorkspaceCreditTransaction,
  type TransactionBuffer,
  createTransactionBuffer as createTransactionBufferImpl,
  addTransactionToBuffer,
  commitTransactions,
} from "./workspaceCreditTransactions";

// Re-export for use in handlingSQSErrors
export {
  createTransactionBufferImpl as createTransactionBuffer,
  type TransactionBuffer,
};

/**
 * Symbol for storing transaction buffer in context
 * Using Symbol ensures it doesn't conflict with other context properties
 */
const TRANSACTION_BUFFER_SYMBOL = Symbol("workspaceCreditTransactionBuffer");

/**
 * Module-level storage for current SQS record context
 * This allows handlers to access the context even though they don't receive it as a parameter
 * Keyed by messageId to support concurrent processing
 */
const currentSQSContexts = new Map<string, AugmentedContext>();

/**
 * Sets the current SQS record context for a given messageId
 * Used by handlingSQSErrors to make context available to handlers
 */
export function setCurrentSQSContext(messageId: string, context: AugmentedContext): void {
  currentSQSContexts.set(messageId, context);
}

/**
 * Gets the current SQS record context for a given messageId
 * Used by handlers to access context when processing records
 */
export function getCurrentSQSContext(messageId: string): AugmentedContext | undefined {
  return currentSQSContexts.get(messageId);
}

/**
 * Clears the current SQS record context for a given messageId
 * Used by handlingSQSErrors after processing a record
 */
export function clearCurrentSQSContext(messageId: string): void {
  currentSQSContexts.delete(messageId);
}

/**
 * Augmented context with workspace credit transaction capability
 */
export interface AugmentedContext extends Context {
  addWorkspaceCreditTransaction: (transaction: WorkspaceCreditTransaction) => void;
}

/**
 * Gets the transaction buffer from context
 */
export function getTransactionBuffer(context: Context): TransactionBuffer | undefined {
  return (context as unknown as Record<symbol, TransactionBuffer | undefined>)[TRANSACTION_BUFFER_SYMBOL];
}

/**
 * Sets the transaction buffer in context
 */
export function setTransactionBuffer(
  context: Context,
  buffer: TransactionBuffer
): void {
  (context as unknown as Record<symbol, TransactionBuffer>)[TRANSACTION_BUFFER_SYMBOL] = buffer;
}

/**
 * Augments a Lambda context with workspace credit transaction capability
 * 
 * @param context - Lambda context to augment
 * @param db - Database instance (needed for commit, but stored for later use)
 * @returns Augmented context with addWorkspaceCreditTransaction function
 */
export function augmentContextWithCreditTransactions(
  context: Context,
  db: DatabaseSchemaWithAtomicUpdate
): AugmentedContext {
  // Create or get existing buffer
  let buffer = getTransactionBuffer(context);
  if (!buffer) {
    buffer = createTransactionBufferImpl();
    setTransactionBuffer(context, buffer);
  }

  // Create augmented context with addWorkspaceCreditTransaction function
  const augmentedContext = context as AugmentedContext;
  
  augmentedContext.addWorkspaceCreditTransaction = (transaction: WorkspaceCreditTransaction) => {
    const currentBuffer = getTransactionBuffer(context);
    if (!currentBuffer) {
      throw new Error("Transaction buffer not initialized in context");
    }
    addTransactionToBuffer(currentBuffer, transaction);
  };

  // Store db reference in context for commit (using another symbol)
  const DB_SYMBOL = Symbol("workspaceCreditTransactionDb");
  (context as unknown as Record<symbol, DatabaseSchemaWithAtomicUpdate>)[DB_SYMBOL] = db;

  return augmentedContext;
}

/**
 * Commits all transactions in the context's buffer
 * Only commits if no error was thrown (called from finally block)
 * 
 * @param context - Lambda context with transaction buffer
 * @param hadError - Whether an error was thrown during handler execution
 * @throws Error if commit fails
 */
export async function commitContextTransactions(
  context: Context,
  hadError: boolean
): Promise<void> {
  // Only commit if no error occurred
  if (hadError) {
    return;
  }

  const buffer = getTransactionBuffer(context);
  if (!buffer || buffer.size === 0) {
    // No transactions to commit
    return;
  }

  // Get db reference from context
  const DB_SYMBOL = Symbol("workspaceCreditTransactionDb");
  const db = (context as unknown as Record<symbol, DatabaseSchemaWithAtomicUpdate | undefined>)[DB_SYMBOL];
  if (!db) {
    throw new Error("Database instance not found in context");
  }

  const requestId = context.awsRequestId;
  await commitTransactions(db, buffer, requestId);
}

