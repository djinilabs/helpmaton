import type { DelegationContent, UIMessage } from "../../utils/messageTypes";

import {
  formatToolResultMessage,
  getToolResultValueForModel,
} from "./toolFormatting";

export type LlmObserverEvent =
  | {
      type: "input-messages";
      timestamp: string;
      messages: UIMessage[];
    }
  | {
      type: "generation-started" | "generation-ended";
      timestamp: string;
    }
  | {
      type: "tool-call";
      timestamp: string;
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "tool-result";
      timestamp: string;
      toolCallId: string;
      toolName: string;
      result: unknown;
    }
  | {
      type: "tool-execution-started";
      timestamp: string;
      toolCallId?: string;
      toolName: string;
    }
  | {
      type: "tool-execution-ended";
      timestamp: string;
      toolCallId?: string;
      toolName: string;
      result?: unknown;
      error?: string;
    }
  | {
      type: "assistant-text" | "assistant-reasoning";
      timestamp: string;
      text: string;
    }
  | {
      type: "assistant-file";
      timestamp: string;
      fileUrl: string;
      mediaType?: string;
      filename?: string;
    };

export interface LlmObserver {
  recordInputMessages: (messages: UIMessage[]) => void;
  recordGenerationStarted: () => void;
  recordGenerationEnded: () => void;
  recordToolCall: (data: {
    toolCallId: string;
    toolName: string;
    args: unknown;
    timestamp?: string;
  }) => void;
  recordToolResult: (data: {
    toolCallId: string;
    toolName: string;
    result: unknown;
    timestamp?: string;
  }) => void;
  recordToolExecutionStarted: (data: {
    toolCallId?: string;
    toolName: string;
    timestamp?: string;
  }) => void;
  recordToolExecutionEnded: (data: {
    toolCallId?: string;
    toolName: string;
    result?: unknown;
    error?: string;
    timestamp?: string;
  }) => void;
  recordText: (text: string, timestamp?: string) => void;
  recordReasoning: (text: string, timestamp?: string) => void;
  recordFilePart: (data: {
    fileUrl: string;
    mediaType?: string;
    filename?: string;
    timestamp?: string;
  }) => void;
  recordFromResult: (result: unknown) => void;
  getEvents: () => LlmObserverEvent[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeToolResultValue(toolResult: unknown): unknown {
  if (!toolResult || typeof toolResult !== "object") return toolResult;
  const resultAny = toolResult as { output?: unknown; result?: unknown };
  const outputValue =
    "output" in resultAny && resultAny.output !== undefined
      ? resultAny.output
      : "result" in resultAny && resultAny.result !== undefined
      ? resultAny.result
      : undefined;
  if (
    outputValue &&
    typeof outputValue === "object" &&
    "type" in outputValue &&
    "value" in outputValue
  ) {
    const typedOutput = outputValue as { type?: unknown; value?: unknown };
    if (typedOutput.type === "text") {
      return typeof typedOutput.value === "string"
        ? typedOutput.value
        : String(typedOutput.value ?? "");
    }
    if (typedOutput.type === "json") {
      return typedOutput.value;
    }
    return typedOutput.value ?? outputValue;
  }
  return outputValue ?? toolResult;
}

function extractToolCallsFromStep(step: unknown): Array<{
  toolCallId: string;
  toolName: string;
  args: unknown;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK step shapes vary
  const stepAny = step as any;
  const toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    args: unknown;
  }> = [];

  if (Array.isArray(stepAny?.toolCalls)) {
    for (const toolCall of stepAny.toolCalls) {
      if (toolCall?.toolCallId && toolCall?.toolName) {
        toolCalls.push({
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          args: toolCall.input ?? toolCall.args ?? {},
        });
      }
    }
  }

  if (Array.isArray(stepAny?.content)) {
    for (const contentItem of stepAny.content) {
      if (
        contentItem &&
        typeof contentItem === "object" &&
        "type" in contentItem &&
        contentItem.type === "tool-call"
      ) {
        toolCalls.push({
          toolCallId: contentItem.toolCallId,
          toolName: contentItem.toolName,
          args: contentItem.input ?? contentItem.args ?? {},
        });
      }
    }
  }

  return toolCalls;
}

function extractToolResultsFromStep(step: unknown): Array<{
  toolCallId: string;
  toolName: string;
  result: unknown;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK step shapes vary
  const stepAny = step as any;
  const toolResults: Array<{
    toolCallId: string;
    toolName: string;
    result: unknown;
  }> = [];

  if (Array.isArray(stepAny?.toolResults)) {
    for (const toolResult of stepAny.toolResults) {
      if (toolResult?.toolCallId && toolResult?.toolName) {
        toolResults.push({
          toolCallId: toolResult.toolCallId,
          toolName: toolResult.toolName,
          result: normalizeToolResultValue(toolResult),
        });
      }
    }
  }

  if (Array.isArray(stepAny?.content)) {
    for (const contentItem of stepAny.content) {
      if (
        contentItem &&
        typeof contentItem === "object" &&
        "type" in contentItem &&
        contentItem.type === "tool-result"
      ) {
        toolResults.push({
          toolCallId: contentItem.toolCallId,
          toolName: contentItem.toolName,
          result: normalizeToolResultValue(contentItem),
        });
      }
    }
  }

  return toolResults;
}

function extractReasoningFromStep(step: unknown): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK step shapes vary
  const stepAny = step as any;
  const reasoning: string[] = [];

