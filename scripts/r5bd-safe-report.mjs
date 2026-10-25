/** R5h acceptance-only strict, bounded, no-exception-message receipt contract. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
export { classifyR5hFailure } from "./r5h-failure-classify.mjs";

export const STAGES = Object.freeze([
  "configuration", "profile-snapshot", "calibration-start", "calibration-invocation",
  "calibration-result", "loaded-context-refresh", "numeric-trust-gate",
  "mission-start", "agent-execution", "final-report", "harness",
]);
export const OWNERS = Object.freeze([
  "frontend", "calibration", "preflight", "native-ipc", "provider", "harness",
]);
const CODES = new Set([
  "calibration-failure", "context-lease-held", "settings-unavailable",
  "server-unavailable", "runtime-unavailable", "model-unavailable",
  "context-settings-changed", "context-settings-unavailable",
  "ollama-context-route", "ollama-context-unverified",
  "ollama-context-mismatch", "context-overflow", "unreachable",
  "timeout", "abort", "type-error", "missing-model-binding",
  "rejected-string", "unclassified",
]);
const CLASSES = new Set([
  "Error", "TypeError", "AbortError", "ContextBudgetError",
  "InferenceTransportError", "AssertionError", "unknown",
]);
const LAST = new Set([
  "none", "configuration-loaded", "profile-verified",
  "calibration-start-ack", "calibration-progress-ack",
  "calibration-gate-ack", "mission-start-ack", "agent-final-ack",
]);
const exact = (value, choices, name) => {
  assert(typeof value === "string" && choices.has(value), `Invalid ${name}`);
  return value;
};
const flag = (x, name) => {
  assert(typeof x === "boolean", `Invalid ${name}`);
  return x;
};
const positive = (x, name, min = 0, max = 1000000) => {
  assert(Number.isSafeInteger(x) && x >= min && x <= max, `Invalid ${name}`);
  return x;
};

export function sanitizeR5hReport(input) {
  assert(input && typeof input === "object" && !Array.isArray(input));
  const common = {
    ok: flag(input.ok, "ok"),
    kind: exact(input.kind, new Set(["r5h-acceptance", "r5h-synthetic-failure"]), "kind"),
    missionStarted: flag(input.missionStarted, "missionStarted"),
    calibrationRequests: positive(input.calibrationRequests, "calibrationRequests", 0, 8),
    missionRequests: positive(input.missionRequests ?? 0, "missionRequests", 0, 10000),
    lastDurableStage: exact(input.lastDurableStage, LAST, "lastDurableStage"),
    nativeDispatchAttempted: flag(input.nativeDispatchAttempted, "nativeDispatchAttempted"),
  };
  if (!input.ok) {
    assert(input.missionStarted === false || input.kind === "r5h-acceptance");
    return { ...common,
      failureStage: exact(input.failureStage, new Set(STAGES), "failureStage"),
      failureCode: exact(input.failureCode, CODES, "failureCode"),
      failureClass: exact(input.failureClass, CLASSES, "failureClass"),
      failureOwner: exact(input.failureOwner, new Set(OWNERS), "failureOwner"),
    };
  }
  // Keep finite status/metadata only; never dump messages, tool input/output,
  // native HTTP bodies, prompts, credentials, or arbitrary report keys.
  const gate = input.calibrationGate;
  assert(gate && typeof gate === "object" && !Array.isArray(gate));
  const validTarget = x => x === null || (Number.isSafeInteger(x) && x > 0 && x <= 2000000);
  assert(validTarget(gate.snapshotTrustedTarget) && validTarget(gate.directTrustedTarget) && validTarget(gate.budgetRuntimeTarget));
  const attempts = Array.isArray(gate.attempts) ? gate.attempts : [];
  assert(attempts.length <= 8);
  const safeGate = {
    status: typeof gate.status === "string" && ["verified", "incomplete", "capacity", "unsupported", "offline", "manual"].includes(gate.status) ? gate.status : "unclassified",
    attempts: attempts.map(a => ({
      context: positive(a.context, "attempt.context", 1, 2000000),
      loaded: a.loaded === null ? null : positive(a.loaded, "attempt.loaded", 1, 2000000),
      outcome: exact(a.outcome, new Set(["success", "capacity", "allocation-mismatch", "transient", "timeout", "offline", "revision-changed", "cancelled", "unsupported", "interrupted"]), "attempt.outcome"),
    })),
    calibrationFresh: flag(gate.calibrationFresh, "calibrationFresh"),
    runtimeEpochMatches: flag(gate.runtimeEpochMatches, "runtimeEpochMatches"),
    loadedContextMatches: flag(gate.loadedContextMatches, "loadedContextMatches"),
    numericalRouteQualified: flag(gate.numericalRouteQualified, "numericalRouteQualified"),
    snapshotTrustedTarget: gate.snapshotTrustedTarget,
    directTrustedTarget: gate.directTrustedTarget,
    budgetRuntimeTarget: gate.budgetRuntimeTarget,
  };
  const evidence = input.exactTierProof;
  const exactTierProof = evidence && evidence.context === 73728 && evidence.status === "verified" &&
    evidence.outcome === "native-call" && evidence.validArguments === true && evidence.calls === 1 &&
    evidence.proof?.at > 0 && evidence.proof?.expiresAt > evidence.proof.at &&
    evidence.scope?.providerVersion === "0.40.11" && typeof evidence.scope?.runtimeEpoch === "string" &&
    evidence.scope?.digest === "4475827791a269b02c8ec49b1c3bc1abb5846bacf3fae015b75d33986322d8f6"
    ? { context:73728, status:"verified", outcome:"native-call", calls:1, validArguments:true,
        runtimeEpoch:evidence.scope.runtimeEpoch, digest:evidence.scope.digest,
        providerVersion:evidence.scope.providerVersion, proofExpiresAt:evidence.proof.expiresAt } : null;
  return { ...common, calibrationGate: safeGate, exactTierProof, correctionSent: input.correctionSent === true,
    sessions: Array.isArray(input.sessions) ? input.sessions.slice(0, 4).map(s => ({
      state: typeof s?.run?.state === "string" && ["running", "completed", "failed", "cancelled", "blocked"].includes(s.run.state) ? s.run.state : "unknown",
    })) : [],
    cloudInference: positive(input.cloudInference ?? 0, "cloudInference", 0, 10000),
  };
}

export async function persistR5hReport(input, destination) {
  const safe = sanitizeR5hReport(input);
  await writeFile(destination, JSON.stringify(safe, null, 2), { flag: "wx" });
  return safe;
}
