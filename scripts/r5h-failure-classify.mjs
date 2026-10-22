/** Browser-safe, pure R5h classification. No Node imports, messages or payloads. */
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

/** An error's message is examined in memory only to choose fixed labels. */
export function classifyR5hFailure(error, stage, lastDurableStage, nativeDispatchAttempted) {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  const nativeFailure = /Context verification is already running|Settings unavailable|Server unavailable|Runtime verification unavailable/.test(message);
  const owner = nativeFailure ? "native-ipc"
    : stage === "calibration-invocation" ? "calibration"
    : stage === "numeric-trust-gate" ? "preflight"
    : stage === "loaded-context-refresh" ? "native-ipc"
    : stage === "agent-execution" ? "frontend"
    : "harness";
  const nativeCode = /Context verification is already running/.test(message) ? "context-lease-held"
    : /Settings unavailable/.test(message) ? "settings-unavailable"
    : /Server unavailable/.test(message) ? "server-unavailable"
    : /Runtime verification unavailable/.test(message) ? "runtime-unavailable"
    : null;
  const code = nativeCode ??
    (typeof error === "object" && error !== null && typeof error.code === "string" && CODES.has(error.code)
      ? error.code
      : typeof error === "string" ? "rejected-string"
        : error instanceof TypeError ? "type-error" : "unclassified");
  const name = error instanceof Error && CLASSES.has(error.name) ? error.name : "unknown";
  return { failureStage: stage, failureCode: code, failureClass: name,
    failureOwner: owner, nativeDispatchAttempted, lastDurableStage };
}
