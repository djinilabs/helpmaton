import { ArcTable } from "@architect/functions/types/tables";
import { AwsLiteDynamoDB } from "@aws-lite/dynamodb-types";
import { badRequest, conflict, resourceGone } from "@hapi/boom";
import omit from "lodash.omit";
import { z } from "zod";

import { getDefined } from "../utils";

import { logger } from "./logger";
import {
  TableAPI,
  TableName,
  TableSchemas,
  TableBaseSchemaType,
  Query,
} from "./schema";

/**
 * Removes undefined values from an object to ensure clean data for DynamoDB storage
 * DynamoDB doesn't accept undefined values, so we filter them out
 */
const clean = (item: Record<string, unknown>): Record<string, unknown> => {
  return Object.fromEntries(
    Object.entries(item).filter(([, value]) => value !== undefined)
  );
};

/**
 * Creates a parser function that validates and cleans items using Zod schemas
 * @param schema - The Zod schema to validate against
 * @param tableName - Name of the table for error reporting
 * @returns A function that parses and validates items for the specified operation
 */
const parsingItem =
  (schema: z.ZodSchema, tableName: string) =>
  (item: unknown, operation: string): Record<string, unknown> => {
    try {
      const parsed = schema.parse(item);
      return clean(parsed as Record<string, unknown>);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const error = new Error(
        `Error parsing item when ${operation} in ${tableName}: ${errorMessage}`
      );
      if (err instanceof Error && err.stack) {
        error.stack = err.stack;
      }
      throw error;
    }
  };

/**
 * Represents an item that may have version-specific data
 */
interface VersionedItem<T> {
  item: T | undefined;
  isUnpublished: boolean;
}

/**
 * Retrieves a specific version of an item from the userVersions metadata
 * This enables draft/unpublished content management where users can work on changes
 * without affecting the main published version
 *
 * @param item - The base item containing version metadata
 * @param version - The specific version to retrieve (optional)
 * @returns The versioned item and whether it's unpublished
 */
const getVersion = <
  T extends Omit<TableBaseSchemaType, "version"> & { version?: number }
>(
  item: T | undefined,
  version?: string | null
): VersionedItem<T> => {
  if (!version || !item) {
    return { item, isUnpublished: false };
  }
  const userVersionMeta = item.userVersions?.[version];
  if (!userVersionMeta) {
    if (item.noMainVersion) {
      console.info("getVersion: no main version", { version, item });
      return { item: undefined, isUnpublished: true };
    }
    return { item, isUnpublished: false };
  }
  if (userVersionMeta.deleted) {
    return { item: undefined, isUnpublished: true };
  }
  const userVersionProps = userVersionMeta.newProps;
  return {
    item: {
      ...keySubset(item),
      ...userVersionProps,
      userVersion: version,
    } as T,
    isUnpublished: true,
  };
};

/**
 * Sets version-specific data for an item, creating or updating userVersions metadata
 * This allows storing draft changes without modifying the main item
 *
 * @param _base - The base item (can be undefined for new items)
 * @param newVersion - The new version data to store
 * @param version - The version identifier
 * @returns The item with updated version metadata
 */
const setVersion = <T extends TableBaseSchemaType>(
  _base: T | undefined,
  newVersion: Partial<T>,
  version: string
): T => {
  const cleanNewVersion = clean(
    omit(newVersion, ["userVersions", "noMainVersion", "version"])
  );
  const base = _base ?? {
    pk: newVersion.pk,
    sk: newVersion.sk,
    noMainVersion: true,
  };
  return {
    ...base,
    userVersions: {
      ..._base?.userVersions,
      [version]: {
        newProps: cleanNewVersion,
      },
    },
  } as T;
};

/**
 * Extracts the key subset (pk and optionally sk) from an item
 * Used for DynamoDB operations that only need the primary key
 *
 * @param item - The item to extract keys from
 * @returns Object containing pk and optionally sk
 */
