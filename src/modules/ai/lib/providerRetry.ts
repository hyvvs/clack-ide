import { wrapLanguageModel, type LanguageModel } from "ai";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { attachNativeDiagnosticSignal, detachNativeDiagnosticSignal,
  type NativeDiagnosticStage, type InferenceDiagnosticControls } from "@/modules/ai/lib/inferenceDiagnosticCorrelation";
import { normalizeAiError } from "@/modules/ai/lib/errors";
import {
  InferenceTransportError,
  beginStreamValidation,
} from "@/modules/ai/lib/inferenceErrors";

export const AGENT_PROVIDER_MAX_RETRIES = 2;
export const PROVIDER_RECOVERY_LIMITS = {
  delayMs: 30_000,
  totalMs: 120_000,
  prefixParts: 256,
} as const;

export type ProviderRetryEvent = {
  error: unknown;
  retryNumber: number;
  maxRetries: number;
};

type ProviderRetryCallbacks = {
  onRetry: (event: ProviderRetryEvent) => void;
  onRecovered: () => void;
};

type RecoveryOptions = {
  isCurrent?: () => boolean;
  onDeadline?: () => void;
  onDiagnostic?: (event: ProviderRecoveryObservation) => void;
  beforeRetry?: () => Promise<void>;
  delayMs?: number;
  totalMs?: number;
};

// Optional, content-free lifecycle observation. This is the provider wrapper's
// clock, not a socket-level or Ollama scheduling trace.
export type ProviderRecoveryObservation = {
  stage: "deadline-start" | "attempt-start" | "retry-scheduled" |
    "retry-ready" | "first-meaningful-output" | "deadline-clear" |
    "deadline-fire" | "parent-abort-propagated" | "settled" | NativeDiagnosticStage;
  at: number;
  attempt: number;
  generationId: string;
  nativeRequestId?: string;
  /** Last genuinely observed bridge phase; not a TCP/socket assertion. */
  transportStage?: NativeDiagnosticStage;
} & InferenceDiagnosticControls;

export function retryDelay(
  error: unknown,
  attempt: number,
  now = Date.now(),
): number | null {
  const normalized = normalizeAiError(error);
  const raw = normalized.retryAfter;
  let requested = 0;
  if (raw) {
    if (/^\d+(?:\.\d+)?s?$/.test(raw))
      requested = Number(raw.replace(/s$/, "")) * 1000;
    else {
      const date = Date.parse(raw);
      if (Number.isFinite(date)) requested = Math.max(0, date - now);
    }
  }
  const delay = Math.max(2000 * 2 ** (attempt - 1), requested);
  return Number.isFinite(delay) && delay <= PROVIDER_RECOVERY_LIMITS.delayMs
    ? delay
    : null;
}

