import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { appendFile, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const repo = fileURLToPath(new URL("../", import.meta.url));
const owned = path.join(repo, "src-tauri/target/glm47flash-tier-proof-20261025-02");
await mkdir(owned); // Exclusive; never retry a used root or clean older evidence.
assert.equal((await readdir(owned)).length, 0, "Diagnostic root must be unused");
const workspace = path.join(owned, "workspace");
const data = path.join(owned, "data");
await mkdir(workspace);
await mkdir(data);
const git = spawnSync("git", ["init", "--quiet", workspace], { windowsHide: true });
assert.equal(git.status, 0, "Read-only test workspace requires scoped Git metadata");
const seed = path.join(repo, "src-tauri/target/real-qwen-product/qwen-smoke-r5af-20261024-01/data/terax-settings.json");
const original = await readFile(seed);
assert.equal(createHash("sha256").update(original).digest("hex"),
  "2d39dcfdd946acc733ba77ac1c8e68a226aeb46f013e68902a71002bd54592bb");
await copyFile(seed, path.join(data, "terax-settings.json"));

const model = "glm-4.7-flash:q4_K_M";
const digest = "4475827791a269b02c8ec49b1c3bc1abb5846bacf3fae015b75d33986322d8f6";
const endpoint = "http://127.0.0.1:11435";
const version = await (await fetch(endpoint + "/api/version", { signal: AbortSignal.timeout(5000) })).json();
const tags = await (await fetch(endpoint + "/api/tags", { signal: AbortSignal.timeout(5000) })).json();
assert.equal(version.version, "0.40.11");
assert.equal(tags.models.find(m => m.name === model)?.digest, digest);
const initialTagCount = tags.models.length;
const phase = "stream-diagnostic-tier-02";
const timelinePath = path.join(owned, "timeline.jsonl");
const mark = async (stage, details={}) => {
  const row = { at: Date.now(), layer:"runner", stage, ...details };
  await appendFile(timelinePath, JSON.stringify(row) + "\n");
  if (!["webview-process-snapshot", "webview-process-change"].includes(stage))
    console.log(JSON.stringify(row));
};
await mark("preflight", {model, digest, version:version.version, modelCount:initialTagCount});
let done;
const report = new Promise(resolve => { done = resolve; });
const server = createServer(async (request, response) => {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "content-type");
  if (request.method === "OPTIONS") { response.statusCode = 204; response.end(); return; }
  if (request.url === "/configuration") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ root: workspace, report: "http://127.0.0.1:" + server.address().port + "/report",
      stage: "http://127.0.0.1:" + server.address().port + "/stage", model, digest }));
    return;
  }
  if (request.method === "POST" && request.url === "/stage") {
    let body = "";
    for await (const chunk of request) { body += chunk; assert(body.length < 8192); }
    const row = JSON.parse(body);
    await appendFile(timelinePath, JSON.stringify({layer:"webview", ...row}) + "\n");
    response.end('{"ok":true}');
    return;
  }
  if (request.method === "POST" && request.url === "/report") {
    let body = "";
    for await (const chunk of request) { body += chunk; assert(body.length < 32768); }
    const result = JSON.parse(body);
    await writeFile(path.join(owned, "browser-report.json"), JSON.stringify(result, null, 2), { flag: "wx" });
    response.setHeader("content-type", "application/json");
    response.end('{"ok":true}');
    done(result);
    return;
  }
  response.statusCode = 404; response.end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const config = "http://127.0.0.1:" + server.address().port + "/configuration";
