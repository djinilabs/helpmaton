import { callAgentNonStreaming } from "../../http/utils/agentCallNonStreaming";
import { enqueueCostVerificationIfNeeded } from "../../http/utils/generationCreditManagement";
import {
  isByokAuthenticationError,
  normalizeByokError,
  handleCreditErrors,
  logErrorDetails,
} from "../../http/utils/generationErrorHandling";
import { trackSuccessfulRequest } from "../../http/utils/generationRequestTracking";
import { reconstructToolCallsFromResults } from "../../http/utils/generationToolReconstruction";
import { buildConversationMessagesFromObserver } from "../../http/utils/llmObserver";
import { convertTextToUIMessage } from "../../http/utils/messageConversion";
import {
  createRequestTimeout,
  cleanupRequestTimeout,
  isTimeoutError,
  createTimeoutError,
} from "../../http/utils/requestTimeout";
import {
  formatToolCallMessage,
  formatToolResultMessage,
} from "../../http/utils/toolFormatting";
import { database } from "../../tables";
import {
  isMessageContentEmpty,
  startConversation,
  buildConversationErrorInfo,
} from "../../utils/conversationLogger";
import type { UIMessage } from "../../utils/messageTypes";
import { Sentry, ensureError } from "../../utils/sentry";
import { trackBusinessEvent } from "../../utils/tracking";
import { getTransactionBuffer, type AugmentedContext } from "../../utils/workspaceCreditContext";
import { updateTransactionBufferConversationId } from "../../utils/workspaceCreditTransactions";

type ToolingExtraction = {
  toolCallsFromResult: unknown[];
  toolResultsFromResult: unknown[];
  reasoningFromSteps: Array<{ type: "reasoning"; text: string }>;
};

async function persistWebhookConversationError(options: {
  db: Awaited<ReturnType<typeof database>>;
  workspaceId: string;
  agentId: string;
  uiMessage: UIMessage;
  usesByok?: boolean;
  finalModelName?: string;
  error: unknown;
  awsRequestId?: string;
}): Promise<void> {
  try {
    const messages = [options.uiMessage].filter(
      (msg) => !isMessageContentEmpty(msg)
    );

    if (options.usesByok) {
      type ErrorWithCustomFields = Error & {
        data?: { error?: { message?: string } };
        statusCode?: number;
        response?: { data?: { error?: { message?: string } } };
      };
      const errorAny =
        options.error instanceof Error
          ? (options.error as ErrorWithCustomFields)
          : undefined;

      const causeAny =
        options.error instanceof Error && options.error.cause instanceof Error
          ? (options.error.cause as ErrorWithCustomFields)
          : undefined;
      console.log("[Webhook Task] BYOK error before extraction:", {
        errorType:
          options.error instanceof Error
            ? options.error.constructor.name
            : typeof options.error,
        errorName: options.error instanceof Error ? options.error.name : "N/A",
        errorMessage:
          options.error instanceof Error
            ? options.error.message
            : String(options.error),
        hasData: !!errorAny?.data,
        dataError: errorAny?.data?.error,
        dataErrorMessage: errorAny?.data?.error?.message,
        hasCause: options.error instanceof Error && !!options.error.cause,
        causeType:
          options.error instanceof Error && options.error.cause instanceof Error
            ? options.error.cause.constructor.name
            : undefined,
        causeMessage:
          options.error instanceof Error && options.error.cause instanceof Error
            ? options.error.cause.message
            : undefined,
        causeData: causeAny?.data?.error?.message,
      });
    }

    const errorInfo = buildConversationErrorInfo(options.error, {
      provider: "openrouter",
      modelName: options.finalModelName,
      endpoint: "webhook",
      metadata: {
        usesByok: options.usesByok,
      },
    });

    if (options.usesByok) {
      console.log("[Webhook Task] BYOK error after extraction:", {
        message: errorInfo.message,
        name: errorInfo.name,
        code: errorInfo.code,
        statusCode: errorInfo.statusCode,
      });
    }

    await startConversation(options.db, {
      workspaceId: options.workspaceId,
      agentId: options.agentId,
      conversationType: "webhook",
      messages,
      usesByok: options.usesByok,
      error: errorInfo,
      awsRequestId: options.awsRequestId,
    });
  } catch (logError) {
    console.error("[Webhook Task] Failed to persist conversation error:", {
      workspaceId: options.workspaceId,
      agentId: options.agentId,
      originalError:
        options.error instanceof Error
          ? options.error.message
          : String(options.error),
      logError: logError instanceof Error ? logError.message : String(logError),
    });
    Sentry.captureException(ensureError(logError), {
      tags: {
        context: "conversation-logging",
        operation: "persist-error",
        handler: "webhook",
      },
    });
  }
}

