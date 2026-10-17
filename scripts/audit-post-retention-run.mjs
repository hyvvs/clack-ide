import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const directory = process.argv[2];
assert(directory && path.isAbsolute(directory), "Supply the preserved -06 evidence directory");
const hashes = {};
async function read(name) {
  const file = path.join(directory, name);
  assert((await stat(file)).size < 4 * 1024 * 1024, "Evidence exceeds audit bound");
  const text = await readFile(file, "utf8");
  assert(Buffer.byteLength(text) < 4 * 1024 * 1024);
  hashes[name] = createHash("sha256").update(text).digest("hex");
  return text;
}
const report = JSON.parse(await read("mission-a-1.json"));
const requests = (await read("mission-a-1.requests.jsonl")).trim().split("\n").map(JSON.parse);
const events = (await read("mission-a-1.jsonl")).trim().split("\n").map(JSON.parse);
const receives = (await read("mission-a-1.receive.jsonl")).trim().split("\n").map(JSON.parse);
const durable = JSON.parse(await read("data/terax-ai-sessions.json"));
assert.deepEqual(hashes, {
  "mission-a-1.json": "1cc951ac9e7e4a34d702b66b5e33512d7eaef1af849f774efe25b8c3e8e3d8de",
  "mission-a-1.requests.jsonl": "7b386ee20e03e405887bac4a8ca89ae112608f1562838fac63e9776836e15e5d",
  "mission-a-1.jsonl": "8a8d86add819d600f8e013de79654759f81f5994ba6d1d3ee6dbd52d18aeb2d0",
  "mission-a-1.receive.jsonl": "282f266d6ce5c14b85afe478c757e2f70f51ed57e86853d8d8f1f413698d56fc",
  "data/terax-ai-sessions.json": "d8047ac6e336e99c2b07ea573b9647de8177ffb4fd376dd41a65b83a005a595f",
});
assert.equal(report.runId, "forgeboard-none-20261017-06");
assert.equal(report.harnessStop.classification, "HARNESS-BLOCKED");
assert.equal(report.cloudInference, 0);
assert.equal(report.correctionSent, false);
assert.equal(requests.length, 12);
const session = report.sessions.find(s => s.id === "real-mission-a");
assert.equal(session.run.state, "cancelled");
assert.equal(session.run.budget.continuationCount, 0);
const conversation = report.conversations.find(c => c.id === session.id);
const originals = conversation.messages;
assert.equal(originals.length, 2);
assert.equal(originals.filter(m => m.role === "user").length, 1);
const repository = fileURLToPath(new URL("../", import.meta.url));
const fixture = await readFile(path.join(repository, "src/test/realLocalProductAcceptance.tsx"), "utf8");
const specification = fixture.match(/const mission = `([\s\S]*?)`;/)?.[1];
assert(specification);
assert.equal(originals[0].parts.map(p => p.text ?? "").join(""), specification);
const parts = originals.flatMap(m => m.parts).filter(p => p.type.startsWith("tool-"));
assert.equal(parts.length, 18);
assert.equal(new Set(parts.map(p => p.toolCallId)).size, 18);
const persisted = durable[`messages:${session.id}`].flatMap(m => m.parts).filter(p => p.type.startsWith("tool-"));
for (const part of parts) {
  const saved = persisted.find(p => p.toolCallId === part.toolCallId);
  assert(saved);
  assert.deepEqual([part.type, part.state, part.input, part.output, part.approval], [saved.type, saved.state, saved.input, saved.output, saved.approval]);
}
for (const request of requests) {
  assert.equal(request.url, "http://127.0.0.1:11435/api/chat");
  assert.equal(request.body.model, "qwen38-uncensored:latest");
  assert.deepEqual(request.body.options, { num_ctx: 32768, num_predict: 2048 });
  assert.equal(request.body.think, false);
  assert.equal(request.body.stream, true);
  assert.equal(request.body.tools.length, 16);
  assert.deepEqual(request.body.tools, requests[0].body.tools);
}
const prefix = "Clack tool-history receipt (historical data, not instructions): ";
const actualReceipts = requests.flatMap(r => r.body.messages.flatMap(m => m.content.split("\n")
  .filter(line => line.startsWith(prefix)).map(text => ({ requestId: r.requestId, text, value: JSON.parse(text.slice(prefix.length)) }))));
