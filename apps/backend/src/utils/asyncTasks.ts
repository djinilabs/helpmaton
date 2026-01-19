export interface PeriodicTaskOptions {
  intervalMs: number;
  task: () => Promise<void>;
  shouldContinue: () => boolean;
  onError?: (error: unknown) => void;
  signal?: AbortSignal;
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      cleanup();
      resolve();
    };

    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runPeriodicTask({
  intervalMs,
  task,
  shouldContinue,
  onError,
  signal,
}: PeriodicTaskOptions): Promise<void> {
  while (shouldContinue() && !signal?.aborted) {
    await abortableDelay(intervalMs, signal);
    if (!shouldContinue() || signal?.aborted) {
      break;
    }

    try {
      await task();
    } catch (error) {
      onError?.(error);
    }
  }
}
