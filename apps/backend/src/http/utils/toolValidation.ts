import type { ZodError, ZodType } from "zod";

type ToolValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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
  const parsed = schema.safeParse(args);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  return { ok: false, error: formatToolValidationError(parsed.error) };
};
