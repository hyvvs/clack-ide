import { beforeAll, describe, expect, it, vi } from "vitest";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import type { ModelMessage } from "ai";
import capture from "@/test/fixtures/length-continuation-replay-20261021.json";
import audit from "@/test/fixtures/length-continuation-audit-20261021.json";
import { withAnswerContinuation } from "@/modules/ai/lib/answerContinuation";
import {
  measureRequest,
  resolveContextBudget,
} from "@/modules/ai/lib/contextBudget";
import { createOllamaModel, ollamaBody } from "@/modules/ai/lib/ollamaModel";
import { canonicalJson } from "@/modules/ai/lib/canonicalJson";
import {
  groupCompactionUnits,
  planCompaction,
  type CompactionUnit,
} from "@/modules/ai/lib/compactionPlan";

const params = () =>
  structuredClone(capture.params) as unknown as LanguageModelV3CallOptions;
const directive =
  "Continue the SAME assistant answer exactly from its last character. Do not repeat any prior text, restart the task, or add a new introduction. Preserve whitespace, code and Markdown. Existing permissions and approvals remain in force.";
const projected = () => {
  const request = params();
  return {
    ...request,
    prompt: [
      ...request.prompt.filter((m) => m.role === "system"),
      { role: "system" as const, content: directive },
      ...request.prompt.filter((m) => m.role !== "system"),
      {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: capture.response.text }],
      },
    ],
  };
};
const required = (budget: ReturnType<typeof resolveContextBudget>) =>
  budget.cost.system +
  budget.cost.tools +
  budget.cost.conversation +
  budget.reserve +
  budget.margin;
const sha256 = async (value: unknown) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonicalJson(value)),
      ),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

