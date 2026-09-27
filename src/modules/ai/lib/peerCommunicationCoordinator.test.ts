import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Chat, UIMessage } from "@ai-sdk/react";
vi.mock("@/modules/ai/lib/peerHandoffRuntime", () => ({
  preparePeerTaskHandoff: vi.fn().mockResolvedValue(null),
  preparePeerReply: vi.fn(async (event) => JSON.stringify(event)),
}));
vi.mock("@/modules/ai/store/chatRuntime", () => ({
  sendMessageToSession: vi.fn(),
  sendPeerCommunicationToSession: vi.fn(),
}));
vi.mock("@/modules/ai/lib/peerTasks", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/peerTasks")>()),
  savePeerTasks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/modules/ai/lib/sessions", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/sessions")>()),
  saveSessionsList: vi.fn().mockResolvedValue(undefined),
  saveMessages: vi.fn().mockResolvedValue(undefined),
}));
import {
  sendPeerCommunication,
  pumpPeerCommunication,
  awaitPeerClarification,
} from "@/modules/ai/lib/peerCommunicationCoordinator";
import {
  sendMessageToSession,
  sendPeerCommunicationToSession,
} from "@/modules/ai/store/chatRuntime";
import { dispatchPeerTask } from "@/modules/ai/lib/peerTaskCoordinator";
import { chats, useChatStore } from "@/modules/ai/store/chatStore";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";
import {
  savePeerTasks,
  PEER_TASK_SCHEMA_VERSION,
  type PeerTask,
} from "@/modules/ai/lib/peerTasks";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { createRunBudget } from "@/modules/ai/lib/runBudget";
import {
  peerReplySessions,
  peerWaitingSessions,
} from "@/modules/ai/lib/peerCommunicationRuntime";
import { beginInference } from "@/modules/ai/lib/inferenceLifecycle";
import { native } from "@/modules/ai/lib/native";
import { inspectAttachmentContent } from "@/modules/ai/lib/attachmentStore";
vi.mock("@/modules/ai/lib/attachmentStore", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/attachmentStore")>()),
  inspectAttachmentContent: vi.fn(),
}));
import {
  acquireWorkspaceWriteLease,
  clearWorkspaceWriteLeasesForTests,
  currentWorkspaceWriteLease,
} from "@/modules/ai/lib/workspaceWriteLease";

const task: PeerTask = {
  schemaVersion: PEER_TASK_SCHEMA_VERSION,
  id: "task",
  sourceSessionId: "source",
  targetSessionId: "target",
  sourceAgentId: "builtin:coder",
  sourceModelId: "gpt-5.5",
  targetAgentId: "builtin:reviewer",
  targetModelId: "gpt-4.1-mini",
  workspaceId: "local:c:/workspace",
  workspaceRoot: "C:/workspace",
  workspaceEnvironment: { kind: "local" },
  kind: "delegate",
  executionMode: "read-only",
  prompt: "Implement API, version unspecified",
  artifactRefs: [],
  parentTaskId: null,
  rootTaskId: "task",
  hopCount: 0,
  dependsOn: [],
  status: "running",
  createdAt: 1,
  updatedAt: 1,
};
const input = {
  taskId: "task",
  kind: "clarification-request" as const,
  text: "Which API version?",
  evidence: [],
};
function current() {
  return required(usePeerTaskStore.getState().tasks[0]);
}
function chat(text: string) {
  return {
    status: "ready",
    messages: [
      {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "text", text }],
      },
    ],
  } as unknown as Chat<UIMessage>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(savePeerTasks).mockResolvedValue(undefined);
  usePeerTaskStore.setState({
    tasks: [{ ...task }],
    hydrated: true,
    recoveryReady: true,
    recoveryError: null,
  });
  usePreferencesStore.setState({
    agentPermissionProfiles: {
      "builtin:coder": { mode: "full-access", categories: {} },
      "builtin:reviewer": { mode: "full-access", categories: {} },
    },
    agentWorkspacePermissions: [],
  });
  useChatStore.setState({
    sessionsHydrated: true,
    sessions: [
      {
        id: "source",
        title: "Private source title",
        createdAt: 1,
        updatedAt: 1,
        profile: {
          agentId: "builtin:coder",
          modelId: "gpt-5.5",
          workspaceId: task.workspaceId,
          workspaceRoot: task.workspaceRoot,
        },
        run: {
          state: "completed",
          startedAt: 1,
          agentId: "builtin:coder",
          modelId: "gpt-5.5",
          budget: { ...createRunBudget("full-access"), phase: "complete" },
        },
      },
      {
        id: "target",
        title: "Child",
        createdAt: 1,
        updatedAt: 1,
        profile: {
          agentId: "builtin:reviewer",
          modelId: "gpt-4.1-mini",
          workspaceId: task.workspaceId,
          workspaceRoot: task.workspaceRoot,
        },
        run: {
          state: "running",
          startedAt: 2,
          agentId: "builtin:reviewer",
          modelId: "gpt-4.1-mini",
          peerTaskId: "task",
          budget: createRunBudget("full-access"),
        },
      },
    ],
  });
  chats.set("source", chat("PRIVATE SOURCE HISTORY"));
  chats.set("target", chat("Waiting"));
  vi.mocked(sendPeerCommunicationToSession).mockImplementation(
    async (id, text, replyOnly) => {
      if (replyOnly) {
        expect(current().communication?.[0]).toMatchObject({
          state: "acknowledged",
        });
        expect(text).not.toContain("PRIVATE SOURCE HISTORY");
        chats.set(id, chat("Use API v2."));
      } else {
        expect(current().communication?.[1]).toMatchObject({
          state: "acknowledged",
        });
        expect(text).toContain("Use API v2.");
        peerWaitingSessions.delete(id);
        chats.set(id, chat("Implemented API v2."));
      }
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  peerReplySessions.clear();
  peerWaitingSessions.clear();
  chats.clear();
  clearWorkspaceWriteLeasesForTests();
});

