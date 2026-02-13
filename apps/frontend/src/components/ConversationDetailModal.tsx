import {
  CheckCircleIcon,
  ClipboardDocumentIcon,
  ClockIcon,
  ChatBubbleLeftRightIcon,
  TagIcon,
  BoltIcon,
  CpuChipIcon,
  CurrencyDollarIcon,
} from "@heroicons/react/24/outline";
import { useState, useEffect } from "react";
import type { FC, JSX } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useDialogTracking } from "../contexts/DialogContext";
import { useAgentConversation } from "../hooks/useAgentConversations";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useToast } from "../hooks/useToast";
import { getTokenUsageColor, getCostColor } from "../utils/colorUtils";
import { formatCurrency } from "../utils/currency";
import { getMessageCost } from "../utils/messageCost";

import { AgentNameLink } from "./AgentNameLink";
import { ConversationTemporalGraph } from "./ConversationTemporalGraph";
import { NestedConversationDelegation } from "./NestedConversationDelegation";
import { TruncatedPayloadDisplay } from "./TruncatedPayloadDisplay";

interface ConversationDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  agentId: string;
  conversationId: string;
}

export const ConversationDetailModal: FC<ConversationDetailModalProps> = ({
  isOpen,
  onClose,
  workspaceId,
  agentId,
  conversationId,
}) => {
  const { data: conversationDetail } = useAgentConversation(
    workspaceId,
    agentId,
    conversationId
  );
  const { registerDialog, unregisterDialog } = useDialogTracking();
  const [showRawJson, setShowRawJson] = useState(false);
  const toast = useToast();

  useEscapeKey(isOpen, onClose);

  useEffect(() => {
    if (isOpen) {
      registerDialog();
      return () => unregisterDialog();
    }
  }, [isOpen, registerDialog, unregisterDialog]);

  if (!isOpen) return null;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  // Shared markdown component configuration
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markdownComponents: Record<string, React.ComponentType<any>> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    code: (props: any) => {
      const { className, children, ...rest } = props;
      const isInline = !className || !className.includes("language-");
      if (isInline) {
        return (
          <code
            className="rounded-lg border-2 border-neutral-300 bg-neutral-100 px-2 py-1 font-mono text-xs font-bold dark:border-neutral-700 dark:bg-surface-100 dark:text-neutral-50"
            {...rest}
          >
            {children}
          </code>
        );
      }
      return (
        <code
          className="block overflow-x-auto rounded-xl border-2 border-neutral-300 bg-neutral-100 p-5 font-mono text-sm font-bold dark:border-neutral-700 dark:bg-surface-100 dark:text-neutral-50"
          {...rest}
        >
          {children}
        </code>
      );
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p: ({ children }: any) => <p className="mb-2 last:mb-0">{children}</p>,
  };

  const renderMessageContent = (content: unknown): JSX.Element | string => {
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return (
        <div className="space-y-3">
          {content.map((item, itemIndex) => {
            if (typeof item === "string") {
              // Skip redacted text - don't display it
              if (item === "[REDACTED]") {
                return null;
              }
              return (
                <div key={itemIndex} className="text-sm">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {item}
                  </ReactMarkdown>
                </div>
              );
            }
            if (typeof item === "object" && item !== null) {
              // Tool call
              if ("type" in item && item.type === "tool-call") {
                const toolCall = item as {
                  type: "tool-call";
                  toolCallId?: string;
                  toolName?: string;
                  args?: unknown;
                };
                const toolName = toolCall.toolName || "unknown";
                const args = toolCall.args || {};
                return (
                  <div
                    key={itemIndex}
                    className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950"
                  >
                    <div className="mb-2 text-xs font-medium text-blue-700 dark:text-blue-300">
                      🔧 Tool Call: {toolName}
                    </div>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded bg-blue-100 px-2 py-1 font-mono text-xs font-semibold text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                        {toolName}
                      </span>
                      {toolCall.toolCallId && (
                        <span className="text-xs text-blue-600 dark:text-blue-400">
                          ID: {toolCall.toolCallId.substring(0, 8)}...
                        </span>
                      )}
                    </div>
                    <div className="mt-2">
                      <TruncatedPayloadDisplay
                        value={args}
                        label="Arguments"
                        format="json"
                        variant="blue"
                      />
                    </div>
                  </div>
                );
              }
              // Tool result
              if ("type" in item && item.type === "tool-result") {
                const toolResult = item as {
                  type: "tool-result";
                  toolCallId?: string;
                  toolName?: string;
                  result?: unknown;
                  costUsd?: number;
                };
                const toolName = toolResult.toolName || "unknown";
                const result = toolResult.result;
                const hasResult = result !== undefined;
                const costUsd = toolResult.costUsd;
                return (
                  <div
                    key={itemIndex}
                    className="rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950"
                  >
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-green-700 dark:text-green-300">
                      <CheckCircleIcon className="size-3" />
                      Tool Result: {toolName}
                    </div>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded bg-green-100 px-2 py-1 font-mono text-xs font-semibold text-green-600 dark:bg-green-900 dark:text-green-300">
                        {toolName}
                      </span>
                      {toolResult.toolCallId && (
                        <span className="text-xs text-green-600 dark:text-green-400">
                          ID: {toolResult.toolCallId.substring(0, 8)}...
                        </span>
                      )}
                      {costUsd !== undefined && (
                        <div className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-800 opacity-70 dark:bg-green-900 dark:text-green-200">
                          {formatCurrency(costUsd, "usd", 10)}
                        </div>
                      )}
                    </div>
                    {hasResult && (
                      <div className="mt-2">
                        <TruncatedPayloadDisplay
                          value={result}
                          label="Result"
                          format={
                            typeof result === "string" ? "markdown" : "json"
                          }
                          variant="green"
                        />
                      </div>
                    )}
                  </div>
                );
              }
              if (
                "type" in item &&
                (item.type === "file" || item.type === "image")
              ) {
                const fileItem = item as {
                  type: "file" | "image";
                  file?: string;
                  image?: string;
                  data?: string;
                  url?: string;
                  mediaType?: string;
                  mimeType?: string;
                  filename?: string;
                };
                const fileUrl =
                  fileItem.url || fileItem.file || fileItem.image || fileItem.data;
                if (!fileUrl) {
                  return null;
                }
                const mediaType =
                  fileItem.mediaType || fileItem.mimeType || undefined;
                const isImage =
                  (mediaType && mediaType.startsWith("image/")) ||
                  /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(fileUrl);
                if (isImage) {
                  return (
                    <div key={itemIndex} className="max-w-[80%]">
                      <img
                        src={fileUrl}
                        alt={fileItem.filename || "Uploaded image"}
                        className="max-h-96 max-w-full rounded-lg border-2 border-neutral-300 object-contain dark:border-neutral-700"
                      />
                    </div>
                  );
                }
                const displayName =
                  fileItem.filename || fileUrl.split("/").pop() || "File";
                return (
                  <a
                    key={itemIndex}
                    href={fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-[80%] items-center gap-2 rounded-lg border-2 border-neutral-300 bg-neutral-50 px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-surface-100 dark:text-neutral-100 dark:hover:bg-neutral-700"
                  >
                    {displayName}
                  </a>
                );
              }
              // Reasoning content - skip redacted reasoning
              if (
                "type" in item &&
                item.type === "reasoning" &&
                "text" in item
              ) {
                const reasoningItem = item as {
                  type: "reasoning";
                  text: string;
                };
                // Skip redacted reasoning - don't display it
                // Check if text is exactly "[REDACTED]" or contains it (likely at the end)
                const trimmedText = reasoningItem.text.trim();
                if (
                  trimmedText === "[REDACTED]" ||
                  trimmedText.endsWith("\n\n[REDACTED]") ||
                  trimmedText.endsWith("\n[REDACTED]")
                ) {
                  return null;
                }
                // Remove [REDACTED] marker if present in the text
                let cleanedText = reasoningItem.text;
                cleanedText = cleanedText
                  .replace(/\n*\s*\[REDACTED\]\s*$/g, "")
                  .trim();
                // If after cleaning the text is empty, skip it
                if (!cleanedText) {
                  return null;
                }
                return (
                  <div
                    key={itemIndex}
                    className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950"
                  >
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                      <CpuChipIcon className="size-4" />
                      🧠 Reasoning
                    </div>
                    <div className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-indigo-100 p-2 text-sm text-indigo-900 dark:bg-indigo-900 dark:text-indigo-100">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {cleanedText}
                      </ReactMarkdown>
                    </div>
                  </div>
                );
              }
              // Delegation content
              if ("type" in item && item.type === "delegation") {
                const delegationItem = item as {
                  type: "delegation";
                  toolCallId?: string;
                  callingAgentId: string;
                  targetAgentId: string;
                  targetConversationId?: string;
                  status: "completed" | "failed" | "cancelled";
                  timestamp: string;
                  taskId?: string;
                };
                return (
                  <div
                    key={itemIndex}
                    className="rounded-xl border border-orange-200 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-950"
                  >
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-orange-700 dark:text-orange-300">
                      <ChatBubbleLeftRightIcon className="size-4" />
                      Delegation
                    </div>
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className={`rounded border px-2 py-1 text-xs font-semibold ${
                          delegationItem.status === "completed"
                            ? "border-green-200 bg-green-100 text-green-800 dark:border-green-700 dark:bg-green-900 dark:text-green-200"
                            : delegationItem.status === "failed"
                            ? "border-red-200 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-900 dark:text-red-200"
                            : "border-neutral-200 bg-neutral-100 text-neutral-800 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-200"
                        }`}
                      >
                        {delegationItem.status.toUpperCase()}
                      </span>
                      {delegationItem.taskId && (
                        <span className="rounded bg-blue-100 px-2 py-1 font-mono text-xs text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                          Task: {delegationItem.taskId.substring(0, 8)}...
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="font-medium text-orange-700 dark:text-orange-300">
                          From:{" "}
                        </span>
                        <AgentNameLink
                          workspaceId={workspaceId}
                          agentId={delegationItem.callingAgentId}
                        />
                      </div>
                      <div>
                        <span className="font-medium text-orange-700 dark:text-orange-300">
                          To:{" "}
                        </span>
                        <AgentNameLink
                          workspaceId={workspaceId}
                          agentId={delegationItem.targetAgentId}
                        />
                      </div>
                    </div>
                    {delegationItem.targetConversationId && (
                      <div className="mt-2">
                        <NestedConversationDelegation
                          workspaceId={workspaceId}
                          delegation={{
                            callingAgentId: delegationItem.callingAgentId,
                            targetAgentId: delegationItem.targetAgentId,
                            targetConversationId:
                              delegationItem.targetConversationId,
                            status: delegationItem.status,
                            timestamp: delegationItem.timestamp,
                            taskId: delegationItem.taskId,
                          }}
                          depth={0}
                        />
                      </div>
                    )}
                    {!delegationItem.targetConversationId && (
                      <div className="mt-2 text-xs text-orange-600 dark:text-orange-400">
                        Inner conversation not available
                      </div>
                    )}
                  </div>
                );
              }
              // Text content - skip redacted text
              if ("text" in item && typeof item.text === "string") {
                // Skip redacted text - don't display it
                if (item.text === "[REDACTED]") {
                  return null;
                }
                return (
                  <div key={itemIndex} className="text-sm">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents}
                    >
                      {item.text}
                    </ReactMarkdown>
                  </div>
                );
              }
            }
            return (
              <div key={itemIndex} className="text-xs text-neutral-500">
                {JSON.stringify(item)}
              </div>
            );
          })}
        </div>
      );
    }
    return JSON.stringify(content, null, 2);
  };

  const formatTokenUsage = (tokenUsage: unknown): string | null => {
    if (
      !tokenUsage ||
      typeof tokenUsage !== "object" ||
      !("totalTokens" in tokenUsage)
    ) {
      return null;
    }
    const usage = tokenUsage as {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      reasoningTokens?: number;
      cachedPromptTokens?: number;
    };
    if (typeof usage.totalTokens !== "number") {
      return null;
    }
    const parts: string[] = [];
    if (typeof usage.promptTokens === "number") {
      parts.push(`Prompt: ${usage.promptTokens.toLocaleString()}`);
    }
    if (typeof usage.completionTokens === "number") {
      parts.push(`Completion: ${usage.completionTokens.toLocaleString()}`);
    }
    if (
      typeof usage.reasoningTokens === "number" &&
      usage.reasoningTokens > 0
    ) {
      parts.push(`Reasoning: ${usage.reasoningTokens.toLocaleString()}`);
    }
    if (
      typeof usage.cachedPromptTokens === "number" &&
      usage.cachedPromptTokens > 0
    ) {
      parts.push(`Cached: ${usage.cachedPromptTokens.toLocaleString()}`);
    }
    const total = usage.totalTokens.toLocaleString();
    return parts.length > 0 ? `${total} (${parts.join(", ")})` : total;
  };

  // Calculate token-based cost from all messages and track provisional/final status
  const calculateTokenBasedCost = ():
    | {
        cost: number;
        isFinal: boolean | undefined;
      }
    | undefined => {
    if (
      !conversationDetail?.messages ||
      !Array.isArray(conversationDetail.messages)
    ) {
      return undefined;
    }

    let totalCostMillionths = 0;
    let hasFinalCost = false;
    let hasProvisionalCost = false;
    let hasCalculatedCost = false;

    for (const message of conversationDetail.messages) {
      const messageCost = getMessageCost(message);
      if (messageCost?.costUsd !== undefined) {
        // costUsd is already in nano-dollars
        totalCostMillionths += messageCost.costUsd;
        if (messageCost.isFinal === true) {
          hasFinalCost = true;
        } else if (messageCost.isFinal === false) {
          hasProvisionalCost = true;
        } else {
          hasCalculatedCost = true;
        }
      }
    }

    if (totalCostMillionths === 0) {
      return undefined;
    }

    // Determine overall status: final if all are final, provisional if any are provisional, otherwise calculated
    let isFinal: boolean | undefined;
    if (hasProvisionalCost) {
      isFinal = false; // Has at least one provisional cost
    } else if (hasFinalCost && !hasCalculatedCost) {
      isFinal = true; // All costs are final
    } else {
      isFinal = undefined; // Has calculated costs or mix
    }

    return {
      cost: totalCostMillionths,
      isFinal,
    };
  };

  const tokenBasedCost = calculateTokenBasedCost();

  // Calculate total cost (sum of all costs) and track provisional/final status
  const calculateTotalCost = ():
    | {
        cost: number;
        isFinal: boolean | undefined;
      }
    | undefined => {
    let totalMillionths = 0;
    let hasAnyCost = false;
    let hasProvisionalCost = false;
    let hasFinalCost = false;

    if (tokenBasedCost !== undefined) {
      totalMillionths += tokenBasedCost.cost;
      hasAnyCost = true;
      if (tokenBasedCost.isFinal === false) {
        hasProvisionalCost = true;
      } else if (tokenBasedCost.isFinal === true) {
        hasFinalCost = true;
      }
    }
    if (conversationDetail?.costUsd !== undefined) {
      // costUsd is in nano-dollars - assume final if it exists (it's the backend total)
      totalMillionths += conversationDetail.costUsd;
      hasAnyCost = true;
      hasFinalCost = true; // Backend total is typically final
    }
    if (conversationDetail?.rerankingCostUsd !== undefined) {
      // rerankingCostUsd is in nano-dollars - assume final (reranking costs are typically final)
      totalMillionths += conversationDetail.rerankingCostUsd;
      hasAnyCost = true;
      hasFinalCost = true;
    }

    if (!hasAnyCost) {
      return undefined;
    }

    // Determine overall status: provisional if any component is provisional, otherwise final
    const isFinal = hasProvisionalCost
      ? false
      : hasFinalCost
      ? true
      : undefined;

    return {
      cost: totalMillionths,
      isFinal,
    };
  };

  const totalCost = calculateTotalCost();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-surface-50">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
            Conversation Details
          </h2>
          <button
            onClick={onClose}
            className="rounded-xl border border-neutral-300 bg-white px-4 py-2 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
          >
            Close
          </button>
        </div>

        {/* Expiration Notice */}
        <div className="mb-4 rounded-xl border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950">
          <p className="text-xs font-medium text-yellow-800 dark:text-yellow-200">
            Note: This conversation log expires after 1 month and is
            automatically deleted
          </p>
        </div>

        {/* Conversation Metadata */}
        <div className="mb-4 space-y-4">
          {/* Basic Information */}
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-surface-100">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              <ChatBubbleLeftRightIcon className="size-4" />
              Basic Information
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="mb-1 flex items-center gap-1.5 font-medium text-neutral-700 dark:text-neutral-300">
                  <TagIcon className="size-3.5" />
                  Type
                </div>
                <div className="inline-block rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50">
                  {conversationDetail.conversationType}
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center gap-1.5 font-medium text-neutral-700 dark:text-neutral-300">
                  <ChatBubbleLeftRightIcon className="size-3.5" />
                  Messages
                </div>
                <div className="text-neutral-900 dark:text-neutral-50">
                  {conversationDetail.messageCount ??
                    (Array.isArray(conversationDetail.messages)
                      ? conversationDetail.messages.length
                      : 0)}
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center gap-1.5 font-medium text-neutral-700 dark:text-neutral-300">
                  <ClockIcon className="size-3.5" />
                  Started
                </div>
                <div className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  <ClockIcon className="size-3" />
                  {formatDate(conversationDetail.startedAt)}
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center gap-1.5 font-medium text-neutral-700 dark:text-neutral-300">
                  <ClockIcon className="size-3.5" />
                  Last Message
                </div>
                <div className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  <ClockIcon className="size-3" />
                  {formatDate(conversationDetail.lastMessageAt)}
                </div>
              </div>
            </div>
          </div>

          {/* Performance Metrics */}
          {(conversationDetail.totalGenerationTimeMs !== undefined ||
            conversationDetail.tokenUsage) && (
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-surface-100">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                <BoltIcon className="size-4" />
                Performance
              </h3>
              <div className="space-y-3">
                {conversationDetail.totalGenerationTimeMs !== undefined && (
                  <div>
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-400">
                      <BoltIcon className="size-3.5" />
                      Total Generation Time
                    </div>
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                      <BoltIcon className="size-3" />
                      {(
                        conversationDetail.totalGenerationTimeMs / 1000
                      ).toFixed(2)}
                      s
                    </div>
                  </div>
                )}
                {conversationDetail.tokenUsage && (
                  <div>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-400">
                      <CpuChipIcon className="size-3.5" />
                      Token Usage
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                          conversationDetail.tokenUsage.promptTokens
                        )}`}
                      >
                        P:{" "}
                        {conversationDetail.tokenUsage.promptTokens.toLocaleString()}
                      </span>
                      <span
                        className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                          conversationDetail.tokenUsage.completionTokens
                        )}`}
                      >
                        C:{" "}
                        {conversationDetail.tokenUsage.completionTokens.toLocaleString()}
                      </span>
                      {conversationDetail.tokenUsage &&
                        "reasoningTokens" in conversationDetail.tokenUsage &&
                        typeof conversationDetail.tokenUsage.reasoningTokens ===
                          "number" &&
                        conversationDetail.tokenUsage.reasoningTokens > 0 && (
                          <span
                            className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                              conversationDetail.tokenUsage.reasoningTokens
                            )}`}
                          >
                            R:{" "}
                            {conversationDetail.tokenUsage.reasoningTokens.toLocaleString()}
                          </span>
                        )}
                      {conversationDetail.tokenUsage &&
                        "cachedPromptTokens" in conversationDetail.tokenUsage &&
                        typeof conversationDetail.tokenUsage
                          .cachedPromptTokens === "number" &&
                        conversationDetail.tokenUsage.cachedPromptTokens >
                          0 && (
                          <span
                            className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                              conversationDetail.tokenUsage.cachedPromptTokens
                            )}`}
                          >
                            Cache:{" "}
                            {conversationDetail.tokenUsage.cachedPromptTokens.toLocaleString()}
                          </span>
                        )}
                      <span
                        className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                          conversationDetail.tokenUsage.totalTokens
                        )}`}
                      >
                        Total:{" "}
                        {conversationDetail.tokenUsage.totalTokens.toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Costs */}
          {(tokenBasedCost !== undefined ||
            conversationDetail.costUsd !== undefined ||
            conversationDetail.rerankingCostUsd !== undefined) && (
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-surface-100">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                <CurrencyDollarIcon className="size-4" />
                Costs
              </h3>
              {totalCost !== undefined && (
                <div className="mb-3 border-b border-neutral-200 pb-3 dark:border-neutral-700">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                    <CurrencyDollarIcon className="size-4" />
                    Total Cost
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-lg border-2 px-3 py-1 text-sm font-bold ${getCostColor(
                      totalCost.cost / 1_000_000_000
                    )}`}
                  >
                    <CurrencyDollarIcon className="size-4" />
                    {formatCurrency(totalCost.cost, "usd", 12)}
                    {totalCost.isFinal === true && (
                      <span className="ml-1 text-xs">✓</span>
                    )}
                    {totalCost.isFinal === false && (
                      <span className="ml-1 text-xs">(provisional)</span>
                    )}
                  </span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {tokenBasedCost !== undefined && (
                  <div>
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-400">
                      <CurrencyDollarIcon className="size-3.5" />
                      Token-Based Cost
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-semibold ${getCostColor(
                        tokenBasedCost.cost / 1_000_000_000
                      )}`}
                    >
                      <CurrencyDollarIcon className="size-3" />
                      {formatCurrency(tokenBasedCost.cost, "usd", 12)}
                      {tokenBasedCost.isFinal === true && (
                        <span className="ml-1 text-[10px]">✓</span>
                      )}
                      {tokenBasedCost.isFinal === false && (
                        <span className="ml-1 text-[10px]">(provisional)</span>
                      )}
                    </span>
                  </div>
                )}
                {conversationDetail.costUsd !== undefined && (
                  <div>
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-400">
                      <CurrencyDollarIcon className="size-3.5" />
                      Conversation Cost
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-semibold ${getCostColor(
                        conversationDetail.costUsd / 1_000_000_000
                      )}`}
                    >
                      <CurrencyDollarIcon className="size-3" />
                      {formatCurrency(conversationDetail.costUsd, "usd", 12)}
                      <span className="ml-1 text-[10px]">✓</span>
                    </span>
                  </div>
                )}
                {conversationDetail.rerankingCostUsd !== undefined &&
                  conversationDetail.rerankingCostUsd !== null && (
                    <div>
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-400">
                        <CurrencyDollarIcon className="size-3.5" />
                        Reranking Cost
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-semibold ${getCostColor(
                          conversationDetail.rerankingCostUsd / 1_000_000_000
                        )}`}
                      >
                        <CurrencyDollarIcon className="size-3" />
                        {formatCurrency(
                          conversationDetail.rerankingCostUsd,
                          "usd",
                          12
                        )}
                        <span className="ml-1 text-[10px]">✓</span>
                      </span>
                    </div>
                  )}
              </div>
            </div>
          )}
        </div>

        {/* Delegations Section */}
        {conversationDetail.delegations &&
          Array.isArray(conversationDetail.delegations) &&
          conversationDetail.delegations.length > 0 && (
            <div className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-surface-100">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                  Delegations
                </h3>
                <span className="rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-medium text-primary-800 dark:bg-primary-900 dark:text-primary-200">
                  {conversationDetail.delegations.length}
                </span>
              </div>
              <div className="space-y-3">
                {conversationDetail.delegations.map((delegation, index) => (
                  <NestedConversationDelegation
                    key={index}
                    workspaceId={workspaceId}
                    delegation={delegation}
                    depth={0}
                  />
                ))}
              </div>
            </div>
          )}

        {/* Error Details */}
        {conversationDetail.error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-red-800 dark:text-red-100">
                Provider Error
              </div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-200">
                {conversationDetail.error.endpoint || "conversation"}
              </div>
            </div>
            <div className="space-y-2 text-xs text-red-900 dark:text-red-100">
              <div>
                <span className="font-semibold">Message: </span>
                <span className="break-words">
                  {conversationDetail.error.message}
                </span>
              </div>
              {conversationDetail.error.name && (
                <div>
                  <span className="font-semibold">Name: </span>
                  {conversationDetail.error.name}
                </div>
              )}
              {conversationDetail.error.code && (
                <div>
                  <span className="font-semibold">Code: </span>
                  {conversationDetail.error.code}
                </div>
              )}
              {conversationDetail.error.statusCode !== undefined && (
                <div>
                  <span className="font-semibold">Status: </span>
                  {conversationDetail.error.statusCode}
                </div>
              )}
              {(conversationDetail.error.provider ||
                conversationDetail.error.modelName) && (
                <div>
                  <span className="font-semibold">Provider/Model: </span>
                  {conversationDetail.error.provider || "unknown"}
                  {conversationDetail.error.modelName
                    ? ` / ${conversationDetail.error.modelName}`
                    : ""}
                </div>
              )}
              {conversationDetail.error.stack && (
                <div>
                  <div className="font-semibold">Stack Trace</div>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-black bg-opacity-5 p-3 font-mono text-[11px] text-red-900 dark:bg-white dark:bg-opacity-10 dark:text-red-100">
                    {conversationDetail.error.stack}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Toggle Raw JSON */}
        <div className="mb-4">
          <button
            onClick={() => setShowRawJson(!showRawJson)}
            className="rounded-xl border border-neutral-300 bg-white px-4 py-2 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
          >
            {showRawJson ? "Show Formatted" : "Show Raw JSON"}
          </button>
        </div>

        {showRawJson ? (
          /* Raw JSON View */
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-surface-100">
            <div className="mb-2 flex items-center justify-end">
              <button
                onClick={() => {
                  const jsonString = JSON.stringify(
                    conversationDetail,
                    null,
                    2
                  );
                  navigator.clipboard.writeText(jsonString);
                  toast.success("JSON copied to clipboard");
                }}
                className="flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
                title="Copy JSON to clipboard"
              >
                <ClipboardDocumentIcon className="size-4" />
                Copy JSON
              </button>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-neutral-900 dark:text-neutral-50">
              {JSON.stringify(conversationDetail, null, 2)}
            </pre>
          </div>
        ) : (
          <>
            {/* Temporal Graph */}
            {conversationDetail && (
              <div className="mb-6">
                <ConversationTemporalGraph
                  messages={conversationDetail.messages || []}
                  conversationStartedAt={conversationDetail.startedAt}
                  conversationLastMessageAt={conversationDetail.lastMessageAt}
                />
              </div>
            )}

            {/* Messages */}
            <div className="mb-6">
              <h3 className="mb-4 border-b border-neutral-200 pb-2 text-xl font-semibold text-neutral-900 dark:border-neutral-700 dark:text-neutral-50">
                Messages
              </h3>
              <div className="space-y-4">
                {Array.isArray(conversationDetail.messages) &&
                  conversationDetail.messages.map(
                    (message: unknown, index: number) => {
                      if (
                        typeof message === "object" &&
                        message !== null &&
                        "role" in message &&
                        "content" in message
                      ) {
                        const role = message.role as string;
                        const content = message.content;

                        // Check if this is a knowledge injection message
                        const isKnowledgeInjection =
                          role === "user" &&
                          "knowledgeInjection" in message &&
                          (message as { knowledgeInjection?: boolean })
                            .knowledgeInjection === true;

                        // Get snippet count for knowledge injection messages
                        const snippetCount =
                          isKnowledgeInjection &&
                          "knowledgeSnippets" in message &&
                          Array.isArray(
                            (message as { knowledgeSnippets?: unknown })
                              .knowledgeSnippets
                          )
                            ? (message as { knowledgeSnippets: unknown[] })
                                .knowledgeSnippets.length
                            : 0;

                        // Special rendering for knowledge injection messages
                        if (isKnowledgeInjection) {
                          const knowledgeMessage = message as {
                            role: "user";
                            content?:
                              | string
                              | Array<{ type: string; text?: string }>;
                            knowledgeInjection?: boolean;
                            knowledgeSnippets?: Array<{
                              snippet: string;
                              documentName: string;
                              documentId: string;
                              folderPath: string;
                              similarity: number;
                            }>;
                          };

                          const snippets =
                            knowledgeMessage.knowledgeSnippets || [];

                          return (
                            <div key={index} className="max-w-full">
                              <details className="rounded-xl border border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-950">
                                <summary className="cursor-pointer p-4">
                                  <div className="flex items-center gap-2">
                                    <span className="text-lg">📚</span>
                                    <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
                                      Knowledge from workspace documents
                                      {snippetCount > 0 &&
                                        ` (${snippetCount} snippet${
                                          snippetCount !== 1 ? "s" : ""
                                        })`}
                                    </span>
                                  </div>
                                </summary>
                                <div className="border-t border-purple-200 p-4 dark:border-purple-800">
                                  <div className="space-y-3">
                                    {snippets.length > 0 ? (
                                      snippets.map((snippet, snippetIndex) => {
                                        const similarityPercent = (
                                          snippet.similarity * 100
                                        ).toFixed(1);
                                        return (
                                          <details
                                            key={snippetIndex}
                                            className="rounded-lg border border-purple-300 bg-purple-100 dark:border-purple-700 dark:bg-purple-900"
                                          >
                                            <summary className="cursor-pointer p-3">
                                              <div className="flex items-start justify-between gap-2">
                                                <div className="flex-1">
                                                  <div className="text-xs font-semibold text-purple-800 dark:text-purple-200">
                                                    {snippet.documentName}
                                                    {snippet.folderPath && (
                                                      <span className="ml-2 font-normal text-purple-600 dark:text-purple-400">
                                                        ({snippet.folderPath})
                                                      </span>
                                                    )}
                                                  </div>
                                                  <div className="mt-1 text-xs text-purple-700 dark:text-purple-300">
                                                    Similarity:{" "}
                                                    {similarityPercent}%
                                                  </div>
                                                </div>
                                                <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
                                                  #{snippetIndex + 1}
                                                </span>
                                              </div>
                                            </summary>
                                            <div className="border-t border-purple-300 p-3 dark:border-purple-700">
                                              <div className="text-sm text-purple-900 dark:text-purple-100">
                                                <ReactMarkdown
                                                  remarkPlugins={[remarkGfm]}
                                                  components={
                                                    markdownComponents
                                                  }
                                                >
                                                  {snippet.snippet}
                                                </ReactMarkdown>
                                              </div>
                                            </div>
                                          </details>
                                        );
                                      })
                                    ) : (
                                      <div className="text-sm text-purple-700 dark:text-purple-300">
                                        No snippets available
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </details>
                            </div>
                          );
                        }
                        const tokenUsage =
                          "tokenUsage" in message
                            ? formatTokenUsage(message.tokenUsage)
                            : null;
                        const modelName =
                          role === "assistant" &&
                          "modelName" in message &&
                          typeof message.modelName === "string"
                            ? message.modelName
                            : null;
                        const provider =
                          role === "assistant" &&
                          "provider" in message &&
                          typeof message.provider === "string"
                            ? message.provider
                            : null;
                        // Use getMessageCost() helper to get best available cost
                        const messageCost = getMessageCost(message);
                        const costUsd = messageCost?.costUsd;
                        const isFinal = messageCost?.isFinal;
                        const awsRequestId =
                          "awsRequestId" in message &&
                          typeof message.awsRequestId === "string"
                            ? message.awsRequestId
                            : null;
                        const generationTimeMs =
                          role === "assistant" &&
                          "generationTimeMs" in message &&
                          typeof message.generationTimeMs === "number"
                            ? message.generationTimeMs
                            : null;
                        return (
                          <div
                            key={index}
                            className={`rounded-xl p-4 ${
                              role === "user"
                                ? "bg-gradient-primary text-white"
                                : role === "assistant"
                                ? "border border-neutral-200 bg-neutral-50 text-neutral-900 dark:border-neutral-700 dark:bg-surface-100 dark:text-neutral-50"
                                : "border border-neutral-200 bg-neutral-50 text-neutral-900 dark:border-neutral-700 dark:bg-surface-100 dark:text-neutral-50"
                            }`}
                          >
                            <div className="mb-2 flex items-center justify-between">
                              <div className="mr-3 text-xs font-medium opacity-80 dark:opacity-90">
                                {role}
                              </div>
                              <div className="flex items-center gap-2">
                                {modelName && provider && (
                                  <div className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800 opacity-70 dark:bg-blue-900 dark:text-blue-200">
                                    {provider}/{modelName}
                                  </div>
                                )}
                                {tokenUsage && (
                                  <div className="rounded bg-black bg-opacity-10 px-2 py-1 font-mono text-xs opacity-70 dark:bg-white dark:bg-opacity-10 dark:text-neutral-200">
                                    {tokenUsage}
                                  </div>
                                )}
                                {costUsd !== undefined && (
                                  <div
                                    className={`rounded px-2 py-1 text-xs font-medium opacity-70 ${
                                      isFinal === true
                                        ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                                        : isFinal === false
                                        ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                                        : "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
                                    }`}
                                  >
                                    {formatCurrency(costUsd, "usd", 10)}
                                    {isFinal === true && " ✓"}
                                    {isFinal === false && " (provisional)"}
                                  </div>
                                )}
                                {generationTimeMs !== null && (
                                  <div className="rounded bg-indigo-100 px-2 py-1 text-xs font-medium text-indigo-800 opacity-70 dark:bg-indigo-900 dark:text-indigo-200">
                                    {(generationTimeMs / 1000).toFixed(2)}s
                                  </div>
                                )}
                              </div>
                            </div>
                            {awsRequestId && (
                              <div className="mb-2 flex items-center gap-1">
                                <span className="text-xs font-medium opacity-60 dark:opacity-70">
                                  Request ID:
                                </span>
                                <span
                                  className="rounded bg-purple-100 px-1.5 py-0.5 font-mono text-xs text-purple-800 opacity-80 dark:bg-purple-900 dark:text-purple-200"
                                  title={`AWS Request ID: ${awsRequestId}`}
                                >
                                  {awsRequestId.length > 20
                                    ? `${awsRequestId.substring(0, 20)}...`
                                    : awsRequestId}
                                </span>
                              </div>
                            )}
                            <div className="text-sm">
                              {(() => {
                                const renderedContent =
                                  renderMessageContent(content);
                                if (typeof renderedContent === "string") {
                                  return renderedContent.trim() ? (
                                    <ReactMarkdown
                                      remarkPlugins={[remarkGfm]}
                                      components={markdownComponents}
                                    >
                                      {renderedContent}
                                    </ReactMarkdown>
                                  ) : null;
                                }
                                return renderedContent;
                              })()}
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }
                  )}
              </div>
            </div>

            {/* Tool calls and results are now part of the messages array */}
          </>
        )}
      </div>
    </div>
  );
};
