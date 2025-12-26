import { randomUUID } from "crypto";

import type { UIMessage } from "../http/post-api-workspaces-000workspaceId-agents-000agentId-test/utils/types";
import type { DatabaseSchema } from "../tables/schema";

import { writeToWorkingMemory } from "./memory/writeMemory";
import { calculateConversationCosts } from "./tokenAccounting";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number; // Reasoning tokens (if model supports reasoning)
  cachedPromptTokens?: number; // Cached prompt tokens (if prompt caching is used)
}

export interface ConversationErrorInfo {
  message: string;
  name?: string;
  stack?: string;
  code?: string;
  statusCode?: number;
  provider?: string;
  modelName?: string;
  endpoint?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ConversationLogData {
  workspaceId: string;
  agentId: string;
  conversationId: string;
  conversationType: "test" | "webhook" | "stream";
  messages: UIMessage[];
  tokenUsage?: TokenUsage;
  usesByok?: boolean;
  error?: ConversationErrorInfo;
  awsRequestId?: string; // AWS Lambda/API Gateway request ID for this message addition
}

/**
 * Calculate TTL timestamp (30 days from now in seconds)
 */
export function calculateTTL(): number {
  return Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
}

/**
 * Build a serializable error payload for conversation records
 * Extracts detailed error information including wrapped errors and cause chains
 */
export function buildConversationErrorInfo(
  error: unknown,
  options?: {
    provider?: string;
    modelName?: string;
    endpoint?: string;
    metadata?: Record<string, unknown>;
  }
): ConversationErrorInfo {
  // Log initial error for debugging
  console.log("[buildConversationErrorInfo] Starting error extraction:", {
    errorType: error instanceof Error ? error.constructor.name : typeof error,
    errorName: error instanceof Error ? error.name : "N/A",
    errorMessage: error instanceof Error ? error.message : String(error),
    hasCause: error instanceof Error && !!error.cause,
    causeType:
      error instanceof Error && error.cause instanceof Error
        ? error.cause.constructor.name
        : undefined,
    causeMessage:
      error instanceof Error && error.cause instanceof Error
        ? error.cause.message
        : undefined,
  });

  // Check if this is a NoOutputGeneratedError or similar wrapper
  const isGenericWrapper = (err: Error): boolean => {
    const name = err.name.toLowerCase();
    const msg = err.message.toLowerCase();
    return (
      name.includes("nooutputgeneratederror") ||
      name.includes("no_output_generated_error") ||
      msg.includes("no output generated") ||
      msg.includes("check the stream for errors")
    );
  };

  // Extract the most specific error message possible
  let message = error instanceof Error ? error.message : String(error);
  let specificError: Error | undefined =
    error instanceof Error ? error : undefined;

  console.log("[buildConversationErrorInfo] Initial message:", message);

  // Comprehensive error extraction - check all possible locations for the real error message
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extractFromError = (err: any): string | undefined => {
    if (!err || typeof err !== "object") return undefined;

    // 1. Check data.error.message (AI SDK errors - most common location)
    // This is the PRIMARY source for AI_APICallError and similar errors
    if (
      err.data?.error?.message &&
      typeof err.data.error.message === "string" &&
      err.data.error.message.length > 0
    ) {
      return err.data.error.message;
    }

    // 2. Check responseBody (parsed JSON)
    if (err.responseBody && typeof err.responseBody === "string") {
      try {
        const body = JSON.parse(err.responseBody) as Record<string, unknown>;
        if (body.error) {
          if (typeof body.error === "object" && body.error !== null) {
            const errorObj = body.error as Record<string, unknown>;
            if (
              typeof errorObj.message === "string" &&
              errorObj.message.length > 0
            ) {
              return errorObj.message;
            }
          } else if (typeof body.error === "string" && body.error.length > 0) {
            return body.error;
          }
        }
        if (typeof body.message === "string" && body.message.length > 0) {
          return body.message;
        }
      } catch {
        // Not JSON, ignore
      }
    }

    // 3. Check response.data.error.message (HTTP errors)
    if (
      err.response?.data?.error?.message &&
      typeof err.response.data.error.message === "string" &&
      err.response.data.error.message.length > 0
    ) {
      return err.response.data.error.message;
    }

    // 4. Check data.message directly
    if (
      err.data?.message &&
      typeof err.data.message === "string" &&
      err.data.message.length > 0
    ) {
      return err.data.message;
    }

    return undefined;
  };

  // CRITICAL: Check if this is a wrapper error first
  // If it is, the real error with data.error.message is likely in error.cause
  const isWrapper = error instanceof Error && isGenericWrapper(error);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errorAny = error instanceof Error ? (error as any) : undefined;

  // Log error structure
  console.log("[buildConversationErrorInfo] Error structure check:", {
    isWrapper,
    hasData: !!errorAny?.data,
    hasDataError: !!errorAny?.data?.error,
    hasDataErrorMessage: !!errorAny?.data?.error?.message,
    dataErrorMessage: errorAny?.data?.error?.message,
    hasResponseBody: !!errorAny?.responseBody,
    responseBody: errorAny?.responseBody
      ? typeof errorAny.responseBody === "string"
        ? errorAny.responseBody.substring(0, 200)
        : String(errorAny.responseBody).substring(0, 200)
      : undefined,
    statusCode: errorAny?.statusCode,
    hasCause: error instanceof Error && !!error.cause,
  });

  // If it's a wrapper, check the cause's data.error.message FIRST (this is where the real error is)
  if (isWrapper && error instanceof Error && error.cause) {
     
    const causeAny =
      error.cause instanceof Error ? (error.cause as any) : undefined;
    console.log(
      "[buildConversationErrorInfo] Wrapper detected - checking cause's data.error.message:",
      {
        causeType:
          error.cause instanceof Error
            ? error.cause.constructor.name
            : typeof error.cause,
        hasCauseData: !!causeAny?.data,
        hasCauseDataError: !!causeAny?.data?.error,
        hasCauseDataErrorMessage: !!causeAny?.data?.error?.message,
        causeDataErrorMessage: causeAny?.data?.error?.message,
      }
    );

    if (
      causeAny?.data?.error?.message &&
      typeof causeAny.data.error.message === "string" &&
      causeAny.data.error.message.length > 0
    ) {
      // Found it! Use the cause's data.error.message
      message = causeAny.data.error.message;
      specificError = error.cause instanceof Error ? error.cause : undefined;
      console.log(
        "[buildConversationErrorInfo] Found message from cause's data.error.message:",
        message
      );
    } else {
      // Check cause's responseBody
      const causeResponseBodyMsg = extractFromError(error.cause);
      if (causeResponseBodyMsg) {
        message = causeResponseBodyMsg;
        specificError = error.cause instanceof Error ? error.cause : undefined;
        console.log(
          "[buildConversationErrorInfo] Found message from cause's responseBody:",
          message
        );
      }
    }
  }

  // If we still don't have a good message, check the original error's data.error.message
  if (
    !message ||
    message.includes("No output generated") ||
    message.includes("Check the stream")
  ) {
    if (
      errorAny?.data?.error?.message &&
      typeof errorAny.data.error.message === "string" &&
      errorAny.data.error.message.length > 0
    ) {
      // This is the real API error - use it immediately
      message = errorAny.data.error.message;
      console.log(
        "[buildConversationErrorInfo] Found message from original error's data.error.message:",
        message
      );
    } else {
      // Fall back to comprehensive extraction
      const extractedMessage = extractFromError(error);
      if (extractedMessage) {
        message = extractedMessage;
        console.log(
          "[buildConversationErrorInfo] Found message from extractFromError:",
          message
        );
      } else {
        console.log(
          "[buildConversationErrorInfo] No message found in data.error.message or extractFromError, using:",
          message
        );
      }
    }
  }

  // Also check error.cause if it exists (but don't override if we already have a good message from data)
  // NOTE: For wrappers, we already checked the cause above, so skip if we have a good message
  if (
    error instanceof Error &&
    error.cause &&
    (!isWrapper ||
      message.includes("No output generated") ||
      message.includes("Check the stream"))
  ) {
    console.log("[buildConversationErrorInfo] Checking error.cause:", {
      causeType:
        error.cause instanceof Error
          ? error.cause.constructor.name
          : typeof error.cause,
      causeMessage:
        error.cause instanceof Error
          ? error.cause.message
          : String(error.cause),
    });

     
    const causeAny =
      error.cause instanceof Error ? (error.cause as any) : undefined;
    console.log("[buildConversationErrorInfo] Cause structure:", {
      hasData: !!causeAny?.data,
      hasDataError: !!causeAny?.data?.error,
      hasDataErrorMessage: !!causeAny?.data?.error?.message,
      dataErrorMessage: causeAny?.data?.error?.message,
    });

    // Prioritize cause's data.error.message directly (same as we do for wrappers)
    let causeMessage: string | undefined;
    if (
      causeAny?.data?.error?.message &&
      typeof causeAny.data.error.message === "string" &&
      causeAny.data.error.message.length > 0
    ) {
      causeMessage = causeAny.data.error.message;
      console.log(
        "[buildConversationErrorInfo] Found cause message from data.error.message:",
        causeMessage
      );
    } else {
      causeMessage = extractFromError(error.cause);
      if (causeMessage) {
        console.log(
          "[buildConversationErrorInfo] Found cause message from extractFromError:",
          causeMessage
        );
      }
    }

    // Only use cause message if:
    // 1. We don't have a message yet, OR
    // 2. The cause message is from data.error.message (more specific) and is longer
    if (causeMessage) {
      // If current message is generic or short, prefer cause message
      const isCurrentMessageGeneric =
        message.includes("No output generated") ||
        message.includes("Check the stream") ||
        message.length < 30;

      if (
        isCurrentMessageGeneric ||
        (causeMessage.length > message.length &&
          !message.includes(causeMessage))
      ) {
        console.log(
          "[buildConversationErrorInfo] Using cause message (was generic or cause is better)"
        );
        message = causeMessage;
        if (error.cause instanceof Error) {
          specificError = error.cause;
        }
      } else {
        console.log(
          "[buildConversationErrorInfo] Keeping current message (not generic and better than cause)"
        );
      }
    } else {
      console.log("[buildConversationErrorInfo] No message found in cause");
    }
  }

  // If this is a generic wrapper error, aggressively look for the real cause
  // NOTE: We already checked the cause's data.error.message above, so this section
  // only runs if we didn't find a good message there
  if (error instanceof Error && isGenericWrapper(error)) {
    console.log(
      "[buildConversationErrorInfo] Detected generic wrapper error:",
      {
        errorName: error.name,
        errorMessage: error.message,
        currentExtractedMessage: message,
      }
    );

    // Check if we already have a good message from the cause's data.error.message (checked above)
    const hasGoodMessage =
      message &&
      !message.includes("No output generated") &&
      !message.includes("Check the stream") &&
      message.length > 30;

    console.log(
      "[buildConversationErrorInfo] Wrapper handling - hasGoodMessage:",
      hasGoodMessage
    );

    // If we already have a good message from the cause, skip further cause checking
    // Otherwise, continue checking the cause chain for other error sources
    if (!hasGoodMessage && error.cause) {
      console.log(
        "[buildConversationErrorInfo] Wrapper: Checking cause (no good message yet)"
      );
       
      const causeAny =
        error.cause instanceof Error ? (error.cause as any) : undefined;
      console.log("[buildConversationErrorInfo] Wrapper cause structure:", {
        hasData: !!causeAny?.data,
        hasDataError: !!causeAny?.data?.error,
        hasDataErrorMessage: !!causeAny?.data?.error?.message,
        dataErrorMessage: causeAny?.data?.error?.message,
      });

      const causeMsg = extractFromError(error.cause);
      if (causeMsg && causeMsg.length > 0) {
        console.log(
          "[buildConversationErrorInfo] Wrapper: Found cause message:",
          causeMsg
        );
        message = causeMsg;
        if (error.cause instanceof Error) {
          specificError = error.cause;
        }
      } else if (error.cause instanceof Error) {
        console.log(
          "[buildConversationErrorInfo] Wrapper: Using cause.message:",
          error.cause.message
        );
        message = error.cause.message;
        specificError = error.cause;
      }

      // Continue traversing the cause chain to find the most specific error
      if (error.cause instanceof Error && !hasGoodMessage) {
        let currentCause: unknown = error.cause.cause;
        let depth = 0;
        const maxDepth = 10;

        while (currentCause && depth < maxDepth) {
          const causeMsg = extractFromError(currentCause);
          if (
            causeMsg &&
            causeMsg.length > message.length &&
            !isGenericWrapper({ name: "", message: causeMsg } as Error)
          ) {
            message = causeMsg;
            if (currentCause instanceof Error) {
              specificError = currentCause;
            }
          } else if (currentCause instanceof Error) {
            const causeMessage = currentCause.message;
            if (
              causeMessage &&
              causeMessage.length > message.length &&
              !isGenericWrapper(currentCause)
            ) {
              message = causeMessage;
              specificError = currentCause;
            }
          }

          if (currentCause instanceof Error) {
            currentCause = currentCause.cause;
          } else {
            break;
          }
          depth++;
        }
      }
    }

    // If we still have a generic message, check all properties of the error object
    if (!hasGoodMessage && isGenericWrapper({ name: "", message } as Error)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errorAny = error as any;
      // Check for common error property names
      const errorProps = [
        "error",
        "err",
        "originalError",
        "underlyingError",
        "rootCause",
      ];
      for (const prop of errorProps) {
        if (errorAny[prop]) {
          const propMsg = extractFromError(errorAny[prop]);
          if (
            propMsg &&
            propMsg.length > 0 &&
            !isGenericWrapper({ name: "", message: propMsg } as Error)
          ) {
            message = propMsg;
            if (errorAny[prop] instanceof Error) {
              specificError = errorAny[prop];
            }
            break;
          }
        }
      }
    }
  } else {
    // For non-wrapper errors, still traverse cause chain but less aggressively
    if (error instanceof Error && error.cause) {
      let currentCause: unknown = error.cause;
      let depth = 0;
      const maxDepth = 10;

      while (currentCause && depth < maxDepth) {
        if (currentCause instanceof Error) {
          const causeMessage = currentCause.message;
          // Prefer more specific error messages (longer, more descriptive)
          if (
            causeMessage &&
            causeMessage.length > message.length &&
            !isGenericWrapper(currentCause)
          ) {
            message = causeMessage;
            specificError = currentCause;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anyCause = currentCause as any;
          if (
            typeof anyCause.statusCode === "number" ||
            typeof anyCause.status === "number"
          ) {
            specificError = currentCause;
          }
          currentCause = currentCause.cause;
        } else {
          break;
        }
        depth++;
      }
    }

    // Extract error message from nested error structures (data, responseBody, etc.)
    // We already called extractFromError at the beginning, but check again in case we missed something
    const nestedMessage =
      extractFromError(error) ||
      (error instanceof Error && error.cause
        ? extractFromError(error.cause)
        : undefined);
    if (nestedMessage && nestedMessage.length > 0) {
      // Prefer nested messages if they're more specific
      if (
        nestedMessage.length > message.length ||
        (!message.includes(nestedMessage) &&
          !nestedMessage.includes("No output generated"))
      ) {
        message = nestedMessage;
      }
    }
  }

  const base: ConversationErrorInfo = {
    message,
    occurredAt: new Date().toISOString(),
    provider: options?.provider,
    modelName: options?.modelName,
    endpoint: options?.endpoint,
    metadata: options?.metadata,
  };

  // Use the most specific error found, or fall back to original
  const errorToInspect =
    specificError || (error instanceof Error ? error : undefined);

  if (errorToInspect) {
    // Use the specific error's name and stack (not the wrapper's)
    base.name = errorToInspect.name;
    base.stack = errorToInspect.stack;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- error might carry custom fields
    const anyError = errorToInspect as any;

    // Also check the original error for properties that might not be on the cause
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalError = error instanceof Error ? (error as any) : undefined;

    // Helper to extract code from error object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- error might carry custom fields
    const extractCode = (err: any): string | undefined => {
      if (!err || typeof err !== "object") return undefined;

      // Check data.error.code (AI SDK errors)
      if (err.data?.error?.code !== undefined && err.data.error.code !== null) {
        return String(err.data.error.code);
      }

      // Check code directly
      if (typeof err.code === "string") {
        return err.code;
      } else if (typeof err.code === "number") {
        return String(err.code);
      }

      // Check responseBody for code
      if (err.responseBody && typeof err.responseBody === "string") {
        try {
          const body = JSON.parse(err.responseBody) as Record<string, unknown>;
          if (
            body.error &&
            typeof body.error === "object" &&
            body.error !== null
          ) {
            const errorObj = body.error as Record<string, unknown>;
            if (errorObj.code !== undefined && errorObj.code !== null) {
              return String(errorObj.code);
            }
          }
        } catch {
          // Not JSON, ignore
        }
      }

      return undefined;
    };

    // Extract error code (check multiple locations)
    base.code =
      extractCode(anyError) || extractCode(originalError) || undefined;

    // Helper to extract status code from error object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- error might carry custom fields
    const extractStatusCode = (err: any): number | undefined => {
      if (!err || typeof err !== "object") return undefined;

      // Check statusCode directly (most common)
      if (typeof err.statusCode === "number") {
        return err.statusCode;
      }

      // Check status
      if (typeof err.status === "number") {
        return err.status;
      }

      // Check data.error.code (sometimes status is in code)
      if (
        err.data?.error?.code &&
        typeof err.data.error.code === "number" &&
        err.data.error.code >= 400 &&
        err.data.error.code < 600
      ) {
        return err.data.error.code;
      }

      // Check response.status
      if (err.response && typeof err.response.status === "number") {
        return err.response.status;
      }

      // Check response.statusCode
      if (err.response && typeof err.response.statusCode === "number") {
        return err.response.statusCode;
      }

      // Check responseBody for status code
      if (err.responseBody && typeof err.responseBody === "string") {
        try {
          const body = JSON.parse(err.responseBody) as Record<string, unknown>;
          if (
            body.error &&
            typeof body.error === "object" &&
            body.error !== null
          ) {
            const errorObj = body.error as Record<string, unknown>;
            if (
              typeof errorObj.code === "number" &&
              errorObj.code >= 400 &&
              errorObj.code < 600
            ) {
              return errorObj.code;
            }
          }
        } catch {
          // Not JSON, ignore
        }
      }

      return undefined;
    };

    // Extract status code (check both specific error and original)
    base.statusCode =
      extractStatusCode(anyError) ||
      extractStatusCode(originalError) ||
      undefined;

    // Extract API error details if available (check multiple locations)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checkResponseData = (data: any): void => {
      if (!data || typeof data !== "object") return;

      const responseData = data as Record<string, unknown>;

      // Try to extract error message from API response
      let apiErrorMessage: string | undefined;
      if (responseData.error) {
        if (
          typeof responseData.error === "object" &&
          responseData.error !== null
        ) {
          const errorObj = responseData.error as Record<string, unknown>;
          apiErrorMessage =
            (typeof errorObj.message === "string"
              ? errorObj.message
              : undefined) ||
            (typeof errorObj.error === "string" ? errorObj.error : undefined);

          // Extract error code from API response
          if (!base.code && errorObj.code) {
            base.code = String(errorObj.code);
          }
        } else if (typeof responseData.error === "string") {
          apiErrorMessage = responseData.error;
        }
      }

      if (!apiErrorMessage && typeof responseData.message === "string") {
        apiErrorMessage = responseData.message;
      }

      if (apiErrorMessage && apiErrorMessage.length > 0) {
        // Use the API error message if it's more specific than the current message
        // or if current message is generic
        const isGenericMessage =
          message.includes("No output generated") ||
          message.includes("Check the stream for errors") ||
          message.length < 30;

        if (
          isGenericMessage ||
          (!message.includes(apiErrorMessage) &&
            apiErrorMessage.length > message.length)
        ) {
          message = apiErrorMessage;
        } else if (!message.includes(apiErrorMessage)) {
          // Append if not already included
          message = `${message} (API: ${apiErrorMessage})`;
        }
      }
    };

    // Check response.data in the specific error
    if (anyError.response?.data) {
      checkResponseData(anyError.response.data);
    }

    // Check data directly in the specific error (AI SDK errors)
    if (anyError.data) {
      checkResponseData(anyError.data);
    }

    // Also check the original error object for nested data (wrapper might have the data)
    if (originalError && error instanceof Error && error !== errorToInspect) {
      if (originalError.response?.data) {
        checkResponseData(originalError.response.data);
      }
      if (originalError.data) {
        checkResponseData(originalError.data);
      }
    }

    // Update message with the most specific one found
    base.message = message;
  } else if (error && typeof error === "object") {
    // Handle non-Error objects
    const maybeStatus =
      "statusCode" in error &&
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : "status" in error &&
          typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : undefined;
    if (maybeStatus !== undefined) {
      base.statusCode = maybeStatus;
    }
  }

  // Remove undefined/null values to avoid DynamoDB errors
  const cleanErrorInfo: ConversationErrorInfo = {
    message: base.message,
  };

  if (base.name !== undefined && base.name !== null) {
    cleanErrorInfo.name = base.name;
  }
  if (base.stack !== undefined && base.stack !== null) {
    cleanErrorInfo.stack = base.stack;
  }
  if (base.code !== undefined && base.code !== null) {
    cleanErrorInfo.code = base.code;
  }
  if (base.statusCode !== undefined && base.statusCode !== null) {
    cleanErrorInfo.statusCode = base.statusCode;
  }
  if (base.provider !== undefined && base.provider !== null) {
    cleanErrorInfo.provider = base.provider;
  }
  if (base.modelName !== undefined && base.modelName !== null) {
    cleanErrorInfo.modelName = base.modelName;
  }
  if (base.endpoint !== undefined && base.endpoint !== null) {
    cleanErrorInfo.endpoint = base.endpoint;
  }
  if (base.occurredAt !== undefined && base.occurredAt !== null) {
    cleanErrorInfo.occurredAt = base.occurredAt;
  }
  if (
    base.metadata !== undefined &&
    base.metadata !== null &&
    Object.keys(base.metadata).length > 0
  ) {
    // Clean metadata object - remove undefined/null values
    const cleanMetadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(base.metadata)) {
      if (value !== undefined && value !== null) {
        cleanMetadata[key] = value;
      }
    }
    if (Object.keys(cleanMetadata).length > 0) {
      cleanErrorInfo.metadata = cleanMetadata;
    }
  }

