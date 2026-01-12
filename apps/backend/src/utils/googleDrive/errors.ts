/**
 * Check if an error is a recoverable/throttle error
 */
export function isRecoverableError(status: number): boolean {
  // HTTP 429 (Too Many Requests) and 503 (Service Unavailable) are recoverable
  return status === 429 || status === 503;
}

/**
 * Check if an error is an authentication error
 */
export function isAuthenticationError(status: number): boolean {
  // HTTP 401 (Unauthorized) and 403 (Forbidden) with auth-related messages
  return status === 401 || status === 403;
}

/**
 * Calculate exponential backoff delay with jitter
 * @param attempt - Current attempt number (0-indexed)
 * @param baseDelayMs - Base delay in milliseconds (default: 1000)
 * @param maxDelayMs - Maximum delay in milliseconds (default: 8000)
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 8000
): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  
  // Add jitter (random value between 0 and 20% of delay)
  const jitter = Math.random() * exponentialDelay * 0.2;
  
  // Cap at max delay
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
