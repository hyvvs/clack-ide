/**
 * Offline end-to-end SDK -> real native Ollama adapter -> bounded extraction.
 * The only HTTP boundary is a deterministic injected fetch; no endpoint,
 * Ollama process, ForgeBoard mission, native effect, or file is contacted.
 */
import { afterEach, describe, expect, it } from "vitest";
import { wrapLanguageModel, type LanguageModel } from "ai";
import {
  COMPACTION_EXTRACTION_JSON_SCHEMA,
  COMPACTION_EXTRACTION_REQUEST_MAX_OUTPUT,
  createBoundedExtractor,
  extractionMessages,
  extractionRequestCost,
  type ExtractionSource,
} from "@/modules/ai/lib/compactionExtraction";
import { assertRequestBudget, measureRequest, resolveContextBudget } from "@/modules/ai/lib/contextBudget";
import { createOllamaModel } from "@/modules/ai/lib/ollamaModel";
import { installPreparationObserver, type PreparationObservation } from "@/modules/ai/lib/preparationLifecycle";

const MODEL = "muse-glimmer:30b";
const DEPLOYED = 32_768;
const passage = "Build failed: npm install reports a missing dependency; correction is still needed.";
const evidence: ExtractionSource = {
  role: "assistant",
  passages: [passage],
  evidence: {
    id: "a".repeat(64),
    digest: "b".repeat(64),
    sourceRevision: 1,
    locator: { kind: "message", messageId: "offline-step-1" },
    contentIds: [],
    relatedSessions: ["offline-test-session"],
  },
};

const valid = () => ({ claims: [{
  sourceIndex: 0,
  section: "errors",
  text: "The assistant observed a failed installation and unresolved dependency.",
  quote: passage,
  status: "unresolved",
  contradicts: [],
}] });