function extractToolingFromResult(options: {
  rawResult: unknown;
  generationStartTime: number;
  generationStartedAt: string;
}): ToolingExtraction {
  const { rawResult, generationStartTime, generationStartedAt } = options;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK generateText result types are complex
  const resultAny = rawResult as any;
  const stepsValue = Array.isArray(resultAny.steps)
    ? resultAny.steps
    : resultAny._steps?.status?.value;

  const toolCallsFromSteps: unknown[] = [];
  const toolResultsFromSteps: unknown[] = [];
  const reasoningFromSteps: Array<{ type: "reasoning"; text: string }> = [];
  const toolCallStartTimes = new Map<string, number>();

  if (Array.isArray(stepsValue)) {
    for (const step of stepsValue) {
      if (step?.content && Array.isArray(step.content)) {
        for (const contentItem of step.content) {
          if (
            typeof contentItem === "object" &&
            contentItem !== null &&
            "type" in contentItem
          ) {
            if (contentItem.type === "tool-call") {
              if (
                contentItem.toolCallId &&
                contentItem.toolName &&
                typeof contentItem.toolCallId === "string" &&
                typeof contentItem.toolName === "string"
              ) {
                const toolCallStartTime = generationStartTime;
                toolCallStartTimes.set(
                  contentItem.toolCallId,
                  toolCallStartTime
                );
                toolCallsFromSteps.push({
                  toolCallId: contentItem.toolCallId,
                  toolName: contentItem.toolName,
                  args: contentItem.input || contentItem.args || {},
                  toolCallStartedAt: generationStartedAt,
                });
              } else {
                console.warn(
                  "[Webhook Task] Skipping tool call with missing/invalid fields:",
                  {
                    hasToolCallId: !!contentItem.toolCallId,
                    hasToolName: !!contentItem.toolName,
                    toolCallIdType: typeof contentItem.toolCallId,
                    toolNameType: typeof contentItem.toolName,
                    contentItem,
                  }
                );
              }
            } else if (contentItem.type === "tool-result") {
              if (
                contentItem.toolCallId &&
                contentItem.toolName &&
                typeof contentItem.toolCallId === "string" &&
                typeof contentItem.toolName === "string"
              ) {
                let resultValue = contentItem.output;
                if (
                  typeof resultValue === "object" &&
                  resultValue !== null &&
                  "value" in resultValue
                ) {
                  resultValue = resultValue.value;
                }
                const toolCallStartTime = toolCallStartTimes.get(
                  contentItem.toolCallId
                );
                let toolExecutionTimeMs: number | undefined;
                if (toolCallStartTime !== undefined) {
                  // non-streaming doesn't expose per-tool timing
                }
                toolResultsFromSteps.push({
                  toolCallId: contentItem.toolCallId,
                  toolName: contentItem.toolName,
                  output: resultValue || contentItem.output || contentItem.result,
                  result: resultValue || contentItem.result,
                  ...(toolExecutionTimeMs !== undefined && {
                    toolExecutionTimeMs,
                  }),
                });
              } else {
                console.warn(
                  "[Webhook Task] Skipping tool result with missing/invalid fields:",
                  {
                    hasToolCallId: !!contentItem.toolCallId,
                    hasToolName: !!contentItem.toolName,
                    toolCallIdType: typeof contentItem.toolCallId,
                    toolNameType: typeof contentItem.toolName,
                    contentItem,
                  }
                );
              }
            } else if (
              contentItem.type === "reasoning" &&
              "text" in contentItem &&
              typeof contentItem.text === "string"
            ) {
              reasoningFromSteps.push({
                type: "reasoning",
                text: contentItem.text,
              });
            }
          }
        }
      }
    }
  }

  const toolCallsFromResult =
    toolCallsFromSteps.length > 0
      ? toolCallsFromSteps
      : (rawResult as { toolCalls?: unknown[] }).toolCalls || [];
  const toolResultsFromResult =
    toolResultsFromSteps.length > 0
      ? toolResultsFromSteps
      : (rawResult as { toolResults?: unknown[] }).toolResults || [];

  console.log("[Webhook Task] Tool calls extracted from result:", {
    toolCallsCount: toolCallsFromResult.length,
    toolCalls: toolCallsFromResult,
    toolResultsCount: toolResultsFromResult.length,
    toolResults: toolResultsFromResult,
    resultKeys: rawResult ? Object.keys(rawResult as object) : [],
    hasToolCalls: rawResult && "toolCalls" in (rawResult as object),
    hasToolResults: rawResult && "toolResults" in (rawResult as object),
    hasSteps: "steps" in resultAny,
    has_steps: "_steps" in resultAny,
    stepsCount: Array.isArray(stepsValue) ? stepsValue.length : 0,
    toolCallsFromStepsCount: toolCallsFromSteps.length,
    toolResultsFromStepsCount: toolResultsFromSteps.length,
  });

  return {
    toolCallsFromResult,
    toolResultsFromResult,
    reasoningFromSteps,
  };
}

