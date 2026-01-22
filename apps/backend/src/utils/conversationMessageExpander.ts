import type {
  DelegationContent,
  ToolResultContent,
  UIMessage,
} from "./messageTypes";

type ToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: unknown;
  toolCallStartedAt?: string;
};

type ToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: unknown;
  toolExecutionTimeMs?: number;
  costUsd?: number;
  openrouterGenerationId?: string;
};

type DelegationPart = {
  type: "delegation";
  toolCallId: string;
  callingAgentId: string;
  targetAgentId: string;
  targetConversationId?: string;
  status: "completed" | "failed" | "cancelled";
  timestamp: string;
  taskId?: string;
};

type ReasoningPart = { type: "reasoning"; text: string };
type TextPart = { type: "text"; text: string };
type FilePart = { type: "file"; file: string; mediaType?: string; filename?: string };
type AssistantMessage = Extract<UIMessage, { role: "assistant" }>;

type AssistantParts = {
  toolCalls: ToolCallPart[];
  toolResults: ToolResultPart[];
  delegations: DelegationPart[];
  reasoning: ReasoningPart[];
  text: TextPart[];
  fileParts: FilePart[];
};

type ToolCallMapEntry = {
  toolCall: ToolCallPart;
  toolResult?: ToolResultPart;
};

const createEmptyAssistantParts = (): AssistantParts => ({
  toolCalls: [],
  toolResults: [],
  delegations: [],
  reasoning: [],
  text: [],
  fileParts: [],
});

const collectAssistantParts = (message: AssistantMessage): AssistantParts => {
  const parts = createEmptyAssistantParts();
  const toolCallSignatures = new Set<string>();
  const toolResultSignatures = new Set<string>();

  if (!Array.isArray(message.content)) {
    return parts;
  }

  for (const item of message.content) {
    if (typeof item !== "object" || item === null || !("type" in item)) {
      continue;
    }

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
        const signature = `${toolCall.toolCallId}:${toolCall.toolName}`;
        if (toolCallSignatures.has(signature)) {
          continue;
        }
        toolCallSignatures.add(signature);
        parts.toolCalls.push({
          type: "tool-call",
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          args: toolCall.args || {},
          ...(toolCall.toolCallStartedAt && {
            toolCallStartedAt: toolCall.toolCallStartedAt,
          }),
        });
      }
      continue;
    }

    if (item.type === "tool-result") {
      const toolResult = item as {
        type: "tool-result";
        toolCallId?: string;
        toolName?: string;
        result?: unknown;
        toolExecutionTimeMs?: number;
        costUsd?: number;
        openrouterGenerationId?: string;
      };
      if (
        toolResult.toolCallId &&
        toolResult.toolName &&
        typeof toolResult.toolCallId === "string" &&
        typeof toolResult.toolName === "string"
      ) {
        const signature = `${toolResult.toolCallId}:${toolResult.toolName}`;
        if (toolResultSignatures.has(signature)) {
          continue;
        }
        toolResultSignatures.add(signature);
        parts.toolResults.push({
          type: "tool-result",
          toolCallId: toolResult.toolCallId,
          toolName: toolResult.toolName,
          result: toolResult.result,
          ...(toolResult.toolExecutionTimeMs !== undefined && {
            toolExecutionTimeMs: toolResult.toolExecutionTimeMs,
          }),
          ...(toolResult.costUsd !== undefined && {
            costUsd: toolResult.costUsd,
          }),
          ...(toolResult.openrouterGenerationId && {
            openrouterGenerationId: toolResult.openrouterGenerationId,
          }),
        });
      }
      continue;
    }

    if (item.type === "delegation") {
      const delegationItem = item as {
        type: "delegation";
        toolCallId?: string;
        callingAgentId?: string;
        targetAgentId?: string;
        targetConversationId?: string;
        status?: "completed" | "failed" | "cancelled";
        timestamp?: string;
        taskId?: string;
      };
      if (
        delegationItem.toolCallId &&
        delegationItem.callingAgentId &&
        delegationItem.targetAgentId &&
        delegationItem.status &&
        delegationItem.timestamp &&
        typeof delegationItem.toolCallId === "string" &&
        typeof delegationItem.callingAgentId === "string" &&
        typeof delegationItem.targetAgentId === "string" &&
        typeof delegationItem.status === "string" &&
        typeof delegationItem.timestamp === "string"
      ) {
        parts.delegations.push({
          type: "delegation",
          toolCallId: delegationItem.toolCallId,
          callingAgentId: delegationItem.callingAgentId,
          targetAgentId: delegationItem.targetAgentId,
          ...(delegationItem.targetConversationId && {
            targetConversationId: delegationItem.targetConversationId,
          }),
          status: delegationItem.status,
          timestamp: delegationItem.timestamp,
          ...(delegationItem.taskId && { taskId: delegationItem.taskId }),
        });
      }
      continue;
    }

    if (item.type === "reasoning" && "text" in item) {
      const reasoningItem = item as { text?: unknown };
      if (typeof reasoningItem.text === "string") {
        parts.reasoning.push({ type: "reasoning", text: reasoningItem.text });
      }
      continue;
    }

    if (item.type === "text" && "text" in item) {
      const textItem = item as { text?: unknown };
      if (typeof textItem.text === "string") {
        parts.text.push({ type: "text", text: textItem.text });
      }
      continue;
    }

    if (
      item.type === "file" &&
      "file" in item &&
      typeof (item as { file?: unknown }).file === "string"
    ) {
      const fileItem = item as {
        file: string;
        mediaType?: string;
        filename?: string;
      };
      parts.fileParts.push({
        type: "file",
        file: fileItem.file,
        ...(fileItem.mediaType && { mediaType: fileItem.mediaType }),
        ...(fileItem.filename && { filename: fileItem.filename }),
      });
    }
  }

  return parts;
};

