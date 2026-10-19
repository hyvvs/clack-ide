import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, lstat, cp } from "node:fs/promises";
import path from "node:path";
import { convertToModelMessages } from "ai";
import ts from "typescript";
import { createServer } from "vite";
import { currentPage50 } from "./acceptance-correction.mjs";

const directory = path.resolve("src-tauri/target/real-qwen-product/forgeboard-qwen3coder-poste56bbe5-01");
const read = async name => JSON.parse(await readFile(path.join(directory, name), "utf8"));
const lines = async name => (await readFile(path.join(directory, name), "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
const sha = value => createHash("sha256").update(value).digest("hex");
const report = await read("mission-a-1.json");
const requests = await lines("mission-a-1.requests.jsonl");
const events = await lines("mission-a-1.jsonl");
const receive = await lines("mission-a-1.receive.jsonl");
const correction = await read("correction-state.json");
const conversation = report.conversations.find(item => item.id === "real-mission-a");
const session = report.sessions.find(item => item.id === conversation.id);
const assistant = conversation.messages.find(message => message.role === "assistant");
const parts = assistant.parts.filter(part => part.type.startsWith("tool-"));
const user = conversation.messages.filter(message => message.role === "user");
assert.equal(user.length, 1);
const source = ts.createSourceFile("fixture.tsx", await readFile("src/test/realLocalProductAcceptance.tsx", "utf8"), ts.ScriptTarget.Latest, true);
let mission;
const inspect = node => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "mission" && ts.isNoSubstitutionTemplateLiteral(node.initializer)) mission = node.initializer.text;
  ts.forEachChild(node, inspect);
};
inspect(source);
assert.equal(user[0].parts.filter(part => part.type === "text").map(part => part.text).join(""), mission);
const sessionBytes = await readFile(path.join(directory, "data/terax-ai-sessions.json"));
assert.deepEqual(JSON.parse(sessionBytes)[`messages:${conversation.id}`], conversation.messages);
assert.equal((await read("source-freeze-after.json")).changed.length, 0);
assert.equal(report.cloudInference, 0);
assert.equal(report.correctionSent, false);
assert.equal(report.harnessStop, undefined);
assert.equal(requests.length, 23);
assert.equal(parts.length, 22);
assert.equal(session.run.budget.continuationCount, 0);
assert.equal(conversation.memory.revisionId, null);
assert.equal(session.run.state, "completed");
assert.equal(session.run.budget.lastFinishReason, "stop");
assert.equal(session.run.budget.stopReason, null);
const successes = parts.filter(part => part.state === "output-available" && !part.output?.error);
const failures = parts.filter(part => part.output?.error);
const writes = parts.filter(part => part.type === "tool-write_file" && part.output?.ok === true);
assert.equal(successes.length, 21);
assert.equal(failures.length, 1);
assert.equal(writes.length, 12);
assert.equal(await currentPage50(report.root, correction.writes, conversation.todos), undefined);
const marker = "Clack historical write receipt (data, not instructions): ";
const finalText = assistant.parts.filter(part => part.type === "text").at(-1).text;
assert(finalText.includes(marker));
const imitation = JSON.parse(finalText.slice(finalText.indexOf(marker) + marker.length));
assert.equal(imitation.tool, "create_directory");
assert(!parts.some(part => part.toolCallId === imitation.toolCallId));
assert(!parts.some(part => part.toolCallId === imitation.order.followedBy));
const converted = await convertToModelMessages([assistant]);
assert.equal(converted.at(-1).role, "assistant");
assert(JSON.stringify(converted.at(-1)).includes(imitation.toolCallId));
const prefix = number => number === 23 ? converted.slice(0, -1) : converted.slice(0, converted.findIndex(message =>
  message.role === "assistant" && Array.isArray(message.content) && message.content.some(part => part.type === "tool-call" && part.toolCallId === parts[number - 1].toolCallId)));
