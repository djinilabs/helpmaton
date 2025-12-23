import { useState } from "react";
import type { FC } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useAgentConversation } from "../hooks/useAgentConversations";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type { Conversation } from "../utils/api";
import { formatCurrency } from "../utils/currency";

interface ConversationDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  agentId: string;
  conversation: Conversation;
}

export const ConversationDetailModal: FC<ConversationDetailModalProps> = ({
  isOpen,
  onClose,
  workspaceId,
  agentId,
  conversation,
}) => {
  const { data: conversationDetail } = useAgentConversation(
    workspaceId,
    agentId,
    conversation.id
  );
  const [showRawJson, setShowRawJson] = useState(false);

  useEscapeKey(isOpen, onClose);

  if (!isOpen) return null;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatMessageContent = (content: unknown): string => {
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === "string") return item;
          if (typeof item === "object" && item !== null) {
            if ("type" in item && item.type === "tool-call") {
              return `[Tool Call: ${
                (item as { toolName?: string }).toolName || "unknown"
              }]`;
            }
            if ("type" in item && item.type === "tool-result") {
              return `[Tool Result: ${
                (item as { toolName?: string }).toolName || "unknown"
              }]`;
            }
            if ("text" in item && typeof item.text === "string") {
              return item.text;
            }
          }
          return JSON.stringify(item);
        })
        .join("\n");
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
            Conversation Details
          </h2>
          <button
            onClick={onClose}
            className="rounded-xl border border-neutral-300 bg-white px-4 py-2 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
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
        <div className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="mb-1 font-medium text-neutral-700 dark:text-neutral-300">
                Type
              </div>
              <div className="inline-block rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50">
                {conversationDetail.conversationType}
              </div>
            </div>
            <div>
              <div className="mb-1 font-medium text-neutral-700 dark:text-neutral-300">
                Messages
              </div>
              <div className="text-neutral-900 dark:text-neutral-50">
                {conversationDetail.messageCount}
              </div>
            </div>
            <div>
              <div className="mb-1 font-medium text-neutral-700 dark:text-neutral-300">
                Started
              </div>
              <div className="text-xs text-neutral-600 dark:text-neutral-300">
                {formatDate(conversationDetail.startedAt)}
              </div>
            </div>
            <div>
              <div className="mb-1 font-medium text-neutral-700 dark:text-neutral-300">
                Last Message
              </div>
              <div className="text-xs text-neutral-600 dark:text-neutral-300">
                {formatDate(conversationDetail.lastMessageAt)}
              </div>
            </div>
            {conversationDetail.tokenUsage && (
              <div className="col-span-2">
                <div className="mb-1 font-medium text-neutral-700 dark:text-neutral-300">
                  Token Usage
                </div>
                <div className="font-mono text-xs text-neutral-600 dark:text-neutral-300">
                  Total:{" "}
                  {conversationDetail.tokenUsage.totalTokens.toLocaleString()} |
                  Prompt:{" "}
                  {conversationDetail.tokenUsage.promptTokens.toLocaleString()}{" "}
                  | Completion:{" "}
                  {conversationDetail.tokenUsage.completionTokens.toLocaleString()}
                  {conversationDetail.tokenUsage &&
                    "reasoningTokens" in conversationDetail.tokenUsage &&
                    typeof conversationDetail.tokenUsage.reasoningTokens ===
                      "number" &&
                    conversationDetail.tokenUsage.reasoningTokens > 0 && (
                      <>
                        {" "}
                        | Reasoning:{" "}
                        {conversationDetail.tokenUsage.reasoningTokens.toLocaleString()}
                      </>
                    )}
                  {conversationDetail.tokenUsage &&
                    "cachedPromptTokens" in conversationDetail.tokenUsage &&
                    typeof conversationDetail.tokenUsage.cachedPromptTokens ===
                      "number" &&
                    conversationDetail.tokenUsage.cachedPromptTokens > 0 && (
                      <>
                        {" "}
                        | Cached:{" "}
                        {conversationDetail.tokenUsage.cachedPromptTokens.toLocaleString()}
                      </>
                    )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Toggle Raw JSON */}
        <div className="mb-4">
          <button
            onClick={() => setShowRawJson(!showRawJson)}
            className="rounded-xl border border-neutral-300 bg-white px-4 py-2 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
          >
            {showRawJson ? "Show Formatted" : "Show Raw JSON"}
          </button>
        </div>

        {showRawJson ? (
          /* Raw JSON View */
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-neutral-900 dark:text-neutral-50">
              {JSON.stringify(conversationDetail, null, 2)}
            </pre>
          </div>
        ) : (
          <>
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
                        const content = formatMessageContent(message.content);
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
                        const provisionalCostUsd =
                          role === "assistant" &&
                          "provisionalCostUsd" in message &&
                          typeof message.provisionalCostUsd === "number"
                            ? message.provisionalCostUsd
                            : null;
                        const finalCostUsd =
                          role === "assistant" &&
                          "finalCostUsd" in message &&
                          typeof message.finalCostUsd === "number"
                            ? message.finalCostUsd
                            : null;
                        return (
                          <div
                            key={index}
                            className={`rounded-xl p-4 ${
                              role === "user"
                                ? "bg-gradient-primary text-white"
                                : role === "assistant"
                                ? "border border-neutral-200 bg-neutral-50 text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                                : "border border-neutral-200 bg-neutral-50 text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                            }`}
                          >
                            <div className="mb-2 flex items-center justify-between">
                              <div className="text-xs font-medium opacity-80 dark:opacity-90">
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
                                {provisionalCostUsd !== null &&
                                  finalCostUsd === null && (
                                    <div className="rounded bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800 opacity-70 dark:bg-yellow-900 dark:text-yellow-200">
                                      {formatCurrency(
                                        provisionalCostUsd,
                                        "usd",
                                        4
                                      )}{" "}
                                      (provisional)
                                    </div>
                                  )}
                                {finalCostUsd !== null && (
                                  <div className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-800 opacity-70 dark:bg-green-900 dark:text-green-200">
                                    {formatCurrency(finalCostUsd, "usd", 4)}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="text-sm">
                              {role === "user" ? (
                                <div className="whitespace-pre-wrap">
                                  {content}
                                </div>
                              ) : (
                                content.trim() && (
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                      code: (props) => {
                                        const { className, children, ...rest } =
                                          props;
                                        const isInline =
                                          !className ||
                                          !className.includes("language-");
                                        if (isInline) {
                                          return (
                                            <code
                                              className="rounded-lg border-2 border-neutral-300 bg-neutral-100 px-2 py-1 font-mono text-xs font-bold dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                                              {...rest}
                                            >
                                              {children}
                                            </code>
                                          );
                                        }
                                        return (
                                          <code
                                            className="block overflow-x-auto rounded-xl border-2 border-neutral-300 bg-neutral-100 p-5 font-mono text-sm font-bold dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                                            {...rest}
                                          >
                                            {children}
                                          </code>
                                        );
                                      },
                                      p: ({ children }) => (
                                        <p className="mb-2 last:mb-0">
                                          {children}
                                        </p>
                                      ),
                                    }}
                                  >
                                    {content}
                                  </ReactMarkdown>
                                )
                              )}
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }
                  )}
              </div>
            </div>

            {/* Tool Calls */}
            {Array.isArray(conversationDetail.toolCalls) &&
              conversationDetail.toolCalls.length > 0 && (
                <div className="mb-6">
                  <h3 className="mb-4 border-b border-neutral-200 pb-2 text-xl font-semibold text-neutral-900 dark:border-neutral-700 dark:text-neutral-50">
                    Tool Calls
                  </h3>
                  <div className="space-y-2">
                    {conversationDetail.toolCalls.map(
                      (toolCall: unknown, index: number) => (
                        <div
                          key={index}
                          className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800"
                        >
                          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-neutral-900 dark:text-neutral-50">
                            {JSON.stringify(toolCall, null, 2)}
                          </pre>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

            {/* Tool Results */}
            {Array.isArray(conversationDetail.toolResults) &&
              conversationDetail.toolResults.length > 0 && (
                <div className="mb-6">
                  <h3 className="mb-4 border-b border-neutral-200 pb-2 text-xl font-semibold text-neutral-900 dark:border-neutral-700 dark:text-neutral-50">
                    Tool Results
                  </h3>
                  <div className="space-y-2">
                    {conversationDetail.toolResults.map(
                      (toolResult: unknown, index: number) => (
                        <div
                          key={index}
                          className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800"
                        >
                          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-neutral-900 dark:text-neutral-50">
                            {JSON.stringify(toolResult, null, 2)}
                          </pre>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
          </>
        )}
      </div>
    </div>
  );
};
