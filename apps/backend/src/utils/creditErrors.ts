import { boomify } from "@hapi/boom";

/**
 * Error thrown when credit balance is insufficient for a transaction
 */
export class InsufficientCreditsError extends Error {
  public readonly statusCode = 402;
  public readonly workspaceId: string;
  public readonly required: number;
  public readonly available: number;
  public readonly currency: string;

  constructor(
    workspaceId: string,
    required: number,
    available: number,
    currency: string
  ) {
    super(
      `Insufficient credits: required ${required} ${currency.toUpperCase()}, available ${available} ${currency.toUpperCase()}`
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
        required: this.required,
        available: this.available,
        currency: this.currency,
      }),
    };
  }
}

/**
 * Error thrown when a spending limit is exceeded
 */
export class SpendingLimitExceededError extends Error {
  public readonly statusCode = 402;
  public readonly failedLimits: Array<{
    scope: "workspace" | "agent";
    timeFrame: string;
    limit: number;
    current: number;
  }>;

  constructor(
    failedLimits: Array<{
      scope: "workspace" | "agent";
      timeFrame: string;
      limit: number;
      current: number;
    }>
  ) {
    const limitMessages = failedLimits.map(
      (limit) =>
        `${limit.scope} ${limit.timeFrame} limit: ${limit.current}/${limit.limit}`
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
        failedLimits: this.failedLimits,
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

