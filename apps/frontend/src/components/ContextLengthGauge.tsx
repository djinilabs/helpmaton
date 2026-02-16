import type { FC } from "react";

import type { ContextStats } from "../utils/api";

export interface ContextLengthGaugeProps {
  /** Backend contextStats; segments used for stacked gauge and legend. */
  contextStats: Pick<
    ContextStats,
    | "estimatedSystemPromptTokens"
    | "estimatedInstructionsTokens"
    | "estimatedSkillsTokens"
    | "estimatedKnowledgeTokens"
    | "contextLength"
    | "ratio"
  >;
  size?: "sm" | "md";
  /** Label shown above or near gauge; default for size md. */
  label?: string;
}

const SIZE_CONFIG = {
  sm: { strokeWidth: 4, size: 32, fontSize: "0.65rem" },
  md: { strokeWidth: 6, size: 56, fontSize: "0.75rem" },
} as const;

/** Segment colors: instructions, skills, knowledge (est.) */
const SEGMENT_COLORS = {
  instructions: "#3b82f6",
  skills: "#8b5cf6",
  knowledge: "#f59e0b",
} as const;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const DEFAULT_LABEL =
  "Context usage (instructions + skills + knowledge, estimated)";

interface Segment {
  id: keyof typeof SEGMENT_COLORS;
  label: string;
  tokens: number;
  ratio: number;
}

/**
 * Build instructions / skills / knowledge segments. Each segment's arc ratio is proportional to
 * (tokens / totalTokens) * totalRatio, so the colored arc fills totalRatio of the circle (usage vs
 * context window) and the rest of the circle shows available space. Used for the stacked arc gauge and legend.
 */
function buildSegments(
  contextStats: ContextLengthGaugeProps["contextStats"],
  contextLength: number,
  totalRatio: number,
): Segment[] {
  const instructions =
    contextStats.estimatedInstructionsTokens ??
    Math.max(
      0,
      (contextStats.estimatedSystemPromptTokens ?? 0) -
        (contextStats.estimatedSkillsTokens ?? 0),
    );
  const skills = contextStats.estimatedSkillsTokens ?? 0;
  const knowledge = contextStats.estimatedKnowledgeTokens ?? 0;
  const totalTokens = instructions + skills + knowledge;
  if (contextLength <= 0 || totalTokens <= 0) {
    return [
      {
        id: "instructions",
        label: "Instructions",
        tokens: instructions,
        ratio: 0,
      },
      { id: "skills", label: "Skills", tokens: skills, ratio: 0 },
      {
        id: "knowledge",
        label: "Knowledge (est.)",
        tokens: knowledge,
        ratio: 0,
      },
    ];
  }
  // Scale segment ratios so they sum to totalRatio (usage / context); rest of circle = available space
  const r1 = totalRatio * (instructions / totalTokens);
  const r2 = totalRatio * (skills / totalTokens);
  const r3 = totalRatio * (knowledge / totalTokens);
  return [
    { id: "instructions", label: "Instructions", tokens: instructions, ratio: r1 },
    { id: "skills", label: "Skills", tokens: skills, ratio: r2 },
    {
      id: "knowledge",
      label: "Knowledge (est.)",
      tokens: knowledge,
      ratio: r3,
    },
  ];
}

export const ContextLengthGauge: FC<ContextLengthGaugeProps> = ({
  contextStats,
  size = "md",
  label,
}) => {
  const { contextLength, ratio } = contextStats;
  const totalRatio = Math.min(1, Math.max(0, ratio));
  const segments = buildSegments(contextStats, contextLength, totalRatio);
  const totalEstimatedTokens =
    (contextStats.estimatedSystemPromptTokens ?? 0) +
    (contextStats.estimatedKnowledgeTokens ?? 0);
  const displayLabel = label ?? (size === "md" ? DEFAULT_LABEL : undefined);
  const config = SIZE_CONFIG[size];
  const r = (config.size - config.strokeWidth) / 2 - 2;
  const circumference = 2 * Math.PI * r;
  const textShort = `${formatTokens(totalEstimatedTokens)} / ${formatTokens(contextLength)}`;
  const segmentSummary = segments
    .map((s) => `${s.label} ${formatTokens(s.tokens)}`)
    .join(", ");
  const usedPct = Math.round(ratio * 100);
  const availablePct = 100 - usedPct;
  const remainingNote =
    " Remaining context is used by the conversation (user, assistant, tool calls and results).";
  const ariaLabel = displayLabel
    ? `${displayLabel}: ${textShort} (${usedPct}% used${availablePct > 0 ? `, ${availablePct}% available` : ""}). Breakdown: ${segmentSummary}.${remainingNote}`
    : `Context usage (estimated): ${textShort} (${usedPct}% used${availablePct > 0 ? `, ${availablePct}% available` : ""}). Breakdown: ${segmentSummary}.${remainingNote}`;

  const cumulativeRatios = segments.reduce<number[]>(
    (acc, seg) => [...acc, acc.at(-1)! + seg.ratio],
    [0],
  );
  const segmentArcs = segments
    .map((seg, index) => ({ seg, index }))
    .filter(({ seg }) => seg.ratio > 0)
    .map(({ seg, index }) => {
      const rotationDeg = -90 + 360 * cumulativeRatios[index]!;
      const dashLength = circumference * Math.min(1, Math.max(0, seg.ratio));
      return (
        <circle
          key={seg.id}
          cx={config.size / 2}
          cy={config.size / 2}
          r={r}
          fill="none"
          stroke={SEGMENT_COLORS[seg.id]}
          strokeWidth={config.strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dashLength} ${circumference}`}
          strokeDashoffset={0}
          transform={`rotate(${rotationDeg} ${config.size / 2} ${config.size / 2})`}
        />
      );
    });

  return (
    <div
      className="flex flex-col items-center gap-2"
      role="img"
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {displayLabel && (
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
          {displayLabel}
        </span>
      )}
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
        {segmentArcs}
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
      {size === "sm" ? (
        <div className="flex items-center justify-center gap-1" aria-hidden>
          {(Object.keys(SEGMENT_COLORS) as (keyof typeof SEGMENT_COLORS)[]).map(
            (id) => (
              <span
                key={id}
                className="size-1.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: SEGMENT_COLORS[id] }}
              />
            )
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1 text-left">
          {segments.map((seg) => (
            <div
              key={seg.id}
              className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400"
            >
              <span
                className="size-2.5 flex-shrink-0 rounded-sm"
                style={{ backgroundColor: SEGMENT_COLORS[seg.id] }}
                aria-hidden
              />
              <span>
                {seg.label}: {formatTokens(seg.tokens)}
              </span>
            </div>
          ))}
        </div>
      )}
      {size !== "sm" && (
        <div className="flex flex-col items-center gap-0.5 text-center">
          <span
            className="text-xs text-neutral-500 dark:text-neutral-500"
            style={{ fontSize: "0.7rem" }}
          >
            {textShort}
          </span>
          <span className="max-w-[12rem] text-[0.65rem] text-neutral-400 dark:text-neutral-500">
            Remaining context is used by the conversation (user, assistant,
            tool calls and results, etc.).
          </span>
        </div>
      )}
    </div>
  );
};
