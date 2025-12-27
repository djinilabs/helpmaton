/**
 * Credit conversion utilities
 * 
 * Credits are stored as integers representing millionths of a currency unit.
 * This eliminates floating-point precision issues.
 * 
 * Examples:
 * - 1.00 USD = 1_000_000 millionths
 * - 0.50 USD = 500_000 millionths
 * - 0.000001 USD = 1 millionth
 */

/**
 * Convert currency units to millionths (for storage/API)
 * Always rounds up to ensure we never undercharge
 * 
 * @param amount - Amount in currency units (e.g., 1.50 for $1.50)
 * @returns Amount in millionths (e.g., 1_500_000)
 */
export function toMillionths(amount: number): number {
  return Math.ceil(amount * 1_000_000);
}

/**
 * Convert millionths to currency units (for display/logging)
 * 
 * @param millionths - Amount in millionths (e.g., 1_500_000)
 * @returns Amount in currency units (e.g., 1.50)
 */
export function fromMillionths(millionths: number): number {
  return millionths / 1_000_000;
}

/**
 * Format millionths as a readable currency string for transaction descriptions
 * Currently only supports USD currency symbol
 * 
 * @param millionths - Amount in millionths (e.g., 1_500_000)
 * @param decimals - Number of decimal places to show (default: 10)
 * @returns Formatted currency string (e.g., "$1.50" or "$0.000123")
 */
export function formatCurrencyMillionths(
  millionths: number,
  decimals: number = 10
): string {
  const amount = fromMillionths(millionths);
  // Round to nearest for accurate display
  const multiplier = Math.pow(10, decimals);
  const roundedAmount = Math.round(amount * multiplier) / multiplier;
  // Format with specified decimals, then remove trailing zeros and optional decimal point
  const formatted = roundedAmount.toFixed(decimals).replace(/\.?0+$/, "");
  return `$${formatted}`;
}

