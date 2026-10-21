import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { before, after, test } from "node:test";
import { createServer } from "vite";
import { exactJsonDelta, restoreExactJson, exactStringDelta, restoreExactString,
  replacePairsWithAuditReceipts, inventoryProviderHistory } from "./audit-long-horizon-context.mjs";

const json = async file => JSON.parse(await readFile(file, "utf8"));
const capture = await json("src/test/fixtures/length-continuation-replay-20261021.json");
const audit = await json("src/test/fixtures/long-horizon-audit-20261021.json");
let vite, body, measureRequest, resolveContextBudget, canonicalJson;
before(async () => {
  vite = await createServer({ configFile: false, resolve: { alias: { "@": path.resolve("src") } }, optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null }, logLevel: "error" });
  ({ measureRequest, resolveContextBudget } = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts"));
  ({ canonicalJson } = await vite.ssrLoadModule("/src/modules/ai/lib/canonicalJson.ts"));
  const { ollamaBody } = await vite.ssrLoadModule("/src/modules/ai/lib/ollamaModel.ts");
  const params = structuredClone(capture.params);
  params.prompt = [...params.prompt.filter(m => m.role === "system"), { role: "system", content:
    "Continue the SAME assistant answer exactly from its last character. Do not repeat any prior text, restart the task, or add a new introduction. Preserve whitespace, code and Markdown. Existing permissions and approvals remain in force." },
    ...params.prompt.filter(m => m.role !== "system"), { role: "assistant", content: [{ type: "text", text: capture.response.text }] }];
  body = ollamaBody("nemotron-3.5-lightning:30b-a3b-q4_K_M", params, true);
});
after(async () => { await vite?.close(); });

