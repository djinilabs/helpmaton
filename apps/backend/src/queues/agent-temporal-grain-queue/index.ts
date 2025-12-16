import { connect } from "@lancedb/lancedb";
import type { SQSEvent, SQSRecord } from "aws-lambda";

import { handlingSQSErrors } from "../../utils/handlingSQSErrors";
import { DEFAULT_S3_REGION } from "../../utils/vectordb/config";
import { getDatabaseUri } from "../../utils/vectordb/paths";
import type {
  WriteOperationMessage,
  FactRecord,
  TemporalGrain,
} from "../../utils/vectordb/types";

/**
 * Execute insert operation on LanceDB database
 */
async function executeInsert(
  agentId: string,
  temporalGrain: TemporalGrain,
  records: FactRecord[]
): Promise<void> {
  const uri = getDatabaseUri(agentId, temporalGrain);
  console.log(
    `[Write Server] Executing insert for agent ${agentId}, grain ${temporalGrain}, ${records.length} records`
  );

  try {
    const db = await connect(uri, {
      region: DEFAULT_S3_REGION,
    });

    // Get or create table
    let table;
    try {
      table = await db.openTable("vectors");
    } catch {
      // Table doesn't exist, create it
      // LanceDB will infer schema from the first batch of records
      table = await db.createTable(
        "vectors",
        records.map((r) => ({
          id: r.id,
          content: r.content,
          vector: r.embedding,
          timestamp: r.timestamp,
          metadata: r.metadata || {},
        }))
      );
      console.log(`[Write Server] Created new table "vectors" in ${uri}`);
      return;
    }

    // Insert records into existing table
    await table.add(
      records.map((r) => ({
        id: r.id,
        content: r.content,
        vector: r.embedding,
        timestamp: r.timestamp,
        metadata: r.metadata || {},
      }))
    );

    console.log(
      `[Write Server] Successfully inserted ${records.length} records`
    );
  } catch (error) {
    console.error(`[Write Server] Insert failed:`, error);
    throw error;
  }
}

/**
 * Execute update operation on LanceDB database
 */
async function executeUpdate(
  agentId: string,
  temporalGrain: TemporalGrain,
  records: FactRecord[]
): Promise<void> {
  const uri = getDatabaseUri(agentId, temporalGrain);
  console.log(
    `[Write Server] Executing update for agent ${agentId}, grain ${temporalGrain}, ${records.length} records`
  );

  try {
    const db = await connect(uri, {
      region: DEFAULT_S3_REGION,
    });

    const table = await db.openTable("vectors");

    // For updates, we delete the old records and insert new ones
    // This is a simple approach - LanceDB may have better update methods
    const recordIds = records.map((r) => r.id);

    // Delete existing records
    for (const id of recordIds) {
      await table.delete(`id = '${id}'`);
    }

    // Insert updated records
    await table.add(
      records.map((r) => ({
        id: r.id,
        content: r.content,
        vector: r.embedding,
        timestamp: r.timestamp,
        metadata: r.metadata || {},
      }))
    );

    console.log(
      `[Write Server] Successfully updated ${records.length} records`
    );
  } catch (error) {
    console.error(`[Write Server] Update failed:`, error);
    throw error;
  }
}

/**
 * Execute delete operation on LanceDB database
 */
async function executeDelete(
  agentId: string,
  temporalGrain: TemporalGrain,
  recordIds: string[]
): Promise<void> {
  const uri = getDatabaseUri(agentId, temporalGrain);
  console.log(
    `[Write Server] Executing delete for agent ${agentId}, grain ${temporalGrain}, ${recordIds.length} records`
  );

  try {
    const db = await connect(uri, {
      region: DEFAULT_S3_REGION,
    });

    const table = await db.openTable("vectors");

    // Delete records by ID
    for (const id of recordIds) {
      await table.delete(`id = '${id}'`);
    }

    console.log(
      `[Write Server] Successfully deleted ${recordIds.length} records`
    );
  } catch (error) {
    console.error(`[Write Server] Delete failed:`, error);
    throw error;
  }
}

/**
 * Process a single write operation message
 */
async function processWriteOperation(
  record: SQSRecord
): Promise<void> {
  let message: WriteOperationMessage;
  try {
    message = JSON.parse(record.body) as WriteOperationMessage;
  } catch (error) {
    console.error("[Write Server] Failed to parse message body:", error);
    throw new Error("Invalid message format");
  }

  const { operation, agentId, temporalGrain, data } = message;

  switch (operation) {
    case "insert":
      if (!data.records) {
        throw new Error("Insert operation requires records");
      }
      await executeInsert(agentId, temporalGrain, data.records);
      break;

    case "update":
      if (!data.records) {
        throw new Error("Update operation requires records");
      }
      await executeUpdate(agentId, temporalGrain, data.records);
      break;

    case "delete":
      if (!data.recordIds) {
        throw new Error("Delete operation requires recordIds");
      }
      await executeDelete(agentId, temporalGrain, data.recordIds);
      break;

    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

/**
 * Lambda handler for processing SQS messages
 */
export const handler = handlingSQSErrors(
  async (event: SQSEvent): Promise<void> => {
    console.log(
      `[Write Server] Received ${event.Records.length} SQS message(s)`
    );

    // Process messages in sequence (FIFO queue ensures order per message group)
    for (const record of event.Records) {
      try {
        await processWriteOperation(record);
      } catch (error) {
        console.error(
          `[Write Server] Failed to process message ${record.messageId}:`,
          error
        );
        // Re-throw to trigger SQS retry/dead-letter queue
        throw error;
      }
    }

    console.log("[Write Server] Successfully processed all messages");
  }
);