const buildToolCallMap = (
  toolCalls: ToolCallPart[],
  toolResults: ToolResultPart[]
): Map<string, ToolCallMapEntry> => {
  const toolCallMap = new Map<string, ToolCallMapEntry>();
  for (const toolCall of toolCalls) {
    toolCallMap.set(toolCall.toolCallId, { toolCall });
  }
  for (const toolResult of toolResults) {
    const entry = toolCallMap.get(toolResult.toolCallId);
    if (entry) {
      entry.toolResult = toolResult;
    }
  }
  return toolCallMap;
};

const buildToolCallMessages = (options: {
  toolCalls: ToolCallPart[];
  message: AssistantMessage;
  awsRequestId?: string;
}): UIMessage[] => {
  const { toolCalls, message, awsRequestId } = options;
  return toolCalls.map((toolCall) => {
    const toolCallStartedAt = toolCall.toolCallStartedAt;
    const toolCallMessageStart =
      message.generationStartedAt || toolCallStartedAt;
    const toolCallMessageEnd = toolCallStartedAt || message.generationStartedAt;

    return {
      role: "assistant",
      content: [toolCall],
      ...(awsRequestId && { awsRequestId }),
      ...(toolCallMessageStart && { generationStartedAt: toolCallMessageStart }),
      ...(toolCallMessageEnd && { generationEndedAt: toolCallMessageEnd }),
      ...(message.openrouterGenerationId && {
        openrouterGenerationId: message.openrouterGenerationId,
      }),
    };
  });
};

const buildToolResultMessages = (options: {
  toolResults: ToolResultPart[];
  toolCallMap: Map<string, ToolCallMapEntry>;
  delegations: DelegationPart[];
  awsRequestId?: string;
}): { messages: UIMessage[]; toolResultEndTimes: string[] } => {
  const { toolResults, toolCallMap, delegations, awsRequestId } = options;
  const messages: UIMessage[] = [];
  const toolResultEndTimes: string[] = [];

  for (const toolResult of toolResults) {
    const entry = toolCallMap.get(toolResult.toolCallId);
    const toolCall = entry?.toolCall;
    const toolCallStartedAt = toolCall?.toolCallStartedAt;

    let toolResultStartedAt: string | undefined;
    let toolResultEndedAt: string | undefined;

    if (toolCallStartedAt) {
      const callStartTime = new Date(toolCallStartedAt).getTime();
      toolResultStartedAt = toolCallStartedAt;

      if (toolResult.toolExecutionTimeMs !== undefined) {
        const executionEndTime =
          callStartTime + toolResult.toolExecutionTimeMs;
        toolResultEndedAt = new Date(executionEndTime).toISOString();
      } else {
        toolResultEndedAt = toolResultStartedAt;
      }
    }

    const associatedDelegation = delegations.find(
      (delegation) => delegation.toolCallId === toolResult.toolCallId
    );

    const toolResultContent: Array<
      ToolResultPart | DelegationPart | undefined
    > = [toolResult, associatedDelegation];
    const filteredContent = toolResultContent.filter(
      (item): item is ToolResultPart | DelegationPart => item !== undefined
    ) as Array<ToolResultContent | DelegationContent>;

    const toolResultMessage: UIMessage = {
      role: "tool",
      content: filteredContent,
      ...(awsRequestId && { awsRequestId }),
      ...(toolResultStartedAt && { generationStartedAt: toolResultStartedAt }),
      ...(toolResultEndedAt && { generationEndedAt: toolResultEndedAt }),
    };

    messages.push(toolResultMessage);

    if (toolResultEndedAt) {
      toolResultEndTimes.push(toolResultEndedAt);
    }
  }

  return { messages, toolResultEndTimes };
};

