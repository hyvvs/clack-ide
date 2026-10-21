import { afterEach, describe, expect, it, vi } from "vitest";
import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai";
import { projectCheckpointWrites, type WriteCheckpoint } from "@/modules/ai/lib/writeCheckpoint";
import { contextDigest } from "@/modules/ai/lib/targetContext";
import { measureRequest, resolveContextBudget } from "@/modules/ai/lib/contextBudget";
import { compactionFixture, disposeCompactionFixtures, textMessage } from "@/modules/ai/lib/conversationCompaction.fixture";
import capture from "@/test/fixtures/length-continuation-replay-20261021.json";
import { ollamaBody } from "@/modules/ai/lib/ollamaModel";

const owner = { sessionId: "chat-a", workspaceId: "local:/workspace-a" };
function write(id: string, content: string) {
  return { type: "tool-write_file" as const, toolCallId: id, state: "output-available" as const,
    input: { path: "/workspace-a/module.ts", content }, output: { path: "/workspace-a/module.ts", ok: true, clackWorkspaceWrite: true, bytesWritten: content.length } };
}
async function fixture() {
  const old = write("old", "export const value = 1;\n".repeat(600)), middle = write("middle", "export const value = 2;\n".repeat(600)), latest = write("latest", "export const value = 3;\n");
  const messages: UIMessage[] = [textMessage("u1", "user", "Initially use page size 50."),
    { id: "a1", role: "assistant", parts: [{ type: "step-start" }, old, { type: "step-start" }, middle] },
    textMessage("u2", "user", "Use page size 25 instead of 50."), { id: "a2", role: "assistant", parts: [{ type: "step-start" }, latest] }];
  const blocks = await Promise.all(messages.map(m => convertToModelMessages([m])));
  const snapshot: WriteCheckpoint = { version: 1, owner, revision: "f".repeat(64), source: { transcriptRevision: 1, profileRevision: 1, transcriptHash: await contextDigest(messages), profileHash: "b".repeat(64) },
    entries: [], evidence: [] };
  for (const [index, item] of [old, middle].entries()) {
    const id = String(index + 1).repeat(64);
    snapshot.evidence.push({ id, sourceRevision: 1, locator: { kind: "part", messageId: "a1", partIndex: index * 2 + 1 }, digest: await contextDigest(item), relatedSessions: [owner.sessionId], contentIds: [] });
    snapshot.entries.push({ toolCallId: item.toolCallId, path: "module.ts", canonical: item.input.path, resultDigest: await contextDigest(item.input.content),
      inputHash: await contextDigest(item.input), outputHash: await contextDigest(item.output), source: id, order: index + 1,
      latestToolCallId: "latest", latestDigest: await contextDigest(latest.input.content), latestInputHash: await contextDigest(latest.input), latestOutputHash: await contextDigest(latest.output), latestOrder: 3, base: "full-overwrite-independent" });
  }
  return { messages, blocks, snapshot };
}
const ids = (blocks: ModelMessage[][]) => blocks.flat().flatMap(m => Array.isArray(m.content) ? m.content.flatMap(p => "toolCallId" in p ? [p.toolCallId] : []) : []);
afterEach(disposeCompactionFixtures);

