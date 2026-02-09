import {
  ChevronDownIcon,
  ChevronUpIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
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

const DESCRIPTION_PREVIEW_LENGTH = 20;

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
  const [expandedDescriptionIds, setExpandedDescriptionIds] = useState<
    Set<string>
  >(new Set());

  const toggleDescriptionExpanded = (id: string) => {
    setExpandedDescriptionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
            className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
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
            className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
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
          className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
        >
          {isRefetching ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
        <div className="flex items-start gap-2">
          <ExclamationTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Warning: Transaction records are automatically deleted after 1 year.
          </p>
        </div>
      </div>

      {transactions.length === 0 ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          No transactions yet.
        </p>
      ) : (
        <div className="text-xs">
          <ScrollContainer ref={scrollRef} className="overflow-x-auto">
            <VirtualTable<Transaction>
              scrollRef={scrollRef}
              rows={transactions}
              getItemKey={(_i, t) => t.id}
              estimateSize={() => 52}
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
                  width: "150px",
                  render: (t) => (
                    <span className="text-neutral-600 dark:text-neutral-400">
                      {formatDate(t.createdAt)}
                    </span>
                  ),
                },
                {
                  key: "description",
                  header: "Description",
                  width: "minmax(180px, 3fr)",
                  render: (t) => {
                    const isExpanded = expandedDescriptionIds.has(t.id);
                    const showExpand =
                      t.description.length > DESCRIPTION_PREVIEW_LENGTH;
                    const preview =
                      showExpand && !isExpanded
                        ? `${t.description.slice(0, DESCRIPTION_PREVIEW_LENGTH)}…`
                        : t.description;
                    return (
                      <span
                        className={
                          isExpanded && showExpand
                            ? "whitespace-normal break-words"
                            : "whitespace-nowrap"
                        }
                      >
                        <span
                          title={t.description}
                          className="text-[11px]"
                        >
                          {preview}
                        </span>
                        {showExpand && (
                          <button
                            type="button"
                            title={isExpanded ? "Collapse" : "Expand"}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleDescriptionExpanded(t.id);
                            }}
                            className="ml-0.5 inline-flex shrink-0 rounded p-0.5 text-primary-600 hover:bg-primary-100 hover:text-primary-700 dark:text-primary-400 dark:hover:bg-primary-900/30 dark:hover:text-primary-300"
                          >
                            {isExpanded ? (
                              <ChevronUpIcon className="size-3.5" aria-hidden />
                            ) : (
                              <ChevronDownIcon className="size-3.5" aria-hidden />
                            )}
                          </button>
                        )}
                      </span>
                    );
                  },
                },
                {
                  key: "source",
                  header: "Source",
                  width: "120px",
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
                  width: "100px",
                  render: (t) => (
                    <span className="text-neutral-600 dark:text-neutral-400">
                      {t.supplier}
                    </span>
                  ),
                },
                {
                  key: "agent",
                  header: "Agent",
                  width: "90px",
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
                  header: "Conv.",
                  width: "90px",
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
                        View Conv.
                      </button>
                    ) : (
                      "-"
                    ),
                },
                {
                  key: "model",
                  header: "Model",
                  width: "100px",
                  render: (t) => (
                    <span className="text-neutral-600 dark:text-neutral-400">
                      {t.model || "-"}
                    </span>
                  ),
                },
                {
                  key: "amount",
                  header: "Amount",
                  width: "90px",
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
                  width: "100px",
                  render: (t) => (
                    <span className="text-neutral-600 dark:text-neutral-400">
                      {formatCurrency(t.workspaceCreditsBeforeNanoUsd, "usd")}
                    </span>
                  ),
                },
                {
                  key: "balanceAfter",
                  header: "Balance After",
                  width: "100px",
                  render: (t) => (
                    <span className="text-neutral-600 dark:text-neutral-400">
                      {formatCurrency(t.workspaceCreditsAfterNanoUsd, "usd")}
                    </span>
                  ),
                },
              ]}
            />
          </ScrollContainer>
        </div>
      )}

      {selectedConversation && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
              <div className="rounded-xl border border-neutral-200 bg-white p-8 shadow-xl dark:border-neutral-700 dark:bg-surface-50">
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
