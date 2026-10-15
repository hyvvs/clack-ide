import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import assert from "node:assert/strict";
import { createLocalAgentProtocol } from "./local-agent-protocol.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
const smallTeam = process.argv.includes("--small-team");
const localAgent = process.argv.includes("--local-agent");
if (smallTeam && localAgent || process.argv.slice(2).some(argument => !["--small-team", "--local-agent"].includes(argument))) throw new Error("Unknown native acceptance scope");
const localProtocol = createLocalAgentProtocol();
const temporaryRoot = await realpath(tmpdir());
const owned = await mkdtemp(path.join(temporaryRoot, "clack-coworking-"));
const workspace = path.join(owned, "workspace");
const reports = process.env.CLACK_ACCEPTANCE_REPORT_DIR || path.join(repository, `src-tauri/target/${localAgent ? "local-agent" : "coworking"}-report`);
await mkdir(workspace);
await mkdir(reports, { recursive: true });
const git = (...args) => {
  const result = spawnSync("git", ["-c", "core.autocrlf=false", ...args], { cwd: workspace, encoding: "utf8", windowsHide: true });
  if (result.status) throw new Error(result.stderr);
  return result.stdout;
};
git("init", "-q");
git("config", "user.name", "Clack acceptance");
git("config", "user.email", "acceptance@invalid.local");
git("config", "commit.gpgsign", "false");
git("config", "core.hooksPath", path.join(workspace, ".git/hooks"));
await writeFile(path.join(workspace, "config.json"), '{"timeoutMs":750,"allowRemote":false}\n');
await writeFile(path.join(workspace, "README.md"), "# Controlled coding fixture\nOld requirement: 900ms. Corrected current requirement: exactly 750ms. Never allow remote access.\n");
await writeFile(path.join(workspace, "architecture.md"), "Configuration owns timeout. Source must use config.timeoutMs and never enable remote access.\n");
await mkdir(path.join(workspace, "src"));
await mkdir(path.join(workspace, "tests"));
await mkdir(path.join(workspace, "logs"));
if (localAgent) {
  await writeFile(path.join(workspace, "src/public-api.ts"), "export const port = 1420;\n");
  for (const size of [8192, 16384, 32768, 131072])
    await writeFile(path.join(workspace, `src/local-${size}.js`), "export const timeoutMs = 900;\n");
}
await writeFile(path.join(workspace, "logs/huge.txt"), Array.from({ length: 60000 }, (_, index) => `Observation ${index}: timeoutMs=750, allowRemote=false`).join("\n"));
await writeFile(path.join(workspace, "src/timeout.js"), "export const timeoutMs = 900;\n");
await writeFile(path.join(workspace, "src/small-timeout.js"), "export const timeoutMs = 900;\n");
await writeFile(path.join(workspace, "tests/timeout.test.js"), "import assert from 'node:assert/strict';\nimport { timeoutMs } from '../src/timeout.js';\nassert.equal(timeoutMs, 750);\n");
git("add", ".");
git("commit", "-qm", "controlled acceptance base");
const traffic = [];
const metadataRequests = [];
const protocolErrors = [];
let inFlight = 0, maximum = 0, capacity = 1, child, vite, nativeLog = "", viteLog = "";
const capacityPeaks = { 1: 0, 2: 0 };
let resolveReport;
let reportPromise = new Promise(resolve => { resolveReport = resolve; });
let phase = "exercise";
const json = (response, value, status = 200) => {
  response.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" });
  response.end(JSON.stringify(value));
};
let api;
let parallelReleased = false;
let releaseParallel;
const parallelBarrier = new Promise(resolve => { releaseParallel = resolve; });
let releaseTwo;
const twoBarrier = new Promise(resolve => { releaseTwo = resolve; });
const failedTasks = new Map();
const server = createServer(async (request, response) => {
  try {
    if (request.url?.startsWith("/v1/") && request.url !== "/v1/chat/completions") metadataRequests.push({ method: request.method, path: request.url });
    if (request.method === "OPTIONS") return json(response, {});
    if (request.url === "/configuration") return json(response, { root: workspace.replaceAll("\\", "/"), server: `${api}/v1`, report: `${api}/report`, phase, smallTeam, localAgent });
    let raw = "";
    for await (const chunk of request) { raw += chunk; if (raw.length > (request.url === "/report" ? 16 : 4) * 1024 * 1024) throw new Error("Fixture request exceeds bound"); }
    if (request.url === "/report") { resolveReport(JSON.parse(raw)); return json(response, { ok: true }); }
    if (request.url === "/finish-local-history" && localAgent) { localProtocol.finishLongHistory(); return json(response, { ok: true }); }
    if (request.url === "/release-parallel") { parallelReleased = true; releaseParallel(); return json(response, { ok: true }); }
    if (request.url === "/capacity-two") { capacity = 2; return json(response, { ok: true }); }
    if (request.url === "/release-two") { releaseTwo(); return json(response, { ok: true }); }
    if (request.url === "/v1/models") return json(response, { data: [4096, 8192, 16384, 32768, 131072].map(capacity => ({ id: `fixture-${capacity}`, context_length: capacity })) });
    if (request.url !== "/v1/chat/completions") return json(response, { error: "controlled metadata path unavailable" }, 404);
    const body = JSON.parse(raw);
    console.log(`Owned local request ${traffic.length + 1}: ${body.model}, ${body.messages.length} messages, ${body.tools?.length || 0} tools`);
    traffic.push({ destination: "owned-loopback-inference", path: request.url, capacity, body });
    inFlight++;
    maximum = Math.max(maximum, inFlight);
    capacityPeaks[capacity] = Math.max(capacityPeaks[capacity], inFlight);
    response.on("close", () => { inFlight--; });
    if (!body.stream) {
      const source = JSON.parse(body.messages.at(-1).content);
      const claims = source.sources.map(item => {
        const passage = item.passages.at(-1);
        const quote = passage.match(/READ_BOUND_\d+|PARALLEL_\d+|\b750\b/)?.[0] ?? passage.slice(0, 32);
        return { source: item.id, section: "completed-work", text: quote, quote, status: "inference", contradicts: [] };
      });
      return json(response, { id: `extract-${traffic.length}`, object: "chat.completion", created: 1, model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ claims }) }, finish_reason: "stop" }],
      });
    }
    if (localAgent) {
      const delta = localProtocol.respond(body, traffic.length);
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = (value, finish_reason = null) => `data: ${JSON.stringify({ id: `local-${traffic.length}`, object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: value, finish_reason }] })}\n\n`;
      response.end(chunk(delta) + chunk({}, delta.tool_calls ? "tool_calls" : "stop") + "data: [DONE]\n\n");
      return;
    }
    const last = body.messages.at(-1);
    const messageText = message => typeof message.content === "string" ? message.content
      : Array.isArray(message.content) ? message.content.filter(part => part.type === "text").map(part => part.text).join("\n") : "";
    let latestUserIndex = body.messages.findLastIndex(message => message.role === "user" && /MISSION_CONFIG=|MISSION_AGGREGATE=|<peer-handoff>|"type":"task-communication"/.test(messageText(message)));
    if (latestUserIndex < 0) latestUserIndex = body.messages.findLastIndex(message => message.role === "user");
    const instruction = body.messages[latestUserIndex] ? messageText(body.messages[latestUserIndex]) : "";
    const handoffLine = instruction.split("<peer-handoff>\n")[1]?.split("\n", 1)[0];
    const handoff = handoffLine ? JSON.parse(handoffLine) : null;
    const failure = instruction.match(/MIXED_FAIL_\d+/)?.[0];
    if (failure && handoff) {
      if (!failedTasks.has(failure)) failedTasks.set(failure, handoff.taskId);
      if (failedTasks.get(failure) === handoff.taskId) return json(response, { error: { message: "Controlled read-only server unavailable", type: "server_error" } }, 503);
    }
    if (instruction.includes("RESTART_HOLD")) { await new Promise(resolve => response.once("close", resolve)); return; }
    if (instruction.includes("CANCEL_HOLD")) {
      if (instruction.includes("CANCEL_HOLD_STREAM")) {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write(`data: ${JSON.stringify({ id: "partial-cancel", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: { content: "Observed partial output before explicit cancellation." }, finish_reason: null }] })}\n\n`);
      }
      await new Promise(resolve => response.once("close", resolve));
      return;
    }
    if (instruction.includes("CAPACITY_TWO")) {
      await Promise.race([twoBarrier, new Promise(resolve => response.once("close", resolve))]);
      if (response.destroyed) return;
    }
    if (instruction.includes("PARALLEL_") && !parallelReleased) {
      await Promise.race([parallelBarrier, new Promise(resolve => response.once("close", resolve))]);
      if (response.destroyed) return;
    }
    const steps = body.messages.slice(latestUserIndex + 1);
    const calls = steps.flatMap(message => message.tool_calls || []);
    const call = (name, args) => ({ tool_calls: [{ index: 0, id: `${name}-${traffic.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
    const toolData = steps.filter(message => message.role === "tool").flatMap(message => {
      try { return [JSON.parse(message.content)]; } catch { return []; }
    });
    const evidence = body.messages.flatMap(message => {
      if (typeof message.content !== "string" || !message.content.startsWith("Authorized project/task evidence (")) return [];
      try { return JSON.parse(message.content.slice(message.content.indexOf("\n") + 1)).chunks || []; } catch { return []; }
    });
    const currentConfig = () => {
      const observed = toolData.find(item => item.path?.endsWith("config.json") && item.content)?.content
        ?? evidence.find(item => item.kind === "file" && item.source.path === "config.json" && item.freshness === "current-file-observation")?.text;
      return observed ? JSON.parse(observed) : null;
    };
    const reviewRequest = () => {
      if (!currentConfig()) return body.tools.some(candidate => candidate.function.name === "read_file")
        ? call("read_file", { path: "config.json", offset: 0, limit: 5 })
        : call("request_conversation_evidence", { query: "Read current configuration", anchor: "file:config.json", expand: false });
      const dependency = handoff.evidence.find(item => item.source.artifacts?.length);
      if (!dependency) throw new Error("Review artifact provenance missing");
      if (!evidence.some(item => item.kind === "artifact" && item.source.taskId === dependency.source.taskId))
        return call("request_conversation_evidence", { query: "Read immutable patch", anchor: `artifact:${dependency.source.taskId}:${dependency.source.artifacts[0].artifactId}`, expand: false });
      return null;
    };
    let delta = last.role === "tool"
      ? { content: `Verified local config timeout: ${body.messages.filter(message => message.role === "tool").map(message => message.content).join("\n").includes("750") ? "750" : "MISSING EVIDENCE"}.` }
      : { tool_calls: [{ index: 0, id: `read-${traffic.length}`, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "config.json", offset: 0, limit: 5 }) } }] };
    const communication = instruction.split("\n").map(line => { try { return JSON.parse(line); } catch { return null; } }).find(item => item?.type === "task-communication");
    if (instruction.includes("UNSAFE_WRITE")) {
      if (!calls.length) delta = call("read_file", { path: "config.json", offset: 0, limit: 5 });
      else if (calls.length === 1) delta = call("write_file", { path: "src/unsafe.json", content: '{"timeoutMs":750,"allowRemote":false}\n' });
      else return json(response, { error: { message: "Controlled terminal failure after acknowledged staged write", type: "invalid_request_error" } }, 400);
    } else if (instruction.includes("LARGE_READ")) {
      if (!calls.length) delta = call("read_file", { path: "logs/huge.txt", offset: 40000, limit: 2 });
      else {
        const observed = toolData.find(item => item.path?.endsWith("logs/huge.txt"));
        if (!observed?.truncated || observed.content.length > 1024 || !observed.content.includes("Observation 40000") || observed.total_lines !== 60000) throw new Error("Large read did not return the real bounded requested window");
        delta = { content: `Verified bounded original file window: ${observed.content}` };
      }
    } else if (body.model === "fixture-4096" && /\bHello\b/.test(instruction)) {
      delta = { content: "Hello. Bounded 4k response observed." };
    } else if (instruction.includes("SMALL_VERIFY")) {
      const producer = evidence.find(item => item.kind === "task-result" && item.required);
      if (!producer) throw new Error("Small recipient lacks actual producer evidence");
      delta = { content: `Historical Researcher finding, not a current file observation: ${producer.text}` };
    } else if (communication) {
      delta = communication.kind === "clarification-request"
        ? { content: "Read config.json and verify exactly timeoutMs=750 with allowRemote=false. The old 900ms value is superseded." }
        : calls.length ? { content: "Verified clarified current configuration: timeoutMs=750, allowRemote=false." } : call("read_file", { path: "config.json", offset: 0, limit: 5 });
    } else if (instruction.includes("MIXED_CLARIFY_")) {
      delta = call("communicate_peer_task", { taskId: handoff.taskId, kind: "clarification-request", text: "Which corrected timeout requirement applies?", evidence: [] });
    } else if (instruction.includes("MIXED_EDIT_")) {
      const index = instruction.match(/MIXED_EDIT_(\d+)/)[1];
      if (!calls.length) delta = call("read_file", { path: "config.json", offset: 0, limit: 5 });
      else if (calls.length === 1) {
        const configuration = JSON.parse(toolData.find(item => item.path?.endsWith("config.json"))?.content || "{}");
        if (configuration.timeoutMs !== 750 || configuration.allowRemote !== false) throw new Error("Mixed editor lacks current config evidence");
        delta = call("write_file", { path: `src/generated-${index}.json`, content: `${JSON.stringify(configuration)}\n` });
      } else delta = { content: `Coder: generated-${index}.json staged; successful write observed ${toolData.at(-1)?.ok === true}.` };
    } else if (instruction.includes("MIXED_REVIEW_")) {
      const needed = reviewRequest();
      if (needed) delta = needed;
      else {
        const patch = evidence.filter(item => item.kind === "artifact").map(item => item.text).join("\n");
        const proposed = JSON.parse(patch.match(/^\+(\{.*\})$/m)?.[1] || "{}");
        if (proposed.timeoutMs !== 750 || proposed.allowRemote !== false) throw new Error("Mixed reviewer found incorrect actual patch");
        delta = { content: "Reviewer: verified immutable JSON patch preserves timeoutMs=750, allowRemote=false." };
      }
    } else if (instruction.includes("MISSION_CONFIG=")) {
      const configuration = JSON.parse(instruction.slice(instruction.indexOf("MISSION_CONFIG=") + "MISSION_CONFIG=".length));
      delta = calls.length ? { content: `Architect: dispatched ${configuration.targetSessionId}; durable task ${toolData.at(-1)?.taskId || "missing"}.` } : call("request_peer_task", configuration);
    } else if (instruction.includes("MISSION_CODER_") || instruction.includes("SMALL_CODE")) {
      const sourcePath = instruction.includes("SMALL_CODE") ? "src/small-timeout.js" : "src/timeout.js";
      const configuration = toolData.find(item => item.path?.endsWith("config.json") && item.content);
      if (!calls.length) delta = call("read_file", { path: "config.json", offset: 0, limit: 5 });
      else if (calls.length === 1) delta = call("read_file", { path: sourcePath, offset: 0, limit: 10 });
      else if (calls.length === 2) {
        if (!configuration) throw new Error("Coding configuration evidence missing");
        const current = JSON.parse(configuration.content);
        const timeout = instruction.includes("MISSION_CODER_INITIAL") ? current.timeoutMs + 50 : current.timeoutMs;
        const source = toolData.find(item => item.path?.endsWith(sourcePath) && item.content);
        if (!source) throw new Error("Coding source evidence missing");
        delta = call("edit", { path: sourcePath, old_string: source.content.trim(), new_string: `export const timeoutMs = ${timeout};` });
      } else delta = { content: `Coder: ${toolData.at(-1)?.error ? "write failed" : "staged src/timeout.js for immutable patch review"}.` };
    } else if (instruction.includes("MISSION_REVIEW_") || instruction.includes("SMALL_REVIEW_CODE")) {
      const needed = reviewRequest();
      if (needed) delta = needed;
      else {
        const patch = evidence.filter(item => item.kind === "artifact").map(item => item.text).join("\n");
        const proposed = Number(patch.match(/\+export const timeoutMs = (\d+);/)?.[1]);
        const current = currentConfig()?.timeoutMs;
        if (!proposed || !current) throw new Error("Reviewer lacks actual immutable patch/config evidence");
        delta = { content: proposed === current ? `Reviewer: verified staged timeout ${proposed} equals current config ${current}.` : `Reviewer: MUST correct src/timeout.js: patch exports ${proposed}, current configuration requires ${current}.` };
      }
    } else if (instruction.includes("MISSION_AGGREGATE=")) {
      const taskId = instruction.slice(instruction.indexOf("MISSION_AGGREGATE=") + "MISSION_AGGREGATE=".length).trim();
      delta = calls.length ? { content: `Architect: original task evidence reviewed. ${evidence.filter(item => item.kind === "task-result").map(item => item.text).join(" ")}` }
        : call("request_conversation_evidence", { query: "Read the final review result", anchor: `task:${taskId}`, expand: false });
    }
    for (const emitted of delta.tool_calls || []) if (!body.tools?.some(candidate => candidate.function.name === emitted.function.name))
      throw new Error(`Controlled model attempted unexposed tool ${emitted.function.name}`);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (value, finish_reason = null) => `data: ${JSON.stringify({ id: `fixture-${traffic.length}`, object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: value, finish_reason }] })}\n\n`;
    response.end(chunk(delta) + chunk({}, delta.tool_calls ? "tool_calls" : "stop") + "data: [DONE]\n\n");
  } catch (error) {
    protocolErrors.push(String(error));
    if (protocolErrors.length > 20) protocolErrors.shift();
    console.error("Controlled protocol assertion:", String(error));
    json(response, { error: String(error) }, 400);
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
api = `http://127.0.0.1:${server.address().port}`;
try {
  const build = spawnSync("cargo", ["build", "--example", "coworking_acceptance", "--locked", "--target-dir", "target/codex-test"], { cwd: path.join(repository, "src-tauri"), encoding: "utf8", windowsHide: true, timeout: 300000 });
  if (build.status) throw new Error(build.stderr || build.error?.message);
  vite = await createViteServer({ root: repository, server: { host: "127.0.0.1", port: 1438, strictPort: true, hmr: false, watch: null, forwardConsole: false } });
  await vite.listen();
  viteLog = JSON.stringify(vite.resolvedUrls);
  const data = path.join(owned, "data");
  await mkdir(data);
  const environment = Object.fromEntries(["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "HOME", "LANG", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(environment, { APPDATA: data, LOCALAPPDATA: data, XDG_DATA_HOME: data, XDG_CONFIG_HOME: data, TEMP: owned, TMP: owned, TMPDIR: owned,
    CLACK_ACCEPTANCE_ROOT: owned, CLACK_ACCEPTANCE_URL: `http://127.0.0.1:1438/coworking-acceptance.html?configuration=${encodeURIComponent(`${api}/configuration`)}` });
  const executable = path.join(repository, "src-tauri/target/codex-test/debug/examples", `coworking_acceptance${process.platform === "win32" ? ".exe" : ""}`);
  child = spawn(executable, [], { cwd: owned, env: environment, windowsHide: true });
  child.stdout.on("data", bytes => { nativeLog = (nativeLog + bytes).slice(-128 * 1024); });
  child.stderr.on("data", bytes => { nativeLog = (nativeLog + bytes).slice(-128 * 1024); });
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Composed native fixture timed out")), 600000); });
  const exited = new Promise((_, reject) => child.once("exit", code => reject(new Error(`Native host exited before report (${code}): ${nativeLog}`))));
  let result;
  try { result = await Promise.race([reportPromise, timeout, exited]); } finally { clearTimeout(timer); }
  const wireBudgets = [];
  if (localAgent && result.ok) {
    const { assertRequestBudget } = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts");
    for (const [index, request] of traffic.entries()) {
      const size = Number(request.body.model.split("-").at(-1));
      wireBudgets.push({ index: index + 1, stream: !!request.body.stream, model: request.body.model,
        ...assertRequestBudget({ asserted: size, outputReserve: size === 8192 ? 512 : 1024, maxOutput: size === 8192 ? 512 : 1024 }, request.body),
      });
    }
  }
  const effects = (result.conversations || []).flatMap(c => (c.messages || []).flatMap(m => m.parts || []).filter(p => p.type === "tool-write_file" && p.output?.clackWorkspaceWrite === true));
  const effectIds = effects.map(p => p.toolCallId);
  assert.equal(new Set(effectIds).size, effectIds.length, "Completed write identity replayed");
  await writeFile(path.join(reports, "result.json"), JSON.stringify({ ...result, writeEffectIds: effectIds, wireBudgets, metadataRequests, protocolMetrics: localProtocol.metrics, maximumInferenceConcurrency: maximum, capacityPeaks, inferenceRequests: traffic.length, traffic, nativeLog }, null, 2));
  if (!result.ok) throw new Error(`${result.error}\n${protocolErrors.join("\n")}\n${nativeLog}`);
  for (const request of traffic.filter(item => item.body.stream)) {
    const worker = JSON.stringify(request.body.messages).includes("<peer-handoff>");
    if (worker && JSON.stringify(request.body).includes("PRIVATE_PARENT_CANARY_7b32017")) throw new Error("Private parent context reached a worker, including a same-Agent worker");
  }
  for (const test of localAgent ? result.missions.filter(m => m.status === "completed").map(m => `tests/local-${m.size}.mjs`) : ["tests/timeout.test.js"]) {
    const verification = spawnSync(process.execPath, [test], { cwd: workspace, encoding: "utf8", windowsHide: true });
    if (verification.status) throw new Error(`Real applied-file verification failed: ${verification.stderr}`);
  }
  for (const [limit, peak] of Object.entries(capacityPeaks)) if (peak > Number(limit)) throw new Error(`Endpoint exceeded configured capacity ${limit}: ${peak}`);
  if (traffic.some(item => JSON.stringify(item.body).includes("CANCEL_HOLD_QUEUED"))) throw new Error("Cancelled queued task reached inference");
  if (child.exitCode == null) await new Promise(resolve => child.once("exit", resolve));
  if (!smallTeam) {
  phase = "restart";
  const sentBeforeRestart = traffic.length;
  reportPromise = new Promise(resolve => { resolveReport = resolve; });
  child = spawn(executable, [], { cwd: owned, env: environment, windowsHide: true });
  child.stdout.on("data", bytes => { nativeLog = (nativeLog + bytes).slice(-128 * 1024); });
  child.stderr.on("data", bytes => { nativeLog = (nativeLog + bytes).slice(-128 * 1024); });
  let restartTimer;
  const restartTimeout = new Promise((_, reject) => { restartTimer = setTimeout(() => reject(new Error("Native restart fixture timed out")), 60000); });
  let restarted;
  try { restarted = await Promise.race([reportPromise, restartTimeout]); } finally { clearTimeout(restartTimer); }
  if (!restarted.ok) throw new Error(restarted.error);
  await writeFile(path.join(reports, "restart.json"), JSON.stringify(restarted, null, 2));
  if (traffic.length !== sentBeforeRestart) throw new Error("Restart replayed inference");
  for (const before of result.tasks.filter(item => item.status === "completed")) {
    const after = restarted.tasks.find(item => item.id === before.id);
    assert.deepEqual(after, before, `Restart changed completed task ${before.id}`);
  }
  for (const before of result.conversations.filter(item => !result.tasks.some(task => task.targetSessionId === item.id && task.status === "running"))) {
    const after = restarted.conversations.find(item => item.id === before.id);
    assert.deepEqual(after?.messages, before.messages, `Restart changed original conversation ${before.id}`);
  }
  }
  console.log(`PASS: ${result.outcomes.length} composed scenarios; ${result.tasks.length} durable tasks; ${traffic.length} real native HTTP requests; maximum endpoint concurrency ${maximum}.`);
} catch (error) {
  await writeFile(path.join(reports, "failure.json"), JSON.stringify({ error: String(error), nativeLog, viteLog, traffic }, null, 2));
  throw error;
} finally {
  if (child && child.exitCode == null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    else child.kill();
    if (child.exitCode == null) await new Promise(resolve => child.once("exit", resolve));
  }
  await vite?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  const cleanupRoot = await realpath(owned);
  if (path.dirname(cleanupRoot).toLowerCase() !== temporaryRoot.toLowerCase() || !path.basename(cleanupRoot).startsWith("clack-coworking-")) throw new Error("Refusing cleanup outside the owned temporary fixture");
  await rm(cleanupRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
