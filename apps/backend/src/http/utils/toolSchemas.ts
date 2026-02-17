import { z } from "zod";

/**
 * Canonical JSON Schema for tools with no parameters.
 * OpenAI/Azure require function parameters to be a JSON Schema with type "object";
 * empty Zod schemas can serialize to type null and cause provider errors.
 */
export const EMPTY_PARAMETERS_JSON_SCHEMA = {
  type: "object" as const,
  properties: {} as const,
  required: [] as string[],
};

/** Default 50, max 200. Use for DynamoDB list tools (agents, members, documents, integrations, schedules, eval judges). */
export const listLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(200)
  .default(50)
  .describe("Maximum number of items to return (default: 50, max: 200)");

/** Opaque cursor for DynamoDB queryPaginated (base64 LastEvaluatedKey). */
export const listCursorSchema = z
  .string()
  .optional()
  .describe(
    "Pagination cursor. Use nextCursor from previous response for next page."
  );
