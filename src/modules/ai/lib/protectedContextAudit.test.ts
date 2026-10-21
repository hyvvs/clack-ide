import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import capture from "@/test/fixtures/protected-context-replay-20261021.json";
import {
  measureRequest,
  resolveContextBudget,
} from "@/modules/ai/lib/contextBudget";
import {
  groupCompactionUnits,
  planCompaction,
  type CompactionUnit,
} from "@/modules/ai/lib/compactionPlan";
import {
  compactVerifiedWriteBlocks,
  verifiedWriteCandidates,
  type VerifiedWriteSource,
} from "@/modules/ai/lib/verifiedWriteHistory";
import { ollamaBody } from "@/modules/ai/lib/ollamaModel";
import audit from "@/test/fixtures/protected-context-audit-20261021.json";

const options = () =>
  structuredClone({
    units: capture.units as CompactionUnit[],
    extra: capture.extra as ModelMessage[],
    verifiedWriteSources: capture.sources as VerifiedWriteSource[],
    system: capture.system as ModelMessage[],
    tools: capture.tools,
    limits: capture.limits,
  });
const required = (b: Pick<ReturnType<typeof resolveContextBudget>, "cost" | "reserve" | "margin">) =>
  b.cost.system + b.cost.tools + b.cost.conversation + b.reserve + b.margin;

describe("captured protected-context accounting", () => {
  it("retains the exact original 271-token failure rather than rewriting acceptance evidence", () => {
    expect(capture.previous.requestId).toBe("inference-47");
    expect(capture.blocked.budget).toMatchObject({
      fits: false,
      reserve: 2048,
      margin: 5797,
      ceiling: 65536,
      cost: { system: 3755, tools: 6244, conversation: 47963 },
    });
    expect(required(capture.blocked.budget)).toBe(65807);
    expect(capture.blocked.state).toBe("not-dispatched");
  });
  it("admits the exact frozen state after excluding only non-provider segment annotations", () => {
    const input = options(),
      original = structuredClone(input);
    const plan = planCompaction(input);
    expect(plan.budget).toMatchObject({
      fits: true,
      reserve: 2048,
      ceiling: 65536,
      margin: 5492,
      cost: { system: 3755, tools: 6244, conversation: 44921 },
    });
    expect(required(plan.budget)).toBe(62460);
    expect(plan.budget.working - plan.budget.cost.conversation).toBe(3076);
    expect(input).toEqual(original);
    expect(plan.toolReceipts).toHaveLength(3);
    expect(plan.needed).toBe(false);
  });
  it("also fits when the original absolute safety margin is held fixed", () => {
    const plan = planCompaction(options());
    const b = resolveContextBudget(
      capture.limits,
      plan.budget.cost,
      2048,
      capture.blocked.budget.margin,
    );
    expect(b).toMatchObject({
      fits: true,
      reserve: 2048,
      margin: 5797,
      ceiling: 65536,
    });
    expect(required(b)).toBe(62765);
  });
  it("retains objective, correction, native shell identity, plan and unresolved compiler failure", () => {
    const plan = planCompaction(options());
    const text = JSON.stringify(plan.messages);
    for (const phrase of [
      "Build ForgeBoard from scratch",
      "Change the task page size requirement from 50 to 25",
      "PowerShell",
      "todo_write",
      "TS2339",
      "noUncheckedAccess",
    ])
      expect(text).toContain(phrase);
    expect(plan.budget.cost.schemas).toMatchObject({
      exposed: 14,
      bytes: 12764,
    });
    expect(text).toContain("clackAnswer");
  });
  it("does not admit the captured request without authenticated receipt sources", () => {
    expect(() =>
      planCompaction({ ...options(), verifiedWriteSources: [] }),
    ).toThrow(expect.objectContaining({ code: "compaction-protected-budget" }));
    const invalid = options();
    invalid.verifiedWriteSources.forEach((s) => {
      s.digest = "invalid";
    });
    expect(() => planCompaction(invalid)).toThrow(
      expect.objectContaining({ code: "compaction-protected-budget" }),
    );
  });
  it("does not broaden receipt eligibility for edits, repeated writes or current latest write", () => {
    const input = options();
    const candidates = verifiedWriteCandidates([
      ...input.units.flatMap((u) => u.messages),
      ...input.extra,
    ]);
    expect(candidates.map((c) => c.toolCallId)).toEqual(
      capture.sources.map((s) => s.toolCallId),
    );
    expect(candidates.map((c) => c.input.path.split("/").pop())).toEqual([
      "storage.ts",
      "schemas.ts",
      "publisher.ts",
    ]);
    expect(groupCompactionUnits(input.units).every((g) => g.protected)).toBe(
      true,
    );
  });
  it("keeps pinned originals verbatim and still fails closed if their cost cannot fit", () => {
    expect(() =>
      planCompaction({
        ...options(),
        verbatimToolCallIds: capture.sources.map((s) => s.toolCallId),
      }),
    ).toThrow(expect.objectContaining({ code: "compaction-protected-budget" }));
  });
  it("preserves exact native history pairs in the original replay state", () => {
    const input = options();
    const reduced = compactVerifiedWriteBlocks(
      [...input.units.map((u) => u.messages), input.extra],
      input.verifiedWriteSources,
    );
    expect(reduced.receipts).toHaveLength(3);
    const ids = new Set(reduced.receipts.map((r) => r.toolCallId));
    const calls = reduced.blocks
      .flat()
      .flatMap((m) =>
        Array.isArray(m.content)
          ? m.content.filter((p) => p.type === "tool-call")
          : [],
      );
    expect(
      calls.some((p) => p.type === "tool-call" && ids.has(p.toolCallId)),
    ).toBe(false);
    expect(input.extra).toEqual(capture.extra);
  });
  it("reconciles both exact request representations without comparing different stages", () => {
    expect(audit.previous.body).toMatchObject({
      messages: 76,
      tools: 14,
      characters: 107285,
      bytes: 107309,
      annotationOccurrences: 0,
    });
    expect(audit.blocked.body).toMatchObject({
      messages: 78,
      tools: 14,
      characters: 108072,
      bytes: 108096,
      annotationOccurrences: 0,
    });
    expect(audit.previous.provider).toMatchObject({
      inputTokens: 27025,
      outputTokens: 134,
      finish: "stop",
    });
    expect(audit.annotations).toMatchObject({
      tokensRemoved: 3042,
      parts: 78,
      previousTokensRemoved: 2964,
      providerPayloadChanged: false,
    });
    expect(audit.effects.filter((e) => e.success)).toHaveLength(30);
    expect(audit.effects.filter((e) => e.receiptEligible)).toHaveLength(3);
    expect(audit.blocked.minimumInputReduction).toBe(246);
    expect(audit.inference).toBe(0);
  });
});

