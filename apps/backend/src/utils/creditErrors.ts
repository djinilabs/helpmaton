import { boomify } from "@hapi/boom";

import { fromNanoDollars } from "./creditConversions";

/**
 * Error thrown when credit balance is insufficient for a transaction
 * All amounts are stored in nano-dollars (integers)
 */
export class InsufficientCreditsError extends Error {
  public readonly statusCode = 402;
  public readonly workspaceId: string;
  public readonly required: number; // nano-dollars
  public readonly available: number; // nano-dollars
  public readonly currency: string;

  constructor(
    workspaceId: string,
    required: number, // nano-dollars
    available: number, // nano-dollars
    currency: string,
  ) {
    const requiredDisplay = fromNanoDollars(required);
    const availableDisplay = fromNanoDollars(available);
    super(
      `Insufficient credits: required ${requiredDisplay} ${currency.toUpperCase()}, available ${availableDisplay} ${currency.toUpperCase()}`,
    );
    this.name = "InsufficientCreditsError";
    this.workspaceId = workspaceId;
    this.required = required;
    this.available = available;
    this.currency = currency;
  }

  /**
   * Convert to HTTP response format
   */
  toHTTPResponse() {
    const error = boomify(this, { statusCode: this.statusCode });
    return {
      statusCode: error.output.statusCode,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        error: this.message,
        workspaceId: this.workspaceId,
        required: this.required, // Return nano-dollars in API response
        available: this.available, // Return nano-dollars in API response
        currency: this.currency,
      }),
    };
  }
}

/**
 * Error thrown when a spending limit is exceeded
 * All amounts are stored in nano-dollars (integers)
 */
export class SpendingLimitExceededError extends Error {
  public readonly statusCode = 402;
  public readonly failedLimits: Array<{
    scope: "workspace" | "agent";
    timeFrame: string;
    limit: number; // nano-dollars
    current: number; // nano-dollars
  }>;

  constructor(
    failedLimits: Array<{
      scope: "workspace" | "agent";
      timeFrame: string;
      limit: number; // nano-dollars
      current: number; // nano-dollars
    }>,
  ) {
    const limitMessages = failedLimits.map(
      (limit) =>
        `${limit.scope} ${limit.timeFrame} limit: ${fromNanoDollars(limit.current)}/${fromNanoDollars(limit.limit)}`,
    );
    super(`Spending limits exceeded: ${limitMessages.join(", ")}`);
    this.name = "SpendingLimitExceededError";
    this.failedLimits = failedLimits;
  }

  /**
   * Convert to HTTP response format
   */
  toHTTPResponse() {
    const error = boomify(this, { statusCode: this.statusCode });
    return {
      statusCode: error.output.statusCode,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        error: this.message,
        failedLimits: this.failedLimits, // Return nano-dollars in API response
      }),
    };
  }
}

export type CreditUserError =
  | InsufficientCreditsError
  | SpendingLimitExceededError;

export function isCreditUserError(error: unknown): error is CreditUserError {
  if (!error || typeof error !== "object") {
    return false;
  }

  if (
    error instanceof InsufficientCreditsError ||
    error instanceof SpendingLimitExceededError
  ) {
    return true;
  }

  const name = "name" in error ? String(error.name) : "";
  return (
    name === "InsufficientCreditsError" || name === "SpendingLimitExceededError"
  );
}

/**
 * Error thrown when credit deduction fails after retries
 */
export class CreditDeductionError extends Error {
  public readonly workspaceId: string;
  public readonly retries: number;

  constructor(workspaceId: string, retries: number, originalError?: Error) {
    super(
      `Failed to deduct credits after ${retries} retries: ${originalError?.message || "Unknown error"}`,
    );
    this.name = "CreditDeductionError";
    this.workspaceId = workspaceId;
    this.retries = retries;
    this.cause = originalError;
  }
}
