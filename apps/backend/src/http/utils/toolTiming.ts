/**
 * Utility for tracking tool execution timing
 * Since the AI SDK controls tool execution, we use a Map to store timing data
 * keyed by toolCallId, then extract it when formatting messages
 */

// Map to store tool timing data: toolCallId -> { startedAt, executionTimeMs }
const toolTimingMap = new Map<
  string,
  { startedAt: string; executionTimeMs?: number }
>();

/**
 * Wraps a tool execute function to track execution time
 * Stores timing data in a Map keyed by toolCallId
 */
export function wrapToolExecuteWithTiming<T extends unknown[]>(
  originalExecute: (...args: T) => Promise<unknown>,
  toolCallId: string
): (...args: T) => Promise<unknown> {
  return async (...args: T) => {
    const startedAt = new Date().toISOString();
    toolTimingMap.set(toolCallId, { startedAt });

    try {
      const startTime = Date.now();
      const result = await originalExecute(...args);
      const executionTimeMs = Date.now() - startTime;

      // Update timing data with execution time
      const existing = toolTimingMap.get(toolCallId);
      if (existing) {
        toolTimingMap.set(toolCallId, {
          ...existing,
          executionTimeMs,
        });
      }

      return result;
    } catch (error) {
      // Still track time even on error
      const executionTimeMs = Date.now() - Date.parse(startedAt);
      const existing = toolTimingMap.get(toolCallId);
      if (existing) {
        toolTimingMap.set(toolCallId, {
          ...existing,
          executionTimeMs,
        });
      }
      throw error;
    }
  };
}

/**
 * Gets timing data for a tool call/result
 */
export function getToolTiming(toolCallId: string):
  | {
      startedAt?: string;
      executionTimeMs?: number;
    }
  | undefined {
  return toolTimingMap.get(toolCallId);
}

/**
 * Clears timing data for a tool call (after it's been used)
 */
export function clearToolTiming(toolCallId: string): void {
  toolTimingMap.delete(toolCallId);
}

/**
 * Clears all timing data (useful for cleanup)
 */
export function clearAllToolTiming(): void {
  toolTimingMap.clear();
}

