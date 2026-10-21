import { open } from "node:fs/promises";

export const POLICY_EXIT = 73;
export const EVIDENCE_EXIT = 74;
export const POLICY_CLASSIFICATION = "TEST_HARNESS / ACCEPTANCE POLICY REJECTION";
const reasons = new Set(["invalid_payload", "unexpected_destination", "invalid_body", "unauthorized_model", "missing_context", "malformed_context", "context_above_maximum", "reasoning_output_changed", "offline"]);
const keys = new Set(["schema", "kind", "run_id", "phase", "attempt_id", "order", "at", "model", "model_matches", "model_digest", "endpoint", "destination_matches", "native_request_id", "provider_request_id", "requested_num_ctx", "requested_num_ctx_exact", "context_state", "max_allowed_num_ctx", "requested_output", "output_state", "think", "think_state", "message_count", "tool_count", "serialized_bytes", "protected_budget", "policy_decision", "policy_reason", "dispatch_state", "network_dispatch"]);
const numericStates = new Set(["missing", "unsigned", "invalid_number", "null", "string_redacted", "boolean", "array_redacted", "object_redacted"]);
const nullableNumber = value => value === null || (typeof value === "number" && Number.isFinite(value));
const nullableCount = value => value === null || (Number.isSafeInteger(value) && value >= 0);
function sanitized(row) {
  if (Object.keys(row).length !== keys.size || Object.keys(row).some(key => !keys.has(key))) return false;
  let endpoint;
  try { endpoint = new URL(row.endpoint); } catch { return row.endpoint === "[invalid endpoint]" && safeValues(row); }
  return ["http:", "https:"].includes(endpoint.protocol) && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash &&
    ["/api/chat", "/[redacted]"].includes(endpoint.pathname) && safeValues(row);
}
function safeValues(row) {
  return (row.model === null || ["qwen3-coder:30b", "nemotron-3.5-lightning:30b-a3b-q4_K_M"].includes(row.model)) &&
    typeof row.model_matches === "boolean" && typeof row.destination_matches === "boolean" &&
    (row.model_digest === null || /^[a-f0-9]{64}$/i.test(row.model_digest)) &&
    (row.native_request_id === null || /^inference-[0-9]{1,10}$/.test(row.native_request_id)) &&
    nullableNumber(row.requested_num_ctx) && nullableNumber(row.requested_output) &&
    (row.requested_num_ctx_exact === null || (typeof row.requested_num_ctx_exact === "string" && row.requested_num_ctx_exact.length <= 32 && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(row.requested_num_ctx_exact))) &&
    numericStates.has(row.context_state) && numericStates.has(row.output_state) &&
    [null, true, false, "low", "medium", "high"].includes(row.think) && ["omitted", "false", "true", "named", "invalid_redacted"].includes(row.think_state) &&
    [row.message_count, row.tool_count, row.serialized_bytes, row.protected_budget].every(nullableCount);
}

export class AcceptancePolicyRejected extends Error {
  constructor(attempt) {
    super(POLICY_CLASSIFICATION);
    this.name = "AcceptancePolicyRejected";
    this.classification = POLICY_CLASSIFICATION;
    this.attempt = attempt;
  }
}

export async function readPolicyRejection(output, { runId, phase }) {
  let file;
  try {
    file = await open(`${output}.attempts.jsonl`, "r");
    if ((await file.stat()).size > 4 * 1024 * 1024) throw new Error("Acceptance attempt audit exceeded bound");
    const buffer = Buffer.alloc(4 * 1024 * 1024 + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 4 * 1024 * 1024) throw new Error("Acceptance attempt audit exceeded bound");
    const rows = buffer.subarray(0, bytesRead).toString("utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    const rejected = rows.filter(row => row.policy_decision === "rejected");
    if (!rejected.length) return undefined;
    if (rejected.length !== 1) throw new Error("Conflicting acceptance rejection evidence");
    const row = rejected[0];
    if (!sanitized(row) || row.schema !== 1 || row.kind !== "acceptance-request-attempt" || row.run_id !== runId || row.phase !== phase ||
        !Number.isSafeInteger(row.order) || row.order < 1 || typeof row.attempt_id !== "string" ||
        !row.attempt_id.startsWith(`${runId}:${phase}:`) || !/^\d+:\d+$/.test(row.attempt_id.slice(`${runId}:${phase}:`.length)) || !reasons.has(row.policy_reason) ||
        row.max_allowed_num_ctx !== 65536 || row.dispatch_state !== "blocked" || row.network_dispatch !== false ||
        row.provider_request_id !== null || !Number.isSafeInteger(row.at) || row.at <= 0) {
      throw new Error("Invalid acceptance rejection evidence");
    }
    return new AcceptancePolicyRejected(row);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw new Error("Acceptance rejection evidence unavailable or invalid");
  } finally {
    await file?.close();
  }
}

export async function nativeExitError(code, output, identity) {
  if (code === POLICY_EXIT) {
    try {
      return await readPolicyRejection(output, identity) ?? new Error("TEST_HARNESS / POLICY REJECTION DIAGNOSTICS MISSING");
    } catch {
      return new Error("TEST_HARNESS / POLICY REJECTION DIAGNOSTICS INVALID");
    }
  }
  if (code === EVIDENCE_EXIT) return new Error("TEST_HARNESS / EVIDENCE WRITE FAILURE");
  return new Error(`Native host exited before report: ${code}`);
}
