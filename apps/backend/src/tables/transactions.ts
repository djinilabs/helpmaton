import { AwsLiteDynamoDB } from "@aws-lite/dynamodb-types";
import { conflict } from "@hapi/boom";
import { z } from "zod";

import {
  DatabaseSchema,
  TableName,
  TableSchemas,
  TransactionOperation,
  tableSchemas,
} from "./schema";

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
const parseItem =
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

interface TransactionContext {
  db: Omit<DatabaseSchema, "transactWrite">;
  lowLevelClient: AwsLiteDynamoDB;
  tableNameMap: Map<TableName, string>;
}

/**
 * Reads current items for operations that have updater functions
 */
async function readCurrentItems(
  ctx: TransactionContext,
  operations: TransactionOperation[]
): Promise<Map<number, unknown>> {
  const currentItems = new Map<number, unknown>();

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (
      (op.type === "Put" && op.updater) ||
      (op.type === "Update" && op.updater)
    ) {
      const tableApi = ctx.db[op.table];
      const current = await tableApi.get(op.key.pk, op.key.sk);
      currentItems.set(i, current);
    }
  }

  return currentItems;
}

/**
 * Applies updater functions to generate new items
 */
async function applyUpdaters(
  ctx: TransactionContext,
  operations: TransactionOperation[],
  currentItems: Map<number, unknown>
): Promise<Map<number, Record<string, unknown>>> {
  const newItems = new Map<number, Record<string, unknown>>();

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (op.type === "Put" && op.updater) {
      const current = currentItems.get(i) as
        | z.infer<TableSchemas[typeof op.table]>
        | undefined;
      const updated = await op.updater(current);
      newItems.set(i, updated as Record<string, unknown>);
    } else if (op.type === "Update" && op.updater) {
      const current = currentItems.get(i) as
        | z.infer<TableSchemas[typeof op.table]>
        | undefined;
      const updated = await op.updater(current);
      newItems.set(i, updated as Record<string, unknown>);
    }
  }

  return newItems;
}

/**
 * Builds an item and condition expression for an updater-based operation.
 * This is shared logic for both Put and Update operations when using updater functions.
 * Note: pk, sk, version, and updatedAt are set after spread to prevent
 * updater from overriding these critical fields that maintain optimistic concurrency control.
 */
function buildItemFromUpdater<TTableName extends TableName>(
  current: z.infer<TableSchemas[TTableName]> | undefined,
  updated: Record<string, unknown>,
  key: { pk: string; sk?: string },
  parse: (item: unknown, operation: string) => Record<string, unknown>
): {
  item: Record<string, unknown>;
  conditionExpression: string;
  expressionAttributeNames: Record<string, string>;
  expressionAttributeValues: Record<string, unknown>;
} {
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, unknown> = {};

  if (current) {
    // Item exists: increment version and add condition
    const currentVersion = (current as { version?: number }).version ?? 0;
    const item = parse(
      {
        ...current,
        ...updated,
        pk: key.pk,
        sk: key.sk,
        version: currentVersion + 1,
        updatedAt: new Date().toISOString(),
      },
      "transactWrite"
    );
    const conditionExpression = "#version = :version";
    expressionAttributeNames["#version"] = "version";
    expressionAttributeValues[":version"] = currentVersion;
    return {
      item,
      conditionExpression,
      expressionAttributeNames,
      expressionAttributeValues,
    };
  } else {
    // Item doesn't exist: create with version=1
    const item = parse(
      {
        version: 1,
        createdAt: new Date().toISOString(),
        ...updated,
        pk: key.pk,
        sk: key.sk,
      },
      "transactWrite"
    );
    const conditionExpression = "attribute_not_exists(pk)";
    return {
      item,
      conditionExpression,
      expressionAttributeNames,
      expressionAttributeValues,
    };
  }
}

type TransactItem = {
  Put?: {
    TableName: string;
    Item: Record<string, unknown>;
    ConditionExpression?: string;
    ExpressionAttributeNames?: Record<string, string>;
    ExpressionAttributeValues?: Record<string, unknown>;
  };
  Update?: {
    TableName: string;
    Key: { pk: string; sk?: string };
    UpdateExpression: string;
    ConditionExpression?: string;
    ExpressionAttributeNames?: Record<string, string>;
    ExpressionAttributeValues?: Record<string, unknown>;
  };
  Delete?: {
    TableName: string;
    Key: { pk: string; sk?: string };
    ConditionExpression?: string;
    ExpressionAttributeNames?: Record<string, string>;
    ExpressionAttributeValues?: Record<string, unknown>;
  };
  ConditionCheck?: {
    TableName: string;
    Key: { pk: string; sk?: string };
    ConditionExpression: string;
    ExpressionAttributeNames?: Record<string, string>;
    ExpressionAttributeValues?: Record<string, unknown>;
  };
};

