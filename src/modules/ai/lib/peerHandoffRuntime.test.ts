import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Chat, UIMessage } from "@ai-sdk/react";
import type { LanguageModel } from "ai";
vi.mock("@/modules/ai/lib/agent", () => ({
  buildConfiguredLanguageModel: vi.fn().mockResolvedValue({}),
  buildStableSystem: vi.fn().mockReturnValue("Target system"),
}));
vi.mock("@/modules/ai/lib/requestPreflight", () => ({
  modelBudgetLimits: vi.fn().mockResolvedValue({ deployed: 4096 }),
  serializedToolSchemas: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/modules/ai/tools/tools", () => ({
  buildTools: vi.fn().mockReturnValue({}),
}));
vi.mock("@/modules/ai/lib/transport", () => ({
  readProjectMemory: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/modules/ai/lib/selfHostedCapabilities", () => ({
  readSelfHostedSnapshot: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/modules/ai/lib/projectMemory", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/projectMemory")>()),
  projectMemoryClient: vi.fn(),
}));
vi.mock("@/modules/ai/lib/peerTasks", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/peerTasks")>()),
  savePeerTasks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/modules/ai/lib/sessions", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/sessions")>()),
  loadMessages: vi.fn().mockResolvedValue([]),
  saveSessionsList: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/modules/ai/store/chatRuntime", () => ({
  sessionToolContext: vi.fn(() => ({
    toolContext: {
      getSessionId: () => "coder",
      getAgentId: () => "builtin:coder",
      getWorkspaceRoot: () => "C:/project",
      getCwd: () => "C:/project",
    },
  })),
  sendMessageToSession: vi.fn(),
  sendPeerCommunicationToSession: vi.fn(),
}));
import {
  preparePeerTaskHandoff,
  preparePeerReply,
} from "@/modules/ai/lib/peerHandoffRuntime";
import { peerEndpoint } from "@/modules/ai/lib/peerCommunicationCoordinator";
import type { PeerCommunicationEvent } from "@/modules/ai/lib/peerCommunication";
import {
  dispatchPeerTask,
  requestPeerTask,
} from "@/modules/ai/lib/peerTaskCoordinator";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";
import { useChatStore, chats } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  projectMemoryClient,
  type ProjectEntry,
} from "@/modules/ai/lib/projectMemory";
import { modelBudgetLimits } from "@/modules/ai/lib/requestPreflight";
import { buildConfiguredLanguageModel } from "@/modules/ai/lib/agent";
import { sendMessageToSession } from "@/modules/ai/store/chatRuntime";
import {
  PEER_TASK_SCHEMA_VERSION,
  savePeerTasks,
  type PeerTask,
} from "@/modules/ai/lib/peerTasks";

