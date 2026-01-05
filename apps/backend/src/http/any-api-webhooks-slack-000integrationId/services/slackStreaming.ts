import type { WebClient } from "@slack/web-api";

import { updateSlackMessage } from "./slackResponse";

const UPDATE_INTERVAL_MS = 1500; // 1.5 seconds

export interface SlackStreamingState {
  client: WebClient;
  channel: string;
  messageTs: string;
  buffer: string;
  lastUpdateTime: number;
  updateTimer?: NodeJS.Timeout;
  isComplete: boolean;
}

/**
 * Creates a new streaming state for throttled message updates
 */
export function createSlackStreamingState(
  client: WebClient,
  channel: string,
  messageTs: string
): SlackStreamingState {
  return {
    client,
    channel,
    messageTs,
    buffer: "",
    lastUpdateTime: Date.now(),
    isComplete: false,
  };
}

/**
 * Appends text to the buffer and schedules an update if needed
 */
export function appendToSlackBuffer(
  state: SlackStreamingState,
  text: string
): void {
  state.buffer += text;

  // Clear existing timer
  if (state.updateTimer) {
    clearTimeout(state.updateTimer);
  }

  // Schedule update if enough time has passed or if this is the first chunk
  const timeSinceLastUpdate = Date.now() - state.lastUpdateTime;
  if (timeSinceLastUpdate >= UPDATE_INTERVAL_MS) {
    // Update immediately
    updateSlackMessageNow(state).catch((error) => {
      console.error("[Slack Streaming] Error updating message:", error);
    });
  } else {
    // Schedule update after remaining time
    const remainingTime = UPDATE_INTERVAL_MS - timeSinceLastUpdate;
    state.updateTimer = setTimeout(() => {
      updateSlackMessageNow(state).catch((error) => {
        console.error("[Slack Streaming] Error updating message:", error);
      });
    }, remainingTime);
  }
}

/**
 * Updates the Slack message immediately
 */
async function updateSlackMessageNow(
  state: SlackStreamingState
): Promise<void> {
  if (state.isComplete) {
    return;
  }

  try {
    await updateSlackMessage(state.client, state.channel, state.messageTs, state.buffer);
    state.lastUpdateTime = Date.now();
  } catch (error) {
    // Log error but don't fail - message might have been deleted or rate limited
    console.error("[Slack Streaming] Failed to update message:", error);
  }
}

/**
 * Finalizes the streaming state and ensures final message is posted
 */
export async function finalizeSlackStreaming(
  state: SlackStreamingState
): Promise<void> {
  // Clear any pending timer
  if (state.updateTimer) {
    clearTimeout(state.updateTimer);
    state.updateTimer = undefined;
  }

  // Mark as complete
  state.isComplete = true;

  // Ensure final message is posted
  try {
    await updateSlackMessageNow(state);
  } catch (error) {
    console.error("[Slack Streaming] Error finalizing message:", error);
    // Don't throw - we've done our best
  }
}

