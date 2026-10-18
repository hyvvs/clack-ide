import { canonicalJson } from "@/modules/ai/lib/canonicalJson";
import { planCompaction } from "@/modules/ai/lib/compactionPlan";
import {
  measureRequest,
  resolveContextBudget,
} from "@/modules/ai/lib/contextBudget";
import { COMPACTION_POLICY } from "@/modules/ai/lib/compactionExtraction";
import { newRetrievalAllowance } from "@/modules/ai/lib/retrievalAllowance";
import { contextDigest } from "@/modules/ai/lib/targetContext";
import { createOllamaModel } from "@/modules/ai/lib/ollamaModel";
import {
  compactionFixture,
  disposeCompactionFixtures,
  textMessage,
} from "@/modules/ai/lib/conversationCompaction.fixture";
import {
  compactVerifiedWrites,
  compactVerifiedWriteBlocks,
  confirmWriteSources,
  verifiedWriteCandidates,
} from "@/modules/ai/lib/verifiedWriteHistory";
import type {
  MemoryEvidence,
  MemorySourceLocator,
} from "@/modules/ai/lib/conversationMemory";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";

const root = "/workspace-a";
const body = "line ".repeat(1500);
function write(id: string, content = body, file = `${root}/${id}.ts`) {
  return {
    type: "tool-write_file" as const,
    toolCallId: id,
    state: "output-available" as const,
    input: { path: file, content },
    output: {
      path: file,
      bytesWritten: content.length,
      ok: true,
      clackWorkspaceWrite: true,
    },
  };
}
function snapshot(
  parts = [write("old"), write("older"), write("current", "current source")],
): UIMessage[] {
  const steps: UIMessage["parts"] = [];
  for (const part of parts) steps.push({ type: "step-start" }, part);
  return [{ id: "assistant-original", role: "assistant", parts: steps }];
}
async function setup(messages = snapshot()) {
  const extra = await convertToModelMessages(messages);
  const persist = vi.fn(async (_messages: UIMessage[]) => {});
  const inspect = vi.fn(
    async (locators: MemorySourceLocator[]): Promise<MemoryEvidence[]> =>
      Promise.all(
        locators.map(async (locator) => {
          if (locator.kind !== "part") throw new Error("Unexpected locator");
          const part = messages.find((m) => m.id === locator.messageId)?.parts[
            locator.partIndex
          ];
          return {
            id: "owned-source",
            sourceRevision: 1,
            locator,
            digest: await contextDigest(part),
            contentIds: [],
            relatedSessions: ["chat-a"],
          };
        }),
      ),
  );
  const confirm = () =>
    confirmWriteSources({
      candidates: verifiedWriteCandidates(extra),
      messages,
      workspaceRoot: root,
      sessionId: "chat-a",
      check: () => {},
      persist,
      inspect,
    });
  return { messages, extra, persist, inspect, confirm };
}
afterEach(disposeCompactionFixtures);

