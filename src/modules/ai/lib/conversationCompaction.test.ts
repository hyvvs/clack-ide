import { afterEach, describe, expect, it } from "vitest";
import { COMPACTION_POLICY } from "@/modules/ai/lib/compactionExtraction";
import {
  measureRequest,
  resolveContextBudget,
} from "@/modules/ai/lib/contextBudget";
import {
  compactionFixture as fixture,
  disposeCompactionFixtures,
  history,
  textMessage,
  limits,
} from "@/modules/ai/lib/conversationCompaction.fixture";
afterEach(disposeCompactionFixtures);

describe("durable conversation compaction coordinator", () => {
  it("does no memory or inference work below threshold", async () => {
    const f = fixture([textMessage("short", "user", "Hello")]);
    const compactor = await f.start();
    expect(await compactor.prepare()).toHaveLength(2);
    expect(f.memory.load).not.toHaveBeenCalled();
    expect(f.call).not.toHaveBeenCalled();
  });
  it.each([
    "schema 3",
    "caf\u00e9.ts / \u4fdd\u7559 API v2",
  ])("A/B fixture preserves requirements, decisions and unresolved tasks: %s", async (label) => {
    const f = fixture(history(label));
    const before = JSON.stringify(f.originals);
    const compactor = await f.start();
    const result = await compactor.prepare();
    const serialized = JSON.stringify(result);
    expect(serialized).toContain(
      "Never change port 1420, auth.ts or the permission checks.",
    );
    expect(serialized).toContain("Continue the pending migration");
    for (let i = 0; i < 8; i++)
      expect(serialized).toContain(
        `Decision ${i}: use ${label}; tests remain unresolved.`,
      );
    expect(JSON.stringify(f.originals)).toBe(before);
    expect(f.call.mock.calls.length).toBeLessThanOrEqual(4);
    expect(f.chargeCall).toHaveBeenCalledTimes(f.call.mock.calls.length);
    expect(f.ready).toHaveBeenCalledTimes(1);
    expect(f.onOptimized).toHaveBeenCalledOnce();
    expect(
      resolveContextBudget(
        limits,
        measureRequest({ messages: result, tools: [] }),
      ).fits,
    ).toBe(true);
    expect(f.view().revision?.coverage.end).toBeLessThan(f.originals.length);
  });
  it("survives coordinator restart and reuses committed memory without extraction", async () => {
    const f = fixture();
    const first = await f.start();
    const result = await first.prepare();
    first.dispose();
    const calls = f.call.mock.calls.length;
    const restored = await f.start();
    expect(await restored.prepare()).toEqual(result);
    expect(f.call).toHaveBeenCalledTimes(calls);
  });
  it("incremental updates read original uncovered spans and retain claim identities", async () => {
    const f = fixture();
    await (await f.start()).prepare();
    const before = f.view();
    f.originals.push(
      ...history("later decision")
        .slice(1, 6)
        .map((m) => ({ ...m, id: `later-${m.id}` })),
      textMessage("later-request", "user", "Continue"),
    );
    f.memory.read.mockClear();
    const previousClaims = before.revision?.claims ?? [];
    await (await f.start()).prepare();
    const firstRead = f.memory.read.mock.calls[0][1] as Array<{
      messageId: string;
    }>;
    expect(firstRead[0].messageId).toBe(
      f.originals[before.revision?.coverage.end ?? 0].id,
    );
    for (const claim of previousClaims)
      expect(f.view().revision?.claims).toContainEqual(claim);
  });
  it("stops huge legacy history after four chunks and checkpoints truthful coverage", async () => {
    const originals = [textMessage("u", "user", "Keep the API")];
    // About 239K B1 estimated tokens, divided into intact original messages.
    for (let i = 0; i < 80; i++)
      originals.push(
        textMessage(
          `a-${i}`,
          "assistant",
          `Decision ${i}: keep schema 3.\n${"x".repeat(8900)}`,
        ),
      );
    originals.push(textMessage("latest", "user", "Continue"));
    const f = fixture(originals);
    const compactor = await f.start();
    await expect(compactor.prepare()).rejects.toMatchObject({
      code: "compaction-batch-limit",
    });
    expect(f.call).toHaveBeenCalledTimes(4);
    expect(f.view().revision?.coverage.end).toBeLessThan(15);
    expect(f.onOptimized).not.toHaveBeenCalled();
    expect(f.originals).toHaveLength(82);
  });
  it("rejects a provider failure without publishing", async () => {
    const f = fixture();
    f.call.mockRejectedValue(new Error("endpoint disconnected"));
    await expect((await f.start()).prepare()).rejects.toThrow(
      "endpoint disconnected",
    );
    expect(f.memory.commit).not.toHaveBeenCalled();
  });
  it("rejects invalid JSON after one validation retry without advancing coverage", async () => {
    const f = fixture();
    f.call.mockResolvedValue({
      text: "bad JSON",
      usage: { inputTokens: 1, outputTokens: 10, cachedInputTokens: 0 },
    });
    await expect((await f.start()).prepare()).rejects.toMatchObject({
      code: "compaction-invalid-output",
    });
    expect(f.call).toHaveBeenCalledTimes(2);
    expect(f.memory.commit).not.toHaveBeenCalled();
  });
  it("rejects native source content changed before generation", async () => {
    const f = fixture();
    const read = f.memory.read.getMockImplementation();
    f.memory.read.mockImplementation(async (...args) => {
      const result = await read?.(...args);
      if (result?.[0])
        result[0].value = textMessage(
          "user-original",
          "user",
          "Different content",
        );
      return result ?? [];
    });
    await expect((await f.start()).prepare()).rejects.toMatchObject({
      code: "compaction-stale",
    });
    expect(f.call).not.toHaveBeenCalled();
  });
  it("rejects a concurrent source revision at native CAS", async () => {
    const f = fixture();
    const call = f.call.getMockImplementation();
    f.call.mockImplementation(async (options) => {
      const result = await call?.(options);
      const view = f.view();
      f.change({
        preparation: {
          ...view.preparation,
          generation: view.preparation.generation + 1,
        },
      });
      if (!result) throw new Error("fixture");
      return result;
    });
    await expect((await f.start()).prepare()).rejects.toThrow(
      "memory_stale_preparation",
    );
    expect(f.view().revision).toBeNull();
  });
  it("cancels after generation before publication", async () => {
    const f = fixture();
    const controller = new AbortController();
    const call = f.call.getMockImplementation();
    f.call.mockImplementation(async (options) => {
      const result = await call?.(options);
      controller.abort();
      if (!result) throw new Error("fixture");
      return result;
    });
    await expect(
      (await f.start({ signal: controller.signal })).prepare(),
    ).rejects.toThrow();
    expect(f.memory.commit).not.toHaveBeenCalled();
  });
  it("does not use malformed memory or mutate it", async () => {
    const f = fixture();
    f.memory.load.mockRejectedValue(new Error("memory_corrupt"));
    await expect((await f.start()).prepare()).rejects.toThrow("memory_corrupt");
    expect(f.call).not.toHaveBeenCalled();
    expect(f.memory.commit).not.toHaveBeenCalled();
  });
  it.each([
    "load",
    "read",
    "commit",
  ] as const)("reports native %s failures as actionable preflight failures", async (operation) => {
    const f = fixture();
    const original = JSON.stringify(f.originals);
    f.memory[operation].mockRejectedValue("memory_corrupt: invalid evidence");
    await expect((await f.start()).prepare()).rejects.toMatchObject({
      code: "compaction-memory",
      contextPreflight: true,
      message: expect.stringContaining(
        "Check memory integrity and workspace access",
      ),
    });
    expect(f.view().revision).toBeNull();
    expect(f.onOptimized).not.toHaveBeenCalled();
    expect(JSON.stringify(f.originals)).toBe(original);
  });
  it("rejects changed covered sources on restart", async () => {
    const f = fixture();
    await (await f.start()).prepare();
    f.change({ sourceChanged: true });
    f.call.mockClear();
    await expect((await f.start()).prepare()).rejects.toMatchObject({
      code: "compaction-changed-source",
    });
    expect(f.call).not.toHaveBeenCalled();
  });
  it("keeps pending step messages outside snapshot coverage and rechecks B1", async () => {
    const f = fixture();
    const compactor = await f.start();
    await compactor.prepare();
    const before = f.view().revision?.coverage;
    const extra = [
      { role: "assistant" as const, content: "New tool step evidence." },
    ];
    const messages = await compactor.prepare(extra);
    expect(messages[messages.length - 1]).toEqual(extra[0]);
    expect(f.view().revision?.coverage).toEqual(before);
    await expect(
      compactor.prepare([{ role: "assistant", content: "x".repeat(100000) }]),
    ).rejects.toMatchObject({ code: "compaction-protected-budget" });
  });
  it("blocks oversized protected attachment content before extraction", async () => {
    const originals = history();
    originals[0].parts.push({
      type: "data-artifact",
      data: { contentId: "c".repeat(64) },
    });
    const materialized = structuredClone(originals);
    materialized[0].parts.push({
      type: "text",
      text: "selected artifact ".repeat(10000),
    });
    const f = fixture(originals);
    await expect(
      (await f.start({ materialized })).prepare(),
    ).rejects.toMatchObject({ code: "compaction-protected-budget" });
    expect(f.call).not.toHaveBeenCalled();
    expect(f.memory.commit).not.toHaveBeenCalled();
  });
  it("rejects unsupported memory policy explicitly", async () => {
    const f = fixture();
    await (await f.start()).prepare();
    const revision = f.view().revision;
    if (!revision) throw new Error("missing fixture revision");
    f.change({
      revision: {
        ...revision,
        policyVersion: `${COMPACTION_POLICY.version}-future`,
      },
    });
    await expect((await f.start()).prepare()).rejects.toMatchObject({
      code: "compaction-policy",
    });
  });
});