/**
 * Builds a TransactWriteItems request from operations
 */
function buildTransactionRequest(
  ctx: TransactionContext,
  operations: TransactionOperation[],
  currentItems: Map<number, unknown>,
  newItems: Map<number, Record<string, unknown>>
): {
  TransactItems: TransactItem[];
} {
  const transactItems: TransactItem[] = [];

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    const tableName = ctx.tableNameMap.get(op.table);
    if (!tableName) {
      throw new Error(`Table ${op.table} not found in table name map`);
    }
    const schema = tableSchemas[op.table];
    const parse = parseItem(schema, op.table);

    if (op.type === "Put") {
      let item: Record<string, unknown>;
      let conditionExpression: string | undefined;
      const expressionAttributeNames: Record<string, string> = {
        ...(op.expressionAttributeNames || {}),
      };
      const expressionAttributeValues: Record<string, unknown> = {
        ...(op.expressionAttributeValues || {}),
      };

      if (op.updater) {
        // Validate that item is not also provided (updater takes precedence)
        if (op.item) {
          throw new Error(
            `Put operation at index ${i} cannot provide both 'item' and 'updater' - use only one`
          );
        }
        // Use updater result
        const current = currentItems.get(i) as
          | z.infer<TableSchemas[typeof op.table]>
          | undefined;
        const updated = newItems.get(i)!;
        const key = { pk: op.key.pk, sk: op.key.sk };

        const result = buildItemFromUpdater(current, updated, key, parse);
        item = result.item;
        conditionExpression = result.conditionExpression;
        Object.assign(
          expressionAttributeNames,
          result.expressionAttributeNames
        );
        Object.assign(
          expressionAttributeValues,
          result.expressionAttributeValues
        );
      } else if (op.item) {
        // Use direct item
        item = parse(op.item, "transactWrite");
        conditionExpression = op.conditionExpression;
        // Only merge expression attributes if they're provided
        if (op.expressionAttributeNames) {
          Object.assign(expressionAttributeNames, op.expressionAttributeNames);
        }
        if (op.expressionAttributeValues) {
          Object.assign(
            expressionAttributeValues,
            op.expressionAttributeValues
          );
        }
      } else {
        throw new Error(
          `Put operation at index ${i} must provide either 'item' or 'updater'`
        );
      }

      transactItems.push({
        Put: {
          TableName: tableName,
          Item: item,
          ...(conditionExpression && {
            ConditionExpression: conditionExpression,
            // Only include expression attributes if condition is present
            // (they're only meaningful with a condition expression for Put operations)
            ...(Object.keys(expressionAttributeNames).length > 0 && {
              ExpressionAttributeNames: expressionAttributeNames,
            }),
            ...(Object.keys(expressionAttributeValues).length > 0 && {
              ExpressionAttributeValues: expressionAttributeValues,
            }),
          }),
        },
      });
    } else if (op.type === "Update") {
      if (op.updater) {
        // Validate that updateExpression is not also provided (updater takes precedence)
        if (op.updateExpression) {
          throw new Error(
            `Update operation at index ${i} cannot provide both 'updateExpression' and 'updater' - use only one`
          );
        }
        // Convert updater result to Put operation (same as Put with updater)
        const current = currentItems.get(i) as
          | z.infer<TableSchemas[typeof op.table]>
          | undefined;
        const updated = newItems.get(i)!;
        const key = { pk: op.key.pk, sk: op.key.sk };

        const result = buildItemFromUpdater(current, updated, key, parse);
        const item = result.item;
        const conditionExpression = result.conditionExpression;
        const expressionAttributeNames = result.expressionAttributeNames;
        const expressionAttributeValues = result.expressionAttributeValues;

        transactItems.push({
          Put: {
            TableName: tableName,
            Item: item,
            ConditionExpression: conditionExpression,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
          },
        });
      } else if (op.updateExpression) {
        // Use direct update expression
        // Build expression attributes - needed for both updateExpression and conditionExpression
        const expressionAttributeNames: Record<string, string> = {
          ...(op.expressionAttributeNames || {}),
        };
        const expressionAttributeValues: Record<string, unknown> = {
          ...(op.expressionAttributeValues || {}),
        };

        transactItems.push({
          Update: {
            TableName: tableName,
            Key: { pk: op.key.pk, ...(op.key.sk && { sk: op.key.sk }) },
            UpdateExpression: op.updateExpression,
            ...(Object.keys(expressionAttributeNames).length > 0 && {
              ExpressionAttributeNames: expressionAttributeNames,
            }),
            ...(Object.keys(expressionAttributeValues).length > 0 && {
              ExpressionAttributeValues: expressionAttributeValues,
            }),
            ...(op.conditionExpression && {
              ConditionExpression: op.conditionExpression,
            }),
          },
        });
      } else {
        throw new Error(
          `Update operation at index ${i} must provide either 'updateExpression' or 'updater'`
        );
      }
    } else if (op.type === "Delete") {
      transactItems.push({
        Delete: {
          TableName: tableName,
          Key: { pk: op.key.pk, ...(op.key.sk && { sk: op.key.sk }) },
          ...(op.conditionExpression && {
            ConditionExpression: op.conditionExpression,
            ExpressionAttributeNames: op.expressionAttributeNames,
            ExpressionAttributeValues: op.expressionAttributeValues,
          }),
        },
      });
    } else if (op.type === "ConditionCheck") {
      transactItems.push({
        ConditionCheck: {
          TableName: tableName,
          Key: { pk: op.key.pk, ...(op.key.sk && { sk: op.key.sk }) },
          ConditionExpression: op.conditionExpression,
          ExpressionAttributeNames: op.expressionAttributeNames,
          ExpressionAttributeValues: op.expressionAttributeValues,
        },
      });
    }
  }

  return { TransactItems: transactItems };
}

