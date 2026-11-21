/** Exactly one controlled production-native, non-ForgeBoard compaction run.
 * Isolates app data and preserves every earlier campaign and operator file.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const repository = fileURLToPath(new URL("../", import.meta.url));
const runId = "controlled-compaction-live-20261114-01";
const owned = path.join(repository, "src-tauri/target/real-qwen-product", runId);
const endpoint = "http://127.0.0.1:11435";
const digest = "de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1";
const output = path.join(owned, "controlled-compaction-1");
let child, vite, server;
const begun = Date.now();
let nativeLog = "";
let reportValue = null;
const assertAbsent = async file => { try { await stat(file); throw new Error(`Existing evidence would be overwritten: ${file}`); }
  catch (error) { if (error.code !== "ENOENT") throw error; } };

async function run() {
  await assertAbsent(owned);
  const [v, m] = await Promise.all([
    fetch(`${endpoint}/api/version`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
    fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
  ]);
  assert.equal(v.version, "0.40.11", "Approved Ollama version changed");
  assert.equal(m.models.filter(item => item.name === "muse-glimmer:30b" && item.digest === digest).length, 1,
    "Approved model/digest not found on production Ollama");
  await mkdir(owned);
  await mkdir(path.join(owned, "data"));
  const build = spawnSync("cargo", ["build", "--example", "clack_prod_forgeboard_mission_20261114", "--locked", "--target-dir", "target/codex-test"],
    { cwd: path.join(repository, "src-tauri"), windowsHide: true, encoding: "utf8", timeout: 300_000 });
  assert.equal(build.status, 0, `Existing production acceptance-native host did not build: ${build.stderr?.slice(-1200) ?? build.error}`);
  vite = await createViteServer({ root: repository, plugins: [{ name: "clack-controlled-non-forgeboard-compaction", configureServer(s) {
    s.middlewares.use("/coworking-acceptance.html", async (_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(await s.transformIndexHtml("/coworking-acceptance.html",
        '<html><body><script type="module" src="/src/test/clackControlledCompactionLive20261114.ts"></script></body></html>'));
    });
  }}], server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, watch: null, forwardConsole: false } });
  await vite.listen();
  let reportResolve;
  const report = new Promise(resolve => { reportResolve = resolve; });
  server = createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "content-type");
    if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
    if (request.url === "/configuration" && request.method === "GET") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ report: `http://127.0.0.1:${server.address().port}/report`, mode: "non-forgeboard-compaction" }));
      return;
    }
    if (request.url !== "/report" || request.method !== "POST" || reportValue) {
      response.writeHead(404).end(); return;
    }
    try {
      const parts = [];
      for await (const chunk of request) { parts.push(chunk); if (parts.reduce((sum, b) => sum + b.length, 0) > 100_000) throw new Error("Receipt limit"); }
      const value = JSON.parse(Buffer.concat(parts).toString("utf8"));
      assert.equal(typeof value.ok, "boolean");
      assert(Array.isArray(value.observations) && value.observations.length <= 256);
      await writeFile(`${output}.native-report.json`, JSON.stringify({ ...value, receivedAt: Date.now() }, null, 2), { flag: "wx" });
      reportValue = value;
      response.setHeader("content-type", "application/json"); response.end('{"ok":true}');
      reportResolve(value);
    } catch (error) {
      response.writeHead(500).end();
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const cfg = `http://127.0.0.1:${server.address().port}/configuration`;
  const url = `${vite.resolvedUrls.local[0]}coworking-acceptance.html?configuration=${encodeURIComponent(cfg)}`;
  const env = Object.fromEntries(["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "HOME", "LANG"]
    .flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(env, { APPDATA: path.join(owned, "data"), LOCALAPPDATA: path.join(owned, "data"),
    TEMP: owned, TMP: owned, CLACK_ACCEPTANCE_ROOT: owned, CLACK_REAL_PRODUCT_PHASE: "controlled-compaction-1",
    CLACK_ACCEPTANCE_MODEL: "muse-glimmer:30b", CLACK_ACCEPTANCE_OLLAMA_URL: `${endpoint}/api/chat`,
    CLACK_ACCEPTANCE_URL: url, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--disable-gpu --disable-gpu-compositing" });
  const executable = path.join(repository, "src-tauri/target/codex-test/debug/examples/clack_prod_forgeboard_mission_20261114.exe");
  child = spawn(executable, [], { cwd: owned, env, windowsHide: true });
  child.stdout.on("data", data => { nativeLog = (nativeLog + data.toString()).slice(-100_000); });
  child.stderr.on("data", data => { nativeLog = (nativeLog + data.toString()).slice(-100_000); });
  console.log(JSON.stringify({ event: "controlled-host-start", runId, pid: child.pid, at: Date.now(),
    fixture: "non-ForgeBoard", model: "muse-glimmer:30b" }));
  let timer;
  const value = await Promise.race([
    report,
    new Promise((_, reject) => child.once("exit", code => reject(new Error(`Native host exited before receipt: ${code}; ${nativeLog.slice(-250)}`)))),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Controlled live proof exceeded 8-minute bound")), 480_000); }),
  ]).finally(() => clearTimeout(timer));
  const wirePath = `${output}.requests.jsonl`;
  const rows = (await readFile(wirePath, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const extractionRows = rows.filter(item => item.numPredict === 1024);
  const continuationRows = rows.filter(item => item.numPredict === 128);
  const wirePass = extractionRows.length >= 2 && continuationRows.length === 1 &&
    rows.length === extractionRows.length + continuationRows.length &&
    rows.every(item => item.modelMatches === true && item.stream === false &&
      item.numCtx === 16384 && item.toolSchemas === 0 && item.agentBatch === "not-agent") &&
    value.sameConversationNativeContinued === true && value.continuationOutputTokens > 0;
  const redacted = { runId, startedAt: begun, finishedAt: Date.now(), reportOk: value.ok,
    approval: { version: v.version, model: "muse-glimmer:30b", digestMatches: true },
    nativeWirePass: wirePass, nativeRequests: rows.length, requestIds: rows.map(row => row.requestId),
    state: value.status, sourceCounts: value.calls?.map(call => call.sources),
    firstDeadlinePolicyMs: value.firstDeadlinePolicyMs, injectedAtMs: value.firstDeadlineInjectedAtMs,
    nativeMemory: value.after ?? null, existingToolResults: value.originalToolResults,
    originalHistoryIntact: value.originalHistoryIntact, sameConversationReprepared: value.sameConversationReprepared,
    sameConversationNativeContinued: value.sameConversationNativeContinued,
    continuationOutputTokens: value.continuationOutputTokens,
    failureCode: value.errorCode ?? null, failureMessage: value.errorMessage ?? null };
  await writeFile(`${output}.summary.json`, JSON.stringify(redacted, null, 2), { flag: "wx" });
  console.log(JSON.stringify(redacted));
  assert(value.ok === true && wirePass, "PRODUCTION_AGENT_COMPACTION_RECOVERY=FAIL; ForgeBoard remains prohibited");
  console.log("PRODUCTION_AGENT_COMPACTION_RECOVERY=PASS");
}

try { await run(); }
catch (error) { console.error(`PRODUCTION_AGENT_COMPACTION_RECOVERY=FAIL: ${error.message}`); process.exitCode = 1; }
finally {
  if (child && child.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    else child.kill();
  }
  await vite?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
