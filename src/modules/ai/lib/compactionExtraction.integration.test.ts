import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { buildLanguageModel } from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { modelBudgetLimits } from "@/modules/ai/lib/requestPreflight";
import {
  createBoundedExtractor,
  type ExtractionSource,
} from "@/modules/ai/lib/compactionExtraction";
import { sessionInference } from "@/modules/ai/lib/inferenceLifecycle";

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
              source: source.evidence.id,
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
    sent.push(JSON.parse(new TextDecoder().decode(Uint8Array.from(a.body))));
    a.onEvent.onmessage({
      requestId: a.requestId,
      kind: "headers",
      status: 200,
      headers: { "content-type": "application/json" },
    });
    a.onEvent.onmessage({
      requestId: a.requestId,
      kind: "chunk",
      bytes: [...new TextEncoder().encode(JSON.stringify(response()))],
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
    const run = await setup();
    await run.extract([source], []);
    expect(sessionInference("compaction-integration")).toBeNull();
    await run.extract([source], []);
    expect(sent).toHaveLength(2);
    expect(maximumActive).toBe(1);
    expect(active).toBe(0);
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
