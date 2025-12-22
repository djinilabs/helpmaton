import type { FC } from "react";

import {
  type DateRangePreset,
  getDateRangeLabel,
  type DateRange,
} from "../utils/dateRanges";

import { UsageChart } from "./UsageChart";
import { UsageStats } from "./UsageStats";

interface UsageDashboardProps {
  stats: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
    byModel: Array<{
      model: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cost: number;
    }>;
    byProvider: Array<{
      provider: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cost: number;
    }>;
    byByok: {
      byok: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        cost: number;
      };
      platform: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        cost: number;
      };
    };
  };
  dailyData?: Array<{
    date: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
  }>;
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
    <div className={`${showBorder ? "bg-white rounded-2xl shadow-medium p-8 border border-neutral-200 dark:bg-neutral-900 dark:border-neutral-700" : ""} mb-8`}>
      <div className={`flex flex-col sm:flex-row items-start sm:items-center mb-6 gap-4 ${showBorder ? 'justify-between' : 'justify-end'}`}>
        {showBorder && <h2 className="text-3xl font-bold text-neutral-900 tracking-tight dark:text-neutral-50">{title}</h2>}
        <div className="flex flex-wrap gap-3 items-center">
          {onDateRangeChange && (
            <select
              value={dateRangePreset}
              onChange={(e) => onDateRangeChange(e.target.value as DateRangePreset)}
              className="border border-neutral-300 rounded-xl px-4 py-2.5 text-sm font-semibold bg-white text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-primary-400 dark:focus:border-primary-500"
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
              className="border border-neutral-300 rounded-xl px-4 py-2.5 text-sm font-semibold bg-white text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          )}
        </div>
      </div>

      {showBorder && (
        <p className="text-base text-neutral-600 mb-6 leading-relaxed dark:text-neutral-300">
          Track token usage and costs over time. Statistics show input tokens (what you send), output tokens (what the AI generates), total tokens, and the associated cost. Use the date range selector to view different time periods.
        </p>
      )}
      {dateRange && (
        <div className="mb-6 flex items-center gap-2 text-sm font-medium text-neutral-600 dark:text-neutral-300">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            title="Daily Spending"
          />
        )}
      </div>
    </div>
  );
};

