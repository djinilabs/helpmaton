import { connect } from "@lancedb/lancedb";
import type { SQSEvent, SQSRecord } from "aws-lambda";

import { getWorkspaceApiKey } from "../../http/utils/agentUtils";
import { getDefined } from "../../utils";
import { generateEmbedding } from "../../utils/embedding";
import { handlingSQSErrors } from "../../utils/handlingSQSErrors";
import { getS3ConnectionOptions } from "../../utils/vectordb/config";
import { getDatabaseUri } from "../../utils/vectordb/paths";
import {
  WriteOperationMessageSchema,
  type WriteOperationMessage,
  type FactRecord,
  type TemporalGrain,
  type RawFactData,
} from "../../utils/vectordb/types";

/**
 * Generate embeddings for raw facts
 */
async function generateEmbeddingsForFacts(
  rawFacts: RawFactData[],
  workspaceId: string
): Promise<FactRecord[]> {
  // Get API key for embedding generation
  // Try workspace API key first, fall back to system key
  const workspaceApiKey = await getWorkspaceApiKey(workspaceId, "google");
  const apiKey =
    workspaceApiKey ||
    getDefined(process.env.GEMINI_API_KEY, "GEMINI_API_KEY is not set");

  const records: FactRecord[] = [];

  for (let i = 0; i < rawFacts.length; i++) {
    const rawFact = rawFacts[i];
    try {
      console.log(
        `[Write Server] Generating embedding ${i + 1}/${
          rawFacts.length
        } for fact: "${rawFact.content.substring(0, 50)}..."`
      );
      const embedding = await generateEmbedding(
        rawFact.content,
        apiKey,
        rawFact.cacheKey,
        undefined // No abort signal
      );

      records.push({
        id: rawFact.id,
        content: rawFact.content,
        embedding,
        timestamp: rawFact.timestamp,
        metadata: rawFact.metadata,
      });
      console.log(
        `[Write Server] Successfully generated embedding ${i + 1}/${
          rawFacts.length
        }`
      );
    } catch (error) {
      console.error(
        `[Write Server] Failed to generate embedding ${i + 1}/${
          rawFacts.length
        } for fact:`,
        error instanceof Error
          ? {
              message: error.message,
              stack: error.stack,
              name: error.name,
            }
          : String(error)
      );
      // Continue with other facts even if one fails
    }
  }

  return records;
}

/**
 * Execute insert operation on LanceDB database
 */
async function executeInsert(
  agentId: string,
  temporalGrain: TemporalGrain,
  records: FactRecord[],
  rawFacts?: RawFactData[],
  workspaceId?: string
): Promise<void> {
  // If rawFacts are provided, generate embeddings first
  let finalRecords = records;
  if (rawFacts && rawFacts.length > 0) {
    if (!workspaceId) {
      throw new Error(
        "workspaceId is required when rawFacts are provided for embedding generation"
      );
    }
    console.log(
      `[Write Server] Generating embeddings for ${rawFacts.length} raw facts...`
    );
    const generatedRecords = await generateEmbeddingsForFacts(
      rawFacts,
      workspaceId
    );
    finalRecords = generatedRecords;
    console.log(
      `[Write Server] Generated ${generatedRecords.length} embeddings out of ${rawFacts.length} raw facts`
    );
  }

  if (finalRecords.length === 0) {
    console.log(
      `[Write Server] No records to insert after embedding generation`
    );
    return;
  }
  const uri = getDatabaseUri(agentId, temporalGrain);
  console.log(
    `[Write Server] Executing insert for agent ${agentId}, grain ${temporalGrain}, ${finalRecords.length} records, URI: ${uri}`
  );
  console.log(
    `[Write Server] Record IDs: ${finalRecords.map((r) => r.id).join(", ")}`
  );

  try {
    // Get S3 connection options (handles local vs production)
    const connectionOptions = getS3ConnectionOptions();
    const db = await connect(uri, connectionOptions);

    console.log(`[Write Server] Connection options:`, {
      region: connectionOptions.region,
      hasStorageOptions: !!connectionOptions.storageOptions,
      hasEndpoint: !!connectionOptions.storageOptions?.endpoint,
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
        finalRecords.map((r) => ({
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
    console.log(
      `[Write Server] Adding ${finalRecords.length} records to existing table for agent ${agentId}, grain ${temporalGrain}`
    );
    await table.add(
      finalRecords.map((r) => ({
        id: r.id,
        content: r.content,
        vector: r.embedding,
        timestamp: r.timestamp,
        metadata: r.metadata || {},
      }))
    );

    console.log(
      `[Write Server] Successfully inserted ${finalRecords.length} records into database for agent ${agentId}, grain ${temporalGrain}`
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
    // Get S3 connection options (handles local vs production)
    const connectionOptions = getS3ConnectionOptions();
    const db = await connect(uri, connectionOptions);

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
    // Get S3 connection options (handles local vs production)
    const connectionOptions = getS3ConnectionOptions();
    const db = await connect(uri, connectionOptions);

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
async function processWriteOperation(record: SQSRecord): Promise<void> {
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(record.body);
  } catch (error) {
    console.error("[Write Server] Failed to parse message body:", error);
    throw new Error("Invalid message format: JSON parse error");
  }

  // Validate message payload using Zod schema
  const validationResult = WriteOperationMessageSchema.safeParse(parsedBody);
  if (!validationResult.success) {
    const errors = validationResult.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return `${path}: ${issue.message}`;
    });
    console.error(
      `[Write Server] Message validation failed:`,
      JSON.stringify(errors, null, 2),
      `Message body: ${record.body.substring(0, 500)}`
    );
    throw new Error(`Invalid write operation message: ${errors.join(", ")}`);
  }

  const message: WriteOperationMessage = validationResult.data;
  const { operation, agentId, temporalGrain, data, workspaceId } = message;

  switch (operation) {
    case "insert":
      // Support both rawFacts (for async embedding generation) and records (pre-generated embeddings)
      if (data.rawFacts && data.rawFacts.length > 0) {
        // Generate embeddings asynchronously
        await executeInsert(
          agentId,
          temporalGrain,
          [], // No pre-generated records
          data.rawFacts,
          workspaceId
        );
      } else if (data.records && data.records.length > 0) {
        // Use pre-generated embeddings
        await executeInsert(agentId, temporalGrain, data.records);
      } else {
        throw new Error("Insert operation requires either records or rawFacts");
      }
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
