/** Strictly offline: no real fetch may reach a hosted provider. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { streamText, tool } from "ai";
import { z } from "zod";
import { buildLanguageModel } from "@/modules/ai/lib/agent";
import { modelBudgetLimits } from "@/modules/ai/lib/requestPreflight";
import { resolveAgentOutputBudget } from "@/modules/ai/lib/agentOutputBudget";
import { parseProviderContextCatalog } from "@/modules/ai/lib/providerModelEvidence";
import { captureEffort } from "@/modules/ai/lib/reasoningEffort";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import {
  diagnoseHostedHarnessFailure,
  inspectHostedWireBody,
  installHostedFetchCapture,
  type HostedWireReceipt,
} from "@/test/hostedFetchCapture";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));

const laguna = "poolside/laguna-s-2.1:free";
const nemotron = "nvidia/nemotron-3-ultra-550b-a55b:free";
const endpoint = "https://openrouter.ai/api/v1/chat/completions";
const wire = (model = laguna, max_tokens = 8192) =>
  JSON.stringify({ model, max_tokens, stream: true, tools: [{ type: "function" }] });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("post-policy hosted harness: passive browser fetch capture", () => {
  it.each([laguna, nemotron])("decodes exact %s native-tool SDK control without effort fields", model => {
    expect(inspectHostedWireBody(wire(model), model)).toMatchObject({
      max_tokens: 8192, modelId: model, toolsCount: 1,
      max_completion_tokens: null, stage: "after-sdk-and-preflight",
    });
  });
  it("fails explicitly for wrong/missing provider and model metadata", () => {
    expect(() => installHostedFetchCapture({ modelId: "", offline: true, record: async () => {} }))
      .toThrow("missing exact saved provider/model ID");
    expect(() => inspectHostedWireBody(wire(laguna), nemotron)).toThrow("identity mismatch");
    expect(() => inspectHostedWireBody(JSON.stringify({ model: laguna }), laguna))
      .toThrow("missing numeric max_tokens");
  });
  it("rejects unsupported reasoning and completion fields", () => {
    for (const name of ["reasoning_effort", "reasoning", "include_reasoning",
      "max_completion_tokens", "max_output_tokens"]) {
      expect(() => inspectHostedWireBody(JSON.stringify({
        model: laguna, max_tokens: 8192, [name]: "high",
      }), laguna)).toThrow("unsupported completion or reasoning controls");
    }
  });
  it("is observational: passes original input/init/binding/Response through intact", async () => {
    const response = new Response("fixture");
    const headers = { "X-Local-Not-Secret": "fixture" };
    const body = wire();
    const init: RequestInit = { method: "POST", body, headers };
    const receiver: unknown[] = [];
    const original = vi.fn(function (this: unknown, input: RequestInfo | URL, opts?: RequestInit) {
      receiver.push(this, input, opts);
      return Promise.resolve(response);
    });
    vi.stubGlobal("fetch", original);
    const records: HostedWireReceipt[] = [];
    const restore = installHostedFetchCapture({
      modelId: laguna, offline: false,
      record: async record => { records.push(record); },
    });
    const observed = await fetch(endpoint, init);
    expect(observed).toBe(response);
    expect(receiver).toEqual([globalThis, endpoint, init]);
    expect(init.body).toBe(body);
    expect(init.headers).toBe(headers);
    expect(records).toHaveLength(1);
    expect(records[0].max_tokens).toBe(8192);
    restore();
    expect(globalThis.fetch).toBe(original);
  });
  it("preserves non-provider fetch semantics, headers, request and receiver", async () => {
    const original = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(new Response("local"));
    });
    vi.stubGlobal("fetch", original);
    const restore = installHostedFetchCapture({ modelId: laguna, offline: false,
      record: async () => { throw new Error("Should not record a local request"); } });
    expect(await (await fetch("http://127.0.0.1:1456/report")).text()).toBe("local");
    expect(original).toHaveBeenCalledTimes(1);
    restore();
  });
  it("blocks all real inference and external URLs when offline; captures final wire first", async () => {
    const original = vi.fn(() => Promise.reject(new Error("REAL NETWORK MUST NEVER RUN")));
    vi.stubGlobal("fetch", original);
    const captured: HostedWireReceipt[] = [];
    const restore = installHostedFetchCapture({ modelId: laguna, offline: true,
      record: async record => { captured.push(record); } });
    await expect(fetch(endpoint, { method: "POST", body: wire() }))
      .rejects.toThrow("OFFLINE_DRY_RUN");
    await expect(fetch("https://openrouter.ai/api/v1/models"))
      .rejects.toThrow("external fetch blocked");
    await expect(fetch("https://example.org/api/v1/chat/completions"))
      .rejects.toThrow("external fetch blocked");
    expect(original).not.toHaveBeenCalled();
    expect(captured.map(r => r.max_tokens)).toEqual([8192]);
    restore();
  });
  it("fails closed if audit storage rejects, without forwarding any network request", async () => {
    const original = vi.fn(() => Promise.reject(new Error("network")));
    vi.stubGlobal("fetch", original);
    const restore = installHostedFetchCapture({ modelId: laguna, offline: false,
      record: async () => { throw new Error("audit unavailable"); } });
    await expect(fetch(endpoint, { method: "POST", body: wire() }))
      .rejects.toThrow("audit unavailable");
    expect(original).not.toHaveBeenCalled();
    restore();
  });
  it("preserves TypeError name, message, location and last successful milestone", () => {
    const error = new TypeError("Cannot assign to read only property 'invoke' of object '#<Object>'");
    error.stack = "TypeError: Cannot assign to read only property 'invoke'\n    at installWireCapture (src/test/postPolicyHostedNotesAgent.tsx:81:19)";
    expect(diagnoseHostedHarnessFailure(error, "react-mounted")).toMatchObject({
      failureClass: "TypeError", failureMessage: error.message,
      failureStack: expect.stringContaining("postPolicyHostedNotesAgent.tsx:81:19"),
      lastMilestone: "react-mounted",
    });
  });
});

describe("SDK adapter and production preflight, with browser network forbidden", () => {
  it.each([
    [laguna, 262144, 32768, 8192],
    [nemotron, 1000000, 65536, 8192],
    ["fixture/small-output:free", 262144, 4096, 4096],
  ] as const)("captures a fully serialized %s request offline", async (id, context, outputCap, expected) => {
    const evidence = parseProviderContextCatalog({ data: [{
      id, context_length: context,
      top_provider: { max_completion_tokens: outputCap },
      supported_parameters: ["tools", "max_tokens", "reasoning"],
      reasoning: { default_enabled: true },
    }] }).get(id);
    if (!evidence) throw new Error("Missing fixture");
    const reasoning = captureEffort(`saved-provider:${id}`, {
      providerId: "openrouter", transportModelId: id,
    });
    expect(reasoning.capability.status).toBe("unknown");
    const original = vi.fn(() => Promise.reject(new Error("REAL NETWORK MUST NEVER RUN")));
    vi.stubGlobal("fetch", original);
    const records: HostedWireReceipt[] = [];
    const restore = installHostedFetchCapture({ modelId: id, offline: true,
      record: async value => { records.push(value); } });
    const model = await buildLanguageModel("openrouter",
      { ...EMPTY_PROVIDER_KEYS, openrouter: "offline-unit-test-key" }, id,
      { reasoning, providerEvidence: evidence });
    const limits = await modelBudgetLimits(model);
    expect(limits).toMatchObject({ reported: context, outputCap });
    const allowance = resolveAgentOutputBudget(limits, reasoning);
    expect(allowance).toBe(expected);
    const stream = streamText({ model, prompt: "Offline fixture; no inference",
      tools: { list_directory: tool({ inputSchema: z.object({ path: z.string() }) }) },
      maxOutputTokens: allowance, maxRetries: 0 });
    await expect(stream.text).rejects.toThrow();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ modelId: id, max_tokens: expected, toolsCount: 1 });
    expect(records[0].outputFieldsPresent.reasoning_effort).toBe(false);
    expect(original).not.toHaveBeenCalled();
    restore();
  });
  it("keeps manually configured lower output limit and missing metadata conservative", () => {
    const reasoning = captureEffort(`saved-provider:${laguna}`, {
      providerId: "openrouter", transportModelId: laguna });
    expect(resolveAgentOutputBudget({ reported: 262144, outputCap: 32768, maxOutput: 1024 }, reasoning)).toBe(1024);
    expect(resolveAgentOutputBudget({ reported: 262144, outputCap: 32768 }, reasoning)).toBe(2048);
  });
});
