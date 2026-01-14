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
 * No rounding is applied - displays exact amount by formatting directly from integer
 * Removes trailing zeros for cleaner display
 *
 * @param millionths - Amount in millionths (integer)
 * @param currency - Currency code
 * @param maxDecimals - Maximum number of decimal places to show (default: 10)
 * @returns Formatted currency string (e.g., "$1.5" instead of "$1.5000000000")
 */
export function formatCurrency(
  millionths: number,
  currency: Currency,
  maxDecimals: number = 10
): string {
  const symbol = CURRENCY_SYMBOLS[currency];

  // Handle sign
  const sign = millionths < 0 ? "-" : "";
  const absMillionths = Math.abs(millionths);

  // Split into integer and fractional parts using integer division
  // millionths / 1_000_000 gives the dollar amount
  // We'll format it by working with the integer directly
  const integerPart = Math.floor(absMillionths / 1_000_000);
  const fractionalMillionths = absMillionths % 1_000_000;

  // Convert fractional part to a string with up to 6 digits (millionths precision)
  // Pad with zeros to 6 digits, then we can show up to maxDecimals
  const fractionalStr = fractionalMillionths.toString().padStart(6, "0");

  // Take up to maxDecimals digits from the fractional part
  // If maxDecimals > 6, pad with zeros (though millionths only has 6 decimal precision)
  const fractionalDisplay = fractionalStr.slice(0, Math.min(maxDecimals, 6));

  // Remove trailing zeros
  const trimmedFractional = fractionalDisplay.replace(/0+$/, "");

  // Format: add decimal point only if there's a fractional part
  const formatted = trimmedFractional
    ? `${integerPart}.${trimmedFractional}`
    : integerPart.toString();

  return `${sign}${symbol}${formatted}`;
}
