/**
 * Temporal grains for organizing vector databases
 */
export type TemporalGrain = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

/**
 * All temporal grains in order from smallest to largest
 */
export const TEMPORAL_GRAINS: TemporalGrain[] = [
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
export type WriteOperationType = "insert" | "update" | "delete";

/**
 * Write operation message body for SQS
 */
export interface WriteOperationMessage {
  operation: WriteOperationType;
  agentId: string;
  temporalGrain: TemporalGrain;
  data: {
    records?: FactRecord[]; // For insert and update operations
    recordIds?: string[]; // For delete operations
  };
}

