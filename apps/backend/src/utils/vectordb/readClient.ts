import { connect } from "@lancedb/lancedb";

import { DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT } from "./config";
import { getDatabaseUri } from "./paths";
import type { QueryOptions, QueryResult, TemporalGrain } from "./types";

// Connection cache per database path
// Export for testing purposes to allow cache clearing
export const connectionCache = new Map<
  string,
  Promise<Awaited<ReturnType<typeof connect>>>
>();

/**
 * Get or create a LanceDB connection for a specific database
 * Connections are cached per database path
 */
async function getDatabaseConnection(
  agentId: string,
  temporalGrain: TemporalGrain
): Promise<Awaited<ReturnType<typeof connect>>> {
  const uri = getDatabaseUri(agentId, temporalGrain);
  const cacheKey = uri;

  if (!connectionCache.has(cacheKey)) {
    const connectionPromise = (async () => {
      try {
        // Get S3 connection options for LanceDB
        const arcEnv = process.env.ARC_ENV;

        // Only use local s3rver configuration when explicitly in testing mode
        // Architect sandbox sets ARC_ENV=testing for local development
        const isLocal = arcEnv === "testing";

        const accessKeyId = process.env.HELPMATON_S3_ACCESS_KEY_ID;
        const secretAccessKey = process.env.HELPMATON_S3_SECRET_ACCESS_KEY;

        let connectionOptions: { storageOptions?: Record<string, string> } = {};

        // If no credentials are provided, fall back to local configuration
        // This handles test environments and local development
        if (isLocal || !accessKeyId || !secretAccessKey) {
          // Local development with s3rver
          const endpoint =
            process.env.HELPMATON_S3_ENDPOINT || "http://localhost:4568";
          connectionOptions = {
            storageOptions: {
              endpoint,
              allowHttp: "true", // Required for local HTTP endpoints
              s3ForcePathStyle: "true", // Force path-style addressing: http://endpoint/bucket/path
              awsAccessKeyId: "S3RVER",
              awsSecretAccessKey: "S3RVER",
              region: "eu-west-2",
            },
          };
        } else {
          // Staging/Production - use explicit credentials from environment variables
          const region =
            process.env.HELPMATON_S3_REGION ||
            process.env.AWS_REGION ||
            "eu-west-2";

          const storageOptions: Record<string, string> = {
            awsAccessKeyId: accessKeyId,
            awsSecretAccessKey: secretAccessKey,
            region,
            // Explicitly disable session token to prevent Lambda execution role credentials from being used
            // This ensures LanceDB uses only the static credentials provided above
            awsSessionToken: "",
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
              `[Read Client] Using custom S3 endpoint: ${customEndpoint}, region: ${region}`
            );
          } else {
            console.log(
              `[Read Client] Using AWS S3 with explicit credentials, region: ${region}`
            );
          }

          connectionOptions = {
            storageOptions,
          };
        }

        const db = await connect(uri, connectionOptions);

        console.log(`[Read Client] Connected to database: ${uri}`);
        return db;
      } catch (error) {
        console.error(`[Read Client] Failed to connect to ${uri}:`, error);
        connectionCache.delete(cacheKey);
        throw error;
      }
    })();

    connectionCache.set(cacheKey, connectionPromise);
  }

  return connectionCache.get(cacheKey)!;
}

/**
 * LanceDB row structure with metadata fields stored at top level
 * Supports both new flattened structure and legacy nested metadata
 */
interface LanceDBRow {
  id: string;
  content: string;
  vector?: number[];
  embedding?: number[];
  timestamp: string;
  // Metadata fields are stored at top level (new structure)
  conversationId?: string;
  workspaceId?: string;
  agentId?: string;
  documentId?: string;
  documentName?: string;
  folderPath?: string;
  // Legacy: some tables might still have nested metadata
  metadata?: Record<string, unknown>;
  _distance?: number;
}

type QueryBuilder = {
  nearestTo?: (vector: number[]) => unknown;
  where?: (filter: string) => unknown;
  limit?: (limit: number) => unknown;
  toArray?: () => Promise<Array<LanceDBRow>>;
  execute?: () => Promise<AsyncIterable<LanceDBRow>>;
};

/**
 * Apply temporal filter to query results
 */
