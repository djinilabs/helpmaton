import type { FC } from "react";
import { useState, useRef, useEffect } from "react";

import { useTheme } from "../hooks/useTheme";
import type { DailyUsageData } from "../utils/api";
import { formatCurrency } from "../utils/currency";

type ChartMetric = "cost" | "conversations" | "messagesIn" | "messagesOut" | "totalMessages";

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
  const maxValue = (() => {
    switch (selectedMetric) {
      case "cost":
        return Math.max(...data.map((d: DailyUsageData) => d.cost), 0);
      case "conversations":
        return Math.max(...data.map((d: DailyUsageData) => d.conversationCount || 0), 0);
      case "messagesIn":
        return Math.max(...data.map((d: DailyUsageData) => d.messagesIn || 0), 0);
      case "messagesOut":
        return Math.max(...data.map((d: DailyUsageData) => d.messagesOut || 0), 0);
      case "totalMessages":
        return Math.max(...data.map((d: DailyUsageData) => d.totalMessages || 0), 0);
      default:
        return 0;
    }
  })();
  
  const parentContainerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);

  // Measure parent container width on mount and resize
  useEffect(() => {
    if (!parentContainerRef.current) return;

    const updateWidth = () => {
      if (parentContainerRef.current) {
        // Get the parent container width (the card container)
        setContainerWidth(parentContainerRef.current.offsetWidth);
      }
    };

    // Initial measurement with a small delay to ensure layout is complete
    const timeoutId = setTimeout(updateWidth, 0);

    // Watch for resize
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(parentContainerRef.current);

    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, []);

  const chartHeight = 200;
  const spacePerDay = 20; // Reduced from 40 to make chart more compact
  const yAxisLabelWidth = 100; // Increased space for Y-axis labels on the left
  const rightPadding = 60; // Increased padding on the right for bar value labels
  const chartAreaLeftPadding = 5; // Padding for bars within chart area
  const minChartWidth = 600;
  const calculatedChartWidth = data.length * spacePerDay;
  // Use container width if available, accounting for padding and margins
  // Subtract padding from parent (p-6 = 24px each side = 48px total), and yAxisLabelWidth + rightPadding
  const availableWidth = containerWidth > 0 
    ? containerWidth - 48 - yAxisLabelWidth - rightPadding 
    : minChartWidth;
  const chartWidth = Math.max(
    minChartWidth,
    calculatedChartWidth,
    availableWidth
  );
  const barWidth = Math.max(12, (chartWidth / data.length) * 0.6); // Reduced from 0.8 to 0.6 for less padding
  const dateLabelHeight = 100; // Increased height to accommodate rotated date labels that extend upward

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

  // Format Y-axis labels with consistent precision
  const formatYAxisValue = (value: number): string => {
    if (selectedMetric === "cost") {
      // Cost values are in billionths, convert to currency units
      const amountInUSD = value / 1_000_000_000;
      // Determine appropriate decimal precision based on maxValue in USD
      const maxValueInUSD = maxValue / 1_000_000_000;
      let decimals = 2;
      if (maxValueInUSD < 0.01) {
        decimals = 6;
      } else if (maxValueInUSD < 1) {
        decimals = 4;
      }
      // Round to consistent precision
      const multiplier = Math.pow(10, decimals);
      const rounded = Math.round(amountInUSD * multiplier) / multiplier;
      const symbol = "$";
      return `${symbol}${rounded.toFixed(decimals).replace(/\.?0+$/, "")}`;
    }
    // For numeric values, round to whole numbers
    return new Intl.NumberFormat("en-US").format(Math.round(value));
  };

  const getValue = (day: DailyUsageData): number => {
    switch (selectedMetric) {
      case "cost":
        return day.cost;
      case "conversations":
        return day.conversationCount || 0;
      case "messagesIn":
        return day.messagesIn || 0;
      case "messagesOut":
        return day.messagesOut || 0;
      case "totalMessages":
        return day.totalMessages || 0;
      default:
        return 0;
    }
  };

  const getDescription = (): string => {
    switch (selectedMetric) {
      case "cost":
        return "This chart shows daily spending over the selected time period. Each bar represents one day's total cost. Use this to identify spending patterns and trends.";
      case "conversations":
        return "This chart shows daily conversation counts over the selected time period. Each bar represents the number of conversations started on that day. Use this to identify usage patterns and trends.";
      case "messagesIn":
        return "This chart shows daily user message counts over the selected time period. Each bar represents the number of user messages sent on that day.";
      case "messagesOut":
        return "This chart shows daily assistant message counts over the selected time period. Each bar represents the number of assistant responses generated on that day.";
      case "totalMessages":
        return "This chart shows daily total message counts over the selected time period. Each bar represents the total number of messages (user + assistant) exchanged on that day.";
      default:
        return "";
    }
  };

  return (
    <div ref={parentContainerRef} className="rounded-xl border border-neutral-200 bg-white p-6 shadow-soft dark:border-neutral-700 dark:bg-neutral-900 overflow-visible">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">{title}</h3>
        <select
          value={selectedMetric}
          onChange={(e) => setSelectedMetric(e.target.value as ChartMetric)}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
        >
          <option value="cost">Cost</option>
          <option value="conversations">Conversations</option>
          <option value="messagesIn">Messages In</option>
          <option value="messagesOut">Messages Out</option>
          <option value="totalMessages">Total Messages</option>
        </select>
      </div>
      <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-300">
        {getDescription()}
      </p>
      <div ref={scrollContainerRef} className="w-full overflow-visible">
        <svg
          width={chartWidth + yAxisLabelWidth + rightPadding}
          height={chartHeight + dateLabelHeight}
          className="rounded-xl"
        >
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <line
              key={ratio}
              x1={yAxisLabelWidth}
              y1={chartHeight * ratio + 20}
              x2={chartWidth + yAxisLabelWidth}
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
              yAxisLabelWidth + index * (chartWidth / data.length) + chartAreaLeftPadding + (chartWidth / data.length - barWidth) / 2;
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
                  y={chartHeight + 50}
                  textAnchor="middle"
                  className="text-xs font-medium"
                  fill={textColor}
                  transform={`rotate(-90 ${x + barWidth / 2} ${chartHeight + 50})`}
                  style={{ dominantBaseline: "middle" }}
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
              x={yAxisLabelWidth - 20}
              y={chartHeight * (1 - ratio) + 25}
              textAnchor="end"
              className="text-xs font-bold"
              fill={axisLabelColor}
            >
              {formatYAxisValue(maxValue * ratio)}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
};
