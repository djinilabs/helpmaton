import { boomify } from "@hapi/boom";
import type { APIGatewayProxyResultV2 } from "aws-lambda";

import {
  buildConversationErrorInfo,
  extractErrorMessage,
  updateConversation,
} from "../../utils/conversationLogger";
import { isCreditUserError } from "../../utils/creditErrors";
import { Sentry, ensureError } from "../../utils/sentry";
import { getContextFromRequestId } from "../../utils/workspaceCreditContext";

import { cleanupReservationOnError } from "./generationCreditManagement";
import {
  isByokAuthenticationError,
  isNoOutputError,
  normalizeByokError,
  logErrorDetails,
  handleCreditErrors,
} from "./generationErrorHandling";
import type { StreamRequestContext } from "./streamRequestContext";
import {
  writeChunkToStream,
  type HttpResponseStream,
} from "./streamResponseStream";

/**
 * Writes an error response to the stream in SSE format (ai-sdk format)
 */
export async function writeErrorResponse(
  responseStream: HttpResponseStream,
  error: unknown,
): Promise<void> {
  const errorMessage = extractErrorMessage(error);
  // Boomify the original error to check if it's a server error
  const boomed = boomify(ensureError(error));
  const errorChunk = `data: ${JSON.stringify({
    type: "error",
    errorText: errorMessage,
  })}\n\n`;

  try {
    await writeChunkToStream(responseStream, errorChunk);
    try {
      responseStream.end();
    } catch (endError) {
      // Stream might already be ended - only log to Sentry if original error was server error
      if (boomed.isServer) {
        Sentry.captureException(ensureError(endError), {
          tags: {
            context: "stream-error-handling",
            operation: "end-stream-after-error-write",
          },
          extra: {
            originalError: errorMessage,
          },
        });
      }
    }
  } catch (writeError) {
    console.error(
      "[Stream Handler] Error writing error response (stream may already be ended):",
      {
        writeError:
          writeError instanceof Error ? writeError.message : String(writeError),
        originalError: errorMessage,
      },
    );
    // Only send to Sentry if the original error was a server error
    if (boomed.isServer) {
      Sentry.captureException(ensureError(writeError), {
        tags: {
          context: "stream-error-handling",
          operation: "write-error-response",
        },
        extra: {
          originalError: errorMessage,
        },
      });
    }
    try {
      responseStream.end();
    } catch (endError) {
      // Stream already ended - only log to Sentry if original error was server error
      if (boomed.isServer) {
        Sentry.captureException(ensureError(endError), {
          tags: {
            context: "stream-error-handling",
            operation: "end-stream-after-write-error",
          },
          extra: {
            writeError:
              writeError instanceof Error
                ? writeError.message
                : String(writeError),
            originalError: errorMessage,
          },
        });
      }
    }
  }
}

const AI_ERROR_NAME_MARKERS = ["AI_", "APICallError", "NoOutputGeneratedError"];

const isAiSdkError = (error: unknown): boolean => {
  if (isNoOutputError(error)) {
    return true;
  }
  if (error instanceof Error) {
    const name = error.name || error.constructor.name;
    if (AI_ERROR_NAME_MARKERS.some((marker) => name.includes(marker))) {
      return true;
    }
    if (error.cause instanceof Error) {
      const causeName = error.cause.name || error.cause.constructor.name;
      if (AI_ERROR_NAME_MARKERS.some((marker) => causeName.includes(marker))) {
        return true;
      }
    }
  }
  return false;
};

/**
 * Persists conversation error to database
 */