  // Log final result
  console.log("[buildConversationErrorInfo] Final error info:", {
    message: cleanErrorInfo.message,
    name: cleanErrorInfo.name,
    code: cleanErrorInfo.code,
    statusCode: cleanErrorInfo.statusCode,
    provider: cleanErrorInfo.provider,
    modelName: cleanErrorInfo.modelName,
    endpoint: cleanErrorInfo.endpoint,
    hasStack: !!cleanErrorInfo.stack,
    stackLength: cleanErrorInfo.stack?.length,
  });

  return cleanErrorInfo;
}

/**
 * Extract tool calls from messages
 */
export function extractToolCalls(messages: UIMessage[]): unknown[] {
  const toolCalls: unknown[] = [];

  // DIAGNOSTIC: Log input messages
  console.log("[extractToolCalls] Processing messages:", {
    messagesCount: messages.length,
    messages: messages.map((msg) => ({
      role: msg.role,
      contentType: typeof msg.content,
      isArray: Array.isArray(msg.content),
      contentLength: Array.isArray(msg.content) ? msg.content.length : "N/A",
      contentPreview: Array.isArray(msg.content)
        ? msg.content.slice(0, 3).map((item) => ({
            type:
              typeof item === "object" && item !== null && "type" in item
                ? item.type
                : "unknown",
            keys:
              typeof item === "object" && item !== null
                ? Object.keys(item)
                : [],
          }))
        : "not array",
    })),
  });

  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      console.log(
        "[extractToolCalls] Processing assistant message with array content:",
        {
          contentLength: message.content.length,
          contentItems: message.content.map((item) => ({
            type: typeof item,
            isObject: typeof item === "object" && item !== null,
            hasType:
              typeof item === "object" && item !== null && "type" in item,
            typeValue:
              typeof item === "object" && item !== null && "type" in item
                ? item.type
                : undefined,
            keys:
              typeof item === "object" && item !== null
                ? Object.keys(item)
                : [],
          })),
        }
      );

      for (const item of message.content) {
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "tool-call"
        ) {
          console.log("[extractToolCalls] Found tool call:", item);
          // Validate tool call has required fields
          if (
            "toolCallId" in item &&
            "toolName" in item &&
            typeof (item as { toolCallId?: unknown }).toolCallId === "string" &&
            typeof (item as { toolName?: unknown }).toolName === "string"
          ) {
            toolCalls.push(item);
          } else {
            console.warn(
              "[extractToolCalls] Tool call missing required fields:",
              {
                hasToolCallId: "toolCallId" in item,
                hasToolName: "toolName" in item,
                toolCallIdType:
                  "toolCallId" in item
                    ? typeof (item as { toolCallId?: unknown }).toolCallId
                    : "missing",
                toolNameType:
                  "toolName" in item
                    ? typeof (item as { toolName?: unknown }).toolName
                    : "missing",
                item,
              }
            );
          }
        }
      }
    } else {
      console.log("[extractToolCalls] Skipping message:", {
        role: message.role,
        isAssistant: message.role === "assistant",
        isArray: Array.isArray(message.content),
        contentType: typeof message.content,
      });
    }
  }

  console.log("[extractToolCalls] Extracted tool calls:", {
    count: toolCalls.length,
    toolCalls: toolCalls,
  });

  return toolCalls;
}