describe("local answer annotations versus provider data", () => {
  const frame = (type: string, providerOptions?: unknown) => ({
    messages: [
      {
        role: "assistant",
        content: [
          {
            type,
            text: "Keep actual answer and reasoning.",
            ...(providerOptions ? { providerOptions } : {}),
          },
        ],
      },
    ],
  });
  it.each([
    "text",
    "reasoning",
  ])("excludes only the app-owned namespace on %s message parts", (type) => {
    expect(
      measureRequest(frame(type, { clackAnswer: { segmentId: "local-only" } })),
    ).toEqual(measureRequest(frame(type)));
    expect(
      measureRequest(
        frame(type, {
          clackAnswer: { segmentId: "local-only" },
          openai: { encryptedContent: "provider-owned" },
        }),
      ),
    ).toEqual(
      measureRequest(
        frame(type, { openai: { encryptedContent: "provider-owned" } }),
      ),
    );
  });
  it.each([
    "input",
    "output",
  ])("does not ignore tool %s that resembles internal metadata", (field) => {
    const part = {
      type: field === "input" ? "tool-call" : "tool-result",
      [field]: {
        content: [
          {
            type: "text",
            providerOptions: {
              clackAnswer: { segmentId: "evidence ".repeat(500) },
            },
          },
        ],
      },
    };
    const body = { messages: [{ role: "tool", content: [part] }] };
    expect(measureRequest(body).conversation).toBeGreaterThan(500);
  });
  it("does not ignore schemas or literal text containing the namespace", () => {
    expect(
      measureRequest({
        tools: [
          {
            type: "text",
            providerOptions: { clackAnswer: "schema ".repeat(500) },
          },
        ],
      }).tools,
    ).toBeGreaterThan(500);
    expect(
      measureRequest(
        frame("text", { other: { clackAnswer: "provider ".repeat(500) } }),
      ).conversation,
    ).toBeGreaterThan(500);
    expect(
      measureRequest({
        messages: [{ role: "user", content: "clackAnswer ".repeat(500) }],
      }).conversation,
    ).toBeGreaterThan(500);
  });
  it.each([
    "fixture-a",
    "fixture-b",
  ])("does not change native text/reasoning payload for %s", (model) => {
    const parts = [
      { type: "text" as const, text: "Actual answer" },
      { type: "reasoning" as const, text: "Actual reasoning" },
    ];
    const original = {
      prompt: [{ role: "assistant" as const, content: parts }],
      maxOutputTokens: 2048,
    };
    const annotated = {
      ...original,
      prompt: [
        {
          role: "assistant" as const,
          content: parts.map((p) => ({
            ...p,
            providerOptions: { clackAnswer: { segmentId: "local" } },
          })),
        },
      ],
    };
    const before = structuredClone(annotated);
    expect(ollamaBody(model, annotated, true)).toEqual(
      ollamaBody(model, original, true),
    );
    measureRequest({ messages: annotated.prompt });
    expect(annotated).toEqual(before);
  });
});
