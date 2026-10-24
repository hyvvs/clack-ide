import { describe, expect, it, vi } from "vitest";
import { streamText, stepCountIs, tool, type UIMessage } from "ai";
import { z } from "zod";
import { createOllamaModel } from "./ollamaModel";
import { withAnswerContinuation, type AnswerState } from "./answerContinuation";
import { actionableCoderRequest, imitatedNativeTool } from "./nativeToolImitation";
import { createRunBudget, recordRunBatch } from "./runBudget";

const exposed = new Set(["list_directory", "write_file", "bash_run"]);
const xml = "I'll inspect the workspace.\n<function=list_directory>\n<parameter=path>\n.\n</parameter>\n</function>\n</tool_call>";
const user = (text: string): UIMessage => ({ id: "user", role: "user", parts: [{ type: "text", text }] });
const message = (content: string, calls?: unknown[]) => ({
  model: "test", message: { role: "assistant", content, ...(calls ? { tool_calls: calls } : {}) },
  done: true, done_reason: "stop", prompt_eval_count: 20, eval_count: 30,
});
const response = (content: string, calls?: unknown[]) =>
  new Response(JSON.stringify(message(content, calls)) + "\n", { headers: { "content-type": "application/x-ndjson" } });

function harness(replies: Array<{ content: string; calls?: unknown[] }>, options?: { remaining?: number; abort?: AbortSignal; allow?: Set<string>; validate?: () => void }) {
  const requests: Array<Record<string, any>> = [];
  const execute = vi.fn(async ({ path }: { path: string }) => ({ entries: [path] }));
  const states: AnswerState[] = [];
  const charge = vi.fn(async () => {});
  const model = createOllamaModel({
    modelId: "test",
    baseURL: "http://localhost:11434",
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const next = replies.shift();
      if (!next) throw Error("Unexpected extra provider dispatch");
      return response(next.content, next.calls);
    },
  });
  const wrapped = withAnswerContinuation(model, {
    runId: "coder-1", provider: "ollama", modelId: "test", isCurrent: () => true,
    signal: options?.abort, maxContinuations: 1,
    limits: async () => ({ asserted: 65536 }), remaining: () => options?.remaining ?? 20,
    charge, onState: state => states.push(state),
    validate: async () => options?.validate?.(),
    imitatedTool: (text, allowed) => imitatedNativeTool(text, new Set([...allowed].filter(name => (options?.allow ?? exposed).has(name)))),
  });
  const run = () => streamText({
    model: wrapped,
    prompt: "Build a local notes API in the workspace",
    tools: { list_directory: tool({
      inputSchema: z.object({ path: z.string() }),
      execute,
    }) },
    maxOutputTokens: 2048, maxRetries: 0, stopWhen: stepCountIs(2),
  });
  return { requests, execute, states, charge, run };
}

