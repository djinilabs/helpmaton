import type { FC } from "react";

import type { ContextStats } from "../utils/api";

export interface ContextLengthGaugeProps {
  /** At least estimatedSystemPromptTokens, contextLength, ratio (from backend contextStats). */
  contextStats: Pick<
    ContextStats,
    "estimatedSystemPromptTokens" | "contextLength" | "ratio"
  >;
  size?: "sm" | "md";
  label?: string;
}

const SIZE_CONFIG = {
  sm: { strokeWidth: 4, size: 32, fontSize: "0.65rem" },
  md: { strokeWidth: 6, size: 56, fontSize: "0.75rem" },
} as const;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function gaugeColor(ratio: number): string {
  if (ratio < 0.5) return "var(--gauge-green, #22c55e)";
  if (ratio < 0.85) return "var(--gauge-yellow, #eab308)";
  return "var(--gauge-red, #ef4444)";
}

export const ContextLengthGauge: FC<ContextLengthGaugeProps> = ({
  contextStats,
  size = "md",
  label,
}) => {
  const { estimatedSystemPromptTokens, contextLength, ratio } = contextStats;
  const config = SIZE_CONFIG[size];
  const r = (config.size - config.strokeWidth) / 2 - 2;
  const circumference = 2 * Math.PI * r;
  const strokeDashoffset = Math.max(0, circumference * (1 - ratio));
  const color = gaugeColor(ratio);
  const textShort = `${formatTokens(estimatedSystemPromptTokens)} / ${formatTokens(contextLength)}`;
  const ariaLabel = label
    ? `${label}: ${textShort} tokens (${Math.round(ratio * 100)}% of context)`
    : `Context usage: ${textShort} tokens (${Math.round(ratio * 100)}% of context)`;

  return (
    <div
      className="flex flex-col items-center gap-1"
      role="img"
      aria-label={ariaLabel}
    >
      <svg
        width={config.size}
        height={config.size}
        className="flex-shrink-0"
        aria-hidden
      >
        <circle
          cx={config.size / 2}
          cy={config.size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={config.strokeWidth}
          className="text-neutral-200 dark:text-neutral-600"
        />
        <circle
          cx={config.size / 2}
          cy={config.size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={config.strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          transform={`rotate(-90 ${config.size / 2} ${config.size / 2})`}
        />
        <text
          x={config.size / 2}
          y={config.size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill="currentColor"
          fontSize={config.fontSize}
          className="fill-neutral-700 dark:fill-neutral-300"
        >
          {ratio < 0.01 ? "0" : Math.round(ratio * 100)}%
        </text>
      </svg>
      {label && (
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
          {label}
        </span>
      )}
      {size !== "sm" && (
        <span
          className="text-xs text-neutral-500 dark:text-neutral-500"
          style={{ fontSize: "0.7rem" }}
        >
          {textShort}
        </span>
      )}
    </div>
  );
};