test("the exact blocked native input remains 61,132 with 69,294 required", () => {
  const b = resolveContextBudget(capture.limits, measureRequest(body), 2048);
  assert.equal(b.cost.system + b.cost.tools + b.cost.conversation, 61132);
  assert.equal(b.working - b.cost.conversation, -3758);
  assert.equal(b.margin, 6114); assert.equal(b.reserve, 2048); assert.equal(b.ceiling, 65536);
});
test("every field in all 61 messages is assigned exactly once", () => {
  const result = inventoryProviderHistory(body, measureRequest, audit.olderPartialSlices);
  assert.equal(new Set(result.entries.map(e => e.message)).size, 61);
  const identities = result.entries.map(e => `${e.message}:${e.field}`);
  assert.equal(new Set(identities).size, identities.length);
  assert.deepEqual(result, audit.inventory);
});
test("the additive history partition totals 51,374 and excludes system/schema columns", () => {
  const result = inventoryProviderHistory(body, measureRequest, audit.olderPartialSlices);
  const partition = result.inventory.filter(e => !e.class.startsWith("system-"));
  assert.equal(partition.reduce((n, e) => n + e.tokens, 0), 51374);
  assert.equal(result.system, 3872); assert.equal(result.schemas, 5886);
  assert(Math.abs(partition.reduce((n, e) => n + e.percentHistory, 0) - 100) < 0.01);
});
test("the existing receipt is not misclassified as discardable assistant chatter", () => {
  assert.equal(audit.inventory.inventory.find(e => e.class === "existing-write-receipt").tokens, 427);
  assert.equal(audit.inventory.inventory.find(e => e.class === "historical-assistant-prose").tokens, 1019);
});
test("native call and result breakdowns reconcile without double-counting subcategories", () => {
  assert.equal(audit.callInventory.reduce((n, item) => n + item.callTokens, 0), 19046);
  assert.equal(audit.callInventory.reduce((n, item) => n + item.resultTokens, 0), 12830);
  assert.equal(audit.callInventory.find(t => t.tool === "write_file").callTokens, 15016);
});
test("all three full reads still match archived workspace content; acknowledgements contain no body", () => {
  assert.equal(audit.readDetails.length, 5);
  assert.equal(audit.readDetails.filter(r => r.fullBody).length, 3);
  assert(audit.readDetails.filter(r => r.fullBody).every(r => r.currentAtArchivedSnapshot));
  assert.equal(audit.readDetails.filter(r => r.unchangedAcknowledgement && r.laterWriteIds.length).length, 2);
  assert.equal(audit.proposals.find(p => p.id.startsWith("A-")).inputSaved, 0);
});
test("four executed command failures are not promoted to resolved validations", () => {
  assert.equal(audit.toolDetails.filter(t => t.tool === "bash_run" && t.exit !== 0).length, 4);
  assert.equal(audit.proposals.find(p => p.id.startsWith("B-")).items, 0);
  assert.equal(audit.proposals.find(p => p.id.startsWith("B-")).inputSaved, 0);
});
test("the exact user objective, accepted correction and current answer stay hot", () => {
  const users = body.messages.filter(m => m.role === "user");
  assert.equal(users.length, 2); assert(users[0].content.startsWith("Build ForgeBoard from scratch"));
  assert(users[1].content.includes("Change the task page size requirement from 50 to 25"));
  assert.equal(body.messages.at(-1).content, capture.response.text);
  assert.equal(audit.scalar.currentPartial, 3950);
});
test("all three pseudo-tools remain text rather than native calls", () => {
  assert.equal(body.messages.reduce((n, m) => n + (m.content.match(/<tool_call>/g)?.length ?? 0), 0), 3);
  assert.equal(body.messages.flatMap(m => m.tool_calls ?? []).length, 28);
  assert.equal(body.messages.at(-1).tool_calls, undefined);
});
test("historical reasoning is retained, not credited as safe deletion", () => {
  assert.equal(body.messages.filter(m => m.thinking).length, 29);
  assert.equal(body.messages.reduce((n, m) => n + (m.thinking?.length ?? 0), 0), 6597);
  assert.equal(audit.proposals.find(p => p.id.startsWith("F-")).inputSaved, 0);
});
test("only the current continuation directive remains and is not reclaimed", () => {
  assert.equal(body.messages.filter(m => m.role === "system").length, 1);
  assert.equal(body.messages[0].content.split("Continue the SAME assistant answer").length, 2);
  assert.equal(audit.proposals.find(p => p.id.startsWith("G-")).items, 0);
});
test("independent structural simulations have exact bounded savings", () => {
  assert.deepEqual(audit.proposals.filter(p => p.inputSaved).map(p => [p.id[0], p.items, p.inputSaved]),
    [["C", 8, 441], ["E", 1, 130], ["H", 1, 1726], ["I", 2, 2542]]);
  for (const p of audit.proposals) assert.equal(p.currentTokens - p.projectedTokens, p.inputSaved);
});
test("the low-risk structural combination still fails closed", () => {
  assert.equal(audit.structuralOnly.inputSaved, 2297);
  assert.equal(audit.structuralOnly.required, 66767);
  assert.equal(audit.structuralOnly.headroom, -1231);
  assert.equal(audit.structuralOnly.fits, false);
});
test("the conditional delta prototype is not mislabeled as production acceptance", () => {
  assert.equal(audit.withConditionalWriteDeltas.inputSaved, 4839);
  assert.equal(audit.withConditionalWriteDeltas.required, 63971);
  assert.equal(audit.withConditionalWriteDeltas.headroom, 1565);
  assert.equal(audit.withConditionalWriteDeltas.fits, true);
  assert.equal(audit.actualProductionInputSaved, 0);
  assert.deepEqual(audit.actualProductionAfter, audit.before);
  assert.equal(audit.classification, "LONG-HORIZON REPRESENTATION AUDITED");
});

