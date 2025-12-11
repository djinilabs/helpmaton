import type { FC } from "react";

import { useAgentConversations } from "../hooks/useAgentConversations";
import type { Conversation } from "../utils/api";

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
    return `${tokenUsage.totalTokens.toLocaleString()} (${tokenUsage.promptTokens.toLocaleString()}+${tokenUsage.completionTokens.toLocaleString()})`;
  };

  if (isLoading && !data) {
    return (
      <>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-3xl font-bold text-neutral-900">
            Recent Conversations
          </h2>
          <button
            onClick={() => refetch()}
            disabled={isRefetching}
            className="border border-neutral-300 bg-white px-4 py-2 text-sm font-medium rounded-xl hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isRefetching ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <p className="text-sm text-neutral-600">Loading conversations...</p>
      </>
    );
  }

  if (error) {
    return (
      <>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-3xl font-bold text-neutral-900">
            Recent Conversations
          </h2>
          <button
            onClick={() => refetch()}
            disabled={isRefetching}
            className="border border-neutral-300 bg-white px-4 py-2 text-sm font-medium rounded-xl hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isRefetching ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <div className="border border-red-200 bg-red-50 rounded-xl p-4">
          <div className="text-sm font-semibold text-red-800">Error</div>
          <div className="text-xs text-red-700 mt-1">
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
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-semibold text-neutral-900">
          Recent Conversations
        </h2>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="border border-neutral-300 bg-white px-4 py-2 text-sm font-medium rounded-xl hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isRefetching ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      <div className="mb-4 space-y-2">
        <p className="text-sm text-neutral-600">
          View all conversations this agent has participated in. Each
          conversation shows the message count, token usage, and timestamps.
          Click on a conversation to view its full details and message history.
        </p>
        <div className="border border-yellow-200 bg-yellow-50 rounded-xl p-3">
          <p className="text-xs font-medium text-yellow-800">
            Note: Conversation logs expire after 1 month and are automatically
            deleted
          </p>
        </div>
      </div>

      {conversations.length === 0 ? (
        <p className="text-sm text-neutral-600">No conversations yet.</p>
      ) : (
        <>
          <div className="space-y-2 mb-4">
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                onClick={() => onConversationClick(conversation)}
                className="border-2 border-neutral-300 rounded-xl p-6 bg-white cursor-pointer hover:shadow-bold hover:border-primary-400 transition-all duration-200 transform hover:scale-[1.01] active:scale-[0.99]"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium bg-neutral-100 text-neutral-700 px-2 py-1 rounded border border-neutral-200">
                        {conversation.conversationType}
                      </span>
                      <span className="text-xs text-neutral-600">
                        {conversation.messageCount} message
                        {conversation.messageCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="text-xs text-neutral-500 mb-1">
                      Started: {formatDate(conversation.startedAt)}
                    </div>
                    <div className="text-xs text-neutral-500">
                      Last: {formatDate(conversation.lastMessageAt)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-medium text-neutral-700 mb-1">
                      Tokens
                    </div>
                    <div className="text-xs text-neutral-600">
                      {formatTokenUsage(conversation.tokenUsage)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {hasNextPage && (
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="w-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium rounded-xl hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isFetchingNextPage ? "Loading..." : "Load More"}
            </button>
          )}
        </>
      )}
    </>
  );
};
