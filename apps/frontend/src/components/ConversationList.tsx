import { ClockIcon } from "@heroicons/react/24/outline";
import { useEffect, useMemo, type FC } from "react";

import { useAgentConversations } from "../hooks/useAgentConversations";
import type { Conversation } from "../utils/api";
import {
  getTokenUsageColor,
  getCostColor,
} from "../utils/colorUtils";
import { formatCurrency } from "../utils/currency";
import { trackEvent } from "../utils/tracking";

interface ConversationListProps {
  workspaceId: string;
  agentId: string;
  onConversationClick: (conversation: Conversation) => void;
}

export const ConversationList: FC<ConversationListProps> = ({
  workspaceId,
  agentId,
  onConversationClick,
}) => {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useAgentConversations(workspaceId, agentId, 50);

  // Flatten all conversations from all pages
  const conversations = useMemo(
    () => data?.pages.flatMap((page) => page.conversations) ?? [],
    [data]
  );

  // Track conversation list viewing
  useEffect(() => {
    if (data && !isLoading) {
      trackEvent("agent_conversations_viewed", {
        workspace_id: workspaceId,
        agent_id: agentId,
        conversation_count: conversations.length,
      });
    }
  }, [data, isLoading, workspaceId, agentId, conversations]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatGenerationTime = (ms: number | undefined): string => {
    if (!ms) return "N/A";
    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    }
    const seconds = ms / 1000;
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  };

  // Helper function to get color classes for conversation type
  const getConversationTypeColor = (
    type: Conversation["conversationType"]
  ): string => {
    switch (type) {
      case "test":
        return "bg-primary-100 text-primary-700 border-primary-200 dark:bg-primary-900 dark:text-primary-300 dark:border-primary-700";
      case "webhook":
        return "bg-accent-100 text-accent-700 border-accent-200 dark:bg-accent-900 dark:text-accent-300 dark:border-accent-700";
      case "stream":
        return "bg-success-100 text-success-700 border-success-200 dark:bg-success-900 dark:text-success-300 dark:border-success-700";
      default:
        return "bg-neutral-100 text-neutral-700 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:border-neutral-700";
    }
  };


  if (isLoading && !data) {
    return (
      <>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
            Recent Conversations
          </h2>
          <button
            onClick={() => refetch()}
            disabled={isRefetching}
            className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
          >
            {isRefetching ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">Loading conversations...</p>
      </>
    );
  }

  if (error) {
    return (
      <>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
            Recent Conversations
          </h2>
          <button
            onClick={() => refetch()}
            disabled={isRefetching}
            className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
          >
            {isRefetching ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
          <div className="text-sm font-semibold text-red-800 dark:text-red-200">Error</div>
          <div className="mt-1 text-xs text-red-700 dark:text-red-300">
            {error instanceof Error
              ? error.message
              : "Failed to load conversations"}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
          Recent Conversations
        </h2>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
        >
          {isRefetching ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      <div className="mb-4 space-y-2">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          View all conversations this agent has participated in. Each
          conversation shows the message count, token usage, and timestamps.
          Click on a conversation to view its full details and message history.
        </p>
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950">
          <p className="text-xs font-medium text-yellow-800 dark:text-yellow-200">
            Note: Conversation logs expire after 1 month and are automatically
            deleted
          </p>
        </div>
      </div>

      {conversations.length === 0 ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">No conversations yet.</p>
      ) : (
        <>
          <div className="mb-4 space-y-2">
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                onClick={() => {
                  trackEvent("agent_conversation_viewed", {
                    workspace_id: workspaceId,
                    agent_id: agentId,
                    conversation_id: conversation.id,
                    conversation_type: conversation.conversationType,
                  });
                  onConversationClick(conversation);
                }}
                className="transform cursor-pointer rounded-xl border-2 border-neutral-300 bg-white p-4 transition-all duration-200 hover:scale-[1.01] hover:border-primary-400 hover:shadow-bold active:scale-[0.99] dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-primary-500"
              >
                {/* Header Row - Type, Message Count, Error Badge, and Cost */}
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-lg border px-2 py-1 text-xs font-semibold ${getConversationTypeColor(
                        conversation.conversationType
                      )}`}
                    >
                      {conversation.conversationType.toUpperCase()}
                    </span>
                    <span className="text-xs text-neutral-600 dark:text-neutral-400">
                      {conversation.messageCount} message
                      {conversation.messageCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-2">
                      {conversation.hasError && (
                        <div className="inline-flex items-center gap-1 rounded-lg border border-error-200 bg-error-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-error-800 dark:border-error-800 dark:bg-error-900 dark:text-error-200">
                          Error
                        </div>
                      )}
                      {conversation.costUsd !== undefined && (
                        <span
                          className={`rounded-lg border px-2 py-1 text-xs font-semibold ${getCostColor(
                            conversation.costUsd
                          )}`}
                        >
                          {formatCurrency(conversation.costUsd, "usd", 10)}
                        </span>
                      )}
                    </div>
                    {conversation.rerankingCostUsd !== undefined && (
                      <span
                        className={`rounded-lg border px-2 py-0.5 text-[10px] font-medium ${getCostColor(
                          conversation.rerankingCostUsd
                        )}`}
                        title="Reranking cost"
                      >
                        Rerank: {formatCurrency(conversation.rerankingCostUsd, "usd", 10)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Second Row - Timestamps, Generation Time, and Token Usage */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4 text-xs text-neutral-600 dark:text-neutral-400">
                    <div className="flex items-center gap-1">
                      <ClockIcon className="size-3" />
                      <span>{formatDate(conversation.startedAt)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <ClockIcon className="size-3" />
                      <span>{formatDate(conversation.lastMessageAt)}</span>
                    </div>
                    {conversation.totalGenerationTimeMs !== undefined && (
                      <div className="flex items-center gap-1">
                        <ClockIcon className="size-3" />
                        <span className="font-medium">
                          {formatGenerationTime(conversation.totalGenerationTimeMs)}
                        </span>
                      </div>
                    )}
                  </div>
                  {conversation.tokenUsage && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                          conversation.tokenUsage.promptTokens
                        )}`}
                      >
                        P: {conversation.tokenUsage.promptTokens.toLocaleString()}
                      </span>
                      <span
                        className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                          conversation.tokenUsage.completionTokens
                        )}`}
                      >
                        C:{" "}
                        {conversation.tokenUsage.completionTokens.toLocaleString()}
                      </span>
                      {"reasoningTokens" in conversation.tokenUsage &&
                        typeof conversation.tokenUsage.reasoningTokens ===
                          "number" &&
                        conversation.tokenUsage.reasoningTokens > 0 && (
                          <span
                            className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                              conversation.tokenUsage.reasoningTokens
                            )}`}
                          >
                            R:{" "}
                            {conversation.tokenUsage.reasoningTokens.toLocaleString()}
                          </span>
                        )}
                      {"cachedPromptTokens" in conversation.tokenUsage &&
                        typeof conversation.tokenUsage.cachedPromptTokens ===
                          "number" &&
                        conversation.tokenUsage.cachedPromptTokens > 0 && (
                          <span
                            className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                              conversation.tokenUsage.cachedPromptTokens
                            )}`}
                          >
                            Cache:{" "}
                            {conversation.tokenUsage.cachedPromptTokens.toLocaleString()}
                          </span>
                        )}
                      <span
                        className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                          conversation.tokenUsage.totalTokens
                        )}`}
                      >
                        Total:{" "}
                        {conversation.tokenUsage.totalTokens.toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {hasNextPage && (
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              {isFetchingNextPage ? "Loading..." : "Load More"}
            </button>
          )}
        </>
      )}
    </>
  );
};
