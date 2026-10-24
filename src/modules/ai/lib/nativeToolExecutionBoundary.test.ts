import { describe, expect, it, vi } from "vitest";
import { streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { createOllamaModel } from "@/modules/ai/lib/ollamaModel";
import { selectToolSchemas } from "@/modules/ai/lib/toolExposure";
import { serializedToolSchemas } from "@/modules/ai/lib/requestPreflight";

const listDirectory = (execute?: (input: { path: string }) => Promise<unknown>) =>
  tool({
    description: "List contents of an authorized directory",
    inputSchema: z.object({ path: z.string() }),
    execute: async (input: { path: string }) => execute?.(input),
  });
const frame = (message: Record<string, unknown>) => ({
  model: "test",
  message: { role: "assistant", ...message },
  done: true,
  done_reason: "stop",
  prompt_eval_count: 12,
  eval_count: 4,
});
const reply = (message: Record<string, unknown>) =>
  new Response(JSON.stringify(frame(message)) + "\n", {
    headers: { "content-type": "application/x-ndjson" },
  });

describe("R5ai: native tool boundary, not textual tool-call imitation", () => {
  it("F1 exposes filesystem inspection and creation only from permitted schemas", async () => {
    const schemas = await serializedToolSchemas({
      list_directory: listDirectory(),
      write_file: tool({
        description: "Write a new project file",
        inputSchema: z.object({ path: z.string(), content: z.string() }),
      }),
      bash_run: tool({
        description: "Execute an authorized command to build or test software",
        inputSchema: z.object({ command: z.string() }),
      }),
    });
    const result = selectToolSchemas({
      schemas,
      query: "Create a Node TypeScript notes API with source files, test and build commands",
      limits: { runtimeTarget: 65536 },
    });
    expect(result.names).toEqual(
      expect.arrayContaining(["list_directory", "write_file", "bash_run"]),
    );
    expect(result.schemas.every(schema =>
      ["list_directory", "write_file", "bash_run"].includes(schema.function.name))).toBe(true);
  });

  it("serializes actual Ollama function schemas but never executes pseudo-tool message text", async () => {
    const execute = vi.fn(async () => ({ entries: [] }));
    const requests: Record<string, unknown>[] = [];
    const pseudo = "<function=list_directory>\n<parameter=path>\n.\n</parameter>\n</function>\n</tool_call>";
    const fetcher: typeof fetch = async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return reply({ content: pseudo });
    };
    const result = streamText({
      model: createOllamaModel({ modelId: "test", baseURL: "http://localhost", fetch: fetcher }),
      prompt: "Inspect the workspace using the native function",
      tools: { list_directory: listDirectory(execute) },
      providerOptions: { ollama: { numCtx: 65536 } },
      maxOutputTokens: 2048,
      maxRetries: 0,
      stopWhen: stepCountIs(3),
    });
    expect(await result.text).toBe(pseudo);
    expect(await result.toolCalls).toEqual([]);
    expect(await result.finishReason).toBe("stop");
    expect(execute).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      stream: true,
      options: { num_ctx: 65536, num_predict: 2048 },
      tools: [{
        type: "function",
        function: { name: "list_directory", parameters: { type: "object" } },
      }],
    });
    expect(requests[0].tool_choice).toBeUndefined();
  });

  it("executes a genuine structured native directory call through SDK and preserves its result", async () => {
    const execute = vi.fn(async ({ path }: { path: string }) => ({ entries: [path] }));
    const requests: Record<string, unknown>[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return reply(requests.length === 1
        ? { tool_calls: [{ function: { name: "list_directory", arguments: { path: "." } } }] }
        : { content: "Directory inspected" });
    };
    const result = streamText({
      model: createOllamaModel({ modelId: "test", baseURL: "http://localhost", fetch: fetcher }),
      prompt: "Inspect the workspace",
      tools: { list_directory: listDirectory(execute) },
      maxOutputTokens: 2048,
      maxRetries: 0,
      stopWhen: stepCountIs(2),
    });
    expect(await result.text).toBe("Directory inspected");
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][0]).toEqual({ path: "." });
    expect(requests).toHaveLength(2);
    expect(requests[1].messages).toContainEqual(expect.objectContaining({
      role: "tool",
      tool_name: "list_directory",
    }));
  });
});
