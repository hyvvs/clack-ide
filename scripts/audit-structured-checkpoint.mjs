import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import { exactJsonDelta, replacePairsWithAuditReceipts } from "./audit-long-horizon-context.mjs";
import { digest, sealCheckpoint, obligationState, writeEligibility, restoreDesignSource, removeDesignPairs, renderCheckpoint } from "./structured-checkpoint-design.mjs";

const json = async file => JSON.parse(await readFile(file, "utf8"));
const directory = "src-tauri/target/real-qwen-product/forgeboard-nemotron-hardened-20261021-04";
const output = "src-tauri/target/structured-checkpoint-audit";

export async function offlineRuntime() {
  const vite = await createServer({ configFile: false, resolve: { alias: { "@": path.resolve("src") } },
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, logLevel: "error" });
  try {
    const context = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts");
    const { ollamaBody } = await vite.ssrLoadModule("/src/modules/ai/lib/ollamaModel.ts");
    const capture = await json("src/test/fixtures/length-continuation-replay-20261021.json");
    const params = structuredClone(capture.params);
    params.prompt = [...params.prompt.filter(m => m.role === "system"), { role: "system", content:
      "Continue the SAME assistant answer exactly from its last character. Do not repeat any prior text, restart the task, or add a new introduction. Preserve whitespace, code and Markdown. Existing permissions and approvals remain in force." },
      ...params.prompt.filter(m => m.role !== "system"), { role: "assistant", content: [{ type: "text", text: capture.response.text }] }];
    const body = ollamaBody("nemotron-3.5-lightning:30b-a3b-q4_K_M", params, true);
    assert.equal(digest(body), capture.expected.blockedNativeSha256);
    const budget = (request, ceiling = 65536) => {
      const b = context.resolveContextBudget({ ...capture.limits, deployed: ceiling }, context.measureRequest(request), 2048);
      const input = b.cost.system + b.cost.tools + b.cost.conversation;
      return { input, reserve: b.reserve, margin: b.margin, ceiling: b.ceiling,
        required: input + b.reserve + b.margin, headroom: b.ceiling - input - b.reserve - b.margin, fits: b.fits };
    };
    return { vite, body, budget, ...context };
  } catch (error) { await vite.close(); throw error; }
}
export function nativePairs(body) {
  return body.messages.flatMap((message, index) => (message.tool_calls ?? []).map(call => {
    const result = body.messages.find(m => m.role === "tool" && m.tool_call_id === call.id); assert(result);
    return { id: call.id, name: call.function.name, input: call.function.arguments, result: JSON.parse(result.content), index };
  }));
}
export function structuralProjection(body, checkpoint) {
  const projected = structuredClone(body), pairs = nativePairs(body);
  for (const pair of pairs) {
    const result = projected.messages.find(m => m.tool_call_id === pair.id);
    if (pair.name === "bash_run" && pair.result.exit_code === 0 && pair.result.timed_out === false &&
      pair.result.truncated === false && pair.result.command === pair.input.command) {
      const value = structuredClone(pair.result); delete value.command; value.commandFromToolCall = pair.id;
      result.content = JSON.stringify(value);
    }
    if (pair.name === "grep" && pair.result.hits?.length) {
      const value = structuredClone(pair.result), indexes = [];
      for (const [index, hit] of value.hits.entries()) {
        if (!hit.rel || /[\\\x00-\x1f]/.test(hit.rel) || hit.rel.split("/").some(p => !p || p === "." || p === "..") || hit.path !== `${value.root}/${hit.rel}`) continue;
        indexes.push(index); delete hit.path;
      }
      if (indexes.length) { value.factoredHitPaths = { indexes, format: "root + '/' + rel; historical observation, not current state" }; result.content = JSON.stringify(value); }
    }
  }
  const plans = pairs.filter(p => p.name === "todo_write"), latest = plans.at(-1), replacements = new Map();
  for (const pair of plans.slice(0, -1)) replacements.set(pair.id, {
    version: 1, kind: "superseded-plan-exact-delta", toolCallId: pair.id,
    source: checkpoint.sources.find(s => s.id === pair.id).originalLocator,
    base: { toolCallId: latest.id, source: checkpoint.sources.find(s => s.id === latest.id).originalLocator, inputSha256: digest(latest.input) },
    restoreOriginalInput: exactJsonDelta(pair.input, latest.input), originalResult: structuredClone(body.messages.find(m => m.tool_call_id === pair.id)),
    currentPlan: "base remains verbatim; completion marks are model reports, not verified effects", replay: "never",
  });
  return replacePairsWithAuditReceipts(projected, replacements);
}
export function proposedProjection(body, checkpoint) {
  const structural = structuralProjection(body, checkpoint);
  const removed = removeDesignPairs(structural, checkpoint.retired.map(r => r.source));
  const projected = structuredClone(removed);
  projected.messages.splice(-1, 0, { role: "assistant", content: renderCheckpoint(checkpoint) });
  return { structural, removed, projected };
}

