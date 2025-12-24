/**
 * Shared utilities for workspace API key routes
 */

/**
 * Supported LLM providers for workspace API keys
 * Only OpenRouter is supported for BYOK (Bring Your Own Key)
 */
export const VALID_PROVIDERS = ["openrouter"] as const;

export type Provider = (typeof VALID_PROVIDERS)[number];

/**
 * Validates that a provider is one of the supported values
 * @param provider - The provider to validate
 * @returns true if valid, false otherwise
 */
export function isValidProvider(provider: unknown): provider is Provider {
  return (
    typeof provider === "string" &&
    VALID_PROVIDERS.includes(provider as Provider)
  );
}

/**
 * Checks if an error is a "not found" error.
 * This is a more maintainable approach than string matching, though it still
 * relies on error messages. In the future, this could be improved by using
 * specific error types or error codes from the database layer.
 *
 * @param error - The error to check
 * @returns true if the error indicates the resource was not found
 */
export function isNotFoundError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);

  // Check for common "not found" error message patterns
  const notFoundPatterns = [
    "not found",
    "Not found",
    "does not exist",
    "Item not found",
  ];

  return notFoundPatterns.some((pattern) =>
    errorMessage.toLowerCase().includes(pattern.toLowerCase())
  );
}





