import { afterEach, describe, expect, it } from "vitest";
import { COMPACTION_POLICY } from "@/modules/ai/lib/compactionExtraction";
import { contextDigest } from "@/modules/ai/lib/targetContext";
import type { ScopedRequest } from "@/modules/ai/lib/scopedEvidence";
import { newRetrievalAllowance } from "@/modules/ai/lib/retrievalAllowance";
import { multilineRefusal, refusedShellHistory } from "@/modules/ai/lib/toolFailureRetention.fixture";
import { vi } from "vitest";
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
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Required fixture state missing");
  return value;
}

describe("durable conversation compaction coordinator", () => {
  it("prepares refusal receipts and restores exact current-run originals through existing evidence requests without effects", async () => {
    const f = fixture([textMessage("objective", "user", "Preserve the current objective.")]);
    const extra = refusedShellHistory();
    const before = structuredClone(extra);
    const compactor = await f.start({ limits: async () => ({ deployed: 32768, maxOutput: 512 }) });
    const prepared = JSON.stringify(await compactor.prepare(extra));
    expect(prepared).toContain("refused-before-execution");
    expect(prepared).not.toContain("unexecuted draft");
    expect(compactor.requestEvidence("Inspect the exact failed input", "refused")).toMatchObject({ status: "queued" });
    const restored = JSON.stringify(await compactor.prepare(extra));
    expect(restored).toContain("unexecuted draft");
    expect(restored).not.toContain("Clack tool-history receipt");
    expect(extra).toEqual(before);
    expect(f.call).not.toHaveBeenCalled();
    expect(f.memory.commit).not.toHaveBeenCalled();
    compactor.dispose();
    expect(() => compactor.requestEvidence("Inspect", "refused")).toThrow(/no longer current/);
  });

  it("does not trim exact restored evidence to evade B1", async () => {
    const f = fixture([textMessage("objective", "user", "Preserve requirements.")]);
    const extra = refusedShellHistory();
    let capacity = 32768;
    const compactor = await f.start({ limits: async () => ({ deployed: capacity, maxOutput: 512 }) });
    const compact = await compactor.prepare(extra);
    const cost = measureRequest({ messages: compact, tools: [] });
    const budget = resolveContextBudget({ deployed: capacity, maxOutput: 512 }, cost);
    capacity = cost.system + cost.tools + cost.conversation + budget.reserve + budget.margin + 1;
    expect(compactor.requestEvidence("Original", "refused")).toMatchObject({ status: "queued" });
    await expect(compactor.prepare(extra)).rejects.toMatchObject({ code: "compaction-protected-budget" });
    expect(f.call).not.toHaveBeenCalled();
    expect(f.memory.commit).not.toHaveBeenCalled();
  });

  it("rebuilds receipts after session serialization without replacing durable tool records", async () => {
    const command = (refusedShellHistory()[0].content as Array<{ input: { command: string } }>)[0].input.command;
    const originals: import("ai").UIMessage[] = [textMessage("objective", "user", "Keep the objective."), {
      id: "durable-assistant", role: "assistant", parts: [
        { type: "step-start" },
        { type: "tool-bash_run", toolCallId: "refused", state: "output-available", input: { command }, output: { error: multilineRefusal } },
        { type: "step-start" },
        { type: "tool-bash_run", toolCallId: "adapted", state: "output-available", input: { command: "echo adapted" }, output: { command: "echo adapted", stdout: "adapted", stderr: "", exit_code: 0, timed_out: false } },
      ],
    }];
    const serialized = JSON.stringify(originals);
    const f = fixture(JSON.parse(serialized));
    const compactor = await f.start({ limits: async () => ({ deployed: 32768, maxOutput: 512 }), alwaysLoad: true });
    expect(JSON.stringify(await compactor.prepare())).toContain("refused-before-execution");
    compactor.requestEvidence("Original input", "refused");
    expect(JSON.stringify(await compactor.prepare())).toContain("unexecuted draft");
    const restarted = fixture(JSON.parse(serialized));
    expect(JSON.stringify(await (await restarted.start({ limits: async () => ({ deployed: 32768, maxOutput: 512 }) })).prepare())).toContain("refused-before-execution");
    expect(JSON.stringify(f.originals)).toBe(serialized);
    expect(f.memory.commit).not.toHaveBeenCalled();
    expect(f.call).not.toHaveBeenCalled();
  });

  it("uses the existing shared retrieval bounds and does not disclose another coordinator's originals", async () => {
    const f = fixture([textMessage("objective", "user", "Keep scope.")]);
    const allowance = newRetrievalAllowance();
    const compactor = await f.start({ allowance, limits: async () => ({ deployed: 32768, maxOutput: 512 }) });
    await compactor.prepare(refusedShellHistory());
    const other = await fixture([textMessage("different", "user", "Independent context.")]).start();
    expect(other.requestEvidence("Other source", "refused")).toMatchObject({ status: "unavailable" });
    allowance.rounds = 2;
    expect(compactor.requestEvidence("Original", "refused")).toMatchObject({ status: "limit" });
    allowance.rounds = 0;
    allowance.bytes = 65536;
    expect(compactor.requestEvidence("Original", "refused")).toMatchObject({ status: "queued" });
    await expect(compactor.prepare(refusedShellHistory())).rejects.toMatchObject({ code: "retrieval-limit" });
    expect(f.memory.commit).not.toHaveBeenCalled();
  });

  it("fails closed if the existing session-write barrier fails before receipt preparation", async () => {
    const f = fixture([textMessage("objective", "user", "Keep originals.")]);
    const compactor = await f.start({ limits: async () => ({ deployed: 32768, maxOutput: 512 }) });
    f.ready.mockRejectedValueOnce(new Error("Session persistence unavailable"));
    await expect(compactor.prepare(refusedShellHistory())).rejects.toThrow("Session persistence unavailable");
    expect(f.call).not.toHaveBeenCalled();
    expect(f.memory.commit).not.toHaveBeenCalled();
  });

  it.each(["stale", "cancelled"])("rejects original-source requests after the scope becomes %s", async kind => {
    const f = fixture([textMessage("objective", "user", "Keep scope.")]);
    const controller = new AbortController();
    let current = true;
    const compactor = await f.start({
      limits: async () => ({ deployed: 32768, maxOutput: 512 }), signal: controller.signal,
      scope: { sessionId: "chat-a", runId: "captured-run", isCurrent: () => current },
    });
    await compactor.prepare(refusedShellHistory());
    if (kind === "stale") current = false;
    else controller.abort();
    expect(() => compactor.requestEvidence("Original", "refused")).toThrow();
    await expect(compactor.prepare(refusedShellHistory())).rejects.toThrow();
    expect(f.call).not.toHaveBeenCalled();
  });
  it("projects only superseded acknowledged plans through the coordinator without rewriting originals or committing memory", async () => {
    const f = fixture([textMessage("mission", "user", "Build ForgeBoard. Keep port 4317, page size 50, title max 120, debounce 750ms, SSE, persistence and no cloud.")]);
    const before = JSON.stringify(f.originals);
    const extra: import("ai").ModelMessage[] = ["first", "current"].flatMap((id, index) => [
      { role: "assistant" as const, content: [{ type: "tool-call" as const, toolName: "todo_write", toolCallId: id, input: { todos: [{ title: "Implement and verify", status: index ? "in_progress" : "pending" }] } }] },
      { role: "tool" as const, content: [{ type: "tool-result" as const, toolName: "todo_write", toolCallId: id, output: { type: "json" as const, value: { ok: true, count: 1 } } }] },
    ]);
    const source = JSON.stringify(extra);
    const compactor = await f.start({ limits: async () => ({ deployed: 32768 }), alwaysLoad: true });
    const output = JSON.stringify(await compactor.prepare(extra));
    expect(output).not.toContain('"toolCallId":"first"');
    expect(output).toContain('"toolCallId":"current"');
    expect(output).toContain("Keep port 4317");
    expect(f.memory.commit).not.toHaveBeenCalled();
    expect(f.call).not.toHaveBeenCalled();
    expect(f.view().revision).toBeNull();
    expect(JSON.stringify(f.originals)).toBe(before);
    expect(JSON.stringify(extra)).toBe(source);
  });
  it("does not revalidate an empty optional lookup across long-running mutations and transport checks", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture([textMessage("mission", "user", "Build ForgeBoard in this empty repository and finish the current plan.")]);
      const before = JSON.stringify(f.originals);
      const memoryBefore = f.view();
      const allowance = newRetrievalAllowance();
      const read = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 158));
        return { chunks: [], issues: [], omitted: 0, stamp: "c".repeat(64), identityStamp: "e".repeat(64), taskIds: [], bytes: 0, reads: 0 };
      });
      const compactor = await f.start({
        allowance,
        limits: async () => ({ deployed: 32768 }),
        scopedEvidence: { read, allowed: () => true },
      });
      const complete = async <T,>(operation: Promise<T>) => {
        let settled = false;
        const outcome = operation.then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
        for (let tick = 0; !settled && tick < 10; tick++) await vi.advanceTimersByTimeAsync(158);
        expect(settled).toBe(true);
        const result = await outcome;
        if ("error" in result) throw result.error;
        return result.value;
      };
      for (let step = 0; step < 17; step++) {
        const prepared = await complete(compactor.prepare([
          { role: "assistant", content: "Current plan: scaffold, implement, test, build." },
          { role: "tool", content: [{ type: "tool-result", toolName: "write_file", toolCallId: `write-${step}`, output: { type: "json", value: { ok: true, clackWorkspaceWrite: true } } }] },
        ]));
        expect(JSON.stringify(prepared)).toContain("Current plan");
        await complete(compactor.validateEvidence());
        await complete(compactor.validateEvidence());
        // Inference/tool latency does not consume local evidence work allowance.
        vi.advanceTimersByTime(28000);
      }
      expect(read).toHaveBeenCalledOnce();
      expect(allowance.elapsed).toBe(158);
      expect(allowance.scopedRounds).toBe(1);
      expect(f.memory.commit).not.toHaveBeenCalled();
      expect(f.view()).toEqual(memoryBefore);
      expect(JSON.stringify(f.originals)).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
  it("rebases append-only SDK assistant tails without regenerating extracted evidence", async () => {
    const f = fixture();
    const tail = textMessage("active-tail", "assistant", "Verified pending plan and current tool results.");
    f.originals.push(tail);
    const prefix = await contextDigest(f.originals.slice(0, -1));
    const oldParts = await contextDigest(tail.parts);
    const commit = required(f.memory.commit.getMockImplementation());
    f.memory.commit.mockImplementationOnce(async (candidate, signal) => {
      tail.parts.push({ type: "text", text: "New SDK step outside compaction coverage." });
      const current = f.view();
      f.change({ preparation: { ...current.preparation, generation: current.preparation.generation + 1, source: { ...current.preparation.source, transcriptRevision: current.preparation.source.transcriptRevision + 1 } } });
      return commit(candidate, signal);
    });
    const rebase = vi.fn(async (_preparation, count, hash, proof) => {
      expect(count).toBe(f.originals.length - 1);
      expect(hash).toBe(prefix);
      expect(proof).toMatchObject({ messageId: "active-tail", partsCount: 1, partsHash: oldParts });
      expect(await contextDigest(tail.parts.slice(0, proof.partsCount))).toBe(proof.partsHash);
      return f.view();
    });
    await (await f.start({ memory: { ...f.memory, rebase } })).prepare();
    expect(rebase).toHaveBeenCalledOnce();
    expect(f.memory.commit.mock.calls.length).toBe(f.call.mock.calls.length + 1);
  });
  it("handles another verified append between rebasing and commit without replaying extraction", async () => {
    const f = fixture();
    const commit = required(f.memory.commit.getMockImplementation());
    const append = () => {
      const current = f.view();
      f.originals.push(textMessage(`live-${f.originals.length}`, "assistant", "Current run output"));
      f.change({ preparation: { ...current.preparation, generation: current.preparation.generation + 1, source: { ...current.preparation.source, transcriptRevision: current.preparation.source.transcriptRevision + 1 } } });
    };
    f.memory.commit.mockImplementationOnce(async (candidate, signal) => { append(); return commit(candidate, signal); });
    const rebase = vi.fn(async () => {
      const current = f.view();
      if (rebase.mock.calls.length === 1) append();
      return current;
    });
    const compactor = await f.start({ memory: { ...f.memory, rebase } });
    await compactor.prepare();
    expect(rebase).toHaveBeenCalledTimes(2);
    expect(f.memory.commit.mock.calls.length).toBe(f.call.mock.calls.length + 2);
    expect(f.view().revision?.coverage.end).toBeLessThan(f.originals.length - 2);
  });
  it.each([8192, 16384, 32768])("preserves exact operational facts across ten incremental compaction cycles at %s context", async capacity => {
    const facts = "Current timeoutMs=750, NOT 900. allowRemote=false. Keep port 7351, API v2, schema 3, src/auth.ts, docs/caf\u00e9.md, retries=2, owner=Reviewer and unresolved issue CHECK-19. Architecture: config owns timeout. Depend on original Review-17. External effect UNKNOWN-22 remains unresolved and must never replay. Never promote an assumption to verified evidence.";
    const cycleLimits = { deployed: capacity, workingTarget: 6000, maxOutput: 1024, outputReserve: 1024 };
    const f = fixture(history());
    f.originals[0] = textMessage("user-original", "user", facts);
    f.originals.splice(1, 0, { id: "failed-tool", role: "assistant", parts: [{ type: "tool-read_file", toolCallId: "denied-read", state: "output-error", input: { path: "src/auth.ts" }, errorText: "Permission denied. Never circumvent secret protections." }] });
    const extract = required(f.call.getMockImplementation());
    f.call.mockImplementation(async request => {
      const output = await extract(request);
      const value = JSON.parse(output.text);
      for (const claim of value.claims) { claim.section = "completed-work"; claim.status = "inference"; }
      return { ...output, text: JSON.stringify(value) };
    });
    let revision = 0;
    for (let cycle = 0; cycle < 10; cycle++) {
      if (cycle) f.originals.push(
        textMessage(`observation-${cycle}-a`, "assistant", `Completed observation ${cycle}a.\n${"historical observation ".repeat(150)}`),
        textMessage(`observation-${cycle}-b`, "assistant", `Completed observation ${cycle}b.\n${"historical observation ".repeat(150)}`),
        textMessage(`observation-${cycle}-c`, "assistant", `Completed observation ${cycle}c.\n${"historical observation ".repeat(150)}`),
        textMessage(`request-${cycle}`, "user", "Continue the bounded current task; preserve the corrected requirements."),
      );
      const currentPlan = [
        { id: "inspect", title: "Inspection finished; do not repeat its effects", status: "completed" },
        { id: "fix", title: `Resolve failing test CHECK-19 at cycle ${cycle}`, status: "in_progress" },
        { id: "document", title: "Document verified result only after successful test", status: "pending" },
      ];
      f.originals.splice(f.originals.length - 1, 0, {
        id: `plan-${cycle}`, role: "assistant", parts: [{ type: "tool-todo_write", toolCallId: `plan-call-${cycle}`, state: "output-available", input: { todos: currentPlan }, output: { ok: true, count: 3 } }],
      });
      const before = JSON.stringify(f.originals);
      const calls = f.call.mock.calls.length;
      const compactor = await f.start({ limits: async () => cycleLimits });
      const result = await compactor.prepare();
      const saved = required(f.view().revision);
      expect(saved.revision).toBeGreaterThan(revision);
      revision = saved.revision;
      expect(f.call.mock.calls.length - calls).toBeLessThanOrEqual(COMPACTION_POLICY.maxChunks);
      expect(JSON.stringify(result)).toContain(facts);
      expect(JSON.stringify(result)).toContain("Permission denied. Never circumvent secret protections.");
      expect(JSON.stringify(result)).toContain(JSON.stringify(currentPlan));
      expect(JSON.stringify(f.originals)).toBe(before);
      expect(saved.coverage.latestMessageId).toBe(f.originals[saved.coverage.end - 1].id);
      expect(saved.coverage.end).toBeLessThan(f.originals.length);
      for (const evidence of saved.evidence) {
        expect(evidence.relatedSessions).toEqual(["chat-a"]);
        expect(evidence.locator.kind).toBe("message");
      }
      expect(resolveContextBudget(cycleLimits, measureRequest({ messages: result, tools: [] })).fits).toBe(true);
      compactor.dispose();
    }
  });
  it("resumes after four bounded chunks with safe headroom while uncaptured originals stay authoritative", async () => {
    const originals = [textMessage("requirement", "user", "Preserve timeoutMs=750 and allowRemote=false."),
      ...Array.from({ length: 25 }, (_, index) => textMessage(`result-${index}`, "assistant", `Completed ${index}.\n${"historical observation ".repeat(80)}`)),
      textMessage("next", "user", "Read config.json."),
    ];
    const f = fixture(originals);
    const extract = required(f.call.getMockImplementation());
    f.call.mockImplementation(async request => {
      const output = await extract(request);
      const value = JSON.parse(output.text);
      for (const claim of value.claims) { claim.section = "completed-work"; claim.status = "inference"; }
      return { ...output, text: JSON.stringify(value) };
    });
    const result = await (await f.start()).prepare();
    expect(f.call).toHaveBeenCalledTimes(4);
    const budget = resolveContextBudget(limits, measureRequest({ messages: result, tools: [] }));
    expect(budget.fits).toBe(true);
    expect(budget.cost.conversation).toBeLessThanOrEqual(budget.working * COMPACTION_POLICY.trigger);
    // Source-index extraction creates shorter valid claims, so the strict
    // target may now be met as well. The safety invariant is that all still
    // uncovered history remains original and the request is below trigger.
    expect(budget.cost.conversation).toBeGreaterThan(0);
    expect(f.view().revision?.coverage.end).toBeGreaterThan(0);
    expect(f.view().revision?.coverage.end).toBeLessThan(originals.length);
    expect(f.originals).toEqual(originals);
  });
  it("refreshes confirmed write observations before extraction transport validates evidence", async () => {
    const f = fixture();
    let written = false;
    let currentLimits = { deployed: 32768, workingTarget: 32768 };
    const identityStamp = "e".repeat(64);
    const read = vi.fn(async (request: ScopedRequest) => {
      const stamp = (written ? "d" : "c").repeat(64);
      if (request.expected && request.expected !== stamp)
        throw new Error("scoped_evidence_stale_receipt");
      const text = written ? "Current file after confirmed write." : "Current file before write.";
      const chunks = [{ id: "a".repeat(64), kind: "file" as const, workspaceId: "local:/workspace-a", checkout: "local:/workspace-a", source: { path: "src/config.ts" }, revision: 1, contentHash: (written ? "d" : "b").repeat(64), text, start: 0, end: text.length, required: false, freshness: "current-file-observation", qualification: "file-evidence", reason: "explicit-file-reference" }];
      return { chunks, issues: [], omitted: 0, stamp, identityStamp, taskIds: [], bytes: new TextEncoder().encode(JSON.stringify(chunks[0])).byteLength, reads: 1 };
    });
    const compactor = await f.start({
      limits: async () => currentLimits,
      scopedEvidence: { read, allowed: () => true },
    });
    await compactor.prepare();
    expect(f.call).not.toHaveBeenCalled();
    const extract = required(f.call.getMockImplementation());
    f.call.mockImplementation(async request => {
      await compactor.validateEvidence();
      return extract(request);
    });
    written = true;
    currentLimits = limits;
    await compactor.prepare([{ role: "tool", content: [{
      type: "tool-result", toolName: "write_file", toolCallId: "confirmed-write",
      output: { type: "json", value: { ok: true, clackWorkspaceWrite: true } },
    }] }]);
    expect(f.call).toHaveBeenCalled();
    expect(read.mock.calls[1][0]).toMatchObject({ expected: null, expectedIdentity: identityStamp });
    await compactor.validateEvidence();
    expect(read.mock.lastCall?.[0].expected).toBe("d".repeat(64));
  });
  it("rebases a verified append once without replaying extraction or extending source coverage", async () => {
    const f = fixture();
    const commit = required(f.memory.commit.getMockImplementation());
    f.memory.commit.mockImplementationOnce(async (candidate, signal) => {
      const current = f.view();
      f.originals.push(textMessage("live-output", "assistant", "Current run output"));
      f.change({ preparation: { ...current.preparation, generation: current.preparation.generation + 1, source: { ...current.preparation.source, transcriptRevision: 2 } } });
      return commit(candidate, signal);
    });
    const rebase = vi.fn(async (_preparation, count, hash) => {
      expect(hash).toBe(await contextDigest(f.originals.slice(0, count)));
      return f.view();
    });
    const compactor = await f.start({ memory: { ...f.memory, rebase } });
    await compactor.prepare();
    expect(rebase).toHaveBeenCalledOnce();
    expect(f.view().revision?.coverage.end).toBeLessThan(f.originals.length - 1);
    expect(f.memory.commit.mock.calls.length).toBe(f.call.mock.calls.length + 1);
  });
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
    const coverage = f.view().revision?.coverage;
    expect(coverage?.end).toBeLessThan(originals.length);
    expect(coverage?.latestMessageId).toBe(originals[(coverage?.end ?? 1) - 1].id);
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