it("integrates dispatch, child question, durable source receipt, reply and original child continuation", async () => {
  usePeerTaskStore.setState({ tasks: [{ ...task, status: "queued" }] });
  useChatStore.setState((state) => ({
    sessions: state.sessions.map((session) =>
      session.id === "target" ? { ...session, run: undefined } : session,
    ),
  }));
  vi.mocked(sendMessageToSession).mockImplementation(async () => {
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === "target"
          ? {
              ...session,
              run: {
                state: "running",
                startedAt: 2,
                agentId: "builtin:reviewer",
                modelId: "gpt-4.1-mini",
                peerTaskId: "task",
                budget: createRunBudget("full-access"),
              },
            }
          : session,
      ),
    }));
    await sendPeerCommunication("target", 2, "question", input);
  });
  await dispatchPeerTask("task");
  expect(current()).toMatchObject({
    status: "completed",
    result: { summary: "Implemented API v2." },
  });
  expect(current().communication).toHaveLength(2);
  expect(
    vi.mocked(sendPeerCommunicationToSession).mock.calls.map((call) => call[0]),
  ).toEqual(["source", "target"]);
  expect(savePeerTasks).toHaveBeenCalled();
  await pumpPeerCommunication();
  expect(sendPeerCommunicationToSession).toHaveBeenCalledTimes(2);
});

it("queues behind a busy source without changing the active prompt", async () => {
  chats.set("source", {
    ...chat("PRIVATE SOURCE HISTORY"),
    status: "streaming",
  } as unknown as Chat<UIMessage>);
  await sendPeerCommunication("target", 2, "question", input);
  await pumpPeerCommunication();
  expect(sendPeerCommunicationToSession).not.toHaveBeenCalled();
  expect(current().communication?.[0]?.state).toBe("queued");
  chats.set("source", chat("PRIVATE SOURCE HISTORY"));
  await pumpPeerCommunication();
  expect(sendPeerCommunicationToSession).toHaveBeenCalledOnce();
});

