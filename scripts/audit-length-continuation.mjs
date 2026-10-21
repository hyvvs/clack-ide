import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { convertToModelMessages, streamText, tool, jsonSchema, stepCountIs } from "ai";
import { createServer } from "vite";
import { decodeResponse, toolFailed } from "./audit-fresh-nemotron.mjs";

const directory = "src-tauri/target/real-qwen-product/forgeboard-nemotron-hardened-20261021-04";
const output = "src-tauri/target/length-continuation-audit";
const hash = value => createHash("sha256").update(value).digest("hex");
const json = async file => JSON.parse(await readFile(file, "utf8"));
const rows = async file => (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
const clean = value => JSON.parse(JSON.stringify(value));
export const budgetRecord = budget => {
  const input = budget.cost.system + budget.cost.tools + budget.cost.conversation;
  return { system: budget.cost.system, schemas: budget.cost.tools, conversation: budget.cost.conversation,
    input, reserve: budget.reserve, margin: budget.margin, required: input + budget.reserve + budget.margin,
    ceiling: budget.ceiling, headroom: budget.ceiling - input - budget.reserve - budget.margin };
};
export function capturedFrames(requestId, events) {
  const bytes = events.filter(e => e.kind === "hardened-native-event" && e.event.requestId === requestId && e.event.kind === "chunk")
    .flatMap(e => e.event.bytes);
  return new TextDecoder().decode(Uint8Array.from(bytes)).trim().split("\n").filter(Boolean).map(JSON.parse);
}

export async function audit() {
  const report = await json(`${directory}/mission-a-1.json`);
  const requests = await rows(`${directory}/mission-a-1.requests.jsonl`);
  const events = await rows(`${directory}/mission-a-1.jsonl`);
  const prior = await json("src/test/fixtures/fresh-context-nemotron-20261021.json");
  const setup = await json(`${directory}/setup.json`);
  for (const file of setup.source) assert.equal(hash(await readFile(file.path)), file.sha256);
  for (const artifact of prior.artifacts) assert.equal(hash(await readFile(`${directory}/${artifact.name}`)), artifact.sha256);
  const freeze = await json(`${directory}/source-freeze.json`);
  for (const file of freeze.files) {
    assert.equal(hash(await readFile(`${freeze.root}/${file.path}`)), file.sha256);
    assert.equal(hash(await readFile(`${directory}/independent-project/${file.path}`)), file.sha256);
  }
  const source = report.conversations.find(c => c.id === "real-mission-a");
  const last = requests.at(-1);
  assert.equal(last.requestId, "inference-40");
  const originalBytes = JSON.stringify(source);
  const originals = structuredClone(source.messages.slice(0, -1));
  const users = last.body.messages.filter(m => m.role === "user");
  let user = 0;
  for (const message of originals) if (message.role === "user") message.parts = [{ type: "text", text: users[user++].content }];
  const nativeCalls = new Map(), nativeResults = new Map();
  for (const request of requests) for (const message of request.body.messages) {
    for (const call of message.tool_calls ?? []) nativeCalls.set(call.id, call.function.arguments);
    if (message.role === "tool") nativeResults.set(message.tool_call_id, JSON.parse(message.content));
  }
  const normalize = messages => {
    for (const message of messages) if (Array.isArray(message.content)) for (const part of message.content) {
      if (part.type === "tool-call" && nativeCalls.has(part.toolCallId)) part.input = nativeCalls.get(part.toolCallId);
      if (part.type === "tool-result" && nativeResults.has(part.toolCallId)) part.output = { type: "json", value: nativeResults.get(part.toolCallId) };
    }
    return messages;
  };
  const all = normalize(await convertToModelMessages(originals));
  const extra = normalize(await convertToModelMessages([source.messages.at(-1)]));
  const system = requests.find(r => r.requestId === "inference-19").body.messages.filter(m => m.role === "system");
  const tools = last.body.tools, limits = { deployed: 65536, maxOutput: 2048 };
  const continuations = [], sent = [], steps = [], errors = [], states = [];
  globalThis.__lengthAudit = entry => continuations.push(entry);
  const vite = await createServer({ configFile: false, resolve: { alias: { "@": path.resolve("src") } },
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, logLevel: "error",
    plugins: [{ name: "offline-continuation-observer", enforce: "pre", transform(code, id) {
      if (!id.replaceAll("\\", "/").endsWith("/ai/lib/answerContinuation.ts")) return;
      const needle = "const budget = resolveContextBudget(limits, cost, output);";
      assert.equal(code.split(needle).length, 2);
      return code.replace(needle, needle + "\n globalThis.__lengthAudit({params: {...params, prompt, maxOutputTokens: output}, cost, budget});");
    } }],
  });
  try {
    const { planCompaction, groupCompactionUnits } = await vite.ssrLoadModule("/src/modules/ai/lib/compactionPlan.ts");
    const { measureRequest, resolveContextBudget, estimateTextTokens } = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts");
    const { verifiedWriteCandidates } = await vite.ssrLoadModule("/src/modules/ai/lib/verifiedWriteHistory.ts");
    const { canonicalJson } = await vite.ssrLoadModule("/src/modules/ai/lib/canonicalJson.ts");
    const { createOllamaModel, ollamaBody } = await vite.ssrLoadModule("/src/modules/ai/lib/ollamaModel.ts");
    const { withAnswerContinuation } = await vite.ssrLoadModule("/src/modules/ai/lib/answerContinuation.ts");
    const units = [];
    for (const message of originals) units.push({ messageId: message.id, role: message.role, hasContentReferences: false,
      messages: normalize(await convertToModelMessages([message])) });
    const candidates = verifiedWriteCandidates([...all, ...extra]);
    const sources = candidates.map(candidate => {
      const matches = source.messages.flatMap(m => m.parts.flatMap((part, partIndex) => part.toolCallId === candidate.toolCallId ? [{ m, part, partIndex }] : []));
      assert.equal(matches.length, 1);
      const { m, part, partIndex } = matches[0];
      return { toolCallId: candidate.toolCallId, input: candidate.input, output: candidate.output, sessionId: source.id,
        messageId: m.id, partIndex, digest: hash(canonicalJson(part)) };
    });
    const results = new Map(extra.filter(m => m.role === "tool").flatMap(m => m.content.map(p => [p.toolCallId, p.output])));
    const replayTools = Object.fromEntries(tools.map(schema => [schema.function.name, tool({ description: schema.function.description,
      inputSchema: jsonSchema(schema.function.parameters), execute: async (_input, { toolCallId }) => {
        const result = results.get(toolCallId); assert.equal(result?.type, "json", `Uncaptured effect ${toolCallId}`); return result.value;
      } })]));
    let next = 19;
    const base = createOllamaModel({ modelId: last.body.model, baseURL: "http://offline.invalid", fetch: async (_url, init) => {
      const request = requests.find(r => r.requestId === `inference-${next}`);
      assert(request, "No uncaptured inference permitted");
      const body = JSON.parse(init.body);
      await writeFile(`${output}/${request.requestId}.replayed.json`, JSON.stringify(body, null, 2));
      assert.deepEqual(body, request.body, `Native body mismatch: ${request.requestId}`);
      next++;
      sent.push({ requestId: request.requestId, at: request.at, body, params: clean(currentParams), budget: resolveContextBudget(limits, measureRequest(body)) });
      const chunks = events.filter(e => e.kind === "hardened-native-event" && e.event.requestId === request.requestId && e.event.kind === "chunk");
      assert(chunks.length);
      return new Response(new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(Uint8Array.from(chunk.event.bytes)); c.close(); } }),
        { headers: { "content-type": "application/x-ndjson" } });
    } });
    let currentParams;
    const originalStream = base.doStream.bind(base);
    base.doStream = params => { currentParams = params; return originalStream(params); };
    const model = withAnswerContinuation(base, { runId: "offline-frozen", provider: "ollama", modelId: last.body.model,
      isCurrent: () => true, limits: async () => limits, onState: state => states.push(state) });
    await mkdir(output, { recursive: true });
    const stream = streamText({ model, messages: [...system, ...all], tools: replayTools, maxOutputTokens: 2048,
      providerOptions: { ollama: { numCtx: 65536 } }, stopWhen: stepCountIs(30), maxRetries: 0, onError: e => errors.push(e.error),
      prepareStep: async ({ messages, stepNumber }) => {
        const tail = messages.slice(system.length + all.length);
        const captured = requests.find(r => r.requestId === `inference-${next}`);
        let plan;
        const threshold = stepNumber ? 0.55 : 0.7;
        try { plan = planCompaction({ units, system, tools: captured.body.tools, limits, extra: tail, threshold }); }
        catch (error) { assert.equal(error.code, "compaction-protected-budget"); plan = planCompaction({ units, system, tools: captured.body.tools, limits, extra: tail, threshold, verifiedWriteSources: sources }); }
        steps.push({ requestId: captured.requestId, stepNumber, tail: clean(tail), budget: plan.budget, receipts: plan.toolReceipts });
        return { messages: plan.messages, activeTools: captured.body.tools.map(t => t.function.name) };
      },
    });
    for await (const _part of stream.fullStream) { /* Only captured responses; tool results are immutable in-memory fixtures. */ }
    assert.equal(next, 41); assert.equal(sent.length, 22); assert.equal(continuations.length, 3);
    assert.equal(errors.length, 1); assert.equal(errors[0].code, "answer-continuation-budget");
    const blocked = continuations.at(-1);
    const native = ollamaBody(last.body.model, blocked.params, true);
    const previous = sent.at(-1);
    const internalBefore = measureRequest({ system: previous.params.prompt.filter(m => m.role === "system"),
      messages: previous.params.prompt.filter(m => m.role !== "system"), tools: previous.params.tools });
    const textCost = measureRequest({ messages: [blocked.params.prompt.at(-1)] });
    await writeFile(`${output}/blocked-third.projected.json`, JSON.stringify(native, null, 2));
    const describe = body => ({ sha256: hash(canonicalJson(body)), messages: body.messages.length,
      roles: body.messages.reduce((acc, m) => ({ ...acc, [m.role]: (acc[m.role] ?? 0) + 1 }), {}), tools: body.tools.length,
      toolCalls: body.messages.flatMap(m => m.tool_calls ?? []).length, toolResults: body.messages.filter(m => m.role === "tool").length,
      thinkingMessages: body.messages.filter(m => m.thinking).length, thinkingCharacters: body.messages.reduce((n, m) => n + (m.thinking?.length ?? 0), 0),
      directiveCount: body.messages.reduce((n, m) => n + (m.content?.split("Continue the SAME assistant answer").length - 1 || 0), 0),
      localAnnotations: (JSON.stringify(body).match(/clackAnswer/g) ?? []).length,
      context: body.options.num_ctx, output: body.options.num_predict, think: Object.hasOwn(body, "think") ? body.think : "omitted" });
    const response = id => {
      const frames = capturedFrames(id, events);
      return { text: frames.map(f => f.message?.content ?? "").join(""), reasoning: frames.map(f => f.message?.thinking ?? "").join(""),
        calls: frames.flatMap(f => f.message?.tool_calls ?? []), final: frames.findLast(f => f.done) };
    };
    for (const entry of sent) {
      const original = report.wireBudgets.find(b => b.requestId === entry.requestId);
      assert.deepEqual(budgetRecord(entry.budget), budgetRecord(original));
    }
    const chain = [];
    for (const id of [32, 33, 34, 35, 36, 37, 38, 39, 40]) {
      const entry = sent.find(s => s.requestId === `inference-${id}`);
      const decoded = decodeResponse(requests.find(r => r.requestId === entry.requestId), events);
      chain.push({ id: entry.requestId, budget: budgetRecord(entry.budget), body: describe(entry.body),
        response: decoded, sharedMessages: entry.params.prompt.length });
    }
    const preparation = [];
    const occurrences = (value, text) => value.split(text).length - 1;
    const unchangedHistory = [];
    for (const [i, entry] of continuations.entries()) {
      const before = sent.find(s => s.requestId === `inference-${[32, 36, 40][i]}`);
      const history = entry.params.prompt.filter(m => m.role !== "system");
      assert.deepEqual(clean(history.slice(0, -1)), before.params.prompt.filter(m => m.role !== "system"));
      unchangedHistory.push(before.requestId);
      const projected = ollamaBody(last.body.model, entry.params, true);
      const current = response(before.requestId);
      assert.equal(history.at(-1).content[0].text, current.text);
      assert.equal(current.calls.length, 0);
      for (const old of [32, 36, 40].slice(0, i + 1)) {
        assert.equal(occurrences(JSON.stringify(projected.messages), JSON.stringify(response(`inference-${old}`).text).slice(1, -1)), 1);
      }
      const calls = projected.messages.flatMap(m => m.tool_calls ?? []).map(c => c.id);
      const results = projected.messages.filter(m => m.role === "tool").map(m => m.tool_call_id);
      assert.equal(new Set(calls).size, calls.length); assert.deepEqual(calls, results);
      const planState = events.filter(e => e.kind === "state" && e.at <= (sent.find(s => s.requestId === `inference-${[33, 37, 41][i]}`)?.at ?? requests.find(r => r.requestId === before.requestId).at)).at(-1);
      preparation.push({ id: `C${i + 1}`, after: before.requestId, next: i < 2 ? `inference-${[33, 37][i]}` : null,
        shared: budgetRecord(entry.budget), wire: budgetRecord(resolveContextBudget(limits, measureRequest(projected))), body: describe(projected),
        sharedMessages: entry.params.prompt.length, partial: { characters: current.text.length, sha256: hash(current.text),
          sharedMessageCost: measureRequest({ messages: [history.at(-1)] }).conversation,
          textValueCost: estimateTextTokens(current.text),
          producedReasoningCharacters: current.reasoning.length,
          producedReasoningValueCost: current.reasoning ? estimateTextTokens(current.reasoning) : 0,
          producedReasoningMessageCost: current.reasoning ? measureRequest({ messages: [{ role: "assistant", content: [{ type: "reasoning", text: current.reasoning }] }] }).conversation : 0,
          newReasoningCost: 0, newToolCost: 0, nativeCalls: 0 },
        pendingPlan: planState?.sessions.find(s => s.id === source.id)?.todos.filter(t => t.status !== "completed").map(t => t.title) ?? [] });
    }
    const full = await convertToModelMessages(source.messages);
    let annotationCount = 0;
    const stripped = full.map(m => ({ ...m, content: Array.isArray(m.content) ? m.content.map(p => {
      if (!["text", "reasoning"].includes(p.type) || !p.providerOptions?.clackAnswer) return p;
      annotationCount++;
      const { clackAnswer: _local, ...providerOptions } = p.providerOptions;
      return { ...p, providerOptions: Object.keys(providerOptions).length ? providerOptions : undefined };
    }) : m.content }));
    assert.deepEqual(measureRequest({ messages: full }), measureRequest({ messages: stripped }));
    assert.equal(annotationCount, 62);
    const allParts = source.messages.flatMap(m => m.parts.filter(p => p.toolCallId));
    const writes = allParts.filter(p => p.type === "tool-write_file").map(p => {
      const samePath = allParts.filter(q => q.type === "tool-write_file" && q.input.path === p.input.path);
      return { id: p.toolCallId, path: p.input.path, verified: p.output?.ok === true && p.output?.clackWorkspaceWrite === true && p.output.bytesWritten === p.input.content.length,
        eligible: candidates.some(c => c.toolCallId === p.toolCallId), repeatedPath: samePath.length > 1,
        version: samePath.at(-1) === p ? "latest" : "superseded by later full write",
        reason: samePath.length > 1 ? "Repeated path across the source history is deliberately excluded, including the latest version" : "Confirmed full write followed by another complete write in the same user boundary" };
    });
    const failures = allParts.filter(toolFailed).map(p => ({ id: p.toolCallId, tool: p.type, command: p.input.command, exit: p.output?.exit_code,
      retained: native.messages.some(m => m.tool_call_id === p.toolCallId),
      status: "Observation goal later resolved by successful PowerShell line count and read_file; failed command remains relevant shell-syntax evidence",
      receipt: "Not eligible: executed shell failure, not a proven pre-execution exact-edit guard refusal" }));
    assert.equal(failures.length, 4); assert(failures.every(f => f.retained));
    const simulation = [];
    for (const [i, entry] of continuations.entries()) {
      const step = steps.find(s => s.requestId === `inference-${[32, 36, 40][i]}`);
      try {
        const plan = planCompaction({ units, system: entry.params.prompt.filter(m => m.role === "system"), tools: entry.params.tools, limits,
          extra: [...step.tail, entry.params.prompt.at(-1)], verifiedWriteSources: sources, threshold: 0.55 });
        simulation.push({ id: `C${i + 1}`, needed: plan.needed, groups: plan.groups, receipts: plan.toolReceipts.length, budget: budgetRecord(plan.budget) });
      } catch (error) {
        assert.equal(error.code, "compaction-protected-budget");
        simulation.push({ id: `C${i + 1}`, error: error.code, budget: budgetRecord(error.budget) });
      }
    }
    const before = budgetRecord(previous.budget), after = budgetRecord(blocked.budget);
    assert.equal(before.required, 64805); assert.equal(after.required, 68889); assert.equal(after.headroom, -3353);
    const stableParams = clean(previous.params);
    delete stableParams.abortSignal;
    const annotations = new Map();
    for (const message of stableParams.prompt) if (Array.isArray(message.content)) for (const part of message.content) {
      if (!part.providerOptions?.clackAnswer) continue;
      const original = part.providerOptions.clackAnswer.segmentId;
      if (!annotations.has(original)) annotations.set(original, `offline-segment-${annotations.size + 1}`);
      part.providerOptions.clackAnswer.segmentId = annotations.get(original);
    }
    const replay = { base: "b2cd814", requestId: last.requestId, limits, params: stableParams,
      response: response(last.requestId), expected: { sent: before, blocked: after, projected: preparation.at(-1).wire,
        nativeSha256: hash(canonicalJson(last.body)), blockedNativeSha256: hash(canonicalJson(native)) } };
    const summary = { base: "b2cd814", runId: report.runId, inference: 0, network: 0, realEffects: 0,
      classification: "LENGTH-CONTINUATION CONTEXT PREPARATION CORRECT", productionChanges: 0,
      exactNativeReplays: sent.length, normalStepPreparations: steps.length, chain, preparation,
      delta: { from: last.requestId, to: "C3-blocked-after-inference-40", before, after,
        sharedBefore: budgetRecord(resolveContextBudget(limits, internalBefore)),
        stageConversion: { system: internalBefore.system - before.system, schemas: internalBefore.tools - before.schemas,
          conversation: internalBefore.conversation - before.conversation, total: internalBefore.system + internalBefore.tools + internalBefore.conversation - before.input },
        newText: textCost.conversation, newDirective: blocked.cost.system - internalBefore.system,
        newReasoning: 0, newToolInteractions: 0, newObjectivePlanCorrection: 0, newMetadata: 0,
        input: after.input - before.input, margin: after.margin - before.margin, required: after.required - before.required },
      unchangedHistory, annotations: { excluded: annotationCount, budgetChange: 0, nativeOccurrences: describe(native).localAnnotations },
      compaction: { continuationInvokesPlanner: false, normalPlannerBeforeLast: true, groups: groupCompactionUnits(units), eligibleGroups: 0,
        safeGroupSavings: 0, currentTurnProtected: true, simulation, durableCompactions: 0 },
      receipts: { active: steps.at(-1).receipts.length, wireSavings: prior.accounting.receipts.savedEstimatedTokens,
        candidates: candidates.map(c => c.toolCallId), additionalSafe: 0, writes }, failures,
      provenance: { artifactsChecked: prior.artifacts.length, clackSourceFilesChecked: setup.source.length,
        originalFilesChecked: freeze.files.length, independentCopyFilesChecked: freeze.files.length,
        artifacts: prior.artifacts, transcriptUnchanged: true, specificationSha256: prior.userMessages[0].sha256,
        correctionSha256: prior.userMessages[1].sha256 },
      nextCheckpoint: "Audit Long-Horizon Continuation Representation and Safe Compaction" };
    await writeFile("src/test/fixtures/length-continuation-replay-20261021.json", JSON.stringify(replay, null, 2) + "\n");
    await writeFile("src/test/fixtures/length-continuation-audit-20261021.json", JSON.stringify(summary, null, 2) + "\n");
    await writeFile(`${output}/debug.json`, JSON.stringify({ steps, continuations: continuations.map(e => ({ ...e, params: clean(e.params) })), sent }, null, 2));
    console.log(JSON.stringify({ stage: "verified-offline-audit", exactNativeReplays: sent.length, preparation: preparation.map(p => ({ id: p.id, shared: p.shared, wire: p.wire })), delta: summary.delta, simulation, inference: 0 }));
    assert.equal(JSON.stringify(source), originalBytes);
  } finally { delete globalThis.__lengthAudit; await vite.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await audit();