function applyTemporalFilter(
  results: QueryResult[],
  temporalFilter?: QueryOptions["temporalFilter"]
): QueryResult[] {
  if (!temporalFilter) {
    return results;
  }

  const { startDate, endDate } = temporalFilter;
  if (!startDate && !endDate) {
    return results;
  }

  return results.filter((result) => {
    const timestamp = new Date(result.timestamp);
    if (startDate && timestamp < new Date(startDate)) {
      return false;
    }
    if (endDate && timestamp > new Date(endDate)) {
      return false;
    }
    return true;
  });
}

function clampQueryLimit(limit: number): number {
  return Math.min(Math.max(1, limit), MAX_QUERY_LIMIT);
}

function escapeFilterValue(value: string): string {
  return value.replace(/'/g, "''");
}

async function openVectorsTable(
  db: Awaited<ReturnType<typeof connect>>,
  dbUri: string,
  agentId: string,
  temporalGrain: TemporalGrain
): Promise<{ query: () => QueryBuilder } | null> {
  const table = await db.openTable("vectors").catch(async (error) => {
    console.warn(
      `[Read Client] Table "vectors" not found in database ${dbUri}:`,
      error instanceof Error ? error.message : String(error)
    );
    return null;
  });

  if (!table) {
    console.log(
      `[Read Client] No table found, returning empty results for agent ${agentId}, grain ${temporalGrain}`
    );
    return null;
  }

  console.log(
    `[Read Client] Table opened successfully for agent ${agentId}, grain ${temporalGrain}`
  );

  return table as unknown as { query: () => QueryBuilder };
}

function buildQueryBuilder(
  table: { query: () => QueryBuilder },
  options: {
    vector?: number[];
    filter?: string;
    limit: number;
  }
): QueryBuilder {
  let queryBuilder = table.query();

  if (options.vector && queryBuilder.nearestTo) {
    queryBuilder = queryBuilder.nearestTo(options.vector) as QueryBuilder;
  }

  if (options.filter && queryBuilder.where) {
    queryBuilder = queryBuilder.where(options.filter) as QueryBuilder;
  }

  if (queryBuilder.limit) {
    queryBuilder = queryBuilder.limit(options.limit) as QueryBuilder;
  }

  return queryBuilder;
}

async function collectRowsFromQuery(
  queryBuilder: QueryBuilder
): Promise<LanceDBRow[]> {
  if (queryBuilder.toArray) {
    const rows = await queryBuilder.toArray();
    logSampleRowMetadata(rows);
    console.log(
      `[Read Client] Retrieved ${rows.length} rows, logging all metadata:`
    );
    return rows;
  }

  if (queryBuilder.execute) {
    const iterator = await queryBuilder.execute();
    console.log(`[Read Client] Using execute() method to retrieve rows...`);
    const rows: LanceDBRow[] = [];
    for await (const row of iterator) {
      rows.push(row);
    }
    console.log(
      `[Read Client] Retrieved ${rows.length} rows total via execute()`
    );
    return rows;
  }

  console.log(`[Read Client] Using fallback method to retrieve rows...`);
  const rows = await (queryBuilder as unknown as () => Promise<Array<LanceDBRow>>)();
  console.log(
    `[Read Client] Retrieved ${rows.length} rows via fallback, logging all metadata:`
  );
  return rows;
}

function logSampleRowMetadata(rows: LanceDBRow[]): void {
  if (rows.length === 0) {
    return;
  }
  console.log(
    `[Read Client] Sample row metadata type:`,
    typeof rows[0].metadata,
    Array.isArray(rows[0].metadata)
  );
  if (rows[0].metadata) {
    console.log(
      `[Read Client] Sample row metadata value:`,
      JSON.stringify(rows[0].metadata, null, 2)
    );
  }
}

function buildMetadataFromRow(row: LanceDBRow): Record<string, unknown> {
  return {
    conversationId: row.conversationId || row.metadata?.conversationId || null,
    workspaceId: row.workspaceId || row.metadata?.workspaceId || null,
    agentId: row.agentId || row.metadata?.agentId || null,
    documentId: row.documentId || row.metadata?.documentId || null,
    documentName: row.documentName || row.metadata?.documentName || null,
    folderPath: row.folderPath || row.metadata?.folderPath || null,
  };
}

function logRowMetadata(row: LanceDBRow, index: number, total: number): void {
  console.log(
    `[Read Client] Row ${index + 1}/${total} - ID: ${row.id.substring(0, 20)}...`
  );
  console.log(`  Content: ${row.content.substring(0, 60)}...`);
  console.log(`  Timestamp: ${row.timestamp}`);
  console.log(
    `  Metadata fields from row:`,
    JSON.stringify(
      {
        conversationId: row.conversationId,
        workspaceId: row.workspaceId,
        agentId: row.agentId,
        documentId: row.documentId,
        documentName: row.documentName,
        folderPath: row.folderPath,
      },
      null,
      4
    )
  );

  if (row.metadata) {
    console.log(`  Raw metadata type: ${typeof row.metadata}`);
    console.log(
      `  Raw metadata value:`,
      JSON.stringify(row.metadata, null, 4)
    );
  }
}

function mapRowsToResults(rows: LanceDBRow[]): QueryResult[] {
  const results: QueryResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    logRowMetadata(row, i, rows.length);

    const metadata = buildMetadataFromRow(row);
    console.log(`  Reconstructed metadata:`, JSON.stringify(metadata, null, 4));

    results.push({
      id: row.id,
      content: row.content,
      embedding: (row.vector || row.embedding || []) as number[],
      timestamp: row.timestamp,
      metadata,
      distance: row._distance,
    });
  }

  return results;
}

