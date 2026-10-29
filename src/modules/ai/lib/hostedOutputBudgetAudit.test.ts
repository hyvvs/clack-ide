/** Offline-only diagnostic of the normal OpenRouter Agent budget and serializer.
 * Every fetch URL is intercepted; no real provider inference or metadata access.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { streamText, tool } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { buildLanguageModel } from "@/modules/ai/lib/agent";
import { resolveAgentOutputBudget } from "@/modules/ai/lib/agentOutputBudget";
import { resolveContextBudget } from "@/modules/ai/lib/contextBudget";
import { modelBudgetLimits } from "@/modules/ai/lib/requestPreflight";
import { captureEffort, type EffortCapture } from "@/modules/ai/lib/reasoningEffort";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { parseProviderContextCatalog } from "@/modules/ai/lib/providerModelEvidence";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));

const cases = [
  ["nvidia/nemotron-3-ultra-550b-a55b:free", 1_000_000, 65_536],
  ["poolside/laguna-s-2.1:free", 262_144, 32_768],
] as const;

const records: Array<Record<string, unknown>> = [];
afterEach(() => {
  vi.unstubAllGlobals();
  records.length = 0;
});

function offlineFetch(options: { outputOverride?: number | null; reasoningDefault?: boolean } = {}): void {
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === "https://openrouter.ai/api/v1/models") {
      return new Response(JSON.stringify({ data: cases.map(([id, context, output]) => ({
        id,
        context_length: context,
        top_provider: {
          context_length: context,
          ...(options.outputOverride === null ? {} : {
            max_completion_tokens: options.outputOverride ?? output,
          }),
        },
        supported_parameters: ["tools", "reasoning", "max_tokens"],
        reasoning: { default_enabled: options.reasoningDefault ?? true },
      })) }), { headers: { "content-type": "application/json" } });
    }
    if (String(url).startsWith("https://openrouter.ai/api/v1/model/"))
      throw new Error("Unexpected exact-model metadata request in offline audit");
    if (String(url) !== "https://openrouter.ai/api/v1/chat/completions")
      throw new Error("Unexpected URL; offline audit prohibits real network access");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    records.push(body);
    const response = {
      id: "offline", created: 1, model: body.model, choices: [{
        index: 0, delta: { role: "assistant", content: "Fixture." }, finish_reason: "stop",
      }], usage: { prompt_tokens: 12, completion_tokens: 3 },
    };
    return new Response(`data: ${JSON.stringify(response)}\n\ndata: [DONE]\n\n`, {
      headers: { "content-type": "text/event-stream" },
    });
  }));
}

const fixtureKeys = { ...EMPTY_PROVIDER_KEYS, openrouter: "offline-fixture-key" };
function freshFixtureEvidence(id: string, options: {
  output?: number; defaultEnabled?: boolean;
}) {
  const model = {
    id, context_length: 262144,
    top_provider: { context_length: 262144, ...(options.output ? { max_completion_tokens: options.output } : {}) },
    reasoning: { default_enabled: options.defaultEnabled ?? true },
    supported_parameters: ["tools", "reasoning", "max_tokens"],
  };
  const evidence = parseProviderContextCatalog({ data: [model] }).get(id);
  if (!evidence) throw new Error("Test provider evidence is not valid");
  return evidence;
}
function unknownEffort(model: string): EffortCapture {
  return captureEffort(`saved-provider:${model}`, {
    providerId: "openrouter", transportModelId: model,
  });
}

describe("hosted reasoning-capacity policy — offline-only production serializer", () => {
  it.each(cases)("promotes automatic reasoning to bounded max_tokens=8192 for %s with fresh metadata", async (id, context, outputCap) => {
    offlineFetch();
    const reasoning = unknownEffort(id);
    expect(reasoning).toMatchObject({ choice: "automatic", capability: { status: "unknown" } });
    const model = await buildLanguageModel("openrouter", fixtureKeys, id, { reasoning });
    const limits = await modelBudgetLimits(model);
    expect(limits).toMatchObject({ reported: context, outputCap });
    expect(limits.maxOutput).toBeUndefined();
    const allowance = resolveAgentOutputBudget(limits, reasoning);
    expect(allowance).toBe(8192);
    const budget = resolveContextBudget({ ...limits, outputReserve: allowance });
    expect(budget).toMatchObject({ output: 8192, source: "reported", fits: true });
    const result = streamText({
      model,
      prompt: "Offline SDK request, no network",
      tools: { lookup: tool({ description: "An offline native-tool schema", inputSchema: z.object({ path: z.string() }) }) },
      maxOutputTokens: budget.output,
      maxRetries: 0,
    });
    expect(await result.text).toBe("Fixture.");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ model: id, max_tokens: 8192, stream: true });
    expect(records[0]).not.toHaveProperty("max_completion_tokens");
    expect(records[0]).toHaveProperty("tools");
    // Output capacity is independent of whether Clack can send effort controls.
    expect(records[0]).not.toHaveProperty("reasoning_effort");
    expect(records[0]).not.toHaveProperty("reasoning");
    expect(records[0]).not.toHaveProperty("include_reasoning");
  });

  it("keeps ordinary hosted chat at its existing 2048 default", () => {
    for (const [, context, outputCap] of cases) {
      expect(resolveContextBudget({ reported: context, outputCap }).output).toBe(2048);
    }
  });

  it("Clack preflight supplies 2048 to an omitted caller limit, but the bare SDK adapter does not", async () => {
    offlineFetch();
    const [id] = cases[0];
    const model = await buildLanguageModel("openrouter", fixtureKeys, id, { reasoning: unknownEffort(id) });
    const result = streamText({ model, prompt: "Offline chat request without an output limit", maxRetries: 0 });
    expect(await result.text).toBe("Fixture.");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ max_tokens: 2048 });
    expect(records[0]).not.toHaveProperty("max_completion_tokens");
    const bareAdapter = createOpenAICompatible({
      name: "openrouter", baseURL: "https://openrouter.ai/api/v1",
      apiKey: "offline-fixture-key", fetch: globalThis.fetch,
    })(id);
    const bare = streamText({ model: bareAdapter, prompt: "Offline bare SDK request", maxRetries: 0 });
    expect(await bare.text).toBe("Fixture.");
    expect(records).toHaveLength(2);
    expect(records[1]).not.toHaveProperty("max_tokens");
    expect(records[1]).not.toHaveProperty("max_completion_tokens");
  });

  it("uses the existing bounded Agent promotion only with a supported effort contract", () => {
    const supported = { ...unknownEffort(cases[0][0]),
      capability: { status: "supported" as const, levels: ["low"], mapping: "chat" as const, evidence: "offline fixture", revision: "fixture" } };
    expect(resolveAgentOutputBudget({ reported: 1_000_000, outputCap: 65_536 }, supported)).toBe(8192);
    expect(resolveAgentOutputBudget({ reported: 262_144, outputCap: 4096 }, supported)).toBe(4096);
    expect(resolveAgentOutputBudget({ reported: 262_144, outputCap: 1024 }, supported)).toBe(1024);
    expect(resolveAgentOutputBudget({ reported: 262_144, maxOutput: 1024, outputCap: 32_768 }, supported)).toBe(1024);
    expect(resolveAgentOutputBudget({ reported: 262_144, outputCap: 32_768 }, supported, 1024)).toBe(1024);
    // No bound reasoning metadata: the old conservative fallback still applies.
    expect(resolveAgentOutputBudget({ reported: 262_144, outputCap: 32_768 }, unknownEffort(cases[1][0]))).toBe(2048);
  });

  it("serializes a supported-reasoning Agent's promoted output and an explicit lower allowance", async () => {
    offlineFetch();
    const [id] = cases[0];
    const verifiedFixture = { ...unknownEffort(id), capability: {
      status: "supported" as const, levels: ["low"], mapping: "chat" as const,
      evidence: "offline-only verified capability fixture", revision: "fixture",
    } };
    const model = await buildLanguageModel("openrouter", fixtureKeys, id, { reasoning: verifiedFixture });
    const limits = await modelBudgetLimits(model);
    const allowance = resolveAgentOutputBudget(limits, verifiedFixture);
    expect(allowance).toBe(8192);
    expect(await streamText({ model, prompt: "Offline Agent output", maxOutputTokens: allowance, maxRetries: 0 }).text).toBe("Fixture.");
    expect(records[0]).toMatchObject({ model: id, max_tokens: 8192 });
    expect(await streamText({ model, prompt: "Offline explicit lower output", maxOutputTokens: 1024, maxRetries: 0 }).text).toBe("Fixture.");
    expect(records[1]).toMatchObject({ model: id, max_tokens: 1024 });
  });

  it("uses only the available provider maximum, not an invented reasoning control", async () => {
    offlineFetch();
    const id = "fixture/capped-reasoning:free";
    const reasoning = {
      ...unknownEffort(id),
      capability: { ...unknownEffort(id).capability, status: "unsupported" as const },
    };
    const model = await buildLanguageModel("openrouter", fixtureKeys, id, {
      reasoning, providerEvidence: freshFixtureEvidence(id, { output: 4096 }),
    });
    const limits = await modelBudgetLimits(model);
    expect(limits).toMatchObject({ outputCap: 4096 });
    const allowance = resolveAgentOutputBudget(limits, reasoning);
    expect(allowance).toBe(4096);
    expect(await streamText({ model, prompt: "Offline, capped Agent", maxOutputTokens: allowance, maxRetries: 0 }).text).toBe("Fixture.");
    expect(records[0]).toMatchObject({ model: id, max_tokens: 4096 });
    expect(records[0]).not.toHaveProperty("reasoning_effort");
    expect(records[0]).not.toHaveProperty("reasoning");
    expect(records[0]).not.toHaveProperty("max_completion_tokens");
  });

  it.each([
    ["no provider output maximum", "fixture/no-output-ceiling:free", { output: undefined, defaultEnabled: true }],
    ["not default-on reasoning", "fixture/not-default-reasoning:free", { output: 32768, defaultEnabled: false }],
  ] as const)("keeps the conservative request when %s", async (_reason, id, options) => {
    offlineFetch();
    const reasoning = unknownEffort(id);
    const model = await buildLanguageModel("openrouter", fixtureKeys, id, {
      reasoning, providerEvidence: freshFixtureEvidence(id, options),
    });
    const limits = await modelBudgetLimits(model);
    const allowance = resolveAgentOutputBudget(limits, reasoning);
    expect(allowance).toBe(2048);
    expect(await streamText({ model, prompt: "Offline conservative Agent", maxOutputTokens: allowance, maxRetries: 0 }).text).toBe("Fixture.");
    expect(records[0]).toMatchObject({ model: id, max_tokens: 2048 });
    expect(records[0]).not.toHaveProperty("reasoning_effort");
    expect(records[0]).not.toHaveProperty("reasoning");
  });
});
