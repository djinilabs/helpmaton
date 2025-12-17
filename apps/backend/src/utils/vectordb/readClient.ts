import { connect } from "@lancedb/lancedb";

import {
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  getS3ConnectionOptions,
} from "./config";
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
        // LanceDB connection with S3 storage
        // Get S3 connection options (handles local vs production)
        const connectionOptions = getS3ConnectionOptions();
        const db = await connect(uri, connectionOptions);

        console.log(`[Read Client] Connected to database: ${uri}, options:`, {
          region: connectionOptions.region,
          hasStorageOptions: !!connectionOptions.storageOptions,
          hasEndpoint: !!connectionOptions.storageOptions?.endpoint,
        });
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
  const queryLimit = Math.min(Math.max(1, limit), MAX_QUERY_LIMIT);

  try {
    const dbUri = getDatabaseUri(agentId, temporalGrain);
    console.log(
      `[Read Client] Querying database ${dbUri} for agent ${agentId}, grain ${temporalGrain}`
    );
    const db = await getDatabaseConnection(agentId, temporalGrain);

    // Get the table (LanceDB uses a default table name or we can specify)
    // For now, we'll use the default table name "vectors"
    const table = await db.openTable("vectors").catch(async (error) => {
      // If table doesn't exist, return empty results
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
      return [];
    }

    console.log(
      `[Read Client] Table opened successfully for agent ${agentId}, grain ${temporalGrain}`
    );

    // Build query
    let queryBuilder: {
      nearestTo?: (vector: number[]) => unknown;
      where?: (filter: string) => unknown;
      limit?: (limit: number) => unknown;
      toArray?: () => Promise<
        Array<{
          id: string;
          content: string;
          vector?: number[];
          embedding?: number[];
          timestamp: string;
          metadata?: Record<string, unknown>;
          _distance?: number;
        }>
      >;
      execute?: () => Promise<
        AsyncIterable<{
          id: string;
          content: string;
          vector?: number[];
          embedding?: number[];
          timestamp: string;
          metadata?: Record<string, unknown>;
          _distance?: number;
        }>
      >;
    } = table.query() as unknown as typeof queryBuilder;

    // Apply vector similarity search if provided
    if (vector && queryBuilder.nearestTo) {
      queryBuilder = queryBuilder.nearestTo(vector) as typeof queryBuilder;
    }

    // Apply metadata filter if provided
    if (filter && queryBuilder.where) {
      queryBuilder = queryBuilder.where(filter) as typeof queryBuilder;
    }

    // Apply limit
    if (queryBuilder.limit) {
      queryBuilder = queryBuilder.limit(queryLimit) as typeof queryBuilder;
    }

    // Execute query - LanceDB query() returns a Query object that needs to be executed
    // The actual execution method may vary, so we'll use toArray() if available
    const results: QueryResult[] = [];
    try {
      // Try toArray() method which converts the query to an array
      const queryResult = queryBuilder as unknown as {
        toArray?: () => Promise<
          Array<{
            id: string;
            content: string;
            vector?: number[];
            embedding?: number[];
            timestamp: string;
            metadata?: Record<string, unknown>;
            _distance?: number;
          }>
        >;
        execute?: () => Promise<
          AsyncIterable<{
            id: string;
            content: string;
            vector?: number[];
            embedding?: number[];
            timestamp: string;
            metadata?: Record<string, unknown>;
            _distance?: number;
          }>
        >;
      };

      if (queryResult.toArray) {
        const rows = await queryResult.toArray();
        for (const row of rows) {
          results.push({
            id: row.id,
            content: row.content,
            embedding: (row.vector || row.embedding || []) as number[],
            timestamp: row.timestamp,
            metadata: row.metadata || {},
            distance: row._distance,
          });
        }
      } else if (queryResult.execute) {
        const iterator = await queryResult.execute();
        for await (const row of iterator) {
          results.push({
            id: row.id,
            content: row.content,
            embedding: (row.vector || row.embedding || []) as number[],
            timestamp: row.timestamp,
            metadata: row.metadata || {},
            distance: row._distance,
          });
        }
      } else {
        // Fallback: try calling as a function
        const rows = await (
          queryBuilder as unknown as () => Promise<
            Array<{
              id: string;
              content: string;
              vector?: number[];
              embedding?: number[];
              timestamp: string;
              metadata?: Record<string, unknown>;
              _distance?: number;
            }>
          >
        )();
        for (const row of rows) {
          results.push({
            id: row.id,
            content: row.content,
            embedding: (row.vector || row.embedding || []) as number[],
            timestamp: row.timestamp,
            metadata: row.metadata || {},
            distance: row._distance,
          });
        }
      }
    } catch (error) {
      console.error("[Read Client] Query execution error:", error);
      throw error;
    }

    // Apply temporal filter in memory (since LanceDB may not support date filtering directly)
    const filteredResults = applyTemporalFilter(results, temporalFilter);

    console.log(
      `[Read Client] Query completed for agent ${agentId}, grain ${temporalGrain}: ${results.length} raw results, ${filteredResults.length} after temporal filter`
    );

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
