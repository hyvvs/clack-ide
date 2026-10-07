import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import {
  answerParts,
  readAnswer,
  type AnswerState,
} from "@/modules/ai/lib/answerContinuation";
const { disk, invoke } = vi.hoisted(() => {
  const disk = new Map<string, unknown>();
  return {
    disk,
    invoke: vi.fn(
      async (command: string, args: { key: string; value?: unknown }) => {
        if (command === "conversation_source_set") {
          disk.set(args.key, JSON.parse(JSON.stringify(args.value)));
          return;
        }
        if (command === "conversation_session_get")
          return structuredClone(disk.get(args.key) ?? null);
        throw new Error(`Unexpected IPC ${command}`);
      },
    ),
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { saveMessages, loadMessages } from "@/modules/ai/lib/sessions";
const answer: AnswerState = {
  version: 1,
  runId: "chat:1",
  state: "complete",
  continuations: 1,
  repairs: 0,
  segments: [
    {
      id: "first",
      previous: null,
      provider: "compatible",
      model: "captured",
      startedAt: 1,
      endedAt: 2,
      finish: "length",
      inputTokens: 20,
      outputTokens: 10,
      pending: [],
    },
    {
      id: "second",
      previous: "first",
      provider: "compatible",
      model: "captured",
      startedAt: 3,
      endedAt: 4,
      finish: "stop",
      inputTokens: 30,
      outputTokens: 10,
      pending: [],
    },
  ],
};
const message: UIMessage = {
  id: "response",
  role: "assistant",
  parts: [
    {
      type: "text",
      text: "```ts\nconst x = ",
      providerMetadata: { clackAnswer: { segmentId: "first" } },
    },
    {
      type: "text",
      text: "1;\n```",
      providerMetadata: { clackAnswer: { segmentId: "second" } },
    },
    {
      type: "tool-read_file",
      toolCallId: "completed",
      state: "output-available",
      input: { path: "a" },
      output: "Immutable evidence",
    },
  ],
  metadata: { clackAnswer: answer, retainedMetadata: "unchanged" },
};
describe("D2 through existing session persistence and recovery IPC", () => {
  it("restores ordered segments, original parts and tool results without another store or effect replay", async () => {
    const before = JSON.stringify(message);
    await saveMessages("complete", [message]);
    const loaded = await loadMessages("complete");
    expect(loaded).toEqual([message]);
    if (!loaded) throw new Error("The saved session did not load.");
    expect(answerParts(loaded[0])).toMatchObject([
      { type: "text", text: "```ts\nconst x = 1;\n```" },
      { type: "tool-read_file", toolCallId: "completed" },
    ]);
    expect(JSON.stringify(message)).toBe(before);
    expect([...disk.keys()]).toContain("messages:complete");
    expect(
      invoke.mock.calls.every(([command]) =>
        ["conversation_source_set", "conversation_session_get"].includes(
          command,
        ),
      ),
    ).toBe(true);
  });
  it("unfinished restart stays truthful and loading twice never writes or infers", async () => {
    const interrupted = {
      ...message,
      metadata: {
        ...(message.metadata as object),
        clackAnswer: { ...answer, state: "preparing" },
      },
    };
    await saveMessages("interrupted", [interrupted]);
    invoke.mockClear();
    const first = await loadMessages("interrupted"),
      second = await loadMessages("interrupted");
    expect(second).toEqual(first);
    if (!first) throw new Error("The interrupted session did not load.");
    expect(readAnswer(first[0])?.state).toBe("incomplete");
    expect(first[0].parts).toEqual(message.parts);
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "conversation_session_get",
      "conversation_session_get",
    ]);
    expect((disk.get("messages:interrupted") as UIMessage[])[0]).toEqual(
      interrupted,
    );
  });
});