  if (Array.isArray(stepAny?.content)) {
    for (const contentItem of stepAny.content) {
      if (
        contentItem &&
        typeof contentItem === "object" &&
        "type" in contentItem &&
        contentItem.type === "reasoning" &&
        "text" in contentItem &&
        typeof contentItem.text === "string"
      ) {
        reasoning.push(contentItem.text);
      }
    }
  }

  return reasoning;
}

function mergeCallback<TArgs extends unknown[]>(
  existing: ((...args: TArgs) => void) | undefined,
  additional: (...args: TArgs) => void
): (...args: TArgs) => void {
  if (!existing) return additional;
  return (...args: TArgs) => {
    additional(...args);
    existing(...args);
  };
}

export function createLlmObserver(): LlmObserver {
  const events: LlmObserverEvent[] = [];
  let recordedGenerationStart = false;
  let recordedGenerationEnd = false;

  const recordEvent = (event: LlmObserverEvent) => {
    events.push(event);
  };

  return {
    recordInputMessages: (messages) => {
      recordEvent({ type: "input-messages", timestamp: nowIso(), messages });
    },
    recordGenerationStarted: () => {
      if (recordedGenerationStart) return;
      recordedGenerationStart = true;
      recordEvent({ type: "generation-started", timestamp: nowIso() });
    },
    recordGenerationEnded: () => {
      if (recordedGenerationEnd) return;
      recordedGenerationEnd = true;
      recordEvent({ type: "generation-ended", timestamp: nowIso() });
    },
    recordToolCall: ({ toolCallId, toolName, args, timestamp }) => {
      recordEvent({
        type: "tool-call",
        timestamp: timestamp || nowIso(),
        toolCallId,
        toolName,
        args,
      });
    },
    recordToolResult: ({ toolCallId, toolName, result, timestamp }) => {
      recordEvent({
        type: "tool-result",
        timestamp: timestamp || nowIso(),
        toolCallId,
        toolName,
        result,
      });
    },
    recordToolExecutionStarted: ({ toolCallId, toolName, timestamp }) => {
      recordEvent({
        type: "tool-execution-started",
        timestamp: timestamp || nowIso(),
        toolCallId,
        toolName,
      });
    },
    recordToolExecutionEnded: ({
      toolCallId,
      toolName,
      result,
      error,
      timestamp,
    }) => {
      recordEvent({
        type: "tool-execution-ended",
        timestamp: timestamp || nowIso(),
        toolCallId,
        toolName,
        result,
        error,
      });
    },
    recordText: (text, timestamp) => {
      if (text === undefined || text === null) return;
      recordEvent({
        type: "assistant-text",
        timestamp: timestamp || nowIso(),
        text,
      });
    },
    recordReasoning: (text, timestamp) => {
      if (text === undefined || text === null) return;
      recordEvent({
        type: "assistant-reasoning",
        timestamp: timestamp || nowIso(),
        text,
      });
    },
    recordFilePart: (data) => {
      recordEvent({
        type: "assistant-file",
        timestamp: data.timestamp || nowIso(),
        fileUrl: data.fileUrl,
        ...(data.mediaType && { mediaType: data.mediaType }),
        ...(data.filename && { filename: data.filename }),
      });
    },
    recordFromResult: (result) => {
      if (!result || typeof result !== "object") return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK result shapes vary
      const resultAny = result as any;
      const toolCallSignatures = new Set<string>();
      const toolResultSignatures = new Set<string>();

      const stepsValue = Array.isArray(resultAny.steps)
        ? resultAny.steps
        : resultAny._steps?.status?.value;
      if (Array.isArray(stepsValue)) {
        for (const step of stepsValue) {
          for (const toolCall of extractToolCallsFromStep(step)) {
            const signature = `${toolCall.toolCallId}:${toolCall.toolName}`;
            if (toolCallSignatures.has(signature)) {
              continue;
            }
            toolCallSignatures.add(signature);
            recordEvent({
              type: "tool-call",
              timestamp: nowIso(),
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              args: toolCall.args,
            });
          }
          for (const toolResult of extractToolResultsFromStep(step)) {
            const signature = `${toolResult.toolCallId}:${toolResult.toolName}`;
            if (toolResultSignatures.has(signature)) {
              continue;
            }
            toolResultSignatures.add(signature);
            recordEvent({
              type: "tool-result",
              timestamp: nowIso(),
              toolCallId: toolResult.toolCallId,
              toolName: toolResult.toolName,
              result: toolResult.result,
            });
          }
          for (const reasoningText of extractReasoningFromStep(step)) {
            recordEvent({
              type: "assistant-reasoning",
              timestamp: nowIso(),
              text: reasoningText,
            });
          }
        }
      }

      if (Array.isArray(resultAny?.toolCalls)) {
        for (const toolCall of resultAny.toolCalls) {
          if (toolCall?.toolCallId && toolCall?.toolName) {
            const signature = `${toolCall.toolCallId}:${toolCall.toolName}`;
            if (toolCallSignatures.has(signature)) {
              continue;
            }
            toolCallSignatures.add(signature);
            recordEvent({
              type: "tool-call",
              timestamp: nowIso(),
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              args: toolCall.input ?? toolCall.args ?? {},
            });
          }
        }
      }

      if (Array.isArray(resultAny?.toolResults)) {
        for (const toolResult of resultAny.toolResults) {
          if (toolResult?.toolCallId && toolResult?.toolName) {
            const signature = `${toolResult.toolCallId}:${toolResult.toolName}`;
            if (toolResultSignatures.has(signature)) {
              continue;
            }
            toolResultSignatures.add(signature);
            recordEvent({
              type: "tool-result",
              timestamp: nowIso(),
              toolCallId: toolResult.toolCallId,
              toolName: toolResult.toolName,
              result: normalizeToolResultValue(toolResult),
            });
          }
        }
      }

      const text =
        typeof resultAny.text === "string"
          ? resultAny.text
          : typeof resultAny?.outputText === "string"
          ? resultAny.outputText
          : undefined;
      if (typeof text === "string") {
        recordEvent({
          type: "assistant-text",
          timestamp: nowIso(),
          text,
        });
      }
    },
    getEvents: () => events,
  };
}

