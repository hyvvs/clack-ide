import type { Chat, UIMessage } from "@ai-sdk/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../store/chatRuntime", () => ({
  sendMessageToSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./attachmentStore", async (importOriginal) => {
  const original = await importOriginal<typeof import("./attachmentStore")>();
  return {
    ...original,
    storeAttachmentContent: vi.fn(async (bytes: Uint8Array) => ({
      id: "b".repeat(64),
      contentHash: "b".repeat(64),
      byteSize: bytes.byteLength,
    })),
  };
});

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
  applyPeerTaskChangeSet,
  cancelPeerTask,
  dispatchPeerTask,
  requestPeerTask,
} from "./peerTaskCoordinator";
import {
  PEER_TASK_MAX_ACTIVE,
  PEER_TASK_MAX_HOPS,
  PEER_TASK_MAX_PER_ROOT,
  PEER_TASK_SCHEMA_VERSION,
  recoverInterruptedPeerTasks,
  type PeerTask,
  type PeerTaskArtifact,
} from "./peerTasks";
import { chats, useChatStore } from "../store/chatStore";
import { sendMessageToSession } from "../store/chatRuntime";
import { usePeerTaskStore } from "../store/peerTaskStore";
import { native } from "./native";
import { clearWorkspaceWriteLeasesForTests } from "./workspaceWriteLease";
import type { AttachmentMessageReference } from "./attachmentMessages";

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
  usePeerTaskStore.setState({
    hydrated: true,
    recoveryReady: true,
    recoveryError: null,
    tasks: [],
  });
  useChatStore.setState({
    activeSessionId: SOURCE,
    sessionsHydrated: true,
    sessions: [
      session(SOURCE, "agent-a", "model-a"),
      session(TARGET, "agent-b", "model-b"),
    ],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  clearWorkspaceWriteLeasesForTests();
  chats.clear();
  usePeerTaskStore.setState({
    hydrated: false,
    recoveryReady: false,
    recoveryError: null,
    tasks: [],
  });
  useChatStore.setState({
    activeSessionId: null,
    sessionsHydrated: false,
    sessions: [],
  });
});

