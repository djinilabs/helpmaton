import type { ZodError, ZodType, ZodTypeAny } from "zod";

type ToolValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const normalizeKeyName = (key: string): string =>
  key.toLowerCase().replace(/[_-]/g, "");

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getInnerType = (schema: ZodTypeAny): ZodTypeAny =>
  (schema as unknown as { _def: { innerType: ZodTypeAny } })._def.innerType;

const getPipeInput = (schema: ZodTypeAny): ZodTypeAny =>
  (schema as unknown as { _def: { in: ZodTypeAny } })._def.in;

const getArrayItemType = (schema: ZodTypeAny): ZodTypeAny =>
  (schema as unknown as { _def: { element: ZodTypeAny } })._def.element;

const getTupleItems = (schema: ZodTypeAny): ZodTypeAny[] =>
  (schema as unknown as { _def: { items: ZodTypeAny[] } })._def.items;

const getRecordValueType = (schema: ZodTypeAny): ZodTypeAny =>
  (schema as unknown as { _def: { valueType: ZodTypeAny } })._def.valueType;

const unwrapSchema = (schema: ZodTypeAny): ZodTypeAny => {
  let current: ZodTypeAny = schema;
  while (true) {
    const def = (current as { _def?: { type?: string } })._def;
    const type = def?.type;
    if (
      type === "optional" ||
      type === "nullable" ||
      type === "default" ||
      type === "catch" ||
      type === "readonly"
    ) {
      current = getInnerType(current);
      continue;
    }
    if (type === "pipe") {
      current = getPipeInput(current);
      continue;
    }
    return current;
  }
};

const getObjectShape = (schema: ZodTypeAny): Record<string, ZodTypeAny> => {
  const def = (schema as { _def?: { shape?: (() => unknown) | unknown } })._def;
  const shape =
    typeof def?.shape === "function" ? def.shape() : def?.shape ?? {};
  return shape as Record<string, ZodTypeAny>;
};

const normalizeValue = (schema: ZodTypeAny, value: unknown): unknown => {
  const unwrapped = unwrapSchema(schema);
  const def = (unwrapped as { _def?: { type?: string } })._def;
  const type = def?.type;

  if (type === "object") {
    if (!isPlainObject(value)) {
      return value;
    }
    const shape = getObjectShape(unwrapped);
    const canonicalKeys = new Map<string, string>();
    for (const key of Object.keys(shape)) {
      canonicalKeys.set(normalizeKeyName(key), key);
    }

    const result: Record<string, unknown> = {};
    for (const [key, currentValue] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(shape, key)) {
        result[key] = normalizeValue(shape[key], currentValue);
        continue;
      }
      const normalized = normalizeKeyName(key);
      const canonical = canonicalKeys.get(normalized);
      if (canonical) {
        const hasCanonical =
          Object.prototype.hasOwnProperty.call(value, canonical) ||
          Object.prototype.hasOwnProperty.call(result, canonical);
        if (!hasCanonical) {
          result[canonical] = normalizeValue(shape[canonical], currentValue);
        }
        continue;
      }
      result[key] = currentValue;
    }
    return result;
  }

  if (type === "array") {
    if (!Array.isArray(value)) {
      return value;
    }
    const itemType = getArrayItemType(unwrapped);
    return value.map((item) => normalizeValue(itemType, item));
  }

  if (type === "tuple") {
    if (!Array.isArray(value)) {
      return value;
    }
    const items = getTupleItems(unwrapped);
    return value.map((item, index) =>
      items[index] ? normalizeValue(items[index], item) : item
    );
  }

  if (type === "record") {
    if (!isPlainObject(value)) {
      return value;
    }
    const valueType = getRecordValueType(unwrapped);
    const result: Record<string, unknown> = {};
    for (const [key, currentValue] of Object.entries(value)) {
      result[key] = normalizeValue(valueType, currentValue);
    }
    return result;
  }

  if (type === "union") {
    const optionList = (
      unwrapped as { _def?: { options?: ZodTypeAny[] } }
    )._def?.options ?? [];
    for (const option of optionList) {
      const normalized = normalizeValue(option, value);
      if (option.safeParse(normalized).success) {
        return normalized;
      }
    }
    return value;
  }

  return value;
};

const normalizeToolArgs = <T>(schema: ZodType<T>, args: unknown): unknown =>
  normalizeValue(schema as ZodTypeAny, args);

const formatPath = (path: Array<PropertyKey>): string => {
  if (!path.length) {
    return "value";
  }
  return path.map((part) => String(part)).join(".");
};

const formatIssue = (issue: ZodError["issues"][number]): string => {
  const code = issue.code as string;
  const issueAny = issue as unknown as Record<string, unknown>;

  if (code === "unrecognized_keys") {
    const keys = Array.isArray(issueAny.keys) ? issueAny.keys.join(", ") : "";
    return `Unknown field(s): ${keys}.`;
  }

  const path = formatPath(issue.path);

  if (code === "invalid_type") {
    const received = issueAny.received as string | undefined;
    const expected = issueAny.expected as string | undefined;
    if (received === "undefined") {
      return `Missing required field "${path}".`;
    }
    return `Invalid type for "${path}": expected ${expected}, received ${received}.`;
  }

  if (code === "invalid_enum_value") {
    const options = Array.isArray(issueAny.options)
      ? issueAny.options.join(", ")
      : "";
    return `Invalid value for "${path}": expected one of ${options}.`;
  }

  if (code === "too_small") {
    return `Value for "${path}" is too small: ${issue.message}`;
  }

  if (code === "too_big") {
    return `Value for "${path}" is too large: ${issue.message}`;
  }

  if (code === "invalid_string") {
    return `Invalid value for "${path}": ${issue.message}.`;
  }

  return `Invalid value for "${path}": ${issue.message}.`;
};

export const formatToolValidationError = (error: ZodError): string => {
  const messages = error.issues.map(formatIssue).join(" ");
  return `Error: Invalid tool arguments. ${messages}`;
};

export const validateToolArgs = <T>(
  schema: ZodType<T>,
  args: unknown
): ToolValidationResult<T> => {
  const normalizedArgs = normalizeToolArgs(schema, args);
  const parsed = schema.safeParse(normalizedArgs);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  return { ok: false, error: formatToolValidationError(parsed.error) };
};
