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
 * No rounding is applied - displays exact amount by formatting directly from integer
 * 
 * @param millionths - Amount in millionths (e.g., 1_500_000)
 * @param maxDecimals - Maximum number of decimal places to show (default: 10)
 * @returns Formatted currency string (e.g., "$1.50" or "$0.000123")
 */
export function formatCurrencyMillionths(
  millionths: number,
  maxDecimals: number = 10
): string {
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
  
  return `${sign}$${formatted}`;
}

