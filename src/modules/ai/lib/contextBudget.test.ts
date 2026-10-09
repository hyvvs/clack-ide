import { describe, expect, it } from "vitest";
import {
  assertRequestBudget,
  estimateTextTokens,
  measureRequest,
  resolveContextBudget,
  type BudgetLimits,
  ContextBudgetError,
} from "@/modules/ai/lib/contextBudget";
import { compactModelMessagesDetailed } from "@/modules/ai/lib/compact";
import type { ModelMessage } from "ai";
import { buildStableSystem } from "@/modules/ai/lib/agent";
import {
  normalizeAiError,
  formatAiErrorDetails,
} from "@/modules/ai/lib/errors";
import { CompactionError } from "@/modules/ai/lib/compactionExtraction";

describe("shared budget arithmetic", () => {
  it("a zero extra reserve pin still leaves meaningful response capacity", () => {
    expect(resolveContextBudget({ outputReserve: 0 }).output).toBeGreaterThan(
      0,
    );
  });
  it("subtracts output, system, tools and margin from deployed context", () => {
    const b = resolveContextBudget(
      { deployed: 32768, theoretical: 262144, outputReserve: 6144 },
      { system: 1024, tools: 1024, conversation: 23000, uncertainMedia: false },
      undefined,
      1024,
    );
    expect(b).toMatchObject({
      ceiling: 32768,
      reserve: 6144,
      working: 23552,
      fits: true,
      source: "deployed",
    });
  });
  it.each([
    [{}, 4096, "unknown-policy"],
    [{ theoretical: 262144 }, 4096, "unknown-policy"],
    [{ advertised: 2048 }, 2048, "unknown-policy"],
    [{ asserted: 16000 }, 16000, "manual"],
    [{ reported: 200000 }, 200000, "reported"],
    [{ deployed: 32768, advertised: 262144 }, 32768, "deployed"],
    [{ deployed: 32768, reported: 16000 }, 16000, "deployed"],
  ] as const)("resolves %j", (limits, ceiling, source) => {
    expect(resolveContextBudget(limits)).toMatchObject({ ceiling, source });
  });
  it.each([
    { deployed: 32768, asserted: 65536 },
    { deployed: 32768, workingTarget: 65536, manualWorking: true },
    { asserted: 65536, theoretical: 32768 },
    { maxOutput: 4096 },
    { outputReserve: 8192 },
    { reported: 32000, outputCap: 1024, maxOutput: 2048 },
    { deployed: -1 },
    { deployed: 0 },
    { workingTarget: Infinity },
    { outputReserve: NaN },
    { maxOutput: 1.2 },
  ] satisfies BudgetLimits[])("rejects impossible settings %j", (limits) =>
    expect(() => resolveContextBudget(limits)).toThrow());
  it("keeps a lower working target distinct from the hard ceiling", () => {
    expect(
      resolveContextBudget({ deployed: 32768, workingTarget: 12000 }).working,
    ).toBe(12000);
  });
  it("respects input-only and API output caps separately", () => {
    expect(
      resolveContextBudget(
        { reported: 10000, inputCap: 2000, outputCap: 1000 },
        undefined,
        2000,
        128,
      ),
    ).toMatchObject({
      ceiling: 10000,
      output: 1000,
      reserve: 1000,
      working: 1872,
    });
  });
  it("protects configured reserve even for short caller output caps", () => {
    expect(
      resolveContextBudget(
        { reported: 32000, outputReserve: 6000 },
        undefined,
        128,
      ).reserve,
    ).toBe(6000);
  });
  it("rejects negative costs and invalid caller output", () => {
    expect(() =>
      resolveContextBudget(
        {},
        { system: -1, tools: 0, conversation: 0, uncertainMedia: false },
      ),
    ).toThrow();
    expect(() => resolveContextBudget({}, undefined, 0)).toThrow();
  });
});

