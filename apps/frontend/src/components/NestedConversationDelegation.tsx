import { ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { useState, type FC } from "react";
import { Link } from "react-router-dom";

import type { Delegation } from "../utils/api";

import { NestedConversation } from "./NestedConversation";

interface NestedConversationDelegationProps {
  workspaceId: string;
  delegation: Delegation;
  depth: number;
}

export const NestedConversationDelegation: FC<NestedConversationDelegationProps> = ({
  workspaceId,
  delegation,
  depth,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const statusColors = {
    completed:
      "bg-green-100 text-green-800 border-green-200 dark:bg-green-900 dark:text-green-200 dark:border-green-700",
    failed: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900 dark:text-red-200 dark:border-red-700",
    cancelled:
      "bg-neutral-100 text-neutral-800 border-neutral-200 dark:bg-neutral-700 dark:text-neutral-200 dark:border-neutral-600",
  };

  const hasNestedConversation = !!delegation.targetConversationId;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {hasNestedConversation && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-50"
            >
              {isExpanded ? (
                <ChevronDownIcon className="size-4" />
              ) : (
                <ChevronRightIcon className="size-4" />
              )}
            </button>
          )}
          <span
            className={`rounded border px-2 py-1 text-xs font-semibold ${statusColors[delegation.status]}`}
          >
            {delegation.status.toUpperCase()}
          </span>
          {delegation.taskId && (
            <span className="rounded bg-blue-100 px-2 py-1 font-mono text-xs text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              Task: {delegation.taskId.substring(0, 8)}...
            </span>
          )}
        </div>
        <span className="text-xs text-neutral-600 dark:text-neutral-400">
          {new Date(delegation.timestamp).toLocaleString()}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="font-medium text-neutral-700 dark:text-neutral-300">
            From:{" "}
          </span>
          <Link
            to={`/workspaces/${workspaceId}/agents/${delegation.callingAgentId}`}
            className="font-medium text-primary-600 transition-colors hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
          >
            {delegation.callingAgentId}
          </Link>
        </div>
        <div>
          <span className="font-medium text-neutral-700 dark:text-neutral-300">
            To:{" "}
          </span>
          <Link
            to={`/workspaces/${workspaceId}/agents/${delegation.targetAgentId}`}
            className="font-medium text-primary-600 transition-colors hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
          >
            {delegation.targetAgentId}
          </Link>
        </div>
      </div>

      {hasNestedConversation && isExpanded && delegation.targetConversationId && (
        <div className="mt-3 border-t border-neutral-200 pt-3 dark:border-neutral-700">
          <NestedConversation
            workspaceId={workspaceId}
            agentId={delegation.targetAgentId}
            conversationId={delegation.targetConversationId}
            depth={depth}
            isExpanded={true} // Auto-expand when delegation is expanded to trigger lazy load
          />
        </div>
      )}

      {!hasNestedConversation && (
        <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Inner conversation not available
        </div>
      )}
    </div>
  );
};