function logMetadataSummary(options: {
  results: QueryResult[];
  filteredResults: QueryResult[];
  agentId: string;
  temporalGrain: TemporalGrain;
}): void {
  const { results, filteredResults, agentId, temporalGrain } = options;
  const metadataStats = {
    total: results.length,
    withConversationId: results.filter((r) => r.metadata?.conversationId).length,
    withWorkspaceId: results.filter((r) => r.metadata?.workspaceId).length,
    withAgentId: results.filter((r) => r.metadata?.agentId).length,
    withAllMetadata: results.filter(
      (r) =>
        r.metadata?.conversationId &&
        r.metadata?.workspaceId &&
        r.metadata?.agentId
    ).length,
    withNullMetadata: results.filter(
      (r) =>
        !r.metadata?.conversationId ||
        !r.metadata?.workspaceId ||
        !r.metadata?.agentId
    ).length,
  };

  console.log(
    `[Read Client] Query completed for agent ${agentId}, grain ${temporalGrain}: ${results.length} raw results, ${filteredResults.length} after temporal filter`
  );
  console.log(
    `[Read Client] Metadata summary:`,
    JSON.stringify(metadataStats, null, 2)
  );
  console.log(
    `[Read Client] Returning ${filteredResults.length} filtered results`
  );
}

/**
 * Query the vector database
 *
 * @param agentId - Agent ID
 * @param temporalGrain - Temporal grain (daily, weekly, monthly, quarterly, yearly)
 * @param options - Query options (vector, filter, limit, temporalFilter)
 * @returns Query results
 */
export async function query(
  agentId: string,
  temporalGrain: TemporalGrain,
  options: QueryOptions = {}
): Promise<QueryResult[]> {
  const {
    vector,
    filter,
    limit = DEFAULT_QUERY_LIMIT,
    temporalFilter,
  } = options;

  // Validate limit
  const queryLimit = clampQueryLimit(limit);

  try {
    const dbUri = getDatabaseUri(agentId, temporalGrain);
    console.log(
      `[Read Client] Querying database ${dbUri} for agent ${agentId}, grain ${temporalGrain}`
    );
    const db = await getDatabaseConnection(agentId, temporalGrain);

    const table = await openVectorsTable(db, dbUri, agentId, temporalGrain);
    if (!table) {
      return [];
    }

    const queryBuilder = buildQueryBuilder(table, {
      vector,
      filter,
      limit: queryLimit,
    });

    const results: QueryResult[] = [];
    try {
      const rows = await collectRowsFromQuery(queryBuilder);
      results.push(...mapRowsToResults(rows));
    } catch (error) {
      console.error("[Read Client] Query execution error:", error);
      throw error;
    }

    // Apply temporal filter in memory (since LanceDB may not support date filtering directly)
    const filteredResults = applyTemporalFilter(results, temporalFilter);

    // Log metadata summary
    logMetadataSummary({ results, filteredResults, agentId, temporalGrain });

    return filteredResults;
  } catch (error) {
    console.error(
      `[Read Client] Query failed for agent ${agentId}, grain ${temporalGrain}:`,
      error
    );
    throw new Error(
      `Vector database query failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export async function getRecordById(
  agentId: string,
  temporalGrain: TemporalGrain,
  recordId: string
): Promise<QueryResult | null> {
  const safeRecordId = escapeFilterValue(recordId);
  const results = await query(agentId, temporalGrain, {
    filter: `id = '${safeRecordId}'`,
    limit: 1,
  });
  return results[0] ?? null;
}
