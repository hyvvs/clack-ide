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
  it("retains an empty discovery across SDK batches without reusing a fact or consuming more time", async () => {
    const f = setup();
    f.read.mockResolvedValue({ ...response([]), taskIds: [] });
    expect(await f.retriever.prepare(messages, limits, [])).toEqual(messages);
    f.retriever.dispose();
    const next = setup({ allowance: f.allowance });
    f.allowance.elapsed = 10000;
    expect(await next.retriever.prepare(messages, limits, [], true)).toEqual(messages);
    await next.retriever.validate();
    expect(next.read).not.toHaveBeenCalled();
    expect(f.allowance.scopedRounds).toBe(1);
    expect(f.allowance.elapsed).toBe(10000);
  });
  it("does not let an empty discovery suppress a later explicit source request or permission check", async () => {
    let allowed = true;
    const f = setup({ allowed: () => allowed });
    f.read.mockResolvedValue({ ...response([]), taskIds: [] });
    await f.retriever.prepare(messages, limits, []);
    f.retriever.request("port", "project:record");
    f.read.mockResolvedValue(response([chunk({ required: true })]));
    expect(JSON.stringify(await f.retriever.prepare(messages, limits, []))).toContain("7351");
    expect(f.read).toHaveBeenCalledTimes(2);
    allowed = false;
    await expect(f.retriever.validate()).rejects.toMatchObject({ code: "retrieval-denied" });
  });
  it.each([
    { ...response([]), issues: [{ source: "file:missing.ts", status: "missing" }], taskIds: [] },
    { ...response([]), omitted: 1, taskIds: [] },
    { ...response([]), taskIds: ["dependency"] },
    { ...response([chunk({ required: true })]), taskIds: [] },
    { ...response([chunk({ freshness: "conflicting" })]), taskIds: [] },
    { ...response([chunk({ freshness: "needs-revalidation" })]), taskIds: [] },
  ])("never exempts selected, missing, conflicting, omitted or task evidence from validation: %j", async result => {
    const f = setup();
    f.read.mockResolvedValue(result);
    await f.retriever.prepare(messages, limits, []);
    f.allowance.elapsed = 10000;
    await expect(f.retriever.validate()).rejects.toMatchObject({ code: "retrieval-timeout" });
    expect(f.allowance.scopedCache).toBeUndefined();
  });
  it("still blocks required anchored evidence on timeout without publishing a partial receipt", async () => {
    vi.useFakeTimers();
    const before = JSON.stringify(originals);
    const onPrepared = vi.fn();
    const f = setup({ onPrepared });
    f.retriever.request("port", "task:dependency");
    let finish: (result: ScopedResult) => void = () => {};
    f.read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const attempt = f.retriever.prepare(messages, limits, []);
    const failed = expect(attempt).rejects.toMatchObject({ code: "retrieval-timeout", message: expect.stringContaining("Project/task evidence lookup timed out.") });
    await vi.advanceTimersByTimeAsync(10000);
    await failed;
    finish(response([chunk({ required: true })]));
    await Promise.resolve();
    expect(onPrepared).not.toHaveBeenCalled();
    expect(f.allowance.scopedCache).toBeUndefined();
    expect(JSON.stringify(originals)).toBe(before);
  });
  it("checks run ownership and cancellation even when the cached discovery supplied nothing", async () => {
    let current = true;
    const controller = new AbortController();
    const f = setup({ signal: controller.signal, scope: { sessionId: "target", runId: "run", isCurrent: () => current } });
    f.read.mockResolvedValue({ ...response([]), taskIds: [] });
    await f.retriever.prepare(messages, limits, []);
    current = false;
    await expect(f.retriever.validate()).rejects.toMatchObject({ code: "retrieval-stale" });
    current = true;
    controller.abort();
    await expect(f.retriever.prepare(messages, limits, [])).rejects.toMatchObject({ name: "AbortError" });
    expect(f.read).toHaveBeenCalledOnce();
  });
  it("final omission-count growth re-sizes only optional sources and publishes the actual selection", async () => {
    const first = chunk();
    const base = setup();
    base.read.mockResolvedValue({ ...response([first]), omitted: 999 });
    const original = await base.retriever.prepare(messages, { deployed: 32768 }, []);
    const tight = { deployed: 32768, workingTarget: measureRequest({ messages: original }).conversation };
    const onPrepared = vi.fn();
    const f = setup({ onPrepared });
    const text = "Optional irrelevant source ".repeat(1000);
    f.read.mockResolvedValue({ ...response([first, chunk({ id: "e".repeat(64), source: { recordId: "other" }, text, end: new TextEncoder().encode(text).byteLength })]), omitted: 999 });
    const output = await f.retriever.prepare(messages, tight, []);
    expect(resolveContextBudget(tight, measureRequest({ messages: output })).fits).toBe(true);
    expect(onPrepared).toHaveBeenLastCalledWith([], 1001, 0);
    expect(JSON.stringify(output)).not.toContain("Optional irrelevant source");
    expect(f.read).toHaveBeenCalledOnce();
  });
  it("advances file observations only after a confirmed write while keeping ownership and task evidence sealed", async () => {
    const f = setup();
    const identityStamp = "e".repeat(64);
    f.read.mockResolvedValue({ ...response(), identityStamp, taskIds: ["captured-task"] });
    await f.retriever.prepare(messages, limits, []);
    f.read.mockResolvedValue({ ...response([chunk({ contentHash: "f".repeat(64) })]), identityStamp, taskIds: ["captured-task"], stamp: "d".repeat(64) });
    await f.retriever.prepare(messages, limits, [], true);
    expect(f.read.mock.calls[1][0]).toMatchObject({ expected: null, expectedIdentity: identityStamp, taskIds: ["captured-task"] });
    await f.retriever.validate();
    expect(f.read.mock.calls[2][0]).toMatchObject({ expected: "d".repeat(64) });
    expect(f.allowance.scopedRounds).toBe(1);
    f.read.mockResolvedValue({ ...response(), identityStamp: "b".repeat(64) });
    await expect(f.retriever.prepare(messages, limits, [], true)).rejects.toMatchObject({ code: "retrieval-stale" });
  });
  it("revalidates the captured native task-source set instead of newly arriving task results", async () => {
    const f = setup();
    f.read.mockResolvedValue({ ...response(), taskIds: ["captured-task"] });
    await f.retriever.prepare(messages, limits, []);
    await f.retriever.prepare(messages, limits, []);
    expect(f.read.mock.calls[1][0]).toMatchObject({ taskIds: ["captured-task"], expected: "c".repeat(64) });
  });
  it("rejects malformed native task-source identities", async () => {
    const f = setup();
    f.read.mockResolvedValue({ ...response(), taskIds: ["duplicate", "duplicate"] });
    await expect(f.retriever.prepare(messages, limits, [])).rejects.toMatchObject({ code: "retrieval-malformed" });
  });
  it("does not block an otherwise valid request because an optional omission preamble is too large", async () => {
    const f = setup();
    f.read.mockResolvedValue(response([chunk({ text: "x".repeat(3000), end: 3000 })]));
    const input: ModelMessage[] = [{ role: "system", content: "Keep authorization." }, { role: "user", content: "read ".repeat(200) }];
    const narrow = { deployed: 1100, outputReserve: 256, maxOutput: 256 };
    expect(resolveContextBudget(narrow, measureRequest({ messages: input })).fits).toBe(true);
    const prepared = await f.retriever.prepare(input, narrow, []);
    expect(resolveContextBudget(narrow, measureRequest({ messages: prepared })).fits).toBe(true);
    expect(prepared).toContainEqual(input[1]);
    expect(JSON.stringify(prepared)).not.toContain("x".repeat(3000));
  });
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
