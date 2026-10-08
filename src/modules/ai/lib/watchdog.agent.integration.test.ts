import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentStream } from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { normalizeAiError } from "@/modules/ai/lib/errors";
import type { ToolContext } from "@/modules/ai/tools/context";

const fixture = vi.hoisted(() => ({
  execute: vi.fn(),
  changing: false,
  approval: false,
  calls: 0,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage = (_value: unknown) => {};
  },
}));
vi.mock("@/modules/ai/tools/tools", async () => {
  const { tool } = await import("ai");
  const { z } = await import("zod");
  return {
    buildTools: () => ({
      read_file: tool({
        description: "Read fixture",
        inputSchema: z.object({ path: z.string() }),
        needsApproval: () => fixture.approval,
        execute: async () => {
          fixture.execute();
          return { content: "unchanged" };
        },
      }),
    }),
  };
});
import { invoke } from "@tauri-apps/api/core";
beforeEach(() => {
  fixture.execute.mockReset();
  fixture.changing = false;
  fixture.approval = false;
  fixture.calls = 0;
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, args) => {
      if (command === "ai_http_open") return crypto.randomUUID();
      if (command === "ai_http_preflight" || command === "ai_http_cancel")
        return;
      if (command !== "ai_http_stream") return null;
      const a = args as {
        requestId: string;
        onEvent: { onmessage: (e: unknown) => void };
      };
      fixture.calls++;
      const input = JSON.stringify({
        path: fixture.changing ? `file${fixture.calls}` : "same",
      });
      const payload = `data: ${JSON.stringify({ id: "r", created: 1, model: "fixture", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call${fixture.calls}`, type: "function", function: { name: "read_file", arguments: input } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 10 } })}\n\ndata: [DONE]\n\n`;
      a.onEvent.onmessage({
        requestId: a.requestId,
        kind: "headers",
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
      a.onEvent.onmessage({
        requestId: a.requestId,
        kind: "chunk",
        bytes: [...new TextEncoder().encode(payload)],
      });
      a.onEvent.onmessage({
        requestId: a.requestId,
        kind: "settled",
        phase: "completed",
      });
    });
});
async function run() {
  const states = vi.fn();
  const observations = vi.fn();
  const result = await runAgentStream({
    keys: EMPTY_PROVIDER_KEYS,
    modelId: "compat-watchdog-fixture",
    customEndpoints: [
      {
        id: "watchdog-fixture",
        name: "Fixture",
        modelId: "fixture",
        baseURL: "http://localhost:1234/v1",
        contextLimit: 32768,
      },
    ],
    toolContext: {
      getCwd: () => "/fixture",
      getWorkspaceRoot: () => "/fixture",
      getSessionId: () => "f2",
      getAgentId: () => "reviewer",
    } as ToolContext,
    uiMessages: [
      {
        id: "u",
        role: "user",
        parts: [{ type: "text", text: "Read the fixture file." }],
      },
    ],
    onAnswerState: states,
    onRunStep: observations,
  });
  const chunks = [];
  for await (const part of result.fullStream) chunks.push(part);
  return { chunks, states, observations };
}
describe("F2 real agent tool execution loop boundary", () => {
  it("stops after eight equivalent results and retains every completed SDK call/result", async () => {
    const { chunks, states, observations } = await run();
    expect(observations.mock.calls[0][0]).toEqual({
      toolName: "read_file",
      input: { path: "same" },
      output: { content: "unchanged" },
      failed: false,
    });
    expect(observations.mock.calls[1][0]).toEqual(
      observations.mock.calls[0][0],
    );
    expect(chunks.find((p) => p.type === "tool-result")).toMatchObject({
      output: { content: "unchanged" },
    });
    expect(fixture.calls).toBe(8);
    expect(fixture.execute).toHaveBeenCalledTimes(8);
    expect(chunks.filter((p) => p.type === "tool-result")).toHaveLength(8);
    expect(chunks.filter((p) => p.type === "tool-call")).toHaveLength(8);
    const error = chunks.find((p) => p.type === "error");
    expect(
      error?.type === "error" ? normalizeAiError(error.error).kind : null,
    ).toBe("watchdog");
    expect(states.mock.calls[states.mock.calls.length - 1]?.[0]).toMatchObject({
      state: "incomplete",
      watchdog: { reason: "repeated_tool_call" },
    });
  });
  it("allows different arguments up to the unchanged SDK step ceiling", async () => {
    fixture.changing = true;
    const { chunks } = await run();
    expect(fixture.execute).toHaveBeenCalledTimes(24);
    expect(chunks.some((p) => p.type === "error")).toBe(false);
  });
  it("does not bypass approval or execute an unapproved call", async () => {
    fixture.approval = true;
    const { chunks } = await run();
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(chunks.some((p) => p.type === "tool-approval-request")).toBe(true);
    expect(chunks.some((p) => p.type === "error")).toBe(false);
  });
});
