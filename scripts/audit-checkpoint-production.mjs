import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { convertToModelMessages, streamText } from "ai";
import { offlineRuntime } from "./audit-structured-checkpoint.mjs";
import { digest } from "./structured-checkpoint-design.mjs";

const runtime = await offlineRuntime();
try {
  const { projectCheckpointWrites } = await runtime.vite.ssrLoadModule("/src/modules/ai/lib/writeCheckpoint.ts");
  const { createOllamaModel } = await runtime.vite.ssrLoadModule("/src/modules/ai/lib/ollamaModel.ts");
  const native = JSON.parse(await readFile("src-tauri/target/checkpoint-native-evidence.json", "utf8"));
  const blocks = await Promise.all(native.messages.map(m => convertToModelMessages([m])));
  const p = await projectCheckpointWrites(blocks, native.snapshot, native.snapshot.owner);
  assert.equal(p.receipts.length, 2);
  const serialize = async messages => {
    let payload;
    const result = streamText({ model: createOllamaModel({ modelId: "offline-checkpoint-fixture", baseURL: "http://offline.invalid",
      fetch: async (_url, init) => {
        payload = JSON.parse(String(init.body));
        return new Response(`${JSON.stringify({ message: { role: "assistant", content: "Offline serializer fixture." }, done: true, done_reason: "stop" })}\n`);
      } }), messages, maxOutputTokens: 2048, providerOptions: { ollama: { numCtx: 65536 } }, maxRetries: 0 });
    await result.consumeStream(); assert(payload); return payload;
  };
  const before = await serialize(blocks.flat()), after = await serialize(p.blocks.flat());
  const without = structuredClone(after);
  for (const m of without.messages) for (const r of p.receipts) m.content = m.content.replace(r.text, "");
  const beforeBudget = runtime.budget(before), afterBudget = runtime.budget(after), withoutBudget = runtime.budget(without);
  const checkpointCost = afterBudget.input - withoutBudget.input, rawRemoved = beforeBudget.input - withoutBudget.input;
  assert(afterBudget.input < beforeBudget.input);
  assert.deepEqual(after.messages.filter(m => m.role === "user"), before.messages.filter(m => m.role === "user"));
  const restored = await projectCheckpointWrites(blocks, native.snapshot, native.snapshot.owner, p.receipts.map(r => r.toolCallId));
  assert.deepEqual(await serialize(restored.blocks.flat()), before);
  const frozenProjection = await projectCheckpointWrites([runtime.body.messages], null, native.snapshot.owner);
  const frozenAfter = { ...runtime.body, messages: frozenProjection.blocks.flat() };
  assert.equal(digest(frozenAfter), digest(runtime.body));
  const summary = { base: "00453eb", classification: "REVISION-PINNED LONG-HORIZON CHECKPOINT PARTIAL", inference: 0, networkDispatches: 0, forgeboardRuns: 0,
    frozen: { eligible: 0, compacted: 0, checkpointCost: 0, rawRemoved: 0, netSaved: 0, before: runtime.budget(runtime.body), after: runtime.budget(frozenAfter),
      originalPayloadSha256: digest(runtime.body), projectedPayloadSha256: digest(frozenAfter),
      reason: "No native per-write observations exist in legacy frozen evidence; later shell/read/failure consumers also block dependency closure. Original payload retained." },
    nativeCoreToSdkFixture: { scope: "Synthetic file effects in isolated Rust test workspace, not a live provider/GUI or ForgeBoard run", observedWrites: 3,
      compacted: p.receipts.length, checkpointCost, rawRemoved, netSaved: rawRemoved - checkpointCost,
      before: beforeBudget, after: afterBudget, nativeSnapshotSha256: digest(native.snapshot), originalMessagesSha256: digest(native.messages),
      beforePayloadSha256: digest(before), afterPayloadSha256: digest(after), restoredPayloadSha256: digest(before), exactUsersRetained: true,
      originalBodiesRetained: true, restorationExecutesTools: false, restorationUsesNetwork: false },
    unchanged: ["context limit", "B1 margin policy", "output reserve", "F1", "reasoning", "tool schemas", "mission output allowance", "Automatic settings"],
    deferred: ["search path factoring", "shell echo factoring", "cross-correction plan retirement", "old drafts", "reasoning", "broad prose", "semantic summaries"],
  };
  await writeFile("src/test/fixtures/checkpoint-production-20261021.json", JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary));
} finally { await runtime.vite.close(); }
