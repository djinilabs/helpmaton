import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runPeriodicTask } from "../asyncTasks";

describe("runPeriodicTask", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs tasks until shouldContinue returns false", async () => {
    let continueRunning = true;
    let runs = 0;
    const task = vi.fn(async () => {
      runs += 1;
      if (runs >= 2) {
        continueRunning = false;
      }
    });

    const promise = runPeriodicTask({
      intervalMs: 1000,
      task,
      shouldContinue: () => continueRunning,
    });

    await vi.advanceTimersByTimeAsync(2000);
    await promise;

    expect(task).toHaveBeenCalledTimes(2);
  });

  it("stops when aborted and waits for in-flight task", async () => {
    const controller = new AbortController();
    const task = vi.fn(async () => undefined);

    const promise = runPeriodicTask({
      intervalMs: 1000,
      task,
      shouldContinue: () => true,
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(1);

    controller.abort();
    await vi.runAllTimersAsync();
    await promise;

    expect(task).toHaveBeenCalledTimes(1);
  });

  it("reports task errors and continues until stopped", async () => {
    let continueRunning = true;
    const onError = vi.fn(() => {
      continueRunning = false;
    });

    const task = vi.fn(async () => {
      throw new Error("boom");
    });

    const promise = runPeriodicTask({
      intervalMs: 1000,
      task,
      shouldContinue: () => continueRunning,
      onError,
    });

    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(onError).toHaveBeenCalledTimes(1);
  });
});