/**
 * Checks if an error is a version conflict that should trigger a retry
 */
function isVersionConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("transactioncanceledexception") ||
    message.includes("conditional request failed") ||
    message.includes("conditionalcheckfailed") ||
    message.includes("conditional check failed") ||
    message.includes("transaction cancelled")
  );
}

/**
 * Executes a DynamoDB transaction with retry logic
 */
export async function transactWrite(
  ctx: TransactionContext,
  operations: TransactionOperation[],
  options?: { maxRetries?: number }
): Promise<{ success: boolean }> {
  const maxRetries = options?.maxRetries ?? 3;

  // Validate operations
  if (operations.length === 0) {
    throw new Error("At least one operation is required");
  }
  if (operations.length > 25) {
    throw new Error("Maximum 25 operations per transaction (DynamoDB limit)");
  }

  // Validate that all operations reference valid tables
  for (const op of operations) {
    if (!ctx.tableNameMap.has(op.table)) {
      throw new Error(`Table ${op.table} not found`);
    }
  }

  let retryCount = 0;
  let lastError: Error | undefined;

  while (retryCount <= maxRetries) {
    try {
      // Phase 1: Read current items for operations with updaters
      const currentItems = await readCurrentItems(ctx, operations);

      // Phase 2: Apply updater functions
      const newItems = await applyUpdaters(ctx, operations, currentItems);

      // Phase 3: Build transaction request
      const request = buildTransactionRequest(
        ctx,
        operations,
        currentItems,
        newItems
      );

      // Phase 4: Execute transaction
      await ctx.lowLevelClient.TransactWriteItems(request);

      return { success: true };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Check if it's a version conflict error
      if (isVersionConflictError(err)) {
        retryCount++;
        if (retryCount > maxRetries) {
          throw conflict(
            `Failed to execute transaction after ${maxRetries} retries: ${lastError.message}`
          );
        }

        // Exponential backoff: 50ms, 100ms, 200ms
        const backoffMs = 50 * Math.pow(2, retryCount - 1);
        console.log(
          `[transactWrite] Version conflict, retrying in ${backoffMs}ms (attempt ${retryCount}/${maxRetries}):`,
          {
            error: lastError.message,
            operationCount: operations.length,
          }
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }

      // If it's not a version conflict, rethrow immediately
      throw lastError;
    }
  }

  // This should never be reached, but TypeScript requires it for exhaustiveness
  throw conflict(
    `Failed to execute transaction after ${maxRetries} retries: ${
      lastError?.message || "Unknown error"
    }`
  );
}
