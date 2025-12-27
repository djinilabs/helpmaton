import { lazy, Suspense, useState } from "react";
import type { FC } from "react";
import { Link } from "react-router-dom";

import {
  useAgentTransactions,
  useWorkspaceTransactions,
} from "../hooks/useTransactions";
import type { Conversation, Transaction } from "../utils/api";
import { formatCurrency } from "../utils/currency";

const ConversationDetailModal = lazy(() =>
  import("./ConversationDetailModal").then((module) => ({
    default: module.ConversationDetailModal,
  }))
);

interface TransactionTableProps {
  workspaceId: string;
  agentId?: string;
}

export const TransactionTable: FC<TransactionTableProps> = ({
  workspaceId,
  agentId,
}) => {
  const [selectedConversation, setSelectedConversation] = useState<{
    conversation: Conversation;
    agentId: string;
  } | null>(null);

  const workspaceQuery = useWorkspaceTransactions(workspaceId, 50);
  const agentQuery = useAgentTransactions(workspaceId, agentId || "", 50, {
    enabled: !!agentId,
  });

  const query = agentId ? agentQuery : workspaceQuery;

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = query;

  // Flatten all transactions from all pages
  const transactions =
    (data && "pages" in data
      ? data.pages.flatMap(
          (page: { transactions: Transaction[] }) => page.transactions
        )
      : []) ?? [];

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatSource = (source: Transaction["source"]): string => {
    switch (source) {
      case "embedding-generation":
        return "Embedding";
      case "text-generation":
        return "Text Generation";
      case "tool-execution":
        return "Tool Execution";
      default:
        return source;
    }
  };

  if (isLoading && !data) {
    return (
      <>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
            Transactions
          </h2>
          <button
            onClick={() => refetch()}
            disabled={isRefetching}
            className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
          >
            {isRefetching ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Loading transactions...
        </p>
      </>
    );
  }

  if (error) {
    return (
      <>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
            Transactions
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
          <div className="text-sm font-semibold text-red-800 dark:text-red-200">
            Error
          </div>
          <div className="mt-1 text-xs text-red-700 dark:text-red-300">
            {error instanceof Error
              ? error.message
              : "Failed to load transactions"}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
          Transactions
        </h2>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
        >
          {isRefetching ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {transactions.length === 0 ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          No transactions yet.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-neutral-300 dark:border-neutral-700">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
                    Description
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
                    Source
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
                    Supplier
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
                    Agent
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
                    Conversation
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
                    Model
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
                    Balance Before
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
                    Balance After
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction: Transaction) => (
                  <tr
                    key={transaction.id}
                    className="border-b border-neutral-200 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
                  >
                    <td className="px-4 py-3 text-sm text-neutral-600 dark:text-neutral-400">
                      {formatDate(transaction.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-neutral-900 dark:text-neutral-50">
                      <span
                        title={transaction.description}
                        className="cursor-help"
                      >
                        {transaction.description.length > 10
                          ? `${transaction.description.substring(0, 10)}...`
                          : transaction.description}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-neutral-600 dark:text-neutral-400">
                      {formatSource(transaction.source)}
                    </td>
                    <td className="px-4 py-3 text-sm text-neutral-600 dark:text-neutral-400">
                      {transaction.supplier}
                    </td>
                    <td className="px-4 py-3 text-sm text-neutral-600 dark:text-neutral-400">
                      {transaction.agentId ? (
                        <Link
                          to={`/workspaces/${workspaceId}/agents/${transaction.agentId}`}
                          className="font-medium text-primary-600 transition-colors hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                        >
                          View Agent
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-neutral-600 dark:text-neutral-400">
                      {transaction.conversationId && transaction.agentId ? (
                        <button
                          onClick={() => {
                            setSelectedConversation({
                              conversation: {
                                id: transaction.conversationId!,
                                conversationType: "test", // Will be fetched by the modal
                                startedAt: transaction.createdAt,
                                lastMessageAt: transaction.createdAt,
                                messageCount: 0,
                                tokenUsage: null,
                              },
                              agentId: transaction.agentId!,
                            });
                          }}
                          className="font-medium text-primary-600 transition-colors hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                        >
                          View Conversation
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-neutral-600 dark:text-neutral-400">
                      {transaction.model || "-"}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-neutral-900 dark:text-neutral-50">
                      {formatCurrency(transaction.amountMillionthUsd, "usd")}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-neutral-600 dark:text-neutral-400">
                      {formatCurrency(
                        transaction.workspaceCreditsBeforeMillionthUsd,
                        "usd"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-neutral-600 dark:text-neutral-400">
                      {formatCurrency(
                        transaction.workspaceCreditsAfterMillionthUsd,
                        "usd"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasNextPage && (
            <div className="mt-4">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
              >
                {isFetchingNextPage ? "Loading..." : "Load More"}
              </button>
            </div>
          )}
        </>
      )}

      {selectedConversation && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
              <div className="rounded-xl border border-neutral-200 bg-white p-8 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
                <div className="text-2xl font-semibold">
                  Loading conversation...
                </div>
              </div>
            </div>
          }
        >
          <ConversationDetailModal
            isOpen={!!selectedConversation}
            onClose={() => setSelectedConversation(null)}
            workspaceId={workspaceId}
            agentId={selectedConversation.agentId}
            conversation={selectedConversation.conversation}
          />
        </Suspense>
      )}
    </>
  );
};
