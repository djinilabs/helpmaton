import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
    };

const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  strict: false,
});

const validatorCache = new Map<string, ValidateFunction>();

const normalizeKeyName = (key: string): string =>
  key.toLowerCase().replace(/[_-]/g, "");

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeSchema = (schema: Record<string, unknown>): Record<string, unknown> => {
  if (!schema.type && schema.properties) {
    return {
      type: "object",
      ...schema,
    };
  }
  return schema;
};

const isObjectSchema = (schema: Record<string, unknown>): boolean => {
  const type = schema.type;
  if (type === "object") {
    return true;
  }
  if (Array.isArray(type) && type.includes("object")) {
    return true;
  }
  return !!schema.properties;
};

const isArraySchema = (schema: Record<string, unknown>): boolean => {
  const type = schema.type;
  if (type === "array") {
    return true;
  }
  if (Array.isArray(type) && type.includes("array")) {
    return true;
  }
  return false;
};

const normalizeMcpParams = (schema: unknown, params: unknown): unknown => {
  if (!schema || typeof schema !== "object") {
    return params;
  }

  const normalizedSchema = normalizeSchema(schema as Record<string, unknown>);
  const maybeOneOf = normalizedSchema.oneOf;
  const maybeAnyOf = normalizedSchema.anyOf;
  if (Array.isArray(maybeOneOf) || Array.isArray(maybeAnyOf)) {
    const options = Array.isArray(maybeOneOf)
      ? maybeOneOf
      : Array.isArray(maybeAnyOf)
        ? maybeAnyOf
        : [];
    for (const option of options) {
      const normalized = normalizeMcpParams(option, params);
      const validator = getValidator(option);
      if (!validator) {
        return normalized;
      }
      if (validator(normalized ?? {})) {
        return normalized;
      }
    }
    return params;
  }

  if (isObjectSchema(normalizedSchema)) {
    if (!isPlainObject(params)) {
      return params;
    }
    const properties = normalizedSchema.properties as
      | Record<string, unknown>
      | undefined;
    const additional = normalizedSchema.additionalProperties;

    if (!properties) {
      if (additional && typeof additional === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(params)) {
          result[key] = normalizeMcpParams(additional, value);
        }
        return result;
      }
      return params;
    }

    const canonicalKeys = new Map<string, string>();
    for (const key of Object.keys(properties)) {
      canonicalKeys.set(normalizeKeyName(key), key);
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        result[key] = normalizeMcpParams(properties[key], value);
        continue;
      }
      const normalized = normalizeKeyName(key);
      const canonical = canonicalKeys.get(normalized);
      if (canonical) {
        const hasCanonical =
          Object.prototype.hasOwnProperty.call(params, canonical) ||
          Object.prototype.hasOwnProperty.call(result, canonical);
        if (!hasCanonical) {
          result[canonical] = normalizeMcpParams(properties[canonical], value);
        }
        continue;
      }
      if (additional && typeof additional === "object") {
        result[key] = normalizeMcpParams(additional, value);
        continue;
      }
      result[key] = value;
    }
    return result;
  }

  if (isArraySchema(normalizedSchema)) {
    if (!Array.isArray(params)) {
      return params;
    }
    const items = normalizedSchema.items;
    if (!items) {
      return params;
    }
    return params.map((value) => normalizeMcpParams(items, value));
  }

  return params;
};

const getValidator = (schema: unknown): ValidateFunction | null => {
  if (!schema || typeof schema !== "object") {
    return null;
  }
  const normalized = normalizeSchema(schema as Record<string, unknown>);
  const key = JSON.stringify(normalized);
  const cached = validatorCache.get(key);
  if (cached) {
    return cached;
  }
  const compiled = ajv.compile(normalized);
  validatorCache.set(key, compiled);
  return compiled;
};

const formatPath = (path: string, fallback?: string): string => {
  const trimmed = path.replace(/^\//, "").replace(/\//g, ".");
  return trimmed || fallback || "value";
};

const formatAjvErrors = (errors: ErrorObject[]): string => {
  const messages = errors.map((error) => {
    if (error.keyword === "required") {
      const missing = (error.params as { missingProperty?: string }).missingProperty;
      return `Missing required field "${missing}".`;
    }
    if (error.keyword === "additionalProperties") {
      const extra = (error.params as { additionalProperty?: string }).additionalProperty;
      return `Unknown field "${extra}".`;
    }
    if (error.keyword === "type") {
      const expected = (error.params as { type?: string }).type;
      const path = formatPath(error.instancePath, "value");
      return `Invalid type for "${path}": expected ${expected}.`;
    }
    if (error.keyword === "enum") {
      const path = formatPath(error.instancePath, "value");
      return `Invalid value for "${path}": ${error.message}.`;
    }
    const path = formatPath(error.instancePath, "value");
    return `Invalid value for "${path}": ${error.message}.`;
  });

  return `Error: Invalid tool arguments. ${messages.join(" ")}`;
};

export const validateMcpToolParams = (
  schema: unknown,
  params: unknown
): ValidationResult => {
  const validator = getValidator(schema);
  if (!validator) {
    return { ok: true };
  }
  const normalizedParams = normalizeMcpParams(schema, params);
  const valid = validator(normalizedParams ?? {});
  if (valid) {
    return { ok: true };
  }
  return { ok: false, error: formatAjvErrors(validator.errors ?? []) };
};