const task: PeerTask = {
  schemaVersion: PEER_TASK_SCHEMA_VERSION,
  id: "task",
  rootTaskId: "task",
  parentTaskId: null,
  sourceSessionId: "investigator",
  targetSessionId: "coder",
  sourceAgentId: "builtin:architect",
  sourceModelId: "gpt-5.5",
  targetAgentId: "builtin:coder",
  targetModelId: "gpt-4.1-mini",
  workspaceId: "local:c:/project",
  workspaceRoot: "C:/project",
  workspaceEnvironment: { kind: "local" },
  kind: "delegate",
  executionMode: "read-only",
  prompt: "Implement API. Preserve v1. Never use network.",
  artifactRefs: [],
  hopCount: 0,
  dependsOn: [],
  status: "running",
  createdAt: 1,
  updatedAt: 1,
};
const requirement: ProjectEntry = {
  id: "requirement",
  section: "requirements",
  text: "Preserve existing authentication",
  qualification: "user-requirement",
  status: "approved",
  sourceState: "historical-source-verified",
  sourceSessionId: "investigator",
  locator: { kind: "taskResult", taskId: "earlier" },
  sliceHash: "a".repeat(64),
  start: 0,
  end: 32,
  authorAgent: "builtin:architect",
  supersedes: null,
  conflicts: [],
  updatedAt: 1,
};
const client = { load: vi.fn(), revalidate: vi.fn() };
function makeChat(text: string) {
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
  vi.mocked(modelBudgetLimits).mockResolvedValue({ deployed: 4096 });
  vi.mocked(buildConfiguredLanguageModel).mockResolvedValue(
    {} as LanguageModel,
  );
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
      "builtin:architect": { mode: "full-access", categories: {} },
    },
    agentWorkspacePermissions: [],
  });
  useChatStore.setState({
    sessionsHydrated: true,
    apiKeys: { ...useChatStore.getState().apiKeys, openai: "test" },
    sessions: [
      {
        id: "investigator",
        title: "Private Investigator",
        createdAt: 1,
        updatedAt: 1,
        profile: {
          agentId: task.sourceAgentId,
          modelId: task.sourceModelId,
          workspaceId: task.workspaceId,
          workspaceRoot: task.workspaceRoot,
        },
      },
      {
        id: "coder",
        title: "Coder",
        createdAt: 1,
        updatedAt: 1,
        profile: {
          agentId: task.targetAgentId,
          modelId: task.targetModelId,
          workspaceId: task.workspaceId,
          workspaceRoot: task.workspaceRoot,
        },
      },
    ],
  });
  chats.clear();
  chats.set("investigator", makeChat("PRIVATE INVESTIGATOR TRANSCRIPT"));
  chats.set("coder", makeChat("Existing coder context"));
  client.load.mockResolvedValue({
    workspace: task.workspaceId,
    checkout: task.workspaceRoot,
    baseSha: null,
    revision: 1,
    entries: [requirement],
  });
  client.revalidate.mockResolvedValue({
    revision: 1,
    entries: [
      {
        id: requirement.id,
        freshness: "explicit-user-statement",
        sourceState: requirement.sourceState,
        evidence: [],
      },
    ],
    reads: 0,
    bytes: 0,
  });
  vi.mocked(projectMemoryClient).mockReturnValue(
    client as unknown as ReturnType<typeof projectMemoryClient>,
  );
  vi.mocked(sendMessageToSession).mockImplementation(async () => {
    chats.set("coder", makeChat("Implemented v1 compatible API"));
  });
});
afterEach(() => {
  chats.clear();
  vi.restoreAllMocks();
});
it("dispatches large Investigator to smaller Coder with durable recipient receipt and original identity", async () => {
  usePeerTaskStore.setState({ tasks: [{ ...task, status: "queued" }] });
  await dispatchPeerTask(task.id);
  const delivered = vi.mocked(sendMessageToSession).mock.calls[0];
  expect(delivered?.[0]).toBe("coder");
  expect(JSON.stringify(delivered?.[1])).toContain(task.prompt);
  expect(JSON.stringify(delivered?.[1])).toContain(requirement.text);
  expect(JSON.stringify(delivered?.[1])).not.toContain("PRIVATE INVESTIGATOR");
  expect(usePeerTaskStore.getState().tasks[0]).toMatchObject({
    status: "completed",
    targetModelId: task.targetModelId,
    handoff: { recipientSessionId: "coder", sources: ["project:requirement"] },
  });
  expect(
    vi
      .mocked(savePeerTasks)
      .mock.calls.some(
        ([tasks]) => tasks[0].handoff && tasks[0].status === "running",
      ),
  ).toBe(true);
});
it("reuses identical validated preparation without promoting private memory", async () => {
  const first = await preparePeerTaskHandoff(task, "");
  const second = await preparePeerTaskHandoff(task, "");
  expect(second.receipt).toBe(first.receipt);
  expect(second.text).not.toContain("PRIVATE INVESTIGATOR");
});
it.each([
  "cancel",
  "model",
  "permissions",
  "project",
  "freshness",
  "history",
])("rejects %s changes before delivery", async (change) => {
  const prepared = await preparePeerTaskHandoff(task, "");
  if (change === "cancel")
    usePeerTaskStore.setState({ tasks: [{ ...task, status: "cancelled" }] });
  if (change === "model")
    useChatStore.setState((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === "coder" && session.profile
          ? { ...session, profile: { ...session.profile, modelId: "gpt-5.5" } }
          : session,
      ),
    }));
  if (change === "permissions")
    usePreferencesStore.setState({
      agentPermissionProfiles: {
        "builtin:coder": { mode: "chat-only", categories: {} },
      },
    });
  if (change === "project")
    client.load.mockResolvedValue({ revision: 2, entries: [requirement] });
  if (change === "freshness")
    client.revalidate.mockResolvedValue({
      revision: 1,
      entries: [{ id: requirement.id, freshness: "invalidated" }],
    });
  if (change === "history")
    chats.set("coder", makeChat("newer user instruction"));
  await expect(prepared.validate()).rejects.toThrow(/stale|changed/);
});
it("unavailable target fails without substituting a cloud model", async () => {
  vi.mocked(buildConfiguredLanguageModel).mockRejectedValue(
    new Error("Target offline"),
  );
  usePeerTaskStore.setState({ tasks: [{ ...task, status: "queued" }] });
  await dispatchPeerTask(task.id);
  expect(sendMessageToSession).not.toHaveBeenCalled();
  expect(usePeerTaskStore.getState().tasks[0].status).toBe("failed");
});
it("failed durable receipt prevents inference", async () => {
  vi.mocked(savePeerTasks).mockRejectedValue(new Error("disk unavailable"));
  usePeerTaskStore.setState({ tasks: [{ ...task, status: "queued" }] });
  await dispatchPeerTask(task.id);
  expect(sendMessageToSession).not.toHaveBeenCalled();
});
it("required-context overflow fails without truncating instructions", async () => {
  vi.mocked(modelBudgetLimits).mockResolvedValue({ deployed: 256 });
  await expect(preparePeerTaskHandoff(task, "")).rejects.toThrow("cannot fit");
});

