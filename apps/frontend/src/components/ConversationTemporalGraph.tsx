import { CheckCircleIcon, ClockIcon } from "@heroicons/react/24/outline";
import { useMemo, useState, useRef } from "react";
import type { FC } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { formatCurrency } from "../utils/currency";
import { getMessageCost } from "../utils/messageCost";

interface MessageWithTimestamps {
  role: "user" | "assistant" | "system" | "tool";
  generationStartedAt?: string;
  generationEndedAt?: string;
  content?: unknown;
  [key: string]: unknown;
}

interface ConversationTemporalGraphProps {
  messages: unknown[];
  conversationStartedAt?: string;
  conversationLastMessageAt?: string;
}

// SVG gradient definitions and colors for message bars
// Colors match the conversation detail modal styling but with better visibility
const MESSAGE_COLORS: Record<
  string,
  { base: string; light: string; dark: string }
> = {
  user: {
    base: "#14b8a6", // primary-500 (teal) - matches bg-gradient-primary
    light: "#2dd4bf", // primary-400
    dark: "#0d9488", // primary-600
  },
  assistant: {
    base: "#d6d3d1", // neutral-300 - darker for visibility, still matches neutral theme
    light: "#e7e5e4", // neutral-200
    dark: "#a8a29e", // neutral-400
  },
  "assistant-tool": {
    base: "#3b82f6", // blue-500 - for assistant messages with tool calls
    light: "#60a5fa", // blue-400
    dark: "#2563eb", // blue-600
  },
  system: {
    base: "#a8a29e", // neutral-400 - darker for visibility
    light: "#d6d3d1", // neutral-300
    dark: "#78716c", // neutral-500
  },
  tool: {
    base: "#c084fc", // accent-400 (purple) - distinct color for tools
    light: "#d8b4fe", // accent-300
    dark: "#a855f7", // accent-500
  },
};

const MESSAGE_LABELS: Record<string, string> = {
  user: "User",
  assistant: "Assistant",
  system: "System",
  tool: "Tool",
};

