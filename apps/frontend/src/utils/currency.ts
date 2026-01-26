import type { Currency } from "./api";

/**
 * Convert nano-dollars (integer) to currency units (decimal)
 *
 * @param nanoDollars - Amount in nano-dollars (e.g., 1_500_000_000 for $1.50)
 * @returns Amount in currency units (e.g., 1.50)
 */
export function fromNanoDollars(nanoDollars: number): number {
  return nanoDollars / 1_000_000_000;
}

/**
 * Convert currency units (decimal) to nano-dollars (integer)
 *
 * @param amount - Amount in currency units (e.g., 1.50 for $1.50)
 * @returns Amount in nano-dollars (e.g., 1_500_000_000)
 */
export function toNanoDollars(amount: number): number {
  return Math.ceil(amount * 1_000_000_000);
}

const CURRENCY_SYMBOLS: Record<Currency, string> = {
  usd: "$",
};

/**
 * Format a currency value (in nano-dollars) for display
 * No rounding is applied - displays exact amount by formatting directly from integer
 * Removes trailing zeros for cleaner display
 *
 * @param nanoDollars - Amount in nano-dollars (integer)
 * @param currency - Currency code
 * @param maxDecimals - Maximum number of decimal places to show (default: 12)
 * @returns Formatted currency string (e.g., "$1.5" instead of "$1.5000000000")
 */
export function formatCurrency(
  nanoDollars: number,
  currency: Currency,
  maxDecimals: number = 12
): string {
  const symbol = CURRENCY_SYMBOLS[currency];

  // Handle sign
  const sign = nanoDollars < 0 ? "-" : "";
  const absNanoDollars = Math.abs(nanoDollars);

  // Split into integer and fractional parts using integer division
  // nanoDollars / 1_000_000_000 gives the dollar amount
  // We'll format it by working with the integer directly
  const integerPart = Math.floor(absNanoDollars / 1_000_000_000);
  const fractionalNanoDollars = absNanoDollars % 1_000_000_000;

  // Convert fractional part to a string with up to 9 digits (nano precision)
  // Pad with zeros to 9 digits, then we can show up to maxDecimals
  const fractionalStr = fractionalNanoDollars.toString().padStart(9, "0");

  // Take up to maxDecimals digits from the fractional part
  // If maxDecimals > 9, pad with zeros (though nano has 9 decimal precision)
  const fractionalDisplay = fractionalStr.slice(0, Math.min(maxDecimals, 9));

  // Remove trailing zeros
  const trimmedFractional = fractionalDisplay.replace(/0+$/, "");

  // Format: add decimal point only if there's a fractional part
  const formatted = trimmedFractional
    ? `${integerPart}.${trimmedFractional}`
    : integerPart.toString();

  return `${sign}${symbol}${formatted}`;
}
