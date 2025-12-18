import { connect } from "@lancedb/lancedb";
import type { SQSEvent, SQSRecord } from "aws-lambda";

import { getWorkspaceApiKey } from "../../http/utils/agentUtils";
import { getDefined } from "../../utils";
import { generateEmbedding } from "../../utils/embedding";
import { handlingSQSErrors } from "../../utils/handlingSQSErrors";
import { getDatabaseUri } from "../../utils/vectordb/paths";
import {
  WriteOperationMessageSchema,
  type WriteOperationMessage,
  type FactRecord,
  type TemporalGrain,
  type RawFactData,
} from "../../utils/vectordb/types";

/**
 * Get LanceDB connection options for S3
 * Returns storageOptions for local dev (s3rver) or staging/production (AWS S3 with explicit credentials)
 */
function getLanceDBConnectionOptions(): {
  storageOptions?: Record<string, string>;
} {
  const arcEnv = process.env.ARC_ENV;

  // Only use local s3rver configuration when explicitly in testing mode
  // Architect sandbox sets ARC_ENV=testing for local development
  const isLocal = arcEnv === "testing";

  const accessKeyId = process.env.HELPMATON_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.HELPMATON_S3_SECRET_ACCESS_KEY;

  // If no credentials are provided, fall back to local configuration
  // This handles test environments and local development
  if (isLocal || !accessKeyId || !secretAccessKey) {
    // Local development with s3rver
    const endpoint =
      process.env.HELPMATON_S3_ENDPOINT || "http://localhost:4568";
    return {
      storageOptions: {
        endpoint,
        allowHttp: "true", // Required for local HTTP endpoints
        s3ForcePathStyle: "true", // Force path-style addressing: http://endpoint/bucket/path
        awsAccessKeyId: "S3RVER",
        awsSecretAccessKey: "S3RVER",
        region: "eu-west-2",
      },
    };
  }

  // Staging/Production - use explicit credentials from environment variables
  const region =
    process.env.HELPMATON_S3_REGION || process.env.AWS_REGION || "eu-west-2";

  const storageOptions: Record<string, string> = {
    awsAccessKeyId: accessKeyId,
    awsSecretAccessKey: secretAccessKey,
    region,
  };

  // Check for custom endpoint (for S3-compatible services)
  const customEndpoint = process.env.HELPMATON_S3_ENDPOINT;
  if (
    customEndpoint &&
    !customEndpoint.includes("localhost") &&
    !customEndpoint.includes("127.0.0.1")
  ) {
    storageOptions.endpoint = customEndpoint;
    storageOptions.allowHttp = customEndpoint.startsWith("http://")
      ? "true"
      : "false";
    console.log(
      `[Write Server] Using custom S3 endpoint: ${customEndpoint}, region: ${region}`
    );
  } else {
    console.log(
      `[Write Server] Using AWS S3 with explicit credentials, region: ${region}`
    );
  }

  return {
    storageOptions,
  };
}

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

      const record: FactRecord = {
        id: rawFact.id,
        content: rawFact.content,
        embedding,
        timestamp: rawFact.timestamp,
        metadata: rawFact.metadata,
      };
      console.log(
        `[Write Server] Created record with metadata:`,
        JSON.stringify(record.metadata, null, 2)
      );
      records.push(record);
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
    const connectionOptions = getLanceDBConnectionOptions();
    console.log(`[Write Server] Connecting to database URI: ${uri}`);
    if (connectionOptions.storageOptions) {
      console.log(
        `[Write Server] Using storageOptions for local dev:`,
        connectionOptions.storageOptions
      );
    }
    const db = await connect(uri, connectionOptions);

    console.log(`[Write Server] Successfully connected to database: ${uri}`);

    // Get or create table
    let table;
    try {
      table = await db.openTable("vectors");
    } catch {
      // Table doesn't exist, create it
      // LanceDB will infer schema from the first batch of records
      const initialRecords = finalRecords.map((r) => {
        // Ensure metadata is a plain object (not null/undefined)
        // Use JSON serialization to ensure it's a plain object (handles Arrow Structs if any)
        let metadata: Record<string, unknown> = {};
        if (
          r.metadata &&
          typeof r.metadata === "object" &&
          !Array.isArray(r.metadata)
        ) {
          try {
            // Use JSON serialization to convert any Arrow Structs to plain objects
            const jsonString = JSON.stringify(r.metadata);
            metadata = JSON.parse(jsonString) as Record<string, unknown>;
          } catch {
            // Fallback to spread if JSON fails
            metadata = { ...r.metadata };
          }
        }
        return {
          id: r.id,
          content: r.content,
          vector: r.embedding,
          timestamp: r.timestamp,
          metadata,
        };
      });
      // Log first record's metadata for debugging
      if (initialRecords.length > 0) {
        console.log(
          `[Write Server] Creating table with sample record metadata:`,
          JSON.stringify(initialRecords[0].metadata, null, 2)
        );
      }
      table = await db.createTable("vectors", initialRecords);
      console.log(`[Write Server] Created new table "vectors" in ${uri}`);
      return;
    }

    // Insert records into existing table
    console.log(
      `[Write Server] Adding ${finalRecords.length} records to existing table for agent ${agentId}, grain ${temporalGrain}`
    );
    const recordsToInsert = finalRecords.map((r) => {
      // Ensure metadata is a plain object (not null/undefined)
      // LanceDB needs a consistent structure for metadata
      // Use JSON serialization to ensure it's a plain object (handles Arrow Structs if any)
      let metadata: Record<string, unknown> = {};
      if (
        r.metadata &&
        typeof r.metadata === "object" &&
        !Array.isArray(r.metadata)
      ) {
        try {
          // Use JSON serialization to convert any Arrow Structs to plain objects
          const jsonString = JSON.stringify(r.metadata);
          metadata = JSON.parse(jsonString) as Record<string, unknown>;
        } catch {
          // Fallback to spread if JSON fails
          metadata = { ...r.metadata };
        }
      }
      return {
        id: r.id,
        content: r.content,
        vector: r.embedding,
        timestamp: r.timestamp,
        metadata,
      };
    });
    // Log first record's metadata for debugging
    if (recordsToInsert.length > 0) {
      console.log(
        `[Write Server] Sample record metadata being inserted:`,
        JSON.stringify(recordsToInsert[0].metadata, null, 2)
      );
    }
    await table.add(recordsToInsert);

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
    const connectionOptions = getLanceDBConnectionOptions();
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
    const connectionOptions = getLanceDBConnectionOptions();
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
  const messageId = record.messageId || "unknown";
  console.log(
    `[Write Server] Processing message ${messageId}, body length: ${
      record.body?.length || 0
    }`
  );

  let parsedBody: unknown;
  try {
    if (!record.body) {
      throw new Error("Message body is missing");
    }
    parsedBody = JSON.parse(record.body);
  } catch (error) {
    console.error(
      `[Write Server] Failed to parse message body for message ${messageId}:`,
      error instanceof Error
        ? {
            message: error.message,
            stack: error.stack,
            name: error.name,
          }
        : String(error),
      `Body: ${record.body?.substring(0, 500) || "no body"}`
    );
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
 * Lambda handler for processing SQS messages with partial batch failure support
 * Returns array of failed message IDs so successful messages can be deleted
 * while failed ones are retried individually
 */
export const handler = handlingSQSErrors(
  async (event: SQSEvent): Promise<string[]> => {
    console.log(
      `[Write Server] Received ${event.Records.length} SQS message(s)`
    );

    const failedMessageIds: string[] = [];

    // Process messages in sequence (FIFO queue ensures order per message group)
    for (const record of event.Records) {
      const messageId = record.messageId || "unknown";
      const receiptHandle = record.receiptHandle || "unknown";
      try {
        await processWriteOperation(record);
        console.log(
          `[Write Server] Successfully processed message ${messageId}`
        );
      } catch (error) {
        // Log detailed error information
        console.error(
          `[Write Server] Failed to process message ${messageId} (receiptHandle: ${receiptHandle}):`,
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
              }
            : String(error)
        );
        console.error(
          `[Write Server] Message body preview: ${
            record.body?.substring(0, 500) || "no body"
          }`
        );

        // Track failed message for retry, but continue processing other messages
        failedMessageIds.push(messageId);
      }
    }

    const successCount = event.Records.length - failedMessageIds.length;
    console.log(
      `[Write Server] Batch processing complete: ${successCount} succeeded, ${failedMessageIds.length} failed`
    );

    return failedMessageIds;
  }
);
