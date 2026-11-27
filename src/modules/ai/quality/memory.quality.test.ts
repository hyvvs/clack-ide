import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convertToModelMessages, type UIMessage } from "ai";
import {
  compactionFixture,
  disposeCompactionFixtures,
  textMessage,
} from "@/modules/ai/lib/conversationCompaction.fixture";
import { compactModelMessagesDetailed } from "@/modules/ai/lib/compact";
import { groupCompactionUnits } from "@/modules/ai/lib/compactionPlan";
import {
  createConversationRetriever,
  type EvidenceRequest,
  type EvidenceResult,
} from "@/modules/ai/lib/conversationRetrieval";
import {
  corpus,
  digest,
  assertPrivateAbsent,
  sourceOracle,
  contextScore,
  recordMetrics,
} from "@/modules/ai/quality/oracle";

beforeEach(() => vi.useFakeTimers({ now: 1420, toFake: ["Date"] }));
afterEach(() => {
  disposeCompactionFixtures();
  vi.useRealTimers();
});

function originals() {
  return [
    textMessage(
      "requirements",
      "user",
      corpus.critical
        .slice(0, 2)
        .map((c) => c.text)
        .join("\n"),
    ),
    textMessage(
      "architecture",
      "assistant",
      `${corpus.critical[2].text}\n${"safe historical detail ".repeat(180)}`,
    ),
    ...corpus.noncritical.map((fact) =>
      textMessage(
        fact.messageId,
        "assistant",
        `${fact.text}\n${"historical observation ".repeat(180)}`,
      ),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      textMessage(
        `background-${i}`,
        "assistant",
        `Completed background ${i}.\n${"unrelated synthetic detail ".repeat(150)}`,
      ),
    ),
    textMessage("current", "user", corpus.critical[3].text),
  ];
}
function readOriginals(messages: UIMessage[]) {
  return async (request: EvidenceRequest): Promise<EvidenceResult> => ({
    chunks: request.messageIds.map((id) => {
      const index = messages.findIndex((message) => message.id === id);
      if (index < 0) throw new Error("Missing original");
      return {
        messageId: id,
        messageIndex: index,
        contentId: null,
        text: JSON.stringify(messages[index]),
        evidence: {
          id: (index + 1).toString(16).padStart(64, "0"),
          digest: digest(messages[index]),
          locator: { kind: "message", messageId: id },
          sourceRevision: 1,
          contentIds: [],
          relatedSessions: [corpus.conversationId],
        },
      };
    }),
    issues: [],
  });
}
function compactCall(f: ReturnType<typeof compactionFixture>) {
  f.call.mockImplementation(async (options) => {
    const request = JSON.parse(options.messages[1].content as string);
    return {
      text: JSON.stringify({
        claims: request.sources.map(
          (s: { sourceIndex: number; passages: string[] }) => ({
            sourceIndex: s.sourceIndex,
            section: s.passages[0].startsWith("Completed")
              ? "completed-work"
              : "decisions",
            text: s.passages[0].split("\n")[0],
            quote: s.passages[0].split("\n")[0],
            status: "inference",
            contradicts: [],
          }),
        ),
      }),
      usage: { inputTokens: 100, outputTokens: 700, cachedInputTokens: 0 },
    };
  });
}
describe("Q1 original-source corpus", () => {
  it("A: healthy long context retains original critical facts and source-linked decisions with a real B1 fit", async () => {
    const f = compactionFixture(originals());
    compactCall(f);
    const before = digest(f.originals);
    const prepared = await (
      await f.start({ retrieve: readOriginals(f.originals) })
    ).prepare();
    const score = contextScore(prepared);
    expect(score.criticalRetained).toBe(score.criticalTotal);
    expect(score.fitsSmall).toBe(true);
    expect(f.call.mock.calls.length).toBeGreaterThan(0);
    expect(digest(f.originals)).toBe(before);
    const references = sourceOracle(f.view(), f.originals);
    expect(references).toBeGreaterThan(0);
    assertPrivateAbsent(prepared);
    const full = await convertToModelMessages(f.originals);
    const baseline = compactModelMessagesDetailed(full, 6000).messages;
    recordMetrics("A", {
      status: "passed",
      originalHashUnchanged: true,
      authorizedReferences: references,
      sourceCoverage: f.view().revision?.coverage,
      baselines: {
        original: contextScore(full),
        b1Elided: contextScore(baseline),
        prepared: score,
      },
      preparationCalls: f.call.mock.calls.length,
      elapsedFixtureMs: 0,
      model: "deterministic extractor, deployed 32768 / working 6000",
    });
  });
  it("A: recent failed and completed tool pairs and attachment references remain verbatim", async () => {
    const messages = originals();
    const tools: UIMessage = {
      id: "tools",
      role: "assistant",
      parts: [
        {
          type: "tool-read_file",
          toolCallId: "failed",
          state: "output-error",
          input: { path: "src/api.ts" },
          errorText: corpus.adversarial.misleadingTool,
        },
        {
          type: "tool-read_file",
          toolCallId: "complete",
          state: "output-available",
          input: { path: "src/api.ts" },
          output: "export const retries = 2;",
        },
      ],
    };
    messages.splice(messages.length - 1, 0, tools);
    messages[0].parts.push({
      type: "data-artifact",
      data: { contentId: "c".repeat(64), artifactId: "immutable-q1" },
    });
    const f = compactionFixture(messages);
    compactCall(f);
    const before = digest(messages);
    const result = await (
      await f.start({ retrieve: readOriginals(messages) })
    ).prepare();
    const wire = JSON.stringify(result);
    expect(wire).toContain("failed");
    expect(wire).toContain("complete");
    const calls: string[] = [];
    const results: string[] = [];
    for (const message of result) {
      if (message.role !== "assistant" && message.role !== "tool") continue;
      if (typeof message.content === "string") continue;
      for (const part of message.content) {
        if (part.type === "tool-call") calls.push(part.toolCallId);
        if (part.type === "tool-result") results.push(part.toolCallId);
      }
    }
    expect(calls.sort()).toEqual(["complete", "failed"]);
    expect(results.sort()).toEqual(["complete", "failed"]);
    const units = await Promise.all(
      messages.map(async (m) => ({
        messageId: m.id,
        role: m.role,
        hasContentReferences: m.id === "requirements",
        messages: await convertToModelMessages([m]),
      })),
    );
    expect(groupCompactionUnits(units).length).toBeGreaterThan(0);
    expect(digest(messages)).toBe(before);
    const committed = f.view().revision;
    expect(committed?.coverage.end).toBeLessThan(messages.length);
    assertPrivateAbsent(result);
  });
  it("A: missing mandatory originals and oversized protected context block without mutation", async () => {
    const missing = compactionFixture(originals());
    missing.memory.read.mockRejectedValue(new Error("memory_missing_source"));
    await expect((await missing.start()).prepare()).rejects.toThrow();
    expect(missing.memory.commit).not.toHaveBeenCalled();
    const oversized = compactionFixture([
      textMessage("required", "user", "critical ".repeat(30000)),
    ]);
    const before = digest(oversized.originals);
    await expect((await oversized.start()).prepare()).rejects.toThrow();
    expect(oversized.call).not.toHaveBeenCalled();
    expect(digest(oversized.originals)).toBe(before);
  });
  it("B: ten compaction cycles retain original lineage and recover omitted original facts", async () => {
    const f = compactionFixture(originals());
    compactCall(f);
    const cycles = [];
    let working: import("ai").ModelMessage[] = [];
    for (let cycle = 0; cycle < 10; cycle++) {
      const before = digest(f.originals);
      const prepared = await (
        await f.start({
          retrieve: readOriginals(f.originals),
          limits: async () => ({ deployed: 32768, workingTarget: 8192 }),
          extractionRoute: async () => ({
            model: {} as import("ai").LanguageModel,
            limits: async () => ({ deployed: 32768 }),
          }),
        })
      ).prepare();
      working = prepared;
      expect(digest(f.originals)).toBe(before);
      expect(contextScore(prepared).criticalRetained).toBe(4);
      const references = sourceOracle(f.view(), f.originals);
      expect(contextScore(prepared, corpus.critical, 8192).fitsSmall).toBe(
        true,
      );
      if (cycle > 0)
        expect(
          JSON.stringify(
            [...prepared].reverse().find((m) => m.role === "user")?.content,
          ),
        ).toContain(`Timeout must now be ${749 + cycle} ms`);
      assertPrivateAbsent(prepared);
      cycles.push({
        cycle: cycle + 1,
        revision: f.view().revision?.revision,
        references,
        coveredMessages: f.view().revision?.coverage.end,
        ...contextScore(prepared, corpus.critical, 8192),
      });
      if (cycle < 9) {
        for (let i = 0; i < 4; i++)
          f.originals.push(
            textMessage(
              `cycle-${cycle}-${i}`,
              "assistant",
              `Correction ${cycle}: timeout ${750 + cycle} ms, prior assistant value superseded.\n${"bounded synthetic detail ".repeat(150)}`,
            ),
          );
        f.originals.push(
          textMessage(
            `ask-${cycle}`,
            "user",
            `Unresolved requirement ${cycle}: do not remove API v1. Timeout must now be ${750 + cycle} ms; earlier assistant values are superseded. ${corpus.critical[3].text}`,
          ),
        );
        const view = f.view();
        f.change({
          preparation: {
            ...view.preparation,
            source: {
              ...view.preparation.source,
              transcriptRevision: cycle + 2,
            },
          },
          uncoveredMessages:
            f.originals.length - (view.revision?.coverage.end ?? 0),
        });
      }
    }
    expect(f.view().revision?.revision).toBeGreaterThanOrEqual(10);
    const view = f.view();
    const groups = f.originals.map((m, i) => ({
      start: i,
      end: i + 1,
      protected: m.role === "user",
    }));
    const omitted = corpus.noncritical.filter(
      (fact) => !JSON.stringify(working).includes(fact.text),
    );
    expect(omitted.length).toBeGreaterThan(0);
    let recovered = 0;
    for (const fact of omitted) {
      expect(JSON.stringify(working)).not.toContain(fact.text);
      const retriever = createConversationRetriever({
        originals: f.originals,
        scope: {
          sessionId: corpus.conversationId,
          runId: "q1",
          isCurrent: () => true,
        },
        read: readOriginals(f.originals),
        now: () => 1420,
      });
      try {
        expect(
          retriever.request("original observation", fact.messageId).status,
        ).toBe("queued");
        const result = await retriever.prepare(
          view,
          groups,
          working,
          { deployed: 32768, workingTarget: 16384 },
          [],
        );
        expect(JSON.stringify(result)).toContain(fact.text);
        assertPrivateAbsent(result);
        recovered++;
      } finally {
        retriever.dispose();
      }
    }
    recordMetrics("B", {
      status: "passed",
      cycles,
      preparationCalls: f.call.mock.calls.length,
      deployedContext: 32768,
      workingTarget: 8192,
      retrievalWorkingTarget: 16384,
      extractionWorkingContext: 32768,
      latestWorkingRecall: corpus.noncritical.length - omitted.length,
      retrievedRecall: recovered,
      queriedOriginalFacts: omitted.length,
      noncriticalTotal: corpus.noncritical.length,
      sourceAccuracy: { valid: recovered, total: omitted.length },
      elapsedFixtureMs: 0,
    });
  });
  it("B: misleading extraction and fabricated citation fail against original evidence", async () => {
    const f = compactionFixture(originals());
    f.call.mockResolvedValue({
      text: JSON.stringify({
        claims: [
          {
            source: "f".repeat(64),
            section: "decisions",
            status: "inference",
            text: "Deploy freely",
            quote: "fabricated",
            contradicts: [],
          },
        ],
      }),
      usage: { inputTokens: 10, outputTokens: 100, cachedInputTokens: 0 },
    });
    await expect((await f.start()).prepare()).rejects.toThrow();
    expect(f.memory.commit).not.toHaveBeenCalled();
    const retriever = createConversationRetriever({
      originals: f.originals,
      scope: {
        sessionId: corpus.conversationId,
        runId: "q1",
        isCurrent: () => true,
      },
      read: readOriginals(f.originals),
    });
    try {
      retriever.request("original", "nonexistent-message");
      await expect(
        retriever.prepare(
          f.view(),
          [],
          [{ role: "user", content: corpus.adversarial.fabricatedCitation }],
          { deployed: 32768 },
          [],
        ),
      ).rejects.toThrow("not available");
    } finally {
      retriever.dispose();
    }
  });
});
