import { describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import {
  AGENT_PROVIDER_MAX_RETRIES,
  createProviderRetryTracker,
  isRetryableProviderAttempt,
  withProviderRetryTracking,
} from "./providerRetry";

function providerError(statusCode: number) {
  return {
    name: "AI_APICallError",
    message: `Request failed with status ${statusCode}`,
    statusCode,
    isRetryable: statusCode === 429 || statusCode >= 500,
  };
}

describe("provider retry lifecycle", () => {
  it("treats rate limits and provider 5xx responses as retryable attempts", () => {
    expect(isRetryableProviderAttempt(providerError(429))).toBe(true);
    expect(isRetryableProviderAttempt(providerError(503))).toBe(true);
    expect(isRetryableProviderAttempt(providerError(400))).toBe(false);
    expect(
      isRetryableProviderAttempt({
        name: "AI_InvalidToolInputError",
        toolName: "edit",
        message: "Invalid input for tool edit: Type validation failed",
      }),
    ).toBe(false);
  });

  it("reports retry-pending attempts and clears the state after recovery", () => {
    const onRetry = vi.fn();
    const onRecovered = vi.fn();
    const tracker = createProviderRetryTracker({ onRetry, onRecovered });
    const error = providerError(429);

    expect(tracker.failed(error)).toBe(true);
    expect(onRetry).toHaveBeenCalledWith({
      error,
      retryNumber: 1,
      maxRetries: AGENT_PROVIDER_MAX_RETRIES,
    });

    tracker.succeeded();

    expect(onRecovered).toHaveBeenCalledOnce();
  });

  it("does not announce another retry after the configured attempts exhaust", () => {
    const onRetry = vi.fn();
    const tracker = createProviderRetryTracker({
      onRetry,
      onRecovered: vi.fn(),
    });
    const error = providerError(503);

    expect(tracker.failed(error)).toBe(true);
    expect(tracker.failed(error)).toBe(true);
    expect(tracker.failed(error)).toBe(false);
    expect(onRetry).toHaveBeenCalledTimes(AGENT_PROVIDER_MAX_RETRIES);
  });
});

describe("production provider request deadline provenance", () => {
  it("calls the deadline owner before aborting a hung model request", async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      const model = {
        specificationVersion: "v3",
        provider: "offline",
        modelId: "offline",
        doStream: ({ abortSignal }: { abortSignal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            abortSignal?.addEventListener("abort", () => {
              order.push("abort");
              reject(abortSignal.reason);
            }, { once: true });
          }),
      } as unknown as LanguageModel;
      const tracked = withProviderRetryTracking(model, {
        onRetry: vi.fn(), onRecovered: vi.fn(),
      }, 0, { totalMs: 20, onDeadline: () => order.push("deadline") });
      if (typeof tracked === "string") throw new Error("Expected wrapped v3 model");
      const pending = Promise.resolve(tracked.doStream({} as never)).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(20);
      expect(order).toEqual(["deadline", "abort"]);
      expect(await pending).toBeInstanceOf(Error);
    } finally {
      vi.useRealTimers();
    }
  });
  it("observes a first no-header attempt and deadline without claiming a retry", async () => {
    vi.useFakeTimers();
    try {
      const stages: string[] = [];
      const model = {
        specificationVersion: "v3", provider: "offline", modelId: "offline",
        doStream: ({ abortSignal }: { abortSignal?: AbortSignal }) =>
          new Promise((_resolve, reject) => abortSignal?.addEventListener("abort", () =>
            reject(abortSignal.reason), { once: true })),
      } as unknown as LanguageModel;
      const tracked = withProviderRetryTracking(model, {
        onRetry: () => { throw new Error("no retry expected"); },
        onRecovered: () => { throw new Error("no recovery expected"); },
      }, 2, {
        totalMs: 30,
        onDiagnostic: e => stages.push(`${e.stage}:${e.at}:${e.attempt}`),
      });
      if (typeof tracked === "string") throw new Error("Expected wrapped model");
      const pending = Promise.resolve(tracked.doStream({} as never)).catch(() => undefined);
      await vi.advanceTimersByTimeAsync(30);
      await pending;
      expect(stages.map(s => s.split(":")[0])).toEqual([
        "deadline-start", "attempt-start", "deadline-fire", "settled",
      ]);
      expect(stages.every(s => s.endsWith(":0"))).toBe(true);
      expect(Number(stages[2].split(":")[1]) - Number(stages[0].split(":")[1])).toBe(30);
    } finally { vi.useRealTimers(); }
  });
});
