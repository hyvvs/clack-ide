import type { InferenceScope } from "@/modules/ai/lib/inferenceLifecycle";

/** Phase boundaries, not inferred generation progress. No prompts, claims,
 * paths, provider bodies, error messages, tool inputs or profile secrets. */
export type PreparationPhase =
  | "extractor-created" | "extractor-deadline-fired" | "extractor-cancelled"
  | "extractor-disposed" | "extraction-timeout-retry"
  | "extraction-attempt-start" | "extraction-attempt-end" | "extraction-attempt-settled" | "extraction-attempt-committed"
  | "extraction-limits-start" | "extraction-limits-settled"
  | "extraction-charge-start" | "extraction-charge-settled"
  | "extraction-model-start" | "extraction-model-returned"
  | "extraction-validate-start" | "extraction-validate-completed"
  | "extraction-validate-failed" | "extraction-completed"
  | "native-request-linked" | "native-response-headers" | "native-http-settled"
  | "sdk-response-headers" | "sdk-json-settled" | "sdk-frame-validated"
  | "sdk-generate-settled" | "memory-load-start" | "memory-load-settled"
  | "memory-commit-start" | "memory-commit-settled" | "memory-commit-failed"
  | "target-begin-start" | "target-begin-settled"
  | "target-load-start" | "target-load-settled" | "target-preview-start"
  | "target-preview-settled" | "target-commit-start" | "target-commit-settled"
  | "target-validate-start" | "target-validate-completed"
  | "agent-trust-start" | "agent-trust-completed"
  | "agent-prepare-start" | "agent-prepare-completed" | "agent-prepare-failed"
  | "agent-stream-error" | "agent-run-failed" | "agent-run-completed"
  | "agent-run-cancelled" | "agent-run-interrupted";

/** Only scalar, bounded extraction metadata. Never include prompt text, tool
 * inputs/results, model output, source IDs or generated memory claims. Capture
 * remains opt-in; these observations do not imply durable evidence by default. */
export type ExtractionAttemptReason =
  | "initial" | "validation-retry" | "smaller-prefix-timeout-retry";
export type ExtractionValidationReason =
  | "response-size" | "schema" | "source-quote" | "protected-source"
  | "contradiction" | "claim-size" | "coverage";
export type ExtractionAttemptObservation = Readonly<{
  preparationId: string;
  attempt: number;
  reason: ExtractionAttemptReason;
  sourceCount: number;
  protectedCount: number;
  estimatedInputTokens: number;
  deadlineMs: number;
  startedAt: number;
  finishedAt?: number;
  settlement?: "pending" | "settled" | "unsettled";
  validation?: "not-run" | "valid" | "invalid";
  outcome?: "validated" | "invalid-output" | "timeout" | "cancelled" | "provider-failure" | "unsettled";
  validationReason?: ExtractionValidationReason;
  committed?: boolean;
}>;

export type PreparationObservation = Readonly<{
  at: number;
  sessionId: string;
  runId: string;
  phase: PreparationPhase;
  /** Request identity from the native bridge, never evidence of progress. */
  nativeRequestId?: string;
  attempt?: ExtractionAttemptObservation;
}>;

type Observer = (observation: PreparationObservation) => void;
const observers = new Set<Observer>();
type LinkedPreparation = { scope: InferenceScope; nativeRequestId?: string };
const linkedSignals = new WeakMap<AbortSignal, LinkedPreparation>();
const safeRunIdentity = (value: string) =>
  /^[A-Za-z0-9:_-]{1,160}$/.test(value) ? value : "unavailable";

/** Optional, synchronous in-memory observation only; no recording by default.
 * A future acceptance harness may subscribe before starting its authorized run. */
export function installPreparationObserver(observer: Observer): () => void {
  observers.add(observer);
  return () => { observers.delete(observer); };
}

export function emitPreparationPhase(
  scope: Pick<InferenceScope, "sessionId" | "runId"> | undefined,
  phase: PreparationPhase,
  nativeRequestId?: string,
  attempt?: ExtractionAttemptObservation,
): void {
  if (!scope || observers.size === 0) return;
  const entry: PreparationObservation = Object.freeze({
    at: Date.now(), sessionId: safeRunIdentity(scope.sessionId),
    runId: safeRunIdentity(scope.runId), phase,
    ...(nativeRequestId && /^[A-Za-z0-9:_-]{1,80}$/.test(nativeRequestId)
      ? { nativeRequestId } : {}),
    ...(attempt ? { attempt: Object.freeze({ ...attempt }) } : {}),
  });
  for (const observer of observers) {
    try { observer(entry); } catch { /* Telemetry must not change work. */ }
  }
}

export function linkPreparationSignal(signal: AbortSignal, scope: InferenceScope): void {
  linkedSignals.set(signal, { scope });
}
export function unlinkPreparationSignal(signal: AbortSignal): void {
  linkedSignals.delete(signal);
}
/** New native request, or a fresh model attempt before native admission.
 * Never apply the previous call's ID to an unrelated SDK result. */
export function setPreparationNativeRequest(signal: AbortSignal, nativeRequestId?: string): void {
  const link = linkedSignals.get(signal);
  if (!link) return;
  link.nativeRequestId = nativeRequestId && /^[A-Za-z0-9:_-]{1,80}$/.test(nativeRequestId)
    ? nativeRequestId : undefined;
}
export function observePreparationSignal(signal: AbortSignal | undefined, phase: PreparationPhase): void {
  const linked = signal && linkedSignals.get(signal);
  if (linked) emitPreparationPhase(linked.scope, phase, linked.nativeRequestId);
}

/** Only race read-only, side-effect-free operations against cancellation.
 * Native atomic commit and charge operations must report their true settlement;
 * detaching their promises would permit an unobserved late publication. */
export function awaitAbortableRead<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const settle = (fn: (value: never) => void, value: unknown) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", abort);
      fn(value as never);
    };
    const abort = () => settle(reject, signal.reason ?? new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    operation.then(value => settle(resolve, value), reason => settle(reject, reason));
  });
}