describe("verified historical write receipts", () => {
  it("projects intact pairs across block boundaries without changing source groups or framing", async () => {
    const f = await setup(),
      original = structuredClone(f.extra);
    const sources = await f.confirm();
    const split = [[f.extra[0]], f.extra.slice(1)];
    const projected = compactVerifiedWriteBlocks(split, sources);
    expect(projected.blocks).toHaveLength(2);
    expect(projected.receipts[0].sourceBlock).toBe(0);
    expect(projected.blocks.flat()).toEqual(
      compactVerifiedWrites(f.extra, sources).messages,
    );
    const ids = projected.blocks
      .flat()
      .flatMap((message) =>
        Array.isArray(message.content)
          ? message.content.flatMap((part) =>
              "toolCallId" in part ? [part.toolCallId] : [],
            )
          : [],
      );
    expect(ids.filter((id) => id === "old")).toHaveLength(0);
    expect(ids.filter((id) => id === "current")).toHaveLength(2);
    expect(f.extra).toEqual(original);
    expect(
      measureRequest({ messages: projected.blocks.flat() }).conversation,
    ).toBeLessThan(measureRequest({ messages: original }).conversation);
  });

  it("invalidates earlier eligibility when a repeated target arrives in another block", async () => {
    const f = await setup(),
      sources = await f.confirm();
    const repeated = await convertToModelMessages(
      snapshot([
        write("repeat", "new content", `${root}/old.ts`),
        write("last"),
      ]),
    );
    const projected = compactVerifiedWriteBlocks([f.extra, repeated], sources);
    expect(
      projected.receipts.some((receipt) => receipt.toolCallId === "old"),
    ).toBe(false);
    expect(projected.blocks[0]).toContainEqual(f.extra[0]);
    expect(projected.blocks[0]).toContainEqual(f.extra[1]);
    expect(projected.blocks[1]).toContainEqual(repeated[repeated.length - 2]);
    expect(projected.blocks[1]).toContainEqual(repeated[repeated.length - 1]);
  });

  it("does not let a later write across a user boundary retire the previous boundary's latest write", async () => {
    const f = await setup();
    const previous = f.extra.slice(0, 2);
    const projected = compactVerifiedWriteBlocks(
      [
        previous,
        [{ role: "user", content: "New request" }, ...f.extra.slice(2)],
      ],
      await f.confirm(),
    );
    expect(
      projected.receipts.some((receipt) => receipt.toolCallId === "old"),
    ).toBe(false);
    expect(projected.blocks[0]).toEqual(previous);
  });

  it("keeps historical writes hot when an approval in another block seals the same semantic boundary", async () => {
    const f = await setup();
    const pending = {
      role: "assistant",
      content: [
        {
          type: "tool-approval-request",
          approvalId: "original-approval",
          toolCallId: "pending",
        },
      ],
    } as ModelMessage;
    const projected = compactVerifiedWriteBlocks(
      [f.extra, [pending]],
      await f.confirm(),
    );
    expect(projected.receipts).toEqual([]);
    expect(projected.blocks[0]).toEqual(f.extra);
    expect(projected.blocks[1]).toEqual([pending]);
  });
  it("retains a small, source-linked historical result without claiming current state or modifying originals", async () => {
    const f = await setup(),
      original = structuredClone(f.extra);
    const sources = await f.confirm();
    expect(f.persist).toHaveBeenCalledWith(f.messages);
    expect(f.inspect).toHaveBeenCalledOnce();
    const result = compactVerifiedWrites(f.extra, sources);
    expect(result.receipts.map((r) => r.toolCallId)).toEqual(["old", "older"]);
    const hot = JSON.stringify(result.messages);
    expect(hot).not.toContain(body);
    expect(hot).toContain("confirmed-completed-write");
    expect(hot).toContain("Never replay historical calls automatically");
    expect(hot).toContain("not established; read the file");
    expect(hot).toContain("assistant-original");
    expect(hot).toContain("current source");
    expect(f.extra).toEqual(original);
    expect(f.messages[0].parts[1]).toMatchObject({ input: { content: body } });
  });

  it("restores the exact original pair through a pin, never an execution", async () => {
    const f = await setup(),
      sources = await f.confirm();
    const restored = compactVerifiedWrites(f.extra, sources, ["old"]);
    expect(restored.receipts.map((r) => r.toolCallId)).toEqual(["older"]);
    expect(
      canonicalJson(
        restored.messages.filter(
          (m) =>
            Array.isArray(m.content) &&
            m.content.some((p) => "toolCallId" in p && p.toolCallId === "old"),
        ),
      ),
    ).toBe(
      canonicalJson(
        f.extra.filter(
          (m) =>
            Array.isArray(m.content) &&
            m.content.some((p) => "toolCallId" in p && p.toolCallId === "old"),
        ),
      ),
    );
  });

  it("keeps the latest unsuperseded write verbatim even with a durable source", async () => {
    const f = await setup(snapshot([write("current")]));
    expect(verifiedWriteCandidates(f.extra)).toEqual([]);
    expect(compactVerifiedWrites(f.extra, await f.confirm()).messages).toEqual(
      f.extra,
    );
  });

  it.each([
    "/workspace-a/same.ts",
    "C:/workspace-a/SAME.ts",
  ])("does not infer authoritative supersession from repeated path %s", async (file) => {
    const second = file.startsWith("C:") ? "c:/WORKSPACE-A/same.ts" : file;
    const extra = await convertToModelMessages(
      snapshot([
        write("a", body, file),
        write("b", "new source", second),
        write("c"),
      ]),
    );
    expect(verifiedWriteCandidates(extra)).toEqual([]);
  });

  it("keeps failed, uncertain and provider-executed effects and pending approvals hot", async () => {
    const f = await setup();
    const sources = await f.confirm();
    for (const change of [
      (messages: ModelMessage[]) => {
        (messages[1].content as Array<{ output: unknown }>)[0].output = {
          type: "json",
          value: { error: "uncertain write" },
        };
      },
      (messages: ModelMessage[]) => {
        (
          messages[0].content as Array<{ providerExecuted?: boolean }>
        )[0].providerExecuted = true;
      },
      (messages: ModelMessage[]) => {
        (messages[0].content as unknown[]).push({
          type: "tool-approval-request",
          approvalId: "pending",
          toolCallId: "old",
        });
      },
    ]) {
      const copy = structuredClone(f.extra);
      change(copy);
      const result = compactVerifiedWrites(copy, sources);
      expect(result.receipts.some((r) => r.toolCallId === "old")).toBe(false);
      expect(JSON.stringify(result.messages)).toContain(body);
    }
  });

  it("fails closed for missing, changed, duplicate or mismatched source proof", async () => {
    const f = await setup(),
      sources = await f.confirm();
    expect(compactVerifiedWrites(f.extra, []).receipts).toEqual([]);
    expect(
      compactVerifiedWrites(
        f.extra,
        sources.map((s) => ({ ...s, digest: "broken" })),
      ).receipts,
    ).toEqual([]);
    expect(
      compactVerifiedWrites(f.extra, [...sources, ...sources]).receipts,
    ).toEqual([]);
    const changed = sources.map((s) => ({
      ...s,
      input: { ...s.input, content: "different" },
    }));
    expect(compactVerifiedWrites(f.extra, changed).receipts).toEqual([]);
  });

  it("requires durable native inspection and owner/current-run checks", async () => {
    const f = await setup();
    const options = {
      candidates: verifiedWriteCandidates(f.extra),
      messages: f.messages,
      workspaceRoot: root,
      sessionId: "chat-a",
      check: vi.fn(),
      persist: f.persist,
      inspect: f.inspect,
    };
    await expect(
      confirmWriteSources({
        ...options,
        persist: async () => {
          throw new Error("persistence unavailable");
        },
      }),
    ).rejects.toThrow("persistence unavailable");
    expect(f.inspect).not.toHaveBeenCalled();
    expect(
      await confirmWriteSources({
        ...options,
        workspaceRoot: "/other-workspace",
      }),
    ).toEqual([]);
    expect(
      await confirmWriteSources({ ...options, inspect: async () => [] }),
    ).toEqual([]);
    expect(
      await confirmWriteSources({
        ...options,
        sessionId: "other-conversation",
      }),
    ).toEqual([]);
    const actual = await f.inspect([
      { kind: "part", messageId: "assistant-original", partIndex: 1 },
    ]);
    expect(
      await confirmWriteSources({
        ...options,
        inspect: async () =>
          actual.map((e) => ({ ...e, digest: "0".repeat(64) })),
      }),
    ).toEqual([]);
    await expect(
      confirmWriteSources({
        ...options,
        check: () => {
          throw new Error("stale run");
        },
      }),
    ).rejects.toThrow("stale run");
  });

  it("still fails closed for a genuinely irreducible protected set above 32K", () => {
    expect(() =>
      planCompaction({
        units: [
          {
            messageId: "requirements",
            role: "user",
            messages: [{ role: "user", content: "mandatory ".repeat(20000) }],
            hasContentReferences: false,
          },
        ],
        system: [],
        tools: [],
        limits: { deployed: 32768, maxOutput: 2048 },
        extra: [],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "compaction-protected-budget" }),
    );
  });

  it("retains a large uncertain mutation verbatim and permits its protected-budget failure", async () => {
    const f = await setup();
    const uncertain = await convertToModelMessages(
      snapshot([
        {
          ...write("uncertain", "unresolved effect ".repeat(10000)),
          output: {
            error: "interrupted filesystem operation",
          } as unknown as ReturnType<typeof write>["output"],
        },
      ]),
    );
    const projected = compactVerifiedWrites(uncertain, await f.confirm());
    expect(projected.messages).toEqual(uncertain);
    expect(() =>
      planCompaction({
        units: [],
        system: [],
        tools: [],
        extra: projected.messages,
        verifiedWriteSources: [],
        limits: { deployed: 32768, maxOutput: 2048 },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "compaction-protected-budget" }),
    );
  });
});

