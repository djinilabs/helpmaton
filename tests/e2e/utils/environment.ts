import { e2eConfig } from "../config/env";

/**
 * Detects if tests are running in a PR environment
 * PR environments have URLs in the form https://{number}.helpmaton.com
 */
export function isPREnvironment(): boolean {
  const baseUrl = process.env.BASE_URL || e2eConfig.app.baseUrl;

  // PR environments use URLs like https://12.helpmaton.com (where 12 is the PR number)
  const prUrlPattern = /^https:\/\/(\d+)\.helpmaton\.com$/;
  return prUrlPattern.test(baseUrl);
}

/**
 * Detects if tests are running in production environment
 * Production environment is always https://app.helpmaton.com
 */
export function isProductionEnvironment(): boolean {
  const baseUrl = process.env.BASE_URL || e2eConfig.app.baseUrl;

  return baseUrl === "https://app.helpmaton.com";
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
 * Billing tests should only run in non-production environments
 * (production is https://app.helpmaton.com)
 */
export function shouldRunBillingTests(): boolean {
  // Never run billing tests in production
  if (isProductionEnvironment()) {
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
