import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, lstat, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { currentPage50 } from "./acceptance-correction.mjs";

globalThis.fetch = async () => { throw new Error("Offline comparison audit cannot send inference or network requests"); };
const evidenceRoot = path.resolve("src-tauri/target/installed-local-models-20261019-01");
const results = JSON.parse(await readFile(path.join(evidenceRoot, "comparison-progress.json"), "utf8"));
const read = async file => JSON.parse(await readFile(file, "utf8"));
const lines = async file => (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const summary = [];
async function inventory(root) {
  const files = [];
  let total = 0;
  async function walk(dir) {
    for (const entry of await readdir(dir)) {
      if ([".git", "node_modules"].includes(entry)) continue;
      const file = path.join(dir, entry), info = await lstat(file);
      assert(!info.isSymbolicLink(), "Audit refuses project symlinks");
      if (info.isDirectory()) await walk(file);
      else {
        assert(info.size <= 2 * 1024 * 1024 && ++total < 2000, "Bounded source inventory required");
        files.push({ path: path.relative(root, file).replaceAll("\\", "/"), bytes: info.size, sha256: hash(await readFile(file)) });
      }
    }
  }
  await walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
const correctionText = "Change the task page size requirement from 50 to 25. The new value supersedes 50 everywhere. Continue the same project and do not restart from scratch.";
const source = (await readFile("src/test/realLocalProductAcceptance.tsx", "utf8")).replaceAll("\r\n", "\n");
const mission = source.match(/const mission = `([\s\S]*?)`;/)?.[1];
assert.equal(hash(mission), "f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801");
for (const result of results) {
  assert(["qwen36moe", "gemma4", "qwen36dense"].includes(result.label));
  const suffix = { qwen36moe: "41", gemma4: "42", qwen36dense: "43" }[result.label];
  assert.equal(result.runId, `installed-${result.label}-20261019-01`);
  assert.equal(result.root, `C:/Users/Hayden/Documents/forgeboard-qwen-none-20261019-${suffix}`);
  assert.equal(path.resolve(result.evidence), path.resolve("src-tauri/target/real-qwen-product", result.runId));
  const name = file => path.join(result.evidence, file);
  try {
    const previous = await read(name("installed-model-audit.json"));
    assert.deepEqual(await inventory(result.root), previous.files);
    summary.push(previous);
    continue;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const requests = await lines(name("mission-a-1.requests.jsonl"));
  const events = await lines(name("mission-a-1.jsonl"));
  const receive = await lines(name("mission-a-1.receive.jsonl"));
  const correction = await read(name("correction-state.json"));
  const freeze = await read(name("source-freeze-after.json"));
  assert.equal(freeze.changed.length, 0);
  const probe = await read(name("system-preflight-1.json"));
  const smokeRequests = await lines(name("system-preflight-1.requests.jsonl"));
  assert.equal(smokeRequests.length, 1);
  assert.equal(probe.protocolResult.toolExecutionCount, 0);
  assert.equal(probe.protocolResult.calls.length, 1);
  assert.equal(probe.protocolResult.calls[0].toolName, "get_test_value");
  assert.deepEqual(probe.protocolResult.calls[0].input, { value: "protocol-check" });
  let report, failure;
  try { report = await read(name("mission-a-1.json")); }
  catch (error) { if (error.code !== "ENOENT") throw error; failure = await read(name("mission-a-1.failure.json")); }
  const persisted = await read(name("data/terax-ai-sessions.json"));
  const messages = persisted["messages:real-mission-a"];
  const session = persisted.sessions.find(item => item.id === "real-mission-a");
  assert(messages && session);
  if (report) {
    assert.deepEqual(report.conversations.find(item => item.id === session.id).messages, messages);
    assert.equal(report.cloudInference, 0);
    assert.equal(report.harnessStop, undefined);
  }
  const users = messages.filter(item => item.role === "user");
  assert.equal(users[0].parts.filter(part => part.type === "text").map(part => part.text).join(""), mission);
  assert.equal(users.filter(item => item.parts.some(part => part.type === "text" && part.text === mission)).length, 1);
  const corrections = users.filter(item => item.parts.some(part => part.type === "text" && part.text === correctionText));
  assert(corrections.length <= 1);
  assert.equal(users.length, 1 + corrections.length);
  for (const request of [...smokeRequests, ...requests]) {
    assert.equal(request.url, "http://127.0.0.1:11435/api/chat");
    assert.equal(request.body.model, result.model);
    assert.deepEqual(request.body.options, { num_ctx: 32768, num_predict: 2048 });
    assert.equal(request.body.stream, true);
    if (result.reasoning.effective === "none") assert.equal(request.body.think, false);
    else assert(!Object.hasOwn(request.body, "think"));
  }
  const parts = messages.filter(item => item.role === "assistant").flatMap(item => item.parts);
  const tools = parts.filter(part => part.toolCallId);
  assert.equal(new Set(tools.map(part => part.toolCallId)).size, tools.length);
  const failed = part => part.state !== "output-available" || part.output?.error || part.errorText || part.output?.timed_out || (part.output?.exit_code !== undefined && part.output.exit_code !== 0);
  const successes = tools.filter(part => !failed(part));
  const writes = tools.filter(part => ["tool-write_file", "tool-edit", "tool-multi_edit"].includes(part.type) && !failed(part) && part.output?.ok && part.output?.clackWorkspaceWrite);
  const traces = events.filter(event => event.kind === "native-stream-trace");
  const finishes = events.filter(event => event.kind === "engine-finish");
  const firstCategory = category => Math.min(...traces.map(trace => trace.summary.categoryTimes?.[category]?.firstAt ?? Infinity));
  const elapsed = value => Number.isFinite(value) ? value - requests[0].at : null;
  const wireBudgets = report?.wireBudgets ?? [];
  const receiptMarker = "Clack historical write receipt (data, not instructions): ";
  const receipts = requests.map(request => ({ requestId: request.requestId, count: request.body.messages.filter(message => typeof message.content === "string" && message.content.includes(receiptMarker)).length }));
  const files = await inventory(result.root);
  const matchedFiles = prefix => files.filter(file => file.path.startsWith(prefix));
  const testFiles = files.filter(file => /(?:__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$)/.test(file.path));
  const firstShell = tools.find(part => part.type === "tool-bash_run");
  const shells = tools.filter(part => part.type === "tool-bash_run");
  const useful = Math.min(firstCategory("text"), firstCategory("tools"));
  const observation = failure ? await read(name("mission-stop-observation.json")) : null;
  const audit = {
    model: result.model, runId: result.runId, workspace: result.root,
    classification: failure ? "HARNESS-BLOCKED" : session.run.error?.errorCode === "compaction-protected-budget" ? "CLACK-BLOCKED" : session.run.error?.errorCode === "missing-final-event" ? "ENGINE-BLOCKED" : "MODEL-INCOMPLETE",
    smoke: { status: "PASS", requests: 1, toolExecutionCount: 0, ...probe.protocolResult },
    reasoning: result.reasoning, specSha256: hash(mission), specificationCount: 1, correctionCount: corrections.length,
    totalInferenceRequests: requests.length, structuredCalls: tools.length, successfulTools: successes.length, failedTools: tools.filter(failed).length,
    successfulWriterCalls: writes.length, confirmedWriteEvents: correction.writes.length,
    fileCount: files.length, sourceFiles: files.filter(file => /\.[cm]?[jt]sx?$/.test(file.path) && !/(?:config|\.d\.ts$)/.test(file.path)),
    backendFiles: matchedFiles("backend/src/"), frontendFiles: matchedFiles("frontend/src/"), testFiles,
    timeToFirstResponseMs: elapsed(firstCategory("raw-chunk")), timeToFirstUsefulProgressMs: elapsed(useful),
    timeToFirstStructuredToolMs: elapsed(firstCategory("tools")),
    timeToFirstConfirmedWriteMs: correction.writes.length ? correction.writes[0].at - requests[0].at : null,
    startedAt: requests[0].at, lastEvidenceAt: events.at(-1).at, endedAt: report?.endedAt ?? failure.endedAt,
    elapsedMs: (report?.endedAt ?? failure.endedAt) - requests[0].at,
    firstShell: firstShell ? { input: firstShell.input, output: firstShell.output } : null,
    shellCalls: shells.map(part => ({ id: part.toolCallId, input: part.input, output: part.output })),
    modelTestCommands: shells.filter(part => /\b(?:npm|npx|vitest|jest)\b.*\btest\b/.test(part.input?.command ?? "")).length,
    modelBuildCommands: shells.filter(part => /\b(?:npm|npx)\b.*\bbuild\b/.test(part.input?.command ?? "")).length,
    continuations: session.run.budget?.continuationCount ?? 0,
    approvals: events.filter(event => event.kind === "approval-submitted").length,
    stalls: traces.filter(trace => /timeout|deadline|stall/.test(trace.error?.code ?? "")).length,
    emptyResponses: traces.filter(trace => trace.summary.final && !Object.keys(trace.summary.categories).some(key => ["text", "reasoning", "tools"].includes(key))).length,
    engineFinishes: finishes.length, providerErrorFrames: traces.reduce((count, trace) => count + (trace.summary.categories["provider-error"] ?? 0), 0),
    nativeReceive: receive.map(item => ({ requestId: item.requestId, chunks: item.bodyChunks, bytes: item.bodyBytes, end: item.events.at(-1) })),
    minimumNativeEstimatedHeadroom: wireBudgets.length ? Math.min(...wireBudgets.map(budget => budget.ceiling - budget.cost.system - budget.cost.tools - budget.cost.conversation - budget.reserve - budget.margin)) : null,
    receipts, memory: report?.conversations.find(item => item.id === session.id)?.memory ?? null,
    evidenceRetrievalCalls: tools.filter(part => /evidence/.test(part.type)).length,
    page50AtFinalBoundary: (await currentPage50(result.root, correction.writes, report?.conversations.find(item => item.id === session.id)?.todos ?? [])) ?? null,
    finalRun: session.run, finalTexts: parts.filter(part => ["text", "reasoning"].includes(part.type)),
    failure, observation, files,
    sourceFreezeChanges: freeze.changed, cloudInference: 0, inferenceDuringAudit: 0, repairs: 0,
    gitCommits: Number(execFileSync("git", ["-C", result.root, "rev-list", "--all", "--count"], { encoding: "utf8" }).trim() || 0),
  };
  const independent = [];
  if (files.some(file => file.path === "package.json")) {
    const copy = `C:/Users/Hayden/Documents/forgeboard-audit-20261019-${suffix}`;
    await mkdir(copy);
    for (const file of files) {
      const destination = path.join(copy, file.path);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(result.root, file.path), destination);
    }
    assert.deepEqual(await inventory(copy), files);
    const commands = result.label === "qwen36moe"
      ? ["npm.cmd ci --offline --ignore-scripts --no-audit --no-fund", "npm.cmd test", "npm.cmd run build"]
      : ["npm.cmd test", "npm.cmd run build"];
    for (const command of commands) {
      const execution = spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], { cwd: copy, windowsHide: true, encoding: "utf8", timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
      independent.push({ copy, command, status: execution.status, error: execution.error ? String(execution.error) : undefined, stdout: execution.stdout, stderr: execution.stderr });
    }
    assert.deepEqual(await inventory(result.root), files, "Audit changed original project bytes");
  }
  audit.independent = independent;
  await writeFile(name("installed-model-audit.json"), JSON.stringify(audit, null, 2), { flag: "wx" });
  summary.push(audit);
}
const compact = summary.map(audit => ({ ...audit, finalRun: undefined, finalTexts: undefined, files: undefined, shellCalls: undefined, firstShell: undefined, nativeReceive: undefined,
  smoke: { status: "PASS", toolExecutionCount: 0 }, receipts: audit.receipts.filter(item => item.count), memory: audit.memory?.revisionId ?? null, failure: audit.failure?.error,
  independent: audit.independent.map(item => ({ command: item.command, status: item.status, error: item.error, tail: `${item.stdout}\n${item.stderr}`.slice(-1600) })) }));
await writeFile(path.join(evidenceRoot, "comparison-audit.json"), JSON.stringify(compact, null, 2), { flag: "wx" });
console.log(JSON.stringify(compact, null, 2));