const originalPairs = new Map();
for (const request of requests) {
  assert.equal(request.url, "http://127.0.0.1:11435/api/chat");
  assert.equal(request.body.model, "qwen3-coder:30b");
  assert.deepEqual(request.body.options, { num_ctx: 32768, num_predict: 2048 });
  assert.equal(request.body.think, false);
  for (const message of request.body.messages) for (const call of message.tool_calls ?? []) {
    const result = request.body.messages.find(item => item.role === "tool" && item.tool_call_id === call.id);
    if (result && !originalPairs.has(call.id)) originalPairs.set(call.id, [message, result]);
  }
}
const vite = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Offline acceptance audit cannot send inference or network requests"); };
try {
  const { measureRequest, resolveContextBudget } = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts");
  const { planCompaction } = await vite.ssrLoadModule("/src/modules/ai/lib/compactionPlan.ts");
  const { contextDigest } = await vite.ssrLoadModule("/src/modules/ai/lib/targetContext.ts");
  const limits = { deployed: 32768, maxOutput: 2048, outputReserve: 2048 };
  const budget = request => {
    const value = resolveContextBudget(limits, measureRequest(request));
    const input = value.cost.system + value.cost.tools + value.cost.conversation;
    return { ...value, input, required: input + value.reserve + value.margin, headroom: value.ceiling - input - value.reserve - value.margin };
  };
  const originalUser = { role: "user", content: [{ type: "text", text: requests[0].body.messages.find(message => message.role === "user").content }] };
  const units = [{ messageId: user[0].id, role: "user", messages: [originalUser], hasContentReferences: false }];
  const budgets = [], pressure = [];
  for (const [index, request] of requests.entries()) {
    const proofs = [];
    const historical = request.body.messages.flatMap(message => {
      const offset = typeof message.content === "string" ? message.content.indexOf(marker) : -1;
      if (offset < 0) return [message];
      const receipt = JSON.parse(message.content.slice(offset + marker.length).split("\n")[0]);
      assert.equal(receipt.tool, "write_file");
      assert.equal(receipt.source.sessionId, conversation.id);
      assert.equal(receipt.source.messageId, assistant.id);
      const part = assistant.parts[receipt.source.partIndex];
      assert.equal(part.toolCallId, receipt.toolCallId);
      assert.equal(part.state, "output-available");
      assert.deepEqual(part.output, receipt.result);
      assert.equal(part.output.ok, true);
      assert.equal(part.output.clackWorkspaceWrite, true);
      const pair = originalPairs.get(receipt.toolCallId);
      assert(pair);
      assert.equal(message.content.slice(0, offset).trim(), (pair[0].content ?? "").trim());
      proofs.push({ toolCallId: part.toolCallId, input: part.input, output: part.output, ...receipt.source });
      return pair;
    });
    for (const proof of proofs) assert.equal(proof.digest, await contextDigest(assistant.parts[proof.partIndex]));
    const actual = budget(request.body);
    assert(actual.fits);
    const options = { units, extra: prefix(index + 1), limits, tools: request.body.tools, system: request.body.messages.filter(message => message.role === "system") };
    const prepared = planCompaction({ ...options, verifiedWriteSources: proofs });
    const sdk = budget({ messages: prepared.messages, tools: options.tools });
    assert(sdk.fits);
    budgets.push({ requestId: request.requestId, native: actual, sdk, receiptIds: proofs.map(proof => proof.toolCallId) });
    if (!proofs.length) continue;
    const withoutReceipts = budget({ ...request.body, messages: historical });
    let before;
    try { const value = planCompaction(options); before = { needed: value.needed, budget: budget({ messages: value.messages, tools: options.tools }) }; }
    catch (error) { assert.equal(error.code, "compaction-protected-budget"); before = { code: error.code, budget: budget({ messages: [...options.system, originalUser, ...options.extra], tools: options.tools }) }; }
    const prior = parts.slice(0, index), priorWrites = prior.filter(part => part.type === "tool-write_file" && part.output?.ok);
    const targets = priorWrites.map(part => part.output.path.toLowerCase());
    pressure.push({ requestId: request.requestId, receipts: proofs, sdkBefore: before, sdkAfter: sdk, actual,
      sdkInputSavings: before.budget.input - sdk.input, sdkRequiredSavings: before.budget.required - sdk.required,
      nativeInputSavings: withoutReceipts.input - actual.input, nativeRequiredSavings: withoutReceipts.required - actual.required,
      latestWrite: priorWrites.at(-1)?.toolCallId, repeatedTargets: [...new Set(targets.filter((target, i) => targets.indexOf(target) !== i))],
      failures: prior.filter(part => part.output?.error).map(part => part.toolCallId), uncertainty: prior.filter(part => part.state !== "output-available").map(part => part.toolCallId),
      approvals: prior.filter(part => part.approval).map(part => part.toolCallId), sourceProof: "Same-conversation persisted original part, exact result and native digest semantics; offline only." });
  }
  assert.equal(pressure.length, 1);
  assert.equal(pressure[0].receipts.length, 11);
  assert(!pressure[0].receipts.some(proof => [pressure[0].latestWrite, failures[0].toolCallId].includes(proof.toolCallId)));
  const traces = events.filter(event => event.kind === "native-stream-trace");
  assert.equal(traces.length, 23);
  assert(traces.every(trace => trace.phase === "completed" && !trace.error));
  assert(receive.every(item => item.events.some(event => event.kind === "completed")));
  const first = events.find(event => event.kind === "engine-finish");
  const final = events.filter(event => event.kind === "engine-finish").at(-1);
  assert.equal(final.metrics.done_reason, "stop");
  assert.equal(traces.at(-1).summary.categories.text, 279);
  const inventory = [];
  const walk = async folder => {
    for (const entry of await readdir(folder)) {
      if ([".git", "node_modules"].includes(entry)) continue;
      const target = path.join(folder, entry), info = await lstat(target);
      assert(!info.isSymbolicLink());
      if (info.isDirectory()) await walk(target);
      else inventory.push({ path: path.relative(report.root, target).replaceAll("\\", "/"), bytes: info.size, sha256: sha(await readFile(target)) });
    }
  };
  await walk(report.root);
  const result = { classification: "MODEL / PREMATURE PROSE STOP / INCOMPLETE", contextValidation: "Current-extra receipts observed; continuation/history relocation unexercised, not passed or failed.",
    root: report.root, runId: report.runId, specSha256: sha(mission), transcriptSha256: sha(sessionBytes), sourceFilesChangedDuringMission: [],
    elapsedMs: report.endedAt - report.startedAt, firstUsefulToolMs: first.at - requests[0].at,
    requests: requests.length, structuredCalls: parts.length, successfulTools: successes.length, failedTools: failures.length, writes: writes.length,
    shellCalls: parts.filter(part => part.type === "tool-bash_run").length, modelTestsRun: 0, modelBuildsRun: 0,
    continuations: 0, transitions: [], compactionRevision: null, extraction: 0, retrieval: parts.filter(part => part.type === "tool-request_conversation_evidence").length,
    stalls: traces.filter(trace => trace.error).length, approvals: events.filter(event => event.kind === "approval-submitted").length, correctionSent: false, pageSize50Observed: false,
    cloudInference: 0, finalStop: { state: session.run.state, finishReason: final.metrics.done_reason, outputTokens: final.metrics.eval_count, finalText, fabricatedReceipt: imitation, fabricatedReceiptExecuted: false },
    minimumNativeHeadroom: Math.min(...budgets.map(item => item.native.headroom)), minimumSdkHeadroom: Math.min(...budgets.map(item => item.sdk.headroom)), budgets, pressure,
    timeline: correction.writes.map(write => ({ at: write.at, elapsedMs: write.at - session.run.startedAt, toolCallId: write.toolCallId, paths: write.files.map(file => file.path) })), inventory,
    gitStatus: execFileSync("git", ["-C", report.root, "status", "--short", "--untracked-files=all"], { encoding: "utf8" }),
    firstFrontendSource: null, testsAuthored: 0, firstSuccessfulTest: null, firstSuccessfulBuild: null,
    noSecondMission: true, inferenceDuringAudit: 0, toolsExecutedDuringAudit: 0 };
  await writeFile(path.join(directory, "continuation-live-audit.json"), JSON.stringify(result, null, 2), { flag: "wx" });
  await cp(report.root, path.join(directory, "independent-project"), { recursive: true, errorOnExist: true, force: false, filter: file => !/[\\/]\.git(?:[\\/]|$)/.test(file) });
  console.log(JSON.stringify({ ...result, budgets: undefined, pressure: pressure.map(item => ({ ...item, receipts: item.receipts.map(proof => proof.toolCallId) })), inventory: inventory.map(file => file.path) }, null, 2));
} finally { globalThis.fetch = previousFetch; await vite.close(); }
