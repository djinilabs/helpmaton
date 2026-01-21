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

type ErrorWithCustomFields = Error & {
  data?: { error?: { message?: string; code?: unknown }; message?: string };
  statusCode?: number;
  responseBody?: string | unknown;
  response?: {
    data?: { error?: { message?: string; code?: unknown } };
    status?: number;
    statusCode?: number;
  };
  status?: number;
  code?: string | number;
};

const GENERIC_MESSAGE_MARKERS = ["no output generated", "check the stream"];

function isGenericWrapperError(err: Error): boolean {
  const name = err.name.toLowerCase();
  const msg = err.message.toLowerCase();
  return (
    name.includes("nooutputgeneratederror") ||
    name.includes("no_output_generated_error") ||
    msg.includes("no output generated") ||
    msg.includes("check the stream for errors") ||
    msg.includes("check the stream")
  );
}

function isGenericMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return GENERIC_MESSAGE_MARKERS.some((marker) => lower.includes(marker));
}

function extractMessageFromResponseBody(
  responseBody: unknown
): string | undefined {
  if (typeof responseBody !== "string") return undefined;
  try {
    const body = JSON.parse(responseBody) as Record<string, unknown>;
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
    return undefined;
  }
  return undefined;
}

function extractMessageFromError(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const errorAny = err as ErrorWithCustomFields;

  if (
    errorAny.data?.error?.message &&
    typeof errorAny.data.error.message === "string" &&
    errorAny.data.error.message.length > 0
  ) {
    return errorAny.data.error.message;
  }

  const responseBodyMessage = extractMessageFromResponseBody(
    errorAny.responseBody
  );
  if (responseBodyMessage) {
    return responseBodyMessage;
  }

  if (
    errorAny.response?.data?.error?.message &&
    typeof errorAny.response.data.error.message === "string" &&
    errorAny.response.data.error.message.length > 0
  ) {
    return errorAny.response.data.error.message;
  }

  if (
    errorAny.data?.message &&
    typeof errorAny.data.message === "string" &&
    errorAny.data.message.length > 0
  ) {
    return errorAny.data.message;
  }

  return undefined;
}

function hasGoodMessage(message: string): boolean {
  return message.length > 30 && !isGenericMessage(message);
}

function shouldPreferCauseMessage(
  currentMessage: string,
  causeMessage: string
): boolean {
  const isCurrentMessageGeneric =
    isGenericMessage(currentMessage) || currentMessage.length < 30;
  return (
    isCurrentMessageGeneric ||
    (causeMessage.length > currentMessage.length &&
      !currentMessage.includes(causeMessage))
  );
}

function resolveWrapperCauseMessage(error: Error): {
  message?: string;
  specificError?: Error;
  source?: "dataErrorMessage" | "responseBody";
} {
  if (!error.cause) return {};

  const causeAny =
    error.cause instanceof Error
      ? (error.cause as ErrorWithCustomFields)
      : undefined;

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
    return {
      message: causeAny.data.error.message,
      specificError: error.cause instanceof Error ? error.cause : undefined,
      source: "dataErrorMessage",
    };
  }

  const causeResponseBodyMsg = extractMessageFromError(error.cause);
  if (causeResponseBodyMsg) {
    return {
      message: causeResponseBodyMsg,
      specificError: error.cause instanceof Error ? error.cause : undefined,
      source: "responseBody",
    };
  }

  return {};
}

function resolveCauseMessage(
  error: Error,
  currentMessage: string
): { message?: string; specificError?: Error } {
  if (!error.cause) return {};

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
    error.cause instanceof Error
      ? (error.cause as ErrorWithCustomFields)
      : undefined;

  console.log("[buildConversationErrorInfo] Cause structure:", {
    hasData: !!causeAny?.data,
    hasDataError: !!causeAny?.data?.error,
    hasDataErrorMessage: !!causeAny?.data?.error?.message,
    dataErrorMessage: causeAny?.data?.error?.message,
  });

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
    causeMessage = extractMessageFromError(error.cause);
    if (causeMessage) {
      console.log(
        "[buildConversationErrorInfo] Found cause message from extractFromError:",
        causeMessage
      );
    }
  }

  if (!causeMessage) {
    console.log("[buildConversationErrorInfo] No message found in cause");
    return {};
  }

  if (shouldPreferCauseMessage(currentMessage, causeMessage)) {
    console.log(
      "[buildConversationErrorInfo] Using cause message (was generic or cause is better)"
    );
    return {
      message: causeMessage,
      specificError: error.cause instanceof Error ? error.cause : undefined,
    };
  }

  console.log(
    "[buildConversationErrorInfo] Keeping current message (not generic and better than cause)"
  );
  return {};
}

