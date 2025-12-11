import type { ParameterSchema } from "../components/ClientToolParameterBuilder";

/**
 * Converts the parameter builder schema to JSON Schema format
 */
export function parameterSchemaToJsonSchema(
  schema: ParameterSchema
): Record<string, unknown> {
  const jsonSchema: Record<string, unknown> = {
    type: schema.type,
  };

  if (schema.description) {
    jsonSchema.description = schema.description;
  }

  if (schema.type === "object" && schema.properties) {
    jsonSchema.properties = {};
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      (jsonSchema.properties as Record<string, unknown>)[key] =
        parameterSchemaToJsonSchema(propSchema);
    }
    if (schema.required && schema.required.length > 0) {
      jsonSchema.required = schema.required;
    }
  }

  if (schema.type === "array" && schema.items) {
    jsonSchema.items = parameterSchemaToJsonSchema(schema.items);
  }

  return jsonSchema;
}

/**
 * Converts JSON Schema to parameter builder schema
 */
export function jsonSchemaToParameterSchema(
  jsonSchema: Record<string, unknown>
): ParameterSchema {
  const schema: ParameterSchema = {
    type: (jsonSchema.type as ParameterSchema["type"]) || "string",
  };

  if (jsonSchema.description) {
    schema.description = jsonSchema.description as string;
  }

  if (jsonSchema.type === "object" && jsonSchema.properties) {
    const properties: Record<string, ParameterSchema> = {};
    for (const [key, propSchema] of Object.entries(
      jsonSchema.properties as Record<string, unknown>
    )) {
      properties[key] = jsonSchemaToParameterSchema(
        propSchema as Record<string, unknown>
      );
    }
    schema.properties = properties;
    if (jsonSchema.required) {
      schema.required = jsonSchema.required as string[];
    }
  }

  if (jsonSchema.type === "array" && jsonSchema.items) {
    schema.items = jsonSchemaToParameterSchema(
      jsonSchema.items as Record<string, unknown>
    );
  }

  return schema;
}
