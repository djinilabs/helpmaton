import { boomify } from "@hapi/boom";

import { fromMillionths } from "./creditConversions";

/**
 * Error thrown when credit balance is insufficient for a transaction
 * All amounts are stored in millionths (integers)
 */
export class InsufficientCreditsError extends Error {
  public readonly statusCode = 402;
  public readonly workspaceId: string;
  public readonly required: number; // millionths
  public readonly available: number; // millionths
  public readonly currency: string;

  constructor(
    workspaceId: string,
    required: number, // millionths
    available: number, // millionths
    currency: string
  ) {
    const requiredDisplay = fromMillionths(required);
    const availableDisplay = fromMillionths(available);
    super(
      `Insufficient credits: required ${requiredDisplay} ${currency.toUpperCase()}, available ${availableDisplay} ${currency.toUpperCase()}`
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
        required: this.required, // Return millionths in API response
        available: this.available, // Return millionths in API response
        currency: this.currency,
      }),
    };
  }
}

/**
 * Error thrown when a spending limit is exceeded
 * All amounts are stored in millionths (integers)
 */
export class SpendingLimitExceededError extends Error {
  public readonly statusCode = 402;
  public readonly failedLimits: Array<{
    scope: "workspace" | "agent";
    timeFrame: string;
    limit: number; // millionths
    current: number; // millionths
  }>;

  constructor(
    failedLimits: Array<{
      scope: "workspace" | "agent";
      timeFrame: string;
      limit: number; // millionths
      current: number; // millionths
    }>
  ) {
    const limitMessages = failedLimits.map(
      (limit) =>
        `${limit.scope} ${limit.timeFrame} limit: ${fromMillionths(limit.current)}/${fromMillionths(limit.limit)}`
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
        failedLimits: this.failedLimits, // Return millionths in API response
      }),
    };
  }
}

/**
 * Error thrown when credit deduction fails after retries
 */
export class CreditDeductionError extends Error {
  public readonly workspaceId: string;
  public readonly retries: number;

  constructor(workspaceId: string, retries: number, originalError?: Error) {
    super(
      `Failed to deduct credits after ${retries} retries: ${originalError?.message || "Unknown error"}`
    );
    this.name = "CreditDeductionError";
    this.workspaceId = workspaceId;
    this.retries = retries;
    this.cause = originalError;
  }
}