/**
 * Normalize message content to extract text for comparison
 * Handles both string and array formats, extracting text content
 */
function normalizeContentForComparison(content: UIMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    // Extract all text from the array
    const textParts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        textParts.push(part);
      } else if (typeof part === "object" && part !== null && "type" in part) {
        if (part.type === "text" && "text" in part) {
          const textPart = part as { text?: unknown };
          if (typeof textPart.text === "string") {
            textParts.push(textPart.text);
          }
        }
        // For tool calls and results, include them in the key to distinguish messages
        else if (part.type === "tool-call") {
          const toolPart = part as {
            toolName?: unknown;
            args?: unknown;
          };
          textParts.push(
            `[tool-call:${String(toolPart.toolName || "")}:${JSON.stringify(
              toolPart.args || {}
            )}]`
          );
        } else if (part.type === "tool-result") {
          const toolPart = part as {
            toolName?: unknown;
            toolCallId?: unknown;
          };
          textParts.push(
            `[tool-result:${String(toolPart.toolName || "")}:${String(
              toolPart.toolCallId || ""
            )}]`
          );
        }
      }
    }
    return textParts.join("");
  }

  return String(content);
}

/**
 * Check if a message has empty content
 * Returns true if content is empty array, empty string, or array with no valid items
 */
export function isMessageContentEmpty(message: UIMessage): boolean {
  const content = message.content;

  // Empty string or only whitespace
  if (typeof content === "string") {
    return content.trim().length === 0;
  }

  // Empty array
  if (Array.isArray(content)) {
    if (content.length === 0) {
      return true;
    }

    // Check if all items are invalid/empty
    let hasValidItem = false;
    for (const item of content) {
      if (typeof item === "string" && item.trim().length > 0) {
        hasValidItem = true;
        break;
      } else if (typeof item === "object" && item !== null && "type" in item) {
        // Valid item types: text, tool-call, tool-result
        if (item.type === "text" && "text" in item) {
          const textPart = item as { text?: unknown };
          if (
            typeof textPart.text === "string" &&
            textPart.text.trim().length > 0
          ) {
            hasValidItem = true;
            break;
          }
        } else if (item.type === "tool-call" || item.type === "tool-result") {
          // Tool calls and results are always valid (non-empty)
          hasValidItem = true;
          break;
        }
      }
    }
    return !hasValidItem;
  }

  // Other types (shouldn't happen, but treat as non-empty to be safe)
  return false;
}

