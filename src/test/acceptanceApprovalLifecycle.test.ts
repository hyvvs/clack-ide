import { afterEach, describe, expect, it, vi } from "vitest";
import { Chat, type UIMessage } from "@ai-sdk/react";
import {
  convertToModelMessages,
  streamText,
  tool,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { pendingApprovalsForRun } from "@/modules/ai/components/AgentRunBridge";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { recoverInterruptedSessions } from "@/modules/ai/lib/sessions";
import {
  AcceptanceApprovalBlocked,
  observeAcceptanceRun,
  type AcceptanceSnapshot,
} from "@/test/acceptanceApprovalLifecycle";

const expected = {
  sessionId: "real-mission-a",
  runId: "real-mission-a:1",
  workspaceRoot: "/scratch",
};
const approval = {
  id: "approval",
  toolCallId: "call",
  toolName: "bash_run",
  input: { command: "probe" },
};
const decision = {
  approved: true,
  reason: "safe exact effect",
  targets: ["/scratch/test.txt"],
};
function fixture() {
  const snapshot: AcceptanceSnapshot = {
    ...expected,
    cwd: expected.workspaceRoot,
    state: "running",
    active: false,
    responderReady: true,
    approvals: [structuredClone(approval)],
    effects: [],
  };
  const emit = vi.fn();
  const respond = vi.fn(() => {
    snapshot.approvals = [];
    snapshot.effects = [
      { toolCallId: "call", state: "output-available", output: { ok: true } },
    ];
  });
  return {
    snapshot,
    options: {
      expected,
      read: () => snapshot,
      evaluate: vi.fn(async () => decision),
      respond,
      emit,
      sleep: async () => {},
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
  useChatStore.setState({
    approvalRespondersBySession: {},
    pendingApprovalsBySession: {},
  });
});

describe("nonterminal live acceptance approval", () => {
  it("holds the host phase open until per-effect evaluation resolves, then observes one effect", async () => {
    const f = fixture();
    let release!: (d: typeof decision) => void;
    f.options.evaluate.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let finished = false;
    const run = observeAcceptanceRun(f.options).then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(f.options.respond).not.toHaveBeenCalled();
    release(decision);
    await run;
    expect(f.options.respond).toHaveBeenCalledExactlyOnceWith(
      "approval",
      "real-mission-a",
    );
    expect(
      f.options.emit.mock.calls.some(([e]) => e.kind === "approval-effect"),
    ).toBe(true);
  });
  it("refuses an unsafe escaping effect and ends without executing it", async () => {
    const f = fixture();
    f.options.evaluate.mockResolvedValue({
      approved: false,
      reason: "target escapes workspace",
      targets: ["/outside"],
    });
    await expect(observeAcceptanceRun(f.options)).rejects.toThrow(
      "target escapes",
    );
    expect(f.options.respond).not.toHaveBeenCalled();
  });
  it.each([
    "sessionId",
    "runId",
    "workspaceRoot",
  ] as const)("rejects another %s before approval", async (key) => {
    const f = fixture();
    f.snapshot[key] = "other";
    await expect(observeAcceptanceRun(f.options)).rejects.toThrow(
      "session/run/workspace changed",
    );
    expect(f.options.respond).not.toHaveBeenCalled();
  });
  it("rejects a stale evaluation after the run changes", async () => {
    const f = fixture();
    f.options.evaluate.mockImplementation(async () => {
      f.snapshot.runId = "new";
      return decision;
    });
    await expect(observeAcceptanceRun(f.options)).rejects.toThrow(
      "changed during safety",
    );
    expect(f.options.respond).not.toHaveBeenCalled();
  });
  it("rejects in-place input mutation while the evaluator is preparing a decision", async () => {
    const f = fixture();
    f.options.evaluate.mockImplementation(async () => {
      f.snapshot.approvals[0].input.command = "changed effect";
      return decision;
    });
    await expect(observeAcceptanceRun(f.options)).rejects.toThrow(
      "changed during safety",
    );
    expect(f.options.respond).not.toHaveBeenCalled();
  });
  it("rejects replay of a tool call under a new approval ID", async () => {
    const f = fixture();
    f.options.respond.mockImplementation(() => {
      f.snapshot.approvals = [
        { ...structuredClone(approval), id: "another-approval" },
      ];
    });
    await expect(observeAcceptanceRun(f.options)).rejects.toThrow(
      "Tool call reused",
    );
    expect(f.options.respond).toHaveBeenCalledOnce();
  });
  it("does not submit twice while the SDK/bridge still displays a pending approval", async () => {
    const f = fixture();
    f.options.respond.mockImplementation(() => {});
    let polls = 0;
    f.options.sleep = async () => {
      if (++polls === 3) {
        f.snapshot.approvals = [];
        f.snapshot.effects = [
          { toolCallId: "call", state: "output-available" },
        ];
      }
    };
    await observeAcceptanceRun(f.options);
    expect(f.options.respond).toHaveBeenCalledOnce();
    expect(f.options.evaluate).toHaveBeenCalledOnce();
  });
  it("bounds a missing responder without restoring it or sending a message", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.snapshot.responderReady = false;
    f.options.sleep = () => new Promise((resolve) => setTimeout(resolve, 10));
    const result = observeAcceptanceRun({ ...f.options, timeoutMs: 20 });
    const assertion = expect(result).rejects.toThrow("lifecycle timed out");
    await vi.advanceTimersByTimeAsync(30);
    await assertion;
    expect(f.options.respond).not.toHaveBeenCalled();
  });
  it("bounds an evaluator that never returns and aborts it", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let signal: AbortSignal | undefined;
    const result = observeAcceptanceRun({
      ...f.options,
      timeoutMs: 20,
      evaluate: async (_subject, s) => {
        signal = s;
        return new Promise(() => {});
      },
    });
    const assertion = expect(result).rejects.toThrow("evaluation timed out");
    await vi.advanceTimersByTimeAsync(30);
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(f.options.respond).not.toHaveBeenCalled();
  });
  it("keeps production restart recovery and approval no-revival unchanged", () => {
    const run = recoverInterruptedSessions([
      {
        id: "chat",
        title: "chat",
        createdAt: 1,
        updatedAt: 1,
        run: { state: "running", startedAt: 1 },
      },
    ]).sessions[0].run;
    expect(run?.state).toBe("interrupted");
    expect(
      pendingApprovalsForRun(
        [
          {
            id: "a",
            role: "assistant",
            parts: [
              {
                type: "tool-bash_run",
                state: "approval-requested",
                approval: { id: "a" },
                input: {},
              },
            ],
          },
        ] as unknown as UIMessage[],
        "chat",
        run?.state,
      ),
    ).toEqual([]);
  });
  it("resumes the actual SDK chat through the production responder with one execution and no new user message", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    let calls = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream({
          start(c) {
            if (calls++ === 0)
              c.enqueue({
                type: "tool-call",
                toolCallId: "call",
                toolName: "bash_run",
                input: '{"command":"probe"}',
              });
            else {
              c.enqueue({ type: "text-start", id: "text" });
              c.enqueue({ type: "text-delta", id: "text", delta: "Finished" });
              c.enqueue({ type: "text-end", id: "text" });
            }
            c.enqueue({
              type: "finish",
              finishReason: {
                unified: calls === 1 ? "tool-calls" : "stop",
                raw: "stop",
              },
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            });
            c.close();
          },
        }),
      }),
    });
    const tools = {
      bash_run: tool({
        inputSchema: z.object({ command: z.string() }),
        needsApproval: true,
        execute,
      }),
    };
    const chat = new Chat<UIMessage>({
      id: expected.sessionId,
      sendAutomaticallyWhen:
        lastAssistantMessageIsCompleteWithApprovalResponses,
      transport: {
        sendMessages: async ({ messages }) =>
          streamText({
            model,
            tools,
            messages: await convertToModelMessages(messages),
          }).toUIMessageStream({ originalMessages: messages }),
        reconnectToStream: async () => null,
      },
    });
    await chat.sendMessage({ text: "Original specification exactly once" });
    expect(execute).not.toHaveBeenCalled();
    const originalUser = chat.messages.filter((m) => m.role === "user");
    useChatStore
      .getState()
      .setApprovalResponder(expected.sessionId, (id, approved) => {
        void chat.addToolApprovalResponse({ id, approved });
      });
    const respond = vi.fn((id: string, sessionId: string) =>
      useChatStore.getState().respondToApproval(id, true, sessionId),
    );
    await observeAcceptanceRun({
      expected,
      respond,
      evaluate: async () => decision,
      emit: () => {},
      sleep: () => new Promise((resolve) => setTimeout(resolve, 1)),
      read: () => {
        const pending = pendingApprovalsForRun(
          chat.messages,
          expected.sessionId,
          "running",
        );
        useChatStore
          .getState()
          .setPendingApprovals(expected.sessionId, pending);
        const parts = chat.messages.flatMap((m) => m.parts) as Array<{
          type: string;
          toolCallId?: string;
          state?: string;
          input?: Record<string, unknown>;
          output?: unknown;
          approval?: { id: string };
        }>;
        return {
          ...expected,
          cwd: expected.workspaceRoot,
          state: "running",
          active: chat.status === "submitted" || chat.status === "streaming",
          responderReady: true,
          approvals: pending.map((p) => ({
            id: p.id,
            toolName: p.toolName,
            input: p.input,
            toolCallId:
              parts.find((part) => part.approval?.id === p.id)?.toolCallId ??
              "",
          })),
          effects: parts
            .filter((p) => p.toolCallId)
            .map((p) => ({
              toolCallId: p.toolCallId ?? "",
              state: p.state ?? "",
              output: p.output,
            })),
        };
      },
    });
    expect(respond).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(calls).toBe(2);
    expect(chat.messages.filter((m) => m.role === "user")).toEqual(
      originalUser,
    );
    expect(chat.id).toBe(expected.sessionId);
    expect(
      chat.messages.some((m) =>
        m.parts.some((p) => p.type === "text" && p.text === "Finished"),
      ),
    ).toBe(true);
    expect(new AcceptanceApprovalBlocked("stop").classification).toBe(
      "HARNESS-BLOCKED",
    );
  });
});
