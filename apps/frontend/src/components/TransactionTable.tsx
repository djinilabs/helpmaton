import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import type { FC } from "react";
import { lazy, Suspense, useState, useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";

import {
  useAgentTransactions,
  useWorkspaceTransactions,
} from "../hooks/useTransactions";
import type { Transaction } from "../utils/api";
import {
  getTransactionTypeColor,
  getCostColor,
} from "../utils/colorUtils";
import { formatCurrency } from "../utils/currency";
import { trackEvent } from "../utils/tracking";

import { ScrollContainer } from "./ScrollContainer";
import { VirtualTable } from "./VirtualTable";

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedConversation, setSelectedConversation] = useState<{
    conversationId: string;
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
  const transactions = useMemo(
    () =>
      (data && "pages" in data
        ? data.pages.flatMap(
            (page: { transactions: Transaction[] }) => page.transactions
          )
        : []) ?? [],
    [data]
  );

  // Track transaction viewing
  useEffect(() => {
    if (data && !isLoading) {
      const transactionCount = transactions.length;
      if (agentId) {
        trackEvent("agent_transactions_viewed", {
          workspace_id: workspaceId,
          agent_id: agentId,
          transaction_count: transactionCount,
        });
      } else {
        trackEvent("workspace_transactions_viewed", {
          workspace_id: workspaceId,
          transaction_count: transactionCount,
        });
      }
    }
  }, [data, isLoading, workspaceId, agentId, transactions]);

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

      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
        <div className="flex items-start gap-2">
          <ExclamationTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Warning: Transaction records are automatically deleted after 1 year
            for data retention purposes.
          </p>
        </div>
      </div>

      {transactions.length === 0 ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          No transactions yet.
        </p>
      ) : (
        <ScrollContainer ref={scrollRef} className="overflow-x-auto">
          <VirtualTable<Transaction>
            scrollRef={scrollRef}
            rows={transactions}
            getItemKey={(_i, t) => t.id}
            rowHeight={52}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            empty={
              <p className="py-4 text-sm text-neutral-600 dark:text-neutral-300">
                No transactions yet.
              </p>
            }
            columns={[
              {
                key: "date",
                header: "Date",
                render: (t) => (
                  <span className="text-neutral-600 dark:text-neutral-400">
                    {formatDate(t.createdAt)}
                  </span>
                ),
              },
              {
                key: "description",
                header: "Description",
                render: (t) => (
                  <span title={t.description} className="cursor-help">
                    {t.description.length > 10
                      ? `${t.description.substring(0, 10)}...`
                      : t.description}
                  </span>
                ),
              },
              {
                key: "source",
                header: "Source",
                render: (t) => (
                  <span
                    className={`inline-block rounded-lg border px-2 py-1 text-xs font-semibold ${getTransactionTypeColor(
                      t.source
                    )}`}
                  >
                    {formatSource(t.source)}
                  </span>
                ),
              },
              {
                key: "supplier",
                header: "Supplier",
                render: (t) => (
                  <span className="text-neutral-600 dark:text-neutral-400">
                    {t.supplier}
                  </span>
                ),
              },
              {
                key: "agent",
                header: "Agent",
                render: (t) =>
                  t.agentId ? (
                    <Link
                      to={`/workspaces/${workspaceId}/agents/${t.agentId}`}
                      className="font-medium text-primary-600 transition-colors hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                    >
                      View Agent
                    </Link>
                  ) : (
                    "-"
                  ),
              },
              {
                key: "conversation",
                header: "Conversation",
                render: (t) =>
                  t.conversationId && t.agentId ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedConversation({
                          conversationId: t.conversationId!,
                          agentId: t.agentId!,
                        });
                      }}
                      className="font-medium text-primary-600 transition-colors hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                    >
                      View Conversation
                    </button>
                  ) : (
                    "-"
                  ),
              },
              {
                key: "model",
                header: "Model",
                render: (t) => (
                  <span className="text-neutral-600 dark:text-neutral-400">
                    {t.model || "-"}
                  </span>
                ),
              },
              {
                key: "amount",
                header: "Amount",
                render: (t) => (
                  <span
                    className={`inline-block rounded-lg border px-2 py-1 text-xs font-semibold ${getCostColor(
                      t.amountNanoUsd / 1_000_000_000
                    )}`}
                  >
                    {formatCurrency(t.amountNanoUsd, "usd")}
                  </span>
                ),
              },
              {
                key: "balanceBefore",
                header: "Balance Before",
                render: (t) => (
                  <span className="text-neutral-600 dark:text-neutral-400">
                    {formatCurrency(t.workspaceCreditsBeforeNanoUsd, "usd")}
                  </span>
                ),
              },
              {
                key: "balanceAfter",
                header: "Balance After",
                render: (t) => (
                  <span className="text-neutral-600 dark:text-neutral-400">
                    {formatCurrency(t.workspaceCreditsAfterNanoUsd, "usd")}
                  </span>
                ),
              },
            ]}
          />
        </ScrollContainer>
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
            conversationId={selectedConversation.conversationId}
          />
        </Suspense>
      )}
    </>
  );
};