const keySubset = <T extends TableBaseSchemaType>(
  item: Partial<T>
): { pk: string; sk: string } | { pk: string; sk?: undefined } => {
  if (!item.pk) {
    throw new Error("pk is required");
  }
  if (item.sk) {
    return { pk: item.pk, sk: item.sk };
  }
  return { pk: item.pk };
};

/**
 * Creates a high-level table API that wraps DynamoDB operations with:
 * - Schema validation using Zod
 * - Version management for draft/unpublished content
 * - Error handling and logging
 * - Type safety with TypeScript
 *
 * @param tableName - The logical name of the table
 * @param lowLevelTable - The ArcTable instance for basic operations
 * @param lowLevelClient - The AWS DynamoDB client for advanced operations
 * @param lowLevelTableName - The actual DynamoDB table name
 * @param schema - The Zod schema for validating table records
 * @returns A complete table API with CRUD operations and versioning support
 */
export const tableApi = <
  TTableName extends TableName,
  TTableSchema extends TableSchemas[TTableName] = TableSchemas[TTableName],
  TTableRecord extends z.infer<TTableSchema> = z.infer<TTableSchema>
>(
  tableName: TTableName,
  lowLevelTable: ArcTable<{ pk: string; sk?: string }>,
  lowLevelClient: AwsLiteDynamoDB,
  lowLevelTableName: string,
  schema: TTableSchema
): TableAPI<TTableName> => {
  const console = logger(tableName);
  const parseItem = parsingItem(schema, tableName);

  const self = {
    /**
     * Deletes an item from the table
     * If a version is provided, marks the version as deleted instead of removing the item
     *
     * @param pk - Primary key
     * @param sk - Sort key (optional)
     * @param version - Version to delete (optional, enables soft delete)
     * @returns The deleted item
     */
    delete: async (pk: string, sk?: string, version?: string) => {
      // console.info("delete", { pk, sk, version });
      if (version) {
        // Soft delete: mark the version as deleted instead of removing the item
        const key = keySubset({ pk, sk });
        const item = await self.get(key.pk, key.sk);
        if (!item) {
          throw resourceGone(
            `Error deleting record in table ${tableName}: Item not found`
          );
        }
        const newVersion = {
          ...item,
          userVersions: {
            ...item.userVersions,
            [version]: { deleted: true },
          },
        };
        return self.update(
          newVersion as unknown as Partial<TTableRecord> & { pk: string }
        );
      }
      try {
        const item = await self.get(pk, sk);
        if (!item) {
          console.warn("item not found", pk, sk);
          throw resourceGone(
            `Error deleting record in table ${tableName}: Item not found`
          );
        }
        await lowLevelTable.delete(sk ? { pk, sk } : { pk });
        return item;
      } catch (err) {
        console.error("Error deleting item", tableName, pk, sk, err);
        throw err;
      }
    },

    /**
     * Deletes all items with the same primary key
     * Useful for removing all related records (e.g., all teams in a company)
     *
     * @param pk - Primary key to match
     * @param version - Version to delete (optional)
     */
    deleteAll: async (pk: string, version?: string) => {
      // console.info("deleteAll", { pk, version });
      try {
        console.debug("deleteAll:Going to get all items", tableName, { pk });
        const items = (
          await lowLevelTable.query({
            KeyConditionExpression: "pk = :pk",
            ExpressionAttributeValues: { ":pk": pk },
          })
        ).Items;

        await Promise.all(
          items.map((item) => self.delete(item.pk, item.sk, version))
        );
      } catch (err) {
        console.error("Error deleting all items", tableName, pk, err);
        throw err;
      }
    },

    /**
     * Deletes an item if it exists, returns undefined if not found
     * Non-throwing version of delete operation
     *
     * @param pk - Primary key
     * @param sk - Sort key (optional)
     * @param version - Version to delete (optional)
     * @returns The deleted item or undefined if not found
     */
    deleteIfExists: async (pk: string, sk?: string, version?: string) => {
      // console.info("deleteIfExists", { pk, sk, version });
      try {
        const item = await self.get(pk, sk, version);
        if (!item) {
          return undefined;
        }
        return await self.delete(pk, sk, version);
      } catch (err) {
        console.error("Error deleting item", tableName, pk, sk, err);
        throw err;
      }
    },

    /**
     * Retrieves a single item from the table
     * Supports version-specific retrieval for draft/unpublished content
     *
     * @param pk - Primary key
     * @param sk - Sort key (optional)
     * @param version - Version to retrieve (optional)
     * @returns The item or undefined if not found
     */
    get: async (pk: string, sk?: string, version?: string | null) => {
      // console.info("get", { pk, sk, version });
      let keyArgs: { pk: string; sk?: string } | undefined;
      try {
        keyArgs = keySubset({ pk, sk });
        const item = schema.optional().parse(await lowLevelTable.get(keyArgs));
        return getVersion(item, version).item as
          | z.output<typeof schema>
          | undefined;
      } catch (err) {
        console.error(
          "Error getting item",
          {
            operation: "GetItem",
            tableName,
            table: lowLevelTableName,
            key: keyArgs ?? { pk, sk },
            version,
          },
          err
        );
        throw err;
      }
    },

    /**
     * Retrieves multiple items by their primary keys in a single batch operation
     * More efficient than multiple individual get operations
     *
     * @param keys - Array of primary keys to retrieve
     * @param version - Version to retrieve (optional)
     * @returns Array of items found
     */
    batchGet: async (keys: string[], version?: string) => {
      // console.info("batchGet", { keys, version });
      if (keys.length === 0) {
        return [];
      }
      try {
        const items = getDefined(
          (
            await lowLevelClient.BatchGetItem({
              RequestItems: {
                [lowLevelTableName]: { Keys: keys.map((key) => ({ pk: key })) },
              },
            })
          ).Responses
        )[lowLevelTableName];
        return items
          .map(
            (item) =>
              getVersion(parseItem(item, "batchGet") as TTableRecord, version)
                .item
          )
          .filter(Boolean) as TTableRecord[];
      } catch (err) {
        console.error("Error batch getting items", tableName, keys, err);
        throw err;
      }
    },

    /**
     * Updates an existing item in the table
     * Uses optimistic locking with version numbers to prevent conflicts
     * Supports version-specific updates for draft content
     *
     * @param item - The item data to update (must include pk)
     * @param version - Version to update (optional)
     * @returns The updated item
     */
    update: async (
      item: { pk: TTableRecord["pk"] } & Partial<TTableRecord>,
      version?: string
    ): Promise<TTableRecord> => {
      // console.info("update", JSON.stringify({ item, version }, null, 2));
      try {
        const previousItem = (await self.get(item.pk, item.sk)) as
          | TTableRecord
          | undefined;
        if (!previousItem) {
          throw resourceGone(
            `Error updating table ${tableName}: Item with pk ${item.pk} not found`
          );
        }

        if (version) {
          // Update version-specific data instead of main item
          const newItem = setVersion(previousItem, item, version);
          return getVersion(await self.update(newItem), version)
            .item as TTableRecord;
        }

        // Update main item with optimistic locking
        // Merge previousItem first to include all existing fields, then apply updates
        const newItem = clean(
          parseItem(
            {
              ...previousItem,
              ...item,
              version: previousItem.version + 1,
              updatedAt: new Date().toISOString(),
              pk: previousItem.pk,
              sk: previousItem.sk,
            },
            "update"
          )
        ) as TTableRecord;

        // Use conditional update to ensure we're updating the expected version
        await lowLevelClient.PutItem({
          Item: newItem,
          TableName: lowLevelTableName,
          ConditionExpression: "#version = :version",
          ExpressionAttributeValues: {
            ":version": previousItem.version,
          },
          ExpressionAttributeNames: { "#version": "version" },
        });
        return newItem as unknown as TTableRecord;
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.message.toLowerCase().includes("conditional request failed")
        ) {
          throw conflict("Item was outdated");
        }
        throw err;
      }
    },

    /**
     * Creates a new item in the table
     * Uses conditional put to ensure the item doesn't already exist
     * Supports version-specific creation for draft content
     *
     * @param item - The item data to create (without version/createdAt fields)
     * @param version - Version to create (optional)
     * @returns The created item
     */
    create: async (
      item: Omit<TTableRecord, "version" | "createdAt">,
      version?: string
    ): Promise<TTableRecord> => {
      // console.info("create", JSON.stringify({ item, version }, null, 2));
      try {
        if (version) {
          // Create version-specific item
          // first, we need to verify if the record already exists
          const existingItem = await self.get(item.pk, item.sk);
          if (!existingItem) {
            // Create new item with version metadata
            const newItem = clean(
              parseItem(
                {
                  ...item,
                  pk: item.pk,
                  sk: item.sk,
                  noMainVersion: true,
                  version: 1,
                  createdAt: new Date().toISOString(),
                  userVersions: {
                    [version]: {
                      newProps: clean(item),
                    },
                  },
                },
                "create"
              ) as TTableRecord
            );
            return getVersion(
              await self.create(newItem as TTableRecord),
              version
            ).item as TTableRecord;
          }
          // if the record exists, we need to update it
          const newItem = clean({
            ...existingItem,
            userVersions: {
              ...existingItem.userVersions,
              [version]: {
                newProps: clean(item),
              },
            },
          });
          return getVersion(await self.update(newItem as TTableRecord), version)
            .item as TTableRecord;
        }

        // Create main item
        const parsedItem = clean(
          parseItem(
            {
              version: 1,
              createdAt: new Date().toISOString(),
              ...item,
            },
            "create"
          )
        ) as TTableRecord;

        // Use conditional put to ensure item doesn't already exist
        await lowLevelClient.PutItem({
          Item: parsedItem,
          TableName: lowLevelTableName,
          ConditionExpression: "attribute_not_exists(pk)",
        });
        return parsedItem as unknown as TTableRecord;
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.message.toLowerCase().includes("conditional request failed")
        ) {
          throw conflict("Item already exists");
        }
        throw err;
      }
    },

    /**
     * Creates an item if it doesn't exist, or updates it if it does
     * Combines create and update logic in a single operation
     *
     * @param item - The item data to upsert
     * @param version - Version to upsert (optional)
     * @returns The upserted item
     */
    upsert: async (
      item: Omit<TTableRecord, "version">,
      version?: string
    ): Promise<TTableRecord> => {
      // console.info("upsert", JSON.stringify({ item, version }, null, 2));
      try {
        const existingItem = await self.get(item.pk, item.sk);

        if (version) {
          // Upsert version-specific data
          const newItem = setVersion(
            existingItem,
            item as Partial<TTableRecord>,
            version
          );
          return getVersion(
            await self.upsert(
              newItem as unknown as Omit<TTableRecord, "version">
            ),
            version
          ).item as TTableRecord;
        }

        if (existingItem) {
          // Update existing item, preserving creation metadata
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { createdAt, createdBy, ...rest } = item;
          return self.update(
            parseItem(
              {
                ...existingItem,
                ...rest,
              },
              "upsert"
            ) as unknown as Partial<TTableRecord> & { pk: string }
          );
        }

        // Create new item, removing update metadata
        const rest = omit(item, ["updatedAt", "updatedBy"]) as Omit<
          TTableRecord,
          "version" | "createdAt"
        >;
        return self.create(rest, version);
      } catch (err) {
        console.error("Error upserting item", tableName, item, err);
        throw err;
      }
    },

    /**
     * Queries items from the table using DynamoDB query expressions
     * Supports pagination and version-specific queries
     *
     * @param query - The DynamoDB query parameters
     * @param version - Version to query (optional)
     * @returns Object containing items and whether any are unpublished
     */
    query: async (query: Query, version?: string | null) => {
      // console.info("query", { query, version });
      try {
        let items: TTableRecord[] = [];
        let lastEvaluatedKey: Record<string, unknown> | undefined = undefined;

        // Handle pagination by continuing to query until no more results
        do {
          const response = (await lowLevelTable.query({
            ...query,
            ExclusiveStartKey: lastEvaluatedKey,
          })) as unknown as {
            Items: TTableRecord[];
            LastEvaluatedKey: Record<string, unknown>;
          };

          items = items.concat(response.Items);
          lastEvaluatedKey = response.LastEvaluatedKey;
        } while (lastEvaluatedKey);

        // Apply version filtering to all items
        const versionedItems = items.map((item) =>
          getVersion(parseItem(item, "query") as TTableRecord, version)
        );

        return {
          items: versionedItems
            .map((item) => item.item)
            .filter(Boolean) as TTableRecord[],
          areAnyUnpublished: versionedItems.some((item) => item.isUnpublished),
        };
      } catch (err: unknown) {
        console.error("Error querying table", tableName, query, err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        const error = new Error(
          `Error querying table ${tableName}: ${errorMessage}`
        );
        if (err instanceof Error && err.stack) {
          error.stack = err.stack;
        }
        throw error;
      }
    },

    /**
     * Queries items from the table with pagination support
     * Uses DynamoDB Limit and ExclusiveStartKey for efficient pagination
     * Only fetches the requested page, not all results
     *
     * @param query - The DynamoDB query parameters
     * @param options - Pagination options (limit, cursor, version)
     * @returns Object containing items and nextCursor for pagination
     */
    queryPaginated: async (
      query: Query,
      options: {
        limit: number;
        cursor?: string | null;
        version?: string | null;
      }
    ) => {
      const { limit, cursor, version } = options;
      try {
        // Parse cursor (LastEvaluatedKey) if provided
        let exclusiveStartKey: Record<string, unknown> | undefined = undefined;
        if (cursor) {
          try {
            exclusiveStartKey = JSON.parse(
              Buffer.from(cursor, "base64").toString()
            ) as Record<string, unknown>;
          } catch {
            throw new Error("Invalid cursor format");
          }
        }

        // Query with limit + 1 to detect if more results exist
        const response = (await lowLevelTable.query({
          ...query,
          Limit: limit + 1,
          ExclusiveStartKey: exclusiveStartKey,
        })) as unknown as {
          Items: TTableRecord[];
          LastEvaluatedKey: Record<string, unknown> | undefined;
        };

        // Parse and validate items
        const versionedItems = response.Items.map((item) =>
          getVersion(parseItem(item, "queryPaginated") as TTableRecord, version)
        );

        const validItems = versionedItems
          .map((item) => item.item)
          .filter(Boolean) as TTableRecord[];

        // Check if we have more results (we requested limit+1 to detect this)
        const hasMore = validItems.length > limit;
        const items = hasMore ? validItems.slice(0, limit) : validItems;

        // Build next cursor if there are more results
        // DynamoDB's LastEvaluatedKey contains the exact keys needed to continue
        // the query from where we left off (works for both table and GSI queries)
        let nextCursor: string | null = null;
        if (hasMore && response.LastEvaluatedKey) {
          // We got limit+1 items, so there are more results
          // Use DynamoDB's LastEvaluatedKey which has the correct structure
          // for continuing the query (includes GSI keys if using an index)
          nextCursor = Buffer.from(
            JSON.stringify(response.LastEvaluatedKey)
          ).toString("base64");
        }

        return {
          items,
          nextCursor,
        };
      } catch (err: unknown) {
        console.error("Error querying table with pagination", tableName, query, err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        const error = new Error(
          `Error querying table ${tableName} with pagination: ${errorMessage}`
        );
        if (err instanceof Error && err.stack) {
          error.stack = err.stack;
        }
        throw error;
      }
    },

    /**
     * Queries items from the table using DynamoDB query expressions
     * Returns an async generator that yields items one by one without buffering all results
     * Supports pagination and version-specific queries
     *
     * @param query - The DynamoDB query parameters
     * @param version - Version to query (optional)
     * @returns Async generator that yields TTableRecord items
     */
    queryAsync: async function* (
      query: Query,
      version?: string | null
    ): AsyncGenerator<TTableRecord, void, unknown> {
      // console.info("queryAsync", { query, version });
      try {
        let lastEvaluatedKey: Record<string, unknown> | undefined = undefined;

        // Handle pagination by continuing to query until no more results
        // The do-while pattern ensures we always execute at least one query
        // and continue while there are more pages (indicated by LastEvaluatedKey)
        do {
          const response = (await lowLevelTable.query({
            ...query,
            ExclusiveStartKey: lastEvaluatedKey,
          })) as unknown as {
            Items: TTableRecord[];
            LastEvaluatedKey: Record<string, unknown>;
          };

          // Process each item in the current page and yield immediately
          for (const item of response.Items) {
            const versionedItem = getVersion(
              parseItem(item, "queryAsync") as TTableRecord,
              version
            );

            // Only yield valid items (not undefined)
            if (versionedItem.item) {
              yield versionedItem.item;
            }
          }

          lastEvaluatedKey = response.LastEvaluatedKey;
        } while (lastEvaluatedKey);
      } catch (err: unknown) {
        console.error("Error querying table", tableName, query, err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        const error = new Error(
          `Error querying table ${tableName}: ${errorMessage}`
        );
        if (err instanceof Error && err.stack) {
          error.stack = err.stack;
        }
        throw error;
      }
    },

    /**
     * Merges a version into the main item, making draft changes permanent
     * This is the final step in the versioning workflow
     *
     * @param pk - Primary key
     * @param sk - Sort key (optional)
     * @param version - Version to merge
     * @returns The merged item
     */
    merge: async (
      pk: string,
      sk: string | undefined,
      version: string | null
    ) => {
      // console.info("merge", { pk, sk, version });
      if (version === null || version === undefined) {
        throw badRequest("Version is required for merge operation");
      }
      const existingItem = await self.get(pk, sk);
      if (!existingItem) {
        throw resourceGone(
          `Error merging item in table ${tableName}: Item not found`
        );
      }
      const versionMeta = existingItem.userVersions?.[version];
      if (!versionMeta) {
        if (existingItem.noMainVersion) {
          // If no main version and no version metadata, delete the item
          await lowLevelTable.delete({ pk, sk });
        }
        return existingItem;
      }
      if (versionMeta.deleted) {
        // item was removed, so we need to remove the main item
        await lowLevelTable.delete({ pk, sk });
        return existingItem;
      }
      // Merge version data into main item
      const newItem = clean({
        pk,
        sk,
        ...versionMeta.newProps,
      }) as TTableRecord;
      return self.update(newItem);
    },

    revert: async (pk: string, sk: string | undefined, version: string) => {
      console.info("revert", { pk, sk, version });
      const existingItem = await self.get(pk, sk);
      if (!existingItem) {
        throw resourceGone(
          `Error reverting item in table ${tableName}: Item not found`
        );
      }
      if (!existingItem.userVersions?.[version]) {
        return existingItem;
      }
      const userVersionsWithoutVersion = omit(existingItem.userVersions, [
        version,
      ]);
      return self.update({
        ...existingItem,
        userVersions: userVersionsWithoutVersion,
      } as unknown as Partial<TTableRecord> & { pk: string });
    },

    /**
     * Atomically updates a record with automatic retry on version conflicts
     * Handles both create and update cases seamlessly
     * Uses optimistic locking with exponential backoff retry logic
     *
     * @param pk - Primary key
     * @param sk - Sort key (optional)
     * @param updater - Function that receives current record (or undefined) and returns new record
     * @param options - Optional configuration (maxRetries, default: 3)
     * @returns The updated or created item
     */
    atomicUpdate: async (
      pk: string,
      sk: string | undefined,
      updater: (
        current: TTableRecord | undefined
      ) => Promise<Partial<TTableRecord> & { pk: string }>,
      options?: { maxRetries?: number }
    ): Promise<TTableRecord> => {
      const maxRetries = options?.maxRetries ?? 3;
      let lastError: Error | undefined;
      let retryCount = 0;

      while (retryCount <= maxRetries) {
        try {
          // Fetch current record (or undefined if not exists)
          const currentItem = (await self.get(pk, sk)) as
            | TTableRecord
            | undefined;

          // Call user-provided updater function
          const updatedItem = await updater(currentItem);

          // Ensure pk and sk match the provided keys
          const key = keySubset({ pk, sk });
          const itemWithKeys = {
            ...updatedItem,
            pk: key.pk,
            sk: key.sk,
          };

          if (currentItem) {
            // Record exists: update with version increment and conditional check
            const newItem = clean(
              parseItem(
                {
                  ...currentItem,
                  ...itemWithKeys,
                  version: currentItem.version + 1,
                  updatedAt: new Date().toISOString(),
                  pk: currentItem.pk,
                  sk: currentItem.sk,
                },
                "atomicUpdate"
              )
            ) as TTableRecord;

            // Use conditional update to ensure we're updating the expected version
            await lowLevelClient.PutItem({
              Item: newItem,
              TableName: lowLevelTableName,
              ConditionExpression: "#version = :version",
              ExpressionAttributeValues: {
                ":version": currentItem.version,
              },
              ExpressionAttributeNames: { "#version": "version" },
            });

            return newItem as unknown as TTableRecord;
          } else {
            // Record doesn't exist: create with version=1 and conditional check
            const newItem = clean(
              parseItem(
                {
                  version: 1,
                  createdAt: new Date().toISOString(),
                  ...itemWithKeys,
                },
                "atomicUpdate"
              )
            ) as TTableRecord;

            // Use conditional put to ensure item doesn't already exist (prevent races)
            await lowLevelClient.PutItem({
              Item: newItem,
              TableName: lowLevelTableName,
              ConditionExpression: "attribute_not_exists(pk)",
            });

            return newItem as unknown as TTableRecord;
          }
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error(String(err));

          // Check if it's a version conflict error
          if (
            err instanceof Error &&
            (err.message.toLowerCase().includes("conditional request failed") ||
              err.message.toLowerCase().includes("item was outdated") ||
              err.message.toLowerCase().includes("conditionalcheckfailed") ||
              err.message.toLowerCase().includes("conditional check failed"))
          ) {
            retryCount++;
            if (retryCount > maxRetries) {
              throw conflict(
                `Failed to atomically update record after ${maxRetries} retries: ${lastError.message}`
              );
            }

            // Exponential backoff: 50ms, 100ms, 200ms
            const backoffMs = 50 * Math.pow(2, retryCount - 1);
            console.info(
              `[atomicUpdate] Version conflict, retrying in ${backoffMs}ms (attempt ${retryCount}/${maxRetries}):`,
              {
                tableName,
                pk,
                sk,
                error: lastError.message,
              }
            );
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }

          // If it's not a version conflict, rethrow immediately
          throw lastError;
        }
      }

      throw conflict(
        `Failed to atomically update record after ${maxRetries} retries: ${
          lastError?.message || "Unknown error"
        }`
      );
    },
  };
  return self as unknown as TableAPI<TTableName>;
};
