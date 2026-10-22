/** One-shot R5b native host; no ForgeBoard, config changes or model replay. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const repo = fileURLToPath(new URL("../", import.meta.url));
const root = path.join(repo, "src-tauri/target/r5b-native-one-shot-20261022");
const artifact = path.join(repo, "src-tauri/target/r5b-native-one-shot-20261022-result.json");
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
const saved = JSON.parse(savedBytes);
const ep = saved.selfHostedInference.endpoints.find(e => e.id === "real-qwen");
const profile = saved.selfHostedInference.profiles.find(p => p.endpointId === "real-qwen" && p.transportModelId === model);
assert(ep && !ep.ssh && !ep.credentialRef && new URL(ep.baseURL).href === endpoint);
assert.equal(profile?.modelRevision, digest);
assert.deepEqual(profile?.overrides, {});
// Exclusive file creates, and one-shot root. A failed run is never silently repeated.
await mkdir(root);
await mkdir(path.join(root, "data"));
await writeFile(path.join(root, "data/terax-settings.json"), savedBytes, { flag: "wx" });
const bin = path.join(repo, "src-tauri/target/codex-test/debug/examples/hardened_agent_acceptance.exe");
assert((await stat(bin)).size > 0, "Existing approved native acceptance host unavailable");
const evidence = { at: Date.now(), sourceSettingsSha256: createHash("sha256").update(savedBytes).digest("hex"), engineVersion: version.version, modelDigestMatches: true, endpointConfigurationRevision: ep.configurationRevision, requests: [], runner: "r5b-1", child: null };
let serverUrl = "";
const result = new Promise(resolve => { reportValue = resolve; });
server = createServer(async (request, response) => {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("content-type", "application/json");
  if (request.url?.startsWith("/configuration") && request.method === "GET") {
    response.end(JSON.stringify({ report: serverUrl + "/report", events: serverUrl + "/events", digest, model, endpoint }));
    return;
  }
  if (request.url === "/events" && request.method === "POST") {
    let text = "";
    for await (const chunk of request) {
      text += chunk;
      assert(text.length < 4096, "R5b redacted event too large");
    }
    const event = JSON.parse(text);
    assert(["preflight-decision", "request-started", "request-completed", "request-failed"].includes(event.kind));
    // Explicitly persist individual decisions as they occur, even when the
    // consumer never returns its final receipt. This did NOT exist in R5b-1.
    await appendFile(path.join(root, "redacted-preflight-events.jsonl"), `${JSON.stringify(event)}\n`);
    response.end('{"ok":true}');
    return;
  }
  if (request.url === "/report" && request.method === "POST") {
    let text = "";
    for await (const chunk of request) {
      text += chunk;
      assert(text.length < 32_000, "R5b redacted evidence too large");
    }
    reportValue(JSON.parse(text));
    response.end('{"ok":true}');
    return;
  }
  response.statusCode = 404; response.end('{"error":"unrecognized"}');
});
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  serverUrl = `http://127.0.0.1:${server.address().port}`;
  vite = await createViteServer({ root: repo, plugins: [{ name: "r5b-test-entry", configureServer(s) {
    s.middlewares.use("/coworking-acceptance.html", async (_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(await s.transformIndexHtml("/coworking-acceptance.html", '<html><body><div id="root"></div><script type="module" src="/src/test/r5bLivePreflightAcceptance.tsx"></script></body></html>'));
    });
  } }], server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, watch: null } });
  await vite.listen();
  const env = Object.fromEntries(["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "HOME", "LANG"].flatMap(k => process.env[k] ? [[k, process.env[k]]] : []));
  Object.assign(env, { APPDATA: path.join(root,"data"), LOCALAPPDATA: path.join(root,"data"), TEMP: root, TMP: root, CLACK_ACCEPTANCE_ROOT: root, CLACK_REAL_PRODUCT_PHASE: "system-preflight-1", CLACK_ACCEPTANCE_RECEIVE_TRACE: "1", CLACK_ACCEPTANCE_URL: `${vite.resolvedUrls.local[0]}coworking-acceptance.html?configuration=${encodeURIComponent(serverUrl + "/configuration")}` });
  child = spawn(bin, [], { cwd: root, env, windowsHide: true });
  child.stderr.on("data", chunk => { trace = (trace + chunk).slice(-12000); });
  child.stdout.on("data", chunk => { trace = (trace + chunk).slice(-12000); });
  const settled = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("R5b 90-second native host bound")), timerLimit));
  evidence.report = await Promise.race([result, settled.then(x => { throw new Error(`Native host exited before receipt: ${JSON.stringify(x)}`); }), timeout]);
  exit = await Promise.race([settled, timeout]);
  evidence.child = exit;
  evidence.receivedNativeEvents = await readFile(path.join(root, "system-preflight-1.receive.jsonl"), "utf8")
    .then(value => value.trim().split("\n").filter(Boolean).length, () => 0);
  evidence.completed = true;
} catch (error) {
  evidence.completed = false;
  evidence.failure = error instanceof Error ? error.message.replaceAll(root, "[isolated workspace]") : "unknown";
} finally {
  if (child && child.exitCode === null) child.kill(); // Only our owned test host, never external SSH.
  await vite?.close();
  server?.closeAllConnections();
  if (server) await new Promise(resolve => server.close(resolve));
  evidence.nativeTraceChars = trace.length;
  await writeFile(artifact, JSON.stringify(evidence, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ artifact, completed: evidence.completed, report: evidence.report, receivedNativeEvents: evidence.receivedNativeEvents, failure: evidence.failure }));
  if (!evidence.completed || !evidence.report?.ok) process.exitCode = 1;
}
