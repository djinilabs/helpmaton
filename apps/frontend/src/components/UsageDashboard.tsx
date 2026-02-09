import type { FC } from "react";

import type { UsageStats as UsageStatsType, DailyUsageData } from "../utils/api";
import {
  type DateRangePreset,
  getDateRangeLabel,
  type DateRange,
} from "../utils/dateRanges";

import { UsageChart } from "./UsageChart";
import { UsageStats } from "./UsageStats";

interface UsageDashboardProps {
  stats: UsageStatsType;
  dailyData?: DailyUsageData[];
  title?: string;
  dateRange?: DateRange;
  dateRangePreset?: DateRangePreset;
  onDateRangeChange?: (preset: DateRangePreset) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  showBorder?: boolean;
}

export const UsageDashboard: FC<UsageDashboardProps> = ({
  stats,
  dailyData,
  title = "Usage Dashboard",
  dateRange,
  dateRangePreset = "last-30-days",
  onDateRangeChange,
  onRefresh,
  isRefreshing = false,
  showBorder = true,
}) => {
  const dateRangePresets: DateRangePreset[] = [
    "last-30-days",
    "last-7-days",
    "this-week",
    "current-month",
    "last-month",
  ];

  return (
    <div className={`${showBorder ? "rounded-2xl border border-neutral-200 bg-white p-8 shadow-medium dark:border-neutral-700 dark:bg-surface-50" : ""} mb-8`}>
      <div className={`mb-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center ${showBorder ? 'justify-between' : 'justify-end'}`}>
        {showBorder && <h2 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">{title}</h2>}
        <div className="flex flex-wrap items-center gap-3">
          {onDateRangeChange && (
            <select
              value={dateRangePreset}
              onChange={(e) => onDateRangeChange(e.target.value as DateRangePreset)}
              className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
            >
              {dateRangePresets.map((preset) => (
                <option key={preset} value={preset}>
                  {getDateRangeLabel(preset)}
                </option>
              ))}
            </select>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          )}
        </div>
      </div>

      {showBorder && (
        <p className="mb-6 text-base leading-relaxed text-neutral-600 dark:text-neutral-300">
          Track token usage, costs, conversations, and tool usage over time. Statistics show input tokens (what you send), output tokens (what the AI generates), total tokens, costs, conversation counts, and tool call statistics. Use the date range selector to view different time periods.
        </p>
      )}
      {dateRange && (
        <div className="mb-6 flex items-center gap-2 text-sm font-medium text-neutral-600 dark:text-neutral-300">
          <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span>{dateRange.startDate} to {dateRange.endDate}</span>
        </div>
      )}

      <div className="space-y-6">
        <UsageStats stats={stats} />
        {dailyData && dailyData.length > 0 && (
          <UsageChart
            data={dailyData}
            title="Daily Usage"
          />
        )}
      </div>
    </div>
  );
};