function buildAssistantContent(options: {
  reasoningFromSteps: Array<{ type: "reasoning"; text: string }>;
  toolCallsFromResult: unknown[];
  toolResultsFromResult: unknown[];
  responseContent: string;
}): Array<
  | { type: "text"; text: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      result: unknown;
    }
  | { type: "reasoning"; text: string }
  | {
      type: "delegation";
      toolCallId: string;
      callingAgentId: string;
      targetAgentId: string;
      targetConversationId?: string;
      status: "completed" | "failed" | "cancelled";
      timestamp: string;
      taskId?: string;
    }
> {
  const {
    reasoningFromSteps,
    toolCallsFromResult,
    toolResultsFromResult,
    responseContent,
  } = options;
  const assistantContent: Array<
    | { type: "text"; text: string }
    | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        args: unknown;
      }
    | {
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        result: unknown;
      }
    | { type: "reasoning"; text: string }
    | {
        type: "delegation";
        toolCallId: string;
        callingAgentId: string;
        targetAgentId: string;
        targetConversationId?: string;
        status: "completed" | "failed" | "cancelled";
        timestamp: string;
        taskId?: string;
      }
  > = [];

  assistantContent.push(...reasoningFromSteps);

  const toolCallMessages = toolCallsFromResult.map(formatToolCallMessage);
  const toolResultMessages = toolResultsFromResult.map(formatToolResultMessage);

  for (const toolCallMsg of toolCallMessages) {
    if (Array.isArray(toolCallMsg.content)) {
      assistantContent.push(...toolCallMsg.content);
    }
  }

  for (const toolResultMsg of toolResultMessages) {
    if (Array.isArray(toolResultMsg.content)) {
      for (const contentItem of toolResultMsg.content) {
        assistantContent.push(contentItem as (typeof assistantContent)[number]);
      }
    }
  }

  if (responseContent && responseContent.trim().length > 0) {
    assistantContent.push({ type: "text", text: responseContent });
  }

  return assistantContent;
}

