import { useState, useRef, useEffect, useMemo } from "react";
import type { FC } from "react";

import { useAgentEvalResults, useEvalJudges } from "../hooks/useEvalJudges";
import { useTheme } from "../hooks/useTheme";
import type { EvalResult, EvalResultsResponse } from "../utils/api";
import { type DateRangePreset, getDateRange } from "../utils/dateRanges";

interface EvalResultsChartProps {
  workspaceId: string;
  agentId: string;
}

type ScoreType = "goalCompletion" | "toolEfficiency" | "faithfulness";

interface ChartDataPoint {
  date: string;
  goalCompletion: number | null;
  toolEfficiency: number | null;
  faithfulness: number | null;
}

export const EvalResultsChart: FC<EvalResultsChartProps> = ({
  workspaceId,
  agentId,
}) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [selectedScoreType, setSelectedScoreType] = useState<ScoreType | "all">(
    "all"
  );
  const [dateRangePreset, setDateRangePreset] =
    useState<DateRangePreset>("last-30-days");
  const [selectedJudgeId, setSelectedJudgeId] = useState<string | undefined>(
    undefined
  );
  const parentContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [hoveredPoint, setHoveredPoint] = useState<{
    x: number;
    y: number;
    data: ChartDataPoint;
  } | null>(null);

  const dateRange = getDateRange(dateRangePreset);
  // Convert YYYY-MM-DD to ISO strings, ensuring we preserve the full day range
  // startDate should be at 00:00:00 local time, endDate should be at 23:59:59.999 local time
  const startDateISO = (() => {
    const [year, month, day] = dateRange.startDate.split("-").map(Number);
    const date = new Date(year, month - 1, day, 0, 0, 0, 0);
    return date.toISOString();
  })();
  const endDateISO = (() => {
    const [year, month, day] = dateRange.endDate.split("-").map(Number);
    const date = new Date(year, month - 1, day, 23, 59, 59, 999);
    return date.toISOString();
  })();
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useAgentEvalResults(
    workspaceId,
    agentId,
    {
      startDate: startDateISO,
      endDate: endDateISO,
      judgeId: selectedJudgeId,
    },
    50
  );

  const { data: judges } = useEvalJudges(workspaceId, agentId);

  // Fetch all pages for the chart (needed for complete time series)
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Measure parent container width on mount and resize
  useEffect(() => {
    if (!parentContainerRef.current) return;

    const updateWidth = () => {
      if (parentContainerRef.current) {
        setContainerWidth(parentContainerRef.current.offsetWidth);
      }
    };

    const timeoutId = setTimeout(updateWidth, 0);
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(parentContainerRef.current);

    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, []);

  // Process data into chart format - aggregate across all pages
  const chartData = useMemo(() => {
    if (!data) {
      return [];
    }

    type CompletedEvalResult = EvalResult & {
      scoreGoalCompletion: number;
      scoreToolEfficiency: number;
      scoreFaithfulness: number;
    };

    const hasCompletedScores = (
      result: EvalResult
    ): result is CompletedEvalResult =>
      result.status === "completed" &&
      result.scoreGoalCompletion !== null &&
      result.scoreToolEfficiency !== null &&
      result.scoreFaithfulness !== null;

    // Flatten all results from all pages
    // useInfiniteQuery returns data with pages property
    const allResults = (
      (data as unknown as { pages: EvalResultsResponse[] }).pages
    )
      .flatMap((page) => page.results)
      .filter(hasCompletedScores);

    if (allResults.length === 0) {
      return [];
    }

    // Group results by date
    const dateMap = new Map<string, CompletedEvalResult[]>();
    for (const result of allResults) {
      const date = new Date(result.evaluatedAt).toISOString().split("T")[0];
      if (!dateMap.has(date)) {
        dateMap.set(date, []);
      }
      dateMap.get(date)!.push(result);
    }

    // Calculate averages per date
    const dataPoints: ChartDataPoint[] = [];
    for (const [date, results] of dateMap.entries()) {
      const avgGoalCompletion =
        results.reduce((sum, r) => sum + r.scoreGoalCompletion, 0) /
        results.length;
      const avgToolEfficiency =
        results.reduce((sum, r) => sum + r.scoreToolEfficiency, 0) /
        results.length;
      const avgFaithfulness =
        results.reduce((sum, r) => sum + r.scoreFaithfulness, 0) /
        results.length;

      dataPoints.push({
        date,
        goalCompletion: avgGoalCompletion,
        toolEfficiency: avgToolEfficiency,
        faithfulness: avgFaithfulness,
      });
    }

    // Sort by date
    dataPoints.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    return dataPoints;
  }, [data]);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
        <h3 className="mb-6 text-xl font-semibold text-neutral-900 dark:text-neutral-50">
          Evaluation Progress
        </h3>
        <p className="text-lg text-neutral-600 dark:text-neutral-300">
          Loading chart data...
        </p>
      </div>
    );
  }

  // Calculate chart dimensions (use defaults if no data)
  const chartHeight = 300;
  const yAxisLabelWidth = 60;
  const rightPadding = 20;
  const topPadding = 20;
  const bottomPadding = 60;
  const minChartWidth = 600;
  const spacePerDay = chartData.length > 0
    ? Math.max(30, (containerWidth - yAxisLabelWidth - rightPadding) / chartData.length)
    : 30;
  const calculatedChartWidth = chartData.length * spacePerDay;
  const availableWidth =
    containerWidth > 0
      ? containerWidth - 48 - yAxisLabelWidth - rightPadding
      : minChartWidth;
  const chartWidth = Math.max(minChartWidth, calculatedChartWidth, availableWidth);

  // Calculate max value for Y-axis
  const maxValue = 100; // Scores are 0-100

  // Colors for lines
  const goalCompletionColor = "#14b8a6"; // primary-500
  const toolEfficiencyColor = "#3b82f6"; // blue-500
  const faithfulnessColor = "#a855f7"; // accent-500

  // Grid and text colors
  const gridLineColor = isDark ? "#374151" : "#e5e7eb";
  const textColor = isDark ? "#9ca3af" : "#6b7280";
  const axisLabelColor = isDark ? "#d1d5db" : "#000";

  // Calculate points for each line
  const getPoints = (scoreType: ScoreType): string => {
    return chartData
      .map((point, index) => {
        const x =
          yAxisLabelWidth +
          (index * chartWidth) / chartData.length +
          (chartWidth / chartData.length) / 2;
        const value = point[scoreType];
        if (value === null) return null;
        const y =
          topPadding +
          chartHeight -
          (value / maxValue) * chartHeight;
        return `${x},${y}`;
      })
      .filter((p): p is string => p !== null)
      .join(" ");
  };

  const goalCompletionPoints = getPoints("goalCompletion");
  const toolEfficiencyPoints = getPoints("toolEfficiency");
  const faithfulnessPoints = getPoints("faithfulness");

  return (
    <div
      ref={parentContainerRef}
      className="overflow-visible rounded-xl border border-neutral-200 bg-white p-6 shadow-soft dark:border-neutral-700 dark:bg-neutral-900"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
          Evaluation Progress
        </h3>
        <div className="flex flex-wrap gap-2">
          {judges && judges.length > 0 && (
            <select
              value={selectedJudgeId || ""}
              onChange={(e) => setSelectedJudgeId(e.target.value || undefined)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
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
            value={dateRangePreset}
            onChange={(e) =>
              setDateRangePreset(e.target.value as DateRangePreset)
            }
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
          >
            <option value="last-7-days">Last 7 Days</option>
            <option value="last-30-days">Last 30 Days</option>
            <option value="this-week">This Week</option>
            <option value="current-month">Current Month</option>
            <option value="last-month">Last Month</option>
          </select>
          <select
            value={selectedScoreType}
            onChange={(e) =>
              setSelectedScoreType(
                e.target.value as ScoreType | "all"
              )
            }
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
          >
            <option value="all">All Scores</option>
            <option value="goalCompletion">Goal Completion</option>
            <option value="toolEfficiency">Tool Efficiency</option>
            <option value="faithfulness">Faithfulness</option>
          </select>
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-lg text-neutral-600 dark:text-neutral-300">
            No evaluation data available for the selected time period.
          </p>
        </div>
      ) : (
        <div className="relative">
          <svg
            width={chartWidth + yAxisLabelWidth + rightPadding}
            height={chartHeight + topPadding + bottomPadding}
            className="rounded-xl"
          >
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <line
              key={ratio}
              x1={yAxisLabelWidth}
              y1={topPadding + chartHeight * ratio}
              x2={chartWidth + yAxisLabelWidth}
              y2={topPadding + chartHeight * ratio}
              stroke={gridLineColor}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          ))}

          {/* Lines */}
          {(selectedScoreType === "all" ||
            selectedScoreType === "goalCompletion") &&
            goalCompletionPoints && (
              <polyline
                points={goalCompletionPoints}
                fill="none"
                stroke={goalCompletionColor}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          {(selectedScoreType === "all" ||
            selectedScoreType === "toolEfficiency") &&
            toolEfficiencyPoints && (
              <polyline
                points={toolEfficiencyPoints}
                fill="none"
                stroke={toolEfficiencyColor}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          {(selectedScoreType === "all" ||
            selectedScoreType === "faithfulness") &&
            faithfulnessPoints && (
              <polyline
                points={faithfulnessPoints}
                fill="none"
                stroke={faithfulnessColor}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

          {/* Data points */}
          {chartData.map((point, index) => {
            const x =
              yAxisLabelWidth +
              (index * chartWidth) / chartData.length +
              (chartWidth / chartData.length) / 2;

            return (
              <g key={point.date}>
                {(selectedScoreType === "all" ||
                  selectedScoreType === "goalCompletion") &&
                  point.goalCompletion !== null && (
                    <circle
                      cx={x}
                      cy={
                        topPadding +
                        chartHeight -
                        (point.goalCompletion / maxValue) * chartHeight
                      }
                      r={4}
                      fill={goalCompletionColor}
                      className="hover:r-6 cursor-pointer"
                      onMouseEnter={() =>
                        setHoveredPoint({
                          x,
                          y:
                            topPadding +
                            chartHeight -
                            (point.goalCompletion! / maxValue) * chartHeight,
                          data: point,
                        })
                      }
                      onMouseLeave={() => setHoveredPoint(null)}
                    />
                  )}
                {(selectedScoreType === "all" ||
                  selectedScoreType === "toolEfficiency") &&
                  point.toolEfficiency !== null && (
                    <circle
                      cx={x}
                      cy={
                        topPadding +
                        chartHeight -
                        (point.toolEfficiency / maxValue) * chartHeight
                      }
                      r={4}
                      fill={toolEfficiencyColor}
                      className="hover:r-6 cursor-pointer"
                      onMouseEnter={() =>
                        setHoveredPoint({
                          x,
                          y:
                            topPadding +
                            chartHeight -
                            (point.toolEfficiency! / maxValue) * chartHeight,
                          data: point,
                        })
                      }
                      onMouseLeave={() => setHoveredPoint(null)}
                    />
                  )}
                {(selectedScoreType === "all" ||
                  selectedScoreType === "faithfulness") &&
                  point.faithfulness !== null && (
                    <circle
                      cx={x}
                      cy={
                        topPadding +
                        chartHeight -
                        (point.faithfulness / maxValue) * chartHeight
                      }
                      r={4}
                      fill={faithfulnessColor}
                      className="hover:r-6 cursor-pointer"
                      onMouseEnter={() =>
                        setHoveredPoint({
                          x,
                          y:
                            topPadding +
                            chartHeight -
                            (point.faithfulness! / maxValue) * chartHeight,
                          data: point,
                        })
                      }
                      onMouseLeave={() => setHoveredPoint(null)}
                    />
                  )}
                {/* Date labels */}
                <text
                  x={x}
                  y={chartHeight + topPadding + 20}
                  textAnchor="middle"
                  className="text-xs font-medium"
                  fill={textColor}
                  transform={`rotate(-45 ${x} ${chartHeight + topPadding + 20})`}
                >
                  {new Date(point.date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </text>
              </g>
            );
          })}

          {/* Y-axis labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <text
              key={ratio}
              x={yAxisLabelWidth - 10}
              y={topPadding + chartHeight * (1 - ratio) + 4}
              textAnchor="end"
              className="text-xs font-bold"
              fill={axisLabelColor}
            >
              {Math.round(maxValue * ratio)}
            </text>
          ))}

          {/* Tooltip */}
          {hoveredPoint && (
            <g>
              <rect
                x={hoveredPoint.x - 60}
                y={hoveredPoint.y - 50}
                width={120}
                height={40}
                fill="rgba(0, 0, 0, 0.8)"
                rx={4}
              />
              <text
                x={hoveredPoint.x}
                y={hoveredPoint.y - 30}
                textAnchor="middle"
                className="text-xs font-semibold"
                fill="white"
              >
                {new Date(hoveredPoint.data.date).toLocaleDateString()}
              </text>
              <text
                x={hoveredPoint.x}
                y={hoveredPoint.y - 15}
                textAnchor="middle"
                className="text-xs"
                fill="white"
              >
                {selectedScoreType === "all"
                  ? `GC: ${hoveredPoint.data.goalCompletion?.toFixed(1) || "N/A"}%, TE: ${hoveredPoint.data.toolEfficiency?.toFixed(1) || "N/A"}%, F: ${hoveredPoint.data.faithfulness?.toFixed(1) || "N/A"}%`
                  : `${hoveredPoint.data[selectedScoreType]?.toFixed(1) || "N/A"}%`}
              </text>
            </g>
          )}
        </svg>
        </div>
      )}

      {/* Legend - only show when there's data */}
      {chartData.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
          {(selectedScoreType === "all" ||
            selectedScoreType === "goalCompletion") && (
            <div className="flex items-center gap-2">
              <div
                className="size-3 rounded-full"
                style={{ backgroundColor: goalCompletionColor }}
              />
              <span className="text-sm text-neutral-600 dark:text-neutral-400">
                Goal Completion
              </span>
            </div>
          )}
          {(selectedScoreType === "all" ||
            selectedScoreType === "toolEfficiency") && (
            <div className="flex items-center gap-2">
              <div
                className="size-3 rounded-full"
                style={{ backgroundColor: toolEfficiencyColor }}
              />
              <span className="text-sm text-neutral-600 dark:text-neutral-400">
                Tool Efficiency
              </span>
            </div>
          )}
          {(selectedScoreType === "all" ||
            selectedScoreType === "faithfulness") && (
            <div className="flex items-center gap-2">
              <div
                className="size-3 rounded-full"
                style={{ backgroundColor: faithfulnessColor }}
              />
              <span className="text-sm text-neutral-600 dark:text-neutral-400">
                Faithfulness
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
