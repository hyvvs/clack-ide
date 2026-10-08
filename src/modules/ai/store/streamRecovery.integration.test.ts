import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { streamText } from "ai";
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import {
  withAnswerContinuation,
  readAnswer,
  answerParts,
} from "@/modules/ai/lib/answerContinuation";
import { withProviderRetryTracking } from "@/modules/ai/lib/providerRetry";
import { InferenceTransportError } from "@/modules/ai/lib/inferenceErrors";
import { createRunBudget } from "@/modules/ai/lib/runBudget";
import type { RunAgentOptions } from "@/modules/ai/lib/agent";

const { disk, invoke, runAgentStream, history } = vi.hoisted(() => ({
  disk: new Map<string, unknown>(),
  invoke: vi.fn(),
  runAgentStream: vi.fn(),
  history: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/modules/ai/lib/agent", () => ({ runAgentStream }));
vi.mock("@/modules/ai/lib/customToolExecution", () => ({
  executionHistory: history,
}));
vi.mock("@/modules/settings/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/settings/store")>()),
  setLastUsedAiSelection: vi.fn(),
  setRecentModelIds: vi.fn(),
}));
vi.mock("@/modules/ai/lib/todos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/ai/lib/todos")>()),
  loadTodos: vi.fn(async () => []),
  saveTodos: vi.fn(),
  deleteTodos: vi.fn(),
}));

import {
  useChatStore,
  chats,
  cancelRun,
  seedMessages,
  capturedSelfHostedRuns,
} from "@/modules/ai/store/chatStore";
import {
  getOrCreateChat,
  retryInterruptedRun,
  shouldAutomaticallySendSession,
} from "@/modules/ai/store/chatRuntime";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  loadMessages,
  awaitSessionWrites,
  recoverInterruptedSessions,
} from "@/modules/ai/lib/sessions";

const id = "recovery",
  partial =
    "A unique long preserved ending of more than thirty two characters.";
