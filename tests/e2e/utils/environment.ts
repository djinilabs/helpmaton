import { e2eConfig } from "../config/env";

/**
 * Detects if tests are running in a PR environment
 * PR environments have unique CloudFront URLs
 */
export function isPREnvironment(): boolean {
  const baseUrl = process.env.BASE_URL || e2eConfig.app.baseUrl;

  // PR environments use CloudFront URLs or have 'pr-' prefix
  return baseUrl.includes("pr-") || baseUrl.includes("cloudfront.net");
}

/**
 * Detects if tests are running in production environment
 */
export function isProductionEnvironment(): boolean {
  const baseUrl = process.env.BASE_URL || e2eConfig.app.baseUrl;

  // Production uses the main domain without pr- prefix
  return (
    !baseUrl.includes("pr-") &&
    !baseUrl.includes("localhost") &&
    !baseUrl.includes("127.0.0.1")
  );
}

/**
 * Detects if tests are running locally
 */
export function isLocalEnvironment(): boolean {
  const baseUrl = process.env.BASE_URL || e2eConfig.app.baseUrl;

  return baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");
}

/**
 * Determines if billing tests should run
 * Billing tests should only run in PR environments with Lemon Squeezy test mode
 */
export function shouldRunBillingTests(): boolean {
  // Only run billing tests in PR environments
  if (!isPREnvironment()) {
    return false;
  }

  // Check if billing test mode is explicitly enabled
  return process.env.E2E_BILLING_TEST_MODE === "true";
}

/**
 * Get the current environment name
 */
export function getEnvironmentName(): string {
  if (isLocalEnvironment()) return "local";
  if (isPREnvironment()) return "pr";
  if (isProductionEnvironment()) return "production";
  return "unknown";
}

/**
 * Get the base URL for the current environment
 */
export function getBaseUrl(): string {
  return process.env.BASE_URL || e2eConfig.app.baseUrl;
}