export async function persistConversationError(
  context: StreamRequestContext | undefined,
  error: unknown,
): Promise<void> {
  if (!context) return;

  try {
    const errorInfo = buildConversationErrorInfo(error, {
      provider: "openrouter",
      modelName: context.finalModelName,
      endpoint: context.endpointType,
      metadata: {
        usesByok: context.usesByok,
      },
    });

    await updateConversation(
      context.db,
      context.workspaceId,
      context.agentId,
      context.conversationId,
      context.convertedMessages ?? [],
      undefined,
      context.usesByok,
      errorInfo,
      context.awsRequestId,
      context.endpointType as "test" | "stream",
    );
  } catch (logError) {
    console.error("[Stream Handler] Failed to persist conversation error:", {
      originalError: error instanceof Error ? error.message : String(error),
      logError: logError instanceof Error ? logError.message : String(logError),
      workspaceId: context.workspaceId,
      agentId: context.agentId,
      conversationId: context.conversationId,
    });
    Sentry.captureException(ensureError(logError), {
      tags: {
        context: "stream-error-handling",
        operation: "persist-conversation-error",
      },
      extra: {
        workspaceId: context.workspaceId,
        agentId: context.agentId,
        conversationId: context.conversationId,
        originalError: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

/**
 * Handles errors during streaming execution
 * Returns true if error was handled and response was written, false otherwise
 */
export async function handleStreamingError(
  error: unknown,
  context: StreamRequestContext,
  responseStream: HttpResponseStream,
  llmCallAttempted: boolean,
): Promise<boolean> {
  logErrorDetails(error, {
    workspaceId: context.workspaceId,
    agentId: context.agentId,
    usesByok: context.usesByok,
    endpoint: context.endpointType as "test" | "stream",
  });

  const errorToLog = normalizeByokError(error);
  const creditUserError =
    isCreditUserError(error) || isCreditUserError(errorToLog);

  // Credit errors are expected user errors (402) and should not create Sentry noise.
  // All other errors (including BYOK auth/config issues) should still be captured.
  if (!creditUserError) {
    Sentry.captureException(ensureError(errorToLog), {
      tags: {
        context: "stream-error-handling",
        operation: "handle-stream-error",
        endpoint: context.endpointType,
      },
      extra: {
        workspaceId: context.workspaceId,
        agentId: context.agentId,
        conversationId: context.conversationId,
      },
      level: "warning",
    });
  }

  // Handle BYOK authentication errors
  if (isByokAuthenticationError(error, context.usesByok)) {
    await persistConversationError(context, errorToLog);
    await writeErrorResponse(
      responseStream,
      new Error(
        "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions.",
      ),
    );
    return true;
  }

  // Handle credit errors
  const creditErrorResult = await handleCreditErrors(
    error,
    context.workspaceId,
    context.endpointType as "test" | "stream",
  );
  if (creditErrorResult.handled && creditErrorResult.response) {
    console.info(
      "[Stream Handler] Credit user error (not reported to Sentry):",
      {
        workspaceId: context.workspaceId,
        agentId: context.agentId,
        conversationId: context.conversationId,
        endpoint: context.endpointType,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : String(error),
      },
    );
    await persistConversationError(context, error);
    const response = creditErrorResult.response;
    if (
      typeof response === "object" &&
      response !== null &&
      "body" in response
    ) {
      const body = JSON.parse((response as { body: string }).body);
      await writeErrorResponse(responseStream, new Error(body.error));
      return true;
    }
  }

  // Cleanup reservation on error
  if (context.reservationId && context.reservationId !== "byok") {
    const lambdaContext = getContextFromRequestId(context.awsRequestId);
    if (lambdaContext) {
      await cleanupReservationOnError(
        context.db,
        context.reservationId,
        context.workspaceId,
        context.agentId,
        "openrouter",
        context.finalModelName,
        error,
        llmCallAttempted,
        context.usesByok,
        context.endpointType as "test" | "stream",
        lambdaContext,
      );
    }
  }

  if (isAiSdkError(error)) {
    await persistConversationError(context, error);
    await writeErrorResponse(responseStream, error);
    return true;
  }

  return false;
}

/**
 * Handles errors during result extraction
 * Returns true if error was handled and response was written, false otherwise
 * Always ensures the stream is ended before returning
 */
export async function handleResultExtractionError(
  resultError: unknown,
  context: StreamRequestContext,
  responseStream: HttpResponseStream,
): Promise<boolean> {
  if (isCreditUserError(resultError)) {
    console.info(
      "[Stream Handler] Credit user error during result extraction (not reported to Sentry):",
      {
        workspaceId: context.workspaceId,
        agentId: context.agentId,
        conversationId: context.conversationId,
        endpoint: context.endpointType,
        error:
          resultError instanceof Error
            ? { name: resultError.name, message: resultError.message }
            : String(resultError),
      },
    );
  } else {
    Sentry.captureException(ensureError(resultError), {
      tags: {
        context: "stream-error-handling",
        operation: "result-extraction",
        endpoint: context.endpointType,
      },
      extra: {
        workspaceId: context.workspaceId,
        agentId: context.agentId,
        conversationId: context.conversationId,
      },
      level: "warning",
    });
  }
  if (isByokAuthenticationError(resultError, context.usesByok)) {
    const errorToLog = normalizeByokError(resultError);
    await persistConversationError(context, errorToLog);
    await writeErrorResponse(
      responseStream,
      new Error(
        "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions.",
      ),
    );
    return true;
  }
  await persistConversationError(context, resultError);
  // Write error response and end stream before returning false
  // This ensures the stream is always properly closed
  await writeErrorResponse(responseStream, resultError);
  return true; // Changed to true since we handled it by writing error and ending stream
}

/**
 * Handles errors and returns appropriate API Gateway response
 */
export async function handleStreamingErrorForApiGateway(
  error: unknown,
  context: StreamRequestContext,
  responseHeaders: Record<string, string>,
  llmCallAttempted: boolean,
): Promise<APIGatewayProxyResultV2 | null> {
  logErrorDetails(error, {
    workspaceId: context.workspaceId,
    agentId: context.agentId,
    usesByok: context.usesByok,
    endpoint: context.endpointType as "test" | "stream",
  });

  const errorToLog = normalizeByokError(error);

  // Handle BYOK authentication errors
  if (isByokAuthenticationError(error, context.usesByok)) {
    await persistConversationError(context, errorToLog);
    return {
      statusCode: 400,
      headers: responseHeaders,
      body: JSON.stringify({
        error:
          "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions.",
      }),
    };
  }

  // Handle credit errors
  const creditErrorResult = await handleCreditErrors(
    error,
    context.workspaceId,
    context.endpointType as "test" | "stream",
  );
  if (creditErrorResult.handled && creditErrorResult.response) {
    await persistConversationError(context, error);
    const response = creditErrorResult.response;
    if (
      typeof response === "object" &&
      response !== null &&
      "body" in response
    ) {
      return {
        statusCode: (response as { statusCode?: number }).statusCode || 400,
        headers: responseHeaders,
        body: (response as { body: string }).body,
      };
    }
  }

  // Cleanup reservation on error
  if (context.reservationId && context.reservationId !== "byok") {
    const lambdaContext = getContextFromRequestId(context.awsRequestId);
    if (lambdaContext) {
      await cleanupReservationOnError(
        context.db,
        context.reservationId,
        context.workspaceId,
        context.agentId,
        "openrouter",
        context.finalModelName,
        error,
        llmCallAttempted,
        context.usesByok,
        context.endpointType as "test" | "stream",
        lambdaContext,
      );
    }
  }

  const errorInfo = buildConversationErrorInfo(error, {
    provider: "openrouter",
    modelName: context.finalModelName,
    endpoint: context.endpointType,
    metadata: {
      usesByok: context.usesByok,
    },
  });
  const shouldReturnClientError =
    isAiSdkError(error) ||
    (typeof errorInfo.statusCode === "number" &&
      errorInfo.statusCode >= 400 &&
      errorInfo.statusCode < 500);

  if (shouldReturnClientError) {
    await persistConversationError(context, error);
    return {
      statusCode: errorInfo.statusCode ?? 400,
      headers: {
        ...responseHeaders,
        "Content-Type": "text/plain; charset=utf-8",
      },
      body: errorInfo.message,
    };
  }

  return null;
}