describe("actual request material", () => {
  it("early protected-context refusal retains the same B1 accounting and primary guidance", () => {
    const budget = resolveContextBudget(
      { reported: 4096 },
      { system: 5000, tools: 0, conversation: 2, uncertainMedia: false },
    );
    const error = normalizeAiError(
      new CompactionError(
        "protected-budget",
        "Protected context cannot fit",
        budget,
      ),
    );
    expect(error.title).toBe("This model can't fit the required context.");
    expect(error.details).toContain("Input estimate: 5002");
    expect(error.message).not.toContain("reduce the new request");
    expect(error.errorCode).toBe("compaction-protected-budget");
  });
  it("attributes actual serialized ingredients without changing B1 arithmetic or leaking content", () => {
    const schema = (name: string) => ({
      type: "function",
      function: {
        name,
        description: "Required schema",
        parameters: { type: "object", properties: {} },
      },
    });
    const body = {
      max_tokens: 100,
      messages: [
        {
          role: "system",
          content: buildStableSystem(
            "gpt-5.5",
            { name: "Coder", instructions: "private agent text" },
            "private user instruction",
            "private workspace text",
          ),
        },
        {
          role: "user",
          content:
            "<env>\nworkspace_root: /secret-name\n</env>\n\n----- CLACK ATTACHMENT -----\nprivate attachment",
        },
        {
          role: "assistant",
          content: "Derived conversation evidence, private memory",
        },
        {
          role: "assistant",
          content: "Retrieved original conversation evidence. private evidence",
        },
      ],
      tools: [
        schema("read_file"),
        schema("custom_wasi"),
        schema("custom_weather"),
      ],
    };
    const cost = measureRequest(body, { custom_weather: "mcp" }, 26);
    expect(
      Object.values(cost.breakdown ?? {}).reduce((sum, n) => sum + (n ?? 0), 0),
    ).toBe(cost.system + cost.tools + cost.conversation);
    for (const key of [
      "core",
      "agent",
      "project",
      "customInstructions",
      "environment",
      "attachments",
      "memory",
      "retrieval",
      "builtin",
      "custom",
      "mcp",
    ] as const)
      expect(cost.breakdown?.[key]).toBeGreaterThan(0);
    expect(cost.schemas).toEqual({
      available: 26,
      exposed: 3,
      bytes: new TextEncoder().encode(JSON.stringify(body.tools)).length,
    });
    const plain = measureRequest(body);
    expect(cost.system).toBe(plain.system);
    expect(cost.tools).toBe(plain.tools);
    expect(cost.conversation).toBe(plain.conversation);
    const budget = resolveContextBudget({ reported: 1024 }, cost, 100);
    const details = formatAiErrorDetails(
      normalizeAiError(
        new ContextBudgetError("context-overflow", "Overflow", budget),
      ),
    );
    expect(details).toContain("MCP tool schemas:");
    expect(details).toContain("Schemas available: 26");
    expect(details).not.toMatch(/private|secret-name/);
  });
  it.each([
    [
      {},
      { system: 5000, tools: 0, conversation: 2, uncertainMedia: false },
      "Clack couldn't verify",
      "Verify or configure",
    ],
    [
      { reported: 4096 },
      { system: 5000, tools: 0, conversation: 2, uncertainMedia: false },
      "This model can't fit",
      "larger context window",
    ],
    [
      { reported: 4096 },
      { system: 10, tools: 5000, conversation: 2, uncertainMedia: false },
      "This model can't fit",
      "Disable unnecessary tools",
    ],
    [
      { reported: 4096 },
      { system: 10, tools: 0, conversation: 5000, uncertainMedia: false },
      "This model can't fit",
      "Optimize the conversation",
    ],
  ] as const)("presents the dominant cause with accounting in technical details", (limits, cost, title, advice) => {
    const budget = resolveContextBudget(limits, cost, 100);
    const error = normalizeAiError(
      new ContextBudgetError(
        "context-overflow",
        budget.reason ?? "Overflow",
        budget,
      ),
    );
    expect(error.title).toContain(title);
    expect(error.message).toContain(advice);
    expect(error.message).not.toMatch(
      /estimated input|margin|reduce the new request/,
    );
    expect(error.details).toContain("Effective ceiling: 4096");
    expect(error.details).toContain("Input estimate:");
    expect(error.details).toContain("Ceiling provenance:");
    expect(error.retryable).toBe(false);
  });
  it("does not mistake a tool's file metadata for a binary attachment", () => {
    expect(
      measureRequest({
        messages: [
          {
            role: "tool",
            content: { type: "file", name: "hello.ts", size: 123456789 },
          },
        ],
      }).uncertainMedia,
    ).toBe(false);
  });
  it.each([
    "normal text",
    "const f = (x) => JSON.stringify({ x });".repeat(100),
    "\u4e2d\u6587\u6d4b\u8bd5".repeat(100),
    "[attachment: source.ts]\nexport const x = 42;",
    "[Extracted PDF text]\nA report with tables.",
    "[ZIP manifest]\nindex.ts\nREADME.md",
    "[Selected archive entry: main.rs]\nfn main() {}",
    "<svg><text>source</text></svg>",
  ])("counts delivered text: %.30s", (text) => {
    expect(
      measureRequest({ messages: [{ role: "user", content: text }] })
        .conversation,
    ).toBeGreaterThanOrEqual(estimateTextTokens(text));
  });
  it("includes all system blocks, JSON tool schemas, calls/results and task context", () => {
    const body = {
      max_tokens: 128,
      messages: [
        {
          role: "system",
          content: "agent project custom permissions environment mode",
        },
        {
          role: "user",
          content: "current task\nprerequisite aggregate\nselected artifact",
        },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "a",
              function: { name: "read", arguments: '{"path":"file"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "a", content: "result" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "read",
            description: "allowed tool",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
            },
          },
        },
      ],
    };
    const cost = measureRequest(body);
    expect(cost.system).toBeGreaterThan(10);
    expect(cost.tools).toBeGreaterThan(40);
    expect(cost.conversation).toBeGreaterThan(60);
    expect(assertRequestBudget({}, body).fits).toBe(true);
  });
  it.each([
    "image_url",
    "input_image",
    "image",
    "document",
    "input_audio",
  ])("does not tokenize %s base64", (type) => {
    const body = (data: string) => ({
      messages: [{ role: "user", content: [{ type, source: { data } }] }],
    });
    expect(measureRequest(body("x"))).toEqual(
      measureRequest(body("x".repeat(100000))),
    );
    expect(() =>
      assertRequestBudget(
        { reported: 200000 },
        { ...body("x"), max_tokens: 128 },
      ),
    ).toThrow("unknown token cost");
  });
  it("never counts unsent archive/PDF bytes", () => {
    const delivered = {
      max_tokens: 128,
      messages: [{ role: "user", content: "manifest only" }],
    };
    expect(assertRequestBudget({}, delivered).cost.conversation).toBeLessThan(
      50,
    );
  });
  it("rejects oversized text and schemas without deleting anything", () => {
    const body = {
      max_tokens: 128,
      messages: [{ role: "user", content: "x".repeat(20000) }],
    };
    const original = structuredClone(body);
    expect(() => assertRequestBudget({}, body)).toThrow("exceeds");
    expect(body).toEqual(original);
    expect(() =>
      assertRequestBudget(
        {},
        { max_tokens: 128, tools: [{ description: "x".repeat(20000) }] },
      ),
    ).toThrow("tool schemas");
  });
  it("rejects contradictory or absent output fields", () => {
    expect(() =>
      assertRequestBudget({}, { max_tokens: 128, max_output_tokens: 256 }),
    ).toThrow("exactly one");
    expect(() => assertRequestBudget({}, {})).toThrow("exactly one");
  });
  it("counts final adapter reasoning allowance instead of clamping only on paper", () => {
    expect(() =>
      assertRequestBudget({ maxOutput: 128 }, { max_tokens: 1024 }),
    ).toThrow("Serialized output");
  });
});

