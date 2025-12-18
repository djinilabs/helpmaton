import { sendWriteOperation } from "./queueClient";
import type { FactRecord, TemporalGrain, WriteOperationMessage } from "./types";

/**
 * Insert fact records into the vector database
 * Sends the operation to SQS FIFO queue for processing
 */
export async function insert(
  agentId: string,
  temporalGrain: TemporalGrain,
  records: FactRecord[]
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const message: WriteOperationMessage = {
    operation: "insert",
    agentId,
    temporalGrain,
    data: {
      records,
    },
  };

  await sendWriteOperation(message);
}

/**
 * Update fact records in the vector database
 * Sends the operation to SQS FIFO queue for processing
 */
export async function update(
  agentId: string,
  temporalGrain: TemporalGrain,
  records: FactRecord[]
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const message: WriteOperationMessage = {
    operation: "update",
    agentId,
    temporalGrain,
    data: {
      records,
    },
  };

  await sendWriteOperation(message);
}

/**
 * Delete fact records from the vector database
 * Sends the operation to SQS FIFO queue for processing
 */
export async function remove(
  agentId: string,
  temporalGrain: TemporalGrain,
  recordIds: string[]
): Promise<void> {
  if (recordIds.length === 0) {
    return;
  }

  const message: WriteOperationMessage = {
    operation: "delete",
    agentId,
    temporalGrain,
    data: {
      recordIds,
    },
  };

  await sendWriteOperation(message);
}

// Export as delete for consistency with common naming
export { remove as delete };

