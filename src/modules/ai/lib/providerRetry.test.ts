import { describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import type { SessionRun } from "./sessions";
import { normalizeAiError } from "./errors";
import { InferenceTransportError } from "./inferenceErrors";
import { eligibleAgentRequestFailure } from "./agentRequestRecovery";
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
  it("classifies a verified Automatic Ollama coding first-output guard without changing its 120s bound", async () => {
    vi.useFakeTimers();
    try {
      const observed: import("./providerRetry").ProviderRecoveryObservation[] = [];
      const stopped = vi.fn();
      const model = {
        specificationVersion: "v3", provider: "ollama", modelId: "offline",
        doStream: ({ abortSignal }: { abortSignal?: AbortSignal }) =>
          new Promise((_resolve, reject) => abortSignal?.addEventListener("abort", () =>
            reject(abortSignal.reason), { once: true })),
      } as unknown as LanguageModel;
      const tracked = withProviderRetryTracking(model, {
        onRetry: vi.fn(), onRecovered: vi.fn(),
      }, 2, {
        deadlineErrorCode: "first-output-timeout",
        operationClass: "automatic-agent-coding",
        onDeadline: stopped,
        onDiagnostic: event => observed.push(event),
      });
      if (typeof tracked === "string") throw new Error("Expected wrapped v3 model");
      const pending = Promise.resolve(tracked.doStream({} as never)).catch(e => e);
      await vi.advanceTimersByTimeAsync(119_999);
      expect(stopped).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toMatchObject({ code: "first-output-timeout" });
      expect(stopped).toHaveBeenCalledExactlyOnceWith({
        deadlineMs: 120_000, elapsedMs: 120_000, meaningfulOutputObserved: false,
      });
      expect(observed.find(e => e.stage === "deadline-fire")).toMatchObject({
        operationClass: "automatic-agent-coding",
        deadlineMs: 120_000, elapsedMs: 120_000,
        meaningfulOutputObserved: false, abortOrigin: "provider-retry-guard",
      });
      expect(observed.some(e => e.stage === "first-meaningful-output")).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("keeps a production-shaped 18th Agent streaming request alive past 120s after meaningful progress", async () => {
    vi.useFakeTimers();
    try {
      const finished: LanguageModelV3StreamPart = {
        type: "finish", finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
      };
      const parts = (controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>) => {
        controller.enqueue({ type: "text-start", id: "answer" });
        controller.enqueue({ type: "text-delta", id: "answer", delta: "Progress" });
      };
      let requests = 0;
      const underlying = vi.fn(async () => {
        requests++;
        const delayed = requests === 18;
        return {
          stream: new ReadableStream<LanguageModelV3StreamPart>({
            start(controller) {
              parts(controller);
              if (delayed) setTimeout(() => {
                controller.enqueue({ type: "text-end", id: "answer" });
                controller.enqueue(finished);
                controller.close();
              }, 125_000);
              else {
                controller.enqueue({ type: "text-end", id: "answer" });
                controller.enqueue(finished);
                controller.close();
              }
            },
          }),
        };
      });
      const model = {
        specificationVersion: "v3", provider: "ollama", modelId: "offline",
        doStream: underlying,
      } as unknown as LanguageModel;
      const onRetry = vi.fn(), onDeadline = vi.fn();
      const observed: string[] = [];
      const tracked = withProviderRetryTracking(model, { onRetry, onRecovered: vi.fn() },
        2, { operationClass: "automatic-agent-coding",
          deadlineErrorCode: "first-output-timeout", onDeadline,
          onDiagnostic: e => observed.push(e.stage) });
      if (typeof tracked === "string") throw new Error("Expected wrapped v3 model");
      const collect = async () => {
        const result = await tracked.doStream({} as never);
        const output: LanguageModelV3StreamPart[] = [];
        for await (const part of result.stream as unknown as AsyncIterable<LanguageModelV3StreamPart>)
          output.push(part);
        return output;
      };
      for (let i = 0; i < 17; i++)
        expect((await collect()).slice(-1)[0]).toEqual(finished);
      const last = collect();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(onDeadline).not.toHaveBeenCalled();
      expect(observed.filter(s => s === "first-meaningful-output")).toHaveLength(18);
      await vi.advanceTimersByTimeAsync(5_000);
      expect((await last).slice(-1)[0]).toEqual(finished);
      expect(underlying).toHaveBeenCalledTimes(18);
      expect(onRetry).not.toHaveBeenCalled();
      expect(observed).not.toContain("deadline-fire");
    } finally { vi.useRealTimers(); }
  });

  it("preserves the 180s post-progress native idle boundary and exactly one Agent recovery eligibility", async () => {
    vi.useFakeTimers();
    try {
      // Offline native-contract fixture: real 180s timer ownership stays in
      // Tauri, while this exercises its structured error through the SDK wrapper.
      const doStream = vi.fn(async () => ({
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({ type: "text-start", id: "coding" });
            controller.enqueue({ type: "text-delta", id: "coding", delta: "Progress" });
            setTimeout(() => {
              controller.enqueue({
                type: "error", error: new InferenceTransportError("stream-idle-timeout"),
              });
              controller.close();
            }, 180_000);
          },
        }),
      }));
      const model = {
        specificationVersion: "v3", provider: "ollama", modelId: "offline",
        doStream,
      } as unknown as LanguageModel;
      const onDeadline = vi.fn(), onRetry = vi.fn();
      const tracked = withProviderRetryTracking(model, { onRetry, onRecovered: vi.fn() }, 2, {
        deadlineErrorCode: "first-output-timeout", onDeadline,
        operationClass: "automatic-agent-coding",
      });
      if (typeof tracked === "string") throw new Error("Expected wrapped v3 model");
      const pending = (async () => {
        const result = await tracked.doStream({} as never);
        for await (const part of result.stream as unknown as AsyncIterable<LanguageModelV3StreamPart>)
          if (part.type === "error") throw part.error;
      })().catch(e => e);
      await vi.advanceTimersByTimeAsync(179_999);
      expect(onDeadline).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      const failure = normalizeAiError(await pending);
      expect(failure).toMatchObject({ kind: "timeout", errorCode: "stream-idle-timeout" });
      const run = {
        state: "running", agentId: "builtin:coder", modelId: "offline",
        providerId: "ollama", transportModelId: "offline",
        customTools: { unavailable: false },
        budget: {
          phase: "running", totalSteps: 18, hardStepLimit: 240,
          continuationCount: 0, maxAutoContinuations: 5,
        },
        agentRequestRecovery: { attempts: 0 },
      } as unknown as SessionRun;
      expect(eligibleAgentRequestFailure(run, failure)).toBe(true);
      expect(eligibleAgentRequestFailure({
        ...run, agentRequestRecovery: { attempts: 1, phase: "finished", failures: [] },
      }, failure)).toBe(false);
      expect(eligibleAgentRequestFailure(run,
        normalizeAiError(new InferenceTransportError("first-output-timeout")))).toBe(true);
      expect(eligibleAgentRequestFailure({
        ...run, agentRequestRecovery: { attempts: 1, phase: "finished", failures: [] },
      }, normalizeAiError(new InferenceTransportError("first-output-timeout")))).toBe(false);
      for (const code of [
        "overall-deadline", "connect-timeout", "native-transport",
        "provider-error", "unsafe-endpoint", "malformed-stream", "cancelled",
      ]) {
        expect(eligibleAgentRequestFailure(run,
          normalizeAiError(new InferenceTransportError(code)))).toBe(false);
      }
      expect(eligibleAgentRequestFailure(run, {
        ...failure, errorCode: "compaction-timeout",
      })).toBe(false);
      expect(eligibleAgentRequestFailure({
        ...run, stop: { source: "explicit-user", reason: "user-stop", at: 1 },
      }, normalizeAiError(new InferenceTransportError("first-output-timeout")))).toBe(false);
      expect(doStream).toHaveBeenCalledOnce();
      expect(onRetry).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("propagates explicit cancellation immediately without mislabeling it as a first-output timeout", async () => {
    vi.useFakeTimers();
    try {
      const parent = new AbortController();
      const onDeadline = vi.fn();
      const model = {
        specificationVersion: "v3", provider: "ollama", modelId: "offline",
        doStream: ({ abortSignal }: { abortSignal?: AbortSignal }) =>
          new Promise((_resolve, reject) => abortSignal?.addEventListener("abort", () =>
            reject(abortSignal.reason), { once: true })),
      } as unknown as LanguageModel;
      const tracked = withProviderRetryTracking(model, {
        onRetry: vi.fn(), onRecovered: vi.fn(),
      }, 2, {
        deadlineErrorCode: "first-output-timeout", onDeadline,
        operationClass: "automatic-agent-coding",
      });
      if (typeof tracked === "string") throw new Error("Expected wrapped v3 model");
      const pending = Promise.resolve(tracked.doStream({
        abortSignal: parent.signal,
      } as never)).catch(e => e);
      parent.abort(new DOMException("User stopped", "AbortError"));
      expect(await pending).toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(onDeadline).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

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
  it("cannot change the deadline or retries when diagnostic callbacks throw", async () => {
    vi.useFakeTimers();
    try {
      const steps: string[] = [];
      const model = {
        specificationVersion: "v3", provider: "offline", modelId: "offline",
        doStream: ({ abortSignal }: { abortSignal?: AbortSignal }) =>
          new Promise((_resolve, reject) => abortSignal?.addEventListener("abort", () => {
            steps.push("aborted"); reject(abortSignal.reason);
          }, { once: true })),
      } as unknown as LanguageModel;
      const retry = vi.fn();
      const tracked = withProviderRetryTracking(model, {
        onRetry: retry, onRecovered: vi.fn(),
      }, 2, {
        totalMs: 25, onDiagnostic: () => { throw new Error("PRIVATE_OBSERVER_FAILURE"); },
        onDeadline: () => steps.push("deadline"),
      });
      if (typeof tracked === "string") throw new Error("Expected v3 model");
      const outcome = Promise.resolve(tracked.doStream({} as never)).catch(e => e);
      await vi.advanceTimersByTimeAsync(25);
      expect(await outcome).toBeInstanceOf(Error);
      expect(steps).toEqual(["deadline", "aborted"]);
      expect(retry).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
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