/**
 * Generate a unique key for a message based on its role and content
 * Used for deduplication when merging conversations
 * Normalizes content so that string and array formats with the same text are treated as duplicates
 */
export function getMessageKey(message: UIMessage): string {
  const role = message.role;
  const contentKey = normalizeContentForComparison(message.content);
  return `${role}:${contentKey}`;
}

/**
 * Find messages that are new (not present in existing messages)
 * Compares messages based on role and content only (ignores metadata like tokenUsage)
 */
export function findNewMessages(
  existingMessages: UIMessage[],
  incomingMessages: UIMessage[]
): UIMessage[] {
  // Create a set of keys for existing messages for O(1) lookup
  const existingKeys = new Set(
    existingMessages.map((msg) => getMessageKey(msg))
  );

  // Filter incoming messages to only those not in existing
  const newMessages = incomingMessages.filter((msg) => {
    const key = getMessageKey(msg);
    return !existingKeys.has(key);
  });

  console.log(
    `[findNewMessages] Found ${newMessages.length} new messages out of ${incomingMessages.length} incoming messages (${existingMessages.length} existing messages)`
  );

  return newMessages;
}

/**
 * Deduplicate messages based on role and content
 * When appending new messages, check if each is a duplicate before adding
 */
function deduplicateMessages(
  existingMessages: UIMessage[],
  newMessages: UIMessage[]
): UIMessage[] {
  // Start with existing messages
  const deduplicated: UIMessage[] = [...existingMessages];
  const seenKeys = new Set<string>();

  // Track keys of existing messages
  for (const msg of existingMessages) {
    const key = getMessageKey(msg);
    seenKeys.add(key);
  }

  // Append each new message, checking for duplicates first
  for (const newMsg of newMessages) {
    const key = getMessageKey(newMsg);

    if (!seenKeys.has(key)) {
      // Not a duplicate - add it
      deduplicated.push(newMsg);
      seenKeys.add(key);
    } else {
      // Duplicate found - check if we should update the existing one
      const existingIndex = deduplicated.findIndex(
        (msg) => getMessageKey(msg) === key
      );

      if (existingIndex >= 0) {
        const existing = deduplicated[existingIndex];

        // Check if either message has tokenUsage (can exist on any message type)
        const existingHasTokenUsage =
          "tokenUsage" in existing &&
          existing.tokenUsage &&
          typeof existing.tokenUsage === "object" &&
          "totalTokens" in existing.tokenUsage &&
          typeof (existing.tokenUsage as { totalTokens?: unknown })
            .totalTokens === "number" &&
          (existing.tokenUsage as { totalTokens: number }).totalTokens > 0;
        const newHasTokenUsage =
          "tokenUsage" in newMsg &&
          newMsg.tokenUsage &&
          typeof newMsg.tokenUsage === "object" &&
          "totalTokens" in newMsg.tokenUsage &&
          typeof (newMsg.tokenUsage as { totalTokens?: unknown })
            .totalTokens === "number" &&
          (newMsg.tokenUsage as { totalTokens: number }).totalTokens > 0;

        // Prefer array format over string format (more structured)
        const existingIsArray = Array.isArray(existing.content);
        const newIsArray = Array.isArray(newMsg.content);

        // Update existing message if:
        // 1. New has tokenUsage and existing doesn't, OR
        // 2. Both have tokenUsage but new has better format (array), OR
        // 3. New has better format and existing has no tokenUsage
        if (
          (newHasTokenUsage && !existingHasTokenUsage) ||
          (newHasTokenUsage &&
            existingHasTokenUsage &&
            newIsArray &&
            !existingIsArray) ||
          (!existingHasTokenUsage && newIsArray && !existingIsArray)
        ) {
          // Replace with new message (has tokenUsage or better format)
          deduplicated[existingIndex] = newMsg;
        } else if (
          existingHasTokenUsage &&
          !newHasTokenUsage &&
          newIsArray &&
          !existingIsArray
        ) {
          // Existing has tokenUsage, new doesn't, but new has better format - merge
          deduplicated[existingIndex] = {
            ...newMsg,
            tokenUsage: existing.tokenUsage,
          } as UIMessage;
        }
        // Otherwise keep existing (it has tokenUsage or is already in better format)
      }
    }
  }

  return deduplicated;
}

