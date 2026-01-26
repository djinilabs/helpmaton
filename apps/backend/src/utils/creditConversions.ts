/**
 * Credit conversion utilities
 * 
 * Credits are stored as integers representing nano-dollars (billionths of a currency unit).
 * This eliminates floating-point precision issues.
 * 
 * Examples:
 * - 1.00 USD = 1_000_000_000 nano-dollars
 * - 0.50 USD = 500_000_000 nano-dollars
 * - 0.000000001 USD = 1 nano-dollar
 */

/**
 * Convert currency units to nano-dollars (for storage/API)
 * Always rounds up to ensure we never undercharge
 * 
 * @param amount - Amount in currency units (e.g., 1.50 for $1.50)
 * @returns Amount in nano-dollars (e.g., 1_500_000_000)
 */
export function toNanoDollars(amount: number): number {
  return Math.ceil(amount * 1_000_000_000);
}

/**
 * Convert nano-dollars to currency units (for display/logging)
 * 
 * @param nanoDollars - Amount in nano-dollars (e.g., 1_500_000_000)
 * @returns Amount in currency units (e.g., 1.50)
 */
export function fromNanoDollars(nanoDollars: number): number {
  return nanoDollars / 1_000_000_000;
}

/**
 * Format nano-dollars as a readable currency string for transaction descriptions
 * Currently only supports USD currency symbol
 * No rounding is applied - displays exact amount by formatting directly from integer
 * 
 * @param nanoDollars - Amount in nano-dollars (e.g., 1_500_000_000)
 * @param maxDecimals - Maximum number of decimal places to show (default: 12)
 * @returns Formatted currency string (e.g., "$1.50" or "$0.000123")
 */
export function formatCurrencyNanoDollars(
  nanoDollars: number,
  maxDecimals: number = 12
): string {
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
  
  return `${sign}$${formatted}`;
}

