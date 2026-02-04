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