/**
 * Expand messages to include separate tool call and tool result messages
 * This ensures tool calls appear as separate messages in the conversation history
 * while keeping them embedded in assistant message content for LLM compatibility
 */
export function expandMessagesWithToolCalls(
  messages: UIMessage[],
  awsRequestId?: string
): UIMessage[] {
  const expandedMessages: UIMessage[] = [];

  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      // Extract tool calls and tool results from this assistant message
      const toolCallsInMessage: Array<{
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        args: unknown;
        toolCallStartedAt?: string;
      }> = [];
      const toolResultsInMessage: Array<{
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        result: unknown;
        toolExecutionTimeMs?: number;
      }> = [];
      const textParts: Array<{ type: "text"; text: string }> = [];

      // Separate content into tool calls, tool results, and text
      for (const item of message.content) {
        if (typeof item === "object" && item !== null && "type" in item) {
          if (item.type === "tool-call") {
            const toolCall = item as {
              type: "tool-call";
              toolCallId?: string;
              toolName?: string;
              args?: unknown;
              toolCallStartedAt?: string;
            };
            if (
              toolCall.toolCallId &&
              toolCall.toolName &&
              typeof toolCall.toolCallId === "string" &&
              typeof toolCall.toolName === "string"
            ) {
              toolCallsInMessage.push({
                type: "tool-call",
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                args: toolCall.args || {},
                ...(toolCall.toolCallStartedAt && {
                  toolCallStartedAt: toolCall.toolCallStartedAt,
                }),
              });
            }
          } else if (item.type === "tool-result") {
            const toolResult = item as {
              type: "tool-result";
              toolCallId?: string;
              toolName?: string;
              result?: unknown;
              toolExecutionTimeMs?: number;
            };
            if (
              toolResult.toolCallId &&
              toolResult.toolName &&
              typeof toolResult.toolCallId === "string" &&
              typeof toolResult.toolName === "string"
            ) {
              toolResultsInMessage.push({
                type: "tool-result",
                toolCallId: toolResult.toolCallId,
                toolName: toolResult.toolName,
                result: toolResult.result,
                ...(toolResult.toolExecutionTimeMs !== undefined && {
                  toolExecutionTimeMs: toolResult.toolExecutionTimeMs,
                }),
              });
            }
          } else if (item.type === "text" && "text" in item) {
            const textItem = item as { text?: unknown };
            if (typeof textItem.text === "string") {
              textParts.push({ type: "text", text: textItem.text });
            }
          }
        }
      }

      // If we have tool calls or tool results, create separate messages for them
      if (toolCallsInMessage.length > 0 || toolResultsInMessage.length > 0) {
        // Add tool call messages (as separate assistant messages with just tool calls)
        for (const toolCall of toolCallsInMessage) {
          expandedMessages.push({
            role: "assistant",
            content: [toolCall],
            ...(awsRequestId && { awsRequestId }),
          });
        }

        // Add tool result messages (as tool role messages)
        for (const toolResult of toolResultsInMessage) {
          expandedMessages.push({
            role: "tool",
            content: [toolResult],
            ...(awsRequestId && { awsRequestId }),
          });
        }

        // If there's text content, create a separate assistant message with only text
        // This avoids duplicating tool calls/results which are already in separate messages
        if (textParts.length > 0) {
          const textOnlyMessage: UIMessage = {
            role: "assistant",
            content: textParts,
            ...(awsRequestId && { awsRequestId }),
            // Preserve other metadata from the original message
            ...(message.tokenUsage && { tokenUsage: message.tokenUsage }),
            ...(message.modelName && { modelName: message.modelName }),
            ...(message.provider && { provider: message.provider }),
            ...(message.provisionalCostUsd !== undefined && {
              provisionalCostUsd: message.provisionalCostUsd,
            }),
            ...(message.finalCostUsd !== undefined && {
              finalCostUsd: message.finalCostUsd,
            }),
            ...(message.generationTimeMs !== undefined && {
              generationTimeMs: message.generationTimeMs,
            }),
            ...(message.openrouterGenerationId && {
              openrouterGenerationId: message.openrouterGenerationId,
            }),
          };
          expandedMessages.push(textOnlyMessage);
        }
        // If there's no text content, we don't add the original message
        // since tool calls/results are already represented as separate messages
      } else {
        // No tool calls/results, add message as-is
        expandedMessages.push(
          awsRequestId ? { ...message, awsRequestId } : message
        );
      }
    } else {
      // Not an assistant message with array content, add as-is
      expandedMessages.push(
        awsRequestId ? { ...message, awsRequestId } : message
      );
    }
  }

  console.log("[expandMessagesWithToolCalls] Expanded messages:", {
    originalCount: messages.length,
    expandedCount: expandedMessages.length,
    expansion: expandedMessages.length - messages.length,
  });

  return expandedMessages;
}