describe("bounded real native tool correction (not a pseudo-tool executor)", () => {
  it("recognizes exposed XML, JSON and function imitations, not ordinary explanations or unexposed tools", () => {
    expect(imitatedNativeTool(xml, exposed)).toBe("list_directory");
    expect(imitatedNativeTool('{"name":"write_file","arguments":{"path":"a","content":"b"}}', exposed)).toBe("write_file");
    expect(imitatedNativeTool('<tool_call>\n{\n"name":"write_file",\n"arguments":{"path":"a"}\n}\n</tool_call>', exposed)).toBe("write_file");
    expect(imitatedNativeTool('list_directory({"path":"."})', exposed)).toBe("list_directory");
    expect(imitatedNativeTool('<function=secret_tool>\n</function>', exposed)).toBeNull();
    expect(imitatedNativeTool("This tool is called list_directory and takes a path.", exposed)).toBeNull();
    expect(imitatedNativeTool(xml, new Set())).toBeNull();
    expect(actionableCoderRequest([user("Build a tiny Node TypeScript API from scratch")])).toBe(true);
    expect(actionableCoderRequest([user("Explain how to build a Node API")])).toBe(false);
    expect(actionableCoderRequest([user("Review this list_directory example")])).toBe(false);
  });

  it("one corrective native request produces a real tool call and executes only its validated SDK tool", async () => {
    const h = harness([
      { content: xml },
      { content: "", calls: [{ function: { name: "list_directory", arguments: { path: "." } } }] },
      { content: "done" },
    ]);
    const result = h.run();
    await result.consumeStream();
    expect(h.requests.length).toBeGreaterThanOrEqual(2);
    expect(h.requests[0]).toMatchObject({ tools: [{ function: { name: "list_directory" } }] });
    expect(h.requests[1].tool_choice).toBeUndefined();
    expect(h.requests[1].messages[0].content).toContain("imitated the exposed");
    expect(h.requests[1].messages[0].content).toContain("No tool was called or executed");
    expect(h.charge).toHaveBeenCalledOnce();
    expect(h.execute).toHaveBeenCalledOnce();
    expect(h.execute).toHaveBeenCalledWith({ path: "." }, expect.anything());
    expect(h.states[h.states.length - 1]?.nativeToolImitationBlocked).toBe(false);
  });

  it("repeated textual imitation is never executed and cannot complete as a successful answer", async () => {
    const h = harness([{ content: xml }, { content: xml }]);
    const result = h.run();
    await result.consumeStream();
    expect(h.requests).toHaveLength(2);
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.states[h.states.length - 1]).toMatchObject({ state: "incomplete", nativeToolImitationBlocked: true });
    const budget = recordRunBatch(createRunBudget("full-access"), {
      steps: 1, hitSoftLimit: false, finishReason: await result.finishReason,
      nativeToolImitationBlocked: h.states[h.states.length - 1]?.nativeToolImitationBlocked,
    }, "full-access");
    expect(budget).toMatchObject({ phase: "soft-limit", stopReason: "blocked-work" });
  });

  it("prose final answers and unavailable/unauthorized names stay untouched", async () => {
    for (const opts of [
      { text: "The implementation is complete. Here are the results." },
      { text: xml, allow: new Set<string>() },
    ]) {
      const h = harness([{ content: opts.text }], { allow: opts.allow });
      const result = h.run();
      await result.consumeStream();
      expect(h.requests).toHaveLength(1);
      expect(h.charge).not.toHaveBeenCalled();
      expect(h.execute).not.toHaveBeenCalled();
      expect(h.states[h.states.length - 1]?.nativeToolImitationBlocked).not.toBe(true);
    }
  });

  it("the shared step budget and cancellation prevent corrective dispatches", async () => {
    const budget = harness([{ content: xml }], { remaining: 1 });
    await budget.run().consumeStream();
    expect(budget.requests).toHaveLength(1);
    expect(budget.states[budget.states.length - 1]?.state).toBe("incomplete");
    expect(budget.states[budget.states.length - 1]?.nativeToolImitationBlocked).toBe(true);
    const controller = new AbortController();
    const cancelled = harness([{ content: xml }], {
      abort: controller.signal,
      validate: () => controller.abort(),
    });
    try { await cancelled.run().consumeStream(); } catch { /* aborted as expected */ }
    expect(cancelled.requests).toHaveLength(1);
    expect(cancelled.charge).not.toHaveBeenCalled();
    expect(cancelled.execute).not.toHaveBeenCalled();
  });

  it("required-tool choice cannot be claimed enforced by the native Ollama wire", async () => {
    const requests: any[] = [];
    const result = streamText({
      model: createOllamaModel({
        modelId: "test", baseURL: "http://localhost",
        fetch: async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return response(xml); },
      }),
      prompt: "Build the app",
      toolChoice: "required",
      tools: { list_directory: tool({ inputSchema: z.object({ path: z.string() }), execute: vi.fn() }) },
      maxRetries: 0,
    });
    expect(await result.toolCalls).toEqual([]);
    expect(await result.text).toBe(xml);
    expect(requests).toHaveLength(1);
    expect(requests[0].tool_choice).toBeUndefined();
    expect(requests[0].tools).toHaveLength(1);
  });
});