describe("revision-pinned write provider projection", () => {
  it("replaces two older full writes once, retains latest and leaves transcript unchanged", async () => {
    const f = await fixture(), originals = structuredClone(f.messages);
    const p = await projectCheckpointWrites(f.blocks, f.snapshot, owner);
    expect(p.receipts).toHaveLength(2); expect(ids(p.blocks)).toEqual(["latest", "latest"]);
    expect(f.messages).toEqual(originals);
    expect(p.blocks.flat().filter(m => m.role === "user")).toEqual(f.blocks.flat().filter(m => m.role === "user"));
    expect(JSON.stringify(p.blocks).match(/Historical workspace checkpoint/g)).toHaveLength(2);
    expect(measureRequest({ messages: p.blocks.flat() }).conversation).toBeLessThan(measureRequest({ messages: f.blocks.flat() }).conversation);
  });
  for (const [name, mutate] of [
    ["input digest", (s: WriteCheckpoint) => { s.entries[0].inputHash = "0".repeat(64); }],
    ["output digest", (s: WriteCheckpoint) => { s.entries[0].outputHash = "0".repeat(64); }],
    ["base contract", (s: WriteCheckpoint) => { s.entries[0].base = "patch" as never; }],
    ["lineage", (s: WriteCheckpoint) => { s.entries[0].order = 5; }],
    ["latest input", (s: WriteCheckpoint) => { s.entries[0].latestInputHash = "0".repeat(64); }],
    ["latest result", (s: WriteCheckpoint) => { s.entries[0].latestOutputHash = "0".repeat(64); }],
    ["missing source", (s: WriteCheckpoint) => { s.evidence.shift(); }],
    ["cross-session source", (s: WriteCheckpoint) => { s.evidence[0].relatedSessions = ["other"]; }],
  ] as const) it(`rejects a ${name} mismatch`, async () => {
    const f = await fixture(); mutate(f.snapshot); const p = await projectCheckpointWrites(f.blocks, f.snapshot, owner);
    expect(p.receipts.map(r => r.toolCallId)).not.toContain("old"); expect(ids(p.blocks)).toContain("old");
  });
  it("denies another workspace or conversation and unsupported versions", async () => {
    const f = await fixture();
    for (const wrong of [{ ...owner, workspaceId: "local:/other" }, { ...owner, sessionId: "other" }]) expect((await projectCheckpointWrites(f.blocks, f.snapshot, wrong)).blocks).toEqual(f.blocks);
    f.snapshot.version = 2 as never; expect((await projectCheckpointWrites(f.blocks, f.snapshot, owner)).receipts).toHaveLength(0);
  });
  it("explicit original restoration pins old and intermediate source identities", async () => {
    const f = await fixture(); expect((await projectCheckpointWrites(f.blocks, f.snapshot, owner, ["old", "middle"])).blocks).toEqual(f.blocks);
    expect((await projectCheckpointWrites(f.blocks, f.snapshot, owner, ["latest"])).blocks).toEqual(f.blocks);
  });
  it("refuses modified, failed and provider-tagged tool representations", async () => {
    for (const change of ["failed", "signature", "duplicate"]) {
      const f = await fixture();
      const old = f.blocks.flat().find(m => Array.isArray(m.content) && m.content.some(p => p.type === "tool-call" && p.toolCallId === "old"));
      if (!old || !Array.isArray(old.content)) throw new Error("fixture call missing");
      const part = old.content.find(p => p.type === "tool-call" && p.toolCallId === "old");
      if (part?.type !== "tool-call") throw new Error("fixture call missing");
      if (change === "signature") part.providerOptions = { vendor: { signature: "protected" } };
      if (change === "duplicate") (old.content as unknown[]).push(part);
      if (change === "failed") {
        const result = f.blocks.flat().find(m => m.role === "tool" && m.content.some(p => p.type === "tool-result" && p.toolCallId === "old"));
        if (result?.role === "tool") result.content[0] = { type: "tool-result", toolCallId: "old", toolName: "write_file", output: { type: "error-text", value: "denied" } };
      }
      expect((await projectCheckpointWrites(f.blocks, f.snapshot, owner)).receipts.map(r => r.toolCallId)).not.toContain("old");
    }
  });
  it("keeps reasoning, current partial and textual pseudo-tools byte-exact", async () => {
    const f = await fixture(); f.blocks.push([{ role: "assistant", content: [{ type: "reasoning", text: "active reasoning" }, { type: "text", text: "<tool_call>unfinished proposal, never executed" }] }]);
    const p = await projectCheckpointWrites(f.blocks, f.snapshot, owner);
    expect(p.blocks[p.blocks.length - 1]).toEqual(f.blocks[f.blocks.length - 1]); expect(ids(p.blocks)).not.toContain("unfinished");
  });
  it("is deterministic and independent of model names or transient transport ports", async () => {
    const f = await fixture(); const p = await projectCheckpointWrites(f.blocks, f.snapshot, owner);
    expect(await projectCheckpointWrites(structuredClone(f.blocks), JSON.parse(JSON.stringify(f.snapshot)), owner)).toEqual(p);
    expect(p.receipts[0].text).not.toMatch(/nemotron|qwen|11435/i);
  });
});

