/** One-shot deterministic evolving-prompt Muse/Ollama reliability checkpoint. No ForgeBoard. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { messagesForEvolving, scenarios } from "./muse-ollama-evolving-corpus-20261115.mjs";

const mode = process.argv[2];
assert(["preflight", "self-test", "run"].includes(mode), "Expected preflight, self-test or run");
const repo = fileURLToPath(new URL("../", import.meta.url));
const root = path.join(repo, "src-tauri", "target", "real-qwen-product", "muse-ollama-evolving-20261115-01");
const endpoint = "http://127.0.0.1:11435";
const model = "muse-glimmer:30b";
const digest = "de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1";
const expectedVersion = "0.40.11";
const names = ["read_file", "list_directory", "write_file", "create_directory", "edit", "grep", "glob",
  "bash_run", "bash_list", "open_preview", "todo_write", "read_agent_output",
  "request_peer_task", "cancel_peer_task", "propose_custom_tool"];
const maxRequests = 20;
const firstOutputLimitMs = 120000;
const streamIdleLimitMs = 180000;
const absoluteLimitMs = 540000; // Separate diagnostic cap; Clack's 120s/180s policies are unchanged.
const hash = value => createHash("sha256").update(value).digest("hex");
const clock = () => performance.now();

function logCategory(message) {
  if (/slot\s+operator\(\).*new prompt, n_ctx_slot\s*=/.test(message)) return "slot-prompt-admitted";
  if (/n_past\s*=|cached prompt|cache.*prefix|n_tokens_cached/i.test(message)) return "runtime-prefix-cache-hint";
  if (/slot\s+print_timing:.*prompt processing, n_tokens/.test(message)) return "slot-prefill-progress";
  if (/slot\s+print_timing:.*prompt eval time/.test(message)) return "slot-prefill-retrospective-summary";
  if (/slot\s+print_timing:.*\beval time/.test(message)) return "slot-generation-retrospective-summary";
  if (/sched_reserve:/.test(message)) return "scheduler-reservation";
  if (/llama_kv_cache|KV self size|creating non-SWA KV cache/i.test(message)) return "kv-cache-allocation";
  if (/offload|n_gpu_layers|offloaded/i.test(message)) return "gpu-offload";
  if (/Flash Attention enabled|flash_attn/i.test(message)) return "flash-attention";
  if (/starting llama server|runner started|loaded model|load_model|load all tensors/i.test(message)) return "runner-load-or-selection";
  if (/cancelled|canceled|aborting task/i.test(message)) return "runtime-cancellation";
  if (/\[GIN\].*POST\s+"\/api\/chat"/.test(message)) return "http-chat-handler-finished";
  return null;
}

function logNumbers(message) {
  const match = pattern => {
    const found = message.match(pattern);
    return found ? Number(found[1]) : null;
  };
  return {
    task: match(/\btask\s+(\d+)\b/),
    slot: match(/\bid\s+(\d+)\s*\|\s*task/),
    context: match(/n_ctx_slot\s*=\s*(\d+)/),
    promptTokens: match(/task\.n_tokens\s*=\s*(\d+)/),
    progressTokens: match(/prompt processing, n_tokens\s*=\s*(\d+)/),
    progress: match(/\bprogress\s*=\s*([\d.]+)/),
    prefillMs: match(/prompt eval time\s*=\s*([\d.]+)\s*ms/),
    decodeMs: match(/\beval time\s*=\s*([\d.]+)\s*ms/),
    memoryMiB: match(/\bsize\s*=\s*([\d.]+)\s*MiB/),
    cudaLayers: match(/\boffloaded\s+(\d+)\/\d+\s+layers/),
    pastTokensHint: match(/\bn_past\s*=\s*(\d+)/),
    cachedTokensHint: match(/\bn_tokens_cached\s*=\s*(\d+)/),
  };
}

function frameKind(frame) {
  const message = frame.message ?? {};
  const thinking = typeof message.thinking === "string" ? message.thinking.length : 0;
  const content = typeof message.content === "string" ? message.content.length : 0;
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls.length : 0;
  return { thinking, content, calls, done: frame.done === true };
}

if (mode === "self-test") {
  assert.equal(logCategory("slot   operator(): id  0 | task 599 | new prompt, n_ctx_slot = 32768, n_keep = 4, task.n_tokens = 10405"), "slot-prompt-admitted");
  assert.equal(logNumbers("slot   operator(): id  0 | task 599 | new prompt, n_ctx_slot = 32768, n_keep = 4, task.n_tokens = 10405").context, 32768);
  assert.equal(logCategory("slot print_timing: id  0 | task 599 | prompt processing, n_tokens = 7340, progress = 1.00"), "slot-prefill-progress");
  assert.equal(logCategory("slot print_timing: id  0 | task 599 | prompt eval time = 11290.96 ms / 7344 tokens"), "slot-prefill-retrospective-summary");
  assert.equal(logCategory("slot print_timing: id  0 | task 599 | eval time = 25329.94 ms / 234 tokens"), "slot-generation-retrospective-summary");
  assert.equal(frameKind({ message: { thinking: "start" }, done: false }).thinking, 5);
  assert.equal(frameKind({ message: { tool_calls: [{ function: { name: "list_directory" } }] }, done: false }).calls, 1);
  const a = messagesForEvolving(0, 8), b = messagesForEvolving(1, 8);
  assert.notEqual(hash(JSON.stringify(a)), hash(JSON.stringify(b)));
  assert(a.some(message => message.role === "tool") && a.some(message => message.content?.includes("src/board-filter")));
  console.log("MUSE_PHASE_SELF_TEST_PASS");
  process.exit(0);
}

async function metadata(route) {
  const response = await fetch(endpoint + route, { signal: AbortSignal.timeout(8000) });
  assert(response.ok, "Ollama metadata " + route + " failed: " + response.status);
  return response.json();
}

const [version, inventory] = await Promise.all([metadata("/api/version"), metadata("/api/tags")]);
assert.equal(version.version, expectedVersion, "Ollama version changed; no automatic profile substitution");
const matches = (inventory.models ?? []).filter(item => item.name === model);
assert.equal(matches.length, 1, "Exactly one accepted Muse model required");
assert.equal(matches[0].digest, digest, "Muse model digest changed");

const vite = await createServer({ ssr: { noExternal: ["@xterm/xterm"] },
  server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
let tools, measureRequest, resolveContextBudget;
try {
  const context = {
    getCwd: () => root, getWorkspaceRoot: () => root, getWorkspaceId: () => "evolving-checkpoint:" + root,
    getSessionId: () => "evolving-checkpoint-read-only", getAgentId: () => "builtin:coder",
    getTerminalContext: () => null, isActiveTerminalPrivate: () => false, injectIntoActivePty: () => false,
    openPreview: () => false, spawnAgent: () => null, readAgentOutput: () => null, readCache: new Map(),
  };
  const factories = [["fs", "buildFsTools"], ["edit", "buildEditTools"],
    ["search", "buildSearchTools"], ["shell", "buildShellTools"],
    ["subagent", "buildSubagentTools"], ["terminal", "buildTerminalTools"],
    ["todo", "buildTodoTools"], ["evidence", "buildEvidenceTools"],
    ["agent", "buildManagedAgentTools"], ["peer", "buildPeerTaskTools"],
    ["custom", "buildCustomToolProposals"]];
  const available = {};
  for (const [name, factory] of factories) {
    const module = await vite.ssrLoadModule("/src/modules/ai/tools/" + name + ".ts");
    Object.assign(available, module[factory](context));
  }
  assert(names.every(name => available[name]), "A current production native tool is missing");
  const preflight = await vite.ssrLoadModule("/src/modules/ai/lib/requestPreflight.ts");
  ({ measureRequest, resolveContextBudget } = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts"));
  tools = await preflight.serializedToolSchemas(Object.fromEntries(names.map(name => [name, available[name]])));
  assert.deepEqual(tools.map(schema => schema.function.name), names);
} finally {
  await vite.close();
}

// Complete 20-case fixed corpus in advance. Clack's conservative estimator is
// not the model tokenizer: actual native prompt_eval_count is reported afterward.
const targetConversationEstimates = [14500, 16900, 18800, 21500];
const bands = ["01-05", "06-10", "11-15", "16-20"];
const cases = [];
for (let index = 0; index < maxRequests; index++) {
  const bandIndex = Math.floor(index / 5);
  const target = targetConversationEstimates[bandIndex];
  let chosen = null;
  for (let n = 2; n <= 180; n++) {
    const messages = messagesForEvolving(index, n);
    const inputEstimate = measureRequest({ messages, tools });
    const budget = resolveContextBudget({ runtimeTarget: 32768, deployed: 32768,
      maxOutput: 4096, outputReserve: 4096 }, inputEstimate, 4096);
    if (budget.fits && inputEstimate.conversation <= target)
      chosen = { messages, inputEstimate, noteCount: n, budgetMargin: budget.margin };
    if (!budget.fits || inputEstimate.conversation > target) break;
  }
  assert(chosen && chosen.inputEstimate.conversation > 11000,
    "Cannot safely fit substantial distinct prompt " + (index + 1));
  const id = "muse-evolving-" + String(index + 1).padStart(2, "0");
  const inputSha256 = hash(JSON.stringify(chosen.messages));
  const wire = {model,stream:true,options:{num_ctx:32768,num_predict:4096},
    messages:chosen.messages,tools};
  assert(!("think" in wire) && !("keep_alive" in wire));
  cases.push({id,caseNumber:index + 1,band:bands[bandIndex],
    problem:scenarios[index][0],inputSha256,wire,...chosen});
}
assert.equal(cases.length,maxRequests);
assert.equal(new Set(cases.map(test => test.inputSha256)).size,maxRequests,
  "Twenty genuine history/source hashes must be distinct");
assert.equal(new Set(cases.map(test => test.problem)).size,maxRequests,
  "Twenty coding problems must be distinct");
assert(cases.every(test => test.wire.options.num_ctx===32768 &&
  test.wire.options.num_predict===4096 && test.wire.tools===tools));
const manifest = {
  schemaVersion:1, checkpoint:"Muse-Ollama-evolving-unique-prompt-only",endpoint,model,digest,
  version:version.version,numCtx:32768,numPredict:4096,reasoning:"Automatic / think omitted",
  toolNames:names,toolSchemaCount:tools.length,toolSchemaSha256:hash(JSON.stringify(tools)),
  outputAllowance:4096,requestCap:maxRequests,retries:0,executedToolEffects:0,
  timeouts:{firstOutputMs:firstOutputLimitMs,streamIdleMs:streamIdleLimitMs,absoluteMs:absoluteLimitMs},
  journalRequestIdSupport:"not exposed; sequential time/slot/task correlation only",
  activeAndQueueCountSupport:"not exposed by Ollama /api/ps or sampled service unit",
  remoteObservation:"read-only existing SSH identity; journald plus /proc, nvidia-smi and /api/ps",
  cacheLimitation:"Distinct histories may still share fixed system/tool prefixes; do not claim wholly uncached without runtime proof",
  cases:cases.map(({id,caseNumber,band,problem,inputSha256,inputEstimate,noteCount,budgetMargin,messages})=>
    ({id,caseNumber,band,problem,inputSha256,noteCount,budgetMargin,inputEstimate,
      promptBytes:Buffer.byteLength(JSON.stringify(messages))})),
};
if (mode==="preflight") {
  console.log("MUSE_EVOLVING_PREFLIGHT="+JSON.stringify({
    service:version.version,digestMatches:true,toolSchemaCount:tools.length,
    toolSha:manifest.toolSchemaSha256,evidenceExists:existsSync(root),
    maxRequests,executionOfTools:false,corpus:manifest.cases,
  }));
  process.exit(0);
}

assert(!existsSync(root), "Task-owned evidence already exists; refuse to overwrite or replay");
assert(process.env.MUSE_SSH_TARGET?.match(/^[A-Za-z0-9_.@:-]+$/), "Pass existing tunnel SSH destination in MUSE_SSH_TARGET");
assert(process.env.MUSE_SSH_IDENTITY, "Pass the already used SSH key path in MUSE_SSH_IDENTITY");
assert(existsSync(process.env.MUSE_SSH_IDENTITY), "Existing SSH identity missing");

mkdirSync(root, { recursive: false });
writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
const descriptors = Object.fromEntries(["requests", "phases", "resources", "http-progress", "observer-status"].map(name =>
  [name, openSync(path.join(root, name + ".jsonl"), "wx")]));
let writesOpen = true;
const write = (kind, data) => {
  if (writesOpen) writeSync(descriptors[kind], JSON.stringify(data) + "\n");
};
const requests = [];
const resourceSamples = new Map();
const phaseEvents = new Map();
let active = null;
const children = [];
function ownedSsh(args) {
  const child = spawn("ssh.exe", ["-i", process.env.MUSE_SSH_IDENTITY,
    "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "ConnectionAttempts=1",
    "-o", "StrictHostKeyChecking=yes", process.env.MUSE_SSH_TARGET, ...args],
  { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  children.push(child);
  child.stderr.on("data", data => {
    write("observer-status", { utcMs: Date.now(), kind: "ssh-stderr", bytes: data.length, exitCode: child.exitCode });
  });
  child.on("error", error => write("observer-status", { utcMs: Date.now(), kind: "ssh-spawn-error", name: error.name }));
  child.on("exit", (code, signal) => write("observer-status", { utcMs: Date.now(), kind: "ssh-exit", code, signal }));
  return child;
}
function linesFrom(stream, onLine) {
  let pending = "";
  stream.on("data", data => {
    pending += data.toString("utf8");
    if (pending.length > 1024 * 1024) { pending = ""; write("observer-status", { utcMs: Date.now(), kind: "observer-line-overflow" }); }
    let index;
    while ((index = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, index); pending = pending.slice(index + 1);
      if (line) {
        try { onLine(line); }
        catch (error) { write("observer-status", { utcMs: Date.now(), kind: "observer-parse-error", name: error.name }); }
      }
    }
  });
}
function register(map, id, value) {
  if (!id) return;
  if (!map.has(id)) map.set(id, []);
  map.get(id).push(value);
}
function beginObservers() {
  const journal = ownedSsh(["timeout 11400 journalctl -u ollama.service --follow --lines=0 --output=json --no-pager"]);
  journal.stdin.end();
  linesFrom(journal.stdout, line => {
    const object = JSON.parse(line);
    const message = object.MESSAGE ?? "";
    const category = logCategory(message);
    if (!category) return; // Never persist freeform journal content or prompts.
    const event = { id: active?.id ?? null, utcMs: Number(object.__REALTIME_TIMESTAMP) / 1000 || Date.now(),
      observedMs: Date.now(), category, ...logNumbers(message) };
    write("phases", event);
    register(phaseEvents, event.id, event);
  });
  const sampler = ownedSsh(["python3 -u - 5600"]);
  linesFrom(sampler.stdout, line => {
    const sample = JSON.parse(line);
    sample.id = active?.id ?? null;
    write("resources", sample);
    register(resourceSamples, sample.id, sample);
    if (!samplerReady) { samplerReady = true; readyResolve(); }
  });
  sampler.stdin.end(readFileSync(path.join(repo, "scripts", "muse-ollama-phase-sampler-20261115.py"), "utf8"));
}
let samplerReady = false;
let readyResolve;
const ready = new Promise(resolve => { readyResolve = resolve; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function aggregate(samples) {
  const values = key => samples.map(key).filter(value => typeof value === "number" && Number.isFinite(value));
  const summary = numbers => numbers.length ? { min: Math.min(...numbers), max: Math.max(...numbers),
    avg: Math.round(numbers.reduce((sum, n) => sum + n, 0) / numbers.length * 10) / 10 } : null;
  const runner = samples.flatMap(sample => sample.processes ?? []).filter(process => process.kind === "runner");
  const gpu = samples.flatMap(sample => sample.gpu ? [sample.gpu] : []);
  return { samples: samples.length, gpuUtilPct: summary(gpu.map(g => g[0])),
    gpuMemoryUsedMiB: summary(gpu.map(g => g[2])), gpuMemoryFreeMiB: summary(gpu.map(g => g[3])),
    cpuSystemPct: summary(values(sample => sample.systemCpuPct)),
    runnerCpuOneCorePct: summary(values(sample => sample.processes?.find(p => p.kind === "runner")?.cpuPercentOneCore)),
    runnerRssKb: summary(runner.map(process => process.rssKb).filter(Number.isFinite)),
    runnerPids: [...new Set(runner.map(process => process.pid))],
    runnerFlags: [...new Set(runner.map(process => JSON.stringify(process.flags)))].map(text => JSON.parse(text)),
    contexts: [...new Set(samples.flatMap(sample => (sample.modelResidency ?? []).map(model => model.contextLength)))],
    vramSizes: [...new Set(samples.flatMap(sample => (sample.modelResidency ?? []).map(model => model.sizeVram)))],
    swapPageDelta: samples.length > 1 && samples[0].swapPages && samples.at(-1).swapPages ? {
      in: samples.at(-1).swapPages.pswpin - samples[0].swapPages.pswpin,
      out: samples.at(-1).swapPages.pswpout - samples[0].swapPages.pswpout,
    } : null,
  };
}

async function one(test) {
  const {id,wire} = test;
  const startedAt = Date.now(), started = clock(), controller = new AbortController();
  const state = { id, startedAt, startMs: started };
  active = state;
  write("http-progress", { id, utcMs: startedAt, phase: "local-dispatch-start" });
  let status = null, headers = null, firstBytes = null, firstFrame = null,
    firstMeaningful = null, firstThinking = null, firstContent = null, firstTool = null,
    lastFrame = null, done = false, doneReason = null, frames = 0,
    thinkingCharacters = 0, answerCharacters = 0, toolCalls = 0, validToolCalls = 0,
    maxFrameGapMs = 0, metrics = null, failure = null, idleTimer;
  const abort = reason => {
    if (!controller.signal.aborted) {
      failure ??= reason;
      write("http-progress", { id, utcMs: Date.now(), phase: "abort", reason });
      controller.abort(new Error(reason));
    }
  };
  const firstTimer = setTimeout(() => abort("first-meaningful-output-timeout"), firstOutputLimitMs);
  const absoluteTimer = setTimeout(() => abort("absolute-cap"), absoluteLimitMs);
  function frame(value) {
    const observed = clock();
    const kind = frameKind(value);
    frames++;
    if (frames > 12000) return abort("frame-count-cap");
    firstFrame ??= observed;
    if (lastFrame !== null) maxFrameGapMs = Math.max(maxFrameGapMs, observed - lastFrame);
    lastFrame = observed;
    thinkingCharacters += kind.thinking;
    answerCharacters += kind.content;
    toolCalls += kind.calls;
    for (const call of Array.isArray(value.message?.tool_calls) ? value.message.tool_calls : []) {
      const fn = call?.function;
      if (fn?.name !== "list_directory") continue;
      const args = typeof fn.arguments === "string" ? (() => {
        try { return JSON.parse(fn.arguments); } catch { return null; }
      })() : fn.arguments;
      if (args && typeof args === "object" && !Array.isArray(args) &&
          args.path === ".") validToolCalls++;
    }
    if (kind.thinking) firstThinking ??= observed;
    if (kind.content) firstContent ??= observed;
    if (kind.calls) firstTool ??= observed;
    if (kind.thinking || kind.content || kind.calls) {
      if (firstMeaningful === null) {
        firstMeaningful = observed;
        write("http-progress", { id, utcMs: Date.now(), phase: "first-meaningful-frame", kind: kind.calls ? "tool" : kind.content ? "answer" : "thinking" });
      }
      clearTimeout(firstTimer);
    }
    clearTimeout(idleTimer);
    if (!kind.done) idleTimer = setTimeout(() => abort("stream-idle-timeout"), streamIdleLimitMs);
    if (frames <= 12 || frames % 25 === 0 || kind.done) {
      write("http-progress", { id, utcMs: Date.now(), phase: "parsed-stream-frame", index: frames,
        kind: kind.calls ? "tool" : kind.content ? "answer" : kind.thinking ? "thinking" : "empty",
        characters: kind.thinking + kind.content, toolCalls: kind.calls, done: kind.done });
    }
    if (kind.done) {
      done = true;
      clearTimeout(idleTimer);
      doneReason = value.done_reason ?? null;
      metrics = Object.fromEntries(["prompt_eval_count", "prompt_eval_duration", "eval_count", "eval_duration", "load_duration", "total_duration"]
        .filter(key => Number.isFinite(value[key]) && value[key] >= 0).map(key => [key, value[key]]));
    }
  }
  try {
    const response = await fetch(endpoint + "/api/chat", { method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json", "x-clack-phase-id": id }, body: JSON.stringify(wire) });
    headers = clock(); status = response.status;
    write("http-progress", { id, utcMs: Date.now(), phase: "http-headers", status });
    if (!response.ok) throw Error("http-" + response.status);
    assert(response.body, "Response stream absent");
    const reader = response.body.getReader(), decoder = new TextDecoder("utf8", { fatal: true });
    let pending = "";
    while (true) {
      const { done: eof, value } = await reader.read();
      if (eof) break;
      if (firstBytes === null) {
        firstBytes = clock();
        write("http-progress", { id, utcMs: Date.now(), phase: "first-stream-bytes" });
      }
      pending += decoder.decode(value, { stream: true });
      if (pending.length > 1024 * 1024) throw Error("bounded-frame-overflow");
      let index;
      while ((index = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, index).trim(); pending = pending.slice(index + 1);
        if (line) frame(JSON.parse(line));
      }
    }
    pending += decoder.decode();
    if (pending.trim()) frame(JSON.parse(pending));
    if (!done) failure = "terminal-done-missing";
  } catch (error) {
    failure ??= error.message?.startsWith("http-") ? error.message : error.name ?? "provider-or-parser-error";
  } finally {
    clearTimeout(firstTimer); clearTimeout(idleTimer); clearTimeout(absoluteTimer);
  }
  await pause(900); // Let journal + bounded samples catch retrospective terminal timing.
  const elapsed = Math.round(clock() - started);
  const relative = value => value === null ? null : Math.round(value - started);
  const phases = phaseEvents.get(id) ?? [], samples = resourceSamples.get(id) ?? [];
  const observedPromptTokens = phases.filter(event => event.category === "slot-prompt-admitted" &&
    Number.isInteger(event.promptTokens)).map(event => event.promptTokens);
  const cacheHints = phases.filter(event => event.category === "runtime-prefix-cache-hint")
    .map(event => ({pastTokensHint:event.pastTokensHint,cachedTokensHint:event.cachedTokensHint}));
  const record = {id,caseNumber:test.caseNumber,band:test.band,
    problem:test.problem,historySha256:test.inputSha256,
    conservativeInputEstimate:test.inputEstimate,noteCount:test.noteCount,
    startedAt:new Date(startedAt).toISOString(),numCtx:32768,numPredict:4096,
    httpStatus: status, headersMs: relative(headers), firstBytesMs: relative(firstBytes),
    firstFrameMs: relative(firstFrame), firstMeaningfulMs: relative(firstMeaningful),
    firstThinkingMs: relative(firstThinking), firstAnswerMs: relative(firstContent), firstToolMs: relative(firstTool),
    lastFrameMs: relative(lastFrame), completeMs: elapsed, maxFrameGapMs: Math.round(maxFrameGapMs),
    silentTailMs: lastFrame === null ? null : Math.max(0, elapsed - relative(lastFrame)),
    frames,thinkingCharacters,answerCharacters,toolCalls,validToolCalls,
    nativeToolCallValidExactlyOnce:toolCalls===1 && validToolCalls===1,
    done,doneReason,failure,actualPromptTokens:metrics?.prompt_eval_count ?? null,
    observedRunnerPromptTokens:observedPromptTokens,cacheHints,
    metrics, promptEvalTps: metrics?.prompt_eval_count && metrics?.prompt_eval_duration ?
      Math.round(1e11 * metrics.prompt_eval_count / metrics.prompt_eval_duration) / 100 : null,
    decodeTps: metrics?.eval_count && metrics?.eval_duration ?
      Math.round(1e11 * metrics.eval_count / metrics.eval_duration) / 100 : null,
    phaseCategories: [...new Set(phases.map(event => event.category))],
    slotTasks: [...new Set(phases.filter(event => event.task !== null).map(event => event.task))],
    phasesObserved: phases.length, pressure: aggregate(samples),
  };
  write("requests", record);
  requests.push(record);
  for (const fd of Object.values(descriptors)) fsyncSync(fd);
  console.log("MUSE_EVOLVING_RESULT=" + JSON.stringify({ id,band:test.band,status,done,failure,
    firstMeaningfulMs: record.firstMeaningfulMs, firstFrameMs: record.firstFrameMs,
    actualPromptTokens:record.actualPromptTokens,promptEvalTps:record.promptEvalTps,
    validToolCalls,completeMs: record.completeMs, frames, toolCalls, phaseCategories: record.phaseCategories,
    runnerPids: record.pressure.runnerPids, gpuFreeMiB: record.pressure.gpuMemoryFreeMiB }));
  active = null;
  return record;
}

let stopReason = "request-cap-reached";
try {
  beginObservers();
  const observerAvailable = await Promise.race([ready.then(() => true), pause(12000).then(() => false)]);
  assert(observerAvailable && children.every(child => child.exitCode === null),
    "Remote userspace sampler/journal did not start; refuse to send inference");
  await pause(550);
  for (const test of cases) {
    const result = await one(test);
    if (!result.done || result.failure) {
      stopReason = "first-stall-or-failed-request-stop-for-phase-evidence";
      break;
    }
  }
  const failed = requests.filter(result => !result.done || result.failure);
  const summary = {schemaVersion:1,total:requests.length,succeeded:requests.length - failed.length,
    failed: failed.length, maximum: maxRequests, stopReason, executedToolEffects: 0,
    corpusSha256:hash(JSON.stringify(manifest.cases.map(c=>c.inputSha256))), noRetries:true,
    validNativeToolCalls:requests.filter(r=>r.nativeToolCallValidExactlyOnce).length,
    rootCaused: "NOT_ESTABLISHED_BY_HARNESS_AUTOMATICALLY",
    hardened: "NO_PRODUCTION_CONFIGURATION_CHANGE", completedAt: new Date().toISOString() };
  writeFileSync(path.join(root, "summary.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
  console.log("MUSE_EVOLVING_SUMMARY=" + JSON.stringify(summary));
} finally {
  writesOpen = false;
  for (const child of children) if (child.exitCode === null) child.kill(); // Only owned observers; never kill the existing tunnel.
  for (const fd of Object.values(descriptors)) { fsyncSync(fd); closeSync(fd); }
}
