/**
 * Event tracking structure for capturing timestamps from AI SDK model events
 */

export interface StreamEventTimestamps {
  generationStartedAt?: string; // ISO timestamp when model generation started
  generationEndedAt?: string; // ISO timestamp when model generation ended
  toolCallTimestamps: Map<string, { startedAt: string; endedAt?: string }>; // toolCallId -> timestamps
  toolExecutionTimes: Map<string, number>; // toolCallId -> executionTimeMs
  textGenerationStartedAt?: string; // ISO timestamp when text generation started (after tool execution)
  textGenerationEndedAt?: string; // ISO timestamp when text generation ended
}

/**
 * Creates a new event tracking structure
 */
export function createEventTracking(): StreamEventTimestamps {
  return {
    toolCallTimestamps: new Map(),
    toolExecutionTimes: new Map(),
  };
}
