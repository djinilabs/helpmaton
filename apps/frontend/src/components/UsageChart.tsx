import type { FC } from "react";

import type { DailyUsageData, Currency } from "../utils/api";

interface UsageChartProps {
  data: DailyUsageData[];
  currency: Currency;
  title?: string;
}

const formatCurrency = (value: number, currency: Currency): string => {
  const symbols: Record<Currency, string> = {
    usd: "$",
    eur: "€",
    gbp: "£",
  };
  return `${symbols[currency]}${value.toFixed(2)}`;
};

export const UsageChart: FC<UsageChartProps> = ({
  data,
  currency,
  title = "Daily Usage",
}) => {
  if (data.length === 0) {
    return (
      <div className="border border-neutral-200 rounded-xl p-6 bg-white shadow-soft">
        <h3 className="text-xl font-semibold text-neutral-900 mb-6">{title}</h3>
        <p className="text-lg text-neutral-600">No data available</p>
      </div>
    );
  }

  const maxCost = Math.max(...data.map((d) => d.cost), 0);
  const chartHeight = 200;
  const barWidth = Math.max(20, (100 / data.length) * 0.8);

  return (
    <div className="border border-neutral-200 rounded-xl p-6 bg-white shadow-soft">
      <h3 className="text-xl font-semibold text-neutral-900 mb-4">{title}</h3>
      <p className="text-sm text-neutral-600 mb-6">
        This chart shows daily spending over the selected time period. Each bar
        represents one day&apos;s total cost. Use this to identify spending
        patterns and trends.
      </p>
      <div className="overflow-x-auto">
        <svg
          width={Math.max(600, data.length * 40)}
          height={chartHeight + 60}
          className="border border-neutral-300 rounded-xl"
        >
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <line
              key={ratio}
              x1={0}
              y1={chartHeight * ratio + 20}
              x2={Math.max(600, data.length * 40)}
              y2={chartHeight * ratio + 20}
              stroke="#e5e7eb"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          ))}

          {/* Bars */}
          {data.map((day, index) => {
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
                  fill="#6b7280"
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
                    fill="#374151"
                  >
                    {formatCurrency(day.cost, currency)}
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
              fill="#000"
            >
              {formatCurrency(maxCost * ratio, currency)}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
};
