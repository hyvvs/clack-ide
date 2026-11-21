import type { AdmissionObservation } from "@/modules/ai/lib/inferenceAdmission";
import type { RunStopCause } from "@/modules/ai/lib/runStopProvenance";
import {
  cancelAllDeploymentQualificationBeforeDispatch,
  cancelDeploymentQualificationBeforeDispatch,
} from "@/modules/ai/lib/deploymentQualificationFlight";
export type InferencePhase =
  | "queued"
  | "awaiting-admission"
  | "connecting"
  | "waiting-first-output"
  | "generating"
  | "stopping"
  | "completed"
  | "cancelled"
  | "timed-out"
  | "disconnected"
  | "failed";
export type InferenceScope = {
  fallbackToken?: string;
  validateFallback?: () => Promise<void>;
  onResponseBody?: () => void;
  sessionId: string;
  runId: string;
  label?: string;
  isCurrent: () => boolean;
  validateEvidence?: () => Promise<void>;
  onPhase?: (snapshot: InferenceSnapshot) => void;
  onStop?: (cause: RunStopCause) => void;
};
export type InferenceSnapshot = {
  admission?: AdmissionObservation;
  id: string;
  nativeId?: string;
  scope?: InferenceScope;
  phase: InferencePhase;
};
type Attempt = {
  snapshot: InferenceSnapshot;
  abort: () => void;
  done: Promise<void>;
  resolve: () => void;
};
const attempts = new Map<string, Attempt>();
const listeners = new Set<() => void>();
function reportStop(scope: InferenceScope | undefined, cause: RunStopCause): void {
  try { scope?.onStop?.(cause); } catch { /* attribution cannot block cancellation */ }
}
const emit = () => {
  for (const listener of listeners) listener();
};
export function subscribeInference(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function sessionInference(
  sessionId: string | null | undefined,
): InferenceSnapshot | null {
  if (!sessionId) return null;
  let last: InferenceSnapshot | null = null;
  for (const attempt of attempts.values()) {
    if (attempt.snapshot.scope?.sessionId === sessionId) {
      if (attempt.snapshot.phase === "stopping") return attempt.snapshot;
      last = attempt.snapshot;
    }
  }
  return last;
}
export function hasOtherSessionInference(
  sessionId: string,
  runId: string,
): boolean {
  return [...attempts.values()].some(
    ({ snapshot }) =>
      snapshot.scope?.sessionId === sessionId && snapshot.scope.runId !== runId,
  );
}
export function beginInference(
  scope: InferenceScope | undefined,
  abort: () => void,
  initialPhase: InferencePhase = "connecting",
) {
  const id = crypto.randomUUID();
  let resolve!: () => void;
  const done = new Promise<void>((r) => {
    resolve = r;
  });
  attempts.set(id, {
    snapshot: { id, scope, phase: initialPhase },
    abort,
    done,
    resolve,
  });
  scope?.onPhase?.({ id, scope, phase: initialPhase });
  emit();
  return {
    observe(admission: AdmissionObservation) {
      const attempt = attempts.get(id);
      if (!attempt) return;
      attempt.snapshot = { ...attempt.snapshot, admission };
      emit();
    },
    update(phase: InferencePhase, nativeId?: string) {
      const attempt = attempts.get(id);
      if (!attempt) return;
      if (
        attempt.snapshot.phase === "stopping" &&
        phase !== "cancelled" &&
        phase !== "failed"
      )
        return;
      attempt.snapshot = {
        ...attempt.snapshot,
        phase,
        ...(nativeId ? { nativeId } : {}),
      };
      scope?.onPhase?.(attempt.snapshot);
      emit();
    },
    settle() {
      const attempt = attempts.get(id);
      if (!attempt) return;
      attempts.delete(id);
      attempt.resolve();
      emit();
    },
  };
}
export async function cancelSessionInference(
  sessionId: string,
  cause: RunStopCause = { source: "unknown", reason: "cancel-requested" },
): Promise<void> {
  // A qualification can still be in admission/session/context preparation,
  // before beginInference has registered its first native-capable attempt.
  // Revoke that exact session's dispatch authority synchronously.
  cancelDeploymentQualificationBeforeDispatch(sessionId);
  const owned = [...attempts.values()].filter(
    (a) => a.snapshot.scope?.sessionId === sessionId,
  );
  for (const a of owned) {
    reportStop(a.snapshot.scope, cause);
    a.snapshot = { ...a.snapshot, phase: "stopping" };
    a.snapshot.scope?.onPhase?.(a.snapshot);
    a.abort();
  }
  emit();
  await Promise.all(owned.map((a) => a.done));
}
export function abortInferencesForHostShutdown(): void {
  cancelAllDeploymentQualificationBeforeDispatch();
  // Ordinary native request cancellation below is not sufficient for an
  // asynchronously preparing qualification with no registered request yet.
  // The flight owner revokes its pre-dispatch authority as well.
  for (const attempt of attempts.values()) {
    const sessionId = attempt.snapshot.scope?.sessionId;
    if (sessionId) cancelDeploymentQualificationBeforeDispatch(sessionId);
  }
  for (const attempt of attempts.values()) {
    reportStop(attempt.snapshot.scope, {
      source: "host-shutdown", reason: "host-shutdown",
    });
    attempt.abort();
  }
}
export async function waitForInferenceSettlement(
  scope: InferenceScope,
): Promise<boolean> {
  const owned = [...attempts.values()].filter(
    (a) =>
      a.snapshot.scope?.sessionId === scope.sessionId &&
      a.snapshot.scope?.runId === scope.runId,
  );
  await Promise.all(owned.map((a) => a.done));
  return owned.every((a) => a.snapshot.phase === "completed");
}
export function inferenceLabel(snapshot: InferenceSnapshot): string {
  const label = snapshot.scope?.label ?? "server";
  switch (snapshot.phase) {
    case "awaiting-admission":
      return `Waiting for ${label}...`;
    case "queued":
      return `Queued: ${label} at capacity`;
    case "connecting":
      return `Connecting to ${label}...`;
    case "waiting-first-output":
      return `Waiting for ${label}...`;
    case "generating":
      return "Generating...";
    case "stopping":
      return "Stopping...";
    case "cancelled":
      return "Request cancelled";
    case "timed-out":
      return "Request timed out";
    case "disconnected":
      return "Connection interrupted";
    case "failed":
      return "Request failed";
    case "completed":
      return "Request completed";
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    abortInferencesForHostShutdown();
  });
}
