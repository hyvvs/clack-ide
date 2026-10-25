import { describe, expect, it, vi } from "vitest";
import { streamText, tool } from "ai";
import { z } from "zod";
import { resolveAgentOutputBudget } from "@/modules/ai/lib/agentOutputBudget";
import { assertRequestBudget, resolveContextBudget } from "@/modules/ai/lib/contextBudget";
import { createOllamaModel } from "@/modules/ai/lib/ollamaModel";
import type { EffortCapture } from "@/modules/ai/lib/reasoningEffort";

const thinking = {
  choice: "automatic",
  capability: { status: "supported" },
} as EffortCapture;
const context = { deployed: 65536, runtimeTarget: 65536 };

describe("bounded Agent reasoning + tool output default", () => {
  it("does not let the ordinary 2048 conversational fallback starve a verified 65K thinking Agent", () => {
    expect(resolveContextBudget(context).output).toBe(2048);
    const output = resolveAgentOutputBudget(context, thinking);
    expect(output).toBe(8192);
    const budget = resolveContextBudget({ ...context, outputReserve: output }, {
      system: 2000, tools: 4000, conversation: 7000, uncertainMedia: false,
    }, output);
    expect(budget).toMatchObject({ output: 8192, reserve: 8192, fits: true });
  });

  it("never promotes speculative context, disabled thinking or unknown reasoning", () => {
    expect(resolveAgentOutputBudget({ advertised: 262144 }, thinking)).toBe(resolveContextBudget({ advertised: 262144 }).output);
    expect(resolveAgentOutputBudget({ ...context, deployed: undefined }, thinking)).toBe(2048);
    expect(resolveAgentOutputBudget(context)).toBe(2048);
    expect(resolveAgentOutputBudget(context, { ...thinking, choice: "none" })).toBe(2048);
    expect(resolveAgentOutputBudget(context, { ...thinking, capability: { ...thinking.capability, status: "unknown" } })).toBe(2048);
  });

  it("honors caller fallback requirements, profile limits, provider limits and small contexts", () => {
    expect(resolveAgentOutputBudget(context, thinking, 1024)).toBe(1024);
    expect(resolveAgentOutputBudget({ ...context, maxOutput: 2048 }, thinking)).toBe(2048);
    expect(resolveAgentOutputBudget({ ...context, outputReserve: 4096 }, thinking)).toBe(4096);
    expect(resolveAgentOutputBudget({ ...context, outputReserve: 0 }, thinking)).toBe(2048);
    expect(resolveAgentOutputBudget({ ...context, outputCap: 4096 }, thinking)).toBe(4096);
    expect(resolveAgentOutputBudget({ deployed: 32768 }, thinking)).toBe(4096);
    expect(resolveAgentOutputBudget({ deployed: 8192 }, thinking)).toBe(resolveContextBudget({ deployed: 8192 }).output);
  });

  it("serializes an 8192-token Agent allowance and accepts a native call after >2048 reasoning tokens", async () => {
    const frames = [
      { message: { role: "assistant", thinking: "reasoning before the tool call" }, done: false },
      { message: { role: "assistant", tool_calls: [{ function: { name: "lookup", arguments: { key: "test" } } }] },
        done: true, done_reason: "stop", prompt_eval_count: 1500, eval_count: 3000 },
    ];
    const bodies: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(`${frames.map(f => JSON.stringify(f)).join("\n")}\n`, {
        headers: { "content-type": "application/x-ndjson" },
      });
    });
    const output = resolveAgentOutputBudget(context, thinking);
    const result = streamText({
      model: createOllamaModel({ modelId: "offline", baseURL: "http://127.0.0.1:11434", fetch: fetcher as typeof fetch }),
      prompt: "Use the lookup tool to inspect the workspace.",
      tools: { lookup: tool({ description: "Read-only lookup", inputSchema: z.object({ key: z.string() }) }) },
      maxOutputTokens: output,
      maxRetries: 0,
    });
    expect(await result.toolCalls).toEqual([expect.objectContaining({ toolName: "lookup", input: { key: "test" } })]);
    expect((await result.usage).outputTokens).toBe(3000);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(bodies[0]).toMatchObject({ options: { num_predict: 8192 }, stream: true });
    expect(bodies[0]).not.toHaveProperty("think");
    expect(assertRequestBudget({ ...context, outputReserve: output }, bodies[0])).toMatchObject({ fits: true, output: 8192 });
  });
});
