import type { FC } from "react";

import { useTheme } from "../hooks/useTheme";
import type { DailyUsageData } from "../utils/api";
import { formatCurrency } from "../utils/currency";

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
  
  if (data.length === 0) {
    return (
      <div className="border border-neutral-200 rounded-xl p-6 bg-white shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
        <h3 className="text-xl font-semibold text-neutral-900 mb-6 dark:text-neutral-50">{title}</h3>
        <p className="text-lg text-neutral-600 dark:text-neutral-300">No data available</p>
      </div>
    );
  }

  const maxCost = Math.max(...data.map((d: DailyUsageData) => d.cost), 0);
  const chartHeight = 200;
  const barWidth = Math.max(20, (100 / data.length) * 0.8);

  // Colors for dark/light mode
  const gridLineColor = isDark ? "#374151" : "#e5e7eb";
  const textColor = isDark ? "#9ca3af" : "#6b7280";
  const valueTextColor = isDark ? "#e5e7eb" : "#374151";
  const axisLabelColor = isDark ? "#d1d5db" : "#000";
  const svgBorderColor = isDark ? "#4b5563" : "#d1d3d4";

  return (
    <div className="border border-neutral-200 rounded-xl p-6 bg-white shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
      <h3 className="text-xl font-semibold text-neutral-900 mb-4 dark:text-neutral-50">{title}</h3>
      <p className="text-sm text-neutral-600 mb-6 dark:text-neutral-300">
        This chart shows daily spending over the selected time period. Each bar
        represents one day&apos;s total cost. Use this to identify spending
        patterns and trends.
      </p>
      <div className="overflow-x-auto">
        <svg
          width={Math.max(600, data.length * 40)}
          height={chartHeight + 60}
          className="border rounded-xl"
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
            const barHeight =
              maxCost > 0 ? (day.cost / maxCost) * chartHeight : 0;
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
                  className="hover:fill-primary-700 transition-colors"
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
                    {formatCurrency(day.cost, currency, 2)}
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
              {formatCurrency(maxCost * ratio, currency, 2)}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
};
