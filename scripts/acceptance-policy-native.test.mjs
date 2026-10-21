import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AcceptancePolicyRejected, nativeExitError, POLICY_CLASSIFICATION, readPolicyRejection } from "./acceptance-policy.mjs";

const native = path.resolve(`src-tauri/target/codex-test/debug/examples/hardened_agent_acceptance${process.platform === "win32" ? ".exe" : ""}`);
const enabled = process.env.CLACK_POLICY_NATIVE_TESTS === "1";
const model = "nemotron-3.5-lightning:30b-a3b-q4_K_M";
async function setup(endpoint = "http://127.0.0.1:1/api/chat") {
  await access(native);
  const base = path.resolve("src-tauri/target/acceptance-policy-tests");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, "case-"));
  const env = Object.fromEntries(["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "HOME", "LANG"].flatMap(k => process.env[k] ? [[k, process.env[k]]] : []));
  Object.assign(env, { CLACK_ACCEPTANCE_ROOT: root, CLACK_ACCEPTANCE_RUN_ID: "policy-native", CLACK_REAL_PRODUCT_PHASE: "mission-a-1",
    CLACK_ACCEPTANCE_MODEL: model, CLACK_ACCEPTANCE_DIGEST: "a".repeat(64), CLACK_ACCEPTANCE_OLLAMA_URL: endpoint,
    APPDATA: root, LOCALAPPDATA: root, TEMP: root, TMP: root });
  const body = { model, options: { num_ctx: 65537, num_predict: 512 }, think: true, stream: true, messages: [{ role: "user", content: "fixture only, no inference" }], tools: [] };
  return { root, env, body, output: path.join(root, "mission-a-1"), identity: { runId: "policy-native", phase: "mission-a-1" } };
}
function payload(body, url) { return { requestId: "inference-1", url, body: [...Buffer.from(JSON.stringify(body))] }; }

describe.skipIf(!enabled)("compiled native acceptance policy process (no inference)", () => {
  it.each([65537, 1048576])("cleanly rejects %s before any network initialization", async numCtx => {
    const f = await setup(); f.body.options.num_ctx = numCtx;
    const result = spawnSync(native, ["--policy-fixture"], { env: f.env, windowsHide: true, input: JSON.stringify(payload(f.body, f.env.CLACK_ACCEPTANCE_OLLAMA_URL)), encoding: "utf8", timeout: 15000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(73);
    expect(result.signal).toBeNull();
    expect(result.stderr).not.toMatch(/panicked|abort|0xC0000409/);
    const typed = await nativeExitError(result.status, f.output, f.identity);
    expect(typed).toBeInstanceOf(AcceptancePolicyRejected);
    expect(typed.classification).toBe(POLICY_CLASSIFICATION);
    expect(typed.attempt).toMatchObject({ requested_num_ctx: numCtx, max_allowed_num_ctx: 65536, provider_request_id: null, network_dispatch: false,
      requested_output: 512, think: true, think_state: "true", message_count: 1, tool_count: 0, model_digest: "a".repeat(64) });
    await expect(access(`${f.output}.requests.jsonl`)).rejects.toThrow();
  });
  it("keeps 65536 controls byte-equivalent and dispatchable", async () => {
    const f = await setup(); f.body.options.num_ctx = 65536;
    const result = spawnSync(native, ["--policy-fixture"], { env: f.env, windowsHide: true, input: JSON.stringify(payload(f.body, f.env.CLACK_ACCEPTANCE_OLLAMA_URL)), encoding: "utf8", timeout: 15000 });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).dispatchable).toBe(true);
    const captured = JSON.parse(await readFile(`${f.output}.requests.jsonl`, "utf8"));
    expect(captured.body).toEqual(f.body);
    expect(await readPolicyRejection(f.output, f.identity)).toBeUndefined();
  });
  it.each(["missing", "malformed"])("persists %s context as controlled rejection", async kind => {
    const f = await setup();
    if (kind === "missing") delete f.body.options.num_ctx;
    else f.body.options.num_ctx = "SENTINEL-API-KEY";
    const result = spawnSync(native, ["--policy-fixture"], { env: f.env, windowsHide: true, input: JSON.stringify(payload(f.body, f.env.CLACK_ACCEPTANCE_OLLAMA_URL)), encoding: "utf8", timeout: 15000 });
    expect(result.status).toBe(73);
    const audit = await readFile(`${f.output}.attempts.jsonl`, "utf8");
    expect(audit).not.toContain("SENTINEL");
    expect(JSON.parse(audit).context_state).toBe(kind === "missing" ? "missing" : "string_redacted");
  });
  it.each([65537, "missing", 65536])("real native IPC handles %s without unwind/abort", async value => {
    let received = [], browserFailure;
    const server = createServer(async (req, res) => {
      if (req.url === "/api/chat") {
        let bytes = ""; for await (const chunk of req) bytes += chunk;
        received.push(JSON.parse(bytes));
        res.setHeader("content-type", "application/x-ndjson");
        res.end('{"done":true}\n'); return;
      }
      if (req.url === "/failure") {
        browserFailure = ""; for await (const chunk of req) browserFailure += chunk;
        res.end(); return;
      }
      res.setHeader("content-type", "text/html");
      res.end(`<html><body><script>
        (async () => {
          const api = window.__TAURI_INTERNALS__;
          const requestId = await api.invoke('ai_http_open');
          const callback = api.transformCallback(() => {});
          const body = ${JSON.stringify({ model, options: { ...(value === "missing" ? {} : { num_ctx: value }), num_predict: 512 }, think: true, stream: true, messages: [{ role: "user", content: "fixture only, no inference" }], tools: [] })};
          try {
            await api.invoke('ai_http_stream', { requestId, url: location.origin + '/api/chat', method: 'POST', body: [...new TextEncoder().encode(JSON.stringify(body))], allowPrivateNetwork: true, onEvent: '__CHANNEL__:' + callback });
            await api.invoke('coworking_exit');
          } catch (error) {
            await fetch('/failure', { method: 'POST', body: JSON.stringify(error) });
          }
        })().catch(error => fetch('/failure', { method: 'POST', body: String(error) }));
      </script></body></html>`);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let child;
    try {
      const f = await setup(`${origin}/api/chat`);
      f.env.CLACK_ACCEPTANCE_URL = `${origin}/coworking-acceptance.html`;
      child = spawn(native, [], { env: f.env, windowsHide: true });
      let log = ""; child.stderr.on("data", b => { log += b; }); child.stdout.on("data", b => { log += b; });
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Native IPC fixture timed out: ${log}; browser=${browserFailure}`)), 25000);
        child.once("error", error => { clearTimeout(timer); reject(error); });
        child.once("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
      });
      expect(result).toEqual({ code: value === 65536 ? 0 : 73, signal: null });
      expect(log).not.toMatch(/panicked|abort|0xC0000409/);
      const attempts = (await readFile(`${f.output}.attempts.jsonl`, "utf8")).trim().split("\n").map(line => JSON.parse(line));
      expect(attempts).toHaveLength(1);
      if (value === 65536) {
        expect(received).toHaveLength(1);
        expect(received[0].options).toEqual({ num_ctx: 65536, num_predict: 512 });
        expect(received[0].think).toBe(true);
        expect(browserFailure).toBeUndefined();
      } else {
        expect(received).toEqual([]);
        const rejection = await nativeExitError(result.code, f.output, f.identity);
        expect(rejection).toBeInstanceOf(AcceptancePolicyRejected);
        expect(rejection.attempt.requested_num_ctx).toBe(value === "missing" ? null : value);
        expect(rejection.attempt.network_dispatch).toBe(false);
      }
    } finally {
      if (child?.exitCode === null) { child.kill(); await new Promise(resolve => child.once("close", resolve)); }
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
  }, 35000);
});