let vite, child;
let monitor, nativeOutput = "", hostExit = null, outcome = null, blocked = null;
try {
  await mark("rust-build-start");
  const compiled = spawnSync("cargo", ["build", "--locked", "--example", "r5av_acceptance",
    "--target-dir", "target/codex-test"], { cwd: path.join(repo, "src-tauri"),
    windowsHide: true, encoding: "utf8", timeout: 240_000 });
  assert.equal(compiled.status, 0, compiled.stderr?.slice(-1600));
  await mark("rust-build-end");
  vite = await createViteServer({
    root: repo,
    plugins: [{ name: "isolated-glm-tier-probe", configureServer(s) {
      s.middlewares.use("/coworking-acceptance.html", async (_req, res) => {
        res.setHeader("content-type", "text/html");
        res.end(await s.transformIndexHtml("/coworking-acceptance.html",
          '<html><body><script type="module" src="/src/test/glmTierProbeTraced.ts"></script></body></html>'));
      });
    }}],
    server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, watch: null },
  });
  await vite.listen();
  await mark("vite-listening");
  const env = Object.fromEntries(["PATH","PATHEXT","SystemRoot","WINDIR","COMSPEC","HOME","LANG"]
    .flatMap(k => process.env[k] ? [[k, process.env[k]]] : []));
  Object.assign(env, {
    APPDATA: data, LOCALAPPDATA: data, TEMP: owned, TMP: owned,
    CLACK_ACCEPTANCE_ROOT: owned, CLACK_REAL_PRODUCT_PHASE: phase,
    CLACK_ACCEPTANCE_RECEIVE_TRACE: "1",
    CLACK_ACCEPTANCE_MODEL: model, CLACK_ACCEPTANCE_OLLAMA_URL: endpoint + "/api/chat",
    CLACK_ACCEPTANCE_URL: vite.resolvedUrls.local[0] + "coworking-acceptance.html?configuration=" + encodeURIComponent(config),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--disable-gpu --disable-gpu-compositing",
  });
  child = spawn(path.join(repo, "src-tauri/target/codex-test/debug/examples/r5av_acceptance.exe"),
    [], { cwd: workspace, env, windowsHide: true, stdio:["ignore","pipe","pipe"] });
  child.stderr.on("data", bytes => {
    nativeOutput = (nativeOutput + bytes.toString()).slice(-12000);
    void appendFile(path.join(owned,"host-stderr.log"), bytes);
  });
  child.stdout.on("data", bytes => {void appendFile(path.join(owned,"host-stdout.log"), bytes);});
  child.on("exit", (code, signal) => { hostExit = {at:Date.now(), code, signal};
    void mark("host-exit", {pid:child.pid, ...hostExit}); });
  await mark("host-started", {pid:child.pid, softwareWebview:true});
  // Read-only OS process observation, never restarts or creates a WebView.
  let previouslySeen = new Set();
  const watch = () => {
    const scan = spawnSync("powershell.exe", ["-NoProfile", "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='msedgewebview2.exe'\" | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress"],
      {encoding:"utf8", windowsHide:true, timeout:6000});
    if (scan.status !== 0) return;
    try {
      const rows = scan.stdout.trim() ? JSON.parse(scan.stdout) : [];
      const processRows = Array.isArray(rows) ? rows : [rows];
      const descendants = new Set([child.pid]);
      for (let i=0;i<8;i++) for (const entry of processRows)
        if (descendants.has(entry.ParentProcessId)) descendants.add(entry.ProcessId);
      descendants.delete(child.pid);
      const now = new Set([...descendants]);
      const added = [...now].filter(pid => !previouslySeen.has(pid));
      const exited = [...previouslySeen].filter(pid => !now.has(pid));
      if (added.length || exited.length) void mark("webview-process-change", {added, exited, pids:[...now]});
      previouslySeen = now;
    } catch { /* observation never changes inference */ }
  };
  watch();
  monitor = setInterval(watch, 15000);
  outcome = await Promise.race([report,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Bounded probe 600s ceiling")), 600_000)),
    new Promise((_, reject) => child.once("exit", code => reject(new Error("Host exited " + code + " " + nativeOutput.slice(-1000))))),
  ]);
  await mark("browser-report-received", {result:outcome.result});
} catch (error) {
  blocked = {name:error?.name ?? "unknown", message:String(error?.message ?? error).slice(0,800)};
  await mark("diagnostic-blocked", blocked);
} finally {
  if (monitor) clearInterval(monitor);
  if (child?.exitCode === null) {
    await mark("host-stop-owned", {pid:child.pid});
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    if (child.exitCode === null) await new Promise(resolve => child.once("exit", resolve));
  }
  await vite?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  const wirePath = path.join(owned, `${phase}.requests.jsonl`);
  let requests = [];
  try { requests = (await readFile(wirePath, "utf8")).trim().split("\n").filter(Boolean).map(s => JSON.parse(s)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const evidence = { date: "2026-10-25", model, digest, version: version.version,
    outcome, blocked, hostExit, modelCount:initialTagCount, phase,
    outcome, wire: requests.map(r => ({ context: r.numCtx, output: r.numPredict, nativeSchemas: r.toolSchemas,
      names: r.toolNames, thinking: r.thinkKind, stream: r.stream })),
    tierProofRequest: requests.some(r => r.numCtx === 32768 && r.toolNames?.length === 1 &&
      r.toolNames[0] === "get_probe_value"),
    agentRequest: requests.find(r => r.numCtx === 32768 && r.toolNames?.includes("list_directory")) ?? null,
    requestCount: requests.length };
  await writeFile(path.join(owned, "final-evidence.json"), JSON.stringify(evidence, null, 2), { flag: "wx" });
  console.log(JSON.stringify({probe:"glm-tier-32k", outcome:outcome?.result ?? "blocked", tierProofRequest:evidence.tierProofRequest,
    agentContext:evidence.agentRequest?.numCtx ?? null,
    agentOutput:evidence.agentRequest?.numPredict ?? null, requestCount:requests.length,
    evidence:path.join(owned, "final-evidence.json") }));
}
if (blocked) process.exitCode = 1;
