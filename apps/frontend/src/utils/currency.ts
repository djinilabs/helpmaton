import type { Currency } from "./api";

/**
 * Convert millionths (integer) to currency units (decimal)
 *
 * @param millionths - Amount in millionths (e.g., 1_500_000 for $1.50)
 * @returns Amount in currency units (e.g., 1.50)
 */
export function fromMillionths(millionths: number): number {
  return millionths / 1_000_000;
}

/**
 * Convert currency units (decimal) to millionths (integer)
 *
 * @param amount - Amount in currency units (e.g., 1.50 for $1.50)
 * @returns Amount in millionths (e.g., 1_500_000)
 */
export function toMillionths(amount: number): number {
  return Math.ceil(amount * 1_000_000);
}

const CURRENCY_SYMBOLS: Record<Currency, string> = {
  usd: "$",
};

/**
 * Format a currency value (in millionths) for display
 * Uses standard rounding (rounds to nearest) for accurate display
 * Removes trailing zeros for cleaner display
 *
 * @param millionths - Amount in millionths
 * @param currency - Currency code
 * @param decimals - Number of decimal places (default: 10)
 * @returns Formatted currency string (e.g., "$1.5" instead of "$1.5000000000")
 */
export function formatCurrency(
  millionths: number,
  currency: Currency,
  decimals: number = 10
): string {
  const symbol = CURRENCY_SYMBOLS[currency];
  const amount = fromMillionths(millionths);
  // Round to nearest for accurate display
  const multiplier = Math.pow(10, decimals);
  const roundedAmount = Math.round(amount * multiplier) / multiplier;
  // Format with specified decimals, then remove trailing zeros and optional decimal point
  return `${symbol}${roundedAmount.toFixed(decimals).replace(/\.?0+$/, "")}`;
}
