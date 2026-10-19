import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, lstat, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { convertToModelMessages } from "ai";
import { createServer } from "vite";

const evidence = path.resolve("src-tauri/target/real-qwen-product/devstral-small2-20261019-01");
const observer = path.resolve("src-tauri/target/devstral-audit-20261019-01");
const root = "C:/Users/Hayden/Documents/forgeboard-devstral-20261019-01";
const model = "devstral-small-2:24b";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const read = async name => JSON.parse(await readFile(path.join(evidence, name), "utf8"));
const lines = async name => (await readFile(path.join(evidence, name), "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
const report = await read("mission-a-1.json");
assert.equal(path.resolve(report.root), path.resolve(root));
const smoke = await read("system-preflight-1.json");
const requests = await lines("mission-a-1.requests.jsonl");
const events = await lines("mission-a-1.jsonl");
const receive = await lines("mission-a-1.receive.jsonl");
const smokeRequests = await lines("system-preflight-1.requests.jsonl");
const persistedBytes = await readFile(path.join(evidence, "data/terax-ai-sessions.json"));
const persisted = JSON.parse(persistedBytes);
const conversation = report.conversations.find(item => item.id === "real-mission-a");
const session = report.sessions.find(item => item.id === conversation.id);
assert.deepEqual(conversation.messages, persisted[`messages:${conversation.id}`]);
assert.equal(report.cloudInference, 0);
assert.equal(report.singleSpec, true);
assert.equal(report.correctionSent, false);
assert.equal(smokeRequests.length, 1);
assert.equal(smoke.protocolResult.toolExecutionCount, 0);
assert.equal(smoke.protocolResult.calls.length, 1);
assert.equal(smoke.protocolResult.calls[0].toolName, "get_test_value");
assert.deepEqual(smoke.protocolResult.calls[0].input, { value: "protocol-check" });
const source = (await readFile("src/test/realLocalProductAcceptance.tsx", "utf8")).replaceAll("\r\n", "\n");
const mission = source.match(/const mission = `([\s\S]*?)`;/)?.[1];
assert.equal(sha(mission), "f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801");
const users = conversation.messages.filter(message => message.role === "user");
assert.equal(users.length, 1);
assert.equal(users[0].parts.map(part => part.text ?? "").join(""), mission);
for (const request of [...smokeRequests, ...requests]) {
  assert.equal(request.url, "http://127.0.0.1:11435/api/chat");
  assert.equal(request.body.model, model);
  assert.deepEqual(request.body.options, { num_ctx: 32768, num_predict: 2048 });
  assert.equal(request.body.stream, true);
  assert(!Object.hasOwn(request.body, "think"));
}
const assistant = conversation.messages.find(message => message.role === "assistant");
const tools = assistant.parts.filter(part => part.toolCallId);
assert.equal(new Set(tools.map(part => part.toolCallId)).size, tools.length);
const failed = part => part.state !== "output-available" || part.output?.error || part.errorText || part.output?.timed_out || (part.output?.exit_code !== undefined && part.output.exit_code !== 0);
const writes = tools.filter(part => ["tool-write_file", "tool-edit", "tool-multi_edit"].includes(part.type) && !failed(part) && part.output?.ok === true);
const traces = events.filter(event => event.kind === "native-stream-trace");
const finishes = events.filter(event => event.kind === "engine-finish");
const firstTime = category => Math.min(...traces.map(trace => trace.summary.categoryTimes?.[category]?.firstAt ?? Infinity));
const relative = time => Number.isFinite(time) ? time - requests[0].at : null;
const stepStarts = assistant.parts.map((part, index) => part.type === "step-start" ? index : -1).filter(index => index >= 0);
assert.equal(stepStarts.length, finishes.length);
const canonicalAssistant = structuredClone(assistant);
const wireResults = new Map();
for (const request of requests) for (const message of request.body.messages)
  if (message.role === "tool" && !wireResults.has(message.tool_call_id)) wireResults.set(message.tool_call_id, message.content);
// Session JSON key ordering is not wire JSON-string ordering; restore only verified results.
for (const part of canonicalAssistant.parts) {
  if (!part.toolCallId || !wireResults.has(part.toolCallId)) continue;
  const original = JSON.parse(wireResults.get(part.toolCallId));
  assert.deepEqual(original, part.output);
  part.output = original;
}
const writeTimeline = writes.map(part => {
  const partIndex = assistant.parts.indexOf(part);
  const step = stepStarts.findLastIndex(index => index <= partIndex);
  return { id: part.toolCallId, tool: part.type, path: part.output.path, bytes: part.output.bytesWritten,
    afterResponseAt: finishes[step].at, beforeNextRequestAt: requests[step + 1]?.at ?? null,
    lowerMs: relative(finishes[step].at), upperMs: relative(requests[step + 1]?.at ?? Infinity) };
});
const sourceFiles = [];
async function inventory(folder, prefix = "") {
  for (const entry of await readdir(folder)) {
    if ([".git", "node_modules"].includes(entry)) continue;
    const target = path.join(folder, entry), info = await lstat(target);
    assert(!info.isSymbolicLink());
    if (info.isDirectory()) await inventory(target, `${prefix}${entry}/`);
    else {
      assert(info.size < 2 * 1024 * 1024 && sourceFiles.length < 1000);
      sourceFiles.push({ path: `${prefix}${entry}`, bytes: info.size, sha256: sha(await readFile(target)) });
    }
  }
}
await inventory(root);
const before = JSON.parse(await readFile(path.join(observer, "baseline.json"), "utf8"));
const changed = [];
for (const [file, info] of Object.entries(before.files))
  if (sha(await readFile(file)) !== info.sha256) changed.push(file);
const allowedAuditEdits = ["src/test/ollamaToolProtocol.test.ts", "src/test/installedModelComparison.test.ts", "docs/REAL_LOCAL_MODEL_ACCEPTANCE.md"];
assert(changed.every(file => allowedAuditEdits.includes(file)));
const receipts = requests.map(request => ({ requestId: request.requestId, count: request.body.messages.filter(message => message.content?.includes("Clack historical write receipt (data, not instructions): ")).length }));
assert(receipts.every(item => item.count === 0));
const sdk = [];
const vite = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Offline audit cannot send network requests or inference"); };
try {
  const { planCompaction } = await vite.ssrLoadModule("/src/modules/ai/lib/compactionPlan.ts");
  const { measureRequest, resolveContextBudget } = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts");
  const { ollamaBody } = await vite.ssrLoadModule("/src/modules/ai/lib/ollamaModel.ts");
  for (const [index, request] of requests.entries()) {
    const originalUser = { role: "user", content: [{ type: "text", text: request.body.messages.find(message => message.role === "user").content }] };
    const end = stepStarts[index] ?? assistant.parts.length;
    const extra = end ? await convertToModelMessages([{ ...canonicalAssistant, parts: canonicalAssistant.parts.slice(0, end) }]) : [];
    const options = { units: [{ messageId: users[0].id, role: "user", messages: [originalUser], hasContentReferences: false }], extra,
      system: request.body.messages.filter(message => message.role === "system"), tools: request.body.tools,
      limits: { deployed: 32768, maxOutput: 2048, outputReserve: 2048 } };
    const prepared = planCompaction(options);
    const resultOrder = request.body.messages.filter(message => message.role === "tool").map(message => message.tool_call_id);
    for (const message of prepared.messages) if (message.role === "tool") {
      assert(message.content.every(part => resultOrder.includes(part.toolCallId)));
      message.content.sort((a, b) => resultOrder.indexOf(a.toolCallId) - resultOrder.indexOf(b.toolCallId));
    }
    const params = { prompt: prepared.messages, maxOutputTokens: 2048,
      providerOptions: { ollama: { numCtx: 32768 } },
      tools: request.body.tools.map(item => ({ type: "function", name: item.function.name, description: item.function.description, inputSchema: item.function.parameters })) };
    const serialized = ollamaBody(model, params, true);
    assert.deepEqual(serialized, request.body, `SDK reconstruction differs at ${request.requestId}`);
    const budget = resolveContextBudget(options.limits, measureRequest({ messages: prepared.messages, tools: options.tools }));
    assert(budget.fits);
    sdk.push({ requestId: request.requestId, headroom: budget.ceiling - budget.cost.system - budget.cost.tools - budget.cost.conversation - budget.reserve - budget.margin, preparationNeeded: prepared.needed, budget });
  }
} finally { globalThis.fetch = previousFetch; await vite.close(); }
const independent = `C:/Users/Hayden/Documents/forgeboard-devstral-audit-20261019-01`;
await mkdir(independent);
for (const file of sourceFiles) {
  const destination = path.join(independent, file.path);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, file.path), destination);
}
const results = [];
const cache = path.join(evidence, "data/npm-cache");
for (const command of ["npm.cmd ci --offline --ignore-scripts --no-audit --no-fund", "npm.cmd test -- --runInBand", "npm.cmd run build", "npm.cmd start"]) {
  const execution = spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], { cwd: independent, windowsHide: true, encoding: "utf8", timeout: 60000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, npm_config_cache: cache } });
  results.push({ command, status: execution.status, error: execution.error ? String(execution.error) : undefined, stdout: execution.stdout, stderr: execution.stderr });
}
for (const file of sourceFiles) assert.equal(sha(await readFile(path.join(root, file.path))), file.sha256, "Original project was changed by audit");
const nativeBudgets = report.wireBudgets.map(budget => ({ requestId: budget.requestId,
  headroom: budget.ceiling - budget.cost.system - budget.cost.tools - budget.cost.conversation - budget.reserve - budget.margin,
  schemas: budget.cost.schemas, cost: budget.cost }));