it("waits for a capacity-one inference slot to drain and retains the child write lease", async () => {
  await acquireWorkspaceWriteLease({
    workspaceId: task.workspaceId,
    sessionId: "target",
    agentId: "builtin:reviewer",
  });
  const inference = beginInference(
    { sessionId: "target", runId: "2", isCurrent: () => true },
    () => undefined,
  );
  await sendPeerCommunication("target", 2, "question", input);
  await pumpPeerCommunication();
  expect(sendPeerCommunicationToSession).not.toHaveBeenCalled();
  inference.settle();
  await pumpPeerCommunication();
  expect(sendPeerCommunicationToSession).toHaveBeenCalledOnce();
  expect(currentWorkspaceWriteLease(task.workspaceId)?.ownerSessionId).toBe(
    "target",
  );
});

it("requires automatic-response permission from the source", async () => {
  usePreferencesStore.setState({
    agentPermissionProfiles: {
      "builtin:coder": { mode: "ask", categories: {} },
    },
  });
  await sendPeerCommunication("target", 2, "question", input);
  await pumpPeerCommunication();
  expect(sendPeerCommunicationToSession).not.toHaveBeenCalled();
  expect(current().error?.message).toContain("permission");
});

it("reports a blocked lease cycle instead of holding two agents indefinitely", async () => {
  await acquireWorkspaceWriteLease({
    workspaceId: task.workspaceId,
    sessionId: "target",
    agentId: "builtin:reviewer",
  });
  const controller = new AbortController();
  const waiting = acquireWorkspaceWriteLease({
    workspaceId: task.workspaceId,
    sessionId: "source",
    agentId: "builtin:coder",
    signal: controller.signal,
  });
  await sendPeerCommunication("target", 2, "question", input);
  await pumpPeerCommunication();
  expect(current()).toMatchObject({ status: "blocked" });
  expect(sendPeerCommunicationToSession).not.toHaveBeenCalled();
  controller.abort();
  await waiting;
});

it.each([
  "agentId",
  "modelId",
  "workspaceId",
] as const)("blocks changed recipient %s instead of rerouting", async (key) => {
  await sendPeerCommunication("target", 2, "question", input);
  useChatStore.setState((state) => ({
    sessions: state.sessions.map((session) =>
      session.id === "source"
        ? {
            ...session,
            profile: { ...required(session.profile), [key]: "changed" },
          }
        : session,
    ),
  }));
  await pumpPeerCommunication();
  expect(sendPeerCommunicationToSession).not.toHaveBeenCalled();
  expect(current().error).toBeDefined();
});

it("rejects a stale sender generation", async () => {
  await expect(
    sendPeerCommunication("target", 1, "question", input),
  ).rejects.toThrow("stale_run");
  expect(current().communication).toBeUndefined();
});

it("does not resume after cancellation while the source is answering", async () => {
  await sendPeerCommunication("target", 2, "question", input);
  vi.mocked(sendPeerCommunicationToSession).mockImplementationOnce(async () => {
    usePeerTaskStore.setState({
      tasks: [{ ...current(), status: "cancelled" }],
    });
  });
  const wait = awaitPeerClarification("task");
  await expect(wait).rejects.toThrow("stopped");
  expect(current().communication).toHaveLength(1);
});

it("does not infer or resume if the durable write fails", async () => {
  vi.mocked(savePeerTasks).mockRejectedValueOnce(new Error("disk full"));
  await expect(
    sendPeerCommunication("target", 2, "question", input),
  ).rejects.toThrow("disk full");
  await pumpPeerCommunication();
  expect(usePeerTaskStore.getState().recoveryReady).toBe(false);
  expect(sendPeerCommunicationToSession).not.toHaveBeenCalled();
});

it("preserves unanswered evidence when the source endpoint fails", async () => {
  await sendPeerCommunication("target", 2, "question", input);
  vi.mocked(sendPeerCommunicationToSession).mockRejectedValueOnce(
    new Error("endpoint offline"),
  );
  await pumpPeerCommunication();
  expect(current().error?.message).toContain("endpoint offline");
  expect(current().communication?.[0]?.text).toBe(input.text);
});

it("blocks a deleted source and does not route to another chat", async () => {
  await sendPeerCommunication("target", 2, "question", input);
  useChatStore.setState((state) => ({
    sessions: state.sessions.filter((session) => session.id !== "source"),
  }));
  await pumpPeerCommunication();
  expect(current().status).toBe("blocked");
  expect(sendPeerCommunicationToSession).not.toHaveBeenCalled();
});