export function buildObserverInputMessages(params: {
  baseMessages: UIMessage[];
  rerankingRequestMessage?: UIMessage;
  rerankingResultMessage?: UIMessage;
  knowledgeInjectionMessage?: UIMessage;
}): UIMessage[] {
  const {
    baseMessages,
    rerankingRequestMessage,
    rerankingResultMessage,
    knowledgeInjectionMessage,
  } = params;
  const messagesToInsert: UIMessage[] = [];
  if (rerankingRequestMessage) {
    messagesToInsert.push(rerankingRequestMessage);
  }
  if (rerankingResultMessage) {
    messagesToInsert.push(rerankingResultMessage);
  }
  if (knowledgeInjectionMessage) {
    messagesToInsert.push(knowledgeInjectionMessage);
  }
  if (messagesToInsert.length === 0) {
    return baseMessages;
  }
  const userMessageIndex = baseMessages.findIndex(
    (message) => message.role === "user"
  );
  if (userMessageIndex === -1) {
    return [...messagesToInsert, ...baseMessages];
  }
  const mergedMessages = [...baseMessages];
  mergedMessages.splice(userMessageIndex, 0, ...messagesToInsert);
  return mergedMessages;
}

type AssistantMessage = Extract<UIMessage, { role: "assistant" }>;
type AssistantTokenUsage = AssistantMessage["tokenUsage"];

