/**
 * Request timeout utility for agent calls
 * Creates an AbortController with a 14-minute timeout to ensure requests
 * complete before Lambda timeout (15 minutes)
 */

const REQUEST_TIMEOUT_MS = 14 * 60 * 1000; // 14 minutes

export interface RequestTimeoutController {
  controller: AbortController;
  signal: AbortSignal;
  timeoutId: NodeJS.Timeout;
}

/**
 * Creates an AbortController with a 14-minute timeout
 * @returns Object containing the controller, signal, and timeout ID
 */
export function createRequestTimeout(): RequestTimeoutController {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  return {
    controller,
    signal: controller.signal,
    timeoutId,
  };
}

/**
 * Cleans up the timeout by clearing the timer
 * Should be called when request completes successfully or errors out
 */
export function cleanupRequestTimeout(
  timeout: RequestTimeoutController
): void {
  clearTimeout(timeout.timeoutId);
}

/**
 * Checks if an error is a timeout/abort error
 */
export function isTimeoutError(error: unknown): boolean {
  if (!error) return false;

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Check for abort-related errors
    if (
      name === "aborterror" ||
      name === "abort" ||
      message.includes("aborted") ||
      message.includes("timeout") ||
      message.includes("operation was aborted")
    ) {
      return true;
    }

    // Check error.cause recursively
    if (error.cause) {
      return isTimeoutError(error.cause);
    }
  }

  // Check if it's an object with abort-related properties
  if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>;
    if ("name" in obj && typeof obj.name === "string") {
      if (obj.name.toLowerCase() === "aborterror") {
        return true;
      }
    }
    if ("cause" in obj && obj.cause) {
      return isTimeoutError(obj.cause);
    }
  }

  return false;
}

/**
 * Creates a timeout error with appropriate HTTP status code
 */
export function createTimeoutError(): Error & { statusCode: number } {
  const error = new Error(
    "Request timeout: The agent call exceeded the 14-minute timeout limit"
  ) as Error & { statusCode: number };
  error.statusCode = 504; // Gateway Timeout
  error.name = "RequestTimeoutError";
  return error;
}
