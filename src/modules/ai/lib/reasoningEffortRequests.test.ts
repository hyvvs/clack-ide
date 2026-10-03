import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLanguageModel } from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import {
  EFFORT_CONTRACTS,
  captureEffort,
  type EffortCapture,
} from "@/modules/ai/lib/reasoningEffort";
import type { ProviderId } from "@/modules/ai/config";
import { modelBudgetLimits } from "@/modules/ai/lib/requestPreflight";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
afterEach(() => vi.unstubAllGlobals());
const prompt = [
  { role: "user" as const, content: [{ type: "text" as const, text: "Hi" }] },
];
const cases = Object.entries(EFFORT_CONTRACTS).flatMap(([key, contract]) => {
  const split = key.indexOf(":");
  return ["automatic", ...contract.levels].map((choice) => ({
    provider: key.slice(0, split) as ProviderId,
    model: key.slice(split + 1),
    choice,
    mapping: contract.mapping,
  }));
});
function wireEffort(body: Record<string, unknown>, mapping: string) {
  if (mapping === "responses")
    return (body.reasoning as { effort?: string })?.effort;
  if (mapping === "anthropic")
    return (body.output_config as { effort?: string })?.effort;
  if (mapping.startsWith("google")) {
    const config = body.generationConfig as {
      thinkingConfig?: { thinkingBudget?: number; thinkingLevel?: string };
    };
    return mapping === "google-budget"
      ? config.thinkingConfig?.thinkingBudget
      : config.thinkingConfig?.thinkingLevel;
  }
  return body.reasoning_effort;
}
describe("R2 intercepted installed adapter requests", () => {
  it.each(cases)("$provider $model $choice reaches the actual wire", async ({
    provider,
    model,
    choice,
    mapping,
  }) => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response('{"error":{"message":"fixture"}}', { status: 400 });
      }),
    );
    const reasoning = captureEffort(model, {
      providerId: provider,
      transportModelId: model,
    });
    reasoning.choice = choice;
    const built = await buildLanguageModel(
      provider,
      { ...EMPTY_PROVIDER_KEYS, [provider]: "fixture-key" },
      model,
      { reasoning },
    );
    if (typeof built === "string" || built.specificationVersion !== "v3")
      throw new Error("Missing adapter");
    await Promise.resolve(built.doGenerate({ prompt })).catch(() => undefined);
    expect(bodies).toHaveLength(1);
    expect(wireEffort(bodies[0], mapping)).toBe(
      choice === "automatic"
        ? undefined
        : mapping === "google-budget"
          ? Number(choice)
          : choice,
    );
    expect(JSON.stringify(bodies[0])).not.toContain('"includeThoughts":true');
    const limits = await modelBudgetLimits(built);
    if (mapping === "google-budget" && Number(choice) > 0) {
      expect(limits.reasoningBudget).toBe(Number(choice));
      expect(
        (bodies[0].generationConfig as { maxOutputTokens: number })
          .maxOutputTokens,
      ).toBe(Number(choice) + 2048);
    }
  });
  it("unsupported stored values cannot emit invalid effort parameters", async () => {
    const fetcher = vi.fn(async (_url, init) => {
      expect(JSON.parse(String(init?.body)).reasoning).toBeUndefined();
      return new Response('{"error":{"message":"fixture"}}', { status: 400 });
    });
    vi.stubGlobal("fetch", fetcher);
    const identity = {
      providerId: "openai" as const,
      transportModelId: "gpt-4.1-mini",
    };
    const initial = captureEffort("saved", identity);
    const reasoning = captureEffort("saved", identity, {
      version: 1,
      choices: [
        {
          key: initial.key,
          revision: initial.capability.revision,
          choice: "high",
        },
      ],
    });
    const built = await buildLanguageModel(
      "openai",
      { ...EMPTY_PROVIDER_KEYS, openai: "fixture" },
      identity.transportModelId,
      { reasoning },
    );
    if (typeof built === "string" || built.specificationVersion !== "v3")
      throw Error("adapter");
    await Promise.resolve(built.doGenerate({ prompt })).catch(() => undefined);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("explicit budget exceeding an output cap blocks before HTTP", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const reasoning = captureEffort("g", {
      providerId: "google",
      transportModelId: "gemini-2.5-flash",
    });
    reasoning.choice = "4096";
    const built = await buildLanguageModel(
      "google",
      { ...EMPTY_PROVIDER_KEYS, google: "fixture" },
      "gemini-2.5-flash",
      { reasoning },
    );
    if (typeof built === "string" || built.specificationVersion !== "v3")
      throw Error("adapter");
    await expect(
      built.doGenerate({ prompt, maxOutputTokens: 1024 }),
    ).rejects.toThrow("leave room");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("stream calls and subsequent tool/retry calls retain captured effort", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response('{"error":{"message":"fixture"}}', { status: 400 });
      }),
    );
    const reasoning: EffortCapture = {
      ...captureEffort("gpt-5.4-mini", {
        providerId: "openai",
        transportModelId: "gpt-5.4-mini",
      }),
      choice: "high",
    };
    const built = await buildLanguageModel(
      "openai",
      { ...EMPTY_PROVIDER_KEYS, openai: "fixture" },
      reasoning.model,
      { reasoning },
    );
    if (typeof built === "string" || built.specificationVersion !== "v3")
      throw Error("adapter");
    for (let i = 0; i < 3; i++)
      await Promise.resolve(built.doStream({ prompt })).catch(() => undefined);
    expect(bodies).toHaveLength(3);
    expect(bodies.map((b) => wireEffort(b, "responses"))).toEqual([
      "high",
      "high",
      "high",
    ]);
  });
  it("the real SDK retry and tool continuation preserve the captured request", async () => {
    const bodies: Record<string, unknown>[] = [];
    const reasoning = {
      ...captureEffort("deepseek-v4-flash", {
        providerId: "deepseek",
        transportModelId: "deepseek-v4-flash",
      }),
      choice: "high",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        reasoning.choice = "low";
        if (bodies.length === 1)
          return new Response('{"error":{"message":"retry fixture"}}', {
            status: 503,
          });
        return Response.json({
          id: "fixture",
          model: "deepseek-v4-flash",
          created: 1,
          choices: [
            {
              index: 0,
              finish_reason: bodies.length === 2 ? "tool_calls" : "stop",
              message:
                bodies.length === 2
                  ? {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: "call-1",
                          type: "function",
                          function: { name: "ping", arguments: "{}" },
                        },
                      ],
                    }
                  : { role: "assistant", content: "Done" },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        });
      }),
    );
    const model = await buildLanguageModel(
      "deepseek",
      { ...EMPTY_PROVIDER_KEYS, deepseek: "fixture" },
      reasoning.model,
      { reasoning },
    );
    const execute = vi.fn(async () => "pong");
    const result = await generateText({
      model,
      prompt: "Run ping then answer",
      maxRetries: 1,
      stopWhen: stepCountIs(3),
      tools: { ping: tool({ inputSchema: z.object({}), execute }) },
    });
    expect(result.text).toBe("Done");
    expect(execute).toHaveBeenCalledOnce();
    expect(bodies.map((body) => body.reasoning_effort)).toEqual([
      "high",
      "high",
      "high",
    ]);
    expect(JSON.stringify(bodies[2])).toContain("pong");
  });
});