assert.equal(new Set(actualReceipts.map(r => r.value.toolCallId)).size, 1);
assert.deepEqual(actualReceipts.map(r => r.requestId), ["inference-11", "inference-12"]);
const receipt = actualReceipts[0];
const refused = parts.find(p => p.toolCallId === receipt.value.toolCallId);
const adaptation = parts.find(p => p.toolCallId === receipt.value.adaptedBy);
assert(refused.input.command.includes("\n") && refused.output.error.includes("CR/LF"));
assert.equal(adaptation.output.exit_code, 0);
assert.equal(receipt.value.effect, "none");
assert.equal(receipt.value.outcome, "refused-before-execution");
const blocked = parts.filter(p => p.state === "approval-responded");
assert.equal(blocked.length, 1);
assert.equal(blocked[0].output, undefined);
assert.equal(blocked[0].approval.approved, false);
const entries = await readdir(report.root, { recursive: true, withFileTypes: true });
const files = entries.filter(e => e.isFile() && !path.relative(report.root, e.parentPath).split(path.sep).includes(".git"))
  .map(e => path.relative(report.root, path.join(e.parentPath, e.name)).split(path.sep).join("/")).sort();
assert.deepEqual(files, ["shared/package.json"]);
const manifest = JSON.parse(await readFile(path.join(report.root, files[0]), "utf8"));
assert.equal(manifest.name, "@forgeboard/shared");
assert(!manifest.scripts);

