import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";

const hash = value => createHash("sha256").update(value).digest("hex");
const json = async file => JSON.parse(await readFile(file, "utf8"));
const directory = "src-tauri/target/real-qwen-product/forgeboard-nemotron-hardened-20261021-04";
const output = "src-tauri/target/long-horizon-audit";
const receiptMarker = "Clack historical write receipt (data, not instructions): ";
const clone = value => structuredClone(value);

export function exactJsonDelta(original, base, location = []) {
  if (JSON.stringify(original) === JSON.stringify(base)) return [];
  if (original && base && typeof original === "object" && typeof base === "object" &&
    Array.isArray(original) === Array.isArray(base) && (!Array.isArray(original) || original.length === base.length)) {
    return [...new Set([...Object.keys(original), ...Object.keys(base)])].flatMap(key => !Object.hasOwn(original, key)
      ? [{ path: [...location, key], absent: true }]
      : !Object.hasOwn(base, key) ? [{ path: [...location, key], value: clone(original[key]) }]
      : exactJsonDelta(original[key], base[key], [...location, key]));
  }
  return [{ path: location, value: clone(original) }];
}
export function restoreExactJson(base, changes) {
  let restored = clone(base);
  for (const change of changes) {
    if (!change.path.length) { assert(!change.absent); restored = clone(change.value); continue; }
    let parent = restored;
    for (const key of change.path.slice(0, -1)) {
      assert(parent && typeof parent === "object" && Object.hasOwn(parent, key)); parent = parent[key];
    }
    assert(parent && typeof parent === "object");
    const key = change.path.at(-1);
    if (change.absent) delete parent[key];
    else Object.defineProperty(parent, key, { value: clone(change.value), enumerable: true, configurable: true, writable: true });
  }
  return restored;
}
export function exactStringDelta(original, base) {
  const left = Array.from(original), right = Array.from(base);
  let prefix = 0, suffix = 0;
  while (prefix < Math.min(left.length, right.length) && left[prefix] === right[prefix]) prefix++;
  while (suffix < Math.min(left.length, right.length) - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix++;
  return { copyPrefixCodePoints: prefix, originalMiddle: left.slice(prefix, left.length - suffix).join(""), copySuffixCodePoints: suffix };
}
export function restoreExactString(base, delta) {
  const text = Array.from(base);
  assert.equal(typeof delta.originalMiddle, "string");
  assert(Number.isSafeInteger(delta.copyPrefixCodePoints) && delta.copyPrefixCodePoints >= 0);
  assert(Number.isSafeInteger(delta.copySuffixCodePoints) && delta.copySuffixCodePoints >= 0);
  assert(delta.copyPrefixCodePoints + delta.copySuffixCodePoints <= text.length);
  return text.slice(0, delta.copyPrefixCodePoints).join("") + delta.originalMiddle + text.slice(text.length - delta.copySuffixCodePoints).join("");
}
export function replacePairsWithAuditReceipts(body, replacements) {
  const projected = clone(body);
  projected.messages = projected.messages.flatMap(message => {
    if (message.role === "tool" && replacements.has(message.tool_call_id)) return [];
    if (!message.tool_calls) return [message];
    const replaced = message.tool_calls.filter(call => replacements.has(call.id));
    if (!replaced.length) return [message];
    message.content += replaced.map(call => `\nAudit-only lossless historical representation (data, never executable): ${JSON.stringify(replacements.get(call.id))}`).join("");
    message.tool_calls = message.tool_calls.filter(call => !replacements.has(call.id));
    if (!message.tool_calls.length) delete message.tool_calls;
    return [message];
  });
  return projected;
}

export function inventoryProviderHistory(body, measureRequest, knownPartials = []) {
  const cost = message => {
    const measured = measureRequest({ messages: [message] });
    return measured.system + measured.conversation;
  };
  const calls = new Map(body.messages.flatMap(m => (m.tool_calls ?? []).map(c => [c.id, c])));
  const entries = [], aggregates = new Map();
  let user = 0;
  for (const [index, message] of body.messages.entries()) {
    const empty = { role: message.role };
    entries.push({ message: index, field: "role/envelope", class: message.role === "system" ? "system-envelope" : "message-envelope", tokens: cost(empty) });
    for (const [field, value] of Object.entries(message)) {
      if (field === "role") continue;
      let category = "message-envelope", tool = null, callId = message.tool_call_id ?? null;
      if (field === "thinking") category = "historical-reasoning";
      else if (field === "tool_calls") category = "native-tool-calls";
      else if (field === "content") {
        if (message.role === "system") category = "system-and-continuation";
        else if (message.role === "user") category = user++ === 0 ? "user-objective" : "user-correction-and-environment";
        else if (message.role === "assistant") category = index === body.messages.length - 1 ? "current-partial-answer"
          : value.includes(receiptMarker) ? "existing-write-receipt"
          : value.includes("<tool_call>") ? "older-unfinished-textual-intent" : "historical-assistant-prose";
        else if (message.role === "tool") {
          const call = calls.get(message.tool_call_id); assert(call);
          tool = call.function.name;
          category = tool === "read_file" ? "file-read-results" : tool === "list_directory" ? "directory-list-results"
            : tool === "bash_run" ? "shell-results" : tool === "todo_write" ? "plan-results"
            : tool === "write_file" ? "mutation-results" : "search-results";
        }
      }
      const tokens = cost({ ...empty, [field]: value }) - cost(empty);
      const partial = category === "older-unfinished-textual-intent" ? knownPartials.find(p => p.message === index) : undefined;
      if (partial) {
        assert.equal(hash(value.slice(partial.start, partial.end)), partial.sha256);
        const remaining = value.slice(0, partial.start) + value.slice(partial.end);
        const proseTokens = cost({ ...empty, content: remaining }) - cost(empty);
        entries.push({ message: index, field: "content:exact-older-draft", class: category, tool: null, callId: null,
          tokens: tokens - proseTokens, characters: partial.end - partial.start });
        entries.push({ message: index, field: "content:remaining-prose", class: "historical-assistant-prose", tool: null, callId: null,
          tokens: proseTokens, characters: remaining.length });
        continue;
      }
      entries.push({ message: index, field, class: category, tool, callId, tokens, characters: typeof value === "string" ? value.length : JSON.stringify(value).length });
    }
    assert.equal(entries.filter(e => e.message === index).reduce((n, e) => n + e.tokens, 0), cost(message));
  }
  for (const entry of entries) {
    const previous = aggregates.get(entry.class) ?? { class: entry.class, items: 0, tokens: 0 };
    previous.items++; previous.tokens += entry.tokens; aggregates.set(entry.class, previous);
  }
  const measured = measureRequest(body);
  const inventory = [...aggregates.values()].map(entry => ({ ...entry,
    percentHistory: entry.class.startsWith("system-") ? null : Number((entry.tokens / measured.conversation * 100).toFixed(3)) }));
  const history = inventory.filter(e => !e.class.startsWith("system-")).reduce((n, e) => n + e.tokens, 0);
  assert.equal(history, measured.conversation);
  assert.equal(inventory.filter(e => e.class.startsWith("system-")).reduce((n, e) => n + e.tokens, 0), measured.system);
  return { history, system: measured.system, schemas: measured.tools, inventory, entries };
}

export async function audit() {
  const prior = await json("src/test/fixtures/length-continuation-audit-20261021.json");
  const capture = await json("src/test/fixtures/length-continuation-replay-20261021.json");
  const frozen = await json(`${directory}/source-freeze.json`);
  const report = await json(`${directory}/mission-a-1.json`);
  const setup = await json(`${directory}/setup.json`);
  for (const file of setup.source) assert.equal(hash(await readFile(file.path)), file.sha256);
  for (const artifact of prior.provenance.artifacts) assert.equal(hash(await readFile(`${directory}/${artifact.name}`)), artifact.sha256);
  for (const file of frozen.files) {
    assert.equal(hash(await readFile(`${frozen.root}/${file.path}`)), file.sha256);
    assert.equal(hash(await readFile(`${directory}/independent-project/${file.path}`)), file.sha256);
  }
  const body = await json("src-tauri/target/length-continuation-audit/blocked-third.projected.json");
  const source = report.conversations.find(c => c.id === "real-mission-a");
  const parts = source.messages.flatMap(m => m.parts.flatMap((p, partIndex) => p.toolCallId ? [{ ...p, messageId: m.id, partIndex }] : []));
  const vite = await createServer({ configFile: false, resolve: { alias: { "@": path.resolve("src") } }, optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null }, logLevel: "error" });
  try {
    const { measureRequest, resolveContextBudget, estimateTextTokens } = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts");
    const { canonicalJson } = await vite.ssrLoadModule("/src/modules/ai/lib/canonicalJson.ts");
    assert.equal(hash(canonicalJson(body)), capture.expected.blockedNativeSha256);
    const olderPartialSlices = [32, 36].map(n => {
      const response = prior.chain.find(c => c.id === `inference-${n}`).response;
      const matches = source.messages.flatMap(m => m.parts.filter(p => p.type === "text" && hash(p.text) === response.contentSha256));
      assert.equal(matches.length, 1);
      const text = matches[0].text, message = body.messages.findIndex(m => m.role === "assistant" && m.content.includes(text));
      assert(message >= 0);
      const start = body.messages[message].content.indexOf(text);
      return { requestId: `inference-${n}`, message, start, end: start + text.length, sha256: response.contentSha256 };
    });
    const inventory = inventoryProviderHistory(body, measureRequest, olderPartialSlices);
    const tools = body.messages.flatMap((m, messageIndex) => (m.tool_calls ?? []).map(call => ({ id: call.id,
      name: call.function.name, args: call.function.arguments, messageIndex })));
    const toolResults = tools.map(call => {
      const index = body.messages.findIndex(m => m.tool_call_id === call.id), result = body.messages[index];
      const callMessage = body.messages[call.messageIndex];
      const callOnly = { role: "assistant", content: "", tool_calls: [callMessage.tool_calls.find(c => c.id === call.id)] };
      const value = JSON.parse(result.content), part = parts.find(p => p.toolCallId === call.id);
      return { ...call, resultIndex: index, value, part,
        callTokens: measureRequest({ messages: [callOnly] }).conversation - measureRequest({ messages: [{ role: "assistant", content: "" }] }).conversation,
        resultTokens: inventory.entries.find(e => e.message === index && e.field === "content").tokens };
    });
    const budget = request => {
      const b = resolveContextBudget(capture.limits, measureRequest(request), 2048);
      const input = b.cost.system + b.cost.tools + b.cost.conversation;
      return { input, required: input + b.reserve + b.margin, headroom: b.ceiling - input - b.reserve - b.margin,
        reserve: b.reserve, margin: b.margin, ceiling: b.ceiling, fits: b.fits };
    };
    const before = budget(body);
    assert.equal(before.input, 61132); assert.equal(before.required, 69294);
    const sourceRef = id => {
      const p = parts.find(part => part.toolCallId === id); assert(p);
      const original = source.messages.find(m => m.id === p.messageId).parts[p.partIndex];
      return { sessionId: source.id, messageId: p.messageId, partIndex: p.partIndex, digest: hash(canonicalJson(original)) };
    };
    const proposals = [], resultEdits = new Map();
    const record = (id, candidateIds, projected, proof, status = "offline lossless prototype; not a production compaction rule") => {
      const after = budget(projected);
      const affected = toolResults.filter(t => candidateIds.includes(t.id));
      const currentTokens = affected.reduce((n, t) => n + t.callTokens + measureRequest({ messages: [body.messages[t.resultIndex]] }).conversation, 0);
      proposals.push({ id, candidateIds, items: candidateIds.length, currentTokens, projectedTokens: currentTokens - (before.input - after.input),
        inputSaved: before.input - after.input, requiredSaved: before.required - after.required, after, proof, status });
    };
    record("A-superseded-file-reads", [], body, "Zero superseded full read bodies; two superseded unchanged:true acknowledgements are already bounded",
      "No safe beneficial candidate");
    record("B-resolved-command-failures", [], body, "No later same validation success with a compatible workspace/environment scope; four executed shell failures remain hot",
      "No proven resolved-validation candidate");
    const routine = toolResults.filter(t => t.name === "bash_run" && t.value.exit_code === 0 && t.value.timed_out === false && t.value.truncated === false && t.value.command === t.args.command);
    const routineProjection = clone(body), commandEdits = new Map();
    for (const item of routine) {
      const value = clone(item.value);
      delete value.command;
      value.commandFromToolCall = item.id;
      const restored = clone(value); delete restored.commandFromToolCall; restored.command = item.args.command;
      assert.equal(canonicalJson(restored), canonicalJson(item.value));
      const encoded = JSON.stringify(value);
      if (measureRequest({ messages: [{ ...body.messages[item.resultIndex], content: encoded }] }).conversation >=
        measureRequest({ messages: [body.messages[item.resultIndex]] }).conversation) continue;
      routineProjection.messages[item.resultIndex].content = encoded; commandEdits.set(item.id, encoded);
    }
    resultEdits.set("C-command-echo-factoring", commandEdits);
    record("C-command-echo-factoring", [...commandEdits.keys()], routineProjection, "Only duplicate command echo removed; every stdout/stderr character, exit, timeout, truncation and cwd field retained; exact command recoverable from the same native call");
    record("D-stale-directory-listings", [], body, "One provably stale empty-root listing costs only 55 content-field tokens; an honest source-linked receipt is larger. Two frontend listings remain relevant to current unfinished work",
      "No safe beneficial candidate");
    const staleDirectory = toolResults.find(t => t.name === "list_directory" && t.args.path === frozen.root && t.value.entries.length === 0);
    assert(staleDirectory);
    const directoryPrototype = replacePairsWithAuditReceipts(body, new Map([[staleDirectory.id, { version: 1, kind: "historical-empty-listing", toolCallId: staleDirectory.id,
      source: sourceRef(staleDirectory.id), originalInput: staleDirectory.args, originalResult: staleDirectory.value,
      currentState: "Stale after later verified writes; relist through authorized tooling. Historical evidence only; never replay." }]]));
    const plans = toolResults.filter(t => t.name === "todo_write" && t.value.ok === true && Array.isArray(t.args.todos));
    const latestPlan = plans.at(-1), planReplacements = new Map();
    for (const item of plans.slice(0, -1)) {
      const delta = exactJsonDelta(item.args, latestPlan.args);
      assert.equal(canonicalJson(restoreExactJson(latestPlan.args, delta)), canonicalJson(item.args));
      planReplacements.set(item.id, { version: 1, kind: "superseded-plan-exact-delta", toolCallId: item.id, source: sourceRef(item.id),
        base: { toolCallId: latestPlan.id, source: sourceRef(latestPlan.id), inputSha256: hash(canonicalJson(latestPlan.args)) },
        restoreOriginalInput: delta, originalResult: clone(body.messages[item.resultIndex]), currentPlan: "base remains verbatim; completion marks are model reports, not verified effects", replay: "never" });
    }
    record("E-superseded-plan", [...planReplacements.keys()], replacePairsWithAuditReceipts(body, planReplacements),
      "Earlier complete plan reconstructed exactly from immutable latest plan plus literal reverse JSON changes; all earlier descriptions/statuses retained; original result included; crosses a user boundary so existing same-boundary rule is not changed");
    record("F-historical-reasoning-prose", [], body, "No dependency-completion proof; thinking required in active provider tool loops; older textual intents may hold unique architecture/obligations",
      "Unsafe to credit blanket deletion");
    record("G-continuation-scaffolding", [], body, "Zero completed directives remain; one current continuation instruction is required",
      "No obsolete candidate");
    const searchProjection = clone(body), searchEdits = new Map();
    for (const item of toolResults.filter(t => t.name === "grep" && Array.isArray(t.value.hits))) {
      const value = clone(item.value), compacted = [];
      for (const [index, hit] of value.hits.entries()) {
        if (typeof hit.rel !== "string" || !hit.rel || /[\\\x00-\x1f]/.test(hit.rel) || hit.rel.split("/").some(p => !p || p === "." || p === "..") || hit.path !== `${value.root}/${hit.rel}`) continue;
        compacted.push(index); delete hit.path;
      }
      if (!compacted.length) continue;
      value.factoredHitPaths = { indexes: compacted, format: "root + '/' + rel; historical observation, not current state" };
      const restored = clone(value); delete restored.factoredHitPaths;
      for (const index of compacted) restored.hits[index].path = `${restored.root}/${restored.hits[index].rel}`;
      assert.equal(canonicalJson(restored), canonicalJson(item.value));
      const encoded = JSON.stringify(value);
      if (measureRequest({ messages: [{ ...body.messages[item.resultIndex], content: encoded }] }).conversation >=
        measureRequest({ messages: [body.messages[item.resultIndex]] }).conversation) continue;
      searchProjection.messages[item.resultIndex].content = encoded; searchEdits.set(item.id, encoded);
    }
    resultEdits.set("H-search-path-factoring", searchEdits);
    record("H-search-path-factoring", [...searchEdits.keys()], searchProjection, "Every search line, text, relative path, count and truncation flag retained; only mathematically redundant full paths factored under the exact root/rel identity");
    const writes = toolResults.filter(t => t.name === "write_file" && t.value.ok === true && t.value.clackWorkspaceWrite === true), writeReplacements = new Map();
    for (const item of writes) {
      const latest = writes.findLast(w => w.args.path === item.args.path);
      if (latest.id === item.id) continue;
      assert.equal(item.value.bytesWritten, item.args.content.length); assert.equal(latest.value.bytesWritten, latest.args.content.length);
      const delta = exactStringDelta(item.args.content, latest.args.content);
      assert.equal(restoreExactString(latest.args.content, delta), item.args.content);
      const relative = latest.args.path.slice(frozen.root.length + 1), observed = frozen.files.find(f => f.path === relative);
      assert(observed); assert.equal(hash(latest.args.content), observed.sha256);
      writeReplacements.set(item.id, { version: 1, kind: "superseded-write-exact-delta", toolCallId: item.id, path: item.args.path,
        source: sourceRef(item.id), originalContentSha256: hash(item.args.content),
        base: { toolCallId: latest.id, source: sourceRef(latest.id), contentSha256: hash(latest.args.content) },
        restoreOriginalContent: delta, originalResult: clone(body.messages[item.resultIndex]),
        state: "Historical writes only; base remains verbatim. Current filesystem state requires fresh authorized revalidation; never replay." });
    }
    record("I-superseded-write-deltas", [...writeReplacements.keys()], replacePairsWithAuditReceipts(body, writeReplacements),
      "Original content round-trips exactly against later immutable full write; both source locators/digests retained; later base stays hot; final archived workspace hash matches but is NOT an atomic production-request freshness proof",
      "High-saving conditional prototype; new source dependency/retention/pinning/provider projection integration still required");
    const structural = clone(body);
    for (const map of resultEdits.values()) for (const message of structural.messages) if (map.has(message.tool_call_id)) message.content = map.get(message.tool_call_id);
    const structuralOnly = replacePairsWithAuditReceipts(structural, planReplacements);
    const combined = replacePairsWithAuditReceipts(structuralOnly, writeReplacements);
    const originalHash = hash(canonicalJson(body));
    assert.equal(originalHash, capture.expected.blockedNativeSha256);
    for (const projected of [structuralOnly, combined]) {
      assert.equal(projected.messages.at(-1).content, body.messages.at(-1).content);
      assert.deepEqual(projected.messages.filter(m => m.role === "user"), body.messages.filter(m => m.role === "user"));
      assert.deepEqual(projected.tools, body.tools); assert.deepEqual(projected.options, body.options);
      assert.deepEqual(projected.messages.filter(m => m.thinking).map(m => m.thinking), body.messages.filter(m => m.thinking).map(m => m.thinking));
      assert.equal(projected.messages.reduce((n, m) => n + (m.content.match(/<tool_call>/g)?.length ?? 0), 0), 3);
      assert.deepEqual(projected.messages.flatMap(m => m.tool_calls ?? []).find(c => c.id === latestPlan.id), body.messages.flatMap(m => m.tool_calls ?? []).find(c => c.id === latestPlan.id));
      for (const failure of prior.failures) assert.deepEqual(projected.messages.find(m => m.tool_call_id === failure.id), body.messages.find(m => m.tool_call_id === failure.id));
    }
    const readDetails = toolResults.filter(t => t.name === "read_file").map(t => {
      const laterWrites = toolResults.filter(w => w.name === "write_file" && w.args.path === t.args.path && w.messageIndex > t.resultIndex && w.value.ok && w.value.clackWorkspaceWrite);
      const relative = t.args.path.slice(frozen.root.length + 1), archived = frozen.files.find(f => f.path === relative);
      const fullBody = typeof t.value.content === "string";
      const currentAtArchivedSnapshot = fullBody && archived ? hash(t.value.content) === archived.sha256 : null;
      return { id: t.id, path: t.args.path, fullBody, unchangedAcknowledgement: t.value.unchanged === true, laterWriteIds: laterWrites.map(w => w.id),
        currentAtArchivedSnapshot, resultTokens: t.resultTokens, disposition: laterWrites.length ? "superseded acknowledgement; no full read body to reclaim"
          : t.id === "call_qzckb19v" ? "latest read immediately needed by current unfinished edit; keep exact"
          : "still-current archived file, potentially re-readable under authorization, but keep: configuration remains relevant and no dependency closure proved" };
    });
    const callInventory = [...new Set(toolResults.map(t => t.name))].map(name => ({ tool: name, items: toolResults.filter(t => t.name === name).length,
      callTokens: toolResults.filter(t => t.name === name).reduce((n, t) => n + t.callTokens, 0),
      resultTokens: toolResults.filter(t => t.name === name).reduce((n, t) => n + t.resultTokens, 0) }));
    assert.equal(callInventory.reduce((n, t) => n + t.callTokens, 0), 19046);
    assert(readDetails.filter(t => t.fullBody).every(t => t.currentAtArchivedSnapshot));
    const lastUser = body.messages.findLast(m => m.role === "user");
    const correction = source.messages.findLast(m => m.role === "user").parts.find(p => p.type === "text").text;
    assert(lastUser.content.endsWith(correction));
    const correctionCost = measureRequest({ messages: [{ role: "user", content: correction }] }).conversation;
    const fullCorrectionCost = measureRequest({ messages: [lastUser] }).conversation;
    const summary = { base: "8bf153d", frozenBase: "b2cd814", inference: 0, realEffects: 0, inventory, olderPartialSlices,
      callInventory, readDetails,
      toolDetails: toolResults.map(t => ({ id: t.id, tool: t.name, callTokens: t.callTokens, resultTokens: t.resultTokens,
        path: t.args.path, command: t.args.command, exit: t.value.exit_code, resultKeys: Object.keys(t.value) })),
      before, proposals, actualProductionAfter: before, actualProductionInputSaved: 0,
      rejectedDirectoryPrototype: { items: 1, originalResultFieldTokens: staleDirectory.resultTokens,
        inputSaved: before.input - budget(directoryPrototype).input, reason: "The lossless provenance receipt is larger than the original empty-listing pair" },
      structuralOnly: { scope: "Audit-only reversible structural prototypes, not a production request", ...budget(structuralOnly), inputSaved: before.input - budget(structuralOnly).input,
        originalAbsoluteMarginRequired: budget(structuralOnly).input + 2048 + before.margin,
        originalAbsoluteMarginHeadroom: 65536 - budget(structuralOnly).input - 2048 - before.margin },
      withConditionalWriteDeltas: { scope: "Audit-only conditional prototype, not production acceptance", ...budget(combined), inputSaved: before.input - budget(combined).input,
        originalAbsoluteMarginRequired: budget(combined).input + 2048 + before.margin,
        originalAbsoluteMarginHeadroom: 65536 - budget(combined).input - 2048 - before.margin },
      productionChanges: 0, classification: "LONG-HORIZON REPRESENTATION AUDITED",
      provenance: { originalBodySha256: originalHash, artifacts: prior.provenance.artifacts, filesChecked: frozen.files.length * 2,
        clackSourceFilesUnchanged: setup.source.length, transcriptSha256: hash(canonicalJson(source)), originalTranscriptUnchanged: true },
      scalar: { objective: estimateTextTokens(body.messages.find(m => m.role === "user").content),
        correction: estimateTextTokens(correction), correctionMessage: correctionCost, environmentMarginal: fullCorrectionCost - correctionCost,
        currentPartial: estimateTextTokens(body.messages.at(-1).content), currentDirectiveWireMarginal: 117 },
      rankedCandidates: [
        { class: "A", safety: "high when exact supersession and current dependency proof exist", savingsHere: 0, complexity: "medium", reversible: true, value: "good on read-heavy runs, absent here" },
        { class: "B", safety: "high only with same scoped validation and direct later success", savingsHere: 0, complexity: "high: command/environment/dependency identity", reversible: true, value: "good on verified repair loops; no qualifying pass here" },
        { class: "C", safety: "high for exact echo factoring; generic output deletion not established", savingsHere: 441, complexity: "low representation, medium provenance integration", reversible: true, value: "small" },
        { class: "D", safety: "conditional: absence of pending dependency plus authorized relisting", savingsHere: 0, complexity: "medium", reversible: true, value: "small here" },
        { class: "E", safety: "lossless inverse delta proven; cross-boundary source/pin lifecycle not integrated", savingsHere: 130, complexity: "medium", reversible: true, value: "small with retained historical requirements" },
        { class: "F", safety: "not established for blanket omission; active tool-loop thinking must remain", savingsHere: 0, complexity: "high semantic/provider dependency", reversible: true, value: "large tempting deletion is not safe credit" },
        { class: "G", safety: "high only after associated continuation completed", savingsHere: 0, complexity: "low", reversible: true, value: "absent here" },
        { class: "H", safety: "high exact path factoring; no content dropped", savingsHere: 1726, complexity: "low representation, medium provenance integration", reversible: true, value: "largest low-risk structural saving here" },
        { class: "I", safety: "lossless content proven; native dependency/pin/freshness/provider integration not established", savingsHere: 2542, complexity: "high integration", reversible: true, value: "conditional next-design candidate; insufficient alone" },
      ],
      nextCheckpoint: "Design Structured Obligation and Workspace Checkpoint Summaries" };
    await mkdir(output, { recursive: true });
    await writeFile("src/test/fixtures/long-horizon-audit-20261021.json", JSON.stringify(summary, null, 2) + "\n");
    await writeFile(`${output}/structural-only.projected.json`, JSON.stringify(structuralOnly, null, 2));
    await writeFile(`${output}/conditional-writes.projected.json`, JSON.stringify(combined, null, 2));
    console.log(JSON.stringify({ inventory: inventory.inventory, proposals: proposals.map(({ id, items, currentTokens, inputSaved, after }) => ({ id, items, currentTokens, inputSaved, after })),
      structuralOnly: summary.structuralOnly, withConditionalWriteDeltas: summary.withConditionalWriteDeltas }));
  } finally { await vite.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await audit();
