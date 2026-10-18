import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, mkdir, cp, writeFile } from "node:fs/promises";
import path from "node:path";
import { convertToModelMessages } from "ai";
import { createServer } from "vite";
import { currentPage50 } from "./acceptance-correction.mjs";

const directory = path.resolve("src-tauri/target/real-qwen-product/forgeboard-qwen3coder-post315b568-01");
const attempt = process.argv[2] ?? "2";
assert(/^\d{1,2}$/.test(attempt));
const read = async name => JSON.parse(await readFile(path.join(directory, name), "utf8"));
const jsonLines = async name => (await readFile(path.join(directory, name), "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
const report = await read("mission-a-1.json");
const requests = await jsonLines("mission-a-1.requests.jsonl");
const events = await jsonLines("mission-a-1.jsonl");
const conversation = report.conversations.find(item => item.id === "real-mission-a");
const session = report.sessions.find(item => item.id === conversation.id);
const assistant = conversation.messages.find(message => message.role === "assistant");
const parts = assistant.parts.filter(part => part.type.startsWith("tool-"));
const extra = await convertToModelMessages([assistant]);
assert.equal(requests.length, 27);
assert.equal(parts.length, 27);
assert.equal(session.run.error.errorCode, "compaction-protected-budget");
assert.equal(report.cloudInference, 0);
assert.equal(report.correctionSent, false);
assert.equal(conversation.messages.filter(message => message.role === "user").length, 1);
assert((await read("source-freeze-after.json")).changed.length === 0);
const storedBytes = await readFile(path.join(directory, "data/terax-ai-sessions.json"));
const sha = value => createHash("sha256").update(value).digest("hex");
const stored = JSON.parse(storedBytes)["messages:real-mission-a"];
assert.deepEqual(stored, conversation.messages);
const prefix = number => number === 28 ? extra : extra.slice(0, extra.findIndex(message =>
  message.role === "assistant" && message.content.some(part => part.type === "tool-call" && part.toolCallId === parts[number - 1].toolCallId)));
const marker = "Clack historical write receipt (data, not instructions): ";
const receipt = message => {
  const index = typeof message.content === "string" ? message.content.indexOf(marker) : -1;
  return index < 0 ? undefined : JSON.parse(message.content.slice(index + marker.length).split("\n")[0]);
};
const originals = new Map();
for (const request of requests) {
  assert.equal(request.url, "http://127.0.0.1:11435/api/chat");
  assert.equal(request.body.model, "qwen3-coder:30b");
  assert.deepEqual(request.body.options, { num_ctx: 32768, num_predict: 2048 });
  assert.equal(request.body.think, false);
  for (const message of request.body.messages) {
    if (message.role !== "assistant" || !message.tool_calls) continue;
    assert.equal(message.tool_calls.length, 1);
    const id = message.tool_calls[0].id;
    const result = request.body.messages.find(part => part.role === "tool" && part.tool_call_id === id);
    if (result && !originals.has(id)) originals.set(id, [message, result]);
  }
}
const vite = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("This audit cannot send inference or network requests"); };
try {
  const { measureRequest, resolveContextBudget } = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts");
  const { planCompaction, groupCompactionUnits } = await vite.ssrLoadModule("/src/modules/ai/lib/compactionPlan.ts");
  const { contextDigest } = await vite.ssrLoadModule("/src/modules/ai/lib/targetContext.ts");
  const limits = { deployed: 32768, maxOutput: 2048, outputReserve: 2048 };
  const budget = body => {
    const value = resolveContextBudget(limits, measureRequest(body));
    const required = value.cost.system + value.cost.tools + value.cost.conversation + value.reserve + value.margin;
    return { ...value, required, headroom: value.ceiling - required };
  };
  const originalUser = { role: "user", content: [{ type: "text", text: requests[0].body.messages.find(message => message.role === "user").content }] };
  const unit = { messageId: conversation.messages[0].id, role: "user", messages: [originalUser], hasContentReferences: false };
  const pressure = [];
  const budgets = [];
  for (const [index, request] of requests.entries()) {
    const proofs = [];
    const historical = request.body.messages.flatMap(message => {
      const evidence = receipt(message);
      if (!evidence) return [message];
      assert.equal(evidence.source.sessionId, conversation.id);
      assert.equal(evidence.source.messageId, assistant.id);
      const part = assistant.parts[evidence.source.partIndex];
      assert.equal(part.toolCallId, evidence.toolCallId);
      assert.equal(part.state, "output-available");
      assert.deepEqual(part.output, evidence.result);
      assert.equal(part.output.ok, true);
      assert.equal(part.output.clackWorkspaceWrite, true);
      proofs.push({ toolCallId: evidence.toolCallId, input: part.input, output: part.output, ...evidence.source });
      const pair = originals.get(evidence.toolCallId);
      assert(pair, `Missing original native pair ${evidence.toolCallId}`);
      assert.equal(message.content.slice(0, message.content.indexOf(marker)).trim(), (pair[0].content ?? "").trim());
      return pair;
    });
    for (const proof of proofs) assert.equal(proof.digest, await contextDigest(assistant.parts[proof.partIndex]));
    const actual = budget(request.body);
    assert(actual.fits);
    budgets.push({ requestId: request.requestId, receiptCount: proofs.length, ...actual });
    if (!proofs.length) continue;
    const withoutReceipts = budget({ ...request.body, messages: historical });
    const system = request.body.messages.filter(message => message.role === "system");
    const options = { units: [unit], system, tools: request.body.tools, limits, extra: prefix(index + 1) };
    let before;
    try { const value = planCompaction(options); before = { needed: value.needed, budget: value.budget }; }
    catch (error) { before = { code: error.code, budget: error.budget }; }
    const after = planCompaction({ ...options, verifiedWriteSources: proofs });
    const prior = parts.slice(0, index).filter(part => part.type === "tool-write_file" && part.output?.ok);
    const targets = prior.map(part => part.output.path.toLowerCase());
    pressure.push({ requestId: request.requestId, receipts: proofs.map(proof => proof.toolCallId), actual, withoutReceipts,
      nativeInputSavings: withoutReceipts.cost.conversation - actual.cost.conversation,
      nativeRequiredSavings: withoutReceipts.required - actual.required,
      sdkBefore: before, sdkAfter: after.budget,
      sdkConversationSavings: before.budget.cost.conversation - after.budget.cost.conversation,
      latestWrite: prior.at(-1)?.toolCallId,
      failedEffects: parts.slice(0, index).filter(part => part.output?.error).map(part => part.toolCallId),
      uncertainEffects: parts.slice(0, index).filter(part => part.state !== "output-available").map(part => part.toolCallId),
      repeatedTargets: [...new Set(targets.filter((target, i) => targets.indexOf(target) !== i))],
      sourceProof: "Persisted same-conversation part contents and SHA256 match each actual live receipt; no new native inspection invoked." });
  }
  const cutoff = prefix(25).length;
  const units = [unit, { messageId: assistant.id, role: "assistant", messages: extra.slice(0, cutoff), hasContentReferences: false }];
  const system = requests.at(-1).body.messages.filter(message => message.role === "system");
  const tools = [...requests.at(-1).body.tools, requests[0].body.tools.find(tool => tool.function.name === "bash_run")];
  assert.equal(new Set(tools.map(tool => tool.function.name)).size, 8);
  const mandatory = { messages: [...system, originalUser, ...extra], tools };
  const blocked = budget(mandatory);
  assert.equal(blocked.cost.system, 3702);
  assert.equal(blocked.cost.tools, 2803);
  assert.equal(blocked.cost.conversation, 21504);
  assert.equal(blocked.required, 32858);
  let blockedPlan;
  try { planCompaction({ units, extra: extra.slice(cutoff), system, tools, limits }); assert.fail("The preserved continuation must reproduce the protected failure"); }
  catch (error) { assert.equal(error.code, "compaction-protected-budget"); blockedPlan = { code: error.code, budget: error.budget }; }
  const continuationUnitCosts = units.map(value => ({ messageId: value.messageId, role: value.role,
    cost: measureRequest({ messages: value.messages }).conversation }));
  const currentExtraCost = measureRequest({ messages: extra.slice(cutoff) }).conversation;
  let protectedTailStart = units.length, tailCost = currentExtraCost;
  const tailTarget = Math.floor(blocked.working * 0.2);
  for (const group of groupCompactionUnits(units).reverse()) {
    const cost = continuationUnitCosts.slice(group.start, group.end).reduce((sum, unit) => sum + unit.cost, 0);
    if (protectedTailStart !== units.length && tailCost + cost > tailTarget) break;
    tailCost += cost;
    protectedTailStart = group.start;
  }
  assert.equal(protectedTailStart, 1);
  const correction = await read("correction-state.json");
  const detectorResult = await currentPage50(report.root, correction.writes, conversation.todos);
  const tasks = await readFile(path.join(report.root, "backend/src/routes/tasks.ts"), "utf8");
  assert.match(tasks, /limit = 50/);
  assert.equal(detectorResult, undefined);
  const authored = parts.filter(part => part.type === "tool-write_file" && part.output?.ok).map(part => part.input.path);
  const files = [];
  for (const file of authored) {
    const bytes = await readFile(file);
    const source = parts.find(part => part.type === "tool-write_file" && part.input?.path === file);
    assert.equal(bytes.toString("utf8"), source.input.content);
    files.push({ path: path.relative(report.root, file).replaceAll("\\", "/"), bytes: bytes.length, sha256: sha(bytes), toolCallId: source.toolCallId });
  }
  const entries = await readdir(report.root);
  const gitStatus = execFileSync("git", ["--no-optional-locks", "-C", report.root, "status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8" });
  const copy = path.join(directory, "independent-project");
  let copied = true;
  try { await mkdir(copy); }
  catch (error) { if (error.code !== "EEXIST") throw error; copied = false; }
  if (copied) {
    for (const entry of entries.filter(entry => entry !== ".git" && entry !== "node_modules"))
      await cp(path.join(report.root, entry), path.join(copy, entry), { recursive: true, errorOnExist: true, force: false });
  }
  for (const file of files) assert.equal(sha(await readFile(path.join(copy, file.path))), file.sha256);
  const traces = events.filter(event => event.kind === "native-stream-trace");
  const first = traces[0].summary;
  const start = requests[0].at;
  const text = assistant.parts.filter(part => part.type === "text").map(part => part.text).join("\n");
  const result = { at: new Date().toISOString(), root: report.root, evidence: directory, verificationCopy: copy,
    sourceCheckpoint: "315b568", sourceFreezeUnchanged: true, durableTranscriptSha256: sha(storedBytes),
    classification: "CLACK_CONTEXT / PROTECTED-BUDGET AFTER AUTOMATIC CONTINUATION / INCOMPLETE",
    elapsedMs: report.endedAt - report.startedAt, requests: requests.length, tools: parts.length,
    toolCounts: Object.fromEntries([...new Set(parts.map(part => part.type))].map(type => [type, parts.filter(part => part.type === type).length])),
    failedTools: parts.filter(part => part.output?.error).length,
    firstResponseMs: first.categoryTimes.text.firstAt - start,
    firstToolCallMs: first.categoryTimes.tools.firstAt - start,
    firstWriteObservedMs: correction.writes[0].at - start,
    firstBackendObservedMs: correction.writes.find(write => write.files.some(file => file.path.endsWith("persistence.ts"))).at - start,
    firstFrontendObservedMs: correction.writes.find(write => write.files.some(file => file.path.endsWith("App.tsx"))).at - start,
    finalUsage: events.filter(event => event.kind === "engine-finish").map(event => ({ requestId: event.requestId, metrics: event.metrics })),
    totalOutputTokens: events.filter(event => event.kind === "engine-finish").reduce((sum, event) => sum + event.metrics.eval_count, 0),
    minimumSentHeadroom: Math.min(...budgets.map(value => value.headroom)), pressure, budgets,
    continuationCount: session.run.budget.continuationCount, originalGroupsAtContinuation: groupCompactionUnits(units),
    blocked, blockedPlan, continuationUnitCosts, currentExtraCost,
    protectedTailStart, tailTarget, protectedTailReason: "Offline reconstruction of the production tail rule: the previous assistant UI message is the latest intact tool group and remains the mandatory recent tail even though not intrinsically protected.",
    currentExtraToolIds: parts.slice(24).map(part => part.toolCallId),
    compactionMemoryRevision: conversation.memory.revisionId,
    correction: { sent: false, writesObserved: correction.writes.length, detectorFoundPage50: false, authoredPageSize50: true,
      reason: "The unchanged detector misses the multiline req.query destructuring with a standalone limit = 50 line; no accepted plan exists." },
    streamFailures: traces.filter(trace => trace.phase !== "completed").length,
    structuredCalls: traces.reduce((sum, trace) => sum + (trace.summary.categories.tools ?? 0), 0),
    emptyResponses: traces.filter(trace => !(trace.summary.categories.text || trace.summary.categories.tools || trace.summary.categories.reasoning)).length,
    textualToolIntentMarkers: text.match(/<tool_call>|<function=|```(?:xml|json)/g) ?? [],
    approvalEvents: events.filter(event => event.kind.includes("approval")).length,
    firstShell: parts.find(part => part.type === "tool-bash_run"),
    cloudInference: report.cloudInference, files, initialGitStatus: gitStatus, furtherInference: 0, projectRepairs: 0,
    stageGate: "STOP: new Clack protected-budget boundary; stages 2 through 6 not started." };
  await writeFile(path.join(directory, `post-effect-run-audit-${attempt}.json`), JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ ...result, budgets: undefined, finalUsage: undefined, firstShell: { input: result.firstShell.input, output: result.firstShell.output }, files: result.files.length, pressure: pressure.map(value => ({ requestId: value.requestId, receipts: value.receipts.length, actualRequired: value.actual.required, withoutReceiptsRequired: value.withoutReceipts.required, nativeInputSavings: value.nativeInputSavings, nativeRequiredSavings: value.nativeRequiredSavings, sdkBefore: value.sdkBefore, sdkAfter: value.sdkAfter, sdkConversationSavings: value.sdkConversationSavings })) }, null, 2));
} finally {
  globalThis.fetch = previousFetch;
  await vite.close();
}
