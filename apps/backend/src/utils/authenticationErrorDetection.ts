const AUTH_MESSAGE_FRAGMENTS = [
  "api key",
  "authentication",
  "unauthorized",
  "forbidden",
  "invalid key",
  "invalid api",
  "authentication failed",
  "401",
  "403",
  "invalid api key",
  "api key is invalid",
  "authentication required",
  "no cookie auth credentials",
  "cookie auth credentials",
];

const AUTH_DATA_MESSAGE_FRAGMENTS = [
  "api key",
  "authentication",
  "unauthorized",
  "forbidden",
  "invalid key",
  "no cookie auth credentials",
  "cookie auth credentials",
];

const AUTH_BODY_MESSAGE_FRAGMENTS = [
  "api key",
  "authentication",
  "unauthorized",
  "forbidden",
  "invalid key",
];

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null;

const isAuthStatusCode = (value: unknown): boolean =>
  value === 401 || value === 403;

const includesAuthMessage = (
  message: string,
  fragments: string[] = AUTH_MESSAGE_FRAGMENTS
): boolean => {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("no output generated") &&
    normalized.includes("check the stream for errors")
  ) {
    return true;
  }
  return fragments.some((fragment) => normalized.includes(fragment));
};

const hasAuthStatusInObject = (obj: UnknownRecord): boolean => {
  if (isAuthStatusCode(obj.statusCode) || isAuthStatusCode(obj.status)) {
    return true;
  }

  const response = obj.response;
  if (isRecord(response)) {
    if (
      isAuthStatusCode(response.status) ||
      isAuthStatusCode(response.statusCode)
    ) {
      return true;
    }
  }

  return false;
};

const hasAuthMessageInErrorField = (errorField: unknown): boolean => {
  if (isRecord(errorField)) {
    if (typeof errorField.message === "string") {
      if (includesAuthMessage(errorField.message, AUTH_DATA_MESSAGE_FRAGMENTS)) {
        return true;
      }
    }
    if (isAuthStatusCode(errorField.code)) {
      return true;
    }
    return false;
  }

  if (typeof errorField === "string") {
    return includesAuthMessage(errorField, AUTH_DATA_MESSAGE_FRAGMENTS);
  }

  return false;
};

const hasAuthMessageInData = (data: unknown): boolean => {
  if (!isRecord(data)) {
    return false;
  }

  if ("error" in data) {
    if (hasAuthMessageInErrorField(data.error)) {
      return true;
    }
  }

  if (typeof data.message === "string") {
    return includesAuthMessage(data.message, AUTH_DATA_MESSAGE_FRAGMENTS);
  }

  return false;
};

const hasAuthMessageInBody = (body: string): boolean => {
  try {
    const parsed = JSON.parse(body) as UnknownRecord;
    if (typeof parsed.error === "string") {
      return includesAuthMessage(parsed.error, AUTH_BODY_MESSAGE_FRAGMENTS);
    }
  } catch {
    // Not JSON, ignore
  }

  return false;
};

const getCause = (err: unknown): unknown =>
  isRecord(err) && "cause" in err ? err.cause : undefined;

const checkAuthenticationError = (err: unknown): boolean => {
  if (!err) {
    return false;
  }

  if (err instanceof Error) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (isAuthStatusCode(statusCode)) {
      return true;
    }

    if (includesAuthMessage(err.message)) {
      return true;
    }

    if (err.cause && checkAuthenticationError(err.cause)) {
      return true;
    }
  }

  if (isRecord(err)) {
    if (hasAuthStatusInObject(err)) {
      return true;
    }

    if (hasAuthMessageInData(err.data)) {
      return true;
    }

    if (typeof err.body === "string" && hasAuthMessageInBody(err.body)) {
      return true;
    }

    const nestedCause = getCause(err);
    if (nestedCause && checkAuthenticationError(nestedCause)) {
      return true;
    }
  }

  return false;
};

/**
 * Check if an error indicates an authentication/authorization issue with the API key
 * This includes 401, 403 errors or error messages containing authentication-related keywords
 */
export function isAuthenticationError(error: unknown): boolean {
  return checkAuthenticationError(error);
}