/**
 * Extract tool results from messages
 */
export function extractToolResults(messages: UIMessage[]): unknown[] {
  const toolResults: unknown[] = [];

  // DIAGNOSTIC: Log input messages
  console.log("[extractToolResults] Processing messages:", {
    messagesCount: messages.length,
  });

  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const item of message.content) {
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "tool-result"
        ) {
          console.log(
            "[extractToolResults] Found tool result in assistant message:",
            item
          );
          // Validate tool result has required fields
          if (
            "toolCallId" in item &&
            "toolName" in item &&
            typeof (item as { toolCallId?: unknown }).toolCallId === "string" &&
            typeof (item as { toolName?: unknown }).toolName === "string"
          ) {
            toolResults.push(item);
          } else {
            console.warn(
              "[extractToolResults] Tool result missing required fields:",
              {
                hasToolCallId: "toolCallId" in item,
                hasToolName: "toolName" in item,
                toolCallIdType:
                  "toolCallId" in item
                    ? typeof (item as { toolCallId?: unknown }).toolCallId
                    : "missing",
                toolNameType:
                  "toolName" in item
                    ? typeof (item as { toolName?: unknown }).toolName
                    : "missing",
                item,
              }
            );
          }
        }
      }
    } else if (message.role === "tool" && Array.isArray(message.content)) {
      for (const item of message.content) {
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "tool-result"
        ) {
          console.log(
            "[extractToolResults] Found tool result in tool message:",
            item
          );
          // Validate tool result has required fields
          if (
            "toolCallId" in item &&
            "toolName" in item &&
            typeof (item as { toolCallId?: unknown }).toolCallId === "string" &&
            typeof (item as { toolName?: unknown }).toolName === "string"
          ) {
            toolResults.push(item);
          } else {
            console.warn(
              "[extractToolResults] Tool result missing required fields (tool message):",
              {
                hasToolCallId: "toolCallId" in item,
                hasToolName: "toolName" in item,
                toolCallIdType:
                  "toolCallId" in item
                    ? typeof (item as { toolCallId?: unknown }).toolCallId
                    : "missing",
                toolNameType:
                  "toolName" in item
                    ? typeof (item as { toolName?: unknown }).toolName
                    : "missing",
                item,
              }
            );
          }
        }
      }
    }
  }

  console.log("[extractToolResults] Extracted tool results:", {
    count: toolResults.length,
    toolResults: toolResults,
  });

  return toolResults;
}

/**
 * Aggregate token usage from multiple usage objects
 * Ensures reasoning tokens are included in the total
 */
export function aggregateTokenUsage(
  ...usages: Array<TokenUsage | undefined>
): TokenUsage {
  let promptTokens = 0;
  let completionTokens = 0;
  let reasoningTokens = 0;
  let cachedPromptTokens = 0;

  for (const usage of usages) {
    if (usage) {
      promptTokens += usage.promptTokens || 0;
      completionTokens += usage.completionTokens || 0;
      reasoningTokens += usage.reasoningTokens || 0;
      cachedPromptTokens += usage.cachedPromptTokens || 0;
    }
  }

  // Calculate totalTokens as the sum of prompt (including cached), completion, and reasoning tokens
  // This ensures reasoning tokens and cached prompt tokens are always included in the total
  const totalTokens =
    promptTokens + cachedPromptTokens + completionTokens + reasoningTokens;

  const aggregated: TokenUsage = {
    promptTokens,
    completionTokens,
    totalTokens,
  };

  // Only include optional fields if they're greater than 0
  if (reasoningTokens > 0) {
    aggregated.reasoningTokens = reasoningTokens;
  }
  if (cachedPromptTokens > 0) {
    aggregated.cachedPromptTokens = cachedPromptTokens;
  }

  return aggregated;
}

/**
 * Extract token usage from generateText result
 * Handles Google AI SDK response format including reasoning tokens and cached tokens
 */
export function extractTokenUsage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any
): TokenUsage | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }

  const usage = result.usage;
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  // DIAGNOSTIC: Log full usage object structure for debugging
  console.log("[extractTokenUsage] Full usage object structure:", {
    usageKeys: Object.keys(usage),
    usageObject: JSON.stringify(usage, null, 2),
    resultKeys: Object.keys(result),
  });

  // Handle both field name variations:
  // - promptTokens/completionTokens (standard AI SDK format)
  // - inputTokens/outputTokens (some provider adapters use these)
  // - promptTokenCount/completionTokenCount (Google API format)
  const promptTokens =
    usage.promptTokens ?? usage.inputTokens ?? usage.promptTokenCount ?? 0;
  const completionTokens =
    usage.completionTokens ??
    usage.outputTokens ??
    usage.completionTokenCount ??
    0;
  const totalTokens = usage.totalTokens ?? usage.totalTokenCount ?? 0;

  // Extract cached prompt tokens if present (Google API may provide this)
  // Cached tokens can be in various formats:
  // - cachedPromptTokenCount (Google API format)
  // - cachedPromptTokens
  // - cachedInputTokens (alternative field name)
  // - cachedTokens
  const cachedPromptTokens =
    usage.cachedPromptTokenCount ??
    usage.cachedPromptTokens ??
    usage.cachedInputTokens ??
    usage.cachedTokens ??
    0;

  // Extract reasoning tokens if present (Google AI SDK may provide this)
  // Reasoning tokens can be in various formats:
  // - reasoningTokens (direct field)
  // - usage.reasoningTokens
  // - nested in usage object
  const reasoningTokens =
    usage.reasoningTokens ?? usage.reasoning ?? result.reasoningTokens ?? 0;

  // Calculate non-cached prompt tokens
  // If we have cached tokens, the promptTokens might include them
  // We need to track both separately for accurate billing
  const nonCachedPromptTokens = Math.max(0, promptTokens - cachedPromptTokens);

  // DIAGNOSTIC: Log all extracted fields
  console.log("[extractTokenUsage] Extracted token fields:", {
    promptTokens,
    completionTokens,
    totalTokens,
    cachedPromptTokens,
    nonCachedPromptTokens,
    reasoningTokens,
    allUsageFields: Object.keys(usage),
  });

  // Warn if we found unexpected fields that might be relevant
  const knownFields = [
    "promptTokens",
    "inputTokens",
    "promptTokenCount",
    "completionTokens",
    "outputTokens",
    "completionTokenCount",
    "totalTokens",
    "totalTokenCount",
    "cachedPromptTokenCount",
    "cachedPromptTokens",
    "cachedInputTokens",
    "cachedTokens",
    "reasoningTokens",
    "reasoning",
  ];
  const unexpectedFields = Object.keys(usage).filter(
    (key) => !knownFields.includes(key)
  );
  if (unexpectedFields.length > 0) {
    console.warn(
      "[extractTokenUsage] Found unexpected fields in usage object:",
      {
        unexpectedFields,
        usageObject: usage,
      }
    );
  }

  // Calculate totalTokens as the sum of prompt (including cached), completion, and reasoning tokens
  // This ensures reasoning tokens and cached prompt tokens are always included in the total
  // Use the calculated total if it's greater than the provided totalTokens
  // (some APIs might not include reasoning tokens or cached tokens in their totalTokens)
  const calculatedTotal =
    nonCachedPromptTokens +
    cachedPromptTokens +
    completionTokens +
    reasoningTokens;
  const finalTotalTokens = Math.max(totalTokens, calculatedTotal);

  const tokenUsage: TokenUsage = {
    promptTokens: nonCachedPromptTokens, // Store non-cached prompt tokens
    completionTokens,
    totalTokens: finalTotalTokens,
  };

  // Only include optional fields if they're greater than 0
  if (reasoningTokens > 0) {
    tokenUsage.reasoningTokens = reasoningTokens;
  }
  if (cachedPromptTokens > 0) {
    tokenUsage.cachedPromptTokens = cachedPromptTokens;
  }

  // DIAGNOSTIC: Log final token usage object
  console.log("[extractTokenUsage] Final token usage:", {
    tokenUsage,
    breakdown: {
      nonCachedPromptTokens,
      cachedPromptTokens,
      completionTokens,
      reasoningTokens,
      totalTokens,
    },
  });

  return tokenUsage;
}

