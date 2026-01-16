import {
  ChevronDownIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import { useState, type FC } from "react";
import { Link } from "react-router-dom";

import { useAgentConversationNested } from "../hooks/useAgentConversations";
import type { Delegation } from "../utils/api";

import { NestedConversationDelegation } from "./NestedConversationDelegation";

interface NestedConversationProps {
  workspaceId: string;
  agentId: string;
  conversationId: string;
  depth: number;
  isExpanded?: boolean;
}

export const NestedConversation: FC<NestedConversationProps> = ({
  workspaceId,
  agentId,
  conversationId,
  depth,
  isExpanded: initialExpanded = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  // Only fetch when expanded - lazy loading
  const { data: conversation, isLoading, error } = useAgentConversationNested(
    workspaceId,
    agentId,
    conversationId,
    isExpanded // Only fetch when expanded
  );

  // Calculate indentation - use fixed Tailwind classes
  const indentClasses = [
    "",
    "ml-4",
    "ml-8",
    "ml-12",
    "ml-16",
    "ml-20",
  ];
  const indentClass =
    indentClasses[Math.min(depth, indentClasses.length - 1)] || "ml-20";

  const borderColor =
    depth % 2 === 0
      ? "border-blue-200 dark:border-blue-800"
      : "border-purple-200 dark:border-purple-800";
  const bgColor =
    depth % 2 === 0
      ? "bg-blue-50 dark:bg-blue-950"
      : "bg-purple-50 dark:bg-purple-950";

  // Show loading state only when expanded and loading
  if (isExpanded && isLoading) {
    return (
      <div className={`${indentClass} mt-2`}>
        <div
          className={`rounded-lg border ${borderColor} ${bgColor} p-4`}
        >
          <div className="flex items-center gap-3">
            <div className="size-5 animate-spin rounded-full border-2 border-neutral-300 border-t-primary-600 dark:border-neutral-600 dark:border-t-primary-400" />
            <div className="text-sm text-neutral-600 dark:text-neutral-400">
              Loading nested conversation...
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show error state only when expanded and there's an error
  if (isExpanded && error) {
    return (
      <div className={`${indentClass} mt-2`}>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          Error loading nested conversation:{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </div>
      </div>
    );
  }

  // Show not found only when expanded and no conversation
  if (isExpanded && !conversation && !isLoading) {
    return (
      <div className={`${indentClass} mt-2`}>
        <div
          className={`rounded-lg border ${borderColor} ${bgColor} p-3 text-sm text-neutral-600 dark:text-neutral-400`}
        >
          Conversation not found
        </div>
      </div>
    );
  }

  // If not expanded, show a collapsed view
  if (!isExpanded) {
    return (
      <div className={`${indentClass} mt-2`}>
        <div
          className={`rounded-lg border ${borderColor} ${bgColor} p-3 transition-all`}
        >
          <button
            onClick={() => setIsExpanded(true)}
            className="flex w-full items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <ChevronRightIcon className="size-4 text-neutral-600 dark:text-neutral-400" />
              <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                Conversation: {conversationId.substring(0, 8)}...
              </span>
              <Link
                to={`/workspaces/${workspaceId}/agents/${agentId}`}
                className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                onClick={(e) => e.stopPropagation()}
              >
                Agent: {agentId}
              </Link>
            </div>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              Click to expand
            </span>
          </button>
        </div>
      </div>
    );
  }

  // If expanded but no conversation data yet (shouldn't happen due to loading state above, but safety check)
  if (!conversation) {
    return null;
  }

  const hasDelegations =
    conversation.delegations && conversation.delegations.length > 0;

  return (
    <div className={`${indentClass} mt-2`}>
      <div
        className={`rounded-lg border ${borderColor} ${bgColor} p-4 transition-all`}
      >
        <button
          onClick={() => setIsExpanded(false)}
          className="mb-2 flex w-full items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <ChevronDownIcon className="size-4 text-neutral-600 dark:text-neutral-400" />
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
              Conversation: {conversationId.substring(0, 8)}...
            </span>
            <Link
              to={`/workspaces/${workspaceId}/agents/${agentId}`}
              className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
              onClick={(e) => e.stopPropagation()}
            >
              Agent: {agentId}
            </Link>
          </div>
          {hasDelegations && (
            <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-800 dark:bg-primary-900 dark:text-primary-200">
              {conversation.delegations?.length} delegation
              {conversation.delegations?.length !== 1 ? "s" : ""}
            </span>
          )}
        </button>

        <div className="mt-3 space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-700">
          <div className="text-xs text-neutral-600 dark:text-neutral-400">
            <div>
              Type:{" "}
              <span className="font-medium">{conversation.conversationType}</span>
            </div>
            <div>
              Messages:{" "}
              <span className="font-medium">
                {conversation.messages?.length || 0}
              </span>
            </div>
            {conversation.tokenUsage && (
              <div>
                Tokens:{" "}
                <span className="font-medium">
                  {conversation.tokenUsage.totalTokens.toLocaleString()}
                </span>
              </div>
            )}
          </div>

          {hasDelegations && (
            <div className="mt-3 space-y-2">
              <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                Delegations:
              </div>
              {conversation.delegations?.map(
                (delegation: Delegation, index: number) => (
                  <NestedConversationDelegation
                    key={index}
                    workspaceId={workspaceId}
                    delegation={delegation}
                    depth={depth + 1}
                  />
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
