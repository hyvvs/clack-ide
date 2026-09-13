import type { AdmissionObservation } from "@/modules/ai/lib/inferenceAdmission";
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
  sessionId: string;
  runId: string;
  label?: string;
  isCurrent: () => boolean;
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
export async function cancelSessionInference(sessionId: string): Promise<void> {
  const owned = [...attempts.values()].filter(
    (a) => a.snapshot.scope?.sessionId === sessionId,
  );
  for (const a of owned) {
    a.snapshot = { ...a.snapshot, phase: "stopping" };
    a.abort();
  }
  emit();
  await Promise.all(owned.map((a) => a.done));
}
export async function waitForInferenceSettlement(
  scope: InferenceScope,
): Promise<boolean> {
  const owned = [...attempts.values()].filter(
    (a) => a.snapshot.scope?.sessionId === scope.sessionId &&
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
    for (const attempt of attempts.values()) attempt.abort();
  });
}
