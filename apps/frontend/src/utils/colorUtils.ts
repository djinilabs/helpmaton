/**
 * Color utility functions for consistent color coding across the application.
 * These functions return Tailwind CSS class strings for badges and indicators.
 */

/**
 * Get color classes for token usage ranges
 * @param tokenCount - Number of tokens
 * @returns Tailwind CSS classes for the token range
 */
export const getTokenUsageColor = (tokenCount: number): string => {
  if (tokenCount < 1000) {
    return "bg-success-100 text-success-700 border-success-200 dark:bg-success-900 dark:text-success-300 dark:border-success-700";
  } else if (tokenCount < 10000) {
    return "bg-primary-100 text-primary-700 border-primary-200 dark:bg-primary-900 dark:text-primary-300 dark:border-primary-700";
  } else {
    return "bg-accent-100 text-accent-700 border-accent-200 dark:bg-accent-900 dark:text-accent-300 dark:border-accent-700";
  }
};

/**
 * Get color classes for cost ranges
 * @param costUsd - Cost in USD
 * @returns Tailwind CSS classes for the cost range
 */
export const getCostColor = (costUsd: number): string => {
  if (costUsd < 0.01) {
    return "bg-success-100 text-success-700 border-success-200 dark:bg-success-900 dark:text-success-300 dark:border-success-700";
  } else if (costUsd < 0.1) {
    return "bg-primary-100 text-primary-700 border-primary-200 dark:bg-primary-900 dark:text-primary-300 dark:border-primary-700";
  } else {
    return "bg-accent-100 text-accent-700 border-accent-200 dark:bg-accent-900 dark:text-accent-300 dark:border-accent-700";
  }
};

/**
 * Get color classes for balance levels
 * @param balance - Balance in nano-dollars (will be converted to USD for comparison)
 * @returns Tailwind CSS classes for the balance level
 */
export const getBalanceColor = (balance: number): string => {
  // Convert from nano-dollars to USD
  const balanceUsd = balance / 1_000_000_000;
  
  if (balanceUsd < 0) {
    return "bg-error-100 text-error-700 border-error-200 dark:bg-error-900 dark:text-error-300 dark:border-error-700";
  } else if (balanceUsd < 10) {
    return "bg-error-100 text-error-700 border-error-200 dark:bg-error-900 dark:text-error-300 dark:border-error-700";
  } else if (balanceUsd < 100) {
    return "bg-primary-100 text-primary-700 border-primary-200 dark:bg-primary-900 dark:text-primary-300 dark:border-primary-700";
  } else {
    return "bg-success-100 text-success-700 border-success-200 dark:bg-success-900 dark:text-success-300 dark:border-success-700";
  }
};

/**
 * Get color classes for file size ranges
 * @param bytes - File size in bytes
 * @returns Tailwind CSS classes for the size range
 */
export const getSizeColor = (bytes: number): string => {
  const kb = bytes / 1024;
  const mb = kb / 1024;
  
  if (mb < 0.1) {
    // Less than 100KB
    return "bg-success-100 text-success-700 border-success-200 dark:bg-success-900 dark:text-success-300 dark:border-success-700";
  } else if (mb < 1) {
    // 100KB to 1MB
    return "bg-primary-100 text-primary-700 border-primary-200 dark:bg-primary-900 dark:text-primary-300 dark:border-primary-700";
  } else {
    // Greater than 1MB
    return "bg-accent-100 text-accent-700 border-accent-200 dark:bg-accent-900 dark:text-accent-300 dark:border-accent-700";
  }
};

/**
 * Get color classes for document age/recency
 * @param daysAgo - Number of days since creation/modification
 * @returns Tailwind CSS classes for the age range
 */
export const getAgeColor = (daysAgo: number): string => {
  if (daysAgo < 7) {
    return "bg-success-100 text-success-700 border-success-200 dark:bg-success-900 dark:text-success-300 dark:border-success-700";
  } else if (daysAgo < 30) {
    return "bg-primary-100 text-primary-700 border-primary-200 dark:bg-primary-900 dark:text-primary-300 dark:border-primary-700";
  } else {
    return "bg-neutral-100 text-neutral-700 border-neutral-200 dark:bg-surface-100 dark:text-neutral-300 dark:border-neutral-700";
  }
};

/**
 * Get color classes for percentage values (e.g., similarity scores)
 * @param percent - Percentage value (0-100)
 * @returns Tailwind CSS classes for the percentage range
 */
export const getPercentageColor = (percent: number): string => {
  if (percent >= 80) {
    return "bg-success-100 text-success-700 border-success-200 dark:bg-success-900 dark:text-success-300 dark:border-success-700";
  } else if (percent >= 50) {
    return "bg-primary-100 text-primary-700 border-primary-200 dark:bg-primary-900 dark:text-primary-300 dark:border-primary-700";
  } else if (percent >= 30) {
    return "bg-accent-100 text-accent-700 border-accent-200 dark:bg-accent-900 dark:text-accent-300 dark:border-accent-700";
  } else {
    return "bg-neutral-100 text-neutral-700 border-neutral-200 dark:bg-surface-100 dark:text-neutral-300 dark:border-neutral-700";
  }
};

/**
 * Get color classes for spending limit time frames
 * @param timeFrame - Time frame string ('daily', 'weekly', 'monthly')
 * @returns Tailwind CSS classes for the time frame
 */
export const getTimeFrameColor = (timeFrame: "daily" | "weekly" | "monthly"): string => {
  switch (timeFrame) {
    case "daily":
      return "bg-primary-100 text-primary-700 border-primary-200 dark:bg-primary-900 dark:text-primary-300 dark:border-primary-700";
    case "weekly":
      return "bg-accent-100 text-accent-700 border-accent-200 dark:bg-accent-900 dark:text-accent-300 dark:border-accent-700";
    case "monthly":
      return "bg-success-100 text-success-700 border-success-200 dark:bg-success-900 dark:text-success-300 dark:border-success-700";
    default:
      return "bg-neutral-100 text-neutral-700 border-neutral-200 dark:bg-surface-100 dark:text-neutral-300 dark:border-neutral-700";
  }
};

/**
 * Get color classes for transaction types
 * @param source - Transaction source type
 * @returns Tailwind CSS classes for the transaction type
 */
export const getTransactionTypeColor = (
  source: "embedding-generation" | "text-generation" | "tool-execution" | string
): string => {
  switch (source) {
    case "embedding-generation":
      return "bg-primary-100 text-primary-700 border-primary-200 dark:bg-primary-900 dark:text-primary-300 dark:border-primary-700";
    case "text-generation":
      return "bg-accent-100 text-accent-700 border-accent-200 dark:bg-accent-900 dark:text-accent-300 dark:border-accent-700";
    case "tool-execution":
      return "bg-success-100 text-success-700 border-success-200 dark:bg-success-900 dark:text-success-300 dark:border-success-700";
    default:
      return "bg-neutral-100 text-neutral-700 border-neutral-200 dark:bg-surface-100 dark:text-neutral-300 dark:border-neutral-700";
  }
};

