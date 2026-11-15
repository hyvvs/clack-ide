import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wrapLanguageModel } from "ai";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invoke } from "@tauri-apps/api/core";
import { buildLanguageModel } from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { modelBudgetLimits } from "@/modules/ai/lib/requestPreflight";
import {
  createBoundedExtractor,
  type ExtractionSource,
} from "@/modules/ai/lib/compactionExtraction";
import { sessionInference } from "@/modules/ai/lib/inferenceLifecycle";
import { createOllamaModel } from "@/modules/ai/lib/ollamaModel";
import { emitPreparationPhase, installPreparationObserver, type PreparationObservation } from "@/modules/ai/lib/preparationLifecycle";
import { startPreparationPhaseCapture } from "@/test/preparationPhaseCapture";
import { createPreparationPhaseJournal, interpretPreparationPhaseRows } from "../../../../scripts/preparation-phase-journal.mjs";
import { COMPACTION_EXTRACTION_REQUEST_MAX_OUTPUT, COMPACTION_EXTRACTION_SYSTEM } from "@/modules/ai/lib/compactionExtraction";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage = (_event: unknown) => {};
  },
}));
const source: ExtractionSource = {
  role: "assistant",
  passages: ["Deployment remains blocked by a failing migration."],
  evidence: {
    id: "a".repeat(64),
    digest: "b".repeat(64),
    sourceRevision: 1,
    locator: { kind: "message", messageId: "original-assistant" },
    contentIds: [],
    relatedSessions: ["compaction-integration"],
  },
};
const response = () => ({
  id: "fixture",
  object: "chat.completion",
  created: 1,
  model: "private-model",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: JSON.stringify({
          claims: [
            {
              sourceIndex: 0,
              section: "unresolved-issues",
              text: "An assistant reports a failing migration.",
              quote: source.passages[0],
              status: "inference",
              contradicts: [],
            },
          ],
        }),
      },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
});
const sent: Array<Record<string, unknown>> = [];
const admissions: unknown[] = [];
const approvals = new Map<string, (approved: boolean) => void>();
let active = 0;
let maximumActive = 0;
const disposals: Array<() => void> = [];

beforeEach(() => {
  vi.clearAllMocks();
  sent.length = 0;
  admissions.length = 0;
  approvals.clear();
  active = 0;
  maximumActive = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected cloud route");
    }),
  );
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "ai_http_open") return crypto.randomUUID();
    if (command === "ai_http_preflight") {
      const a = args as { requestId: string; approved: boolean };
      approvals.get(a.requestId)?.(a.approved);
      return null;
    }
    if (command !== "ai_http_stream") return null;
    const a = args as {
      body: number[];
      admission: unknown;
      requestId: string;
      onEvent: { onmessage: (event: unknown) => void };
    };
    const approved = await new Promise<boolean>((resolve) => {
      approvals.set(a.requestId, resolve);
      a.onEvent.onmessage({ requestId: a.requestId, kind: "preflight" });
    });
    expect(approved).toBe(true);
    active++;
    maximumActive = Math.max(maximumActive, active);
    admissions.push(a.admission);
    const wire = JSON.parse(new TextDecoder().decode(Uint8Array.from(a.body)));
    sent.push(wire);
    a.onEvent.onmessage({
      requestId: a.requestId,
      kind: "headers",
      status: 200,
      headers: { "content-type": "application/json" },
    });
    a.onEvent.onmessage({
      requestId: a.requestId,
      kind: "chunk",
      bytes: [...new TextEncoder().encode(JSON.stringify(wire.model === "muse-glimmer:30b" ? {
        model: "muse-glimmer:30b", done: true, done_reason: "stop",
        message: { role: "assistant", content: JSON.stringify({ claims: [{
          sourceIndex: 0, section: "unresolved-issues",
          text: "Deployment remains blocked by a failing migration.",
          quote: source.passages[0], status: "inference", contradicts: [],
        }] }) }, prompt_eval_count: 100, eval_count: 70,
      } : response()))],
    });
    active--;
    a.onEvent.onmessage({
      requestId: a.requestId,
      kind: "settled",
      phase: "completed",
    });
    return null;
  });
});
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.unstubAllGlobals();
});