/**
 * Start a new conversation
 */
export async function startConversation(
  db: DatabaseSchema,
  data: Omit<
    ConversationLogData,
    "conversationId" | "startedAt" | "lastMessageAt"
  >
): Promise<string> {
  const conversationId = randomUUID();
  const now = new Date().toISOString();
  const pk = `conversations/${data.workspaceId}/${data.agentId}/${conversationId}`;

  // Keep all messages (including empty ones) - do not filter
  // Add request ID to messages if provided
  const messagesWithRequestId = data.awsRequestId
    ? data.messages.map((msg) => ({
        ...msg,
        awsRequestId: data.awsRequestId,
      }))
    : data.messages;

  // Expand messages to include separate tool call and tool result messages
  // This ensures tool calls appear as separate messages in conversation history
  const expandedMessages = expandMessagesWithToolCalls(
    data.messages,
    data.awsRequestId
  );

  // Calculate costs from per-message model/provider data
  // Prefer finalCostUsd (from OpenRouter API verification) if available, then provisionalCostUsd, then calculate from tokenUsage
  let totalCostUsd = 0;
  let totalGenerationTimeMs = 0;
  for (const message of messagesWithRequestId) {
    if (message.role === "assistant") {
      // Prefer finalCostUsd if available (from OpenRouter cost verification)
      if (
        "finalCostUsd" in message &&
        typeof message.finalCostUsd === "number"
      ) {
        totalCostUsd += message.finalCostUsd;
      } else if (
        "provisionalCostUsd" in message &&
        typeof message.provisionalCostUsd === "number"
      ) {
        // Fall back to provisionalCostUsd if finalCostUsd not available
        totalCostUsd += message.provisionalCostUsd;
      } else if ("tokenUsage" in message && message.tokenUsage) {
        // Fall back to calculating from tokenUsage
        const modelName =
          "modelName" in message && typeof message.modelName === "string"
            ? message.modelName
            : undefined;
        const provider =
          "provider" in message && typeof message.provider === "string"
            ? message.provider
            : "google";
        const messageCosts = calculateConversationCosts(
          provider,
          modelName,
          message.tokenUsage
        );
        totalCostUsd += messageCosts.usd;
      }
      // Sum generation times
      if (
        "generationTimeMs" in message &&
        typeof message.generationTimeMs === "number"
      ) {
        totalGenerationTimeMs += message.generationTimeMs;
      }
    }
  }

  // Initialize awsRequestIds array if awsRequestId is provided
  const awsRequestIds = data.awsRequestId ? [data.awsRequestId] : undefined;

  const conversationRecord = {
    pk,
    workspaceId: data.workspaceId,
    agentId: data.agentId,
    conversationId,
    conversationType: data.conversationType,
    messages: expandedMessages as unknown[],
    tokenUsage: data.tokenUsage,
    usesByok: data.usesByok,
    error: data.error,
    costUsd: totalCostUsd > 0 ? totalCostUsd : undefined,
    totalGenerationTimeMs:
      totalGenerationTimeMs > 0 ? totalGenerationTimeMs : undefined,
    awsRequestIds,
    startedAt: now,
    lastMessageAt: now,
    expires: calculateTTL(),
  };

  await db["agent-conversations"].create(conversationRecord);

  // Write to working memory - await to ensure it completes before Lambda finishes
  // This prevents Lambda from freezing the execution context before SQS message is sent
  console.log(
    `[Conversation Logger] Calling writeToWorkingMemory for conversation ${conversationId}, agent ${data.agentId}, workspace ${data.workspaceId}, ${data.messages.length} messages`
  );
  console.log(
    `[Conversation Logger] Parameter values being passed - agentId: "${data.agentId}", workspaceId: "${data.workspaceId}", conversationId: "${conversationId}"`
  );
  try {
    await writeToWorkingMemory(
      data.agentId,
      data.workspaceId,
      conversationId,
      expandedMessages
    );
  } catch (error) {
    // Log error but don't throw - memory writes should not block conversation logging
    console.error(
      `[Conversation Logger] Failed to write to working memory for conversation ${conversationId}:`,
      error instanceof Error
        ? {
            message: error.message,
            stack: error.stack,
            name: error.name,
          }
        : String(error)
    );
  }

  return conversationId;
}

/**
 * Update an existing conversation with new messages and token usage
 * Uses atomicUpdate to ensure thread-safe updates
 */