describe("pressure-only write receipt integration", () => {
  it("preserves the verified view across a fresh continuation compactor and restores owned original evidence without replay", async () => {
    const requirements = textMessage(
      "requirements",
      "user",
      "Keep original constraints.",
    );
    const source = [requirements, ...snapshot()];
    const writes = await setup(source),
      frozen = structuredClone(source);
    const first = compactionFixture([requirements]);
    const current = await first.start({
      context: {
        owner: first.view().preparation.owner,
        originals: first.originals,
        ready: first.ready,
        remainingCalls: () => 10,
        chargeCall: first.chargeCall,
        confirmWriteSources: () => writes.confirm(),
      },
    });
    const before = await current.prepare(writes.extra.slice(1));
    current.dispose();
    const next = compactionFixture(source),
      allowance = newRetrievalAllowance();
    let working = 6000;
    const confirm = vi.fn(() => writes.confirm());
    const continued = await next.start({
      allowance,
      limits: async () => ({ deployed: 32768, workingTarget: working }),
      context: {
        owner: next.view().preparation.owner,
        originals: next.originals,
        ready: next.ready,
        remainingCalls: () => 10,
        chargeCall: next.chargeCall,
        confirmWriteSources: confirm,
      },
    });
    const after = await continued.prepare();
    expect(after).toEqual(before);
    expect(confirm).toHaveBeenCalledOnce();
    expect(next.call).not.toHaveBeenCalled();
    expect(source).toEqual(frozen);
    expect(writes.persist).toHaveBeenCalledWith(frozen);
    expect(
      continued.requestEvidence("Restore exact historical write", "old"),
    ).toMatchObject({ status: "queued" });
    const restored = await continued.prepare();
    expect(restored).toContainEqual(writes.extra[1]);
    expect(restored).toContainEqual(writes.extra[2]);
    expect(
      resolveContextBudget(
        { deployed: 32768, workingTarget: working },
        measureRequest({ messages: restored }),
      ).fits,
    ).toBe(true);
    expect(allowance).toMatchObject({
      rounds: 1,
      chunks: 1,
      conversationRounds: 1,
    });
    expect(allowance.bytes).toBeGreaterThan(0);
    expect(
      continued.requestEvidence("Restore another original", "older"),
    ).toMatchObject({ status: "queued" });
    working = 2000;
    await expect(continued.prepare()).rejects.toMatchObject({
      code: "compaction-protected-budget",
    });
    expect(
      continued.requestEvidence("No unbounded restoration", "older"),
    ).toMatchObject({ status: "limit" });
    expect(next.call).not.toHaveBeenCalled();
    expect(source).toEqual(frozen);
  });

  it("pins an original receipt's intact group even after valid memory coverage advances", async () => {
    const requirements = textMessage(
      "requirements",
      "user",
      "Keep original constraints.",
    );
    const source = [requirements, ...snapshot()],
      writes = await setup(source);
    const f = compactionFixture(source);
    const compactor = await f.start({
      alwaysLoad: true,
      context: {
        owner: f.view().preparation.owner,
        originals: f.originals,
        ready: f.ready,
        remainingCalls: () => 10,
        chargeCall: f.chargeCall,
        confirmWriteSources: () => writes.confirm(),
      },
    });
    expect(JSON.stringify(await compactor.prepare())).toContain(
      "Clack historical write receipt",
    );
    const locators = source.map((message) => ({
      kind: "message" as const,
      messageId: message.id,
    }));
    await f.memory.read(f.view().preparation, locators);
    await f.memory.commit({
      preparation: f.view().preparation,
      policyVersion: COMPACTION_POLICY.version,
      start: 0,
      end: 2,
      sources: locators,
      claims: [],
    });
    const covered = structuredClone(f.view().revision);
    expect(
      compactor.requestEvidence("Restore covered original pair", "old"),
    ).toMatchObject({ status: "queued" });
    const restored = await compactor.prepare();
    expect(restored).toContainEqual(writes.extra[1]);
    expect(restored).toContainEqual(writes.extra[2]);
    expect(f.view().revision).toEqual(covered);
    expect(f.call).not.toHaveBeenCalled();
  });

  it("requires fresh source proof for pressured original-history writes", async () => {
    const writes = await setup(),
      f = compactionFixture([
        textMessage("requirements", "user", "Preserve source ownership."),
        ...writes.messages,
      ]);
    const compactor = await f.start({
      context: {
        owner: f.view().preparation.owner,
        originals: f.originals,
        ready: f.ready,
        remainingCalls: () => 10,
        chargeCall: f.chargeCall,
        confirmWriteSources: async () => [],
      },
    });
    await expect(compactor.prepare()).rejects.toMatchObject({
      code: "compaction-protected-budget",
    });
    expect(f.call).not.toHaveBeenCalled();
  });

  it.each([
    "failed",
    "uncertain",
  ])("retains a large %s original write and its protected overflow", async (status) => {
    const part = {
      ...write("unresolved", "unresolved evidence ".repeat(10000)),
      output: { error: status } as unknown as ReturnType<
        typeof write
      >["output"],
    };
    const writes = await setup(snapshot([part]));
    const f = compactionFixture([
      textMessage("requirements", "user", "Preserve current failures."),
      ...writes.messages,
    ]);
    const frozen = structuredClone(f.originals);
    const compactor = await f.start({
      context: {
        owner: f.view().preparation.owner,
        originals: f.originals,
        ready: f.ready,
        remainingCalls: () => 10,
        chargeCall: f.chargeCall,
        confirmWriteSources: () => writes.confirm(),
      },
    });
    await expect(compactor.prepare()).rejects.toMatchObject({
      code: "compaction-protected-budget",
    });
    expect(f.originals).toEqual(frozen);
    expect(f.call).not.toHaveBeenCalled();
  });

  it("keeps normal older-history extraction available with verified writes in original recent history", async () => {
    const writes = await setup(),
      f = compactionFixture();
    f.originals.push(...writes.messages);
    const compactor = await f.start({
      context: {
        owner: f.view().preparation.owner,
        originals: f.originals,
        ready: f.ready,
        remainingCalls: () => 10,
        chargeCall: f.chargeCall,
        confirmWriteSources: () => writes.confirm(),
      },
    });
    const result = await compactor.prepare();
    expect(JSON.stringify(result)).toContain("Clack historical write receipt");
    expect(f.call).toHaveBeenCalled();
    expect(f.memory.commit).toHaveBeenCalled();
    expect(f.view().revision?.coverage.end).toBeGreaterThan(0);
  });
  it("preserves verified current-turn receipts while extracting eligible older history", async () => {
    const writes = await setup();
    const f = compactionFixture();
    const compactor = await f.start({
      context: {
        owner: f.view().preparation.owner,
        originals: f.originals,
        ready: f.ready,
        remainingCalls: () => 10,
        chargeCall: f.chargeCall,
        confirmWriteSources: () => writes.confirm(),
      },
    });
    const prepared = await compactor.prepare(writes.extra);
    expect(JSON.stringify(prepared)).toContain(
      "Clack historical write receipt",
    );
    expect(f.call).toHaveBeenCalled();
    expect(f.memory.commit).toHaveBeenCalled();
    expect(f.view().revision?.coverage.end).toBeGreaterThan(0);
    expect(writes.messages[0].parts[1]).toMatchObject({
      input: { content: body },
    });
  });
  it.each([
    "extra",
    "original",
  ])("restores %s via a permitted SDK tool even when F1 has not advertised its schema, without replaying historical writes", async (location) => {
    const writes = await setup();
    const f = compactionFixture([
      textMessage("requirements", "user", "Keep original constraints."),
      ...(location === "original" ? writes.messages : []),
    ]);
    const compactor = await f.start({
      context: {
        owner: f.view().preparation.owner,
        originals: f.originals,
        ready: f.ready,
        remainingCalls: () => 10,
        chargeCall: f.chargeCall,
        confirmWriteSources: () => writes.confirm(),
      },
    });
    const executeWrite = vi.fn();
    const retrieve = vi.fn(
      async ({ query, anchor }: { query: string; anchor: string }) =>
        compactor.requestEvidence(query, anchor),
    );
    const payloads: Array<{ tools: Array<{ function: { name: string } }> }> =
      [];
    const model = createOllamaModel({
      modelId: "offline-test-only",
      baseURL: "http://localhost:11434",
      fetch: async (_url, init) => {
        payloads.push(JSON.parse(String(init?.body)));
        const message =
          payloads.length === 1
            ? {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "restore-request",
                    function: {
                      name: "request_conversation_evidence",
                      arguments: { query: "restore original", anchor: "old" },
                    },
                  },
                ],
              }
            : { role: "assistant", content: "Original evidence restored." };
        return new Response(
          `${JSON.stringify({ message, done: true, done_reason: "stop" })}\n`,
        );
      },
    });
    const result = streamText({
      model,
      messages: [{ role: "user", content: "Keep original constraints." }],
      maxRetries: 0,
      maxOutputTokens: 128,
      tools: {
        unused: tool({ inputSchema: z.object({}) }),
        request_conversation_evidence: tool({
          inputSchema: z.object({ query: z.string(), anchor: z.string() }),
          execute: retrieve,
        }),
        write_file: tool({
          inputSchema: z.object({ path: z.string(), content: z.string() }),
          execute: executeWrite,
        }),
      },
      activeTools: ["unused"],
      stopWhen: stepCountIs(2),
      prepareStep: async ({ messages, stepNumber }) => {
        const projected = await compactor.prepare([
          ...(location === "extra" ? writes.extra : []),
          ...messages.slice(1),
        ]);
        if (stepNumber === 1) {
          expect(projected).toContainEqual(writes.extra[0]);
          expect(projected).toContainEqual(writes.extra[1]);
        }
        return { messages: projected };
      },
    });
    expect(await result.text).toBe("Original evidence restored.");
    expect(payloads).toHaveLength(2);
    expect(payloads[0].tools.map((t) => t.function.name)).toEqual(["unused"]);
    expect(retrieve).toHaveBeenCalledOnce();
    expect(executeWrite).not.toHaveBeenCalled();
    expect(f.call).not.toHaveBeenCalled();
  });
  it("prepares the same active turn, preserves originals and restores exact evidence without extraction or replay", async () => {
    const writes = await setup();
    const original = structuredClone(writes.extra);
    const f = compactionFixture([
      textMessage(
        "requirements",
        "user",
        "Keep port 4317 and all permissions.",
      ),
    ]);
    const confirm = vi.fn(async () => writes.confirm());
    const compactor = await f.start({
      context: {
        owner: f.view().preparation.owner,
        originals: f.originals,
        ready: f.ready,
        remainingCalls: () => 10,
        chargeCall: f.chargeCall,
        confirmWriteSources: confirm,
      },
    });
    const prepared = await compactor.prepare(writes.extra);
    expect(confirm).toHaveBeenCalledOnce();
    expect(JSON.stringify(prepared)).toContain(
      "Clack historical write receipt",
    );
    expect(f.call).not.toHaveBeenCalled();
    expect(writes.extra).toEqual(original);
    expect(compactor.requestEvidence("restore original", "old")).toMatchObject({
      status: "queued",
    });
    const restored = await compactor.prepare(writes.extra);
    expect(restored).toContainEqual(original[0]);
    expect(restored).toContainEqual(original[1]);
    expect(f.call).not.toHaveBeenCalled();
  });

  it("does not confirm or project successful writes before pressure", async () => {
    const writes = await setup(
      snapshot([write("old", "short source"), write("current", "latest")]),
    );
    const f = compactionFixture([
      textMessage("requirements", "user", "Keep original requirements."),
    ]);
    const confirm = vi.fn(async () => writes.confirm());
    const compactor = await f.start({
      context: {
        owner: f.view().preparation.owner,
        originals: f.originals,
        ready: f.ready,
        remainingCalls: () => 10,
        chargeCall: f.chargeCall,
        confirmWriteSources: confirm,
      },
    });
    const result = await compactor.prepare(writes.extra);
    expect(confirm).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("historical write receipt");
  });

  it("blocks when persistence/confirmation fails and does not hide uncertain history", async () => {
    const writes = await setup();
    const f = compactionFixture([
      textMessage("requirements", "user", "Preserve original evidence."),
    ]);
    const compactor = await f.start({
      context: {
        owner: f.view().preparation.owner,
        originals: f.originals,
        ready: f.ready,
        remainingCalls: () => 10,
        chargeCall: f.chargeCall,
        confirmWriteSources: async () => {
          throw new Error("native source unavailable");
        },
      },
    });
    await expect(compactor.prepare(writes.extra)).rejects.toMatchObject({
      code: "compaction-memory",
    });
    expect(f.call).not.toHaveBeenCalled();
    expect(writes.extra[0]).toMatchObject({ role: "assistant" });
  });

  it("revalidates sources on the next pressured request instead of trusting cached proof", async () => {
    const writes = await setup();
    const f = compactionFixture([
      textMessage("requirements", "user", "Keep source ownership."),
    ]);
    const confirm = vi
      .fn()
      .mockImplementationOnce(() => writes.confirm())
      .mockRejectedValueOnce(new Error("corrupt or stale source"));
    const compactor = await f.start({
      context: {
        owner: f.view().preparation.owner,
        originals: f.originals,
        ready: f.ready,
        remainingCalls: () => 10,
        chargeCall: f.chargeCall,
        confirmWriteSources: confirm,
      },
    });
    await compactor.prepare(writes.extra);
    await expect(compactor.prepare(writes.extra)).rejects.toMatchObject({
      code: "compaction-memory",
    });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(f.call).not.toHaveBeenCalled();
  });
});
