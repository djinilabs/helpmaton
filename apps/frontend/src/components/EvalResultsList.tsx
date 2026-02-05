import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import type { FC } from "react";
import { useState, useMemo, Suspense, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useEscapeKey } from "../hooks/useEscapeKey";
import { useAgentEvalResults, useEvalJudges } from "../hooks/useEvalJudges";
import type { EvalResult, EvalResultsResponse } from "../utils/api";
import { canOpenEvalConversation } from "../utils/evalResults";

import { ScrollContainer } from "./ScrollContainer";
import { VirtualTable } from "./VirtualTable";

interface EvalResultsListProps {
  workspaceId: string;
  agentId: string;
  judgeId?: string;
  startDate?: string;
  endDate?: string;
  onConversationOpen?: (conversationId: string) => void;
}

export const EvalResultsList: FC<EvalResultsListProps> = ({
  workspaceId,
  agentId,
  judgeId,
  startDate,
  endDate,
  onConversationOpen,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedResult, setSelectedResult] = useState<EvalResult | null>(
    null
  );
  const [sortBy, setSortBy] = useState<"date" | "judge">("date");
  const [filterJudgeId, setFilterJudgeId] = useState<string | undefined>(
    judgeId
  );
  const isDetailsOpen = !!selectedResult;

  useEscapeKey(isDetailsOpen, () => setSelectedResult(null));

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useAgentEvalResults(
    workspaceId,
    agentId,
    {
      startDate,
      endDate,
      judgeId: filterJudgeId,
    },
    50
  );

  const { data: judges } = useEvalJudges(workspaceId, agentId);

  // Flatten all results from all pages and calculate aggregates from all pages
  const { results, aggregates } = useMemo(() => {
    if (!data) {
      return {
        results: [],
        aggregates: {
          totalEvaluations: 0,
          averageScores: { goalCompletion: 0, toolEfficiency: 0, faithfulness: 0 },
          criticalFailures: 0,
        },
      };
    }

    // Flatten all results from all pages
    // useInfiniteQuery returns data with pages property
    const allResults = (
      (data as unknown as { pages: EvalResultsResponse[] }).pages
    ).flatMap((page) => page.results);

    const hasCompletedScores = (
      result: EvalResult
    ): result is EvalResult & {
      scoreGoalCompletion: number;
      scoreToolEfficiency: number;
      scoreFaithfulness: number;
    } =>
      result.status === "completed" &&
      result.scoreGoalCompletion !== null &&
      result.scoreToolEfficiency !== null &&
      result.scoreFaithfulness !== null;

    // Sort results
    const sorted = [...allResults];
    if (sortBy === "date") {
      sorted.sort(
        (a, b) =>
          new Date(b.evaluatedAt).getTime() -
          new Date(a.evaluatedAt).getTime()
      );
    } else {
      sorted.sort((a, b) => a.judgeName.localeCompare(b.judgeName));
    }

    // Calculate aggregates from completed results only
    const completedResults = allResults.filter(hasCompletedScores);
    const totalEvaluations = completedResults.length;
    let sumGoalCompletion = 0;
    let sumToolEfficiency = 0;
    let sumFaithfulness = 0;
    let criticalFailures = 0;

    for (const result of completedResults) {
      sumGoalCompletion += result.scoreGoalCompletion;
      sumToolEfficiency += result.scoreToolEfficiency;
      sumFaithfulness += result.scoreFaithfulness;
      if (result.criticalFailureDetected) {
        criticalFailures++;
      }
    }

    const averageScores = {
      goalCompletion:
        totalEvaluations > 0 ? sumGoalCompletion / totalEvaluations : 0,
      toolEfficiency:
        totalEvaluations > 0 ? sumToolEfficiency / totalEvaluations : 0,
      faithfulness:
        totalEvaluations > 0 ? sumFaithfulness / totalEvaluations : 0,
    };

    return {
      results: sorted,
      aggregates: {
        totalEvaluations,
        averageScores,
        criticalFailures,
      },
    };
  }, [data, sortBy]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getScoreColor = (score: number): string => {
    if (score >= 80) {
      return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900 dark:text-green-200 dark:border-green-700";
    } else if (score >= 60) {
      return "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900 dark:text-yellow-200 dark:border-yellow-700";
    } else {
      return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900 dark:text-red-200 dark:border-red-700";
    }
  };

  if (isLoading && !data) {
    return (
      <>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
            Evaluation Results
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
          Loading evaluation results...
        </p>
      </>
    );
  }

  if (error) {
    return (
      <>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
            Evaluation Results
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
              : "Failed to load evaluation results"}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
          Evaluation Results
        </h2>
        <div className="flex gap-2">
          {judges && judges.length > 0 && (
            <select
              value={filterJudgeId || ""}
              onChange={(e) =>
                setFilterJudgeId(e.target.value || undefined)
              }
              className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              <option value="">All Judges</option>
              {judges.map((judge) => (
                <option key={judge.id} value={judge.id}>
                  {judge.name}
                </option>
              ))}
            </select>
          )}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "date" | "judge")}
            className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
          >
            <option value="date">Sort by Date</option>
            <option value="judge">Sort by Judge</option>
          </select>
          <button
            onClick={() => refetch()}
            disabled={isRefetching}
            className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
          >
            {isRefetching ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {data && aggregates.totalEvaluations > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
              Total Evaluations
            </div>
            <div className="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
              {aggregates.totalEvaluations}
            </div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
              Avg Goal Completion
            </div>
            <div className="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
              {aggregates.averageScores.goalCompletion.toFixed(1)}%
            </div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
              Avg Tool Efficiency
            </div>
            <div className="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
              {aggregates.averageScores.toolEfficiency.toFixed(1)}%
            </div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
              Critical Failures
            </div>
            <div className="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">
              {aggregates.criticalFailures}
            </div>
          </div>
        </div>
      )}

      {results.length === 0 ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          No evaluation results yet.
        </p>
      ) : (
        <ScrollContainer ref={scrollRef} className="overflow-x-auto">
          <VirtualTable<EvalResult>
            scrollRef={scrollRef}
            rows={results}
            getItemKey={(_, r) => `${r.conversationId}-${r.judgeId}-${r.evaluatedAt}`}
            rowHeight={52}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            empty={
              <p className="py-4 text-sm text-neutral-600 dark:text-neutral-300">
                No evaluation results yet.
              </p>
            }
            columns={[
              {
                key: "date",
                header: "Date",
                render: (result) => (
                  <span className="text-neutral-600 dark:text-neutral-400">
                    {formatDate(result.evaluatedAt)}
                  </span>
                ),
              },
              {
                key: "judge",
                header: "Judge",
                render: (result) => {
                  const isFailed = result.status === "failed";
                  return (
                    <div className="flex items-center gap-2">
                      <span>{result.judgeName}</span>
                      {isFailed && (
                        <span className="rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:border-red-700 dark:bg-red-900 dark:text-red-200">
                          Failed
                        </span>
                      )}
                    </div>
                  );
                },
              },
              {
                key: "goalCompletion",
                header: "Goal Completion",
                render: (result) => {
                  const isFailed = result.status === "failed";
                  const goalScore = result.scoreGoalCompletion;
                  const showGoalScore = !isFailed && goalScore !== null;
                  return showGoalScore ? (
                    <span
                      className={`inline-block rounded-lg border px-2 py-1 text-xs font-semibold ${getScoreColor(
                        goalScore
                      )}`}
                    >
                      {goalScore}%
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-500">N/A</span>
                  );
                },
              },
              {
                key: "toolEfficiency",
                header: "Tool Efficiency",
                render: (result) => {
                  const isFailed = result.status === "failed";
                  const toolScore = result.scoreToolEfficiency;
                  const showToolScore = !isFailed && toolScore !== null;
                  return showToolScore ? (
                    <span
                      className={`inline-block rounded-lg border px-2 py-1 text-xs font-semibold ${getScoreColor(
                        toolScore
                      )}`}
                    >
                      {toolScore}%
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-500">N/A</span>
                  );
                },
              },
              {
                key: "faithfulness",
                header: "Faithfulness",
                render: (result) => {
                  const isFailed = result.status === "failed";
                  const faithScore = result.scoreFaithfulness;
                  const showFaithScore = !isFailed && faithScore !== null;
                  return showFaithScore ? (
                    <span
                      className={`inline-block rounded-lg border px-2 py-1 text-xs font-semibold ${getScoreColor(
                        faithScore
                      )}`}
                    >
                      {faithScore}%
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-500">N/A</span>
                  );
                },
              },
              {
                key: "criticalFailure",
                header: "Critical Failure",
                render: (result) => {
                  const isFailed = result.status === "failed";
                  return isFailed ? (
                    <span className="text-xs text-neutral-500">N/A</span>
                  ) : result.criticalFailureDetected ? (
                    <span className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-100 px-2 py-1 text-xs font-semibold text-red-800 dark:border-red-700 dark:bg-red-900 dark:text-red-200">
                      <ExclamationTriangleIcon className="size-3" />
                      Yes
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-500">No</span>
                  );
                },
              },
              {
                key: "actions",
                header: "Actions",
                render: (result) => (
                  <button
                    type="button"
                    onClick={() => setSelectedResult(result)}
                    className="font-medium text-primary-600 transition-colors hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                  >
                    View Details
                  </button>
                ),
              },
            ]}
          />
        </ScrollContainer>
      )}

      {selectedResult && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
              <div className="rounded-xl border border-neutral-200 bg-white p-8 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
                <div className="text-2xl font-semibold">Loading...</div>
              </div>
            </div>
          }
        >
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
            <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
                  Evaluation Details
                </h2>
                <div className="flex items-center gap-2">
                  {onConversationOpen &&
                    canOpenEvalConversation(selectedResult) && (
                      <button
                        onClick={() =>
                          onConversationOpen(selectedResult.conversationId)
                        }
                        className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-semibold text-primary-700 transition-colors hover:bg-primary-100 dark:border-primary-700 dark:bg-primary-950 dark:text-primary-200 dark:hover:bg-primary-900"
                      >
                        View Conversation
                      </button>
                    )}
                  <button
                    onClick={() => setSelectedResult(null)}
                    className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
                    Judge
                  </div>
                  <div className="mt-1 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                    {selectedResult.judgeName}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
                    Evaluated At
                  </div>
                  <div className="mt-1 text-lg text-neutral-900 dark:text-neutral-50">
                    {formatDate(selectedResult.evaluatedAt)}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
                      Goal Completion
                    </div>
                    <div className="mt-1 text-xl font-bold text-neutral-900 dark:text-neutral-50">
                      {selectedResult.status === "failed" ||
                      selectedResult.scoreGoalCompletion === null
                        ? "N/A"
                        : `${selectedResult.scoreGoalCompletion}%`}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
                      Tool Efficiency
                    </div>
                    <div className="mt-1 text-xl font-bold text-neutral-900 dark:text-neutral-50">
                      {selectedResult.status === "failed" ||
                      selectedResult.scoreToolEfficiency === null
                        ? "N/A"
                        : `${selectedResult.scoreToolEfficiency}%`}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
                      Faithfulness
                    </div>
                    <div className="mt-1 text-xl font-bold text-neutral-900 dark:text-neutral-50">
                      {selectedResult.status === "failed" ||
                      selectedResult.scoreFaithfulness === null
                        ? "N/A"
                        : `${selectedResult.scoreFaithfulness}%`}
                    </div>
                  </div>
                </div>
                {selectedResult.status === "completed" &&
                  selectedResult.criticalFailureDetected && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
                    <div className="flex items-start gap-2">
                      <ExclamationTriangleIcon className="mt-0.5 size-5 shrink-0 text-red-600 dark:text-red-400" />
                      <div>
                        <div className="text-sm font-semibold text-red-800 dark:text-red-200">
                          Critical Failure Detected
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {selectedResult.status === "failed" && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
                    <div className="text-sm font-semibold text-red-800 dark:text-red-200">
                      Evaluation Failed
                    </div>
                    <div className="mt-1 text-xs text-red-700 dark:text-red-300">
                      {selectedResult.errorMessage || "Unknown evaluation error"}
                    </div>
                    {selectedResult.errorDetails && (
                      <div className="mt-2 text-xs text-red-700 dark:text-red-300">
                        {selectedResult.errorDetails}
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
                    Summary
                  </div>
                  <div className="mt-2 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {selectedResult.status === "failed"
                          ? "N/A"
                          : selectedResult.summary}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
                    Reasoning Trace
                  </div>
                  <div className="mt-2 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {selectedResult.status === "failed"
                          ? "N/A"
                          : selectedResult.reasoningTrace}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
                {selectedResult.costUsd !== null && (
                  <div>
                    <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
                      Cost
                    </div>
                    <div className="mt-1 text-lg text-neutral-900 dark:text-neutral-50">
                      ${selectedResult.costUsd.toFixed(6)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Suspense>
      )}
    </>
  );
};
