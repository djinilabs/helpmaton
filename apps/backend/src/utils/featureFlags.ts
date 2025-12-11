/**
 * Feature flags for temporarily disabling credit and spending limit checks
 * 
 * These flags can be controlled via environment variables:
 * - ENABLE_CREDIT_VALIDATION: Enable/disable credit balance checks before agent interactions (default: true)
 * - ENABLE_CREDIT_DEDUCTION: Enable/disable credit deduction after agent interactions (default: true)
 * - ENABLE_SPENDING_LIMIT_CHECKS: Enable/disable spending limit checks (default: true)
 * 
 * To disable these features during deployment, set the corresponding environment variable to "false".
 * These should be re-enabled after deployment is complete.
 */

/**
 * Check if credit validation is enabled
 * @returns true if enabled, false if disabled
 */
export function isCreditValidationEnabled(): boolean {
  const envValue = process.env.ENABLE_CREDIT_VALIDATION;
  if (envValue === undefined) {
    return true; // Default to enabled
  }
  return envValue.toLowerCase() === "true";
}

/**
 * Check if credit deduction is enabled
 * @returns true if enabled, false if disabled
 */
export function isCreditDeductionEnabled(): boolean {
  const envValue = process.env.ENABLE_CREDIT_DEDUCTION;
  if (envValue === undefined) {
    return true; // Default to enabled
  }
  return envValue.toLowerCase() === "true";
}

/**
 * Check if spending limit checks are enabled
 * @returns true if enabled, false if disabled
 */
export function isSpendingLimitChecksEnabled(): boolean {
  const envValue = process.env.ENABLE_SPENDING_LIMIT_CHECKS;
  if (envValue === undefined) {
    return true; // Default to enabled
  }
  return envValue.toLowerCase() === "true";
}

