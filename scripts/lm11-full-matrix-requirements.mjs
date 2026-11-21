/**
 * User-exact, ordinal-preserving coverage requirements for the authorized
 * full LM11 model-free original-production-qualification matrix. An existing
 * native-only smoke result is never upgraded to original-runner acceptance.
 */
export const MATRIX_REQUIREMENTS = Object.freeze({
  B01: [
    ["readiness", "native-status"],
    ["preparation", "preparation-complete"],
    ["pre-dispatch", "predispatch"],
    ["request registration", "after-ai-http-open"],
    ["first output", "first-output"],
    ["terminal", "terminal-delivery"],
    ["quiescence", "quiescence-complete"],
    ["evidence evaluation", "before-evidence-acceptance"],
    ["B03 preparation", "b03-before-prepare"],
    ["B03 acknowledge/readback", "b03-before-acknowledge / b03-before-readback"],
  ],
  B02: [
    "cancel before preparation",
    "cancel during delayed preparation",
    "cancel after preparation before pre-dispatch fence",
    "cancel immediately before native request registration",
    "cancel immediately after ai_http_open",
    "cancel before first output",
    "cancel during streaming",
    "cancel immediately before terminal",
    "cancel during quiescence",
    "cancel during evidence evaluation",
    "cancel immediately before B03 prepare",
    "cancel immediately before B03 acknowledge",
    "cancel immediately after irreversible B03 commit",
    "renderer/WebView closure during preflight",
    "renderer/WebView closure during streaming",
  ],
  lateRaces: [
    "stream callback after operation cancellation",
    "terminal callback after operation cancellation",
    "cancellation acknowledgement after caller settlement",
    "stream callback after aggregate deadline",
    "terminal callback after aggregate deadline",
    "callback from child A after genuine restart to child B",
    "stale request ID after epoch transition",
    "stale cancellation after epoch transition",
    "stale qualification operation callback after epoch transition",
    "duplicate completion callback",
    "cancellation versus terminal completion",
    "renderer close versus terminal completion",
  ],
  B03: [
    "successful qualifying prepare acknowledge and readback",
    "deadline before B03 prepare",
    "cancellation before B03 prepare",
    "deadline during/at B03 prepare",
    "cancellation between prepare and acknowledge",
    "deadline before acknowledge",
    "cancellation before acknowledge",
    "acknowledgement commits but renderer response is lost",
    "deadline after physical commit before renderer acknowledgement",
    "cancellation after physical commit",
    "process termination after commit before renderer acknowledgement",
    "restart reconciliation of pending receipt",
    "restart reconciliation of acknowledged receipt",
    "exact operation replay",
    "duplicate acknowledgement",
    "stale old-epoch persistence ticket",
    "CAS conflict",
    "recovery-required or corrupt authority",
    "same deployment contention from two qualification operations",
    "ordinary unrelated settings preserved",
  ],
  concurrent: [
    "two concurrent qualifications for same deployment",
    "qualification A cancelled while qualification B remains active",
    "old runtime epoch A while new epoch B becomes current",
    "stale A persistence attempt while B owns current authority",
    "unrelated session/deployment authority unaffected",
  ],
  failures: [
    "readiness failure",
    "authenticated model-identity failure",
    "request admission failure",
    "transport failure",
    "malformed stream",
    "connection close without terminal",
    "terminal error",
    "cancellation acknowledgement failure",
    "native quiescence failure or timeout",
    "evidence rejection",
    "CAS conflict",
    "persistence recovery-required",
    "renderer/native IPC interruption",
  ],
});

export const MATRIX_REQUIRED_COUNT = Object.freeze(
  Object.fromEntries(Object.entries(MATRIX_REQUIREMENTS)
    .map(([group, rows]) => [group, rows.length])),
);

export function emptyMatrixRows(group, reason) {
  if (!Object.hasOwn(MATRIX_REQUIREMENTS, group))
    throw new Error("Invalid LM11 full matrix group");
  if (typeof reason !== "string" || !reason.trim())
    throw new Error("A nonempty evidence limitation is mandatory");
  return MATRIX_REQUIREMENTS[group].map((row, index) => ({
    ordinal: index + 1,
    productionBoundary: Array.isArray(row) ? row[0] : row,
    ...(Array.isArray(row) ? { acceptanceSeam: row[1] } : {}),
    status: "BLOCKED",
    originalProductionRunner: false,
    caseIds: [],
    reason,
  }));
}
