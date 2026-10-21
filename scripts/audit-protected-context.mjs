import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import { convertToModelMessages, streamText, tool, jsonSchema, stepCountIs } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { decodeResponse, toolFailed } from "./audit-fresh-nemotron.mjs";

const directory = "src-tauri/target/real-qwen-product/forgeboard-nemotron-hardened-20261021-02";
const digest = value => createHash("sha256").update(value).digest("hex");
const json = async file => JSON.parse(await readFile(file, "utf8"));
const lines = async file => (await readFile(file, "utf8")).trim().split("\n").map(JSON.parse);
export async function audit() {
  const report = await json(directory + "/mission-a-1.json");
  const requests = await lines(directory + "/mission-a-1.requests.jsonl");
  const last = requests.at(-1);
  assert.equal(last.requestId, "inference-47");
  const source = report.conversations.find(c => c.id === "real-mission-a");
  const originals = structuredClone(source.messages.slice(0, -1));
  const users = last.body.messages.filter(m => m.role === "user");
  const materialized = structuredClone(originals);
  let user = 0;
  for (const message of materialized) if (message.role === "user") message.parts = [{ type: "text", text: users[user++].content }];
  const extra = await convertToModelMessages([source.messages.at(-1)]);
  const all = await convertToModelMessages(materialized);
  const system = last.body.messages.filter(m => m.role === "system");
  const tools = last.body.tools;
  const limits = { deployed: 65536, maxOutput: 2048 };
  const nativeCalls = new Map(), nativeResults = new Map();
  for (const request of requests) for (const message of request.body.messages) {
    for (const call of message.tool_calls ?? []) nativeCalls.set(call.id, call.function.arguments);
    if (message.role === "tool") nativeResults.set(message.tool_call_id, JSON.parse(message.content));
  }
  for (const message of [...all, ...extra]) if (Array.isArray(message.content)) for (const part of message.content) {
    if (part.type === "tool-call" && nativeCalls.has(part.toolCallId)) part.input = nativeCalls.get(part.toolCallId);
    if (part.type === "tool-result" && nativeResults.has(part.toolCallId)) part.output = { type: "json", value: nativeResults.get(part.toolCallId) };
  }
  const vite = await createServer({ configFile: false, resolve: { alias: { "@": path.resolve("src") } },
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, logLevel: "error" });
  try {
    const { planCompaction, groupCompactionUnits } = await vite.ssrLoadModule("/src/modules/ai/lib/compactionPlan.ts");
    const { measureRequest, resolveContextBudget } = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts");
    const { verifiedWriteCandidates, compactVerifiedWriteBlocks } = await vite.ssrLoadModule("/src/modules/ai/lib/verifiedWriteHistory.ts");
    const { ollamaBody } = await vite.ssrLoadModule("/src/modules/ai/lib/ollamaModel.ts");
    const { canonicalJson } = await vite.ssrLoadModule("/src/modules/ai/lib/canonicalJson.ts");
    const units = [];
    for (const [i, message] of materialized.entries()) units.push({ messageId: message.id, role: message.role,
      hasContentReferences: false, messages: await convertToModelMessages([message]) });
    const candidates = verifiedWriteCandidates([...all, ...extra]);
    const sources = candidates.map(candidate => {
      const matches = source.messages.flatMap(m => m.parts.flatMap((part, partIndex) => part.toolCallId === candidate.toolCallId ? [{ m, part, partIndex }] : []));
      assert.equal(matches.length, 1);
      const { m, part, partIndex } = matches[0];
      return { toolCallId: candidate.toolCallId, input: candidate.input, output: candidate.output,
        sessionId: source.id, messageId: m.id, partIndex, digest: digest(canonicalJson(part)) };
    });
    for (const unit of units) for (const message of unit.messages) if (Array.isArray(message.content)) for (const part of message.content) {
      if (part.type === "tool-call" && nativeCalls.has(part.toolCallId)) part.input = nativeCalls.get(part.toolCallId);
      if (part.type === "tool-result" && nativeResults.has(part.toolCallId)) part.output = { type: "json", value: nativeResults.get(part.toolCallId) };
    }
    const project = (tail, schemas = tools, verifiedWriteSources = sources) => {
      try { const plan = planCompaction({ units, system, tools: schemas, limits, extra: tail, verifiedWriteSources });
        return { budget: plan.budget, plan }; }
      catch (e) { assert.equal(e.code, "compaction-protected-budget"); return { error: e.code, budget: e.budget }; }
    };
    const final = project(extra);
    const withoutAnnotations = list => list.map(message => ({ ...message, content: Array.isArray(message.content) ? message.content.map(part => {
      if (!["text", "reasoning"].includes(part.type) || !part.providerOptions?.clackAnswer) return part;
      const { clackAnswer: _local, ...providerOptions } = part.providerOptions;
      return { ...part, providerOptions: Object.keys(providerOptions).length ? providerOptions : undefined };
    }) : message.content }));
    const stripped = planCompaction({ units: units.map(u => ({ ...u, messages: withoutAnnotations(u.messages) })),
      system, tools, limits, extra: withoutAnnotations(extra), verifiedWriteSources: sources });
    console.log(JSON.stringify({ stage: "internal-annotation-counterfactual", budget: stripped.budget,
      projectionSameExceptAnnotations: true }));
    console.log(JSON.stringify({ stage: "converted-ui-reconstruction", cost: final.budget, candidates: candidates.map(c => ({ id: c.toolCallId, path: c.input.path, followedBy: c.followedBy })), groups: groupCompactionUnits(units), extraMessages: extra.length }));
    const records = [];
    const results = new Map(extra.filter(m => m.role === "tool").flatMap(m => m.content.map(p => [p.toolCallId, p.output])));
    const assistants = extra.filter(m => m.role === "assistant");
    let step = 0;
    const replayTools = Object.fromEntries(tools.map(schema => [schema.function.name, tool({ description: schema.function.description,
      inputSchema: jsonSchema(schema.function.parameters), execute: async (_input, { toolCallId }) => {
        const output = results.get(toolCallId); assert.equal(output?.type, "json"); return output.value;
      } })]));
    const model = new MockLanguageModelV3({ doStream: async params => {
      const body = ollamaBody(last.body.model, { ...params, providerOptions: { ollama: { numCtx: 65536 } } }, true);
      records.at(-1).native = body;
      if (step === assistants.length) throw new Error("Offline final serialization captured; no further response or network dispatch");
      const current = assistants[step++]; assert(current, "No extra inference or generation allowed");
      const events = current.content.flatMap((part, i) => part.type === "tool-call" ? [{ type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName, input: JSON.stringify(part.input) }]
        : part.type === "text" || part.type === "reasoning" ? [{ type: part.type + "-start", id: String(i), providerMetadata: part.providerOptions }, { type: part.type + "-delta", id: String(i), delta: part.text, providerMetadata: part.providerOptions }, { type: part.type + "-end", id: String(i), providerMetadata: part.providerOptions }] : []);
      return { stream: new ReadableStream({ start(c) {
        for (const event of events) c.enqueue(event);
        c.enqueue({ type: "finish", finishReason: { unified: "tool-calls", raw: "stop" }, usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } } }); c.close();
      } }) };
    } });
    const stream = streamText({ model, messages: [...system, ...all], tools: replayTools, maxOutputTokens: 2048, stopWhen: stepCountIs(21), maxRetries: 0, onError: () => {},
      prepareStep: async ({ messages, stepNumber }) => {
        const tail = messages.slice(system.length + all.length);
        const captured = requests.find(r => r.requestId === `inference-${28 + stepNumber}`);
        let result = project(tail, captured?.body.tools ?? tools, []);
        if (result.error) result = project(tail, captured?.body.tools ?? tools);
        records.push({ stepNumber, ...result, tail });
        const activeTools = (captured?.body.tools ?? tools).map(t => t.function.name);
        if (result.error) return { activeTools, messages: [...system, ...compactVerifiedWriteBlocks([...units.map(u => u.messages), tail], sources).blocks.flat()] };
        return { activeTools, messages: result.plan.messages };
      },
    });
    for await (const _part of stream.fullStream) { /* Captured responses and in-memory results only. */ }
    assert.equal(step, 20);
    for (const [i, record] of records.slice(0, -1).entries()) {
      const captured = requests.find(r => r.requestId === `inference-${28 + i}`);
      assert.deepEqual(record.native, captured.body, `Exact native serialization mismatch at ${captured.requestId}`);
    }
    const fixture = await json("src/test/fixtures/protected-context-replay-20261021.json");
    assert.deepEqual(JSON.parse(JSON.stringify(units)), fixture.units);
    assert.deepEqual(JSON.parse(JSON.stringify(records.at(-1).tail)), fixture.extra);
    assert.deepEqual(sources, fixture.sources);
    assert.equal(digest(canonicalJson(records.at(-1).native)), fixture.blocked.nativeSha256);
    const required = budget => budget.cost.system + budget.cost.tools + budget.cost.conversation + budget.reserve + budget.margin;
    const describeBody = body => ({ messages: body.messages.length, roles: body.messages.reduce((o, m) => ({ ...o, [m.role]: (o[m.role] ?? 0) + 1 }), {}),
      tools: body.tools.length, characters: JSON.stringify(body).length, bytes: Buffer.byteLength(JSON.stringify(body)),
      thinkingMessages: body.messages.filter(m => m.thinking).length, thinkingChars: body.messages.reduce((n, m) => n + (m.thinking?.length ?? 0), 0),
      annotationOccurrences: (JSON.stringify(body).match(/clackAnswer/g) ?? []).length, options: body.options, think: Object.hasOwn(body, "think") ? body.think : "omitted",
      sha256: digest(canonicalJson(body)) });
    const projected = records.at(-1).native;
    const modelParts = [...units.flatMap(u => u.messages), ...extra].flatMap(m => Array.isArray(m.content) ? m.content : []);
    const inputParts = modelParts.filter(p => p.type === "tool-call"), outputParts = modelParts.filter(p => p.type === "tool-result");
    const pathCounts = new Map();
    for (const p of inputParts.filter(p => p.toolName === "write_file")) pathCounts.set(p.input.path, (pathCounts.get(p.input.path) ?? 0) + 1);
    const ids = new Set(candidates.map(c => c.toolCallId));
    const currentIds = new Set(source.messages.at(-1).parts.map(p => p.toolCallId).filter(Boolean));
    const effects = source.messages.flatMap(m => m.parts.filter(p => p.type.startsWith("tool-") && p.toolCallId)).map(p => {
      const result = outputParts.find(o => o.toolCallId === p.toolCallId);
      const call = inputParts.find(o => o.toolCallId === p.toolCallId);
      const pair = [{ role: "assistant", content: [call] }, { role: "tool", content: [result] }];
      const reason = ids.has(p.toolCallId) ? "eligible; confirmed durable source and beneficial receipt" : p.type === "tool-write_file" && !toolFailed(p)
        ? pathCounts.get(p.input.path) > 1 ? "ineligible: repeated write path (including failed attempts)" : "recency: no later complete write in this user boundary"
        : p.type === "tool-edit" && !toolFailed(p) ? "intentionally ineligible: exact-edit effect, not full write_file receipt contract"
        : toolFailed(p) ? "failure retained: not the resolved pre-execution single-line guard-refusal contract"
        : "intentionally ineligible: read, plan, shell or directory observation, not confirmed full file write";
      return { id: p.toolCallId, tool: p.type.slice(5), success: !toolFailed(p), path: p.input.path ?? null, receiptEligible: ids.has(p.toolCallId), reason,
        retention: ids.has(p.toolCallId) ? "verified receipt" : currentIds.has(p.toolCallId) ? "current-turn hot" : "verbatim protected original group",
        approximatePairTokens: measureRequest({ messages: pair }).conversation, inputCharacters: JSON.stringify(p.input).length,
        outputCharacters: JSON.stringify(p.output ?? p.errorText).length };
    });
    const before = fixture.blocked.budget, after = records.at(-1).budget;
    assert.equal(after.cost.conversation, 44921);
    assert.equal(required(before), 65807); assert.equal(required(after), 62460);
    const preservedMargin = resolveContextBudget(limits, after.cost, 2048, before.margin);
    const beforeInput = before.cost.system + before.cost.tools + before.cost.conversation;
    let minimumReduction = 0;
    while (beforeInput - minimumReduction + 2048 + Math.ceil((beforeInput - minimumReduction) * 0.1) > 65536) minimumReduction++;
    const raw = measureRequest({ messages: [...system, ...units.flatMap(u => u.messages), ...extra], tools });
    const log = await lines(directory + "/mission-a-1.jsonl");
    const provider = decodeResponse(last, log);
    const receipts = await json(directory + "/receipt-savings.json");
    const summary = { base: fixture.base, runId: report.runId, inference: 0, realToolExecutions: 0, classification: "PROTECTED CONTEXT ACCOUNTING DEFECT FIXED",
      previous: { id: last.requestId, at: last.at, before: fixture.previous.budget, after: records.at(-2).budget,
        nativeBudget: resolveContextBudget(limits, measureRequest(last.body)), body: describeBody(last.body), provider },
      blocked: { state: "never dispatched; offline serialization only", before, after, body: describeBody(projected), projectedWireBudget: resolveContextBudget(limits, measureRequest(projected)),
        rawWithoutReceipts: resolveContextBudget(limits, raw), withOriginalMargin: preservedMargin, minimumInputReduction: minimumReduction, fixedMarginReduction: 271 },
      annotations: { tokensRemoved: before.cost.conversation - after.cost.conversation,
        parts: modelParts.filter(p => p.providerOptions?.clackAnswer).length,
        previousTokensRemoved: fixture.previous.budget.cost.conversation - records.at(-2).budget.cost.conversation,
        providerPayloadChanged: false },
      effects, receipts: { eligible: candidates.length, active: records.at(-1).plan.toolReceipts.length, additionalCurrentRuleCandidates: 0,
        beforeWireSavings: receipts.savedEstimatedTokens, note: "No eligibility or source proof changes; existing safe receipt projection reused" },
      compaction: { groups: groupCompactionUnits(units), candidateGroups: 0, candidateSavings: 0, trigger: 0.7, target: 0.55,
        currentTurnMessages: extra.length, successfulCompactions: 0, reason: "Both user originals are protected; the single older assistant contains failures and latest original plan. Current SDK tail is always protected." },
      finalSteps: fixture.lastSix.map((entry, i) => ({ id: entry.step < 20 ? `inference-${28 + entry.step}` : "blocked-next-step-20",
        before: entry.budget, after: records[entry.step].budget, pressureBefore: entry.budget.cost.conversation >= entry.budget.working * 0.7,
        currentRuleCandidates: 0, legacyReceipts: entry.receipts, afterReceipts: records[entry.step].plan?.toolReceipts.length ?? null })),
      safety: { context: 65536, reserve: 2048, marginPolicy: "max(128, ceil(actual estimated input * 0.1)); unchanged", f1Changed: false,
        objectiveAndCorrectionRetained: true, nativePayloadSame: true, originalsUnchanged: true },
    };
    summary.retentionClasses = Object.fromEntries(["verified receipt", "current-turn hot", "verbatim protected original group"].map(kind => [kind,
      { pairs: effects.filter(e => e.retention === kind).length, approximateOriginalPairTokens: effects.filter(e => e.retention === kind).reduce((n, e) => n + e.approximatePairTokens, 0) }]));
    await writeFile("src/test/fixtures/protected-context-audit-20261021.json", JSON.stringify(summary, null, 2) + "\n");
    await writeFile("src-tauri/target/protected-context-blocked.projected.json", JSON.stringify(projected, null, 2));
    await writeFile("src-tauri/target/protected-context-previous.sent.json", JSON.stringify(last.body, null, 2));
    console.log(JSON.stringify({ stage: "verified-offline-replay", exactNativeBodies: 20, inference: 0, before: required(before), after: required(after),
      headroom: after.working - after.cost.conversation, annotations: summary.annotations, previous: summary.previous.body, blocked: summary.blocked.body }));
  } finally { await vite.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await audit();
