import type { Chat, UIMessage } from "@ai-sdk/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../store/chatRuntime", () => ({
  sendMessageToSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./peerTasks", async (importOriginal) => {
  const original = await importOriginal<typeof import("./peerTasks")>();
  return {
    ...original,
    loadPeerTasks: vi.fn().mockResolvedValue([]),
    savePeerTasks: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("./sessions", async (importOriginal) => {
  const original = await importOriginal<typeof import("./sessions")>();
  return {
    ...original,
    saveSessionsList: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("./todos", async (importOriginal) => {
  const original = await importOriginal<typeof import("./todos")>();
  return {
    ...original,
    saveTodos: vi.fn().mockResolvedValue(undefined),
    deleteTodos: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  cancelPeerTask,
  requestPeerTask,
} from "./peerTaskCoordinator";
import {
  PEER_TASK_MAX_HOPS,
  PEER_TASK_SCHEMA_VERSION,
  recoverInterruptedPeerTasks,
  type PeerTask,
} from "./peerTasks";
import { chats, useChatStore } from "../store/chatStore";
import { sendMessageToSession } from "../store/chatRuntime";
import { usePeerTaskStore } from "../store/peerTaskStore";

const SOURCE = "chat-source";
const TARGET = "chat-target";

beforeEach(() => {
  vi.mocked(sendMessageToSession).mockClear();
  chats.clear();
  chats.set(TARGET, {
    messages: [
      {
        id: "answer",
        role: "assistant",
        parts: [{ type: "text", text: "Independent review result" }],
      },
    ],
  } as unknown as Chat<UIMessage>);
  usePeerTaskStore.setState({ hydrated: true, tasks: [] });
  useChatStore.setState({
    activeSessionId: SOURCE,
    sessions: [session(SOURCE, "agent-a", "model-a"), session(TARGET, "agent-b", "model-b")],
  });
});

afterEach(() => {
  chats.clear();
  usePeerTaskStore.setState({ hydrated: false, tasks: [] });
  useChatStore.setState({ activeSessionId: null, sessions: [] });
});

describe("peer task coordination", () => {
  it("runs a task under the target identity and records visible provenance", async () => {
    const result = await requestPeerTask({
      sourceSessionId: SOURCE,
      targetSessionId: TARGET,
      kind: "review",
      prompt: "Review the parser changes.",
      artifactRefs: [{ kind: "file", path: "src/parser.ts" }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task).toMatchObject({
      sourceSessionId: SOURCE,
      targetSessionId: TARGET,
      sourceAgentId: "agent-a",
      targetAgentId: "agent-b",
      targetModelId: "model-b",
      status: "completed",
      result: { summary: "Independent review result" },
    });
  });

  it("queues work for a busy target without mutating its active run", async () => {
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((item) =>
        item.id === TARGET
          ? { ...item, run: { state: "running", startedAt: 10 } }
          : item,
      ),
    }));

    const result = await requestPeerTask({
      sourceSessionId: SOURCE,
      targetSessionId: TARGET,
      kind: "question",
      prompt: "Which invariant matters here?",
    });

    expect(result.ok && result.task.status).toBe("queued");
    expect(
      useChatStore.getState().sessions.find((item) => item.id === TARGET)?.run
        ?.startedAt,
    ).toBe(10);
  });

  it("shares only the explicit prompt and artifact references", async () => {
    chats.set(SOURCE, {
      messages: [
        {
          id: "private-source-message",
          role: "user",
          parts: [{ type: "text", text: "UNRELATED SECRET TRANSCRIPT" }],
        },
      ],
    } as unknown as Chat<UIMessage>);

    const result = await requestPeerTask({
      sourceSessionId: SOURCE,
      targetSessionId: TARGET,
      kind: "delegate",
      prompt: "Inspect the explicit file only.",
      artifactRefs: [{ kind: "file", path: "src/explicit.ts" }],
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(usePeerTaskStore.getState().tasks)).not.toContain(
      "UNRELATED SECRET TRANSCRIPT",
    );
    expect(JSON.stringify(vi.mocked(sendMessageToSession).mock.calls)).toContain(
      "src/explicit.ts",
    );
    expect(JSON.stringify(vi.mocked(sendMessageToSession).mock.calls)).not.toContain(
      "UNRELATED SECRET TRANSCRIPT",
    );
  });

  it("rejects cross-workspace requests and repeated collaboration loops", async () => {
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((item) =>
        item.id === TARGET
          ? {
              ...item,
              profile: {
                agentId: item.profile?.agentId ?? "agent-b",
                modelId: item.profile?.modelId ?? "model-b",
                workspaceId: "local:c:/different",
                workspaceRoot: "C:/different",
              },
            }
          : item,
      ),
    }));
    const mismatch = await requestPeerTask({
      sourceSessionId: SOURCE,
      targetSessionId: TARGET,
      kind: "review",
      prompt: "Review once.",
    });
    expect(mismatch).toMatchObject({ ok: false, code: "peer_workspace_mismatch" });

    useChatStore.setState({
      sessions: [session(SOURCE, "agent-a", "model-a"), session(TARGET, "agent-b", "model-b")],
    });
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((item) =>
        item.id === TARGET
          ? { ...item, run: { state: "running", startedAt: 10 } }
          : item,
      ),
    }));
    await requestPeerTask({
      sourceSessionId: SOURCE,
      targetSessionId: TARGET,
      kind: "review",
      prompt: "Review once.",
    });
    const repeated = await requestPeerTask({
      sourceSessionId: SOURCE,
      targetSessionId: TARGET,
      kind: "review",
      prompt: "Review once.",
    });
    expect(repeated).toMatchObject({ ok: false, code: "peer_task_repeated" });
  });

  it("enforces hop limits and cancels only a task-owned run", async () => {
    const root = task({ id: "root", rootTaskId: "root", hopCount: PEER_TASK_MAX_HOPS });
    usePeerTaskStore.setState({ tasks: [root] });
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((item) =>
        item.id === SOURCE
          ? {
              ...item,
              run: { state: "running", startedAt: 1, peerTaskId: root.id },
            }
          : item,
      ),
    }));
    const limited = await requestPeerTask({
      sourceSessionId: SOURCE,
      targetSessionId: TARGET,
      kind: "question",
      prompt: "Delegate again.",
    });
    expect(limited).toMatchObject({ ok: false, code: "peer_hop_limit" });

    const stop = vi.fn().mockResolvedValue(undefined);
    chats.set(TARGET, { stop, messages: [] } as unknown as Chat<UIMessage>);
    const running = task({ id: "running", status: "running", targetSessionId: TARGET });
    usePeerTaskStore.setState({ tasks: [running] });
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((item) =>
        item.id === TARGET
          ? {
              ...item,
              run: { state: "running", startedAt: 2, peerTaskId: running.id },
            }
          : item,
      ),
    }));

    await cancelPeerTask(running.id);

    expect(stop).toHaveBeenCalledOnce();
    expect(usePeerTaskStore.getState().tasks[0].status).toBe("cancelled");
  });
});