describe("frozen b2cd814 continuation boundary", () => {
  const chunks: LanguageModelV3StreamPart[] = [];
  const fetcher = vi.fn(
    async () =>
      new Response(
        `${JSON.stringify({
          ...capture.response.final,
          message: {
            role: "assistant",
            content: capture.response.text,
            thinking: capture.response.reasoning,
          },
        })}\n`,
        { headers: { "content-type": "application/x-ndjson" } },
      ),
  );
  beforeAll(async () => {
    const base = createOllamaModel({
      modelId: "offline-captured-model",
      baseURL: "http://offline.invalid",
      fetch: fetcher,
    });
    const model = withAnswerContinuation(base, {
      runId: "offline",
      provider: "ollama",
      modelId: "offline-captured-model",
      isCurrent: () => true,
      limits: async () => capture.limits,
    }) as LanguageModelV3;
    const result = await model.doStream(params());
    for await (const chunk of result.stream as unknown as AsyncIterable<LanguageModelV3StreamPart>)
      chunks.push(chunk);
  });
  it("reproduces the last sent 64,805 requirement and 731 headroom", () => {
    const body = ollamaBody(
      "nemotron-3.5-lightning:30b-a3b-q4_K_M",
      params(),
      true,
    );
    const budget = resolveContextBudget(
      capture.limits,
      measureRequest(body),
      2048,
    );
    expect(required(budget)).toBe(64805);
    expect(budget.working - budget.cost.conversation).toBe(731);
    expect(budget.cost).toMatchObject({
      system: 3755,
      tools: 5886,
      conversation: 47410,
    });
  });
  it("preserves the exact serialized last request hash", async () => {
    expect(
      await sha256(
        ollamaBody("nemotron-3.5-lightning:30b-a3b-q4_K_M", params(), true),
      ),
    ).toBe(capture.expected.nativeSha256);
  });
  it("reproduces the third continuation block through the production stream wrapper", () => {
    const error = chunks.find((c) => c.type === "error");
    expect(error).toMatchObject({
      type: "error",
      error: {
        code: "answer-continuation-budget",
        budget: {
          cost: { system: 3888, tools: 5795, conversation: 51081 },
          reserve: 2048,
          margin: 6077,
          ceiling: 65536,
          fits: false,
        },
      },
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("does not execute or repair the truncated textual pseudo-tool", () => {
    expect(
      chunks
        .filter((c) => c.type === "text-delta")
        .map((c) => c.delta)
        .join(""),
    ).toBe(capture.response.text);
    expect(
      chunks.some((c) =>
        ["tool-call", "tool-input-start", "tool-result"].includes(c.type),
      ),
    ).toBe(false);
  });
  it("emits the captured reasoning separately for transcript storage", () => {
    expect(capture.response.reasoning.length).toBe(268);
    expect(
      chunks
        .filter((c) => c.type === "reasoning-delta")
        .map((c) => c.delta)
        .join(""),
    ).toBe(capture.response.reasoning);
    expect(audit.preparation[2].partial.newReasoningCost).toBe(0);
  });
  it("preserves captured controls without a thinking override or external request", () => {
    const request = projected();
    const body = ollamaBody("offline", request, true);
    expect(body.options).toMatchObject({ num_ctx: 65536, num_predict: 2048 });
    expect(body).not.toHaveProperty("think");
    expect(request.tools).toEqual(capture.params.tools);
    expect(body.tools).toHaveLength(13);
    expect(audit).toMatchObject({
      inference: 0,
      network: 0,
      realEffects: 0,
      productionChanges: 0,
    });
  });
  it("has the exact never-dispatched projected body hash and still fails closed", async () => {
    const body = ollamaBody(
      "nemotron-3.5-lightning:30b-a3b-q4_K_M",
      projected(),
      true,
    );
    expect(await sha256(body)).toBe(capture.expected.blockedNativeSha256);
    const budget = resolveContextBudget(
      capture.limits,
      measureRequest(body),
      2048,
    );
    expect(required(budget)).toBe(69294);
    expect(budget.working - budget.cost.conversation).toBe(-3758);
    expect(budget.fits).toBe(false);
  });
  it("attributes the full 4,084 delta without inventing new production categories", () => {
    const d = audit.delta;
    expect(d.stageConversion).toEqual({
      system: 3,
      schemas: -91,
      conversation: -308,
      total: -396,
    });
    expect(d.newText).toBe(3979);
    expect(d.newDirective).toBe(130);
    expect(d.stageConversion.total + d.newText + d.newDirective).toBe(3713);
    expect(d.input + d.margin).toBe(4084);
    expect(d.margin).toBe(371);
    expect(
      d.newReasoning +
        d.newToolInteractions +
        d.newObjectivePlanCorrection +
        d.newMetadata,
    ).toBe(0);
  });
  it("retains all existing history without original/recent duplication", () => {
    expect(
      projected()
        .prompt.filter((m) => m.role !== "system")
        .slice(0, -1),
    ).toEqual(params().prompt.filter((m) => m.role !== "system"));
    expect(audit.unchangedHistory).toEqual([
      "inference-32",
      "inference-36",
      "inference-40",
    ]);
  });
  it("carries each of the three distinct textual intents exactly once", () => {
    const text = JSON.stringify(
      ollamaBody("offline", projected(), true).messages,
    );
    expect(text.match(/<tool_call>/g)).toHaveLength(3);
    expect(
      text.split(JSON.stringify(capture.response.text).slice(1, -1)),
    ).toHaveLength(2);
  });
  it("contains one current directive, not all three historical directives", () => {
    const body = ollamaBody("offline", projected(), true);
    expect(JSON.stringify(body).split(directive)).toHaveLength(2);
    expect(params().prompt.filter((m) => m.role === "system")).toHaveLength(1);
    expect(audit.preparation.map((p) => p.body.directiveCount)).toEqual([
      1, 1, 1,
    ]);
  });
  it("retains provider-bound historical reasoning exactly once in its dedicated field", () => {
    const before = ollamaBody("offline", params(), true),
      after = ollamaBody("offline", projected(), true);
    const thinking = (body: typeof before) =>
      body.messages.filter((m) => m.thinking).map((m) => m.thinking);
    expect(thinking(after)).toEqual(thinking(before));
    expect(audit.preparation[2].body.thinkingCharacters).toBe(6597);
    expect(audit.preparation[2].body.thinkingMessages).toBe(29);
  });
  it("retains the original objective, one accepted correction, plan, and four failed results", () => {
    const request = projected(),
      users = request.prompt.filter((m) => m.role === "user");
    expect(users).toHaveLength(2);
    expect(JSON.stringify(users[0])).toContain("Build ForgeBoard from scratch");
    expect(JSON.stringify(users[1])).toContain(
      "Change the task page size requirement from 50 to 25",
    );
    const text = JSON.stringify(request.prompt);
    expect(text).toContain("todo_write");
    for (const failure of audit.failures) expect(text).toContain(failure.id);
    expect(audit.preparation[2].pendingPlan).toHaveLength(5);
  });
  it("does not duplicate tool pairs or include the original alongside its receipt", () => {
    const body = ollamaBody("offline", projected(), true);
    const calls = body.messages
      .flatMap((m) => (m.tool_calls ?? []) as { id: string }[])
      .map((c) => c.id);
    const results = body.messages
      .filter((m) => m.role === "tool")
      .map((m) => m.tool_call_id);
    expect(new Set(calls).size).toBe(28);
    expect(calls).toEqual(results);
    expect(calls).not.toContain("call_lzgqzap2");
    expect(
      body.messages.filter((m) =>
        String(m.content).includes("Clack historical write receipt"),
      ),
    ).toHaveLength(1);
    expect(audit.receipts).toMatchObject({
      active: 1,
      wireSavings: 1213,
      additionalSafe: 0,
    });
  });
  it("keeps app-owned segment annotations out of both estimation and native serialization", () => {
    const request = projected();
    const stripped = structuredClone(request);
    for (const message of stripped.prompt)
      if (Array.isArray(message.content))
        for (const part of message.content) delete part.providerOptions;
    expect(
      measureRequest({ messages: request.prompt, tools: request.tools }),
    ).toEqual(
      measureRequest({ messages: stripped.prompt, tools: stripped.tools }),
    );
    expect(JSON.stringify(ollamaBody("offline", request, true))).not.toContain(
      "clackAnswer",
    );
    expect(audit.annotations).toEqual({
      excluded: 62,
      budgetChange: 0,
      nativeOccurrences: 0,
    });
  });
  it("distinguishes the actual second continuation from the last request in that segment", () => {
    expect(audit.preparation.map((p) => p.next)).toEqual([
      "inference-33",
      "inference-37",
      null,
    ]);
    expect(audit.preparation.map((p) => p.wire.required)).toEqual([
      55891, 62216, 69294,
    ]);
    expect(audit.preparation[1].wire.headroom).toBe(3320);
    expect(audit.delta.from).toBe("inference-40");
    expect(audit.chain.map((c) => c.id)).toEqual(
      Array.from({ length: 9 }, (_, n) => `inference-${n + 32}`),
    );
    expect(audit.exactNativeReplays).toBe(22);
  });
  it("finds no removable original group even when the existing planner is explicitly invoked", () => {
    const request = projected();
    const history = request.prompt.filter(
      (m) => m.role !== "system",
    ) as ModelMessage[];
    const secondUser = history.findIndex((m, i) => i > 0 && m.role === "user");
    const units: CompactionUnit[] = [
      {
        messageId: "spec",
        role: "user",
        hasContentReferences: false,
        messages: [history[0]],
      },
      {
        messageId: "original-assistant",
        role: "assistant",
        hasContentReferences: false,
        messages: history.slice(1, secondUser),
      },
      {
        messageId: "correction",
        role: "user",
        hasContentReferences: false,
        messages: [history[secondUser]],
      },
    ];
    expect(groupCompactionUnits(units).every((g) => g.protected)).toBe(true);
    expect(() =>
      planCompaction({
        units,
        extra: history.slice(secondUser + 1),
        system: request.prompt.filter((m) => m.role === "system"),
        tools: request.tools,
        limits: capture.limits,
        threshold: 0.55,
      }),
    ).toThrow(expect.objectContaining({ code: "compaction-protected-budget" }));
    expect(audit.compaction).toMatchObject({
      eligibleGroups: 0,
      safeGroupSavings: 0,
      continuationInvokesPlanner: false,
      normalPlannerBeforeLast: true,
    });
  });
  it("keeps repeated-path writes out of the current receipt contract", () => {
    expect(audit.receipts.writes).toHaveLength(5);
    expect(audit.receipts.writes.every((w) => w.verified)).toBe(true);
    expect(
      audit.receipts.writes.filter((w) => w.eligible).map((w) => w.id),
    ).toEqual(["call_lzgqzap2"]);
    expect(audit.receipts.writes.filter((w) => w.repeatedPath)).toHaveLength(4);
  });
});