function resolveWrapperChainMessage(
  error: Error,
  currentMessage: string
): { message?: string; specificError?: Error } {
  if (!isGenericWrapperError(error)) return {};

  console.log("[buildConversationErrorInfo] Detected generic wrapper error:", {
    errorName: error.name,
    errorMessage: error.message,
    currentExtractedMessage: currentMessage,
  });

  const hasGoodMessageValue = hasGoodMessage(currentMessage);

  console.log("[buildConversationErrorInfo] Wrapper handling - hasGoodMessage:", {
    hasGoodMessage: hasGoodMessageValue,
  });

  let message = currentMessage;
  let specificError: Error | undefined;

  if (!hasGoodMessageValue && error.cause) {
    console.log(
      "[buildConversationErrorInfo] Wrapper: Checking cause (no good message yet)"
    );

    const causeAny =
      error.cause instanceof Error
        ? (error.cause as ErrorWithCustomFields)
        : undefined;

    console.log("[buildConversationErrorInfo] Wrapper cause structure:", {
      hasData: !!causeAny?.data,
      hasDataError: !!causeAny?.data?.error,
      hasDataErrorMessage: !!causeAny?.data?.error?.message,
      dataErrorMessage: causeAny?.data?.error?.message,
    });

    const causeMsg = extractMessageFromError(error.cause);
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

    if (error.cause instanceof Error && !hasGoodMessageValue) {
      let currentCause: unknown = error.cause.cause;
      let depth = 0;
      const maxDepth = 10;

      while (currentCause && depth < maxDepth) {
        const causeMsg = extractMessageFromError(currentCause);
        if (
          causeMsg &&
          causeMsg.length > message.length &&
          !isGenericMessage(causeMsg)
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
            !isGenericWrapperError(currentCause)
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

  if (!hasGoodMessageValue && isGenericMessage(message)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorAny = error as any;
    const errorProps = [
      "error",
      "err",
      "originalError",
      "underlyingError",
      "rootCause",
    ];

    for (const prop of errorProps) {
      if (errorAny[prop]) {
        const propMsg = extractMessageFromError(errorAny[prop]);
        if (propMsg && propMsg.length > 0 && !isGenericMessage(propMsg)) {
          message = propMsg;
          if (errorAny[prop] instanceof Error) {
            specificError = errorAny[prop];
          }
          break;
        }
      }
    }
  }

  if (message !== currentMessage) {
    return { message, specificError };
  }

  return {};
}

function resolveNonWrapperChainMessage(
  error: Error,
  currentMessage: string
): { message?: string; specificError?: Error } {
  let message = currentMessage;
  let specificError: Error | undefined;

  if (error.cause) {
    let currentCause: unknown = error.cause;
    let depth = 0;
    const maxDepth = 10;

    while (currentCause && depth < maxDepth) {
      if (currentCause instanceof Error) {
        const causeMessage = currentCause.message;
        if (
          causeMessage &&
          causeMessage.length > message.length &&
          !isGenericWrapperError(currentCause)
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

  const nestedMessage =
    extractMessageFromError(error) ||
    (error.cause ? extractMessageFromError(error.cause) : undefined);

  if (
    nestedMessage &&
    (nestedMessage.length > message.length ||
      (!message.includes(nestedMessage) &&
        !nestedMessage.toLowerCase().includes("no output generated")))
  ) {
    message = nestedMessage;
  }

  if (message !== currentMessage) {
    return { message, specificError };
  }

  return {};
}

function extractCodeFromError(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const errorAny = err as ErrorWithCustomFields;

  if (errorAny.data?.error?.code !== undefined && errorAny.data.error.code !== null) {
    return String(errorAny.data.error.code);
  }

  if (typeof errorAny.code === "string") {
    return errorAny.code;
  }
  if (typeof errorAny.code === "number") {
    return String(errorAny.code);
  }

  if (typeof errorAny.responseBody === "string") {
    try {
      const body = JSON.parse(errorAny.responseBody) as Record<string, unknown>;
      if (body.error && typeof body.error === "object" && body.error !== null) {
        const errorObj = body.error as Record<string, unknown>;
        if (errorObj.code !== undefined && errorObj.code !== null) {
          return String(errorObj.code);
        }
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function extractStatusCodeFromError(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const errorAny = err as ErrorWithCustomFields;

  if (typeof errorAny.statusCode === "number") {
    return errorAny.statusCode;
  }

  if (typeof errorAny.status === "number") {
    return errorAny.status;
  }

  if (
    typeof errorAny.data?.error?.code === "number" &&
    errorAny.data.error.code >= 400 &&
    errorAny.data.error.code < 600
  ) {
    return errorAny.data.error.code;
  }

  if (typeof errorAny.response?.status === "number") {
    return errorAny.response.status;
  }

  if (typeof errorAny.response?.statusCode === "number") {
    return errorAny.response.statusCode;
  }

  if (typeof errorAny.responseBody === "string") {
    try {
      const body = JSON.parse(errorAny.responseBody) as Record<string, unknown>;
      if (body.error && typeof body.error === "object" && body.error !== null) {
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
      return undefined;
    }
  }

  return undefined;
}

function extractApiErrorDetails(
  data: unknown
): { message?: string; code?: string } {
  if (!data || typeof data !== "object") return {};
  const responseData = data as Record<string, unknown>;
  let apiErrorMessage: string | undefined;
  let apiErrorCode: string | undefined;

  if (responseData.error) {
    if (typeof responseData.error === "object" && responseData.error !== null) {
      const errorObj = responseData.error as Record<string, unknown>;
      apiErrorMessage =
        (typeof errorObj.message === "string" ? errorObj.message : undefined) ||
        (typeof errorObj.error === "string" ? errorObj.error : undefined);
      if (errorObj.code !== undefined && errorObj.code !== null) {
        apiErrorCode = String(errorObj.code);
      }
    } else if (typeof responseData.error === "string") {
      apiErrorMessage = responseData.error;
    }
  }

  if (!apiErrorMessage && typeof responseData.message === "string") {
    apiErrorMessage = responseData.message;
  }

  return {
    message: apiErrorMessage,
    code: apiErrorCode,
  };
}

function applyApiErrorDetails(params: {
  message: string;
  currentCode?: string;
  data: unknown;
}): { message: string; code?: string } {
  const { message: currentMessage, currentCode, data } = params;
  const { message: apiErrorMessage, code: apiErrorCode } =
    extractApiErrorDetails(data);

  let message = currentMessage;
  let code = currentCode;

  if (apiErrorCode && !code) {
    code = apiErrorCode;
  }

  if (apiErrorMessage && apiErrorMessage.length > 0) {
    const isGenericMessageValue =
      isGenericMessage(message) || message.length < 30;
    if (
      isGenericMessageValue ||
      (!message.includes(apiErrorMessage) &&
        apiErrorMessage.length > message.length)
    ) {
      message = apiErrorMessage;
    } else if (!message.includes(apiErrorMessage)) {
      message = `${message} (API: ${apiErrorMessage})`;
    }
  }

  return { message, code };
}

function cleanConversationErrorInfo(
  base: ConversationErrorInfo
): ConversationErrorInfo {
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

  return cleanErrorInfo;
}

type MessageResolution = {
  message: string;
  specificError?: Error;
  isWrapper: boolean;
  errorAny?: ErrorWithCustomFields;
};

function logErrorExtractionStart(error: unknown): void {
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
}

function logErrorStructureCheck(options: {
  error: unknown;
  isWrapper: boolean;
  errorAny?: ErrorWithCustomFields;
}): void {
  const { error, isWrapper, errorAny } = options;
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
}

function resolveMessageAndSpecificError(error: unknown): MessageResolution {
  let message = error instanceof Error ? error.message : String(error);
  let specificError: Error | undefined =
    error instanceof Error ? error : undefined;

  console.log("[buildConversationErrorInfo] Initial message:", message);

  const isWrapper = error instanceof Error && isGenericWrapperError(error);
  const errorAny =
    error instanceof Error ? (error as ErrorWithCustomFields) : undefined;

  logErrorStructureCheck({ error, isWrapper, errorAny });

  if (isWrapper && error instanceof Error && error.cause) {
    const wrapperResult = resolveWrapperCauseMessage(error);
    if (wrapperResult.message) {
      message = wrapperResult.message;
      specificError = wrapperResult.specificError ?? specificError;
      console.log(
        wrapperResult.source === "dataErrorMessage"
          ? "[buildConversationErrorInfo] Found message from cause's data.error.message:"
          : "[buildConversationErrorInfo] Found message from cause's responseBody:",
        message
      );
    }
  }

  if (!message || isGenericMessage(message)) {
    if (
      errorAny?.data?.error?.message &&
      typeof errorAny.data.error.message === "string" &&
      errorAny.data.error.message.length > 0
    ) {
      message = errorAny.data.error.message;
      console.log(
        "[buildConversationErrorInfo] Found message from original error's data.error.message:",
        message
      );
    } else {
      const extractedMessage = extractMessageFromError(error);
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

  if (
    error instanceof Error &&
    error.cause &&
    (!isWrapper || isGenericMessage(message))
  ) {
    const causeResult = resolveCauseMessage(error, message);
    if (causeResult.message) {
      message = causeResult.message;
      specificError = causeResult.specificError ?? specificError;
    }
  }

  if (error instanceof Error && isWrapper) {
    const wrapperChainResult = resolveWrapperChainMessage(error, message);
    if (wrapperChainResult.message) {
      message = wrapperChainResult.message;
      specificError = wrapperChainResult.specificError ?? specificError;
    }
  } else if (error instanceof Error) {
    const nonWrapperResult = resolveNonWrapperChainMessage(error, message);
    if (nonWrapperResult.message) {
      message = nonWrapperResult.message;
      specificError = nonWrapperResult.specificError ?? specificError;
    }
  }

  return {
    message,
    specificError,
    isWrapper,
    errorAny,
  };
}

function applyApiErrorDetailsFromData(options: {
  message: string;
  currentCode?: string;
  data: unknown;
}): { message: string; code?: string } {
  return applyApiErrorDetails({
    message: options.message,
    currentCode: options.currentCode,
    data: options.data,
  });
}

function enrichWithErrorDetails(options: {
  base: ConversationErrorInfo;
  message: string;
  errorToInspect: Error;
  originalError?: Error;
}): { base: ConversationErrorInfo; message: string } {
  const { base, errorToInspect, originalError } = options;

  base.name = errorToInspect.name;
  base.stack = errorToInspect.stack;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- error might carry custom fields
  const anyError = errorToInspect as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalAny = originalError as any;

  base.code =
    extractCodeFromError(anyError) || extractCodeFromError(originalAny) || undefined;

  base.statusCode =
    extractStatusCodeFromError(anyError) ||
    extractStatusCodeFromError(originalAny) ||
    undefined;

  let message = options.message;

  if (anyError.response?.data) {
    const updated = applyApiErrorDetailsFromData({
      message,
      currentCode: base.code,
      data: anyError.response.data,
    });
    message = updated.message;
    base.code = updated.code;
  }

  if (anyError.data) {
    const updated = applyApiErrorDetailsFromData({
      message,
      currentCode: base.code,
      data: anyError.data,
    });
    message = updated.message;
    base.code = updated.code;
  }

  if (originalAny && originalError && originalError !== errorToInspect) {
    if (originalAny.response?.data) {
      const updated = applyApiErrorDetailsFromData({
        message,
        currentCode: base.code,
        data: originalAny.response.data,
      });
      message = updated.message;
      base.code = updated.code;
    }
    if (originalAny.data) {
      const updated = applyApiErrorDetailsFromData({
        message,
        currentCode: base.code,
        data: originalAny.data,
      });
      message = updated.message;
      base.code = updated.code;
    }
  }

  base.message = message;

  return { base, message };
}

function applyStatusFromUnknownError(
  base: ConversationErrorInfo,
  error: unknown
): ConversationErrorInfo {
  if (!error || typeof error !== "object") {
    return base;
  }

  const maybeStatus =
    "statusCode" in error &&
    typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : "status" in error && typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : undefined;

  if (maybeStatus !== undefined) {
    base.statusCode = maybeStatus;
  }

  return base;
}

export function buildConversationErrorInfo(
  error: unknown,
  options?: {
    provider?: string;
    modelName?: string;
    endpoint?: string;
    metadata?: Record<string, unknown>;
  }
): ConversationErrorInfo {
  logErrorExtractionStart(error);
  const { message, specificError } = resolveMessageAndSpecificError(error);

  const base: ConversationErrorInfo = {
    message,
    occurredAt: new Date().toISOString(),
    provider: options?.provider,
    modelName: options?.modelName,
    endpoint: options?.endpoint,
    metadata: options?.metadata,
  };

  const errorToInspect =
    specificError || (error instanceof Error ? error : undefined);

  if (errorToInspect) {
    const updated = enrichWithErrorDetails({
      base,
      message,
      errorToInspect,
      originalError: error instanceof Error ? error : undefined,
    });
    updated.base.message = updated.message;
  } else {
    applyStatusFromUnknownError(base, error);
  }

  const cleanErrorInfo = cleanConversationErrorInfo(base);

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

export function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    try {
      const parsed = JSON.parse(error) as Record<string, unknown>;
      if (typeof parsed.error === "string" && parsed.error.length > 0) {
        return parsed.error;
      }
      if (typeof parsed.message === "string" && parsed.message.length > 0) {
        return parsed.message;
      }
    } catch {
      // Ignore JSON parse failures and fall back to raw string
    }
    return error;
  }
  const info = buildConversationErrorInfo(error);
  if (info.message) {
    return info.message;
  }
  return error instanceof Error ? error.message : String(error);
}