it("never substitutes private earlier assistant text for an empty clarification reply", async () => {
  await sendPeerCommunication("target", 2, "question", input);
  vi.mocked(sendPeerCommunicationToSession).mockResolvedValueOnce(undefined);
  await pumpPeerCommunication();
  expect(current().status).toBe("blocked");
  expect(current().communication).toHaveLength(1);
  expect(current().error?.message).toContain("did not provide");
});

it("retains isolated work when clarification cannot complete", async () => {
  usePeerTaskStore.setState({
    tasks: [{ ...task, status: "queued", executionMode: "isolated-worktree" }],
  });
  useChatStore.setState((state) => ({
    sessions: state.sessions.map((session) =>
      session.id === "target" ? { ...session, run: undefined } : session,
    ),
  }));
  vi.spyOn(native, "gitResolveRepo").mockResolvedValue({
    repoRoot: task.workspaceRoot,
    branch: "main",
    upstream: null,
    isDetached: false,
  });
  vi.spyOn(native, "gitAgentWorktreeCreate").mockResolvedValue({
    checkoutRoot: "C:/cache/task",
    baseSha: "a".repeat(40),
  });
  const remove = vi
    .spyOn(native, "gitAgentWorktreeRemove")
    .mockResolvedValue(undefined);
  vi.mocked(sendMessageToSession).mockImplementationOnce(async () => {
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === "target"
          ? {
              ...session,
              run: {
                state: "running",
                startedAt: 2,
                agentId: task.targetAgentId,
                modelId: task.targetModelId,
                peerTaskId: "task",
                budget: createRunBudget("full-access"),
              },
            }
          : session,
      ),
    }));
    await sendPeerCommunication("target", 2, "question", input);
  });
  vi.mocked(sendPeerCommunicationToSession).mockRejectedValueOnce(
    new Error("endpoint offline"),
  );
  await dispatchPeerTask("task");
  expect(current()).toMatchObject({
    status: "blocked",
    worktree: { checkoutRoot: "C:/cache/task" },
  });
  expect(remove).not.toHaveBeenCalled();
});

it("rejects a source answer that arrives from a replaced run generation", async () => {
  await sendPeerCommunication("target", 2, "question", input);
  let finish: (() => void) | undefined;
  vi.mocked(sendPeerCommunicationToSession).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const pumping = pumpPeerCommunication();
  await vi.waitFor(() => expect(finish).toBeDefined());
  useChatStore.setState((state) => ({
    sessions: state.sessions.map((session) =>
      session.id === "source" && session.run
        ? { ...session, run: { ...session.run, startedAt: 99 } }
        : session,
    ),
  }));
  finish?.();
  await pumping;
  expect(current().status).toBe("blocked");
  expect(current().communication).toHaveLength(1);
});

it("blocks corrupt immutable evidence without reading the original path", async () => {
  const hash = "a".repeat(64);
  usePeerTaskStore.setState({
    tasks: [
      {
        ...task,
        artifactRefs: [
          {
            id: "artifact",
            attachmentId: "attachment",
            contentRef: { id: hash, contentHash: hash, byteSize: 5 },
            displayName: "proof",
            mediaType: "text/plain",
            contentKind: "text",
            byteSize: 5,
            sourceSessionId: "source",
            sourceTaskId: null,
            sourceAgentId: task.sourceAgentId,
            sourceModelId: task.sourceModelId,
            workspaceId: task.workspaceId,
            workspaceRoot: task.workspaceRoot,
            createdAt: 1,
            originType: "workspace-file",
            accessPolicy: "model-input",
            sourcePath: "C:/workspace/changed.txt",
          },
        ],
      },
    ],
  });
  vi.mocked(inspectAttachmentContent).mockRejectedValueOnce(
    new Error("integrity failed"),
  );
  await sendPeerCommunication("target", 2, "question", {
    ...input,
    evidence: [{ taskId: "task", artifactId: "artifact", contentHash: hash }],
  });
  await pumpPeerCommunication();
  expect(current().error?.message).toContain("integrity failed");
  expect(sendPeerCommunicationToSession).not.toHaveBeenCalled();
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Missing test fixture value.");
  return value;
}