it("empty provider output cannot share a previous private assistant message as the result", async () => {
  vi.mocked(sendMessageToSession).mockResolvedValue(undefined);
  chats.set("coder", makeChat("PRIVATE PREVIOUS ANSWER"));
  usePeerTaskStore.setState({ tasks: [{ ...task, status: "queued" }] });
  await dispatchPeerTask(task.id);
  expect(usePeerTaskStore.getState().tasks[0].result?.summary).toBe(
    "The peer run completed without a text response.",
  );
});

it("completed Coder to Reviewer to returned correction retains graph and result identities", async () => {
  const completed: PeerTask = {
    ...task,
    status: "completed",
    result: {
      summary: "API v1 implementation ready",
      targetSessionId: "coder",
      targetAgentId: task.targetAgentId,
      targetModelId: task.targetModelId,
      completedAt: 2,
      artifacts: [],
    },
  };
  usePeerTaskStore.setState({ tasks: [completed] });
  useChatStore.setState((state) => ({
    sessions: [
      ...state.sessions,
      {
        id: "reviewer",
        title: "Reviewer",
        createdAt: 1,
        updatedAt: 1,
        profile: {
          agentId: "builtin:reviewer",
          modelId: "gpt-4.1-mini",
          workspaceId: task.workspaceId,
          workspaceRoot: task.workspaceRoot,
        },
      },
    ],
  }));
  vi.mocked(sendMessageToSession).mockImplementation(async (id) => {
    chats.set(
      id,
      makeChat(
        id === "reviewer"
          ? "MUST api.ts:4 preserve authentication"
          : "Corrected authentication",
      ),
    );
  });
  const review = await requestPeerTask({
    sourceSessionId: "investigator",
    targetSessionId: "reviewer",
    kind: "review",
    prompt: "Review API v1 compatibility",
    followUpTo: task.id,
  });
  expect(review.ok).toBe(true);
  if (!review.ok) throw new Error(review.message);
  expect(review.task.status).toBe("completed");
  expect(review.task.review?.results[0].taskId).toBe(task.id);
  const correction = await requestPeerTask({
    sourceSessionId: "investigator",
    targetSessionId: "coder",
    kind: "delegate",
    prompt: "Correct the reviewer findings",
    followUpTo: review.task.id,
  });
  expect(correction.ok).toBe(true);
  if (!correction.ok) throw new Error(correction.message);
  expect(correction.task).toMatchObject({
    status: "completed",
    rootTaskId: task.id,
    parentTaskId: review.task.id,
    targetModelId: task.targetModelId,
  });
  expect(
    JSON.stringify(vi.mocked(sendMessageToSession).mock.calls[1]?.[1]),
  ).toContain("MUST api.ts:4");
});