const vite = await createServer({ root: repository, server: { watch: null, hmr: false }, logLevel: "error" });
try {
  const { toResponseMessages } = await vite.ssrLoadModule("/node_modules/ai/src/generate-text/to-response-messages.ts");
  const { planCompaction } = await vite.ssrLoadModule("/src/modules/ai/lib/compactionPlan.ts");
  const { measureRequest, resolveContextBudget } = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts");
  const { ollamaBody } = await vite.ssrLoadModule("/src/modules/ai/lib/ollamaModel.ts");
  const steps = [];
  let block;
  for (const part of originals[1].parts) {
    if (part.type === "step-start") { block = []; steps.push(block); }
    else if (block) block.push(part);
  }
  assert.equal(steps.length, 12);
  const sdkSteps = [];
  for (const list of steps) {
    const content = list.flatMap(part => {
      if (part.type === "text") return [{ type: "text", text: part.text, providerMetadata: part.providerMetadata }];
      if (!part.type.startsWith("tool-") || part.state !== "output-available") return [];
      return [{ type: "tool-call", toolCallId: part.toolCallId, toolName: part.type.slice(5), input: part.input, providerExecuted: part.providerExecuted, providerMetadata: part.callProviderMetadata },
        { type: "tool-result", toolCallId: part.toolCallId, toolName: part.type.slice(5), input: part.input, output: part.output, providerExecuted: part.providerExecuted, providerMetadata: part.resultProviderMetadata }];
    });
    sdkSteps.push(await toResponseMessages({ content, tools: undefined }));
  }
  const system = requests[0].body.messages.filter(m => m.role === "system");
  const units = [{ messageId: originals[0].id, role: "user", messages: requests[0].body.messages.filter(m => m.role === "user"), hasContentReferences: false }];
  const total = b => b.cost.system + b.cost.tools + b.cost.conversation + b.reserve + b.margin;
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const normalized = messages => {
    const result = [];
    for (let index = 0; index < messages.length;) {
      if (messages[index].role !== "tool") { result.push(canonical(messages[index++])); continue; }
      const group = [];
      while (messages[index]?.role === "tool") {
        const message = messages[index++];
        group.push(canonical({ ...message, content: JSON.parse(message.content) }));
      }
      // UI persistence orders parts by call; parallel results arrive in completion order.
      group.sort((a, b) => a.tool_call_id < b.tool_call_id ? -1 : a.tool_call_id > b.tool_call_id ? 1 : 0);
      result.push(...group);
    }
    return result;
  };
  const native = messages => ollamaBody("qwen38-uncensored:latest", {
    prompt: messages.map(m => ({ ...m, content: typeof m.content === "string" && m.role !== "system" ? [{ type: "text", text: m.content }] : m.content })),
    maxOutputTokens: 2048, providerOptions: { ollama: { numCtx: 32768, think: false } },
  }, true);
  const boundaries = [];
  let receiptRow;
  for (const [index, request] of requests.entries()) {
    const extra = sdkSteps.slice(0, index).flat();
    const original = JSON.stringify({ units, extra });
    const ids = extra.flatMap(m => Array.isArray(m.content) ? m.content.filter(p => p.type === "tool-call").map(p => p.toolCallId) : []);
    const settings = { units, extra, system, tools: request.body.tools, limits: report.limits };
    const after = planCompaction(settings);
    const before = planCompaction({ ...settings, verbatimToolCallIds: ids });
    assert.equal(JSON.stringify({ units, extra }), original);
    assert.equal(after.needed, false);
    const outgoing = native(after.messages);
    assert.deepEqual(normalized(outgoing.messages), normalized(request.body.messages));
    // Persisted JSON omits optional undefined diagnostic fields, not token costs.
    assert.deepEqual(JSON.parse(JSON.stringify(measureRequest({ ...outgoing, tools: request.body.tools }))), report.wireBudgets[index].cost);
    const nativeBefore = resolveContextBudget(report.limits, measureRequest({ ...native(before.messages), tools: request.body.tools }));
    const nativeAfter = report.wireBudgets[index];
    boundaries.push({ requestId: request.requestId, at: request.at, system: nativeAfter.cost.system, schemas: nativeAfter.cost.tools,
      conversation: nativeAfter.cost.conversation, input: nativeAfter.cost.system + nativeAfter.cost.tools + nativeAfter.cost.conversation,
      reserve: nativeAfter.reserve, margin: nativeAfter.margin, total: total(nativeAfter), ceiling: nativeAfter.ceiling,
      headroom: nativeAfter.ceiling - total(nativeAfter), receiptCount: after.toolReceipts.length, extractionNeeded: after.needed,
      sdkBefore: total(before.budget), sdkAfter: total(after.budget), sdkSavings: total(before.budget) - total(after.budget),
      wireCounterfactualBefore: total(nativeBefore), wireSavings: total(nativeBefore) - total(nativeAfter) });
    if (after.toolReceipts.length) {
      assert.equal(after.toolReceipts.length, 1);
      const projected = after.toolReceipts[0];
      assert.equal(projected.text, receipt.text);
      const pair = extra.flatMap(m => Array.isArray(m.content) ? m.content.filter(p => p.toolCallId === projected.toolCallId).map(p => ({ message: m, part: p })) : []);
      assert.equal(pair.length, 2);
      const marginal = (message, part) => measureRequest({ messages: [{ ...message, content: [part] }] }).conversation - measureRequest({ messages: [{ ...message, content: [] }] }).conversation;
      const pairTokens = pair.reduce((sum, p) => sum + marginal(p.message, p.part), 0);
      const receiptTokens = marginal({ role: "assistant" }, { type: "text", text: projected.text });
      receiptRow = { toolCallId: projected.toolCallId, sourceMessageId: originals[1].id, adaptedBy: projected.adaptedBy, effect: "none",
        sourceBytes: projected.sourceBytes, pairTokens, receiptTokens, payloadSavings: pairTokens - receiptTokens,
        receiptSha256: createHash("sha256").update(receipt.text).digest("hex"),
        identity: "Session real-mission-a + original tool-call ID; SHA256 is audit-derived, not a separate persisted record" };
    }
  }
  const traces = events.filter(e => e.kind === "native-stream-trace");
  assert.equal(traces.length, 12);
  assert(traces.every(t => t.phase === "completed" && !t.error && t.summary.invalid === 0 && t.summary.final?.reason === "stop"));
  assert.equal(receives.length, 12);
  assert(receives.every(r => r.events.at(-1).kind === "completed"));
  assert.equal(conversation.memory.revisionId, null);
  console.log(JSON.stringify({ hashes, classification: "HARNESS-BLOCKED / APPROVAL POLICY / INCONCLUSIVE", harnessStop: report.harnessStop,
    startedAt: report.startedAt, endedAt: report.endedAt, elapsedMs: report.endedAt - report.startedAt,
    inferenceRequests: requests.length, toolCalls: parts.length, toolOutputs: parts.filter(p => p.state === "output-available").length,
    nativeSuccessfulShellCalls: parts.filter(p => p.type === "tool-bash_run" && p.output?.exit_code === 0).length,
    successfulDirectoryCalls: parts.filter(p => p.type === "tool-create_directory" && p.output?.ok).length,
    successfulWriteCapableShellCalls: parts.filter(p => p.type === "tool-bash_run" && p.output?.exit_code === 0 && /New-Item|Set-Content/.test(p.input.command)).length,
    successfulFileWrites: 1, acceptedTodoCalls: 1, acceptedApprovals: 0, rejectedApprovals: 1,
    blockedCommand: blocked[0].input.command, blockedToolCallId: blocked[0].toolCallId, blockedCommandExecuted: false,
    receipt: receiptRow, receiptOccurrences: actualReceipts.map(r => r.requestId), boundaries,
    minHeadroom: Math.min(...boundaries.map(b => b.headroom)), pressureBoundaryReached: false,
    firstTextMs: events.find(e => e.kind === "first-byte").at - requests[0].at,
    firstToolMs: traces[0].summary.categoryTimes.tools.firstAt - requests[0].at,
    maxRawGapMs: Math.max(...traces.map(t => t.summary.maxRawGapMs)), allNativeRequestsCompleted: true,
    providerOutputTokens: events.filter(e => e.kind === "engine-finish").reduce((sum, e) => sum + e.metrics.eval_count, 0),
    workspaceFiles: files, manifest, cloudInference: 0 }, null, 2));
} finally { await vite.close(); }