export function withLlmObserver<TModel extends object>(
  model: TModel,
  observer?: LlmObserver
): TModel {
  if (!observer) return model;

  const hasDoGenerate =
    "doGenerate" in (model as { doGenerate?: unknown }) &&
    typeof (model as { doGenerate?: unknown }).doGenerate === "function";
  const hasDoStream =
    "doStream" in (model as { doStream?: unknown }) &&
    typeof (model as { doStream?: unknown }).doStream === "function";

  if (!hasDoGenerate && !hasDoStream) {
    return model;
  }

  const originalDoGenerate = hasDoGenerate
    ? (model as { doGenerate: (options: unknown) => Promise<unknown> })
        .doGenerate.bind(model)
    : undefined;
  const originalDoStream = hasDoStream
    ? (model as { doStream: (options: unknown) => Promise<unknown> }).doStream.bind(
        model
      )
    : undefined;

  const proxyModel = new Proxy(
    model as TModel & {
      doGenerate?: (options: unknown) => Promise<unknown>;
      doStream?: (options: unknown) => Promise<unknown>;
    },
    {
      get(target, prop, receiver) {
        if (prop === "doGenerate" && originalDoGenerate) {
          return async (options: unknown) => {
            observer.recordGenerationStarted();
            try {
              const result = await originalDoGenerate(options);
              observer.recordGenerationEnded();
              observer.recordFromResult(result);
              return result;
            } catch (error) {
              observer.recordGenerationEnded();
              throw error;
            }
          };
        }
        if (prop === "doStream" && originalDoStream) {
          return async (options: unknown) => {
            observer.recordGenerationStarted();
            try {
              const result = await originalDoStream(options);
              return result;
            } catch (error) {
              observer.recordGenerationEnded();
              throw error;
            }
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }
  );

  return proxyModel as TModel;
}

export function createStreamObserverCallbacks(
  observer: LlmObserver,
  options?: {
    onStepStart?: (step: unknown) => void;
    onStepFinish?: (step: unknown) => void;
    onFinish?: () => void;
  }
): {
  onStepStart: (step: unknown) => void;
  onStepFinish: (step: unknown) => void;
  onFinish: () => void;
} {
  const onStepStart = (step: unknown) => {
    const timestamp = nowIso();
    for (const toolCall of extractToolCallsFromStep(step)) {
      observer.recordToolCall({
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        args: toolCall.args,
        timestamp,
      });
    }
    for (const reasoningText of extractReasoningFromStep(step)) {
      observer.recordReasoning(reasoningText, timestamp);
    }
  };

  const onStepFinish = (step: unknown) => {
    const timestamp = nowIso();
    for (const toolResult of extractToolResultsFromStep(step)) {
      observer.recordToolResult({
        toolCallId: toolResult.toolCallId,
        toolName: toolResult.toolName,
        result: toolResult.result,
        timestamp,
      });
    }
    for (const reasoningText of extractReasoningFromStep(step)) {
      observer.recordReasoning(reasoningText, timestamp);
    }
  };

  const onFinish = () => {
    observer.recordGenerationEnded();
  };

  return {
    onStepStart: mergeCallback(options?.onStepStart, onStepStart),
    onStepFinish: mergeCallback(options?.onStepFinish, onStepFinish),
    onFinish: mergeCallback(options?.onFinish, onFinish),
  };
}

export interface WrapToolsWithObserverOptions {
  observer?: LlmObserver;
  /** When set, tool results are truncated (model-derived cap) before returning to the SDK. Used for streaming/test. */
  provider?: string;
  modelName?: string;
}

function isLlmObserver(
  value: LlmObserver | WrapToolsWithObserverOptions | undefined
): value is LlmObserver {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as LlmObserver).recordToolExecutionStarted === "function"
  );
}

export function wrapToolsWithObserver<TTools extends Record<string, unknown>>(
  tools: TTools,
  observerOrOptions?: LlmObserver | WrapToolsWithObserverOptions
): TTools {
  const observer = isLlmObserver(observerOrOptions)
    ? observerOrOptions
    : (observerOrOptions as WrapToolsWithObserverOptions)?.observer;
  const toolResultOptions =
    observerOrOptions != null &&
    typeof observerOrOptions === "object" &&
    !isLlmObserver(observerOrOptions)
      ? {
          provider: (observerOrOptions as WrapToolsWithObserverOptions).provider,
          modelName: (observerOrOptions as WrapToolsWithObserverOptions)
            .modelName,
        }
      : undefined;

  const buildToolErrorResult = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const name = error instanceof Error ? error.name : "Error";
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : undefined;
    return {
      error: {
        message,
        name,
        ...(code ? { code } : {}),
      },
      isError: true,
    };
  };

  const wrapped: Record<string, unknown> = {};
  for (const [toolName, toolDef] of Object.entries(tools)) {
    if (!toolDef || typeof toolDef !== "object") {
      wrapped[toolName] = toolDef;
      continue;
    }

    const toolAny = toolDef as { execute?: (...args: unknown[]) => unknown };
    const execute = toolAny.execute?.bind(toolDef);
    if (typeof execute !== "function") {
      wrapped[toolName] = toolDef;
      continue;
    }

    wrapped[toolName] = {
      ...toolDef,
      execute: async (args: unknown, context?: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool context varies by provider
        const contextAny = context as any;
        const toolCallId =
          contextAny?.toolCallId ||
          contextAny?.toolCall?.toolCallId ||
          contextAny?.id;
        observer?.recordToolExecutionStarted({
          toolCallId,
          toolName,
        });
        try {
          const result = await execute(args, context);
          observer?.recordToolExecutionEnded({
            toolCallId,
            toolName,
            result,
          });
          // Apply model-derived tool output cap for streaming/test (same as continuation/webhook/scheduled)
          if (
            toolResultOptions?.provider !== undefined &&
            toolResultOptions?.modelName !== undefined
          ) {
            return getToolResultValueForModel(
              { toolCallId, toolName, result },
              toolResultOptions
            );
          }
          return result;
        } catch (error) {
          const errorResult = buildToolErrorResult(error);
          observer?.recordToolExecutionEnded({
            toolCallId,
            toolName,
            error: error instanceof Error ? error.message : String(error),
            result: errorResult,
          });
          return errorResult;
        }
      },
    };
  }

  return wrapped as TTools;
}