describe("production pressure, invalidation and restoration integration", () => {
  async function start(options: { low?: boolean; unknownAdapter?: boolean; missing?: boolean } = {}) {
    const f = await fixture(), memory = compactionFixture(f.messages);
    const prepare = vi.fn(async () => options.missing ? null : f.snapshot), validate = vi.fn(async (_s: WriteCheckpoint) => {});
    let working = options.low ? 100000 : 6000;
    const compactor = await memory.start({ keepReasoning: true, checkpointHistory: options.unknownAdapter ? undefined : "ollama-native-v1",
      limits: async () => ({ deployed: 131072, workingTarget: working, maxOutput: 2048 }),
      context: { owner, originals: f.messages, ready: memory.ready, remainingCalls: () => 10, chargeCall: memory.chargeCall, prepareCheckpoint: prepare, validateCheckpoint: validate } });
    return { ...f, memory, compactor, prepare, validate, expand: () => { working = 100000; } };
  }
  it("does not prepare checkpoints at low pressure", async () => {
    const f = await start({ low: true }); const p = await f.compactor.prepare(); expect(f.prepare).not.toHaveBeenCalled(); expect(ids([p])).toContain("old");
  });
  it("activates only the supported provider-history adapter", async () => {
    const f = await start({ unknownAdapter: true }); await expect(f.compactor.prepare()).rejects.toThrow(); expect(f.prepare).not.toHaveBeenCalled();
  });
  it("uses smaller real messages at pressure and validates evidence before dispatch", async () => {
    const f = await start(); const p = await f.compactor.prepare(); expect(f.prepare).toHaveBeenCalledOnce(); expect(ids([p])).not.toContain("old");
    await f.compactor.validateEvidence(); expect(f.validate).toHaveBeenCalledWith(f.snapshot); expect(f.memory.call).not.toHaveBeenCalled();
  });
  it("withdraws a stale checkpoint on the next preparation and preserves the budget block", async () => {
    const f = await start(); await f.compactor.prepare(); f.validate.mockRejectedValue(new Error("checkpoint_stale_path"));
    await expect(f.compactor.validateEvidence()).rejects.toThrow("checkpoint_stale_path");
    f.prepare.mockResolvedValue(null as never); await expect(f.compactor.prepare()).rejects.toThrow();
  });
  it("restores exact originals after an evidence request without tools, extraction or network", async () => {
    const f = await start(); await f.compactor.prepare();
    expect(f.compactor.requestEvidence("Need the original body", "old")).toMatchObject({ status: "queued" });
    f.expand(); const restored = await f.compactor.prepare(); expect(ids([restored])).toContain("old"); expect(f.memory.call).not.toHaveBeenCalled();
    expect(f.messages[1].parts).toEqual((await fixture()).messages[1].parts);
  });
  it("missing observations leave irreducible protected context blocked", async () => {
    const f = await start({ missing: true }); await expect(f.compactor.prepare()).rejects.toThrow(); expect(f.memory.call).not.toHaveBeenCalled();
  });
  it("reconstructs the same projection in a fresh compactor", async () => {
    const first = await start(), second = await start(); expect(await first.compactor.prepare()).toEqual(await second.compactor.prepare());
  });
  it("rejects a late checkpoint preparation after cancellation", async () => {
    const f = await fixture(), memory = compactionFixture(f.messages), abort = new AbortController();
    let release: (value: WriteCheckpoint) => void = () => {};
    const pending = new Promise<WriteCheckpoint>(resolve => { release = resolve; });
    const compactor = await memory.start({ signal: abort.signal, checkpointHistory: "ollama-native-v1",
      context: { owner, originals: f.messages, ready: memory.ready, remainingCalls: () => 10, chargeCall: memory.chargeCall,
        prepareCheckpoint: () => pending, validateCheckpoint: async () => {} } });
    const result = compactor.prepare(); abort.abort(); release(f.snapshot);
    await expect(result).rejects.toMatchObject({ name: "AbortError" }); expect(memory.call).not.toHaveBeenCalled();
  });
});

it("frozen b2cd814 still blocks: legacy records have no native checkpoint observations", async () => {
  const params = structuredClone(capture.params);
  params.prompt = [...params.prompt.filter(m => m.role === "system"), { role: "system", content: "Continue the SAME assistant answer exactly from its last character. Do not repeat any prior text, restart the task, or add a new introduction. Preserve whitespace, code and Markdown. Existing permissions and approvals remain in force." },
    ...params.prompt.filter(m => m.role !== "system"), { role: "assistant", content: [{ type: "text", text: capture.response.text }] }];
  const body = ollamaBody("nemotron-3.5-lightning:30b-a3b-q4_K_M", params as never, true);
  const raw = structuredClone(params.prompt) as unknown as ModelMessage[];
  const projected = await projectCheckpointWrites([raw], null, owner);
  expect(projected.receipts).toHaveLength(0);
  const after = ollamaBody("nemotron-3.5-lightning:30b-a3b-q4_K_M", { ...params, prompt: projected.blocks[0] } as never, true);
  expect(after).toEqual(body);
  expect(await contextDigest(body)).toBe(capture.expected.blockedNativeSha256);
  const b = resolveContextBudget(capture.limits, measureRequest(body), 2048);
  expect(b.cost.system + b.cost.tools + b.cost.conversation).toBe(61132); expect(b.margin).toBe(6114); expect(b.reserve).toBe(2048);
  expect(b.working - b.cost.conversation).toBe(-3758); expect(b.fits).toBe(false);
});
