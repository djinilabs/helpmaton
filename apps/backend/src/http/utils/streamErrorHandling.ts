import { boomify } from "@hapi/boom";
import type { APIGatewayProxyResultV2 } from "aws-lambda";

import {
  buildConversationErrorInfo,
  updateConversation,
} from "../../utils/conversationLogger";
import { Sentry, ensureError } from "../../utils/sentry";
import { getContextFromRequestId } from "../../utils/workspaceCreditContext";

import { cleanupReservationOnError } from "./generationCreditManagement";
import {
  isByokAuthenticationError,
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
  error: unknown
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);
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
      }
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

/**
 * Persists conversation error to database
 */
export async function persistConversationError(
  context: StreamRequestContext | undefined,
  error: unknown
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
      context.endpointType as "test" | "stream"
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
  llmCallAttempted: boolean
): Promise<boolean> {
  logErrorDetails(error, {
    workspaceId: context.workspaceId,
    agentId: context.agentId,
    usesByok: context.usesByok,
    endpoint: context.endpointType as "test" | "stream",
  });

  const errorToLog = normalizeByokError(error);
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

  // Handle BYOK authentication errors
  if (isByokAuthenticationError(error, context.usesByok)) {
    await persistConversationError(context, errorToLog);
    await writeErrorResponse(
      responseStream,
      new Error(
        "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions."
      )
    );
    return true;
  }

  // Handle credit errors
  const creditErrorResult = await handleCreditErrors(
    error,
    context.workspaceId,
    context.endpointType as "test" | "stream"
  );
  if (creditErrorResult.handled && creditErrorResult.response) {
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
        lambdaContext
      );
    }
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
  responseStream: HttpResponseStream
): Promise<boolean> {
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
  if (isByokAuthenticationError(resultError, context.usesByok)) {
    const errorToLog = normalizeByokError(resultError);
    await persistConversationError(context, errorToLog);
    await writeErrorResponse(
      responseStream,
      new Error(
        "There is a configuration issue with your OpenRouter API key. Please verify that the key is correct and has the necessary permissions."
      )
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
  llmCallAttempted: boolean
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
    context.endpointType as "test" | "stream"
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
        lambdaContext
      );
    }
  }

  return null;
}