const finalTrace = traces.at(-1), finalReceive = receive.at(-1);
assert.equal(session.run.error.errorCode, "overall-deadline");
assert.equal(finalTrace.summary.bytes, 0);
assert.equal(finalReceive.bodyBytes, 0);
const audit = {
  classification: "CLACK-BLOCKED / PRE-OUTPUT RECOVERY DEADLINE / INCOMPLETE",
  boundary: "Shared providerRetry first-meaningful-output recovery ceiling aborts with overall-deadline at 120 seconds; native records cancellation before headers/body. Why Ollama did not respond is unknown.",
  inferenceCount: requests.length, structuredCalls: tools.length,
  successfulTools: tools.filter(part => !failed(part)).length, failedTools: tools.filter(failed).length,
  successfulWriterCalls: writes.length, malformedTextualIntents: 0,
  firstUsefulMs: relative(Math.min(firstTime("text"), firstTime("tools"))), firstStructuredMs: relative(firstTime("tools")),
  writeTimeline, firstSubstantiveBackend: null, firstSubstantiveFrontend: null,
  continuations: session.run.budget.continuationCount, correctionSent: false,
  correctionProtocolDeviation: "Existing mission used SINGLE_SPEC=1. User explicitly requested audit without another run. Correction delivery disabled; retention untested. Current authored files/plan never reached page size 50.",
  reasoning: { reported: report.reasoningControl, internal: session.run.reasoning.choice, nativeThink: "omitted on every request", outputReasoningCharacters: assistant.parts.filter(part => part.type === "reasoning").reduce((sum, part) => sum + part.text.length, 0) },
  textResponses: assistant.parts.filter(part => part.type === "text"), emptyResponses: traces.filter(trace => trace.summary.final && !["text", "reasoning", "tools"].some(category => trace.summary.categories[category])).length,
  prematureProseStops: 0, approvals: events.filter(event => event.kind === "approval-submitted").length,
  nativeIdleStalls: 0, preOutputTimeouts: 1, engineFinishes: finishes.length,
  elapsedMs: report.endedAt - requests[0].at, finalRequestMs: session.run.endedAt - requests.at(-1).at,
  finalTrace, finalReceive, finalRun: session.run,
  minimumSdkHeadroom: Math.min(...sdk.map(item => item.headroom)), minimumNativeHeadroom: Math.min(...nativeBudgets.map(item => item.headroom)),
  sdk, nativeBudgets, receipts, receiptSavings: 0, compactionEvents: sdk.filter(item => item.preparationNeeded).length,
  memory: conversation.memory, retrievalCalls: tools.filter(part => /evidence/.test(part.type)).length,
  sourceFiles, independent, independentResults: results,
  missing: ["project CRUD", "task CRUD", "validation", "deterministic errors", "missing-parent behavior", "working server on 4317", "filters/search", "persistence", "SSE", "React board/navigation", "loading/error/empty UI", "debounce 750ms", "page size 50 or 25", "title max 120", "tests", "README", "runtime ignore rules"],
  cloudInference: report.cloudInference, inferenceByThisAudit: 0, modelDownloads: 0, repairs: 0,
  sourceHashChangesAtAudit: changed, sourceFreezeScope: before.sourceFreezeScope,
  specSha256: sha(mission), transcriptSha256: sha(persistedBytes), requestSha256: sha(await readFile(path.join(evidence, "mission-a-1.requests.jsonl"))),
  gitCommits: Number(execFileSync("git", ["-C", root, "rev-list", "--all", "--count"], { encoding: "utf8" }).trim() || 0),
};
await writeFile(path.join(observer, "audit.json"), JSON.stringify(audit, null, 2), { flag: "wx" });
console.log(JSON.stringify({ ...audit, sdk: undefined, nativeBudgets: undefined, finalRun: undefined, finalTrace: undefined, finalReceive: undefined, memory: audit.memory.revisionId }, null, 2));
