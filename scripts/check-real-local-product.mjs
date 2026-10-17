import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, appendFile, readdir, cp, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createServer as createViteServer } from "vite";
import { evaluateAcceptanceApproval } from "./acceptance-approval.mjs";

const phase = process.argv[2];
assert(["stream-diagnostic", "preflight", "system-preflight", "mission-a", "resume-a", "restart", "mission-b", "offline", "stability"].includes(phase), "Specify one explicit acceptance phase");
const repository = fileURLToPath(new URL("../", import.meta.url));
const runId = process.env.CLACK_PRODUCT_RUN_ID;
assert(!runId || /^[a-z0-9][a-z0-9-]{0,63}$/.test(runId), "Use a bounded run ID, not a path");
const owned = path.join(repository, "src-tauri/target/real-qwen-product", runId ?? "");
const root = process.env.CLACK_PRODUCT_WORKSPACE ?? "C:/Users/Hayden/Documents/clack-qwen-live-acceptance";
assert(path.isAbsolute(root), "Acceptance workspace must be absolute");
const maxOutput = process.env.CLACK_PRODUCT_MAX_OUTPUT ? Number(process.env.CLACK_PRODUCT_MAX_OUTPUT) : undefined;
assert(maxOutput === undefined || (Number.isSafeInteger(maxOutput) && maxOutput >= 256 && maxOutput <= 16384), "Output allowance must be 256-16384 whole tokens");
const singleSpec = process.env.CLACK_PRODUCT_SINGLE_SPEC === "1";
const traceStreams = process.env.CLACK_PRODUCT_TRACE === "1";
const prepareOnly = process.env.CLACK_PRODUCT_PREPARE_ONLY === "1";
assert(!prepareOnly || phase === "preflight", "Metadata-only preparation must use preflight");
assert(!singleSpec || !["resume-a", "mission-b"].includes(phase), "Single-spec runs forbid manual continuation and peer missions");
const reasoningChoice = process.env.CLACK_PRODUCT_REASONING || undefined;
assert(reasoningChoice === undefined || ["automatic", "none"].includes(reasoningChoice), "Reasoning choice must be automatic or none");
assert(reasoningChoice === undefined || phase === "mission-a", "Reasoning override is only supported for a fresh Mission A acceptance run");
const endpoint = "http://127.0.0.1:11435";
let streamDiagnostic, replaySource;
if (phase === "stream-diagnostic") {
  const source = process.env.CLACK_STREAM_REQUESTS;
  assert(runId && source && path.isAbsolute(source), "Diagnostic requires fresh run ID and an explicit preserved request audit");
  assert((await stat(source)).size < 4 * 1024 * 1024, "Diagnostic request audit exceeded bound");
  const text = await readFile(source, "utf8");
  assert(Buffer.byteLength(text) < 4 * 1024 * 1024, "Diagnostic request audit exceeded bound");
  const requestId = process.env.CLACK_STREAM_REQUEST_ID ?? "inference-13";
  assert(/^inference-[1-9][0-9]{0,5}$/.test(requestId), "Explicit bounded native request ID required");
  const matches = text.trim().split("\n").map(line => JSON.parse(line)).filter(item => item.requestId === requestId);
  assert.equal(matches.length, 1, "Expected exactly one preserved native request");
  const request = matches[0];
  assert(request.url === `${endpoint}/api/chat`, "Unexpected preserved request destination");
  assert.equal(request.body.model, "qwen38-uncensored:latest");
  assert.deepEqual(request.body.options, { num_ctx: 32768, num_predict: 2048 });
  assert.equal(request.body.think, false);
  assert.equal(request.body.stream, true);
  streamDiagnostic = { body: request.body, sourceRequestId: request.requestId };
  replaySource = { file: source, sha256: createHash("sha256").update(text).digest("hex"), requestId: request.requestId };
}
await mkdir(owned, { recursive: true });
assert((await readdir(root)).includes(".git"), "Prepare the fresh external Git workspace first");
const attempt = process.argv[3] ?? "1";
assert(/^\d{1,2}$/.test(attempt));
const output = path.join(owned, `${phase}-${attempt}`);
for (const suffix of [".json", ".jsonl", ".requests.jsonl", ".receive.jsonl", ".failure.json"]) {
  try { await readFile(`${output}${suffix}`); throw new Error(`Phase ${phase} attempt ${attempt} already has evidence; choose an explicit new attempt`); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
let local, vite, child, nativeLog = "", childExit;
let complete;
const report = new Promise(resolve => { complete = resolve; });
let events = 0;
let approvalOwner;
let evidenceWrites = Promise.resolve();
const server = createServer(async (request, response) => {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "content-type");
  const json = value => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(value)); };
  try {
    if (request.method === "OPTIONS") { response.statusCode = 204; response.end(); return; }
    if (request.url === "/configuration") return json({ root, server: endpoint, report: `${local}/report`, phase: "exercise", realProduct: { phase, maxOutput, singleSpec, reasoningChoice, traceStreams, prepareOnly }, streamDiagnostic });
    if (!["/report", "/evidence", "/approval"].includes(request.url) || request.method !== "POST") { response.statusCode = 404; return json({ error: "Unknown acceptance route" }); }
    let body = "";
    for await (const chunk of request) { body += chunk; assert(body.length < 64 * 1024 * 1024, "Acceptance payload exceeded bound"); }
    const value = JSON.parse(body);
    if (request.url === "/approval") {
      assert(phase === "mission-a" && child?.exitCode === null, "Approval requires the live Mission A host");
      const decision = await evaluateAcceptanceApproval(value, approvalOwner);
      evidenceWrites = evidenceWrites.then(() => appendFile(`${output}.jsonl`, `${JSON.stringify({ kind: "evaluator-approval", at: Date.now(), subject: value, decision, hostPid: child.pid })}\n`));
      await evidenceWrites;
      return json(decision);
    }
    if (request.url === "/evidence") {
      if (value.kind === "state" && phase === "mission-a") {
        const session = value.sessions?.find(s => s.id === "real-mission-a");
        approvalOwner = undefined;
        if (session?.run?.state === "running") {
          assert.equal(path.resolve(session.run.workspaceRoot), path.resolve(root));
          approvalOwner = { sessionId: session.id, runId: `${session.id}:${session.run.startedAt}`, workspaceRoot: session.run.workspaceRoot };
        }
      }
      assert(++events < 100000, "Acceptance event limit");
      evidenceWrites = evidenceWrites.then(() => appendFile(`${output}.jsonl`, `${JSON.stringify(value)}\n`));
      await evidenceWrites;
      if (["request", "engine-finish", "correction-boundary", "peer-result", "harness-heartbeat"].includes(value.kind) || value.kind.startsWith("approval-") || value.kind === "harness-blocked") {
        const body = value.body;
        console.log(JSON.stringify({ event: value.kind, at: new Date().toISOString(), requestId: value.requestId, model: body?.model, context: body?.options?.num_ctx, output: body?.options?.num_predict, tools: body?.tools?.length, metrics: value.metrics, taskStatus: value.task?.status, elapsedMs: value.elapsedMs, approvalId: value.approvalId ?? value.approval?.id, reason: value.reason, targets: value.targets }));
      }
    } else complete(value);
    json({ ok: true });
  } catch (error) { response.statusCode = 400; json({ error: String(error) }); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
local = `http://127.0.0.1:${server.address().port}`;
const startedAt = Date.now();
async function metadataHealth(route) {
  const at = Date.now();
  try {
    const response = await fetch(`${endpoint}${route}`, { signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    return { at, elapsedMs: Date.now() - at, status: response.status, body };
  } catch (error) {
    return { at, elapsedMs: Date.now() - at, status: null, error: error.name };
  }
}
let initialModels, initialHealth;
try {
  if (phase !== "restart") {
    const response = await fetch(`${endpoint}/api/ps`, { signal: AbortSignal.timeout(5000) });
    assert(response.ok, "Ollama metadata unavailable"); initialModels = await response.json();
  }
  if (streamDiagnostic) initialHealth = await metadataHealth("/api/version");
  const build = spawnSync("cargo", ["build", "--example", "coworking_acceptance", "--locked", "--target-dir", "target/codex-test"], { cwd: path.join(repository, "src-tauri"), windowsHide: true, encoding: "utf8", timeout: 300000 });
  assert.equal(build.status, 0, build.stderr || String(build.error));
  vite = await createViteServer({ root: repository, server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, watch: null, forwardConsole: false } });
  await vite.listen();
  const data = path.join(owned, "data"); await mkdir(data, { recursive: true });
  await cp(data, `${output}.data-before`, { recursive: true, errorOnExist: true, force: false });
  const env = Object.fromEntries(["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "HOME", "LANG"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(env, { APPDATA: data, LOCALAPPDATA: data, TEMP: owned, TMP: owned, CLACK_ACCEPTANCE_ROOT: owned, CLACK_REAL_PRODUCT_PHASE: `${phase}-${attempt}`, CLACK_ACCEPTANCE_OLLAMA_URL: `${endpoint}/api/chat`, CLACK_ACCEPTANCE_URL: `${vite.resolvedUrls.local[0]}coworking-acceptance.html?configuration=${encodeURIComponent(`${local}/configuration`)}` });
  if (streamDiagnostic) env.CLACK_ACCEPTANCE_RECEIVE_TRACE = "1";
  child = spawn(path.join(repository, "src-tauri/target/codex-test/debug/examples", `coworking_acceptance${process.platform === "win32" ? ".exe" : ""}`), [], { cwd: root, env, windowsHide: true });
  child.once("exit", (code, signal) => { childExit = { pid: child.pid, code, signal, at: Date.now() }; });
  console.log(JSON.stringify({ event: "native-host-start", pid: child.pid, runnerPid: process.pid, at: Date.now(), boundMs: 90 * 60 * 1000 }));
  child.stdout.on("data", b => { nativeLog = (nativeLog + b).slice(-256 * 1024); });
  child.stderr.on("data", b => { nativeLog = (nativeLog + b).slice(-256 * 1024); });
  let timer;
  const result = await Promise.race([report, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Real product acceptance reached 90-minute bound")), 90 * 60 * 1000); }), new Promise((_, reject) => child.once("exit", code => reject(new Error(`Native host exited before report: ${code}`))))]).finally(() => clearTimeout(timer));
  await evidenceWrites;
  const destinations = [...nativeLog.matchAll(/CLACK_ACCEPTANCE_INFERENCE ("[^"\r\n]+")/g)].map(m => JSON.parse(m[1]));
  const finalHealth = streamDiagnostic ? { ps: await metadataHealth("/api/ps"), version: await metadataHealth("/api/version") } : undefined;
  const finalModels = finalHealth ? finalHealth.ps.body : await (await fetch(`${endpoint}/api/ps`, { signal: AbortSignal.timeout(5000) })).json();
  let requests = [];
  try { requests = (await readFile(`${output}.requests.jsonl`, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (streamDiagnostic) {
    assert.equal(requests.length, 1, "Diagnostic must send exactly one inference and never execute a tool loop");
    assert.deepEqual(requests[0].body, streamDiagnostic.body, "Diagnostic changed captured wire content");
  }
  const { assertRequestBudget } = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts");
  const wireBudgets = requests.map(request => ({ at: request.at, requestId: request.requestId,
    ...assertRequestBudget(result.limits ?? { runtimeTarget: 32768 }, request.body),
    tools: request.body.tools?.map(t => t.function.name) ?? [],
    schemaChars: JSON.stringify(request.body.tools ?? []).length,
    systemChars: request.body.messages.filter(m => m.role === "system").reduce((sum, m) => sum + m.content.length, 0),
    historyChars: JSON.stringify(request.body.messages.filter(m => m.role !== "system")).length,
    numCtx: request.body.options.num_ctx, numPredict: request.body.options.num_predict,
    think: request.body.think ?? "server-default",
  }));
  await writeFile(`${output}.json`, JSON.stringify({ ...result, runId, singleSpec, maxOutput, reasoningChoice, replaySource, startedAt, endedAt: Date.now(), root, initialModels, initialHealth, finalModels, finalHealth, destinations, wireBudgets, nativeLog }, null, 2));
  assert(result.ok, result.error || JSON.stringify(result));
  console.log(`PRESERVED ${phase}: ${destinations.length} native inference attempts; result ${output}.json`);
} catch (error) {
  await evidenceWrites.catch(() => {});
  await writeFile(`${output}.failure.json`, JSON.stringify({ error: String(error), startedAt, endedAt: Date.now(), root, nativeLog, initialModels, childExit }, null, 2));
  throw error;
} finally {
  if (child?.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    else child.kill();
    if (child.exitCode === null) await new Promise(resolve => child.once("exit", resolve));
  }
  await vite?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  // Preserve this test's isolated app data and external project for restart and audit.
}
