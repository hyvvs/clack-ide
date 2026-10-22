/** Exclusive one-request R5e native host. Never reuse R5b/R5d evidence or run twice. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { createR5bReceiptHandler } from "./r5c-receipt-boundary.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const root = path.join(repo, "src-tauri/target/r5e-native-one-shot-20261022-01");
const artifact = path.join(repo, "src-tauri/target/r5e-native-one-shot-20261022-01-result.json");
const source = path.join(repo, "src-tauri/target/real-qwen-product/forgeboard-nemotron-r5-20261022-03/data/terax-settings.json");
const model = "nemotron-3.5-lightning:30b-a3b-q4_K_M";
const digest = "e7a64ff15fb174c42b4f463e5c888c4f2c7b9cabf9e8d65a1c0874405426c1b2";
const endpoint = "http://127.0.0.1:11435/";
let vite, server, child, exit, trace = "", reportValue;
const timerLimit = 90_000;
async function metadata(route) {
  const response = await fetch(new URL(route, endpoint), { signal: AbortSignal.timeout(4000) });
  assert(response.ok, `Provider metadata ${route} unavailable`);
  return response.json();
}
// Prerequisites BEFORE preparing a workspace or launching a host.
const [version, tags] = await Promise.all([metadata("api/version"), metadata("api/tags")]);
assert.equal(version.version, "0.40.5");
assert.equal(tags.models.find(m => m.name === model)?.digest, digest);
const savedBytes = await readFile(source);
assert.equal(createHash("sha256").update(savedBytes).digest("hex"), "b6b48848b5144e7ec1205f3633974aad15c627fd54b5a645ee637ca369e4cca2", "Original saved profile bytes changed");
const saved = JSON.parse(savedBytes);
const ep = saved.selfHostedInference.endpoints.find(e => e.id === "real-qwen");
const profile = saved.selfHostedInference.profiles.find(p => p.endpointId === "real-qwen" && p.transportModelId === model);
assert(ep && !ep.ssh && !ep.credentialRef && new URL(ep.baseURL).href === endpoint);
assert.equal(ep.configurationRevision, 1);
assert.equal(profile?.modelRevision, digest);
assert.deepEqual(profile?.overrides, {});
// Exclusive file creates, and one-shot root. A failed run is never silently repeated.
await mkdir(root);
await mkdir(path.join(root, "data"));
await writeFile(path.join(root, "data/terax-settings.json"), savedBytes, { flag: "wx" });
const bin = path.join(repo, "src-tauri/target/codex-test/debug/examples/hardened_agent_acceptance.exe");
assert((await stat(bin)).size > 0, "Existing approved native acceptance host unavailable");
const evidence = { at: Date.now(), sourceSettingsSha256: createHash("sha256").update(savedBytes).digest("hex"), engineVersion: version.version, modelDigestMatches: true, endpointConfigurationRevision: ep.configurationRevision, requestCap: 1, runner: "r5e-one-shot", child: null, overallHostDeadlineReached: false };
let serverUrl = "";
const result = new Promise(resolve => { reportValue = resolve; });
server = createServer(createR5bReceiptHandler({
  root,
  configuration: () => ({ report: serverUrl + "/report", events: serverUrl + "/events", digest, model, endpoint }),
  onReport: async report => {
    assert.equal(report.kind, "r5e-result");
    assert.equal(report.requestCap, 1);
    assert(report.inferenceAttempts <= 1, "R5e request cap exceeded");
    const allowed = new Set(["kind", "preflight", "inferenceAttempts", "cloudInference", "fallback", "responses",
      "endpointConfigurationRevision", "stateRevision", "modelDigestMatches", "reasoningChoice",
      "requestCap", "ok", "setupErrorType", "setupErrorCode", "incrementalReceiptStatus"]);
    assert(Object.keys(report).every(key => allowed.has(key)), "Unredacted final report field");
    // The final report is a bounded, redacted receipt; acknowledgement follows
    // exclusive durable file creation. No prompt or assistant text in this file.
    assert(!JSON.stringify(report).includes("Reply with the single word"));
    assert(!JSON.stringify(report).includes(model));
    await writeFile(path.join(root, "redacted-final-report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    reportValue(report);
  },
}));
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  serverUrl = `http://127.0.0.1:${server.address().port}`;
  vite = await createViteServer({ root: repo, plugins: [{ name: "r5e-test-entry", configureServer(s) {
    s.middlewares.use("/coworking-acceptance.html", async (_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(await s.transformIndexHtml("/coworking-acceptance.html", '<html><body><div id="root"></div><script type="module" src="/src/test/r5eLiveReceiptAcceptance.tsx"></script></body></html>'));
    });
  } }], server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, watch: null } });
  await vite.listen();
  const env = Object.fromEntries(["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "HOME", "LANG"].flatMap(k => process.env[k] ? [[k, process.env[k]]] : []));
  Object.assign(env, { APPDATA: path.join(root,"data"), LOCALAPPDATA: path.join(root,"data"), TEMP: root, TMP: root, CLACK_ACCEPTANCE_ROOT: root, CLACK_REAL_PRODUCT_PHASE: "system-preflight-1", CLACK_ACCEPTANCE_RECEIVE_TRACE: "1", CLACK_ACCEPTANCE_URL: `${vite.resolvedUrls.local[0]}coworking-acceptance.html?configuration=${encodeURIComponent(serverUrl + "/configuration")}` });
  child = spawn(bin, [], { cwd: root, env, windowsHide: true });
  child.stderr.on("data", chunk => { trace = (trace + chunk).slice(-12000); });
  child.stdout.on("data", chunk => { trace = (trace + chunk).slice(-12000); });
  const settled = new Promise(resolve => child.once("exit", (code, signal) => {
    evidence.child = { code, signal };
    resolve(evidence.child);
  }));
  let timeoutId;
  const timeout = new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error("R5e 90-second native host bound")), timerLimit); });
  try {
    evidence.report = await Promise.race([result, settled.then(x => { throw new Error(`Native host exited before receipt: ${JSON.stringify(x)}`); }), timeout]);
    exit = await Promise.race([settled, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
  evidence.child = exit;
  evidence.receivedNativeEvents = await readFile(path.join(root, "system-preflight-1.receive.jsonl"), "utf8")
    .then(value => value.trim().split("\n").filter(Boolean).length, () => 0);
  evidence.completed = true;
} catch (error) {
  evidence.completed = false;
  evidence.failure = error instanceof Error ? error.message.replaceAll(root, "[isolated workspace]") : "unknown";
  evidence.overallHostDeadlineReached = evidence.failure.includes("90-second native host bound");
} finally {
  if (child && child.exitCode === null) child.kill(); // Only our owned test host, never external SSH.
  if (child && evidence.child === null) {
    await new Promise(resolve => {
      if (child.exitCode !== null) resolve();
      else { child.once("exit", resolve); setTimeout(resolve, 2000).unref(); }
    });
  }
  await vite?.close();
  server?.closeAllConnections();
  if (server) await new Promise(resolve => server.close(resolve));
  const native = await readFile(path.join(root, "system-preflight-1.receive.jsonl"), "utf8")
    .then(value => value.trim().split("\n").filter(Boolean).map(line => JSON.parse(line)), () => []);
  evidence.receivedNativeEvents = native.length;
  const sanitized = native.map(snapshot => ({
    boundary: snapshot.boundary === "reqwest-http-body-delivery" ? snapshot.boundary : "unknown",
    requestOrdinal: snapshot.requestId === "inference-1" ? 1 : null,
    droppedEvents: snapshot.droppedEvents,
    bodyChunks: snapshot.bodyChunks,
    bodyBytes: snapshot.bodyBytes,
    events: Array.isArray(snapshot.events) ? snapshot.events.map(item => ({
      kind: item.kind, at: item.at, elapsedUs: item.elapsedUs, bytes: item.bytes,
    })) : [],
  }));
  await writeFile(path.join(root, "redacted-native-summary.json"), JSON.stringify(sanitized, null, 2), { flag: "wx" });
  evidence.durableEventReceipts = await readFile(path.join(root, "redacted-preflight-events.jsonl"), "utf8")
    .then(value => value.trim().split("\n").filter(Boolean).length, () => 0);
  evidence.durableFinalReport = await stat(path.join(root, "redacted-final-report.json")).then(() => true, () => false);
  evidence.nativeTraceChars = trace.length;
  await writeFile(artifact, JSON.stringify(evidence, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ artifact, completed: evidence.completed, report: evidence.report, receivedNativeEvents: evidence.receivedNativeEvents, failure: evidence.failure }));
  if (!evidence.completed || !evidence.report?.ok) process.exitCode = 1;
}
