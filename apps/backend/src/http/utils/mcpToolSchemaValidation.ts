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

const normalizeSchema = (schema: Record<string, unknown>): Record<string, unknown> => {
  if (!schema.type && schema.properties) {
    return {
      type: "object",
      ...schema,
    };
  }
  return schema;
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
  const valid = validator(params ?? {});
  if (valid) {
    return { ok: true };
  }
  return { ok: false, error: formatAjvErrors(validator.errors ?? []) };
};
