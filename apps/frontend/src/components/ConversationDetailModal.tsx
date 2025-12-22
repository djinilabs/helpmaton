import { useState } from "react";
import type { FC } from "react";

import { useAgentConversation } from "../hooks/useAgentConversations";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type { Conversation } from "../utils/api";

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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white border border-neutral-200 rounded-2xl shadow-dramatic border-2 border-neutral-300 p-8 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-3xl font-bold text-neutral-900">
            Conversation Details
          </h2>
          <button
            onClick={onClose}
            className="border border-neutral-300 bg-white px-4 py-2 text-neutral-700 font-medium rounded-xl hover:bg-neutral-50 transition-colors"
          >
            Close
          </button>
        </div>

        {/* Expiration Notice */}
        <div className="border border-yellow-200 rounded-xl bg-yellow-50 p-3 mb-4">
          <p className="text-xs font-medium text-yellow-800">
            Note: This conversation log expires after 1 month and is
            automatically deleted
          </p>
        </div>

        {/* Conversation Metadata */}
        <div className="border border-neutral-200 rounded-xl p-4 mb-4 bg-neutral-50">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="font-medium text-neutral-700 mb-1">Type</div>
              <div className="text-xs bg-white px-2 py-1 border border-neutral-300 rounded inline-block text-neutral-900">
                {conversationDetail.conversationType}
              </div>
            </div>
            <div>
              <div className="font-medium text-neutral-700 mb-1">Messages</div>
              <div className="text-neutral-900">
                {conversationDetail.messageCount}
              </div>
            </div>
            <div>
              <div className="font-medium text-neutral-700 mb-1">Started</div>
              <div className="text-xs text-neutral-600">
                {formatDate(conversationDetail.startedAt)}
              </div>
            </div>
            <div>
              <div className="font-medium text-neutral-700 mb-1">
                Last Message
              </div>
              <div className="text-xs text-neutral-600">
                {formatDate(conversationDetail.lastMessageAt)}
              </div>
            </div>
            {conversationDetail.tokenUsage && (
              <div className="col-span-2">
                <div className="font-medium text-neutral-700 mb-1">
                  Token Usage
                </div>
                <div className="text-xs text-neutral-600 font-mono">
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
            className="border border-neutral-300 bg-white px-4 py-2 text-neutral-700 font-medium rounded-xl hover:bg-neutral-50 transition-colors"
          >
            {showRawJson ? "Show Formatted" : "Show Raw JSON"}
          </button>
        </div>

        {showRawJson ? (
          /* Raw JSON View */
          <div className="border border-neutral-200 rounded-xl p-4 bg-neutral-50">
            <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap text-neutral-900">
              {JSON.stringify(conversationDetail, null, 2)}
            </pre>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-neutral-900 mb-4 border-b border-neutral-200 pb-2">
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
                        return (
                          <div
                            key={index}
                            className={`rounded-xl p-4 ${
                              role === "user"
                                ? "bg-gradient-primary text-white"
                                : role === "assistant"
                                ? "bg-neutral-50 text-neutral-900 border border-neutral-200"
                                : "bg-neutral-50 text-neutral-900 border border-neutral-200"
                            }`}
                          >
                            <div className="flex justify-between items-center mb-2">
                              <div className="text-xs font-medium opacity-80">
                                {role}
                              </div>
                              <div className="flex items-center gap-2">
                                {modelName && provider && (
                                  <div className="text-xs font-medium opacity-70 bg-blue-100 text-blue-800 px-2 py-1 rounded">
                                    {provider}/{modelName}
                                  </div>
                                )}
                                {tokenUsage && (
                                  <div className="text-xs font-mono opacity-70 bg-black bg-opacity-10 px-2 py-1 rounded">
                                    {tokenUsage}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="text-sm whitespace-pre-wrap">
                              {content}
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
                  <h3 className="text-xl font-semibold text-neutral-900 mb-4 border-b border-neutral-200 pb-2">
                    Tool Calls
                  </h3>
                  <div className="space-y-2">
                    {conversationDetail.toolCalls.map(
                      (toolCall: unknown, index: number) => (
                        <div
                          key={index}
                          className="border border-neutral-200 rounded-xl p-4 bg-neutral-50"
                        >
                          <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap text-neutral-900">
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
                  <h3 className="text-xl font-semibold text-neutral-900 mb-4 border-b border-neutral-200 pb-2">
                    Tool Results
                  </h3>
                  <div className="space-y-2">
                    {conversationDetail.toolResults.map(
                      (toolResult: unknown, index: number) => (
                        <div
                          key={index}
                          className="border border-neutral-200 rounded-xl p-4 bg-neutral-50"
                        >
                          <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap text-neutral-900">
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
