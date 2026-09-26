import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelMessage, UIMessage } from "ai";
import {
  createScopedRetriever,
  isScopedAnchor,
  referencedFiles,
  type ScopedChunk,
  type ScopedResult,
  type ScopedRequest,
} from "@/modules/ai/lib/scopedEvidence";
import {
  newRetrievalAllowance,
  runRetrievalAllowance,
  claimRetrievalRound,
} from "@/modules/ai/lib/retrievalAllowance";
import {
  measureRequest,
  resolveContextBudget,
} from "@/modules/ai/lib/contextBudget";

const limits = { deployed: 8192 };
const messages: ModelMessage[] = [
  { role: "system", content: "Do the requested task." },
  { role: "user", content: "Which port is required?" },
];
const originals: UIMessage[] = [
  {
    id: "u",
    role: "user",
    parts: [{ type: "text", text: "Which port is required?" }],
  },
];
function chunk(overrides: Partial<ScopedChunk> = {}): ScopedChunk {
  const text = "Do not use 8080. Port 7351 is required.";
  return {
    id: "a".repeat(64),
    kind: "project",
    workspaceId: "local:/work",
    checkout: "local:/work",
    source: {
      recordId: "record",
      sessionId: "other",
      locator: { kind: "part", messageId: "source", partIndex: 0 },
    },
    revision: 2,
    contentHash: "b".repeat(64),
    start: 0,
    end: new TextEncoder().encode(text).byteLength,
    text,
    required: false,
    freshness: "current",
    qualification: "user-requirement",
    reason: "project-lexical-relevance",
    ...overrides,
  };
}
function response(chunks = [chunk()]): ScopedResult {
  return {
    chunks,
    issues: [],
    omitted: 0,
    stamp: "c".repeat(64),
    reads: 2,
    bytes: chunks.reduce(
      (sum, c) => sum + new TextEncoder().encode(JSON.stringify(c)).byteLength,
      0,
    ),
  };
}
function setup(
  overrides: Partial<Parameters<typeof createScopedRetriever>[0]> = {},
) {
  const read = vi.fn(async (_request: ScopedRequest) => response());
  const allowance = newRetrievalAllowance();
  const scope = {
    sessionId: "target",
    runId: "target:1",
    isCurrent: () => true,
  };
  const retriever = createScopedRetriever({
    scope,
    originals,
    workspaceId: "local:/work",
    allowance,
    allowed: () => true,
    read,
    ...overrides,
  });
  return { read, retriever, allowance, scope };
}
afterEach(() => vi.useRealTimers());