describe("bounded existing elision", () => {
  it("elides superseded reads once but preserves the latest read after an earlier mutation and an unresolved call", () => {
    const call = (id: string, toolName: string): ModelMessage => ({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: id,
          toolName,
          input: { path: "file" },
        },
      ],
    });
    const result = (id: string): ModelMessage => ({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: id,
          toolName: "read_file",
          output: { type: "text", value: "x".repeat(20000) },
        },
      ],
    });
    const messages = [
      call("old", "read_file"),
      result("old"),
      call("edit", "edit"),
      call("new", "read_file"),
      result("new"),
      call("pending", "read_file"),
    ];
    const compact = compactModelMessagesDetailed(messages, 20000);
    expect(JSON.stringify(compact.messages[1])).toContain("elided");
    expect(compact.messages[4]).toEqual(messages[4]);
    expect(compact.messages[5]).toEqual(messages[5]);
    expect(() =>
      assertRequestBudget({}, { max_tokens: 128, messages: compact.messages }),
    ).toThrow("exceeds");
  });
  it("remeasures old tool results, preserves pairs/recent tail/current attachments and raw transcript", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "a",
            toolName: "read_file",
            input: { path: "file" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "a",
            toolName: "read_file",
            output: { type: "text", value: "x".repeat(30000) },
          },
        ],
      },
      ...Array.from(
        { length: 25 },
        (_, i): ModelMessage => ({ role: "user", content: `recent ${i}` }),
      ),
    ];
    const original = structuredClone(messages);
    const compact = compactModelMessagesDetailed(messages, 4096);
    expect(compact.compacted).toBe(true);
    expect(compact.messages.slice(-24)).toEqual(messages.slice(-24));
    expect(JSON.stringify(compact.messages)).toContain('"toolCallId":"a"');
    expect(
      assertRequestBudget({}, { max_tokens: 128, messages: compact.messages })
        .fits,
    ).toBe(true);
    expect(messages).toEqual(original);
    expect(compactModelMessagesDetailed(compact.messages, 4096).compacted).toBe(
      false,
    );
  });
  it("a still-oversized current user attachment blocks after one bounded pass", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: `mandatory attachment ${"x".repeat(20000)}` },
    ];
    const compact = compactModelMessagesDetailed(messages, 4096);
    expect(compact.messages).toEqual(messages);
    expect(() =>
      assertRequestBudget({}, { max_tokens: 128, messages: compact.messages }),
    ).toThrow("exceeds");
  });
});