export async function updateConversation(
  db: DatabaseSchema,
  workspaceId: string,
  agentId: string,
  conversationId: string,
  newMessages: UIMessage[],
  additionalTokenUsage?: TokenUsage,
  usesByok?: boolean,
  error?: ConversationErrorInfo,
  awsRequestId?: string,
  conversationType?: "test" | "webhook" | "stream"
): Promise<void> {
  const pk = `conversations/${workspaceId}/${agentId}/${conversationId}`;

  // Keep all messages (including empty ones) - do not filter
  // Add request ID to each new message if provided
  const messagesWithRequestId = awsRequestId
    ? newMessages.map((msg) => ({
        ...msg,
        awsRequestId,
      }))
    : newMessages;

  // Track truly new messages (not duplicates) to send to queue
  // This will be set inside atomicUpdate callback
  let trulyNewMessages: UIMessage[] = [];

  // Use atomicUpdate to ensure thread-safe conversation updates
  await db["agent-conversations"].atomicUpdate(
    pk,
    undefined,
    async (existing) => {
      const now = new Date().toISOString();

      if (!existing) {
        // If conversation doesn't exist, create it
        // Expand messages to include separate tool call and tool result messages
        const expandedMessages = expandMessagesWithToolCalls(
          newMessages,
          awsRequestId
        );
        trulyNewMessages = expandedMessages;

        // Calculate costs and generation times from per-message model/provider data
        let totalCostUsd = 0;
        let totalGenerationTimeMs = 0;
        for (const message of messagesWithRequestId) {
          if (message.role === "assistant") {
            // Prefer finalCostUsd if available (from OpenRouter cost verification)
            if (
              "finalCostUsd" in message &&
              typeof message.finalCostUsd === "number"
            ) {
              totalCostUsd += message.finalCostUsd;
            } else if (
              "provisionalCostUsd" in message &&
              typeof message.provisionalCostUsd === "number"
            ) {
              // Fall back to provisionalCostUsd if finalCostUsd not available
              totalCostUsd += message.provisionalCostUsd;
            } else if ("tokenUsage" in message && message.tokenUsage) {
              // Fall back to calculating from tokenUsage
              const msgModelName =
                "modelName" in message && typeof message.modelName === "string"
                  ? message.modelName
                  : undefined;
              const msgProvider =
                "provider" in message && typeof message.provider === "string"
                  ? message.provider
                  : "google";
              const messageCosts = calculateConversationCosts(
                msgProvider,
                msgModelName,
                message.tokenUsage
              );
              totalCostUsd += messageCosts.usd;
            }
            // Sum generation times
            if (
              "generationTimeMs" in message &&
              typeof message.generationTimeMs === "number"
            ) {
              totalGenerationTimeMs += message.generationTimeMs;
            }
          }
        }

        // Initialize awsRequestIds array if awsRequestId is provided
        const awsRequestIds = awsRequestId ? [awsRequestId] : undefined;

        const conversationRecord = {
          pk,
          workspaceId,
          agentId,
          conversationId,
          conversationType: (conversationType || "test") as
            | "test"
            | "webhook"
            | "stream", // Use provided type or default to test
          messages: expandedMessages as unknown[],
          tokenUsage: additionalTokenUsage,
          usesByok: usesByok,
          error,
          costUsd: totalCostUsd > 0 ? totalCostUsd : undefined,
          totalGenerationTimeMs:
            totalGenerationTimeMs > 0 ? totalGenerationTimeMs : undefined,
          awsRequestIds,
          startedAt: now,
          lastMessageAt: now,
          expires: calculateTTL(),
        };

        return conversationRecord;
      }

      // Get existing messages from database
      const existingMessages = (existing.messages || []) as UIMessage[];

      // Identify truly new messages (not in existing conversation)
      // This comparison is based on role and content only (ignores metadata like tokenUsage, awsRequestId)
      const trulyNewWithoutRequestId = findNewMessages(
        existingMessages,
        newMessages
      );
      // Expand truly new messages to include separate tool call and tool result messages
      // This ensures tool calls appear as separate messages in conversation history
      const expandedTrulyNewMessages = expandMessagesWithToolCalls(
        trulyNewWithoutRequestId,
        awsRequestId
      );
      trulyNewMessages = expandedTrulyNewMessages;

      // Merge messages for DB storage, deduplicating based on role and content
      // This prevents duplicate messages when the client sends the full conversation history
      // New messages should have request IDs, existing ones keep their original request IDs (if any)
      const allMessages = deduplicateMessages(
        existingMessages,
        messagesWithRequestId
      );

      // Expand messages to include separate tool call and tool result messages
      // This ensures tool calls appear as separate messages in conversation history
      // Expand after deduplication to avoid expanding duplicates
      const expandedAllMessages = expandMessagesWithToolCalls(
        allMessages,
        awsRequestId
      );

      // Aggregate token usage
      const existingTokenUsage = existing.tokenUsage as TokenUsage | undefined;
      const aggregatedTokenUsage = aggregateTokenUsage(
        existingTokenUsage,
        additionalTokenUsage
      );

      // Calculate costs from per-message model/provider data
      // Prefer finalCostUsd (from OpenRouter API verification) if available, then provisionalCostUsd, then calculate from tokenUsage
      let totalCostUsd = 0;
      let totalGenerationTimeMs = 0;
      for (const message of allMessages) {
        if (message.role === "assistant") {
          // Prefer finalCostUsd if available (from OpenRouter cost verification)
          if (
            "finalCostUsd" in message &&
            typeof message.finalCostUsd === "number"
          ) {
            totalCostUsd += message.finalCostUsd;
          } else if (
            "provisionalCostUsd" in message &&
            typeof message.provisionalCostUsd === "number"
          ) {
            // Fall back to provisionalCostUsd if finalCostUsd not available
            totalCostUsd += message.provisionalCostUsd;
          } else if ("tokenUsage" in message && message.tokenUsage) {
            // Fall back to calculating from tokenUsage
            const msgModelName =
              "modelName" in message && typeof message.modelName === "string"
                ? message.modelName
                : undefined;
            const msgProvider =
              "provider" in message && typeof message.provider === "string"
                ? message.provider
                : "google";
            const messageCosts = calculateConversationCosts(
              msgProvider,
              msgModelName,
              message.tokenUsage
            );
            totalCostUsd += messageCosts.usd;
          }
          // Sum generation times
          if (
            "generationTimeMs" in message &&
            typeof message.generationTimeMs === "number"
          ) {
            totalGenerationTimeMs += message.generationTimeMs;
          }
        }
      }

      // Update awsRequestIds array - append new request ID if provided
      const existingRequestIds =
        (existing as { awsRequestIds?: string[] }).awsRequestIds || [];
      const updatedRequestIds = awsRequestId
        ? [...existingRequestIds, awsRequestId]
        : existingRequestIds.length > 0
        ? existingRequestIds
        : undefined;

      // Update conversation, preserving existing fields
      const conversationRecord = {
        pk,
        workspaceId: existing.workspaceId,
        agentId: existing.agentId,
        conversationId: existing.conversationId,
        conversationType: existing.conversationType,
        messages: expandedAllMessages as unknown[],
        tokenUsage: aggregatedTokenUsage,
        lastMessageAt: now,
        expires: calculateTTL(),
        costUsd: totalCostUsd > 0 ? totalCostUsd : undefined,
        totalGenerationTimeMs:
          totalGenerationTimeMs > 0 ? totalGenerationTimeMs : undefined,
        usesByok:
          existing.usesByok !== undefined ? existing.usesByok : usesByok,
        error: error ?? (existing as { error?: ConversationErrorInfo }).error,
        startedAt: existing.startedAt,
        awsRequestIds: updatedRequestIds,
      };

      return conversationRecord;
    }
  );

  // Write to working memory - await to ensure it completes before Lambda finishes
  // This prevents Lambda from freezing the execution context before SQS message is sent
  // IMPORTANT: Only send truly new messages to the queue (not duplicates)
  // This prevents duplicate fact extraction and embedding generation
  if (trulyNewMessages.length > 0) {
    console.log(
      `[Conversation Logger] Calling writeToWorkingMemory for conversation ${conversationId}, agent ${agentId}, workspace ${workspaceId}, ${trulyNewMessages.length} truly new messages (out of ${newMessages.length} messages)`
    );
    console.log(
      `[Conversation Logger] Parameter values being passed - agentId: "${agentId}", workspaceId: "${workspaceId}", conversationId: "${conversationId}"`
    );
    try {
      await writeToWorkingMemory(
        agentId,
        workspaceId,
        conversationId,
        trulyNewMessages
      );
    } catch (error) {
      // Log error but don't throw - memory writes should not block conversation logging
      console.error(
        `[Conversation Logger] Failed to write to working memory for conversation ${conversationId}:`,
        error instanceof Error
          ? {
              message: error.message,
              stack: error.stack,
              name: error.name,
            }
          : String(error)
      );
    }
  } else {
    console.log(
      `[Conversation Logger] Skipping writeToWorkingMemory for conversation ${conversationId} - no truly new messages (${newMessages.length} messages were all duplicates)`
    );
  }
}
