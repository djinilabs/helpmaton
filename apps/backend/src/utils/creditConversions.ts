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

