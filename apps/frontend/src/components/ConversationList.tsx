import type { FC } from "react";

import { useAgentConversations } from "../hooks/useAgentConversations";
import type { Conversation } from "../utils/api";
import { formatCurrency } from "../utils/currency";

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
  const conversations = data?.pages.flatMap((page) => page.conversations) ?? [];

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatTokenUsage = (tokenUsage: Conversation["tokenUsage"]): string => {
    if (!tokenUsage) return "N/A";
    const parts: string[] = [];
    parts.push(`P: ${tokenUsage.promptTokens.toLocaleString()}`);
    parts.push(`C: ${tokenUsage.completionTokens.toLocaleString()}`);
    if (
      "reasoningTokens" in tokenUsage &&
      typeof tokenUsage.reasoningTokens === "number" &&
      tokenUsage.reasoningTokens > 0
    ) {
      parts.push(`R: ${tokenUsage.reasoningTokens.toLocaleString()}`);
    }
    if (
      "cachedPromptTokens" in tokenUsage &&
      typeof tokenUsage.cachedPromptTokens === "number" &&
      tokenUsage.cachedPromptTokens > 0
    ) {
      parts.push(`Cache: ${tokenUsage.cachedPromptTokens.toLocaleString()}`);
    }
    return `${tokenUsage.totalTokens.toLocaleString()} (${parts.join(", ")})`;
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
                onClick={() => onConversationClick(conversation)}
                className="transform cursor-pointer rounded-xl border-2 border-neutral-300 bg-white p-6 transition-all duration-200 hover:scale-[1.01] hover:border-primary-400 hover:shadow-bold active:scale-[0.99] dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-primary-500"
              >
                <div className="mb-2 flex items-start justify-between">
                  <div className="flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded border border-neutral-200 bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                        {conversation.conversationType}
                      </span>
                      <span className="text-xs text-neutral-600 dark:text-neutral-300">
                        {conversation.messageCount} message
                        {conversation.messageCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="mb-1 text-xs text-neutral-500 dark:text-neutral-300">
                      Started: {formatDate(conversation.startedAt)}
                    </div>
                    <div className="text-xs text-neutral-500 dark:text-neutral-300">
                      Last: {formatDate(conversation.lastMessageAt)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="mb-1 text-xs font-medium text-neutral-700 dark:text-neutral-300">
                      Tokens
                    </div>
                    <div className="mb-1 text-xs text-neutral-600 dark:text-neutral-300">
                      {formatTokenUsage(conversation.tokenUsage)}
                    </div>
                    {conversation.costUsd !== undefined && (
                      <>
                        <div className="mb-1 text-xs font-medium text-neutral-700 dark:text-neutral-300">
                          Cost
                        </div>
                        <div className="text-xs text-neutral-600 dark:text-neutral-300">
                          {formatCurrency(conversation.costUsd, "usd", 10)}
                        </div>
                      </>
                    )}
                  </div>
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
