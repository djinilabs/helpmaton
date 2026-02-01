import { tables } from "@architect/functions";
import { conflict } from "@hapi/boom";
import { z } from "zod";

import { once } from "../utils";

import {
  DatabaseSchema,
  DatabaseSchemaWithAtomicUpdate,
  TableAPI,
  TableName,
  tableSchemas,
  AtomicUpdateRecordSpec,
  AtomicUpdateCallback,
  TableRecord,
} from "./schema";
import { tableApi } from "./tableApi";

/**
 * Removes undefined values from an object to ensure clean data for DynamoDB storage
 */
const clean = (item: Record<string, unknown>): Record<string, unknown> => {
  return Object.fromEntries(
    Object.entries(item).filter(([, value]) => value !== undefined)
  );
};

/**
 * Creates a parser function that validates and cleans items using Zod schemas
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

export const database = once(
  async (): Promise<DatabaseSchemaWithAtomicUpdate> => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const client = await tables();
    const existingTables = Array.from(
      Object.entries(await client.reflect())
    ) as Array<[TableName, string]>;
    const lowLevelClient = client._client;

    // Build table name mapping (logical -> physical)
    const tableNameMap = new Map<TableName, string>();
    existingTables.forEach(([logicalName, physicalName]) => {
      tableNameMap.set(logicalName, physicalName);
    });

    // Build table APIs
    const tableApis = Object.fromEntries(
      existingTables.map(([tableName, lowLevelTableName]) => {
        const lowLevelTable = client[tableName];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const schema = (tableSchemas as any)[tableName];
        return [
          tableName,
          tableApi<typeof tableName>(
            tableName,
            lowLevelTable,
            lowLevelClient,
            lowLevelTableName,
            schema
          ),
        ] as [typeof tableName, TableAPI<typeof tableName>];
      })
    ) as DatabaseSchema & Record<string, unknown>; // Allow additional tables

    /**
     * Atomically updates multiple records across multiple tables using DynamoDB transactions
     * with optimistic concurrency control and automatic retries on version conflicts
     */
    const atomicUpdate = async (
      recordSpec: AtomicUpdateRecordSpec,
      callback: AtomicUpdateCallback
    ): Promise<TableRecord[]> => {
      const maxAttempts = 4; // 1 initial attempt + 3 retries
      let lastError: Error | undefined;
      let attemptCount = 0;

      const isTransactionConflictError = (error: Error): boolean => {
        const name = error.name?.toLowerCase() || "";
        const message = error.message?.toLowerCase() || "";
        const code = String((error as { code?: string }).code ?? "").toLowerCase();
        return (
          name === "transactionconflictexception" ||
          code === "transactionconflictexception" ||
          message.includes("transaction is ongoing for the item") ||
          message.includes("transactionconflict")
        );
      };

      const isConditionalCheckError = (error: Error): boolean => {
        const message = error.message?.toLowerCase() || "";
        return (
          message.includes("conditional request failed") ||
          message.includes("item was outdated") ||
          message.includes("conditionalcheckfailed") ||
          message.includes("conditional check failed") ||
          message.includes("transaction cancelled")
        );
      };

      while (attemptCount < maxAttempts) {
        attemptCount++;
        try {
          // Phase 1: Fetch all records
          const fetchedRecords = new Map<string, TableRecord | undefined>();
          for (const [key, spec] of recordSpec.entries()) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tableApi = (tableApis as any)[spec.table];
            if (!tableApi) {
              throw new Error(`Table ${spec.table} not found`);
            }
            const record = await tableApi.get(spec.pk, spec.sk);
            fetchedRecords.set(key, record as TableRecord | undefined);
          }

          // Phase 2: Call user callback
          const recordsToPut = await callback(fetchedRecords);

          // Phase 3: Validate and build transaction items
          const transactItems: Array<{
            Put: {
              Item: Record<string, unknown>;
              TableName: string;
              ConditionExpression: string;
              ExpressionAttributeValues?: Record<string, unknown>;
              ExpressionAttributeNames?: Record<string, string>;
            };
          }> = [];

          // Track which records exist (for create vs update logic)
          const existingRecords = new Map<string, TableRecord>();
          for (const [key, record] of fetchedRecords.entries()) {
            if (record) {
              existingRecords.set(key, record);
            }
          }

          // For each record to put, find which table it belongs to and validate
          for (const recordToPut of recordsToPut) {
            // Find matching recordSpec by matching pk/sk
            let matchedSpec:
              | {
                  key: string;
                  spec: { table: TableName; pk: string; sk?: string };
                }
              | undefined;
            for (const [key, spec] of recordSpec.entries()) {
              if (
                recordToPut.pk === spec.pk &&
                ((spec.sk === undefined && recordToPut.sk === undefined) ||
                  (spec.sk !== undefined && recordToPut.sk === spec.sk))
              ) {
                matchedSpec = { key, spec };
                break;
              }
            }

            if (!matchedSpec) {
              throw new Error(
                `Record with pk=${recordToPut.pk}, sk=${recordToPut.sk} does not match any recordSpec`
              );
            }

            const { spec } = matchedSpec;
            const tableName = spec.table;
            const physicalTableName = tableNameMap.get(tableName);
            if (!physicalTableName) {
              throw new Error(`Physical table name not found for ${tableName}`);
            }

            const schema = tableSchemas[tableName as keyof typeof tableSchemas];
            const parseItem = parsingItem(schema, tableName);

            // Check if record exists
            const existingRecord = existingRecords.get(matchedSpec.key);
            const isCreate = !existingRecord;

            let validatedItem: Record<string, unknown>;
            let conditionExpression: string;
            let expressionAttributeValues: Record<string, unknown> | undefined;
            let expressionAttributeNames: Record<string, string> | undefined;

            if (isCreate) {
              // Create: set version=1, createdAt, and check attribute_not_exists(pk)
              // Omit version and createdAt from recordToPut to avoid duplicates
              const {
                version: _unusedVersion,
                createdAt: _unusedCreatedAt,
                ...recordWithoutVersion
              } = recordToPut as Record<string, unknown>;
              void _unusedVersion;
              void _unusedCreatedAt;
              validatedItem = parseItem(
                {
                  ...recordWithoutVersion,
                  version: 1,
                  createdAt: new Date().toISOString(),
                  pk: spec.pk,
                  sk: spec.sk,
                },
                "atomicUpdate"
              );
              conditionExpression = "attribute_not_exists(pk)";
            } else {
              // Update: increment version, set updatedAt, and check version matches
              // Omit version and updatedAt from recordToPut to avoid duplicates
              const {
                version: _unusedVersion,
                updatedAt: _unusedUpdatedAt,
                ...recordWithoutVersion
              } = recordToPut as Record<string, unknown>;
              void _unusedVersion;
              void _unusedUpdatedAt;
              validatedItem = parseItem(
                {
                  ...existingRecord,
                  ...recordWithoutVersion,
                  version: existingRecord.version + 1,
                  updatedAt: new Date().toISOString(),
                  pk: existingRecord.pk,
                  sk: existingRecord.sk,
                },
                "atomicUpdate"
              );
              conditionExpression = "#version = :version";
              expressionAttributeValues = {
                ":version": existingRecord.version,
              };
              expressionAttributeNames = { "#version": "version" };
            }

            transactItems.push({
              Put: {
                Item: validatedItem,
                TableName: physicalTableName,
                ConditionExpression: conditionExpression,
                ...(expressionAttributeValues && {
                  ExpressionAttributeValues: expressionAttributeValues,
                }),
                ...(expressionAttributeNames && {
                  ExpressionAttributeNames: expressionAttributeNames,
                }),
              },
            });
          }

          // Phase 4: Execute transaction
          if (transactItems.length === 0) {
            // No items to put, return empty array
            return [];
          }

          console.log("transactItems", JSON.stringify(transactItems, null, 2));

          // Check if we're in local sandbox environment
          // Local DynamoDB emulators (like Architect Sandbox) may not support TransactWriteItems
          const clientConfig = lowLevelClient as {
            config?: { endpoint?: string };
          };
          const isLocalSandbox =
            process.env.ARC_SANDBOX !== undefined ||
            process.env.ARC_ENV === "testing" ||
            clientConfig.config?.endpoint?.includes("localhost") ||
            clientConfig.config?.endpoint?.includes("127.0.0.1");

          if (isLocalSandbox) {
            // Local sandbox: execute individual PutItem calls instead of TransactWriteItems
            // This maintains the same conditional logic but without transaction guarantees
            console.log(
              "[atomicUpdate] Local sandbox detected - using individual PutItem calls instead of TransactWriteItems"
            );

            // Execute each PutItem individually
            // Note: This loses transaction atomicity, but works in local sandbox
            for (const transactItem of transactItems) {
              const { Put } = transactItem;
              if (!Put) {
                throw new Error(
                  "Only Put operations are supported in local sandbox mode"
                );
              }

              await lowLevelClient.PutItem({
                Item: Put.Item,
                TableName: Put.TableName,
                ConditionExpression: Put.ConditionExpression,
                ...(Put.ExpressionAttributeValues && {
                  ExpressionAttributeValues: Put.ExpressionAttributeValues,
                }),
                ...(Put.ExpressionAttributeNames && {
                  ExpressionAttributeNames: Put.ExpressionAttributeNames,
                }),
              });
            }
          } else {
            // Production: use TransactWriteItems for atomicity
            await lowLevelClient.TransactWriteItems({
              TransactItems: transactItems,
            });
          }

          // Success: return the records that were written
          return recordsToPut;
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error(String(err));

          // Check if it's a conditional check error (version conflict) or transaction conflict
          if (
            lastError &&
            (isConditionalCheckError(lastError) ||
              isTransactionConflictError(lastError)) &&
            attemptCount < maxAttempts
          ) {
            const baseDelay = 50 * Math.pow(2, attemptCount - 1);
            const jitter = Math.random() * baseDelay * 0.2;
            const backoffMs = Math.round(baseDelay + jitter);
            console.info(
              `[atomicUpdate] Transaction conflict, retrying in ${backoffMs}ms (attempt ${attemptCount}/${maxAttempts}):`,
              { error: lastError.message }
            );
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }

          // If it's not a conditional check error, or we've exceeded max attempts, throw
          throw lastError;
        }
      }

      // Should never reach here, but TypeScript needs this
      throw conflict(
        `Failed to atomically update records after ${maxAttempts} attempts: ${
          lastError?.message || "Unknown error"
        }`
      );
    };

    return {
      ...tableApis,
      atomicUpdate,
    } as DatabaseSchemaWithAtomicUpdate;
  }
);