type NativeBody = {
  model: string;
  stream: boolean;
  format?: unknown;
  think?: unknown;
  tools?: unknown[];
  options: { num_ctx?: number; num_predict?: number };
  messages: { role: string; content: string }[];
};

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function offlineHarness(replies: unknown[]) {
  const bodies: NativeBody[] = [];
  const observed: Array<Pick<PreparationObservation, "phase" | "attempt">> = [];
  const unobserve = installPreparationObserver(entry => {
    // The telemetry under test is content-free: phase and bounded category only.
    if (entry.sessionId === "offline-test-session")
      observed.push({ phase: entry.phase, ...(entry.attempt ? { attempt: entry.attempt } : {}) });
  });
  cleanups.push(unobserve);

  const fakeFetch: typeof fetch = async (_url, init) => {
    expect(_url.toString()).toBe("http://localhost:11434/api/chat");
    const body = JSON.parse(String(init?.body)) as NativeBody;
    bodies.push(body);
    const answer = replies.shift();
    if (answer === undefined) throw new Error("Unexpected offline provider request");
    return new Response(JSON.stringify({
      model: MODEL,
      message: { role: "assistant", content: JSON.stringify(answer) },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 180,
      eval_count: 90,
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const baseModel = createOllamaModel({ modelId: MODEL,
    baseURL: "http://localhost:11434", fetch: fakeFetch });
  // Mirrors the production preflight's providerOptions transformParams. It
  // adds context only; the real SDK and native adapter own JSON format.
  const model: LanguageModel = wrapLanguageModel({ model: baseModel, middleware: {
    specificationVersion: "v3",
    transformParams: async ({ params }) => ({
      ...params,
      providerOptions: {
        ...params.providerOptions,
        ollama: { ...params.providerOptions?.ollama, numCtx: DEPLOYED },
      },
    }),
  } });
  const sources = [evidence];
  const before = JSON.stringify(sources);
  const run = createBoundedExtractor({
    model,
    scope: { sessionId: "offline-test-session", runId: "offline-run", isCurrent: () => true },
    limits: async () => ({ deployed: DEPLOYED, outputReserve: 1024 }),
    remainingCalls: 2,
    protectedCount: () => 1,
  });
  cleanups.push(run.dispose);
  return { run, sources, before, bodies, observed };
}

function assertNativeWire(body: NativeBody) {
  expect(body).toMatchObject({ model: MODEL, stream: false,
    options: { num_ctx: DEPLOYED, num_predict: COMPACTION_EXTRACTION_REQUEST_MAX_OUTPUT } });
  expect(body).not.toHaveProperty("tools");
  expect(body).not.toHaveProperty("think"); // Automatic uses Ollama default
  // AI SDK converts Zod to JSON Schema Draft-07 on the provider request;
  // production z.toJSONSchema exports the same constrained contract with a
  // Draft-2020-12 URI. The draft URI itself must not be mistaken for a lost
  // sourceIndex field or disabled native response format.
  const asObject = body.format as Record<string, unknown>;
  expect(asObject.$schema).toBe("http://json-schema.org/draft-07/schema#");
  expect({ ...asObject, $schema: undefined }).toEqual({
    ...COMPACTION_EXTRACTION_JSON_SCHEMA, $schema: undefined,
  });
  const schema = body.format as { properties: { claims: { items: { properties: Record<string, unknown>; required: string[] } } } };
  expect(schema.properties.claims.items.properties.sourceIndex).toMatchObject({ type: "integer", minimum: 0 });
  expect(schema.properties.claims.items.required).toEqual(expect.arrayContaining([
    "sourceIndex", "section", "text", "quote", "status", "contradicts",
  ]));
  expect(body.messages.map(message => message.role)).toEqual(["system", "user"]);
  const userEnvelope = JSON.parse(body.messages[1].content) as { sources: unknown[] };
  expect(userEnvelope.sources).toEqual([{ sourceIndex: 0, role: "assistant", passages: [passage] }]);
  expect(body.messages[0].content).not.toContain(passage);
  expect(JSON.stringify(body)).not.toContain(evidence.evidence.id);
  const measured = measureRequest(body);
  const withoutFormat = measureRequest({ ...body, format: undefined });
  expect(measured.tools).toBeGreaterThan(withoutFormat.tools);
  expect(assertRequestBudget({ deployed: DEPLOYED, outputReserve: 1024 }, body)).toMatchObject({
    ceiling: DEPLOYED, reserve: 1024, output: 1024, fits: true,
  });
}

describe("real SDK native Ollama structured extraction wire (fake fetch only)", () => {
  it("generates strict sourceIndex-based claims through the production bounded extractor", async () => {
    const h = offlineHarness([valid()]);
    const prompt = extractionMessages(h.sources, []);
    const cost = extractionRequestCost(prompt, true);
    expect(cost.tools).toBeGreaterThan(extractionRequestCost(prompt, false).tools);
    expect(resolveContextBudget({ deployed: DEPLOYED, outputReserve: 1024 }, cost, 1024).fits).toBe(true);

    const claims = await h.run.extract(h.sources, []);
    expect(h.bodies).toHaveLength(1);
    assertNativeWire(h.bodies[0]);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      section: "errors", status: "unresolved", sources: [evidence.evidence.id],
    });
    expect(claims[0].text).toContain(`Source quote: ${passage}`);
    expect(h.run.snapshot()).toMatchObject({ calls: 1, chunks: 1, retries: 0 });
    expect(JSON.stringify(h.sources)).toBe(h.before);
  });

  it("retries one schema-invalid model response with the identical native schema and content-free error category", async () => {
    const invalid = { claims: [{ ...valid().claims[0], status: "verified-observation" }] };
    const h = offlineHarness([invalid, valid()]);
    const claims = await h.run.extract(h.sources, []);
    expect(claims).toHaveLength(1);
    expect(h.bodies).toHaveLength(2);
    for (const body of h.bodies) assertNativeWire(body);
    expect(h.bodies[1].format).toEqual(h.bodies[0].format);
    expect(h.bodies[1].messages[1]).toEqual(h.bodies[0].messages[1]);
    expect(h.bodies[1].messages[0].content).toContain("Validation repair:");
    expect(h.bodies[1].messages[0].content).not.toContain("verified-observation");
    expect(h.observed.filter(entry => entry.phase === "extraction-attempt-end")
      .map(entry => ({ reason: entry.attempt?.reason,
        validation: entry.attempt?.validation,
        validationReason: entry.attempt?.validationReason }))).toEqual([
      { reason: "initial", validation: "invalid", validationReason: "schema-enum" },
      { reason: "validation-retry", validation: "valid", validationReason: undefined },
    ]);
    expect(h.run.snapshot()).toMatchObject({ calls: 2, chunks: 1, retries: 1 });
    expect(JSON.stringify(h.sources)).toBe(h.before);
  });
});