describe("peer task coordination", () => {
  it("rejects new peer work until startup recovery is ready", async () => {
    usePeerTaskStore.setState({ recoveryReady: false });

    await expect(
      requestPeerTask({
        sourceSessionId: SOURCE,
        targetSessionId: TARGET,
        kind: "review",
        prompt: "Review after recovery.",
      }),
    ).resolves.toMatchObject({ ok: false, code: "peer_recovery_pending" });
    expect(usePeerTaskStore.getState().tasks).toEqual([]);
    expect(sendMessageToSession).not.toHaveBeenCalled();
  });

  it("does not claim queued work before session and artifact recovery finish", async () => {
    const queued = task({ id: "queued-before-recovery", status: "queued" });
    usePeerTaskStore.setState({ recoveryReady: false, tasks: [queued] });

    await dispatchPeerTask(queued.id);

    expect(usePeerTaskStore.getState().tasks[0]?.status).toBe("queued");
    expect(sendMessageToSession).not.toHaveBeenCalled();
  });

  it("runs a task under the target identity and records visible provenance", async () => {
    const result = await requestPeerTask({
      sourceSessionId: SOURCE,
      targetSessionId: TARGET,
      kind: "review",
      prompt: "Review the parser changes.",
      attachmentReferences: [attachmentReference("src/parser.ts")],
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
    expect(sendMessageToSession).toHaveBeenCalledWith(
      TARGET,
      expect.any(Object),
      expect.objectContaining({ peerTaskId: result.task.id }),
    );
    expect(useChatStore.getState().activeSessionId).toBe(SOURCE);
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

  it("waits for prerequisites, then dispatches through the existing target path", async () => {
    const root = task({
      id: "root",
      rootTaskId: "root",
      targetSessionId: SOURCE,
      status: "running",
    });
    const prerequisite = task({
      id: "investigation",
      rootTaskId: root.id,
      parentTaskId: root.id,
      targetSessionId: "investigator-chat",
      status: "running",
    });
    usePeerTaskStore.setState({ tasks: [prerequisite, root] });
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

    const requested = await requestPeerTask({
      sourceSessionId: SOURCE,
      targetSessionId: TARGET,
      kind: "review",
      prompt: "Integrate the completed investigation.",
      dependsOn: [prerequisite.id],
      attachmentReferences: [attachmentReference("spec.md")],
    });

    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    expect(requested.task).toMatchObject({
      status: "waiting",
      rootTaskId: root.id,
      dependsOn: [prerequisite.id],
    });
    expect(requested.task.artifactRefs).toHaveLength(1);
    expect(sendMessageToSession).not.toHaveBeenCalled();

    usePeerTaskStore.getState().complete(prerequisite.id, {
      summary: "Investigation complete.",
      targetSessionId: prerequisite.targetSessionId,
      targetAgentId: prerequisite.targetAgentId,
      targetModelId: prerequisite.targetModelId,
      completedAt: 10,
      artifacts: [],
    });
    expect(
      usePeerTaskStore
        .getState()
        .tasks.find((item) => item.id === requested.task.id),
    ).toMatchObject({
      status: "queued",
      dependenciesSatisfiedAt: expect.any(Number),
    });

    await dispatchPeerTask(requested.task.id);

    expect(sendMessageToSession).toHaveBeenCalledWith(
      TARGET,
      expect.objectContaining({ role: "user" }),
      expect.objectContaining({ peerTaskId: requested.task.id }),
    );
    expect(
      JSON.stringify(vi.mocked(sendMessageToSession).mock.calls),
    ).toContain(prerequisite.id);
  });

  it("delivers only relevant prerequisite aggregates without auto-attaching returned files", async () => {
    const root = task({
      id: "root",
      rootTaskId: "root",
      targetSessionId: SOURCE,
      status: "running",
    });
    const returnedArtifact = peerArtifact("review.md", "returned-review");
    const prerequisite = task({
      id: "prerequisite",
      rootTaskId: root.id,
      parentTaskId: root.id,
      targetSessionId: "reviewer-chat",
      status: "completed",
      result: {
        summary: "RELEVANT REVIEW RESULT",
        targetSessionId: "reviewer-chat",
        targetAgentId: "reviewer",
        targetModelId: "review-model",
        completedAt: 10,
        artifacts: [returnedArtifact],
      },
    });
    const unrelated = task({
      id: "unrelated",
      rootTaskId: root.id,
      parentTaskId: root.id,
      targetSessionId: "unrelated-chat",
      status: "completed",
      result: {
        summary: "UNRELATED PRIVATE RESULT",
        targetSessionId: "unrelated-chat",
        targetAgentId: "other",
        targetModelId: "other-model",
        completedAt: 11,
        artifacts: [],
      },
    });
    usePeerTaskStore.setState({ tasks: [unrelated, prerequisite, root] });
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

    const requested = await requestPeerTask({
      sourceSessionId: SOURCE,
      targetSessionId: TARGET,
      kind: "review",
      prompt: "Integrate the relevant review.",
      dependsOn: [prerequisite.id],
    });

    expect(requested.ok).toBe(true);
    const sentMessage = vi.mocked(sendMessageToSession).mock.calls[0]?.[1];
    expect(sentMessage?.parts).toHaveLength(1);
    const sentText = JSON.stringify(sentMessage);
    expect(sentText).toContain("RELEVANT REVIEW RESULT");
    expect(sentText).toContain("review.md");
    expect(sentText).toContain(returnedArtifact.contentRef.id);
    expect(sentText).not.toContain("UNRELATED PRIVATE RESULT");
  });

  it("keeps explicitly selected artifacts on the established model-input path", async () => {
    const root = task({
      id: "root",
      rootTaskId: "root",
      targetSessionId: SOURCE,
      status: "running",
    });
    const prerequisite = task({
      id: "prerequisite",
      rootTaskId: root.id,
      parentTaskId: root.id,
      status: "completed",
      result: {
        summary: "Dependency result",
        targetSessionId: "reviewer-chat",
        targetAgentId: "reviewer",
        targetModelId: "review-model",
        completedAt: 10,
        artifacts: [peerArtifact("not-selected.png", "returned-image")],
      },
    });
    usePeerTaskStore.setState({ tasks: [prerequisite, root] });
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

    const requested = await requestPeerTask({
      sourceSessionId: SOURCE,
      targetSessionId: TARGET,
      kind: "review",
      prompt: "Integrate with the selected specification.",
      dependsOn: [prerequisite.id],
      attachmentReferences: [attachmentReference("selected-spec.md")],
    });

    expect(requested.ok).toBe(true);
    const sentMessage = vi.mocked(sendMessageToSession).mock.calls[0]?.[1];
    expect(sentMessage?.parts).toHaveLength(2);
    expect(JSON.stringify(sentMessage?.parts?.[0])).toContain(
      "not-selected.png",
    );
    expect(JSON.stringify(sentMessage?.parts?.[1])).toContain(
      "selected-spec.md",
    );
    expect(JSON.stringify(sentMessage?.parts?.[1])).not.toContain(
      "not-selected.png",
    );
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
      attachmentReferences: [attachmentReference("src/explicit.ts")],
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(usePeerTaskStore.getState().tasks)).not.toContain(
      "UNRELATED SECRET TRANSCRIPT",
    );
    expect(
      JSON.stringify(vi.mocked(sendMessageToSession).mock.calls),
    ).toContain("src/explicit.ts");
    expect(
      JSON.stringify(vi.mocked(sendMessageToSession).mock.calls),
    ).not.toContain("UNRELATED SECRET TRANSCRIPT");
  });

  it("delivers the original immutable reference after a queued source changes", async () => {
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((item) =>
        item.id === TARGET
          ? { ...item, run: { state: "running", startedAt: 10 } }
          : item,
      ),
    }));
    const reference = attachmentReference("src/queued.ts");
    const result = await requestPeerTask({
      sourceSessionId: SOURCE,
      targetSessionId: TARGET,
      kind: "review",
      prompt: "Review the queued snapshot.",
      attachmentReferences: [reference],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    reference.contentId = "c".repeat(64);
    reference.contentHash = reference.contentId;
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((item) =>
        item.id === TARGET ? { ...item, run: undefined } : item,
      ),
    }));

    await dispatchPeerTask(result.task.id);

    const sent = JSON.stringify(vi.mocked(sendMessageToSession).mock.calls);
    expect(sent).toContain("a".repeat(64));
    expect(sent).not.toContain("c".repeat(64));
  });

  it.each([
    [
      "Stored attachment content is unavailable",
      "peer_artifact_content_missing",
    ],
    [
      "Stored attachment content failed integrity validation",
      "peer_artifact_integrity_failed",
    ],
    [
      "The selected model does not support image input",
      "peer_artifact_capability_blocked",
    ],
  ])("fails artifact delivery closed for %s", async (message, code) => {
    vi.mocked(sendMessageToSession).mockRejectedValueOnce(new Error(message));
    const result = await requestPeerTask({
      sourceSessionId: SOURCE,
      targetSessionId: TARGET,
      kind: "review",
      prompt: `Failure case ${code}`,
      attachmentReferences: [attachmentReference("src/failure.ts")],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task).toMatchObject({
      status: "failed",
      error: { code },
    });
  });

  it("uses artifact hashes when detecting repeated peer work", async () => {
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((item) =>
        item.id === TARGET
          ? { ...item, run: { state: "running", startedAt: 10 } }
          : item,
      ),
    }));
    const first = await requestPeerTask({
      sourceSessionId: SOURCE,
      targetSessionId: TARGET,
      kind: "review",
      prompt: "Compare this exact input.",
      attachmentReferences: [attachmentReference("one.ts", "a")],
    });
    const different = await requestPeerTask({
      sourceSessionId: SOURCE,
      targetSessionId: TARGET,
      kind: "review",
      prompt: "Compare this exact input.",
      attachmentReferences: [attachmentReference("two.ts", "c")],
    });
    const repeated = await requestPeerTask({
      sourceSessionId: SOURCE,
      targetSessionId: TARGET,
      kind: "review",
      prompt: "Compare this exact input.",
      attachmentReferences: [attachmentReference("one.ts", "a")],
    });

    expect(first.ok).toBe(true);
    expect(different.ok).toBe(true);
    expect(repeated).toMatchObject({ ok: false, code: "peer_task_repeated" });
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
    expect(mismatch).toMatchObject({
      ok: false,
      code: "peer_workspace_mismatch",
    });

    useChatStore.setState({
      sessions: [
        session(SOURCE, "agent-a", "model-a"),
        session(TARGET, "agent-b", "model-b"),
      ],
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
    const root = task({
      id: "root",
      rootTaskId: "root",
      hopCount: PEER_TASK_MAX_HOPS,
    });
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
    const unrelatedStop = vi.fn().mockResolvedValue(undefined);
    chats.set(TARGET, { stop, messages: [] } as unknown as Chat<UIMessage>);
    chats.set("unrelated", {
      stop: unrelatedStop,
      messages: [],
    } as unknown as Chat<UIMessage>);
    const running = task({
      id: "running",
      status: "running",
      targetSessionId: TARGET,
    });
    usePeerTaskStore.setState({ tasks: [running] });
    useChatStore.setState((state) => ({
      sessions: [
        ...state.sessions.map((item) =>
          item.id === TARGET
            ? {
                ...item,
                run: {
                  state: "running" as const,
                  startedAt: 2,
                  peerTaskId: running.id,
                },
              }
            : item,
        ),
        {
          ...session("unrelated", "agent-c", "model-c"),
          run: { state: "running" as const, startedAt: 3 },
        },
      ],
    }));

    await cancelPeerTask(running.id);

    expect(stop).toHaveBeenCalledOnce();
    expect(unrelatedStop).not.toHaveBeenCalled();
    expect(
      useChatStore.getState().sessions.find((item) => item.id === "unrelated")
        ?.run?.state,
    ).toBe("running");
    expect(usePeerTaskStore.getState().tasks[0].status).toBe("cancelled");
  });

  it("cancels running descendants through their existing session stop paths", async () => {
    const childSessionId = "chat-child";
    const parentStop = vi.fn().mockResolvedValue(undefined);
    const childStop = vi.fn().mockResolvedValue(undefined);
    chats.set(TARGET, {
      stop: parentStop,
      messages: [],
    } as unknown as Chat<UIMessage>);
    chats.set(childSessionId, {
      stop: childStop,
      messages: [],
    } as unknown as Chat<UIMessage>);
    const root = task({
      id: "root",
      rootTaskId: "root",
      status: "running",
      targetSessionId: TARGET,
    });
    const child = task({
      id: "child",
      rootTaskId: root.id,
      parentTaskId: root.id,
      hopCount: 1,
      status: "running",
      targetSessionId: childSessionId,
    });
    usePeerTaskStore.setState({ tasks: [root, child] });
    useChatStore.setState((state) => ({
      sessions: [
        ...state.sessions.map((item) =>
          item.id === TARGET
            ? {
                ...item,
                run: {
                  state: "running" as const,
                  startedAt: 2,
                  peerTaskId: root.id,
                },
              }
            : item,
        ),
        {
          ...session(childSessionId, "agent-c", "model-c"),
          run: {
            state: "running" as const,
            startedAt: 3,
            peerTaskId: child.id,
          },
        },
      ],
    }));

    const result = await cancelPeerTask(root.id, {
      actor: "user",
      cascade: true,
    });

    expect(result).toMatchObject({
      ok: true,
      cancelledDescendantCount: 1,
      cancelledTaskIds: [root.id, child.id],
    });
    expect(parentStop).toHaveBeenCalledOnce();
    expect(childStop).toHaveBeenCalledOnce();
    expect(usePeerTaskStore.getState().tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: root.id, status: "cancelled" }),
        expect.objectContaining({
          id: child.id,
          status: "cancelled",
          cancellation: {
            actor: "user",
            cause: "orchestration",
            requestedTaskId: root.id,
            cancelledByTaskId: root.id,
            reason: "Cancelled by user.",
            cancelledAt: expect.any(Number),
            cancelledDescendantCount: undefined,
          },
        }),
      ]),
    );
  });

  it("can cancel only a parent while its running child continues", async () => {
    const childSessionId = "chat-child";
    const parentStop = vi.fn().mockResolvedValue(undefined);
    const childStop = vi.fn().mockResolvedValue(undefined);
    chats.set(TARGET, {
      stop: parentStop,
      messages: [],
    } as unknown as Chat<UIMessage>);
    chats.set(childSessionId, {
      stop: childStop,
      messages: [],
    } as unknown as Chat<UIMessage>);
    const root = task({
      id: "root",
      rootTaskId: "root",
      status: "running",
    });
    const child = task({
      id: "child",
      rootTaskId: root.id,
      parentTaskId: root.id,
      hopCount: 1,
      status: "running",
      targetSessionId: childSessionId,
    });
    usePeerTaskStore.setState({ tasks: [root, child] });
    useChatStore.setState((state) => ({
      sessions: [
        ...state.sessions.map((item) =>
          item.id === TARGET
            ? {
                ...item,
                run: {
                  state: "running" as const,
                  startedAt: 2,
                  peerTaskId: root.id,
                },
              }
            : item,
        ),
        {
          ...session(childSessionId, "agent-c", "model-c"),
          run: {
            state: "running" as const,
            startedAt: 3,
            peerTaskId: child.id,
          },
        },
      ],
    }));

    await cancelPeerTask(root.id, { actor: "user", cascade: false });

    expect(parentStop).toHaveBeenCalledOnce();
    expect(childStop).not.toHaveBeenCalled();
    expect(
      usePeerTaskStore.getState().tasks.find((item) => item.id === child.id)
        ?.status,
    ).toBe("running");
  });

  it("preserves a cancelled isolated worktree for explicit recovery", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    chats.set(TARGET, { stop, messages: [] } as unknown as Chat<UIMessage>);
    const remove = vi
      .spyOn(native, "gitAgentWorktreeRemove")
      .mockResolvedValue(undefined);
    const isolated = task({
      id: "isolated",
      rootTaskId: "isolated",
      status: "running",
      executionMode: "isolated-worktree",
      worktree: { checkoutRoot: "C:/tmp/clack-peer", baseSha: "abc" },
    });
    usePeerTaskStore.setState({ tasks: [isolated] });
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((item) =>
        item.id === TARGET
          ? {
              ...item,
              run: {
                state: "running" as const,
                startedAt: 2,
                peerTaskId: isolated.id,
              },
            }
          : item,
      ),
    }));

    await cancelPeerTask(isolated.id);

    expect(remove).not.toHaveBeenCalled();
    expect(usePeerTaskStore.getState().tasks[0]).toMatchObject({
      status: "cancelled",
      worktree: { checkoutRoot: "C:/tmp/clack-peer", baseSha: "abc" },
    });
  });

  it("keeps each collaboration root within its task ceiling", async () => {
    const rootTasks = Array.from(
      { length: PEER_TASK_MAX_PER_ROOT },
      (_, index) =>
        task({
          id: index === 0 ? "root" : `child-${index}`,
          rootTaskId: "root",
          parentTaskId: index === 0 ? null : "root",
          status: "completed",
        }),
    );
    usePeerTaskStore.setState({ tasks: rootTasks });
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((item) =>
        item.id === SOURCE
          ? {
              ...item,
              run: { state: "running", startedAt: 1, peerTaskId: "root" },
            }
          : item,
      ),
    }));

    await expect(
      requestPeerTask({
        sourceSessionId: SOURCE,
        targetSessionId: TARGET,
        kind: "question",
        prompt: "Add one more task.",
      }),
    ).resolves.toMatchObject({ ok: false, code: "peer_task_limit" });
  });

  it("bounds waiting, queued, and running work before another billed task", async () => {
    usePeerTaskStore.setState({
      tasks: Array.from({ length: PEER_TASK_MAX_ACTIVE }, (_, index) =>
        task({
          id: `active-${index}`,
          rootTaskId: `active-${index}`,
          status:
            index % 3 === 0
              ? "waiting"
              : index % 3 === 1
                ? "queued"
                : "running",
        }),
      ),
    });

    await expect(
      requestPeerTask({
        sourceSessionId: SOURCE,
        targetSessionId: TARGET,
        kind: "question",
        prompt: "Start one more task.",
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "peer_active_task_limit",
    });
    expect(sendMessageToSession).not.toHaveBeenCalled();
  });

  it("captures isolated Git changes as a reviewable patch", async () => {
    vi.spyOn(native, "gitResolveRepo").mockResolvedValue({
      repoRoot: "C:/workspace",
      branch: "main",
      upstream: null,
      isDetached: false,
    });
    vi.spyOn(native, "gitAgentWorktreeCreate").mockResolvedValue({
      checkoutRoot: "C:/cache/agent-worktrees/task",
      baseSha: "0123456789abcdef0123456789abcdef01234567",
    });
    vi.spyOn(native, "gitAgentWorktreeCapture").mockResolvedValue({
      patch: "diff --git a/src/a.ts b/src/a.ts\n",
      changedPaths: ["src/a.ts"],
    });
    const apply = vi.spyOn(native, "gitAgentPatchApply").mockResolvedValue();

    const result = await requestPeerTask({
      sourceSessionId: SOURCE,
      targetSessionId: TARGET,
      kind: "delegate",
      executionMode: "isolated-worktree",
      prompt: "Implement the bounded change.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task).toMatchObject({
      status: "completed",
      executionMode: "isolated-worktree",
      changeSet: {
        changedPaths: ["src/a.ts"],
        baseSha: "0123456789abcdef0123456789abcdef01234567",
      },
      result: {
        artifacts: [
          expect.objectContaining({
            displayName: "Peer changes.patch",
            originType: "diff",
          }),
        ],
      },
    });
    expect(sendMessageToSession).toHaveBeenCalledWith(
      TARGET,
      expect.any(Object),
      expect.objectContaining({
        mutationMode: "isolated-worktree",
        checkoutRoot: "C:/cache/agent-worktrees/task",
      }),
    );

    await expect(applyPeerTaskChangeSet(result.task.id)).resolves.toEqual({
      ok: true,
    });
    expect(apply).toHaveBeenCalledWith(
      "C:/workspace",
      "0123456789abcdef0123456789abcdef01234567",
      "diff --git a/src/a.ts b/src/a.ts\n",
    );
    expect(usePeerTaskStore.getState().tasks[0].changeSet?.appliedAt).toEqual(
      expect.any(Number),
    );
  });

  it("keeps a conflicting patch unapplied with a visible error", async () => {
    const isolated = task({
      status: "completed",
      executionMode: "isolated-worktree",
      changeSet: {
        baseSha: "0123456789abcdef0123456789abcdef01234567",
        patch: "diff --git a/src/a.ts b/src/a.ts\n",
        changedPaths: ["src/a.ts"],
      },
    });
    usePeerTaskStore.setState({ tasks: [isolated] });
    vi.spyOn(native, "gitAgentPatchApply").mockRejectedValue(
      new Error("agent patch base is stale"),
    );

    await expect(applyPeerTaskChangeSet(isolated.id)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("stale"),
    });
    const changeSet = usePeerTaskStore.getState().tasks[0].changeSet;
    expect(changeSet?.appliedAt).toBeUndefined();
    expect(changeSet?.applyError).toContain("stale");
  });
});

