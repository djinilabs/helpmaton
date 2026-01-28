import { z } from "zod";

/**
 * Temporal grains for organizing vector databases
 */
export type TemporalGrain =
  | "working"
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly"
  | "docs";

/**
 * All temporal grains in order from smallest to largest
 */
export const TEMPORAL_GRAINS: TemporalGrain[] = [
  "working",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
];

/**
 * Base fact record structure for vector database
 */
export interface FactRecord {
  id: string;
  content: string;
  embedding: number[];
  timestamp: string; // ISO 8601 date string
  metadata?: Record<string, unknown>;
}

/**
 * Temporal filter for date range queries
 */
export interface TemporalFilter {
  startDate?: string; // ISO 8601 date string
  endDate?: string; // ISO 8601 date string
}

/**
 * Query options for vector database queries
 */
export interface QueryOptions {
  vector?: number[]; // Query vector for similarity search
  filter?: string; // SQL-like filter expression for metadata
  limit?: number; // Maximum number of results
  temporalFilter?: TemporalFilter; // Date range filter
}

/**
 * Query result from vector database
 */
export interface QueryResult {
  id: string;
  content: string;
  embedding: number[];
  timestamp: string;
  metadata?: Record<string, unknown>;
  distance?: number; // Similarity distance (if vector search was used)
}

/**
 * Write operation types
 */
export type WriteOperationType = "insert" | "update" | "delete" | "purge";

/**
 * Raw fact data (without embedding) for async embedding generation
 */
export interface RawFactData {
  id: string;
  content: string;
  timestamp: string; // ISO 8601 date string
  metadata?: Record<string, unknown>;
  cacheKey?: string; // Optional cache key for embedding generation
}

/**
 * Write operation message body for SQS
 */
export interface WriteOperationMessage {
  operation: WriteOperationType;
  agentId: string;
  temporalGrain: TemporalGrain;
  workspaceId?: string; // Required for insert operations to get API key
  data: {
    records?: FactRecord[]; // For insert and update operations (with embeddings)
    rawFacts?: RawFactData[]; // For insert operations (without embeddings, will be generated async)
    recordIds?: string[]; // For delete operations
  };
}

/**
 * Zod schema for validating WriteOperationMessage
 */
export const WriteOperationMessageSchema = z
  .object({
    operation: z.enum(["insert", "update", "delete", "purge"]),
    agentId: z.string().min(1, "agentId is required"),
    temporalGrain: z.enum([
      "working",
      "daily",
      "weekly",
      "monthly",
      "quarterly",
      "yearly",
      "docs",
    ]),
    workspaceId: z.string().optional(),
    data: z.object({
      records: z
        .array(
          z.object({
            id: z.string().min(1),
            content: z.string().min(1),
            embedding: z.array(z.number()),
            timestamp: z.string(),
            metadata: z.record(z.string(), z.unknown()).optional(),
          }),
        )
        .optional(),
      rawFacts: z
        .array(
          z.object({
            id: z.string().min(1),
            content: z.string().min(1),
            timestamp: z.string(),
            metadata: z.record(z.string(), z.unknown()).optional(),
            cacheKey: z.string().optional(),
          }),
        )
        .optional(),
      recordIds: z.array(z.string().min(1)).optional(),
    }),
  })
  .refine(
    (message) => {
      if (message.operation === "insert" || message.operation === "update") {
        // Must have either records or rawFacts
        const hasRecords =
          message.data.records && message.data.records.length > 0;
        const hasRawFacts =
          message.data.rawFacts && message.data.rawFacts.length > 0;
        if (!hasRecords && !hasRawFacts) {
          return false;
        }
        // If using rawFacts, workspaceId is required
        if (hasRawFacts && !message.workspaceId) {
          return false;
        }
      } else if (message.operation === "delete") {
        // Must have recordIds
        if (!message.data.recordIds || message.data.recordIds.length === 0) {
          return false;
        }
      } else if (message.operation === "purge") {
        // No additional data required
      }
      return true;
    },
    {
      message:
        "Invalid operation data: insert/update requires records or rawFacts (rawFacts requires workspaceId), delete requires recordIds",
    },
  );

/**
 * Type guard to check if a value matches WriteOperationMessage schema
 */
export function isValidWriteOperationMessage(
  value: unknown,
): value is WriteOperationMessage {
  return WriteOperationMessageSchema.safeParse(value).success;
}