export const ConversationTemporalGraph: FC<ConversationTemporalGraphProps> = ({
  messages,
  conversationStartedAt,
  conversationLastMessageAt,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredMessage, setHoveredMessage] = useState<{
    message: MessageWithTimestamps;
    index: number;
    barX: number;
    barY: number;
    barWidth: number;
    barHeight: number;
  } | null>(null);
  const graphData = useMemo(() => {
    if (!Array.isArray(messages) || messages.length === 0) {
      return null;
    }

    // Filter and extract messages with timestamps
    const messagesWithTimestamps: Array<{
      message: MessageWithTimestamps;
      index: number;
      startTime: number;
      endTime: number;
      duration: number;
    }> = [];

    // Determine the conversation start time
    let conversationStart: number | undefined;
    if (conversationStartedAt) {
      conversationStart = new Date(conversationStartedAt).getTime();
    }

    // Process each message
    let previousEndTime: number | undefined;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i] as MessageWithTimestamps;
      if (!msg || typeof msg !== "object" || !("role" in msg)) {
        continue;
      }

      let startTime: number | undefined;
      let endTime: number | undefined;

      // Try to get timestamps from message
      if (msg.generationStartedAt) {
        startTime = new Date(msg.generationStartedAt).getTime();
      }
      if (msg.generationEndedAt) {
        endTime = new Date(msg.generationEndedAt).getTime();
      }

      // If no start time, use previous message's end time
      if (!startTime && previousEndTime !== undefined) {
        startTime = previousEndTime;
      }

      // If we still don't have timestamps, estimate based on conversation times
      if (!startTime || !endTime) {
        if (conversationStart) {
          // Estimate: distribute messages evenly across conversation duration
          // Use conversationLastMessageAt or fallback to a reasonable duration
          const conversationEnd = conversationLastMessageAt
            ? new Date(conversationLastMessageAt).getTime()
            : conversationStart + 60000; // Default 1 minute if no end time
          const conversationDuration = conversationEnd - conversationStart;
          const estimatedStart =
            conversationStart + (conversationDuration * i) / messages.length;
          const estimatedEnd =
            conversationStart +
            (conversationDuration * (i + 1)) / messages.length;
          if (!startTime) {
            startTime = estimatedStart;
          }
          if (!endTime) {
            endTime = estimatedEnd;
          }
        } else {
          // No conversation start time, skip this message
          continue;
        }
      }

      // Update conversation start if this is the first message with a timestamp
      if (!conversationStart || startTime < conversationStart) {
        conversationStart = startTime;
      }

      let duration = endTime - startTime;
      // Ensure minimum duration for visibility (10ms for better visual representation)
      const minDuration = 10;
      if (duration < minDuration) {
        endTime = startTime + minDuration;
        duration = minDuration;
      }
      messagesWithTimestamps.push({
        message: msg,
        index: i,
        startTime,
        endTime,
        duration,
      });

      // Update previousEndTime for next iteration
      previousEndTime = endTime;
    }

    if (messagesWithTimestamps.length === 0 || !conversationStart) {
      return null;
    }

    // Calculate time range
    const conversationEndTime = conversationLastMessageAt
      ? new Date(conversationLastMessageAt).getTime()
      : conversationStart + 60000; // Default 1 minute if no end time
    const maxTime = Math.max(
      ...messagesWithTimestamps.map((m) => m.endTime),
      conversationEndTime
    );
    const rawTimeRange = maxTime - conversationStart;

    if (rawTimeRange === 0) {
      return null;
    }

    // Calculate idle time (gaps between non-user message end and user message start)
    // This excludes user thinking/typing time which can be arbitrarily long
    let totalIdleTime = 0;
    const idlePeriods: Array<{ start: number; end: number }> = [];

    for (let i = 0; i < messagesWithTimestamps.length - 1; i++) {
      const currentMsg = messagesWithTimestamps[i];
      const nextMsg = messagesWithTimestamps[i + 1];

      // If current message is NOT a user message and next message IS a user message
      // and there's a gap between them, that's idle time
      if (
        currentMsg.message.role !== "user" &&
        nextMsg.message.role === "user" &&
        nextMsg.startTime > currentMsg.endTime
      ) {
        const idleStart = currentMsg.endTime;
        const idleEnd = nextMsg.startTime;
        const idleDuration = idleEnd - idleStart;
        totalIdleTime += idleDuration;
        idlePeriods.push({ start: idleStart, end: idleEnd });
      }
    }

    // Compressed time range excludes idle time
    const compressedTimeRange = rawTimeRange - totalIdleTime;

    // Create a function to convert real time to compressed time
    // This removes idle periods from the timeline
    const compressTime = (realTime: number): number => {
      let compressedTime = realTime - conversationStart;

      // Subtract all idle periods that occur before this time
      for (const idle of idlePeriods) {
        if (idle.end <= realTime) {
          // This entire idle period is before our time, subtract it
          compressedTime -= idle.end - idle.start;
        } else if (idle.start < realTime && idle.end > realTime) {
          // We're inside an idle period, subtract the portion before our time
          compressedTime -= realTime - idle.start;
        }
      }

      return compressedTime;
    };

    return {
      messages: messagesWithTimestamps,
      conversationStart,
      timeRange: compressedTimeRange,
      maxTime,
      compressTime, // Function to convert real time to compressed time
      totalIdleTime,
    };
  }, [messages, conversationStartedAt, conversationLastMessageAt]);

  if (!graphData) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-400">
        No temporal data available for this conversation
      </div>
    );
  }

  const { messages: graphMessages, conversationStart, timeRange } = graphData;

  // Graph dimensions
  const width = 800;
  const padding = { top: 20, right: 100, bottom: 40, left: 120 };
  const baseBarHeight = 20; // Substantially reduced
  const userBarHeight = 28; // Still taller than others but reduced
  const spacing = 1; // Minimal spacing

  // Calculate cumulative y positions accounting for different bar heights
  const messagePositions = graphMessages.reduce(
    (acc, { message }) => {
      const isUser = message.role === "user";
      const currentBarHeight = isUser ? userBarHeight : baseBarHeight;
      const y = acc.cumulativeY;
      acc.positions.push({ y, barHeight: currentBarHeight, isUser });
      acc.cumulativeY += currentBarHeight + spacing;
      return acc;
    },
    {
      positions: [] as Array<{ y: number; barHeight: number; isUser: boolean }>,
      cumulativeY: 0,
    }
  ).positions;

  const totalHeight = messagePositions.reduce(
    (sum, pos, idx) =>
      sum + pos.barHeight + (idx < messagePositions.length - 1 ? spacing : 0),
    0
  );
  const height = Math.max(totalHeight + padding.top + padding.bottom, 200);
  const graphWidth = width - padding.left - padding.right;

  // Format time for display
  const formatTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  // Calculate x position for a time
  // Uses compressed time to exclude idle periods
  const getXPosition = (time: number): number => {
    if (!graphData) return 0;
    const compressedTime = graphData.compressTime
      ? graphData.compressTime(time)
      : time - conversationStart;
    return (compressedTime / timeRange) * graphWidth;
  };

  // Shared markdown component configuration (reused from ConversationDetailModal)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markdownComponents: Record<string, React.ComponentType<any>> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    code: (props: any) => {
      const { className, children, ...rest } = props;
      const isInline = !className || !className.includes("language-");
      if (isInline) {
        return (
          <code
            className="rounded-lg border-2 border-neutral-300 bg-neutral-100 px-2 py-1 font-mono text-xs font-bold dark:border-neutral-700 dark:bg-surface-100 dark:text-neutral-50"
            {...rest}
          >
            {children}
          </code>
        );
      }
      return (
        <code
          className="block overflow-x-auto rounded-xl border-2 border-neutral-300 bg-neutral-100 p-5 font-mono text-sm font-bold dark:border-neutral-700 dark:bg-surface-100 dark:text-neutral-50"
          {...rest}
        >
          {children}
        </code>
      );
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p: ({ children }: any) => <p className="mb-2 last:mb-0">{children}</p>,
  };

  // Render message content (reused from ConversationDetailModal)
  const renderMessageContent = (
    content: unknown
  ): React.ReactElement | string => {
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return (
        <div className="space-y-3">
          {content.map((item, itemIndex) => {
            if (typeof item === "string") {
              // Skip redacted text - don't display it
              if (item === "[REDACTED]") {
                return null;
              }
              return (
                <div key={itemIndex} className="text-sm">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {item}
                  </ReactMarkdown>
                </div>
              );
            }
            if (typeof item === "object" && item !== null) {
              // Tool call
              if ("type" in item && item.type === "tool-call") {
                const toolCall = item as {
                  type: "tool-call";
                  toolCallId?: string;
                  toolName?: string;
                  args?: unknown;
                };
                const toolName = toolCall.toolName || "unknown";
                const args = toolCall.args || {};
                return (
                  <div
                    key={itemIndex}
                    className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950"
                  >
                    <div className="mb-2 text-xs font-medium text-blue-700 dark:text-blue-300">
                      🔧 Tool Call: {toolName}
                    </div>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded bg-blue-100 px-2 py-1 font-mono text-xs font-semibold text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                        {toolName}
                      </span>
                      {toolCall.toolCallId && (
                        <span className="text-xs text-blue-600 dark:text-blue-400">
                          ID: {toolCall.toolCallId.substring(0, 8)}...
                        </span>
                      )}
                    </div>
                    <details className="text-xs">
                      <summary className="cursor-pointer font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
                        View arguments
                      </summary>
                      <div className="mt-2">
                        <div className="mb-1 font-medium text-blue-700 dark:text-blue-300">
                          Arguments:
                        </div>
                        <pre className="overflow-x-auto rounded bg-blue-100 p-2 text-xs dark:bg-blue-900 dark:text-blue-50">
                          {JSON.stringify(args, null, 2)}
                        </pre>
                      </div>
                    </details>
                  </div>
                );
              }
              // Tool result
              if ("type" in item && item.type === "tool-result") {
                const toolResult = item as {
                  type: "tool-result";
                  toolCallId?: string;
                  toolName?: string;
                  result?: unknown;
                  costUsd?: number;
                };
                const toolName = toolResult.toolName || "unknown";
                const result = toolResult.result;
                const hasResult = result !== undefined;
                const costUsd = toolResult.costUsd;
                return (
                  <div
                    key={itemIndex}
                    className="rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950"
                  >
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-green-700 dark:text-green-300">
                      <CheckCircleIcon className="size-3" />
                      Tool Result: {toolName}
                    </div>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded bg-green-100 px-2 py-1 font-mono text-xs font-semibold text-green-600 dark:bg-green-900 dark:text-green-300">
                        {toolName}
                      </span>
                      {toolResult.toolCallId && (
                        <span className="text-xs text-green-600 dark:text-green-400">
                          ID: {toolResult.toolCallId.substring(0, 8)}...
                        </span>
                      )}
                      {costUsd !== undefined && (
                        <div className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-800 opacity-70 dark:bg-green-900 dark:text-green-200">
                          {formatCurrency(costUsd, "usd", 10)}
                        </div>
                      )}
                    </div>
                    {hasResult && (
                      <details className="text-xs">
                        <summary className="cursor-pointer font-medium text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300">
                          View result
                        </summary>
                        <div className="mt-2">
                          <div className="mb-1 font-medium text-green-700 dark:text-green-300">
                            Result:
                          </div>
                          {typeof result === "string" ? (
                            <div className="rounded bg-green-100 p-2 text-xs dark:bg-green-900 dark:text-green-50">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={markdownComponents}
                              >
                                {result}
                              </ReactMarkdown>
                            </div>
                          ) : (
                            <pre className="overflow-x-auto rounded bg-green-100 p-2 text-xs dark:bg-green-900 dark:text-green-50">
                              {JSON.stringify(result, null, 2)}
                            </pre>
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                );
              }
              // Reasoning content - skip redacted reasoning
              if ("type" in item && item.type === "reasoning" && "text" in item) {
                const reasoningItem = item as {
                  type: "reasoning";
                  text: string;
                };
                // Skip redacted reasoning - don't display it
                // Check if text is exactly "[REDACTED]" or contains it (likely at the end)
                const trimmedText = reasoningItem.text.trim();
                if (trimmedText === "[REDACTED]" || trimmedText.endsWith("\n\n[REDACTED]") || trimmedText.endsWith("\n[REDACTED]")) {
                  return null;
                }
                // Remove [REDACTED] marker if present in the text
                let cleanedText = reasoningItem.text;
                cleanedText = cleanedText.replace(/\n*\s*\[REDACTED\]\s*$/g, "").trim();
                // If after cleaning the text is empty, skip it
                if (!cleanedText) {
                  return null;
                }
                return (
                  <div
                    key={itemIndex}
                    className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-800 dark:bg-indigo-950"
                  >
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                      🧠 Reasoning
                    </div>
                    <div className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-indigo-100 p-2 text-xs text-indigo-900 dark:bg-indigo-900 dark:text-indigo-100">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {cleanedText}
                      </ReactMarkdown>
                    </div>
                  </div>
                );
              }
              // Text content - skip redacted text
              if ("text" in item && typeof item.text === "string") {
                // Skip redacted text - don't display it
                if (item.text === "[REDACTED]") {
                  return null;
                }
                return (
                  <div key={itemIndex} className="text-sm">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents}
                    >
                      {item.text}
                    </ReactMarkdown>
                  </div>
                );
              }
            }
            return (
              <div key={itemIndex} className="text-xs text-neutral-500">
                {JSON.stringify(item)}
              </div>
            );
          })}
        </div>
      );
    }
    return JSON.stringify(content, null, 2);
  };

  const formatTokenUsage = (tokenUsage: unknown): string | null => {
    if (
      !tokenUsage ||
      typeof tokenUsage !== "object" ||
      !("totalTokens" in tokenUsage)
    ) {
      return null;
    }
    const usage = tokenUsage as {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      reasoningTokens?: number;
      cachedPromptTokens?: number;
    };
    if (typeof usage.totalTokens !== "number") {
      return null;
    }
    const parts: string[] = [];
    if (typeof usage.promptTokens === "number") {
      parts.push(`Prompt: ${usage.promptTokens.toLocaleString()}`);
    }
    if (typeof usage.completionTokens === "number") {
      parts.push(`Completion: ${usage.completionTokens.toLocaleString()}`);
    }
    if (
      typeof usage.reasoningTokens === "number" &&
      usage.reasoningTokens > 0
    ) {
      parts.push(`Reasoning: ${usage.reasoningTokens.toLocaleString()}`);
    }
    if (
      typeof usage.cachedPromptTokens === "number" &&
      usage.cachedPromptTokens > 0
    ) {
      parts.push(`Cached: ${usage.cachedPromptTokens.toLocaleString()}`);
    }
    const total = usage.totalTokens.toLocaleString();
    return parts.length > 0 ? `${total} (${parts.join(", ")})` : total;
  };

  return (
    <div className="relative rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-surface-100">
      <div className="mb-4 flex items-center gap-2">
        <ClockIcon className="size-5 text-neutral-600 dark:text-neutral-400" />
      </div>
      <div ref={containerRef} className="relative overflow-x-auto">
        <svg
          ref={svgRef}
          width={width}
          height={height}
          className="min-w-full"
          viewBox={`0 0 ${width} ${height}`}
          style={{ display: "block" }}
        >
          {/* Gradient definitions */}
          <defs>
            {Object.entries(MESSAGE_COLORS).map(([role, colors]) => {
              // User messages use a diagonal gradient to match bg-gradient-primary
              if (role === "user") {
                return (
                  <linearGradient
                    key={`gradient-${role}`}
                    id={`gradient-${role}`}
                    x1="0%"
                    y1="0%"
                    x2="100%"
                    y2="100%"
                  >
                    <stop offset="0%" stopColor={colors.dark} stopOpacity="1" />
                    <stop
                      offset="50%"
                      stopColor={colors.base}
                      stopOpacity="1"
                    />
                    <stop
                      offset="100%"
                      stopColor={colors.light}
                      stopOpacity="1"
                    />
                  </linearGradient>
                );
              }
              // Assistant-tool messages use a diagonal gradient similar to user
              if (role === "assistant-tool") {
                return (
                  <linearGradient
                    key={`gradient-${role}`}
                    id={`gradient-${role}`}
                    x1="0%"
                    y1="0%"
                    x2="100%"
                    y2="100%"
                  >
                    <stop offset="0%" stopColor={colors.dark} stopOpacity="1" />
                    <stop
                      offset="50%"
                      stopColor={colors.base}
                      stopOpacity="1"
                    />
                    <stop
                      offset="100%"
                      stopColor={colors.light}
                      stopOpacity="1"
                    />
                  </linearGradient>
                );
              }
              // Other messages use vertical gradient
              return (
                <linearGradient
                  key={`gradient-${role}`}
                  id={`gradient-${role}`}
                  x1="0%"
                  y1="0%"
                  x2="0%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor={colors.light} stopOpacity="1" />
                  <stop offset="50%" stopColor={colors.base} stopOpacity="1" />
                  <stop offset="100%" stopColor={colors.dark} stopOpacity="1" />
                </linearGradient>
              );
            })}
            {/* Shadow filter for depth */}
            <filter id="barShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="1.5" />
              <feOffset dx="1" dy="1" result="offsetblur" />
              <feComponentTransfer>
                <feFuncA type="linear" slope="0.3" />
              </feComponentTransfer>
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Grid lines */}
          {Array.from({ length: 6 }).map((_, i) => {
            // Calculate compressed time for grid line
            const compressedTimeFraction = i / 5;
            const compressedTime = timeRange * compressedTimeFraction;

            // Grid lines are positioned based on compressed time directly
            // The x position is calculated from compressed time fraction

            const x = padding.left + (graphWidth * i) / 5;
            return (
              <g key={`grid-${i}`}>
                <line
                  x1={x}
                  y1={padding.top}
                  x2={x}
                  y2={height - padding.bottom}
                  stroke="currentColor"
                  strokeWidth={0.5}
                  className="text-neutral-300 dark:text-neutral-600"
                  strokeDasharray="2,2"
                />
                <text
                  x={x}
                  y={height - padding.bottom + 20}
                  textAnchor="middle"
                  className="fill-neutral-600 text-xs dark:fill-neutral-400"
                >
                  {formatTime(compressedTime)}
                </text>
              </g>
            );
          })}

          {/* Message bars */}
          {graphMessages.map(({ message, index, startTime, duration }, i) => {
            const position = messagePositions[i];
            const y = padding.top + position.y;
            const barHeight = position.barHeight;
            const isUser = position.isUser;
            const x = padding.left + getXPosition(startTime);
            const barWidth = Math.max((duration / timeRange) * graphWidth, 2); // Minimum 2px width

            // Check if assistant message has tool calls
            let roleKey: string = message.role;
            if (message.role === "assistant") {
              const content = message.content;
              const hasToolCall = Array.isArray(content)
                ? content.some(
                    (item) =>
                      typeof item === "object" &&
                      item !== null &&
                      "type" in item &&
                      item.type === "tool-call"
                  )
                : false;
              if (hasToolCall) {
                roleKey = "assistant-tool";
              }
            }

            const colors = MESSAGE_COLORS[
              roleKey as keyof typeof MESSAGE_COLORS
            ] ||
              MESSAGE_COLORS[message.role] || {
                base: "#6b7280",
                light: "#9ca3af",
                dark: "#4b5563",
              };
            const label = `${MESSAGE_LABELS[message.role] || message.role} #${
              index + 1
            }`;

            return (
              <g key={`message-${i}`}>
                {/* Message bar with gradient and shadow */}
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  fill={`url(#gradient-${roleKey})`}
                  rx={isUser ? 8 : 4}
                  ry={isUser ? 8 : 4}
                  filter="url(#barShadow)"
                  style={{ cursor: "pointer" }}
                  className="transition-opacity duration-200 hover:opacity-90"
                />
                {/* Subtle border for definition (only for non-user and non-assistant-tool messages) */}
                {message.role !== "user" && roleKey !== "assistant-tool" && (
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    fill="none"
                    stroke={colors.dark}
                    strokeWidth={0.5}
                    strokeOpacity={0.3}
                    rx={4}
                    ry={4}
                    style={{ cursor: "pointer" }}
                  />
                )}
                {/* User icon for user messages - positioned at the start of the bar */}
                {isUser && (
                  <g>
                    {/* User circle background */}
                    <circle
                      cx={x}
                      cy={y + barHeight / 2}
                      r={10}
                      fill="white"
                      fillOpacity="0.95"
                      stroke="#0d9488"
                      strokeWidth={1.5}
                    />
                    {/* User head */}
                    <circle
                      cx={x}
                      cy={y + barHeight / 2 - 3}
                      r={3}
                      fill="none"
                      stroke="#0d9488"
                      strokeWidth={1.2}
                    />
                    {/* User body (shoulders) */}
                    <path
                      d={`M ${x - 3.5} ${
                        y + barHeight / 2 + 0.5
                      } A 3.5 3.5 0 0 0 ${x + 3.5} ${y + barHeight / 2 + 0.5}`}
                      fill="none"
                      stroke="#0d9488"
                      strokeWidth={1.2}
                      strokeLinecap="round"
                    />
                  </g>
                )}
                {/* Message label on the left */}
                <text
                  x={padding.left - 10}
                  y={y + barHeight / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-neutral-700 text-xs font-medium dark:fill-neutral-300"
                >
                  {label}
                </text>
                {/* Hoverable area */}
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  fill="transparent"
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => {
                    if (svgRef.current && containerRef.current) {
                      const containerRect =
                        containerRef.current.getBoundingClientRect();
                      // Convert SVG coordinates to container-relative coordinates
                      const svgPointCenter = svgRef.current.createSVGPoint();
                      svgPointCenter.x = x + barWidth / 2;
                      svgPointCenter.y = y + barHeight; // Bottom of the bar
                      const ctm = svgRef.current.getScreenCTM();
                      if (ctm) {
                        const screenPoint = svgPointCenter.matrixTransform(ctm);
                        setHoveredMessage({
                          message,
                          index,
                          barX: screenPoint.x - containerRect.left,
                          barY: screenPoint.y - containerRect.top,
                          barWidth,
                          barHeight,
                        });
                      } else {
                        // Fallback: use percentage-based positioning
                        setHoveredMessage({
                          message,
                          index,
                          barX: x + barWidth / 2,
                          barY: y + barHeight,
                          barWidth,
                          barHeight,
                        });
                      }
                    } else {
                      // Fallback: use SVG coordinates directly
                      setHoveredMessage({
                        message,
                        index,
                        barX: x + barWidth / 2,
                        barY: y + barHeight,
                        barWidth,
                        barHeight,
                      });
                    }
                  }}
                  onMouseLeave={() => {
                    setHoveredMessage(null);
                  }}
                />
              </g>
            );
          })}

          {/* Y-axis label - positioned at the top left, outside the chart area */}
          <text
            x={padding.left / 2}
            y={padding.top - 10}
            textAnchor="middle"
            className="fill-neutral-700 text-sm font-medium dark:fill-neutral-300"
          >
            Messages
          </text>

          {/* X-axis label */}
          <text
            x={width / 2}
            y={height - 10}
            textAnchor="middle"
            className="fill-neutral-700 text-sm font-medium dark:fill-neutral-300"
          >
            Time (relative to conversation start)
          </text>
        </svg>
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-4 text-xs">
        {Object.entries(MESSAGE_LABELS).map(([role, label]) => {
          const colors = MESSAGE_COLORS[role] || {
            base: "#6b7280",
            light: "#9ca3af",
            dark: "#4b5563",
          };
          return (
            <div key={role} className="flex items-center gap-2">
              <div
                className="size-3 rounded shadow-sm"
                style={{
                  background: `linear-gradient(135deg, ${colors.light} 0%, ${colors.base} 50%, ${colors.dark} 100%)`,
                }}
              />
              <span className="text-neutral-600 dark:text-neutral-400">
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Message Tooltip */}
      {hoveredMessage && (
        <div
          className="pointer-events-none absolute z-50 max-w-lg shadow-xl"
          style={{
            left: `${hoveredMessage.barX}px`,
            top: `${hoveredMessage.barY}px`,
            transform: "translate(-50%, 0) translateY(10px)",
            maxWidth: "min(500px, calc(100vw - 2rem))",
          }}
        >
          <div className="max-h-96 overflow-y-auto">
            {(() => {
              const message = hoveredMessage.message;
              const role = message.role;
              const content = message.content;
              const tokenUsage =
                "tokenUsage" in message
                  ? formatTokenUsage(message.tokenUsage)
                  : null;
              const modelName =
                role === "assistant" &&
                "modelName" in message &&
                typeof message.modelName === "string"
                  ? message.modelName
                  : null;
              const provider =
                role === "assistant" &&
                "provider" in message &&
                typeof message.provider === "string"
                  ? message.provider
                  : null;
              const messageCost = getMessageCost(message);
              const costUsd = messageCost?.costUsd;
              const isFinal = messageCost?.isFinal;
              const generationTimeMs =
                role === "assistant" &&
                "generationTimeMs" in message &&
                typeof message.generationTimeMs === "number"
                  ? message.generationTimeMs
                  : null;

              return (
                <div
                  className={`rounded-lg p-4 ${
                    role === "user"
                      ? "bg-gradient-primary text-white"
                      : role === "assistant"
                      ? "border border-neutral-200 bg-neutral-50 text-neutral-900 dark:border-neutral-700 dark:bg-surface-100 dark:text-neutral-50"
                      : "border border-neutral-200 bg-neutral-50 text-neutral-900 dark:border-neutral-700 dark:bg-surface-100 dark:text-neutral-50"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-medium opacity-80 dark:opacity-90">
                      {role}
                    </div>
                    <div className="flex items-center gap-2">
                      {modelName && provider && (
                        <div className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800 opacity-70 dark:bg-blue-900 dark:text-blue-200">
                          {provider}/{modelName}
                        </div>
                      )}
                      {tokenUsage && (
                        <div className="rounded bg-black bg-opacity-10 px-2 py-1 font-mono text-xs opacity-70 dark:bg-white dark:bg-opacity-10 dark:text-neutral-200">
                          {tokenUsage}
                        </div>
                      )}
                      {costUsd !== undefined && (
                        <div
                          className={`rounded px-2 py-1 text-xs font-medium opacity-70 ${
                            isFinal === true
                              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                              : isFinal === false
                              ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                              : "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
                          }`}
                        >
                          {formatCurrency(costUsd, "usd", 10)}
                          {isFinal === true && " ✓"}
                          {isFinal === false && " (provisional)"}
                        </div>
                      )}
                      {generationTimeMs !== null && (
                        <div className="rounded bg-indigo-100 px-2 py-1 text-xs font-medium text-indigo-800 opacity-70 dark:bg-indigo-900 dark:text-indigo-200">
                          {(generationTimeMs / 1000).toFixed(2)}s
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-sm">
                    {(() => {
                      const renderedContent = renderMessageContent(content);
                      if (typeof renderedContent === "string") {
                        return renderedContent.trim() ? (
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={markdownComponents}
                          >
                            {renderedContent}
                          </ReactMarkdown>
                        ) : null;
                      }
                      return renderedContent;
                    })()}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};