export function waitForRecovery<T>(
  work: PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(work)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export function isRetryableProviderAttempt(error: unknown): boolean {
  const normalized = normalizeAiError(error);
  return (
    (normalized.retryable ||
      [
        "remote-disconnect",
        "connect-timeout",
        "first-output-timeout",
        "connection-failed",
        "dns-failure",
      ].includes(normalized.errorCode ?? "")) &&
    ([
      "rate_limit",
      "network",
      "timeout",
      "provider_unavailable",
      "model_loading",
      "backend_restart",
    ].includes(normalized.kind) ||
      normalized.errorCode === "remote-disconnect")
  );
}

export function createProviderRetryTracker(
  callbacks: ProviderRetryCallbacks,
  maxRetries = AGENT_PROVIDER_MAX_RETRIES,
) {
  let consecutiveFailures = 0;
  let retryPending = false;

  return {
    failed(error: unknown): boolean {
      consecutiveFailures += 1;
      if (
        consecutiveFailures > maxRetries ||
        !isRetryableProviderAttempt(error)
      ) {
        return false;
      }
      retryPending = true;
      callbacks.onRetry({
        error,
        retryNumber: consecutiveFailures,
        maxRetries,
      });
      return true;
    },
    succeeded(): void {
      consecutiveFailures = 0;
      if (!retryPending) return;
      retryPending = false;
      callbacks.onRecovered();
    },
  };
}

export function withProviderRetryTracking(
  model: LanguageModel,
  callbacks: ProviderRetryCallbacks,
  maxRetries = AGENT_PROVIDER_MAX_RETRIES,
  options: RecoveryOptions = {},
): LanguageModel {
  if (typeof model === "string" || model.specificationVersion !== "v3") {
    return model;
  }
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v3",
      async wrapStream({ model: underlying, params }) {
        const tracker = createProviderRetryTracker(
          callbacks,
          Math.min(maxRetries, AGENT_PROVIDER_MAX_RETRIES),
        );
        const controller = new AbortController();
        const generationId = options.onDiagnostic ? crypto.randomUUID() : "";
        let attempts = 0, meaningful = false;
        let nativeRequestId: string | undefined;
        let transportStage: NativeDiagnosticStage | undefined;
        let wireControls: InferenceDiagnosticControls = {};
        const observe = (stage: ProviderRecoveryObservation["stage"]) => {
          if (!options.onDiagnostic) return;
          try { options.onDiagnostic({ stage, at: Date.now(), attempt: attempts,
            generationId, ...(nativeRequestId ? { nativeRequestId } : {}),
            ...(transportStage ? { transportStage } : {}), ...wireControls }); }
          catch { /* diagnostics cannot affect a provider attempt */ }
        };
        const stop = () => {
          observe("parent-abort-propagated");
          controller.abort(
            params.abortSignal?.reason ??
              new DOMException("Cancelled", "AbortError"),
          );
        };
        if (params.abortSignal?.aborted) stop();
        params.abortSignal?.addEventListener("abort", stop, { once: true });
        const signal = controller.signal;
        const validation = beginStreamValidation(signal);
        const started = Date.now();
        let settledObserved = false;
        if (options.onDiagnostic) attachNativeDiagnosticSignal(signal, (stage, id, controls) => {
          nativeRequestId = id;
          transportStage = stage;
          if (controls) wireControls = controls;
          observe(stage);
          // The parent recovery promise can settle *before* Rust acknowledges
          // cancellation. Keep the weak signal join until the native terminal
          // event, if one arrives. No native transport is kept alive by this.
          if (stage === "native-settled" && settledObserved)
            detachNativeDiagnosticSignal(signal);
        });
        const totalMs = Math.min(
          options.totalMs ?? PROVIDER_RECOVERY_LIMITS.totalMs,
          PROVIDER_RECOVERY_LIMITS.totalMs,
        );
        let deadlineFired = false;
        const timer = setTimeout(() => {
          if (!signal.aborted) {
            deadlineFired = true;
            observe("deadline-fire");
            try { options.onDeadline?.(); } catch { /* observer cannot defeat deadline */ }
          }
          controller.abort(new InferenceTransportError("overall-deadline"));
        }, totalMs);
        observe("deadline-start");
        const current = () => {
          if (signal.aborted) throw signal.reason;
          if (options.isCurrent?.() === false)
            throw new DOMException("Stale request", "AbortError");
        };
        const cleanup = () => {
          if (!meaningful && !deadlineFired) observe("deadline-clear");
          if (!settledObserved) {
            settledObserved = true;
            observe("settled");
          }
          clearTimeout(timer);
          if (!nativeRequestId || transportStage === "native-settled")
            detachNativeDiagnosticSignal(signal);
          params.abortSignal?.removeEventListener("abort", stop);
          validation.dispose();
          controller.abort(new DOMException("Request settled", "AbortError"));
        };
        const exhausted = (error: unknown) =>
          attempts >= AGENT_PROVIDER_MAX_RETRIES
            ? Object.assign(new Error("Provider retries exhausted"), {
                cause: error,
                providerAttempts: attempts,
              })
            : error;
        const retry = async (error: unknown) => {
          current();
          const delay = retryDelay(error, attempts + 1);
          if (
            meaningful ||
            delay === null ||
            attempts >= Math.min(maxRetries, AGENT_PROVIDER_MAX_RETRIES) ||
            Date.now() - started + delay >= totalMs ||
            !isRetryableProviderAttempt(error)
          )
            throw error;
          attempts++;
          tracker.failed(error);
          observe("retry-scheduled");
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            await waitForRecovery(
              new Promise<void>((resolve) => {
                timeout = setTimeout(
                  resolve,
                  options.delayMs === undefined
                    ? delay
                    : Math.min(delay, options.delayMs),
                );
              }),
              signal,
            );
            current();
            await waitForRecovery(
              options.beforeRetry?.() ?? Promise.resolve(),
              signal,
            );
            current();
            observe("retry-ready");
          } finally {
            clearTimeout(timeout);
          }
        };
        const open = async () => {
          while (true) {
            current();
            validation.reset();
            try {
              nativeRequestId = undefined;
              transportStage = undefined;
              wireControls = {};
              observe("attempt-start");
              return await waitForRecovery(
                underlying
                  .doStream({ ...params, abortSignal: signal })
                  .then((result) => {
                    if (signal.aborted || options.isCurrent?.() === false) {
                      void result.stream.cancel().catch(() => {});
                      current();
                    }
                    return result;
                  }),
                signal,
              );
            } catch (error) {
              await retry(error);
            }
          }
        };
        try {
          const initial = await open();
          let active = true;
          const stream = new ReadableStream<LanguageModelV3StreamPart>({
            async start(output) {
              let result = initial;
              let reader:
                | ReadableStreamDefaultReader<LanguageModelV3StreamPart>
                | undefined;
              try {
                while (true) {
                  const prefix: LanguageModelV3StreamPart[] = [];
                  let prefixBytes = 0;
                  let finished = false;
                  reader = result.stream.getReader();
                  try {
                    while (true) {
                      const next = await waitForRecovery(
                        reader.read(),
                        AbortSignal.any([signal, validation.failureSignal()]),
                      );
                      current();
                      if (next.done) break;
                      const part = next.value;
                      if (part.type === "error") throw part.error;
                      if (part.type === "finish") finished = true;
                      const structural = [
                        "stream-start",
                        "response-metadata",
                        "text-start",
                        "reasoning-start",
                        "raw",
                      ].includes(part.type);
                      if (!meaningful && structural) {
                        prefixBytes += JSON.stringify(part).length;
                        if (
                          prefix.length >=
                            PROVIDER_RECOVERY_LIMITS.prefixParts ||
                          prefixBytes > 65_536
                        )
                          throw new InferenceTransportError("malformed-stream");
                        prefix.push(part);
                        continue;
                      }
                      if (!meaningful) {
                        meaningful = true;
                        clearTimeout(timer);
                        observe("deadline-clear");
                        observe("first-meaningful-output");
                        tracker.succeeded();
                        for (const buffered of prefix) output.enqueue(buffered);
                        prefix.length = 0;
                      }
                      output.enqueue(part);
                    }
                    if (validation.error()) throw validation.error();
                    if (!finished)
                      throw new InferenceTransportError("missing-final-event");
                    break;
                  } catch (error) {
                    await reader.cancel("provider-retry-stream-error").catch(() => {});
                    reader = undefined;
                    await retry(error);
                    result = await open();
                  }
                }
                if (active) output.close();
              } catch (error) {
                if (active) {
                  output.enqueue({ type: "error", error: exhausted(error) });
                  output.close();
                }
              } finally {
                await reader?.cancel("provider-retry-finalizer").catch(() => {});
                cleanup();
              }
            },
            cancel() {
              active = false;
              controller.abort(new DOMException("Cancelled", "AbortError"));
              cleanup();
            },
          });
          return { ...initial, stream };
        } catch (error) {
          cleanup();
          throw exhausted(error);
        }
      },
    },
  });
}