const buildTextOnlyMessage = (options: {
  message: AssistantMessage;
  reasoning: ReasoningPart[];
  text: TextPart[];
  fileParts: FilePart[];
  toolResultEndTimes: string[];
  awsRequestId?: string;
}): AssistantMessage | null => {
  const { message, reasoning, text, fileParts, toolResultEndTimes, awsRequestId } =
    options;
  if (reasoning.length === 0 && text.length === 0 && fileParts.length === 0) {
    return null;
  }

  let textGenerationStartedAt: string | undefined;
  const textGenerationEndedAt = message.generationEndedAt;

  if (toolResultEndTimes.length > 0) {
    let latestEndTime: number | undefined;
    let latestEndTimeString: string | undefined;
    for (const endTimeString of toolResultEndTimes) {
      const endTime = new Date(endTimeString).getTime();
      if (!latestEndTime || endTime > latestEndTime) {
        latestEndTime = endTime;
        latestEndTimeString = endTimeString;
      }
    }
    textGenerationStartedAt = latestEndTimeString;
  } else {
    textGenerationStartedAt = message.generationStartedAt;
  }

  const reasoningAndTextContent: Array<ReasoningPart | TextPart | FilePart> = [
    ...reasoning,
    ...text,
    ...fileParts,
  ];

  return {
    role: "assistant",
    content: reasoningAndTextContent,
    ...(awsRequestId && { awsRequestId }),
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
    ...(textGenerationStartedAt && {
      generationStartedAt: textGenerationStartedAt,
    }),
    ...(textGenerationEndedAt && {
      generationEndedAt: textGenerationEndedAt,
    }),
  };
};

const buildDelegationOnlyMessage = (options: {
  message: AssistantMessage;
  delegations: DelegationPart[];
  reasoning: ReasoningPart[];
  text: TextPart[];
  fileParts: FilePart[];
  awsRequestId?: string;
}): AssistantMessage | null => {
  const { message, delegations, reasoning, text, fileParts, awsRequestId } = options;
  const contentWithDelegations: Array<
    TextPart | ReasoningPart | DelegationPart | FilePart
  > = [...reasoning, ...text, ...fileParts, ...delegations];

  if (contentWithDelegations.length === 0) {
    return awsRequestId ? { ...message, awsRequestId } : message;
  }

  return {
    ...message,
    content: contentWithDelegations,
    ...(awsRequestId && { awsRequestId }),
  };
};

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
      const assistantMessage = message as AssistantMessage;
      const parts = collectAssistantParts(assistantMessage);

      if (parts.toolCalls.length > 0 || parts.toolResults.length > 0) {
        const toolCallMap = buildToolCallMap(
          parts.toolCalls,
          parts.toolResults
        );

        expandedMessages.push(
          ...buildToolCallMessages({
            toolCalls: parts.toolCalls,
            message: assistantMessage,
            awsRequestId,
          })
        );

        const { messages: toolResultMessages, toolResultEndTimes } =
          buildToolResultMessages({
            toolResults: parts.toolResults,
            toolCallMap,
            delegations: parts.delegations,
            awsRequestId,
          });
        expandedMessages.push(...toolResultMessages);

        const textOnlyMessage = buildTextOnlyMessage({
          message: assistantMessage,
          reasoning: parts.reasoning,
          text: parts.text,
          fileParts: parts.fileParts,
          toolResultEndTimes,
          awsRequestId,
        });
        if (textOnlyMessage) {
          expandedMessages.push(textOnlyMessage);
        }
      } else if (parts.delegations.length > 0) {
        console.warn(
          "[ConversationLogger] Found delegations without tool calls/results",
          {
            role: message.role,
            delegationCount: parts.delegations.length,
          }
        );
        const delegationOnlyMessage = buildDelegationOnlyMessage({
          message: assistantMessage,
          delegations: parts.delegations,
          reasoning: parts.reasoning,
          text: parts.text,
          fileParts: parts.fileParts,
          awsRequestId,
        });
        if (delegationOnlyMessage) {
          expandedMessages.push(delegationOnlyMessage);
        }
      } else {
        expandedMessages.push(awsRequestId ? { ...message, awsRequestId } : message);
      }
    } else {
      expandedMessages.push(awsRequestId ? { ...message, awsRequestId } : message);
    }
  }

  console.log("[expandMessagesWithToolCalls] Expanded messages:", {
    originalCount: messages.length,
    expandedCount: expandedMessages.length,
    expansion: expandedMessages.length - messages.length,
  });

  return expandedMessages;
}