describe("authorized project/task working evidence", () => {
  it("shares two lookup rounds across both evidence lanes", () => {
    const allowance = newRetrievalAllowance();
    claimRetrievalRound(allowance);
    claimRetrievalRound(allowance);
    expect(allowance.rounds).toBe(1);
    allowance.epoch++;
    claimRetrievalRound(allowance);
    allowance.epoch++;
    expect(() => claimRetrievalRound(allowance)).toThrow(/exhausted/);
  });
  it("automatically supplies qualified shared evidence without modifying the original small chat", async () => {
    const before = JSON.stringify(originals);
    const f = setup();
    const output = await f.retriever.prepare(messages, limits, []);
    expect(JSON.stringify(output)).toContain("7351");
    expect(JSON.stringify(output)).toContain("source");
    expect(
      resolveContextBudget(
        limits,
        measureRequest({ messages: output, tools: [] }),
      ).fits,
    ).toBe(true);
    expect(JSON.stringify(originals)).toBe(before);
    expect(f.allowance.scopedRounds).toBe(1);
  });
  it("revalidates receipts at reuse and final transport without charging repeated chunks", async () => {
    const f = setup();
    await f.retriever.prepare(messages, limits, []);
    const bytes = f.allowance.bytes;
    await f.retriever.prepare(messages, limits, []);
    await f.retriever.validate();
    expect(f.read.mock.calls[1][0]).toMatchObject({ expected: "c".repeat(64) });
    expect(f.allowance.bytes).toBe(bytes);
    expect(f.allowance.scopedRounds).toBe(1);
  });
  it("keeps logical-run limits and cached query across internal step batches", async () => {
    const f = setup();
    await f.retriever.prepare(messages, limits, []);
    f.retriever.dispose();
    const next = setup({ allowance: f.allowance });
    await next.retriever.prepare(messages, limits, []);
    expect(next.read.mock.calls[0][0]).toMatchObject({
      expected: "c".repeat(64),
    });
    expect(f.allowance.scopedRounds).toBe(1);
  });
  it("rejects a revoked promotion or changed dependency receipt instead of delivering old claims", async () => {
    const f = setup();
    await f.retriever.prepare(messages, limits, []);
    f.read.mockResolvedValue({ ...response(), stamp: "d".repeat(64) });
    await expect(f.retriever.validate()).rejects.toThrow(/changed/);
    expect(f.allowance.scopedCache).toBeUndefined();
  });
  it("does no shared reads for chat-only recipients and denies revocation after selection", async () => {
    let allowed = false;
    const f = setup({ allowed: () => allowed });
    expect(await f.retriever.prepare(messages, limits, [])).toEqual(messages);
    expect(f.read).not.toHaveBeenCalled();
    allowed = true;
    await f.retriever.prepare(messages, limits, []);
    allowed = false;
    await expect(f.retriever.validate()).rejects.toThrow(/permission/);
  });
  it("rejects late results after run replacement", async () => {
    let current = true;
    const f = setup({
      scope: { sessionId: "target", runId: "run", isCurrent: () => current },
    });
    f.read.mockImplementation(async () => {
      current = false;
      return response();
    });
    await expect(f.retriever.prepare(messages, limits, [])).rejects.toThrow(
      /active run/,
    );
  });
  it("rejects cross-workspace and malformed identities", async () => {
    for (const invalid of [
      chunk({ workspaceId: "local:/other" }),
      chunk({ contentHash: "fake" }),
      chunk({ end: 999 }),
    ]) {
      const f = setup();
      f.read.mockResolvedValue(response([invalid]));
      await expect(f.retriever.prepare(messages, limits, [])).rejects.toThrow(
        /Invalid scoped/,
      );
    }
  });
  it("does not accept a native result lying about its bound", async () => {
    const f = setup();
    f.read.mockResolvedValue({ ...response(), bytes: 1 });
    await expect(f.retriever.prepare(messages, limits, [])).rejects.toThrow(
      /Invalid scoped/,
    );
  });
  it("uses the remaining common G1a/G1b chunk and byte allowance", async () => {
    const f = setup();
    f.allowance.bytes = 5000;
    f.allowance.chunks = 10;
    await f.retriever.prepare(messages, limits, []);
    expect(f.read.mock.calls[0][0]).toMatchObject({
      maxChunks: 2,
      maxBytes: 60536,
    });
    expect(f.allowance.chunks).toBe(11);
  });
  it("blocks required evidence that cannot fit the actual target budget", async () => {
    const f = setup();
    const text = "constraint ".repeat(2500);
    f.read.mockResolvedValue(
      response([chunk({ text, end: text.length, required: true })]),
    );
    await expect(
      f.retriever.prepare(messages, { deployed: 4096 }, []),
    ).rejects.toThrow(/cannot fit/);
  });
  it("labels optional no-fit omissions without claiming full evidence", async () => {
    const f = setup();
    const text = "constraint ".repeat(2500);
    f.read.mockResolvedValue(response([chunk({ text, end: text.length })]));
    const output = await f.retriever.prepare(messages, { deployed: 4096 }, []);
    expect(JSON.stringify(output)).toContain('omitted\\":1');
    expect(JSON.stringify(output)).not.toContain(text);
  });
  it("deduplicates exact source content already in working context", async () => {
    const f = setup();
    const evidence = chunk();
    const existing: ModelMessage[] = [
      ...messages,
      {
        role: "assistant",
        content: `${evidence.contentHash} ${evidence.text}`,
      },
    ];
    expect(await f.retriever.prepare(existing, limits, [])).toEqual(existing);
  });
  it("caps model-requested rounds and never loops automatically", async () => {
    const f = setup();
    await f.retriever.prepare(messages, limits, []);
    expect(isScopedAnchor("workspace")).toBe(true);
    expect(f.retriever.request("port", "workspace").status).toBe("queued");
    await f.retriever.prepare(messages, limits, []);
    expect(f.read.mock.calls[1][0]).toMatchObject({
      query: "port",
      anchor: null,
    });
    expect(f.retriever.request("port", "project:record").status).toBe("limit");
  });
  it("times out and discards native results that finish late", async () => {
    vi.useFakeTimers();
    const f = setup({ read: () => new Promise(() => {}) });
    const promise = f.retriever.prepare(messages, limits, []);
    const assertion = expect(promise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
    expect(f.allowance.scopedCache).toBeUndefined();
  });
  it("cancels pending native work without delivering its eventual result", async () => {
    const controller = new AbortController();
    const f = setup({
      signal: controller.signal,
      read: () => new Promise(() => {}),
    });
    const promise = f.retriever.prepare(messages, limits, []);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
  it("extracts bounded explicit relative file hints, never traversal or secret hints", () => {
    expect(
      referencedFiles(
        "Review src/main.ts and docs/spec.md. Do not read ../other.txt or .env",
        "file:config.json",
      ),
    ).toEqual(["config.json", "src/main.ts", "docs/spec.md"]);
  });
  it("keeps independent logical runs isolated and expires finished owners", () => {
    let current = true;
    const scope = {
      sessionId: crypto.randomUUID(),
      runId: "one",
      isCurrent: () => current,
    };
    const first = runRetrievalAllowance(scope);
    first.bytes = 100;
    expect(runRetrievalAllowance({ ...scope })).toBe(first);
    expect(runRetrievalAllowance({ ...scope, runId: "two" }).bytes).toBe(0);
    current = false;
    expect(
      runRetrievalAllowance({ ...scope, isCurrent: () => true }).bytes,
    ).toBe(0);
  });
});
