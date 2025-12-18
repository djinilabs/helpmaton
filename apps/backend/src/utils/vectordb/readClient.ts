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
 * Convert LanceDB metadata (which may be an Apache Arrow Struct) to a plain object
 * Handles both plain objects and Arrow Struct types
 * Uses JSON serialization/deserialization to convert Arrow Structs properly
 */
function convertMetadataToPlainObject(
  metadata: unknown
): Record<string, unknown> {
  if (!metadata) {
    return {};
  }

  // If it's already a plain object with values, return it
  if (typeof metadata === "object" && !Array.isArray(metadata)) {
    // Try JSON serialization/deserialization to convert Arrow Structs
    // This works because JSON.stringify/parse will convert Arrow Structs to plain objects
    try {
      const jsonString = JSON.stringify(metadata);
      const parsed = JSON.parse(jsonString) as Record<string, unknown>;

      // Filter out null values that might be from unset struct fields
      // But keep them if they're explicitly set (we can't distinguish, so keep all)
      return parsed;
    } catch {
      // If JSON serialization fails, try direct access
      const result: Record<string, unknown> = {};
      const obj = metadata as Record<string, unknown>;
      for (const key in obj) {
        const value = obj[key];
        // Include all values, even null (they might be valid)
        result[key] = value;
      }
      return result;
    }
  }

  return {};
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
          // Metadata fields are stored at top level, not nested
          conversationId?: string;
          workspaceId?: string;
          agentId?: string;
          // Legacy: some tables might still have nested metadata
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
          // Metadata fields are stored at top level, not nested
          conversationId?: string;
          workspaceId?: string;
          agentId?: string;
          // Legacy: some tables might still have nested metadata
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
        // Log first row's metadata for debugging
        if (rows.length > 0) {
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

        // Log all metadata from all rows for debugging
        console.log(
          `[Read Client] Retrieved ${rows.length} rows, logging all metadata:`
        );
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          console.log(
            `[Read Client] Row ${i + 1}/${rows.length} - ID: ${row.id.substring(
              0,
              20
            )}...`
          );
          console.log(`  Content: ${row.content.substring(0, 60)}...`);
          console.log(`  Timestamp: ${row.timestamp}`);

          // Metadata is stored as top-level fields, not nested
          console.log(
            `  Metadata fields from row:`,
            JSON.stringify(
              {
                conversationId: (row as any).conversationId,
                workspaceId: (row as any).workspaceId,
                agentId: (row as any).agentId,
              },
              null,
              4
            )
          );

          // For backward compatibility, also check for legacy nested metadata
          if (row.metadata) {
            console.log(`  Raw metadata type: ${typeof row.metadata}`);
            console.log(
              `  Raw metadata value:`,
              JSON.stringify(row.metadata, null, 4)
            );
          }

          // Reconstruct metadata object from top-level fields
          // Prefer top-level fields, fallback to nested metadata for legacy tables
          const metadata: Record<string, unknown> = {
            conversationId:
              (row as any).conversationId ||
              row.metadata?.conversationId ||
              null,
            workspaceId:
              (row as any).workspaceId || row.metadata?.workspaceId || null,
            agentId: (row as any).agentId || row.metadata?.agentId || null,
          };

          console.log(
            `  Reconstructed metadata:`,
            JSON.stringify(metadata, null, 4)
          );

          results.push({
            id: row.id,
            content: row.content,
            embedding: (row.vector || row.embedding || []) as number[],
            timestamp: row.timestamp,
            metadata,
            distance: row._distance,
          });
        }
      } else if (queryResult.execute) {
        const iterator = await queryResult.execute();
        let rowIndex = 0;
        console.log(`[Read Client] Using execute() method to retrieve rows...`);
        for await (const row of iterator) {
          rowIndex++;
          console.log(
            `[Read Client] Row ${rowIndex} - ID: ${row.id.substring(0, 20)}...`
          );
          console.log(`  Content: ${row.content.substring(0, 60)}...`);
          console.log(`  Timestamp: ${row.timestamp}`);

          // Metadata is stored as top-level fields, not nested
          console.log(
            `  Metadata fields from row:`,
            JSON.stringify(
              {
                conversationId: (row as any).conversationId,
                workspaceId: (row as any).workspaceId,
                agentId: (row as any).agentId,
              },
              null,
              4
            )
          );

          // For backward compatibility, also check for legacy nested metadata
          if (row.metadata) {
            console.log(`  Raw metadata type: ${typeof row.metadata}`);
            console.log(
              `  Raw metadata value:`,
              JSON.stringify(row.metadata, null, 4)
            );
          }

          // Reconstruct metadata object from top-level fields
          // Prefer top-level fields, fallback to nested metadata for legacy tables
          const metadata: Record<string, unknown> = {
            conversationId:
              (row as any).conversationId ||
              row.metadata?.conversationId ||
              null,
            workspaceId:
              (row as any).workspaceId || row.metadata?.workspaceId || null,
            agentId: (row as any).agentId || row.metadata?.agentId || null,
          };

          console.log(
            `  Reconstructed metadata:`,
            JSON.stringify(metadata, null, 4)
          );

          results.push({
            id: row.id,
            content: row.content,
            embedding: (row.vector || row.embedding || []) as number[],
            timestamp: row.timestamp,
            metadata,
            distance: row._distance,
          });
        }
        console.log(
          `[Read Client] Retrieved ${rowIndex} rows total via execute()`
        );
      } else {
        // Fallback: try calling as a function
        console.log(`[Read Client] Using fallback method to retrieve rows...`);
        const rows = await (
          queryBuilder as unknown as () => Promise<
            Array<{
              id: string;
              content: string;
              vector?: number[];
              embedding?: number[];
              timestamp: string;
              // Metadata fields are stored at top level
              conversationId?: string;
              workspaceId?: string;
              agentId?: string;
              // Legacy: some tables might still have nested metadata
              metadata?: Record<string, unknown>;
              _distance?: number;
            }>
          >
        )();

        console.log(
          `[Read Client] Retrieved ${rows.length} rows via fallback, logging all metadata:`
        );
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          console.log(
            `[Read Client] Row ${i + 1}/${rows.length} - ID: ${row.id.substring(
              0,
              20
            )}...`
          );
          console.log(`  Content: ${row.content.substring(0, 60)}...`);
          console.log(`  Timestamp: ${row.timestamp}`);

          // Metadata is stored as top-level fields, not nested
          console.log(
            `  Metadata fields from row:`,
            JSON.stringify(
              {
                conversationId: (row as any).conversationId,
                workspaceId: (row as any).workspaceId,
                agentId: (row as any).agentId,
              },
              null,
              4
            )
          );

          // For backward compatibility, also check for legacy nested metadata
          if (row.metadata) {
            console.log(`  Raw metadata type: ${typeof row.metadata}`);
            console.log(
              `  Raw metadata value:`,
              JSON.stringify(row.metadata, null, 4)
            );
          }

          // Reconstruct metadata object from top-level fields
          // Prefer top-level fields, fallback to nested metadata for legacy tables
          const metadata: Record<string, unknown> = {
            conversationId:
              (row as any).conversationId ||
              row.metadata?.conversationId ||
              null,
            workspaceId:
              (row as any).workspaceId || row.metadata?.workspaceId || null,
            agentId: (row as any).agentId || row.metadata?.agentId || null,
          };

          console.log(
            `  Reconstructed metadata:`,
            JSON.stringify(metadata, null, 4)
          );

          results.push({
            id: row.id,
            content: row.content,
            embedding: (row.vector || row.embedding || []) as number[],
            timestamp: row.timestamp,
            metadata,
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

    // Log metadata summary
    const metadataStats = {
      total: results.length,
      withConversationId: results.filter((r) => r.metadata?.conversationId)
        .length,
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
