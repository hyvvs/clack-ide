/** Optional in-memory join across one Agent wrapper signal and its native HTTP
 * child requests. No wire headers, globals keyed by prompts, or persistence. */
export type NativeDiagnosticStage =
  | "native-id-linked" | "native-controls-prepared" | "native-ipc-start" | "native-response-headers"
  | "native-first-chunk" | "native-parent-abort" | "native-cancel-ipc"
  | "native-settled";

export type InferenceDiagnosticControls = {
  contextTokens?: number;
  outputTokens?: number;
  toolSchemas?: number;
};
type Sink = (stage: NativeDiagnosticStage, nativeRequestId: string,
  controls?: InferenceDiagnosticControls) => void;
const signals = new WeakMap<AbortSignal, Sink>();

export function nativeDiagnosticSignalObserved(signal: AbortSignal | null | undefined): boolean {
  return Boolean(signal && signals.has(signal));
}

export function attachNativeDiagnosticSignal(signal: AbortSignal, sink: Sink): void {
  signals.set(signal, sink);
}

export function detachNativeDiagnosticSignal(signal: AbortSignal): void {
  signals.delete(signal);
}

export function observeNativeDiagnostic(
  signal: AbortSignal | null | undefined,
  stage: NativeDiagnosticStage,
  nativeRequestId: string | undefined,
  controls?: InferenceDiagnosticControls,
): void {
  if (!signal || !nativeRequestId) return;
  try { signals.get(signal)?.(stage, nativeRequestId, controls); }
  catch { /* Observation cannot alter an in-flight HTTP request. */ }
}

/** Extract *only* scalar numeric wire controls from already parsed preflight
 * input. Never forward the rest of the payload or any model/tool text. */
export function safeInferenceControls(input: unknown): InferenceDiagnosticControls {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const data = input as Record<string, unknown>;
  const options = data.options && typeof data.options === "object" &&
    !Array.isArray(data.options) ? data.options as Record<string, unknown> : {};
  const positive = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) &&
    value > 0 && value <= 1_048_576 ? value : undefined;
  return {
    ...(positive(options.num_ctx) ? { contextTokens: positive(options.num_ctx) } : {}),
    ...(positive(options.num_predict) ? { outputTokens: positive(options.num_predict) } : {}),
    ...(Array.isArray(data.tools) && data.tools.length <= 1024
      ? { toolSchemas: data.tools.length } : {}),
  };
}

import type { ProviderRecoveryObservation } from "@/modules/ai/lib/providerRetry";

/** Stable scope and captured profile references, not a live runtime claim. */
export type CorrelatedInferenceObservation = {
  sessionId: string;
  runId: string;
  provider: string;
  modelRef: string;
  digestRef?: string;
  runtimeEpochRef?: string;
  event: ProviderRecoveryObservation;
};

type Observer = (record: CorrelatedInferenceObservation) => void;
const observers = new Set<Observer>();

/** Explicit opt-in, memory-only. Installing never starts an inference. */
export function installSelfHostedInferencePhaseObserver(observer: Observer): () => void {
  observers.add(observer);
  return () => { observers.delete(observer); };
}
export function selfHostedInferencePhaseObserved(): boolean { return observers.size > 0; }
export function emitSelfHostedInferencePhase(record: CorrelatedInferenceObservation): void {
  for (const listener of observers) {
    try { listener(record); } catch { /* Diagnostic observers cannot change production behavior. */ }
  }
}