async function logWebhookConversation(options: {
  db: Awaited<ReturnType<typeof database>>;
  workspaceId: string;
  agentId: string;
  uiMessage: UIMessage;
  assistantMessage: UIMessage;
  agentResult: Awaited<ReturnType<typeof callAgentNonStreaming>>;
  conversationId: string;
  usesByok?: boolean;
  finalModelName: string;
  generationTimeMs: number;
  awsRequestId?: string;
  context: AugmentedContext | undefined;
}): Promise<void> {
  const {
    db,
    workspaceId,
    agentId,
    uiMessage,
    assistantMessage,
    agentResult,
    conversationId,
    usesByok,
    finalModelName,
    generationTimeMs,
    awsRequestId,
    context,
  } = options;

  const observerMessages = agentResult.observerEvents
    ? buildConversationMessagesFromObserver({
        observerEvents: agentResult.observerEvents,
        fallbackInputMessages: [uiMessage],
        fallbackAssistantText: agentResult.text,
        assistantMeta: {
          tokenUsage: agentResult.tokenUsage,
          modelName: finalModelName,
          provider: "openrouter",
          openrouterGenerationId: agentResult.openrouterGenerationId,
          provisionalCostUsd: agentResult.provisionalCostUsd,
          generationTimeMs,
        },
      })
    : null;

  const observerHasAssistantContent = observerMessages?.some((msg) => {
    if (msg.role !== "assistant") {
      return false;
    }
    if (Array.isArray(msg.content)) {
      return msg.content.length > 0;
    }
    return typeof msg.content === "string" && msg.content.trim().length > 0;
  });

  const messagesForLogging: UIMessage[] =
    observerMessages && observerHasAssistantContent
      ? observerMessages
      : [uiMessage, assistantMessage];

  const validMessages: UIMessage[] = messagesForLogging.filter(
    (msg): msg is UIMessage =>
      msg != null &&
      typeof msg === "object" &&
      "role" in msg &&
      typeof msg.role === "string" &&
      (msg.role === "user" ||
        msg.role === "assistant" ||
        msg.role === "system" ||
        msg.role === "tool") &&
      "content" in msg
  );

  console.log("[Webhook Task] Messages being passed to startConversation:", {
    messagesForLoggingCount: messagesForLogging.length,
    validMessagesCount: validMessages.length,
    assistantMessageInValid: validMessages.some((msg) => msg.role === "assistant"),
    messages: validMessages.map((msg) => ({
      role: msg.role,
      contentType: typeof msg.content,
      isArray: Array.isArray(msg.content),
      contentLength: Array.isArray(msg.content)
        ? msg.content.length
        : "N/A",
      hasToolCalls: Array.isArray(msg.content)
        ? msg.content.some(
            (item) =>
              typeof item === "object" &&
              item !== null &&
              "type" in item &&
              item.type === "tool-call"
          )
        : false,
      hasToolResults: Array.isArray(msg.content)
        ? msg.content.some(
            (item) =>
              typeof item === "object" &&
              item !== null &&
              "type" in item &&
              item.type === "tool-result"
          )
        : false,
    })),
  });

  const createdConversationId = await startConversation(db, {
    workspaceId,
    agentId,
    conversationId,
    conversationType: "webhook",
    messages: validMessages,
    tokenUsage: agentResult.tokenUsage,
    usesByok,
    awsRequestId,
  });

  if (createdConversationId !== conversationId) {
    console.warn(
      "[Webhook Task] ConversationId mismatch - this should not happen:",
      {
        expected: conversationId,
        actual: createdConversationId,
      }
    );
  }

  if (context) {
    const buffer = getTransactionBuffer(context);
    if (buffer) {
      updateTransactionBufferConversationId(
        buffer,
        conversationId,
        workspaceId
      );
    }
  }

  await enqueueCostVerificationIfNeeded(
    agentResult.openrouterGenerationId,
    agentResult.openrouterGenerationIds,
    workspaceId,
    undefined,
    conversationId,
    agentId,
    "webhook"
  );
}

