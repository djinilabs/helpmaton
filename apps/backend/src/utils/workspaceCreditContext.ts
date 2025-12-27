import type { Context } from "aws-lambda";

import { database } from "../tables";
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
 * Symbol for storing database instance in context
 * Using Symbol ensures it doesn't conflict with other context properties
 */
const DB_SYMBOL = Symbol("workspaceCreditTransactionDb");

/**
 * Module-level storage for current SQS record context
 * This allows handlers to access the context even though they don't receive it as a parameter
 * Keyed by messageId to support concurrent processing
 *
 * Note: In Lambda, this Map is cleared after each invocation since the process is recycled.
 * However, contexts are explicitly cleared in the finally block to prevent memory leaks
 * in case of unexpected process behavior or long-running handlers.
 */
const currentSQSContexts = new Map<string, AugmentedContext>();

/**
 * Module-level storage for current HTTP request context
 * This allows Express handlers to access the context even though they don't receive it as a parameter
 * Keyed by request ID (from headers) to support concurrent processing
 *
 * Note: In Lambda, this Map is cleared after each invocation since the process is recycled.
 * However, contexts are explicitly cleared in the finally block to prevent memory leaks
 * in case of unexpected process behavior or long-running handlers.
 */
const currentHTTPContexts = new Map<string, AugmentedContext>();

/**
 * Sets the current SQS record context for a given messageId
 * Used by handlingSQSErrors to make context available to handlers
 */
export function setCurrentSQSContext(
  messageId: string,
  context: AugmentedContext
): void {
  currentSQSContexts.set(messageId, context);
}

/**
 * Gets the current SQS record context for a given messageId
 * Used by handlers to access context when processing records
 */
export function getCurrentSQSContext(
  messageId: string
): AugmentedContext | undefined {
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
 * Sets the current HTTP request context for a given requestId
 * Used by handlingHttpAsyncErrors to make context available to Express handlers
 */
export function setCurrentHTTPContext(
  requestId: string,
  context: AugmentedContext
): void {
  currentHTTPContexts.set(requestId, context);
}

/**
 * Gets the current HTTP request context for a given requestId
 * Used by Express handlers to access context when processing requests
 */
export function getCurrentHTTPContext(
  requestId: string
): AugmentedContext | undefined {
  return currentHTTPContexts.get(requestId);
}

/**
 * Clears the current HTTP request context for a given requestId
 * Used by handlingHttpAsyncErrors after processing a request
 */
export function clearCurrentHTTPContext(requestId: string): void {
  currentHTTPContexts.delete(requestId);
}

/**
 * Gets the current HTTP request context from an Express request
 * Extracts request ID from headers and looks up the context
 *
 * @param requestId - Request ID from headers (x-amzn-requestid, x-request-id, etc.)
 * @returns Augmented context or undefined if not found
 */
export function getContextFromRequestId(
  requestId: string | undefined
): AugmentedContext | undefined {
  if (!requestId) {
    return undefined;
  }
  return getCurrentHTTPContext(requestId);
}

/**
 * Augmented context with workspace credit transaction capability
 */
export interface AugmentedContext extends Context {
  addWorkspaceCreditTransaction: (
    transaction: WorkspaceCreditTransaction
  ) => void;
}

/**
 * Gets the transaction buffer from context
 */
export function getTransactionBuffer(
  context: Context
): TransactionBuffer | undefined {
  return (context as unknown as Record<symbol, TransactionBuffer | undefined>)[
    TRANSACTION_BUFFER_SYMBOL
  ];
}

/**
 * Sets the transaction buffer in context
 */
export function setTransactionBuffer(
  context: Context,
  buffer: TransactionBuffer
): void {
  (context as unknown as Record<symbol, TransactionBuffer>)[
    TRANSACTION_BUFFER_SYMBOL
  ] = buffer;
}

/**
 * Augments a Lambda context with workspace credit transaction capability
 *
 * @param context - Lambda context to augment
 * @param db - Database instance (optional, will be lazy-loaded if not provided)
 * @returns Augmented context with addWorkspaceCreditTransaction function
 */
export function augmentContextWithCreditTransactions(
  context: Context,
  db?: DatabaseSchemaWithAtomicUpdate
): AugmentedContext {
  // Create or get existing buffer
  let buffer = getTransactionBuffer(context);
  if (!buffer) {
    buffer = createTransactionBufferImpl();
    setTransactionBuffer(context, buffer);
  }

  // Create augmented context with addWorkspaceCreditTransaction function
  const augmentedContext = context as AugmentedContext;

  augmentedContext.addWorkspaceCreditTransaction = (
    transaction: WorkspaceCreditTransaction
  ) => {
    const currentBuffer = getTransactionBuffer(context);
    if (!currentBuffer) {
      console.error(
        "[addWorkspaceCreditTransaction] Transaction buffer not initialized:",
        {
          transaction,
          hasContext: !!context,
          contextAwsRequestId: context.awsRequestId,
        }
      );
      throw new Error("Transaction buffer not initialized in context");
    }
    console.log("[addWorkspaceCreditTransaction] Adding transaction:", {
      transaction,
      bufferSize: currentBuffer.size,
      contextAwsRequestId: context.awsRequestId,
    });
    addTransactionToBuffer(currentBuffer, transaction);
  };

  // Store db reference in context for commit if provided (using another symbol)
  // If not provided, it will be lazy-loaded when transactions are committed
  if (db) {
    (context as unknown as Record<symbol, DatabaseSchemaWithAtomicUpdate>)[
      DB_SYMBOL
    ] = db;
  }

  return augmentedContext;
}

/**
 * Commits all transactions in the context's buffer
 * Only commits if no error was thrown (called from finally block)
 * Database is lazy-loaded if not already stored in context
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
    console.log("[commitContextTransactions] Skipping commit due to error:", {
      hadError,
      contextAwsRequestId: context.awsRequestId,
    });
    return;
  }

  const buffer = getTransactionBuffer(context);
  if (!buffer || buffer.size === 0) {
    // No transactions to commit
    console.log("[commitContextTransactions] No transactions to commit:", {
      hasBuffer: !!buffer,
      bufferSize: buffer?.size || 0,
      contextAwsRequestId: context.awsRequestId,
    });
    return;
  }

  console.log("[commitContextTransactions] Committing transactions:", {
    bufferSize: buffer.size,
    workspaces: Array.from(buffer.keys()),
    totalTransactions: Array.from(buffer.values()).reduce(
      (sum, txs) => sum + txs.length,
      0
    ),
    contextAwsRequestId: context.awsRequestId,
  });

  // Get db reference from context, or lazy-load if not present
  let db = (
    context as unknown as Record<
      symbol,
      DatabaseSchemaWithAtomicUpdate | undefined
    >
  )[DB_SYMBOL];

  if (!db) {
    // Lazy-load database only when transactions need to be committed
    // This avoids initializing database for handlers that don't use workspace credits
    // (e.g., auth lambda which needs tables() with specific options)
    db = await database();
    // Store it for potential future use in the same request
    (context as unknown as Record<symbol, DatabaseSchemaWithAtomicUpdate>)[
      DB_SYMBOL
    ] = db;
  }

  const requestId = context.awsRequestId;
  await commitTransactions(db, buffer, requestId);
}
