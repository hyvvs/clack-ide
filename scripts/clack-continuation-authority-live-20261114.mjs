/** One isolated non-ForgeBoard native Clack Agent continuation verification.
 * All evidence is metadata-only; the new run root must not previously exist.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const repository = fileURLToPath(new URL("../", import.meta.url));
const runId = "controlled-continuation-authority-20261114-01";
const root = path.join(repository, "src-tauri/target/real-qwen-product", runId);
const endpoint = "http://127.0.0.1:11435";
const model = "muse-glimmer:30b";
const digest = "de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1";
let vite, web, child, received = null;
let nativeLog = "";
const startedAt = Date.now();
const maxRunMs = 600_000;
const notExisting = async target => {
  try { await stat(target); throw new Error(`Protected run path already exists: ${target}`); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
};

async function main() {
  await notExisting(root);
  const [version, tags] = await Promise.all([
    fetch(`${endpoint}/api/version`, { signal: AbortSignal.timeout(8_000) }).then(r => r.json()),
    fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(8_000) }).then(r => r.json()),
  ]);
  assert.equal(version.version, "0.40.11", "Production Ollama version changed");
  assert.equal(tags.models.filter(x => x.name === model && x.digest === digest).length, 1,
    "The approved native model/digest is unavailable");
  await mkdir(root);
  const data = path.join(root, "data");
  const workspace = path.join(root, "workspace");
  await mkdir(data);
  await mkdir(workspace);
  // Small isolated real files for genuine native tool calls; never touch /clack source.
  const fileNames = ["one.ts", "two.ts", "three.ts", "four.ts", "five.ts"];
  for (const [index, name] of fileNames.entries()) {
    const content = `// Native workspace verification file ${index + 1}.\n` +
      Array.from({ length: 800 }, (_, j) => `export const v_${index}_${j} = ${index * 800 + j}; // retained source observation\n`).join("");
    await writeFile(path.join(workspace, name), content, { flag: "wx" });
  }
  vite = await createViteServer({ root: repository, plugins: [{ name: "clack-continuation-authority-sole-entry", configureServer(server) {
    server.middlewares.use("/coworking-acceptance.html", async (_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(await server.transformIndexHtml("/coworking-acceptance.html",
        '<html><body><div id="root"></div><script type="module" src="/src/test/clackContinuationAuthorityLive20261114.tsx"></script></body></html>'));
    });
  }}], server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, watch: null, forwardConsole: false } });
  await vite.listen();
  let resolveReport;
  const report = new Promise(resolve => { resolveReport = resolve; });
  web = createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "content-type");
    if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
    if (request.url === "/configuration" && request.method === "GET") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ mode: "single-real-agent-recovery", runId,
        workspace, server: endpoint, model, digest,
        report: `http://127.0.0.1:${web.address().port}/report` }));
      return;
    }
    if (request.url !== "/report" || request.method !== "POST" || received) { response.writeHead(404).end(); return; }
    try {
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 100_000) throw Error("Evidence cap exceeded"); chunks.push(chunk); }
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.equal(typeof value.ok, "boolean");
      assert(Array.isArray(value.observations) && value.observations.length <= 300);
      assert.equal(value.runId, runId);
      received = value;
      await writeFile(path.join(root, "continuation.report.json"), JSON.stringify({ ...value, receivedAt: Date.now() }, null, 2), { flag: "wx" });
      response.setHeader("content-type", "application/json"); response.end('{"ok":true}');
      resolveReport(value);
    } catch { response.writeHead(500).end(); }
  });
  await new Promise(resolve => web.listen(0, "127.0.0.1", resolve));
  const configuration = `http://127.0.0.1:${web.address().port}/configuration`;
  const url = `${vite.resolvedUrls.local[0]}coworking-acceptance.html?configuration=${encodeURIComponent(configuration)}`;
  const env = Object.fromEntries(["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "HOME", "LANG"]
    .flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(env, { APPDATA: data, LOCALAPPDATA: data, TEMP: root, TMP: root,
    CLACK_ACCEPTANCE_ROOT: root, CLACK_ACCEPTANCE_OLLAMA_URL: `${endpoint}/api/chat`,
    CLACK_ACCEPTANCE_URL: url, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--disable-gpu --disable-gpu-compositing" });
  const exe = path.join(repository, "src-tauri/target/codex-test/debug/examples/clack_continuation_reliability_20261114.exe");
  await stat(exe);
  child = spawn(exe, [], { cwd: root, env, windowsHide: true });
  child.stdout.on("data", data => { nativeLog = (nativeLog + data.toString()).slice(-30_000); });
  child.stderr.on("data", data => { nativeLog = (nativeLog + data.toString()).slice(-30_000); });
  console.log(JSON.stringify({ event: "isolated-controlled-host-start", runId, pid: child.pid, startedAt }));
  let timer;
  const value = await Promise.race([
    report,
    new Promise((_, reject) => child.once("exit", code => reject(new Error(`Native host exited before report (code ${code}): ${nativeLog.slice(-500)}`)))),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Single controlled Agent lifecycle exceeded its 10-minute bound")), maxRunMs); }),
  ]).finally(() => clearTimeout(timer));
  const wire = path.join(root, "continuation.requests.jsonl");
  const rows = (await readFile(wire, "utf8").catch(() => "")).split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const summary = {
    runId, commit: "3543737270a00040a34b4f6a84a344c0f1c99a4a", startedAt,
    finishedAt: Date.now(), route: { version: version.version, model, digestMatches: true },
    nativeRequestCount: rows.length, nativeRequests: rows,
    result: value,
  };
  await writeFile(path.join(root, "continuation.summary.json"), JSON.stringify(summary, null, 2), { flag: "wx" });
  const resumedCoding = rows.some(x => x.numCtx === 32768 && x.stream === true && x.toolSchemas > 0 &&
    value.recoveryCheckpointAt && x.at > value.recoveryCheckpointAt);
  if (!value.ok || !resumedCoding) throw new Error(`Controlled lifecycle did not satisfy strict success gates: ${value.phase} / ${value.errorCode ?? "unknown"}`);
  console.log(JSON.stringify({ runId, ok: true, nativeRequestCount: rows.length,
    recoveryPhase: value.recoveryPhase, renewed: value.renewed, continued: resumedCoding }));
  console.log("PRODUCTION_LONG_HORIZON_CONTINUATION_AUTHORITY=PASS");
}

try { await main(); }
catch (error) { console.error(`PRODUCTION_LONG_HORIZON_CONTINUATION_AUTHORITY=FAIL: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
finally {
  if (child && child.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    else child.kill();
  }
  await vite?.close();
  if (web) { web.closeAllConnections(); await new Promise(resolve => web.close(resolve)); }
}