describe("peer task persistence recovery", () => {
  it("marks an in-flight task failed instead of replaying billed work", () => {
    const recovered = recoverInterruptedPeerTasks(
      [task({ status: "running" }), task({ id: "queued", status: "queued" })],
      99,
    );
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
    workspaceEnvironment: { kind: "local" },
    kind: "review",
    executionMode: "read-only",
    prompt: "Review",
    artifactRefs: [],
    parentTaskId: null,
    rootTaskId: "task",
    hopCount: 0,
    dependsOn: [],
    status: "queued",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function peerArtifact(displayName: string, suffix: string): PeerTaskArtifact {
  const hash = suffix.length.toString().slice(-1).repeat(64);
  return {
    id: `artifact-${suffix}`,
    attachmentId: `attachment-${suffix}`,
    contentRef: { id: hash, contentHash: hash, byteSize: 10 },
    displayName,
    mediaType: displayName.endsWith(".png") ? "image/png" : "text/markdown",
    contentKind: displayName.endsWith(".png") ? "image" : "text",
    byteSize: 10,
    sourceSessionId: "reviewer-chat",
    sourceTaskId: "prerequisite",
    sourceAgentId: "reviewer",
    sourceModelId: "review-model",
    workspaceId: "local:c:/workspace",
    workspaceRoot: "C:/workspace",
    createdAt: 10,
    originType: "generated-file",
    accessPolicy: "model-input",
  };
}

function attachmentReference(
  displayName: string,
  hashLetter = "a",
): AttachmentMessageReference {
  const hash = hashLetter.repeat(64);
  return {
    attachmentId: `attachment-${displayName}`,
    contentId: hash,
    contentHash: hash,
    displayName,
    mediaType: "text/typescript",
    byteSize: 10,
    contentKind: "text",
  };
}
