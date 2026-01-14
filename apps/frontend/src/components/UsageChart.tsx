import type { FC } from "react";
import { useState } from "react";

import { useTheme } from "../hooks/useTheme";
import type { DailyUsageData } from "../utils/api";
import { formatCurrency } from "../utils/currency";

type ChartMetric = "cost" | "conversations";

interface UsageChartProps {
  data: DailyUsageData[];
  title?: string;
}

export const UsageChart: FC<UsageChartProps> = ({
  data,
  title = "Daily Usage",
}) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const currency = "usd";
  const [selectedMetric, setSelectedMetric] = useState<ChartMetric>("cost");
  
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
        <h3 className="mb-6 text-xl font-semibold text-neutral-900 dark:text-neutral-50">{title}</h3>
        <p className="text-lg text-neutral-600 dark:text-neutral-300">No data available</p>
      </div>
    );
  }

  // Calculate max value based on selected metric
  const maxValue =
    selectedMetric === "cost"
      ? Math.max(...data.map((d: DailyUsageData) => d.cost), 0)
      : Math.max(...data.map((d: DailyUsageData) => d.conversationCount || 0), 0);
  
  const chartHeight = 200;
  const barWidth = Math.max(20, (100 / data.length) * 0.8);

  // Colors for dark/light mode
  const gridLineColor = isDark ? "#374151" : "#e5e7eb";
  const textColor = isDark ? "#9ca3af" : "#6b7280";
  const valueTextColor = isDark ? "#e5e7eb" : "#374151";
  const axisLabelColor = isDark ? "#d1d5db" : "#000";
  const svgBorderColor = isDark ? "#4b5563" : "#d1d3d4";

  const formatValue = (value: number): string => {
    if (selectedMetric === "cost") {
      return formatCurrency(value, currency, 10);
    }
    return new Intl.NumberFormat("en-US").format(value);
  };

  const getValue = (day: DailyUsageData): number => {
    if (selectedMetric === "cost") {
      return day.cost;
    }
    return day.conversationCount || 0;
  };

  const getDescription = (): string => {
    if (selectedMetric === "cost") {
      return "This chart shows daily spending over the selected time period. Each bar represents one day's total cost. Use this to identify spending patterns and trends.";
    }
    return "This chart shows daily conversation counts over the selected time period. Each bar represents the number of conversations started on that day. Use this to identify usage patterns and trends.";
  };

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">{title}</h3>
        <select
          value={selectedMetric}
          onChange={(e) => setSelectedMetric(e.target.value as ChartMetric)}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
        >
          <option value="cost">Cost</option>
          <option value="conversations">Conversations</option>
        </select>
      </div>
      <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-300">
        {getDescription()}
      </p>
      <div className="overflow-x-auto">
        <svg
          width={Math.max(600, data.length * 40)}
          height={chartHeight + 60}
          className="rounded-xl border"
          style={{ borderColor: svgBorderColor }}
        >
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <line
              key={ratio}
              x1={0}
              y1={chartHeight * ratio + 20}
              x2={Math.max(600, data.length * 40)}
              y2={chartHeight * ratio + 20}
              stroke={gridLineColor}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          ))}

          {/* Bars */}
          {data.map((day: DailyUsageData, index: number) => {
            const value = getValue(day);
            const barHeight =
              maxValue > 0 ? (value / maxValue) * chartHeight : 0;
            const x =
              index * (Math.max(600, data.length * 40) / data.length) + 10;
            const y = chartHeight + 20 - barHeight;

            return (
              <g key={day.date}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  fill="#0ea5e9"
                  stroke="#0284c7"
                  strokeWidth={1}
                  className="transition-colors hover:fill-primary-700"
                />
                <text
                  x={x + barWidth / 2}
                  y={chartHeight + 45}
                  textAnchor="middle"
                  className="text-xs font-medium"
                  fill={textColor}
                >
                  {new Date(day.date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </text>
                {barHeight > 20 && (
                  <text
                    x={x + barWidth / 2}
                    y={y - 5}
                    textAnchor="middle"
                    className="text-xs font-medium"
                    fill={valueTextColor}
                  >
                    {formatValue(value)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Y-axis labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <text
              key={ratio}
              x={5}
              y={chartHeight * (1 - ratio) + 25}
              className="text-xs font-bold"
              fill={axisLabelColor}
            >
              {formatValue(maxValue * ratio)}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
};
