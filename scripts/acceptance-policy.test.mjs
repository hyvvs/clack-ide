import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AcceptancePolicyRejected, EVIDENCE_EXIT, nativeExitError, POLICY_CLASSIFICATION, POLICY_EXIT, readPolicyRejection } from "./acceptance-policy.mjs";

const identity = { runId: "fixture", phase: "mission-a-1" };
function attempt(overrides = {}) {
  return { schema: 1, kind: "acceptance-request-attempt", run_id: "fixture", phase: "mission-a-1", attempt_id: "fixture:mission-a-1:123:2", order: 2, at: 100,
    model: "qwen3-coder:30b", model_matches: true, model_digest: null, endpoint: "http://127.0.0.1:11435/api/chat", destination_matches: true, native_request_id: "inference-2",
    requested_num_ctx_exact: "65537", context_state: "unsigned", requested_output: 512, output_state: "unsigned", think: null, think_state: "omitted",
    message_count: 1, tool_count: 0, serialized_bytes: 100, protected_budget: null,
    requested_num_ctx: 65537, max_allowed_num_ctx: 65536, policy_decision: "rejected", policy_reason: "context_above_maximum",
    dispatch_state: "blocked", network_dispatch: false, provider_request_id: null, ...overrides };
}
async function fixture(rows) {
  const dir = await mkdtemp(path.join(tmpdir(), "clack-policy-"));
  const output = path.join(dir, identity.phase);
  if (rows) await writeFile(`${output}.attempts.jsonl`, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  return output;
}

describe("acceptance policy parent ownership", () => {
  it("returns a typed policy rejection, not provider/model/timeout/crash classification", async () => {
    const output = await fixture([attempt()]);
    const error = await nativeExitError(POLICY_EXIT, output, identity);
    expect(error).toBeInstanceOf(AcceptancePolicyRejected);
    expect(error.classification).toBe(POLICY_CLASSIFICATION);
    expect(error.attempt).toEqual(attempt());
    expect(String(error)).not.toMatch(/MODEL|ENGINE|CLACK_CONTEXT|timeout|crash/);
  });
  it("recognizes durable rejection even if the frontend report wins the exit race", async () => {
    const output = await fixture([attempt()]);
    expect(await readPolicyRejection(output, identity)).toBeInstanceOf(AcceptancePolicyRejected);
  });
  it("does not classify old accepted audits or legacy missing attempt files as rejection", async () => {
    expect(await readPolicyRejection(await fixture(), identity)).toBeUndefined();
    expect(await readPolicyRejection(await fixture([attempt({ policy_decision: "accepted" })]), identity)).toBeUndefined();
  });
  it.each([0, 1, 3221226505, null])("keeps unrelated native exit %s distinct", async code => {
    const error = await nativeExitError(code, await fixture([attempt()]), identity);
    expect(error).not.toBeInstanceOf(AcceptancePolicyRejected);
    expect(error.message).toContain("Native host exited before report");
  });
  it("reports missing/corrupt evidence distinctly from policy facts", async () => {
    const output = await fixture();
    expect((await nativeExitError(POLICY_EXIT, output, identity)).message).toContain("DIAGNOSTICS MISSING");
    await writeFile(`${output}.attempts.jsonl`, '{"Authorization":"SENTINEL-SECRET"');
    const error = await nativeExitError(POLICY_EXIT, output, identity);
    expect(error.message).toContain("DIAGNOSTICS INVALID");
    expect(error.message).not.toContain("SENTINEL");
  });
  it.each([
    { run_id: "other" }, { phase: "other" }, { schema: 2 }, { attempt_id: "unrelated" }, { network_dispatch: true },
    { provider_request_id: "inference-2" }, { policy_reason: "model_failure" }, { max_allowed_num_ctx: 65537 }, { dispatch_state: "sent" },
    { headers: { Authorization: "SENTINEL-SECRET" } }, { endpoint: "https://user:secret@example.invalid/api/chat?key=secret" },
    { think: "SENTINEL-SECRET" }, { model: "SENTINEL-SECRET" },
  ])("rejects stale/malformed/contradictory evidence %j", async overrides => {
    await expect(readPolicyRejection(await fixture([attempt(overrides)]), identity)).rejects.toThrow("evidence unavailable or invalid");
  });
  it("rejects conflicting and oversized evidence", async () => {
    await expect(readPolicyRejection(await fixture([attempt(), attempt()]), identity)).rejects.toThrow();
    const output = await fixture();
    await writeFile(`${output}.attempts.jsonl`, " ".repeat(4 * 1024 * 1024 + 1));
    await expect(readPolicyRejection(output, identity)).rejects.toThrow();
  });
  it("preserves preceding independent timeout records verbatim", async () => {
    const output = await fixture([attempt({ policy_decision: "accepted", order: 1 }), attempt()]);
    const timeout = JSON.stringify({ kind: "timeout", elapsedMs: 75002, requestId: "inference-1" });
    await writeFile(`${output}.jsonl`, timeout);
    expect((await readPolicyRejection(output, identity)).attempt.order).toBe(2);
    expect(await readFile(`${output}.jsonl`, "utf8")).toBe(timeout);
  });
  it("isolates failed evidence writes from policy rejection", async () => {
    const error = await nativeExitError(EVIDENCE_EXIT, await fixture(), identity);
    expect(error.message).toBe("TEST_HARNESS / EVIDENCE WRITE FAILURE");
    expect(error).not.toBeInstanceOf(AcceptancePolicyRejected);
  });
  it("retains exact integer spelling beyond JavaScript numeric precision", async () => {
    const output = await fixture([attempt({ requested_num_ctx: Number(18446744073709551615n), requested_num_ctx_exact: "18446744073709551615" })]);
    expect((await readPolicyRejection(output, identity)).attempt.requested_num_ctx_exact).toBe("18446744073709551615");
  });
});