export async function audit() {
  const runtime = await offlineRuntime();
  try {
    const { body, budget, measureRequest } = runtime;
    const prior = await json("src/test/fixtures/long-horizon-audit-20261021.json");
    const report = await json(`${directory}/mission-a-1.json`), freeze = await json(`${directory}/source-freeze.json`);
    for (const artifact of prior.provenance.artifacts) assert.equal(digest(await readFile(`${directory}/${artifact.name}`)), artifact.sha256);
    const session = report.conversations.find(c => c.id === "real-mission-a");
    const owner = { sessionId: session.id, workspaceId: report.sessions.find(s => s.id === session.id).profile.workspaceId };
    const pairs = nativePairs(body), plans = pairs.filter(p => p.name === "todo_write"), latest = plans.at(-1);
    const parts = session.messages.flatMap(m => m.parts.flatMap((p, partIndex) => p.toolCallId ? [{ value: p, messageId: m.id, partIndex }] : []));
    const source = id => {
      const matches = parts.filter(p => p.value.toolCallId === id); assert.equal(matches.length, 1);
      const p = matches[0];
      return { id, ...owner, locator: { kind: "part", messageId: p.messageId, partIndex: p.partIndex }, digest: digest(p.value),
        originalLocator: { sessionId: owner.sessionId, messageId: p.messageId, partIndex: p.partIndex, digest: digest(p.value) } };
    };
    const users = session.messages.filter(m => m.role === "user");
    const sources = [...new Set([...plans.map(p => p.id), ...parts.filter(p => p.value.type === "tool-write_file").map(p => p.value.toolCallId),
      ...pairs.filter(p => p.name === "bash_run" && p.result.exit_code !== 0).map(p => p.id)])].map(source);
    for (const user of users) sources.push({ id: user.id, ...owner, locator: { kind: "message", messageId: user.id }, digest: digest(user) });
    const userText = user => user.parts.filter(p => p.type === "text").map(p => p.text).join("\n");
    const original = userText(users[0]), correction = userText(users[1]);
    assert(body.messages.find(m => m.role === "user").content === original);
    const writes = pairs.filter(p => p.name === "write_file");
    const retired = writes.filter(p => writes.findLast(w => w.input.path === p.input.path).id !== p.id).map(p => ({
      source: p.id, path: p.input.path.slice(freeze.root.length + 1), successor: writes.findLast(w => w.input.path === p.input.path).id,
      originalContentDigest: digest(p.input.content), frozenEligibility: "NOT ESTABLISHED: native observation, retained dependency graph and provider adapter proof absent",
    }));
    const workspace = parts.filter(p => p.value.type === "tool-write_file").filter(p => !parts.some(later =>
      later.value.type === "tool-write_file" && later.value.input.path === p.value.input.path && parts.indexOf(later) > parts.indexOf(p))).map(p => {
      const relative = p.value.input.path.slice(freeze.root.length + 1), observed = freeze.files.find(f => f.path === relative);
      assert.equal(digest(p.value.input.content), observed.sha256);
      return { id: `path:${relative}`, workspaceId: owner.workspaceId, path: relative, digest: observed.sha256,
        source: p.value.toolCallId, exists: true, freshness: "archived-snapshot-only; dispatch freshness unknown", effect: "write", observedAt: freeze.at };
    });
    const failures = pairs.filter(p => p.name === "bash_run" && p.result.exit_code !== 0).map(p => ({ source: p.id,
      category: p.result.exit_code === 2 ? "shell quoting; exit 2" : p.id === "call_xjdmv59j" ? "unsupported wc command; exit 1" : "shell syntax/quoting; exit 1",
      disposition: "unresolved; still-needed syntax evidence", resolution: null, commandDigest: digest(p.input.command), outputDigest: digest(p.result) }));
    const obligations = latest.input.todos.map(t => ({ id: t.id, title: t.title, description: t.description,
      state: obligationState(t.status, [], {}), modelStatus: t.status, sources: [latest.id], completionProof: null }));
    const versions = { conversation: digest(session.messages), intent: digest(users), plan: digest(latest.input),
      effects: digest(parts.filter(p => p.value.type === "tool-write_file")), workspace: digest(workspace), validation: digest([]), failures: digest(failures) };
    const checkpoint = sealCheckpoint({ version: 1, owner, versions, sources,
      intent: [{ id: "objective", key: "objective", order: 0, source: users[0].id, exact: original, supersedes: null },
        { id: "page-50", key: "page-size", order: 1, source: users[0].id, exact: "Initial task page size is 50.", supersedes: null },
        { id: "page-25", key: "page-size", order: 2, source: users[1].id, exact: correction, supersedes: "page-50" }],
      obligations, workspace, validation: [], failures, retired,
      edges: retired.map(r => ({ id: `${r.source}->${r.successor}`, from: r.source, to: r.successor, kind: "superseded-full-write", pin: "immutable original source content; not a mutable file path" })),
    });
    const originals = new Map(sources.map(s => {
      const message = session.messages.find(m => m.id === s.locator.messageId); assert(message);
      return [s.id, s.locator.kind === "message" ? message : message.parts[s.locator.partIndex]];
    }));
    for (const source of sources) {
      const restored = restoreDesignSource(checkpoint, source.id, originals, owner);
      const native = pairs.find(p => p.id === source.id);
      if (native) { assert.deepEqual(restored.input, native.input); assert.deepEqual(restored.output, native.result); }
    }
    const frozenEligibility = retired.map(row => {
      const original = pairs.find(p => p.id === row.source), latest = pairs.find(p => p.id === row.successor);
      const candidate = { success: original.result.ok === true, permission: "allowed", workspaceId: owner.workspaceId, path: row.path,
        resultVerified: false, resultDigest: row.originalContentDigest, base: null, sources: [row.source], dependencyClosure: "unknown",
        chain: [{ digest: row.originalContentDigest, source: row.source, order: original.index },
          { digest: digest(latest.input.content), parentDigest: row.originalContentDigest, source: row.successor, order: latest.index }] };
      const eligibility = writeEligibility(candidate, { workspaceId: owner.workspaceId, pinned: [], providerHistory: "unknown",
        pathDigest: digest(latest.input.content), fresh: false });
      assert.equal(eligibility.eligible, false);
      return { source: row.source, ...eligibility };
    });
    const { structural, removed, projected } = proposedProjection(body, checkpoint);
    const before = budget(body), after = budget(projected), removedBudget = budget(removed);
    assert.equal(before.input, 61132); assert.equal(before.required, 69294);
    assert.equal(budget(structural).input, prior.structuralOnly.input);
    const checkpointCost = measureRequest({ messages: [{ role: "assistant", content: renderCheckpoint(checkpoint) }] }).conversation;
    assert.equal(after.input - removedBudget.input, checkpointCost);
    const drafts = prior.olderPartialSlices.map(s => {
      const text = body.messages[s.message].content.slice(s.start, s.end); assert.equal(digest(text), s.sha256);
      const origin = session.messages.flatMap(m => m.parts.map((p, partIndex) => ({ p, messageId: m.id, partIndex }))).find(p => p.p.type === "text" && digest(p.p.text) === s.sha256); assert(origin);
      return { ...s, locator: { messageId: origin.messageId, partIndex: origin.partIndex }, characters: text.length,
        type: s.requestId === "inference-32" ? "truncated assistant textual write_file proposal" : "truncated assistant textual bash_run heredoc proposal",
        nativeToolCall: false, applied: false, exactPrefix: text.slice(0, 155), exactSuffix: text.slice(-145),
        proposedIdentifiers: [...new Set([...text.matchAll(/(?:function |const |interface )([A-Za-z][A-Za-z0-9_]+)/g)].map(m => m[1]))],
        unresolvedDependencies: "frontend types/API assumptions, SSE handlers, form/filter/debounce design; later drafts do not prove complete semantic supersession",
        compactable: false, reasonRetained: "SDK text fragments coalesced with next continuation prose; no acknowledged discard or whole replacement; current unfinished App.tsx may depend on them" };
    });
    for (const candidate of [structural, projected]) {
      assert.deepEqual(candidate.messages.filter(m => m.role === "user"), body.messages.filter(m => m.role === "user"));
      assert.equal(candidate.messages.at(-1).content, body.messages.at(-1).content);
      assert.deepEqual(candidate.messages.filter(m => m.thinking).map(m => m.thinking), body.messages.filter(m => m.thinking).map(m => m.thinking));
      assert.deepEqual(candidate.tools, body.tools); assert.deepEqual(candidate.options, body.options);
      for (const f of failures) assert.deepEqual(candidate.messages.find(m => m.tool_call_id === f.source), body.messages.find(m => m.tool_call_id === f.source));
    }
    const summary = { base: "56bb233", classification: "STRUCTURED LONG-HORIZON CHECKPOINT DESIGNED", productionChanges: 0,
      inference: 0, forgeboardRuns: 0, actualProduction: before, actualProductionSavings: 0, checkpoint,
      checkpointCost, structuralBaseline: budget(structural), priorConditional: prior.withConditionalWriteDeltas,
      proposed: { ...after, rawTokensReplaced: before.input - removedBudget.input, netInputSaved: before.input - after.input,
        removedBeyondStructural: budget(structural).input - removedBudget.input,
        originalAbsoluteMarginRequired: after.input + before.reserve + before.margin,
        originalAbsoluteMarginHeadroom: before.ceiling - after.input - before.reserve - before.margin,
        status: "COUNTERFACTUAL CAPACITY ONLY: frozen run lacks required native retention/freshness/dependency/provider proofs; not dispatchable" },
      frozenEligibility, assumptions: ["native result observations and current digest witness", "source/base retention roots committed before projection",
        "proven dependency closure with no unresolved body consumer", "provider adapter authorizes replacing completed native pairs without disturbing active turn"],
      drafts, failures, remaining: prior.inventory.inventory.filter(r => ["older-unfinished-textual-intent", "historical-reasoning", "file-read-results", "current-partial-answer"].includes(r.class)),
      scales: [16384, 32768, 65536, 131072].map(ceiling => ({ ceiling, before: budget(body, ceiling), proposed: budget(projected, ceiling) })),
      provenance: { originalBodySha256: digest(body), transcriptSha256: digest(session), artifactsChecked: prior.provenance.artifacts.length,
        sourceArtifacts: prior.provenance.artifacts, originalsPreserved: true, projectionSha256: digest(projected),
        frozenFilesCompared: workspace.length, newCurrentWorkspaceObservation: false, sourceCount: sources.length, exactSourcesRestored: originals.size },
      providerText: renderCheckpoint(checkpoint), nextCheckpoint: "Implement revision-pinned conversation checkpoint retention and conditional-write projection" };
    await mkdir(output, { recursive: true });
    await writeFile(`${output}/proposed.projected.json`, JSON.stringify(projected, null, 2) + "\n");
    await writeFile("src/test/fixtures/structured-checkpoint-design-20261021.json", JSON.stringify(summary, null, 2) + "\n");
    console.log(JSON.stringify({ classification: summary.classification, checkpointCost, actual: before, structural: summary.structuralBaseline, proposed: summary.proposed, scales: summary.scales }));
  } finally { await runtime.vite.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await audit();