describe("peer task persistence recovery", () => {
  it("marks an in-flight task failed instead of replaying billed work", () => {
    const recovered = recoverInterruptedPeerTasks([
      task({ status: "running" }),
      task({ id: "queued", status: "queued" }),
    ], 99);
    expect(recovered[0]).toMatchObject({
      status: "failed",
      endedAt: 99,
      error: { code: "peer_task_interrupted" },
    });
    expect(recovered[1].status).toBe("queued");
  });
});

function session(id: string, agentId: string, modelId: string) {
  return {
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    profileVersion: 1,
    profile: {
      agentId,
      modelId,
      workspaceId: "local:c:/workspace",
      workspaceRoot: "C:/workspace",
    },
  };
}

function task(overrides: Partial<PeerTask> = {}): PeerTask {
  return {
    schemaVersion: PEER_TASK_SCHEMA_VERSION,
    id: "task",
    sourceSessionId: SOURCE,
    targetSessionId: TARGET,
    sourceAgentId: "agent-a",
    sourceModelId: "model-a",
    targetAgentId: "agent-b",
    targetModelId: "model-b",
    workspaceId: "local:c:/workspace",
    workspaceRoot: "C:/workspace",
    kind: "review",
    prompt: "Review",
    artifactRefs: [],
    parentTaskId: null,
    rootTaskId: "task",
    hopCount: 0,
    status: "queued",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
