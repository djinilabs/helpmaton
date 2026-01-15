import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import type { FC } from "react";
import { useState, useMemo, Suspense } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useAgentEvalResults, useEvalJudges } from "../hooks/useEvalJudges";
import type { EvalResult } from "../utils/api";

interface EvalResultsListProps {
  workspaceId: string;
  agentId: string;
  judgeId?: string;
  startDate?: string;
  endDate?: string;
}

export const EvalResultsList: FC<EvalResultsListProps> = ({
  workspaceId,
  agentId,
  judgeId,
  startDate,
  endDate,
}) => {
  const [selectedResult, setSelectedResult] = useState<EvalResult | null>(
    null
  );
  const [sortBy, setSortBy] = useState<"date" | "judge">("date");
  const [filterJudgeId, setFilterJudgeId] = useState<string | undefined>(
    judgeId
  );

  const { data: evalResultsData, isLoading, error, refetch, isRefetching } =
    useAgentEvalResults(workspaceId, agentId, {
      startDate,
      endDate,
      judgeId: filterJudgeId,
    });

  const { data: judges } = useEvalJudges(workspaceId, agentId);

  const results = useMemo(() => {
    if (!evalResultsData || !evalResultsData.results) return [];
    const sorted = [...evalResultsData.results];
    if (sortBy === "date") {
      sorted.sort(
        (a, b) =>
          new Date(b.evaluatedAt).getTime() -
          new Date(a.evaluatedAt).getTime()
      );
    } else {
      sorted.sort((a, b) => a.judgeName.localeCompare(b.judgeName));
    }
    return sorted;
  }, [evalResultsData, sortBy]);

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

  if (isLoading && !evalResultsData) {
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

      {evalResultsData && (
        <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
              Total Evaluations
            </div>
            <div className="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
              {evalResultsData.totalEvaluations}
            </div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
              Avg Goal Completion
            </div>
            <div className="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
              {evalResultsData.averageScores.goalCompletion.toFixed(1)}
            </div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
              Avg Tool Efficiency
            </div>
            <div className="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
              {evalResultsData.averageScores.toolEfficiency.toFixed(1)}
            </div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
              Critical Failures
            </div>
            <div className="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">
              {evalResultsData.criticalFailures}
            </div>
          </div>
        </div>
      )}

      {results.length === 0 ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          No evaluation results yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-neutral-300 dark:border-neutral-700">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
                  Judge
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
                  Goal Completion
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
                  Tool Efficiency
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
                  Faithfulness
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
                  Critical Failure
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr
                  key={`${result.conversationId}-${result.judgeId}-${result.evaluatedAt}`}
                  className="border-b border-neutral-200 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
                >
                  <td className="px-4 py-3 text-sm text-neutral-600 dark:text-neutral-400">
                    {formatDate(result.evaluatedAt)}
                  </td>
                  <td className="px-4 py-3 text-sm text-neutral-900 dark:text-neutral-50">
                    {result.judgeName}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-lg border px-2 py-1 text-xs font-semibold ${getScoreColor(
                        result.scoreGoalCompletion
                      )}`}
                    >
                      {result.scoreGoalCompletion}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-lg border px-2 py-1 text-xs font-semibold ${getScoreColor(
                        result.scoreToolEfficiency
                      )}`}
                    >
                      {result.scoreToolEfficiency}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-lg border px-2 py-1 text-xs font-semibold ${getScoreColor(
                        result.scoreFaithfulness
                      )}`}
                    >
                      {result.scoreFaithfulness}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {result.criticalFailureDetected ? (
                      <span className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-100 px-2 py-1 text-xs font-semibold text-red-800 dark:border-red-700 dark:bg-red-900 dark:text-red-200">
                        <ExclamationTriangleIcon className="size-3" />
                        Yes
                      </span>
                    ) : (
                      <span className="text-xs text-neutral-500">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelectedResult(result)}
                      className="font-medium text-primary-600 transition-colors hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
                <button
                  onClick={() => setSelectedResult(null)}
                  className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
                >
                  Close
                </button>
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
                      {selectedResult.scoreGoalCompletion}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
                      Tool Efficiency
                    </div>
                    <div className="mt-1 text-xl font-bold text-neutral-900 dark:text-neutral-50">
                      {selectedResult.scoreToolEfficiency}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
                      Faithfulness
                    </div>
                    <div className="mt-1 text-xl font-bold text-neutral-900 dark:text-neutral-50">
                      {selectedResult.scoreFaithfulness}
                    </div>
                  </div>
                </div>
                {selectedResult.criticalFailureDetected && (
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
                <div>
                  <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
                    Summary
                  </div>
                  <div className="mt-2 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {selectedResult.summary}
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
                        {selectedResult.reasoningTrace}
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