const finish: LanguageModelV3StreamPart = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
};
const text = (delta: string): LanguageModelV3StreamPart[] => [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta },
  { type: "text-end", id: "t" },
];
let plans: LanguageModelV3StreamPart[][];
let calls = 0;
function run() {
  const current = useChatStore.getState().sessions[0].run;
  if (!current) throw new Error("Expected an existing run");
  return current;
}
beforeEach(() => {
  calls = 0;
  disk.clear();
  chats.clear();
  seedMessages.clear();
  capturedSelfHostedRuns.clear();
  history.mockReset().mockResolvedValue([]);
  invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "conversation_source_set") {
      disk.set(args.key, structuredClone(args.value));
      return;
    }
    if (command === "conversation_session_get")
      return structuredClone(disk.get(args.key) ?? null);
    throw new Error(`Unexpected IPC ${command}`);
  });
  plans = [
    [
      ...text(partial),
      {
        type: "error",
        error: new InferenceTransportError("remote-disconnect"),
      },
    ],
    [...text(`${partial} Finished.`), finish],
  ];
  runAgentStream.mockReset().mockImplementation((opts: RunAgentOptions) => {
    if (!opts.inferenceScope || !opts.modelId) throw new Error("Expected captured request identity");
    const model: LanguageModelV3 = {
      specificationVersion: "v3",
      provider: "fixture",
      modelId: "captured",
      supportedUrls: {},
      doGenerate: vi.fn(),
      doStream: async () => {
        calls++;
        return {
          stream: new ReadableStream<LanguageModelV3StreamPart>({
            start(c) {
              for (const part of plans.shift() ?? []) c.enqueue(part);
              c.close();
            },
          }),
        };
      },
    };
    return streamText({
      model: withAnswerContinuation(
        withProviderRetryTracking(
          model,
          {
            onRetry: opts.onProviderRetry ?? (() => {}),
            onRecovered: opts.onProviderRecovered ?? (() => {}),
          },
          2,
          { delayMs: 0, isCurrent: opts.inferenceScope?.isCurrent },
        ),
        {
          runId: opts.inferenceScope.runId,
          provider: "fixture",
          modelId: opts.modelId,
          isCurrent: opts.inferenceScope.isCurrent,
          signal: opts.abortSignal,
          recovery: opts.recovery,
          previous:
            readAnswer(opts.uiMessages[opts.uiMessages.length - 1]) ??
            undefined,
          limits: async () => ({ asserted: 32768 }),
          onState: opts.onAnswerState,
        },
      ),
      prompt: "Task",
      maxRetries: 0,
      onError: () => {},
      onFinish: () =>
        opts.onFinishMeta?.({
          steps: 1,
          hitStepCap: false,
          finishReason: "stop",
        }),
    });
  });
  useChatStore.setState({
    activeSessionId: id,
    runtimeBySession: {},
    pendingApprovalsBySession: {},
    sessions: [
      {
        id,
        title: "Saved",
        createdAt: 1,
        updatedAt: 1,
        profile: {
          agentId: "builtin:coder",
          modelId: "gpt-5.4-mini",
          workspaceId: null,
          workspaceRoot: null,
        },
        run: {
          startedAt: 1,
          state: "running",
          agentId: "builtin:coder",
          modelId: "gpt-5.4-mini",
          providerId: "openai",
          transportModelId: "gpt-5.4-mini",
          budget: createRunBudget("ask"),
        },
      },
    ],
  });
});
afterEach(async () => {
  vi.useRealTimers();
  await awaitSessionWrites(id);
  chats.clear();
  seedMessages.clear();
  capturedSelfHostedRuns.clear();
  useChatStore.setState({
    sessions: [],
    activeSessionId: null,
    runtimeBySession: {},
  });
});
async function interrupt() {
  const chat = getOrCreateChat(id);
  await chat.sendMessage({ text: "Task" });
  expect(run().state).toBe("interrupted");
  expect(run().error?.errorCode).toBe("remote-disconnect");
  expect(calls).toBe(1);
  return chat;
}
describe("D3 actual Chat, transport, run store and persistence boundary", () => {
  it("user recovery retains transcript identity, captured destination/settings and budget, then projects a single answer", async () => {
    const chat = await interrupt();
    const original = structuredClone(chat.messages);
    const captured = runAgentStream.mock.calls[0][0] as RunAgentOptions;
    const instructions = usePreferencesStore.getState().customInstructions;
    usePreferencesStore.setState({
      customInstructions: "Changed after the interruption",
    });
    try {
      expect(await retryInterruptedRun(id)).toBe(true);
      expect(calls).toBe(2);
      const recovered = runAgentStream.mock.calls[1][0] as RunAgentOptions;
      expect(recovered.modelId).toBe(captured.modelId);
      expect(recovered.keys).toEqual(captured.keys);
      expect(recovered.customInstructions).toBe(captured.customInstructions);
      expect(recovered.reasoning).toEqual(captured.reasoning);
      expect(recovered.recovery).toBe(true);
      expect(run().startedAt).toBe(1);
      expect(run().recoveryAttempts).toBe(1);
      expect(run().budget?.totalSteps).toBeGreaterThan(0);
      expect(chat.messages.map((m) => m.id)).toEqual(original.map((m) => m.id));
      expect(chat.messages[0]).toEqual(original[0]);
      expect(
        chat.messages[1].parts.filter((p) => p.type === "text")[0],
      ).toEqual(original[1].parts.find((p) => p.type === "text"));
      expect(
        answerParts(chat.messages[1]).filter((p) => p.type === "text"),
      ).toMatchObject([{ text: `${partial} Finished.` }]);
      expect(readAnswer(chat.messages[1])?.segments).toHaveLength(2);
      expect(history).toHaveBeenCalledExactlyOnceWith(id);
    } finally {
      usePreferencesStore.setState({ customInstructions: instructions });
    }
  });
  it("restart preserves partial output once and never recreates inference or replays tools", async () => {
    const chat = await interrupt();
    await awaitSessionWrites(id);
    const loaded = await loadMessages(id);
    if (!loaded) throw new Error("Expected durable messages");
    expect(loaded).toEqual(chat.messages);
    expect(shouldAutomaticallySendSession(id, loaded)).toBe(false);
    chats.clear();
    seedMessages.set(id, loaded);
    expect(await retryInterruptedRun(id)).toBe(false);
    expect(getOrCreateChat(id).messages).toEqual(loaded);
    expect(calls).toBe(1);
    expect(
      recoverInterruptedSessions(useChatStore.getState().sessions).sessions,
    ).toEqual(useChatStore.getState().sessions);
  });
  it("MCP unknown effects block recovery before another inference is admitted", async () => {
    await interrupt();
    history.mockResolvedValue([
      { runId: 1, kind: "mcp", state: "interrupted", effect: "unknown" },
    ]);
    expect(await retryInterruptedRun(id)).toBe(false);
    expect(calls).toBe(1);
    expect(run().state).toBe("failed");
    expect(run().error?.message).toContain("reconciliation");
  });
  it("Stop while the native effect ledger is loading is authoritative", async () => {
    await interrupt();
    let resolve: (value: unknown[]) => void = () => {};
    history.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = retryInterruptedRun(id);
    await cancelRun(id);
    resolve([]);
    expect(await pending).toBe(false);
    expect(run().state).toBe("cancelled");
    expect(calls).toBe(1);
  });
  it("changed agent/model/workspace or unavailable ledger fails closed", async () => {
    await interrupt();
    useChatStore.setState((s) => ({
      sessions: s.sessions.map((m) => {
        if (!m.profile) throw new Error("Expected a conversation profile");
        return { ...m, profile: { ...m.profile, agentId: "builtin:reviewer" } };
      }),
    }));
    expect(await retryInterruptedRun(id)).toBe(false);
    expect(calls).toBe(1);
    expect(history).not.toHaveBeenCalled();
  });
  it("unavailable native ledger never authorizes a speculative replay", async () => {
    await interrupt();
    history.mockRejectedValue(new Error("Native ledger unavailable"));
    expect(await retryInterruptedRun(id)).toBe(false);
    expect(calls).toBe(1);
    expect(run().state).toBe("failed");
  });
  it("preparation timeout settles the run and a late ledger cannot restart it", async () => {
    await interrupt();
    vi.useFakeTimers();
    let resolve: (value: unknown[]) => void = () => {};
    history.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = retryInterruptedRun(id);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toBe(false);
    expect(run().error?.errorCode).toBe("preflight-timeout");
    resolve([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(1);
  });
  it("changed durable evidence during preparation prevents recovery", async () => {
    const chat = await interrupt();
    let resolve: (value: unknown[]) => void = () => {};
    history.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = retryInterruptedRun(id);
    chat.messages = [
      ...chat.messages,
      {
        id: "new-user",
        role: "user",
        parts: [{ type: "text", text: "Different request" }],
      },
    ];
    resolve([]);
    expect(await pending).toBe(false);
    expect(calls).toBe(1);
    expect(run().error?.message).toContain("Conversation changed");
  });
});