for (const [name, original, base] of [
  ["equal", { a: 1 }, { a: 1 }],
  ["literal changes", { description: "page size 50", status: "pending" }, { description: "page size 25", status: "completed" }],
  ["nested arrays", { todos: [{ id: "x", status: "pending" }] }, { todos: [{ id: "x", status: "completed" }] }],
  ["shorter original array", [1], [1, 2]],
  ["longer original array", [1, 2], [1]],
  ["removed property", { a: 1 }, { a: 1, b: 2 }],
  ["restored property", { a: 1, b: 2 }, { a: 1 }],
  ["type change", null, { a: 1 }],
]) test(`exact JSON reverse delta preserves ${name}`, () => {
  const snapshot = structuredClone(base);
  assert.deepEqual(restoreExactJson(base, exactJsonDelta(original, base)), original);
  assert.deepEqual(base, snapshot);
});
for (const [name, original, base] of [
  ["equal", "same source", "same source"],
  ["empty original", "", "source"],
  ["empty base", "source", ""],
  ["changed middle", "const PAGE_SIZE = 50;", "const PAGE_SIZE = 25;"],
  ["unrelated bodies", "old implementation", "replacement"],
  ["Unicode code points", "\u{1F600}old\u{1F680}", "\u{1F600}new\u{1F680}"],
]) test(`exact string reverse delta preserves ${name}`, () => {
  assert.equal(restoreExactString(base, exactStringDelta(original, base)), original);
});
test("prototype-looking JSON keys remain data and cannot modify Object.prototype", () => {
  const original = JSON.parse('{"__proto__":{"clackAuditPollution":true},"constructor":{"x":1}}');
  const base = JSON.parse('{"__proto__":{"clackAuditPollution":false},"constructor":{"x":2}}');
  const restored = restoreExactJson(base, exactJsonDelta(original, base));
  assert.equal(canonicalJson(restored), canonicalJson(original));
  assert.equal({}.clackAuditPollution, undefined);
});
test("invalid missing-base paths and invalid copy ranges fail explicitly", () => {
  assert.throws(() => restoreExactJson({}, [{ path: ["missing", "key"], value: 1 }]));
  assert.throws(() => restoreExactString("abc", { copyPrefixCodePoints: 3, copySuffixCodePoints: 1, originalMiddle: "" }));
  assert.throws(() => restoreExactString("abc", { copyPrefixCodePoints: -1, copySuffixCodePoints: 0, originalMiddle: "" }));
});
test("receipt projection changes representation only, retaining reasoning, text and unrelated pairs", () => {
  const input = { messages: [
    { role: "assistant", content: "Old commentary.", thinking: "Original reasoning.", tool_calls: [{ id: "old", function: { name: "write_file" } }, { id: "other" }] },
    { role: "tool", tool_call_id: "old", content: "old-result" },
    { role: "tool", tool_call_id: "other", content: "keep-result" },
  ] };
  const snapshot = structuredClone(input);
  const result = replacePairsWithAuditReceipts(input, new Map([["old", { effect: "historical", replay: "never" }]]));
  assert.deepEqual(input, snapshot);
  assert.equal(result.messages[0].thinking, "Original reasoning.");
  assert(result.messages[0].content.startsWith("Old commentary."));
  assert.deepEqual(result.messages[0].tool_calls, [{ id: "other" }]);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[1].content, "keep-result");
});
test("unknown receipt identity cannot invent effects or remove a different pair", () => {
  assert.deepEqual(replacePairsWithAuditReceipts(body, new Map([["not-a-real-call", { replay: "never" }]])), body);
});
test("context and provider controls remain unchanged across the declared audit", () => {
  assert.deepEqual(body.options, { num_predict: 2048, num_ctx: 65536 });
  assert(!Object.hasOwn(body, "think")); assert.equal(body.tools.length, 13);
  assert.equal(audit.inference, 0); assert.equal(audit.realEffects, 0); assert.equal(audit.productionChanges, 0);
});
test("unchanged B1 arithmetic remains context-size independent, without a fixed-deficit workaround", () => {
  const cost = measureRequest(body);
  const rows = [16384, 32768, 65536, 131072].map(deployed => resolveContextBudget({ deployed, maxOutput: 2048 }, cost, 2048));
  assert.deepEqual(rows.map(r => r.fits), [false, false, false, true]);
  assert(rows.every(r => r.reserve === 2048 && r.margin === 6114));
  assert.equal(audit.withConditionalWriteDeltas.originalAbsoluteMarginRequired, 64455);
  assert.equal(audit.withConditionalWriteDeltas.originalAbsoluteMarginHeadroom, 1081);
});