// eslint-disable-next-line complexity -- stream observer assembly is intentionally centralised
export function buildConversationMessagesFromObserver(params: {
  observerEvents: LlmObserverEvent[];
  fallbackInputMessages?: UIMessage[];
  fallbackAssistantText?: string;
  assistantMeta: {
    tokenUsage?: AssistantTokenUsage;
    modelName?: string;
    provider?: string;
    openrouterGenerationId?: string;
    provisionalCostUsd?: number;
    generationTimeMs?: number;
  };
}): UIMessage[] {
  const {
    observerEvents,
    fallbackInputMessages,
    fallbackAssistantText,
    assistantMeta,
  } = params;

  const inputEvent = observerEvents.find(
    (event) => event.type === "input-messages"
  ) as LlmObserverEvent | undefined;

  const inputMessages =
    inputEvent && "messages" in inputEvent
      ? inputEvent.messages
      : fallbackInputMessages || [];

  const toolCallStartedAt = new Map<string, string>();
  const toolExecutionStart = new Map<string, string>();
  const toolExecutionEnd = new Map<string, string>();
  const toolCallSignatures = new Set<string>();
  const toolResultSignatures = new Set<string>();
  const syntheticToolIdsByName = new Map<string, string>();
  const syntheticToolCounters = new Map<string, number>();
  const hasToolCallEvents = observerEvents.some(
    (event) => event.type === "tool-call"
  );
  const hasToolResultEvents = observerEvents.some(
    (event) => event.type === "tool-result"
  );

  const getToolCallId = (toolCallId: string | undefined, toolName: string) => {
    if (toolCallId) {
      return toolCallId;
    }
    const existing = syntheticToolIdsByName.get(toolName);
    if (existing) {
      return existing;
    }
    const nextIndex = (syntheticToolCounters.get(toolName) ?? 0) + 1;
    syntheticToolCounters.set(toolName, nextIndex);
    const syntheticId = `tool_${toolName}_${nextIndex}`;
    syntheticToolIdsByName.set(toolName, syntheticId);
    return syntheticId;
  };

  type AssistantContentItem =
    | { type: "text"; text: string }
    | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        args: unknown;
        toolCallStartedAt?: string;
      }
    | {
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        result: unknown;
        toolExecutionTimeMs?: number;
      }
    | { type: "reasoning"; text: string }
    | { type: "file"; file: string; mediaType?: string; filename?: string }
    | DelegationContent
  ;
  const assistantSegments: AssistantContentItem[][] = [];
  let currentContent: AssistantContentItem[] = [];
  const filePartKeys = new Set<string>();

  let generationStartedAt: string | undefined;
  let generationEndedAt: string | undefined;
  let textBuffer = "";

  const flushTextBuffer = () => {
    const trimmed = textBuffer.trim();
    if (trimmed.length > 0) {
      // Preserve original whitespace while skipping whitespace-only buffers.
      currentContent.push({ type: "text", text: textBuffer });
      textBuffer = "";
    }
  };

  const pushCurrentContent = () => {
    if (currentContent.length > 0) {
      assistantSegments.push(currentContent);
      currentContent = [];
    }
  };

  const appendReasoningSegment = (text: string) => {
    const lastSegment = assistantSegments.at(-1);
    if (lastSegment && lastSegment.every((item) => item.type === "reasoning")) {
      lastSegment.push({ type: "reasoning", text });
      return;
    }
    assistantSegments.push([{ type: "reasoning", text }]);
  };

  const buildFileKey = (file: string, mediaType?: string, filename?: string) =>
    `${file}::${mediaType ?? ""}::${filename ?? ""}`;

  const pushFilePart = (part: {
    file: string;
    mediaType?: string;
    filename?: string;
  }) => {
    const key = buildFileKey(part.file, part.mediaType, part.filename);
    if (filePartKeys.has(key)) {
      return;
    }
    filePartKeys.add(key);
    currentContent.push({
      type: "file",
      file: part.file,
      ...(part.mediaType && { mediaType: part.mediaType }),
      ...(part.filename && { filename: part.filename }),
    });
  };

  for (const event of observerEvents) {
    switch (event.type) {
      case "generation-started":
        generationStartedAt = generationStartedAt || event.timestamp;
        break;
      case "generation-ended":
        generationEndedAt = event.timestamp;
        break;
      case "tool-call":
        toolCallStartedAt.set(event.toolCallId, event.timestamp);
        flushTextBuffer();
        {
          const signature = `${event.toolCallId}:${event.toolName}`;
          if (!toolCallSignatures.has(signature)) {
            toolCallSignatures.add(signature);
            currentContent.push({
              type: "tool-call",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
              toolCallStartedAt: event.timestamp,
            });
          }
        }
        break;
      case "tool-result": {
        flushTextBuffer();
        const executionStart = toolExecutionStart.get(event.toolCallId);
        const executionEnd = toolExecutionEnd.get(event.toolCallId);
        const toolCallStart = toolCallStartedAt.get(event.toolCallId);
        let toolExecutionTimeMs: number | undefined;
        if (executionStart && executionEnd) {
          toolExecutionTimeMs =
            new Date(executionEnd).getTime() -
            new Date(executionStart).getTime();
        } else if (toolCallStart) {
          // Fallback includes model deliberation before execution starts.
          toolExecutionTimeMs =
            new Date(event.timestamp).getTime() -
            new Date(toolCallStart).getTime();
        }
        const signature = `${event.toolCallId}:${event.toolName}`;
        if (!toolResultSignatures.has(signature)) {
          toolResultSignatures.add(signature);
          const formattedToolResult = formatToolResultMessage(
            {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              result: event.result,
              ...(toolExecutionTimeMs !== undefined && { toolExecutionTimeMs }),
            },
            {
              provider: assistantMeta.provider,
              modelName: assistantMeta.modelName,
            }
          );
          if (Array.isArray(formattedToolResult.content)) {
            for (const item of formattedToolResult.content) {
              if (
                item &&
                typeof item === "object" &&
                "type" in item &&
                item.type === "file" &&
                "file" in item &&
                typeof item.file === "string"
              ) {
                const fileItem = item as {
                  file: string;
                  mediaType?: string;
                  filename?: string;
                };
                pushFilePart(fileItem);
              } else {
                currentContent.push(item as AssistantContentItem);
              }
            }
          }
        }
        break;
      }
      case "tool-execution-started":
        if (event.toolName) {
          const toolCallId = getToolCallId(event.toolCallId, event.toolName);
          toolExecutionStart.set(toolCallId, event.timestamp);
          if (!event.toolCallId) {
            syntheticToolIdsByName.set(event.toolName, toolCallId);
          }
          const signature = `${toolCallId}:${event.toolName}`;
          if (!hasToolCallEvents && !toolCallSignatures.has(signature)) {
            flushTextBuffer();
            toolCallSignatures.add(signature);
            currentContent.push({
              type: "tool-call",
              toolCallId,
              toolName: event.toolName,
              args: {},
              toolCallStartedAt: event.timestamp,
            });
          }
        }
        break;
      case "tool-execution-ended":
        if (event.toolName) {
          const toolCallId = getToolCallId(event.toolCallId, event.toolName);
          toolExecutionEnd.set(toolCallId, event.timestamp);
          if (!event.toolCallId) {
            syntheticToolIdsByName.delete(event.toolName);
          }
          const signature = `${toolCallId}:${event.toolName}`;
          if (
            !hasToolResultEvents &&
            !toolResultSignatures.has(signature) &&
            event.result !== undefined
          ) {
            flushTextBuffer();
            toolResultSignatures.add(signature);
            const executionStart = toolExecutionStart.get(toolCallId);
            const executionEnd = toolExecutionEnd.get(toolCallId);
            let toolExecutionTimeMs: number | undefined;
            if (executionStart && executionEnd) {
              toolExecutionTimeMs =
                new Date(executionEnd).getTime() -
                new Date(executionStart).getTime();
            }
            const formattedToolResult = formatToolResultMessage(
              {
                toolCallId,
                toolName: event.toolName,
                result: event.result,
                ...(toolExecutionTimeMs !== undefined && { toolExecutionTimeMs }),
              },
              {
                provider: assistantMeta.provider,
                modelName: assistantMeta.modelName,
              }
            );
            if (Array.isArray(formattedToolResult.content)) {
              for (const item of formattedToolResult.content) {
                if (
                  item &&
                  typeof item === "object" &&
                  "type" in item &&
                  item.type === "file" &&
                  "file" in item &&
                  typeof item.file === "string"
                ) {
                  const fileItem = item as {
                    file: string;
                    mediaType?: string;
                    filename?: string;
                  };
                  pushFilePart(fileItem);
                } else {
                  currentContent.push(item as AssistantContentItem);
                }
              }
            }
          }
        }
        break;
      case "assistant-reasoning":
        flushTextBuffer();
        pushCurrentContent();
        appendReasoningSegment(event.text);
        break;
      case "assistant-file":
        flushTextBuffer();
        pushFilePart({
          file: event.fileUrl,
          ...(event.mediaType && { mediaType: event.mediaType }),
          ...(event.filename && { filename: event.filename }),
        });
        break;
      case "assistant-text":
        textBuffer += event.text;
        break;
      default:
        break;
    }
  }

  flushTextBuffer();
  pushCurrentContent();

  const hasAssistantText = assistantSegments.some((segment) =>
    segment.some((item) => item.type === "text")
  );
  if (
    !hasAssistantText &&
    typeof fallbackAssistantText === "string" &&
    fallbackAssistantText.trim().length > 0
  ) {
    assistantSegments.push([{ type: "text", text: fallbackAssistantText }]);
  }

  if (assistantSegments.length === 0) {
    const assistantMessage: UIMessage = {
      role: "assistant",
      content: "",
      ...(assistantMeta.tokenUsage && { tokenUsage: assistantMeta.tokenUsage }),
      ...(assistantMeta.modelName && { modelName: assistantMeta.modelName }),
      ...(assistantMeta.provider && { provider: assistantMeta.provider }),
      ...(assistantMeta.openrouterGenerationId && {
        openrouterGenerationId: assistantMeta.openrouterGenerationId,
      }),
      ...(assistantMeta.provisionalCostUsd !== undefined && {
        provisionalCostUsd: assistantMeta.provisionalCostUsd,
      }),
      ...(assistantMeta.generationTimeMs !== undefined && {
        generationTimeMs: assistantMeta.generationTimeMs,
      }),
      ...(generationStartedAt && { generationStartedAt }),
      ...(generationEndedAt && { generationEndedAt }),
    };

    return [...inputMessages, assistantMessage];
  }

  const lastTextIndex = assistantSegments.findLastIndex((segment) =>
    segment.some((item) => item.type === "text")
  );
  const metaIndex =
    lastTextIndex >= 0 ? lastTextIndex : assistantSegments.length - 1;

  const assistantMessages = assistantSegments.map((segment, index): UIMessage => {
    const baseMessage: UIMessage = {
      role: "assistant",
      content: segment,
    };

    if (index !== metaIndex) {
      return baseMessage;
    }

    return {
      ...baseMessage,
      ...(assistantMeta.tokenUsage && { tokenUsage: assistantMeta.tokenUsage }),
      ...(assistantMeta.modelName && { modelName: assistantMeta.modelName }),
      ...(assistantMeta.provider && { provider: assistantMeta.provider }),
      ...(assistantMeta.openrouterGenerationId && {
        openrouterGenerationId: assistantMeta.openrouterGenerationId,
      }),
      ...(assistantMeta.provisionalCostUsd !== undefined && {
        provisionalCostUsd: assistantMeta.provisionalCostUsd,
      }),
      ...(assistantMeta.generationTimeMs !== undefined && {
        generationTimeMs: assistantMeta.generationTimeMs,
      }),
      ...(generationStartedAt && { generationStartedAt }),
      ...(generationEndedAt && { generationEndedAt }),
    };
  });

  return [...inputMessages, ...assistantMessages];
}

export function getGenerationTimingFromObserver(
  observerEvents: LlmObserverEvent[]
): { generationStartedAt?: string; generationEndedAt?: string } {
  let generationStartedAt: string | undefined;
  let generationEndedAt: string | undefined;
  for (const event of observerEvents) {
    if (event.type === "generation-started" && !generationStartedAt) {
      generationStartedAt = event.timestamp;
    }
    if (event.type === "generation-ended") {
      generationEndedAt = event.timestamp;
    }
  }
  return { generationStartedAt, generationEndedAt };
}