it("unrelated conversation cannot attach a review or correction to another graph", async () => {
  const result = await requestPeerTask({
    sourceSessionId: "investigator",
    targetSessionId: "coder",
    kind: "review",
    prompt: "Review",
    followUpTo: "unknown-task",
  });
  expect(result).toMatchObject({ ok: false, code: "peer_follow_up_denied" });
});

async function reply(): Promise<PeerCommunicationEvent> {
  return {
    id: "reply",
    taskId: task.id,
    recipientTaskId: task.id,
    rootTaskId: task.rootTaskId,
    workspaceId: task.workspaceId,
    parentTaskId: null,
    policyVersion: 1,
    sender: await peerEndpoint("investigator", task.workspaceId),
    recipient: await peerEndpoint("coder", task.workspaceId),
    runStartedAt: 1,
    sequence: 2,
    kind: "clarification-response",
    text: "Keep API v1",
    evidence: [
      { taskId: task.id, artifactId: "artifact", contentHash: "a".repeat(64) },
    ],
    toolCallId: "reply-call",
    createdAt: Date.now(),
    deadline: Date.now() + 60000,
    digest: "b".repeat(64),
    state: "queued",
    replyTo: "question",
  };
}
it("clarification preserves answer and provenance while suppressing already acknowledged evidence", async () => {
  const event = await reply();
  usePeerTaskStore.setState({
    tasks: [
      {
        ...task,
        communication: [
          { ...event, id: "earlier", sequence: 1, state: "acknowledged" },
          event,
        ],
      },
    ],
  });
  const text = await preparePeerReply(event);
  expect(text).toContain(event.text);
  expect(text).toContain('"evidence":[]');
  expect(text).toContain(event.digest);
  expect(text).not.toContain("PRIVATE INVESTIGATOR");
});
it("oversized clarification is blocked rather than truncating the source answer", async () => {
  const event = await reply();
  vi.mocked(modelBudgetLimits).mockResolvedValue({ deployed: 256 });
  await expect(preparePeerReply(event)).rejects.toThrow("do not fit");
});
it("changed task instructions invalidate in-flight preparation", async () => {
  const prepared = await preparePeerTaskHandoff(task, "");
  usePeerTaskStore.setState({
    tasks: [{ ...task, prompt: "New requirements" }],
  });
  await expect(prepared.validate()).rejects.toThrow("stale");
});
it("an independent graph update does not invalidate this task's preparation", async () => {
  const prepared = await preparePeerTaskHandoff(task, "");
  usePeerTaskStore.setState((state) => ({
    tasks: [...state.tasks, { ...task, id: "other", rootTaskId: "other" }],
  }));
  await expect(prepared.validate()).resolves.toBeUndefined();
});

it.each(["chat-only", "secret-path"])("denies artifact transfer for %s before reading content", async (mode) => {
  if (mode === "chat-only") usePreferencesStore.setState({ agentPermissionProfiles: { "builtin:coder": { mode: "chat-only", categories: {} } } });
  const protectedTask: PeerTask = { ...task, artifactRefs: [{
    id: "artifact", attachmentId: "attachment", contentRef: { id: "a".repeat(64), contentHash: "a".repeat(64), byteSize: 10 },
    displayName: "input.txt", mediaType: "text/plain", contentKind: "text", byteSize: 10, sourceSessionId: task.sourceSessionId, sourceTaskId: null,
    sourceAgentId: task.sourceAgentId, sourceModelId: task.sourceModelId, workspaceId: task.workspaceId, workspaceRoot: task.workspaceRoot,
    createdAt: 1, originType: "workspace-file", accessPolicy: "model-input", sourcePath: mode === "secret-path" ? "C:/project/.env" : "C:/project/input.txt",
  }] };
  usePeerTaskStore.setState({ tasks: [protectedTask] });
  await expect(preparePeerTaskHandoff(protectedTask, "")).rejects.toThrow("artifact_denied");
  expect(buildConfiguredLanguageModel).not.toHaveBeenCalled();
});
