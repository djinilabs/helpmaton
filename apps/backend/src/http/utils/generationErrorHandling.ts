import type { APIGatewayProxyResultV2 } from "aws-lambda";
import type express from "express";

import { sendAgentErrorNotification } from "../../utils/agentErrorNotifications";
import {
  InsufficientCreditsError,
  SpendingLimitExceededError,
} from "../../utils/creditErrors";
import { isAuthenticationError } from "../../utils/handlingErrors";

/**
 * Endpoint type for logging context
 */
export type GenerationEndpoint =
  | "test"
  | "stream"
  | "webhook"
  | "bridge"
  | "scheduled"
  | "knowledge-injection"
  | "memory-extraction"
  | "improve-prompt-from-evals";

/**
 * Checks if an error is a NoOutputGeneratedError
 */
export function isNoOutputError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.constructor.name === "NoOutputGeneratedError" ||
      error.name === "AI_NoOutputGeneratedError" ||
      error.message.includes("No output generated"))
  );
}

/**
 * Constructs an AI_APICallError from a NoOutputGeneratedError for BYOK scenarios
 * This is needed because the original AI_APICallError is often lost when wrapped
 */
export function buildByokError(): Error {
  const originalError = new Error("No cookie auth credentials found");
  originalError.name = "AI_APICallError";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- error structure requires any
  const errorAny = originalError as any;
  errorAny.statusCode = 401;
  errorAny.data = {
    error: {
      code: 401,
      message: "No cookie auth credentials found",
      type: null,
      param: null,
    },
  };
  errorAny.responseBody =
    '{"error":{"message":"No cookie auth credentials found","code":401}}';
  return originalError;
}

/**
 * Normalizes an error for BYOK scenarios - converts NoOutputGeneratedError to AI_APICallError
 */
export function normalizeByokError(error: unknown): unknown {
  if (isNoOutputError(error)) {
    return buildByokError();
  }
  return error;
}

/**
 * Checks if an error is a BYOK authentication error
 */
export function isByokAuthenticationError(
  error: unknown,
  usesByok: boolean,
): boolean {
  if (!usesByok) {
    return false;
  }
  return isAuthenticationError(error) || isNoOutputError(error);
}

/**
 * Returns the BYOK authentication error message
 */
export function getByokErrorMessage(): string {
  return "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions.";
}

/**
 * Handles BYOK authentication errors for Express responses
 */
export function handleByokAuthenticationErrorExpress(
  res: express.Response,
  endpoint: GenerationEndpoint,
): void {
  console.log(`[${endpoint} Handler] BYOK authentication error detected`);
  res.status(400).json({
    error: getByokErrorMessage(),
  });
}

/**
 * Handles BYOK authentication errors for API Gateway responses
 */
export function handleByokAuthenticationErrorApiGateway(
  endpoint: GenerationEndpoint,
): APIGatewayProxyResultV2 {
  console.log(`[${endpoint} Handler] BYOK authentication error detected`);
  return {
    statusCode: 400,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
    body: getByokErrorMessage(),
  };
}

/**
 * Handles credit-related errors (InsufficientCreditsError, SpendingLimitExceededError)
 * Returns sanitized error responses.
 *
 * NOTE: These are expected "user errors" (402) and should not trigger alerts.
 * We only log them at info level.
 */
export async function handleCreditErrors(
  error: unknown,
  workspaceId: string,
  endpoint: GenerationEndpoint,
): Promise<{
  handled: boolean;
  response?: APIGatewayProxyResultV2 | express.Response;
}> {
  if (error instanceof InsufficientCreditsError) {
    console.info(`[${endpoint} Handler] Insufficient credits (user error):`, {
      workspaceId,
      required: error.required,
      available: error.available,
      currency: error.currency,
    });

    await sendAgentErrorNotification(workspaceId, "credit", error);

    return {
      handled: true,
      response: {
        statusCode: 402,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          error:
            "Request could not be completed due to service limits. Please contact your workspace administrator.",
        }),
      } as APIGatewayProxyResultV2,
    };
  }

  if (error instanceof SpendingLimitExceededError) {
    console.info(
      `[${endpoint} Handler] Spending limit exceeded (user error):`,
      {
        workspaceId,
        failedLimits: error.failedLimits,
      },
    );

    await sendAgentErrorNotification(workspaceId, "spendingLimit", error);

    return {
      handled: true,
      response: {
        statusCode: 402,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          error:
            "Request could not be completed due to service limits. Please contact your workspace administrator.",
        }),
      } as APIGatewayProxyResultV2,
    };
  }

  return { handled: false };
}

/**
 * Handles credit-related errors for Express responses
 */
export async function handleCreditErrorsExpress(
  error: unknown,
  workspaceId: string,
  res: express.Response,
  endpoint: GenerationEndpoint,
): Promise<boolean> {
  const result = await handleCreditErrors(error, workspaceId, endpoint);
  if (result.handled && result.response) {
    const response = result.response;
    if (
      typeof response === "object" &&
      response !== null &&
      "statusCode" in response &&
      "body" in response
    ) {
      const statusCode = (response as { statusCode: number }).statusCode;
      const body = (response as { body: string }).body;
      res.status(statusCode).json(JSON.parse(body));
      return true;
    }
  }
  return false;
}

/**
 * Logs comprehensive error details for debugging
 */
export function logErrorDetails(
  error: unknown,
  context: {
    workspaceId?: string;
    agentId?: string;
    usesByok?: boolean;
    endpoint: GenerationEndpoint;
  },
): void {
  console.error(`[${context.endpoint} Handler] Error caught:`, {
    workspaceId: context.workspaceId,
    agentId: context.agentId,
    usesByok: context.usesByok,
    errorType: error instanceof Error ? error.constructor.name : typeof error,
    errorMessage: error instanceof Error ? error.message : String(error),
    errorStack: error instanceof Error ? error.stack : undefined,
    errorKeys: error && typeof error === "object" ? Object.keys(error) : [],
    errorStringified:
      error && typeof error === "object"
        ? JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
        : String(error),
    isAuthenticationError: isAuthenticationError(error),
    errorStatus:
      error && typeof error === "object" && "statusCode" in error
        ? (error as { statusCode?: number }).statusCode
        : error && typeof error === "object" && "status" in error
          ? (error as { status?: number }).status
          : undefined,
    errorCause:
      error instanceof Error && error.cause
        ? error.cause instanceof Error
          ? error.cause.message
          : String(error.cause)
        : undefined,
  });
}