export async function processWebhookTask(options: {
  workspaceId: string;
  agentId: string;
  bodyText: string;
  conversationId: string;
  subscriptionId?: string;
  context: AugmentedContext;
  awsRequestId?: string;
}): Promise<void> {
  const {
    workspaceId,
    agentId,
    bodyText,
    conversationId,
    subscriptionId,
    context,
    awsRequestId,
  } = options;

  const uiMessage = convertTextToUIMessage(bodyText);

  const db = await database();
  let agentResult: Awaited<ReturnType<typeof callAgentNonStreaming>>;
  let usesByok: boolean | undefined;
  let finalModelName: string | undefined;

  const requestTimeout = createRequestTimeout();
  try {
    const generationStartTime = Date.now();
    const generationStartedAt = new Date().toISOString();
    agentResult = await callAgentNonStreaming(workspaceId, agentId, bodyText, {
      modelReferer: "http://localhost:3000/api/webhook",
      context,
      endpointType: "webhook",
      conversationId,
      abortSignal: requestTimeout.signal,
    });
    const generationTimeMs = Date.now() - generationStartTime;
    const generationEndedAt = new Date().toISOString();

    await trackSuccessfulRequest(
      subscriptionId,
      workspaceId,
      agentId,
      "webhook"
    );

    const { setupAgentAndTools } = await import("../../http/utils/agentSetup");
    const { agent, usesByok: agentUsesByok } = await setupAgentAndTools(
      workspaceId,
      agentId,
      [],
      {
        modelReferer: "http://localhost:3000/api/webhook",
        callDepth: 0,
        maxDelegationDepth: 3,
        context,
      }
    );
    usesByok = agentUsesByok;
    finalModelName =
      typeof agent.modelName === "string"
        ? agent.modelName
        : "openrouter/gemini-2.0-flash-exp";

    const responseContent = agentResult.text;

    let tooling: ToolingExtraction;
    try {
      if (!agentResult.rawResult) {
        throw new Error("Raw result not available from agent call");
      }
      tooling = extractToolingFromResult({
        rawResult: agentResult.rawResult,
        generationStartTime,
        generationStartedAt,
      });
    } catch (resultError) {
      if (isByokAuthenticationError(resultError, usesByok)) {
        const errorToLog = normalizeByokError(resultError);
        await persistWebhookConversationError({
          db,
          workspaceId,
          agentId,
          uiMessage,
          usesByok,
          finalModelName,
          error: errorToLog,
        });
        cleanupRequestTimeout(requestTimeout);
        return;
      }
      await persistWebhookConversationError({
        db,
        workspaceId,
        agentId,
        uiMessage,
        usesByok,
        finalModelName,
        error: resultError,
        awsRequestId,
      });
      cleanupRequestTimeout(requestTimeout);
      throw resultError;
    }

    if (
      tooling.toolCallsFromResult.length === 0 &&
      tooling.toolResultsFromResult.length > 0
    ) {
      tooling.toolCallsFromResult = reconstructToolCallsFromResults(
        tooling.toolResultsFromResult,
        "Webhook Task"
      ) as unknown as typeof tooling.toolCallsFromResult;
    }

    const assistantContent = buildAssistantContent({
      reasoningFromSteps: tooling.reasoningFromSteps,
      toolCallsFromResult: tooling.toolCallsFromResult,
      toolResultsFromResult: tooling.toolResultsFromResult,
      responseContent,
    });

    console.log("[Webhook Task] Assistant content before message creation:", {
      assistantContentLength: assistantContent.length,
      assistantContent: assistantContent,
      hasToolCalls: assistantContent.some(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "tool-call"
      ),
      hasToolResults: assistantContent.some(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "tool-result"
      ),
    });

    const assistantMessage: UIMessage = {
      role: "assistant",
      content:
        assistantContent.length > 0 ? assistantContent : responseContent || "",
      ...(agentResult.tokenUsage && { tokenUsage: agentResult.tokenUsage }),
      modelName: finalModelName,
      provider: "openrouter",
      ...(agentResult.openrouterGenerationId && {
        openrouterGenerationId: agentResult.openrouterGenerationId,
      }),
      ...(agentResult.provisionalCostUsd !== undefined && {
        provisionalCostUsd: agentResult.provisionalCostUsd,
      }),
      ...(Number.isFinite(generationTimeMs) ? { generationTimeMs } : {}),
      ...(generationStartedAt && { generationStartedAt }),
      ...(generationEndedAt && { generationEndedAt }),
    };

    console.log("[Webhook Task] Final assistant message:", {
      role: assistantMessage.role,
      contentType: typeof assistantMessage.content,
      isArray: Array.isArray(assistantMessage.content),
      contentLength: Array.isArray(assistantMessage.content)
        ? assistantMessage.content.length
        : "N/A",
      content: assistantMessage.content,
      hasToolCallsInContent: Array.isArray(assistantMessage.content)
        ? assistantMessage.content.some(
            (item) =>
              typeof item === "object" &&
              item !== null &&
              "type" in item &&
              item.type === "tool-call"
          )
        : false,
      hasToolResultsInContent: Array.isArray(assistantMessage.content)
        ? assistantMessage.content.some(
            (item) =>
              typeof item === "object" &&
              item !== null &&
              "type" in item &&
              item.type === "tool-result"
          )
        : false,
    });

    try {
      await logWebhookConversation({
        db,
        workspaceId,
        agentId,
        uiMessage,
        assistantMessage,
        agentResult,
        conversationId,
        usesByok,
        finalModelName,
        generationTimeMs,
        awsRequestId,
        context,
      });
    } catch (error) {
      console.error("[Webhook Task] Error logging conversation:", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      Sentry.captureException(ensureError(error), {
        tags: {
          endpoint: "webhook",
          operation: "conversation_logging",
        },
        extra: {
          workspaceId,
          agentId,
        },
      });
    }

    trackBusinessEvent(
      "webhook",
      "called",
      {
        workspace_id: workspaceId,
        agent_id: agentId,
      },
      undefined
    );

    cleanupRequestTimeout(requestTimeout);
  } catch (error) {
    cleanupRequestTimeout(requestTimeout);

    if (isTimeoutError(error)) {
      const timeoutError = createTimeoutError();
      await persistWebhookConversationError({
        db,
        workspaceId,
        agentId,
        uiMessage,
        usesByok,
        finalModelName,
        error: timeoutError,
        awsRequestId,
      });
      return;
    }

    logErrorDetails(error, {
      workspaceId,
      agentId,
      usesByok,
      endpoint: "webhook",
    });

    const errorToLog = normalizeByokError(error);

    try {
      const { setupAgentAndTools } = await import("../../http/utils/agentSetup");
      const { agent, usesByok: agentUsesByok } = await setupAgentAndTools(
        workspaceId,
        agentId,
        [],
        {
          modelReferer: "http://localhost:3000/api/webhook",
          callDepth: 0,
          maxDelegationDepth: 3,
          context,
        }
      );
      usesByok = agentUsesByok;
      finalModelName =
        typeof agent.modelName === "string"
          ? agent.modelName
          : "openrouter/gemini-2.0-flash-exp";
    } catch {
      usesByok = undefined;
      finalModelName = undefined;
    }

    await persistWebhookConversationError({
      db,
      workspaceId,
      agentId,
      uiMessage,
      usesByok,
      finalModelName,
      error: errorToLog,
      awsRequestId,
    });

    if (usesByok !== undefined && isByokAuthenticationError(error, usesByok)) {
      return;
    }

    const creditErrorResult = await handleCreditErrors(
      error,
      workspaceId,
      "webhook"
    );
    if (creditErrorResult.handled) {
      return;
    }

    throw error;
  }
}
