import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import assert from "node:assert/strict";

const live = process.argv.includes("--live");
if (process.argv.slice(2).some(arg => arg !== "--live")) throw new Error("Only --live is supported");
const repository = fileURLToPath(new URL("../", import.meta.url));
const temp = await realpath(tmpdir());
const owned = await mkdtemp(path.join(temp, "clack-ollama-"));
const reports = path.join(repository, `src-tauri/target/ollama-${live ? "live" : "fake"}-report`);
await mkdir(reports, { recursive: true });
const traffic = [], metadata = [];
let endpoint, local, child, vite, loaded, nativeLog = "";
let reportResult;
const report = new Promise(resolve => { reportResult = resolve; });
const model = live ? "qwen38-uncensored:latest" : "fixture:latest";
const json = (response, value) => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(value)); };
const host = createServer(async (request, response) => {
  try {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "content-type");
    if (request.method === "OPTIONS") { response.statusCode = 204; response.end(); return; }
    console.log(`Ollama acceptance ${request.method} ${request.url}`);
    if (request.url.startsWith("/progress?")) return json(response, { ok: true });
    if (request.url === "/configuration") return json(response, { root: owned.replaceAll("\\", "/"), server: endpoint,
      report: `${local}/report`, phase: "exercise", ollama: { live, model } });
    if (request.url === "/report") {
      let bytes = ""; for await (const chunk of request) { bytes += chunk; if (bytes.length > 2 * 1024 * 1024) throw new Error("Report exceeds limit"); }
      reportResult(JSON.parse(bytes)); return json(response, { ok: true });
    }
    assert.equal(live, false, "Live inference cannot be redirected to this fixture");
    if (request.url === "/mismatch") { loaded = 4096; return json(response, { ok: true }); }
    if (request.url === "/api/tags") { metadata.push("tags"); return json(response, { models: [{ name: model }] }); }
    if (request.url === "/api/ps") { metadata.push("ps"); return json(response, { models: loaded ? [{ name: model, context_length: loaded }] : [] }); }
    if (request.url === "/api/show") { metadata.push("show"); request.resume(); return json(response, { capabilities: ["completion", "tools", "thinking"], model_info: { "general.architecture": "fixture", "fixture.context_length": 262144 } }); }
    assert.equal(request.url, "/api/chat");
    let text = ""; for await (const chunk of request) { text += chunk; if (text.length > 1024 * 1024) throw new Error("Request exceeds limit"); }
    const body = JSON.parse(text); traffic.push(body); assert(traffic.length <= 8);
    assert.equal(body.model, model); assert.equal(body.options.num_ctx, 32768); assert(body.options.num_predict > 0); assert.equal(body.think, false);
    loaded = body.options.num_ctx;
    const message = body.tools?.length && !body.messages.some(m => m.role === "tool")
      ? { role: "assistant", content: "", tool_calls: [{ function: { name: "clack_echo", arguments: { value: "clack-echo-7" } } }] }
      : { role: "assistant", content: body.tools?.length ? "Echoed clack-echo-7" : body.stream ? "CLACK_OLLAMA_32K_OK" : '{"ok":true}' };
    const final = { model, message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 30, eval_count: 12 };
    if (!body.stream) return json(response, { ...final, message });
    response.setHeader("content-type", "application/x-ndjson");
    response.write(JSON.stringify({ model, message, done: false }) + "\n");
    response.end(JSON.stringify(final) + "\n");
  } catch (error) { response.statusCode = 400; json(response, { error: String(error) }); }
});
await new Promise(resolve => host.listen(0, "127.0.0.1", resolve));
local = `http://127.0.0.1:${host.address().port}`;
endpoint = live ? "http://127.0.0.1:11435" : local;
let initialModels;
try {
  if (live) {
    const ps = await fetch(`${endpoint}/api/ps`, { signal: AbortSignal.timeout(5000) }); assert(ps.ok);
    initialModels = await ps.json();
    assert(!initialModels.models.some(m => m.name === model), "Selected model already in use; cold acceptance will not disturb it");
  }
  const build = spawnSync("cargo", ["build", "--example", "coworking_acceptance", "--locked", "--target-dir", "target/codex-test"], { cwd: path.join(repository, "src-tauri"), encoding: "utf8", windowsHide: true, timeout: 300000 });
  if (build.status) throw new Error(build.stderr || build.error?.message);
  vite = await createViteServer({ root: repository, server: { host: "127.0.0.1", port: 1439, strictPort: true, hmr: false, watch: null, forwardConsole: false } });
  await vite.listen();
  const viteURL = vite.resolvedUrls.local[0];
  console.log(`Native fixture URL ${viteURL}`);
  const data = path.join(owned, "data"); await mkdir(data);
  const env = Object.fromEntries(["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "HOME", "LANG", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(env, { APPDATA: data, LOCALAPPDATA: data, XDG_DATA_HOME: data, XDG_CONFIG_HOME: data, TEMP: owned, TMP: owned, TMPDIR: owned,
    CLACK_ACCEPTANCE_OLLAMA_URL: `${endpoint}/api/chat`,
    CLACK_ACCEPTANCE_ROOT: owned, CLACK_ACCEPTANCE_URL: `${viteURL}coworking-acceptance.html?configuration=${encodeURIComponent(`${local}/configuration`)}` });
  child = spawn(path.join(repository, "src-tauri/target/codex-test/debug/examples", `coworking_acceptance${process.platform === "win32" ? ".exe" : ""}`), [], { cwd: owned, env, windowsHide: true });
  child.stdout.on("data", b => { nativeLog = (nativeLog + b).slice(-64000); }); child.stderr.on("data", b => { nativeLog = (nativeLog + b).slice(-64000); });
  let timer;
  const result = await Promise.race([report, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Ollama acceptance timeout: ${nativeLog}`)), 300000); }),
    new Promise((_, reject) => child.once("exit", code => reject(new Error(`Native host exited ${code}: ${nativeLog}`))))]).finally(() => clearTimeout(timer));
  const destinations = [...nativeLog.matchAll(/CLACK_ACCEPTANCE_INFERENCE ("[^"\r\n]+")/g)].map(match => JSON.parse(match[1]));
  assert.equal(destinations.length, 4, "All four production native inference destinations must be audited");
  assert(destinations.every(url => url === `${endpoint}/api/chat`));
  await writeFile(path.join(reports, "result.json"), JSON.stringify({ ...result, traffic, metadata, destinations, nativeLog, initialModels,
    cleanup: live ? "Server-default keep-alive retained; no unload sent because concurrent use cannot be independently excluded" : "Owned fixture removed" }, null, 2));
  assert(result.ok, JSON.stringify(result));
  assert.equal(result.loaded, "32,768 tokens (loaded)"); assert.equal(result.cloudInference, 0);
  console.log(`PASS ${live ? "LIVE" : "FAKE"}: production native Clack Agent at 32768; ${result.normalAgent.deltas} text deltas; exact tool executed ${result.tool.executed} time(s), ${result.tool.steps} steps; think=${result.reasoning}; cloud=0.`);
} catch (error) {
  await writeFile(path.join(reports, "failure.json"), JSON.stringify({ error: String(error), metadata, traffic, nativeLog }, null, 2));
  throw error;
} finally {
  if (child && child.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    else child.kill();
    if (child.exitCode === null) await new Promise(resolve => child.once("exit", resolve));
  }
  await vite?.close(); host.closeAllConnections(); await new Promise(resolve => host.close(resolve));
  const resolved = await realpath(owned);
  assert(resolved.startsWith(temp + path.sep) && path.basename(resolved).startsWith("clack-ollama-"));
  await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
