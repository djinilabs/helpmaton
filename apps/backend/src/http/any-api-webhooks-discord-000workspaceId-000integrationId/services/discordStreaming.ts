import { updateDiscordMessage } from "./discordResponse";

const UPDATE_INTERVAL_MS = 1500; // 1.5 seconds

export interface DiscordStreamingState {
  botToken: string;
  applicationId: string;
  interactionToken: string;
  buffer: string;
  lastUpdateTime: number;
  updateTimer?: NodeJS.Timeout;
  isComplete: boolean;
}

/**
 * Creates a new streaming state for throttled message updates
 */
export function createDiscordStreamingState(
  botToken: string,
  applicationId: string,
  interactionToken: string
): DiscordStreamingState {
  return {
    botToken,
    applicationId,
    interactionToken,
    buffer: "",
    lastUpdateTime: Date.now(),
    isComplete: false,
  };
}

/**
 * Appends text to the buffer and schedules an update if needed
 */
export function appendToDiscordBuffer(
  state: DiscordStreamingState,
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
    updateDiscordMessageNow(state).catch((error) => {
      console.error("[Discord Streaming] Error updating message:", error);
    });
  } else {
    // Schedule update after remaining time
    const remainingTime = UPDATE_INTERVAL_MS - timeSinceLastUpdate;
    state.updateTimer = setTimeout(() => {
      updateDiscordMessageNow(state).catch((error) => {
        console.error("[Discord Streaming] Error updating message:", error);
      });
    }, remainingTime);
  }
}

/**
 * Updates the Discord message immediately
 */
async function updateDiscordMessageNow(
  state: DiscordStreamingState
): Promise<void> {
  if (state.isComplete) {
    return;
  }

  try {
    await updateDiscordMessage(
      state.botToken,
      state.applicationId,
      state.interactionToken,
      state.buffer
    );
    state.lastUpdateTime = Date.now();
  } catch (error) {
    // Log error but don't fail - message might have been deleted or rate limited
    console.error("[Discord Streaming] Failed to update message:", error);
  }
}

/**
 * Finalizes the streaming state and ensures final message is posted
 */
export async function finalizeDiscordStreaming(
  state: DiscordStreamingState
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
    await updateDiscordMessageNow(state);
  } catch (error) {
    console.error("[Discord Streaming] Error finalizing message:", error);
    // Don't throw - we've done our best
  }
}