async function setup() {
  const scope = {
    sessionId: "compaction-integration",
    runId: crypto.randomUUID(),
    isCurrent: () => true,
  };
  const model = await buildLanguageModel(
    "openai-compatible",
    { ...EMPTY_PROVIDER_KEYS },
    "private-model",
    {
      inferenceScope: scope,
      openaiCompatibleBaseURL: "http://localhost:1234/v1",
      assertedContext: 32768,
    },
  );
  const run = createBoundedExtractor({
    model,
    scope,
    limits: () => modelBudgetLimits(model),
    remainingCalls: 5,
  });
  disposals.push(run.dispose);
  return run;
}

describe("bounded extraction through the installed provider adapter", () => {
  it("durably captures real production Ollama/native-bridge phases and joins only the matching extraction request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "clack-production-phase-"));
    const filename = join(directory, "native-sdk-phases.jsonl");
    const journal = await createPreparationPhaseJournal(filename);
    const capture = startPreparationPhaseCapture(async row => { await journal.append(row); });
    const scope = { sessionId: "compaction-integration", runId: crypto.randomUUID(), isCurrent: () => true };
    let run: ReturnType<typeof createBoundedExtractor> | undefined;
    let sealed = false;
    try {
      const model = await buildLanguageModel("ollama", { ...EMPTY_PROVIDER_KEYS }, "muse-glimmer:30b", {
        inferenceScope: scope, ollamaBaseURL: "http://127.0.0.1:11435/", assertedContext: 49152,
      });
      run = createBoundedExtractor({ model, scope,
        limits: async () => ({ deployed: 49152, maxOutput: 6144, outputReserve: 6144 }),
        remainingCalls: 4 });
      // An unrelated earlier native request is not evidence that this SDK JSON
      // belongs to it, even if it shares the same logical Agent run.
      emitPreparationPhase(scope, "native-request-linked", "inference-previous");
      emitPreparationPhase(scope, "native-http-settled", "inference-previous");
      expect(await run.extract([source], [])).toHaveLength(1);
      run.dispose();
      const collector = await capture.stop();
      expect(collector).toMatchObject({ deliveryFailed: false, overflow: 0 });
      const receipt = await journal.seal(collector);
      sealed = true;
      const rows = (await readFile(filename, "utf8")).trim().split("\n").map(line => JSON.parse(line));
      const linked = rows.filter(row => row.phase === "native-request-linked");
      expect(linked).toHaveLength(2);
      const observedNativeId = linked.find(row => row.nativeRequestId !== "inference-previous")?.nativeRequestId;
      expect(observedNativeId).toMatch(/^[0-9a-f-]{36}$/);
      expect(rows.filter(row => row.phase === "sdk-json-settled")).toEqual([
        expect.objectContaining({ nativeRequestId: observedNativeId }),
      ]);
      expect(interpretPreparationPhaseRows(rows, receipt, await readFile(filename))).toMatchObject({
        collectorCoverage: "collector-flushed", nativeRequestsLinked: 2,
        nativeSdkOrdering: "unknown",
        requestOrderings: [
          { nativeRequestId: "inference-previous", ordering: "unknown" },
          { nativeRequestId: observedNativeId, ordering: "native-terminal-before-sdk-json" },
        ],
        inferenceProgress: "not-established", forgeBoardAcceptance: "not-evaluated",
      });
      expect(JSON.stringify(rows)).not.toContain(source.passages[0]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      run?.dispose();
      await capture.stop();
      if (!sealed) await journal.abandon();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("joins native settlement and SDK JSON for production nonstreaming Ollama without model/network access", async () => {
    const events: PreparationObservation[] = [];
    const unsubscribe = installPreparationObserver(event => events.push(event));
    const scope = { sessionId: "compaction-integration", runId: crypto.randomUUID(), isCurrent: () => true };
    const model = await buildLanguageModel("ollama", { ...EMPTY_PROVIDER_KEYS }, "muse-glimmer:30b", {
      inferenceScope: scope, ollamaBaseURL: "http://127.0.0.1:11435/", assertedContext: 49152,
    });
    const run = createBoundedExtractor({ model, scope,
      limits: async () => ({ deployed: 49152, maxOutput: 6144, outputReserve: 6144 }),
      remainingCalls: 4 });
    try {
      expect(await run.extract([source], [])).toHaveLength(1);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ model: "muse-glimmer:30b", stream: false });
      const linked = events.find(event => event.phase === "native-request-linked");
      const terminal = events.find(event => event.phase === "native-http-settled");
      const json = events.find(event => event.phase === "sdk-json-settled");
      expect(linked?.nativeRequestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(terminal?.nativeRequestId).toBe(linked?.nativeRequestId);
      expect(json?.nativeRequestId).toBe(linked?.nativeRequestId);
      expect(events.indexOf(terminal!)).toBeLessThan(events.indexOf(json!));
      expect(events.find(event => event.phase === "sdk-generate-settled")?.nativeRequestId).toBe(linked?.nativeRequestId);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { run.dispose(); unsubscribe(); }
  });
  it("correlates native terminal receipt with extraction settlement without treating metadata as progress", async () => {
    const events: PreparationObservation[] = [];
    const unsubscribe = installPreparationObserver(event => events.push(event));
    try {
      const run = await setup();
      expect(await run.extract([source], [])).toHaveLength(1);
      const names = events.map(event => event.phase);
      for (const stage of ["extractor-created", "native-request-linked", "native-response-headers",
        "native-http-settled", "extraction-model-returned", "extraction-validate-completed"])
        expect(names).toContain(stage);
      expect(names.indexOf("native-http-settled")).toBeLessThan(names.indexOf("extraction-model-returned"));
      const id = events.find(event => event.phase === "native-request-linked")?.nativeRequestId;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(events.filter(event => event.nativeRequestId).every(event => event.nativeRequestId === id)).toBe(true);
      expect(events.every(event => !Object.keys(event).some(key => /prompt|body|content|claims|text/i.test(key)))).toBe(true);
    } finally { unsubscribe(); }
  });
  it("uses production generateText/doGenerate with the exact non-streaming extraction contract", async () => {
    let wire: Record<string, unknown> | undefined;
    const completion = JSON.stringify({ claims: [{
      sourceIndex: 0, section: "unresolved-issues",
      text: "The migration remains blocked.", quote: source.passages[0],
      status: "inference", contradicts: [],
    }] });
    const base = createOllamaModel({
      modelId: "muse-glimmer:30b", baseURL: "http://127.0.0.1:9",
      fetch: async (_url, init) => {
        wire = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ model: "muse-glimmer:30b",
          message: { role: "assistant", content: completion }, done: true,
          done_reason: "stop", prompt_eval_count: 120, eval_count: 80 }),
        { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const model = wrapLanguageModel({ model: base, middleware: {
      specificationVersion: "v3",
      async transformParams({ params }) {
        return { ...params, providerOptions: { ...params.providerOptions,
          ollama: { ...(params.providerOptions?.ollama ?? {}), numCtx: 49152 } } };
      },
    } });
    const scope = { sessionId: "compaction-integration", runId: crypto.randomUUID(), isCurrent: () => true };
    const run = createBoundedExtractor({ model, scope,
      limits: async () => ({ deployed: 49152, outputReserve: 6144, maxOutput: 6144 }),
      remainingCalls: 5 });
    try {
      const claims = await run.extract([source], []);
      expect(claims).toHaveLength(1);
      expect(claims[0].sources).toEqual([source.evidence.id]);
      expect(wire).toMatchObject({ model: "muse-glimmer:30b", stream: false,
        options: { num_ctx: 49152, num_predict: COMPACTION_EXTRACTION_REQUEST_MAX_OUTPUT } });
      expect(wire?.messages).toEqual([
        { role: "system", content: COMPACTION_EXTRACTION_SYSTEM },
        { role: "user", content: expect.any(String) },
      ]);
      expect(wire?.tools).toBeUndefined();
      expect(wire?.stream).toBe(false);
      expect(invoke).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { run.dispose(); }
  });

  it("uses real generateText, B1 wire preflight, D1 scope and E1 admission metadata", async () => {
    const run = await setup();
    const claims = await run.extract([source], []);
    expect(claims[0].sources).toEqual([source.evidence.id]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ model: "private-model", max_tokens: 1024 });
    expect(sent[0].tools).toBeUndefined();
    expect(admissions[0]).toMatchObject({
      endpointId: "legacy:openai-compatible",
    });
    expect(invoke).toHaveBeenCalledWith(
      "ai_http_preflight",
      expect.objectContaining({ approved: true }),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(sessionInference("compaction-integration")).toBeNull();
  });
  it("settles each native request before acquiring the next one", async () => {
    const observed: PreparationObservation[] = [];
    const unsubscribe = installPreparationObserver(event => observed.push(event));
    const run = await setup();
    try {
      await run.extract([source], []);
      expect(sessionInference("compaction-integration")).toBeNull();
      await run.extract([source], []);
      expect(sent).toHaveLength(2);
      expect(maximumActive).toBe(1);
      expect(active).toBe(0);
      const ids = observed.filter(event => event.phase === "native-request-linked")
        .map(event => event.nativeRequestId);
      const sdkIds = observed.filter(event => event.phase === "sdk-generate-settled")
        .map(event => event.nativeRequestId);
      expect(ids).toHaveLength(2);
      expect(ids[0]).not.toBe(ids[1]);
      expect(sdkIds).toEqual(ids); // never attach a prior extraction request ID
    } finally { unsubscribe(); }
  });
  it("retains the actual late native terminal observation after cancellation and extractor disposal", async () => {
    const observations: PreparationObservation[] = [];
    const unsubscribe = installPreparationObserver(event => observations.push(event));
    const controller = new AbortController();
    const scope = { sessionId: "compaction-integration", runId: crypto.randomUUID(), isCurrent: () => true };
    let requestId = "";
    let completeNative!: () => void;
    let entered!: () => void;
    const admitted = new Promise<void>(resolve => { entered = resolve; });
    const original = vi.mocked(invoke).getMockImplementation();
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "ai_http_open") { requestId = crypto.randomUUID(); return requestId; }
      if (command === "ai_http_cancel") return null;
      if (command === "ai_http_preflight") { approvals.get(requestId)?.(true); return null; }
      if (command === "ai_http_stream") {
        const a = args as { requestId: string; onEvent: { onmessage: (event: unknown) => void } };
        const approved = new Promise<boolean>(resolve => {
          approvals.set(a.requestId, resolve);
          a.onEvent.onmessage({ requestId: a.requestId, kind: "preflight" });
        });
        expect(await approved).toBe(true);
        entered();
        return new Promise<void>(resolve => {
          completeNative = () => {
            a.onEvent.onmessage({ requestId: a.requestId, kind: "settled", phase: "cancelled" });
            resolve();
          };
        });
      }
      return original?.(command, args);
    });
    const model = await buildLanguageModel("ollama", { ...EMPTY_PROVIDER_KEYS }, "muse-glimmer:30b", {
      inferenceScope: scope, ollamaBaseURL: "http://127.0.0.1:11435/", assertedContext: 49152,
    });
    const run = createBoundedExtractor({ model, scope, signal: controller.signal,
      limits: async () => ({ deployed: 49152, maxOutput: 6144, outputReserve: 6144 }),
      remainingCalls: 4 });
    try {
      const result = run.extract([source], []);
      const rejection = expect(result).rejects.toMatchObject({ name: "AbortError" });
      await admitted;
      controller.abort(new DOMException("Operator cancellation", "AbortError"));
      await rejection;
      run.dispose();
      expect(observations.some(event => event.phase === "native-http-settled")).toBe(false);
      completeNative();
      await vi.waitFor(() => {
        expect(observations.filter(event => event.phase === "native-http-settled"))
          .toEqual([expect.objectContaining({ nativeRequestId: requestId })]);
      });
      expect(observations.map(event => event.phase)).not.toContain("sdk-json-settled");
      expect(observations.map(event => event.phase)).not.toContain("extraction-validate-start");
    } finally { run.dispose(); unsubscribe(); }
  });
  it("blocks oversized original evidence before native inference opens", async () => {
    const run = await setup();
    await expect(
      run.extract([{ ...source, passages: ["x".repeat(239000)] }], []),
    ).rejects.toMatchObject({ code: "compaction-source-budget" });
    expect(sent).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalledWith("ai_http_open", expect.anything());
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
