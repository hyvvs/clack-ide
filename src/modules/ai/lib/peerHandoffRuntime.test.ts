import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Chat, UIMessage } from "@ai-sdk/react";
import type { LanguageModel } from "ai";
vi.mock("@/modules/ai/lib/agent", () => ({
  buildConfiguredLanguageModel: vi.fn().mockResolvedValue({}),
  buildStableSystem: vi.fn().mockReturnValue("Target system"),
}));
vi.mock("@/modules/ai/lib/requestPreflight", () => ({
  modelBudgetLimits: vi.fn().mockResolvedValue({ deployed: 4096 }),
  serializedToolSchemas: vi.fn().mockResolvedValue([]),
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
import { serializedToolSchemas } from "@/modules/ai/lib/requestPreflight";
import { buildTools } from "@/modules/ai/tools/tools";
import { jsonSchema, tool, type ToolSet } from "ai";
import { useAgentsStore } from "@/modules/ai/store/agentsStore";
import { PeerHandoffPreparationError } from "@/modules/ai/lib/peerHandoffFailure";
import { identifyTool } from "@/modules/ai/lib/toolExposure";
import { captureEffort } from "@/modules/ai/lib/reasoningEffort";
import { resolveModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import { buildConfiguredLanguageModel } from "@/modules/ai/lib/agent";
import { sendMessageToSession } from "@/modules/ai/store/chatRuntime";
import {
  PEER_TASK_SCHEMA_VERSION,
  savePeerTasks,
  normalizePeerTask,
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
const fixtureTools = vi.mocked(buildTools as (...args: Parameters<typeof buildTools>) => ToolSet);
function required<T>(value: T | undefined | null): T {
  if (value == null) throw new Error("Required fixture state is missing");
  return value;
}
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
  fixtureTools.mockReturnValue({});
  vi.mocked(serializedToolSchemas).mockResolvedValue([]);
  usePeerTaskStore.setState({
    tasks: [{ ...task }],
    hydrated: true,
    recoveryReady: true,
    recoveryError: null,
    managingTaskIds: [], retryingTaskIds: [],
  });
  usePreferencesStore.setState({
    customInstructions: "",
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
it("actual dispatch survives benign store reconstruction during handoff preparation", async () => {
  let release!: () => void;
  let reached!: () => void;
  const entered = new Promise<void>(resolve => { reached = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const view = await client.load();
  client.load.mockImplementationOnce(async () => { reached(); await barrier; return view; });
  usePeerTaskStore.setState({ tasks: [{ ...task, status: "queued" }] });
  const dispatch = dispatchPeerTask(task.id);
  await entered;
  useChatStore.setState(s => ({ sessions: s.sessions.map(session => ({ ...session, title: "Refreshed title", updatedAt: 2, profile: { ...required(session.profile) } })) }));
  usePreferencesStore.setState({ backgroundBlur: 12 });
  usePeerTaskStore.setState(s => ({ tasks: structuredClone(s.tasks) }));
  release();
  await dispatch;
  expect(usePeerTaskStore.getState().tasks[0], "benign metadata churn must not stale a real handoff").toMatchObject({ status: "completed" });
  expect(sendMessageToSession).toHaveBeenCalledTimes(1);
});

async function pausePreparation(boundary: "project" | "model" = "project") {
  let release!: () => void;
  let reached!: () => void;
  const entered = new Promise<void>(resolve => { reached = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const view = await client.load();
  if (boundary === "project") client.load.mockImplementationOnce(async () => { reached(); await barrier; return view; });
  else vi.mocked(buildConfiguredLanguageModel).mockImplementationOnce(async () => { reached(); await barrier; return {} as LanguageModel; });
  return { entered, release: () => release() };
}

it.each([
  ["model", "target_identity_changed"], ["agent", "target_identity_changed"],
  ["workspace", "target_identity_changed"], ["permissions", "endpoint_changed"],
  ["instructions", "policy_changed"], ["history", "history_changed"],
  ["dependency", "dependency_changed"], ["task", "task_changed"],
  ["source-run", "source_run_changed"], ["source-cancel", "source_cancelled"],
  ["source-model", "endpoint_changed"], ["tools", "tools_changed"],
  ["project", "project_changed"], ["freshness", "project_changed"],
  ["target-run", "target_identity_changed"],
])("rejects material %s changes during actual dispatch with bounded %s diagnostics", async (change, reason) => {
  const dependency: PeerTask = { ...task, id: "dependency", status: "completed", result: { summary: "Verified dependency", artifacts: [], targetSessionId: "coder", targetAgentId: task.targetAgentId, targetModelId: task.targetModelId, completedAt: 1 } };
  usePeerTaskStore.setState({ tasks: [dependency, { ...task, status: "queued", dependsOn: [dependency.id] }] });
  useChatStore.setState(s => ({ sessions: s.sessions.map(session => session.id === "investigator" ? { ...session, run: { startedAt: 1, state: "running" as const } } : session) }));
  const pause = await pausePreparation(["tools", "freshness"].includes(change) ? "model" : "project");
  const dispatch = dispatchPeerTask(task.id);
  await pause.entered;
  if (["model", "agent", "workspace", "target-run", "source-model", "source-run", "source-cancel"].includes(change)) useChatStore.setState(s => ({ sessions: s.sessions.map(session => {
    const source = change.startsWith("source-");
    if (session.id !== (source ? "investigator" : "coder")) return session;
    if (change.endsWith("run") || change === "source-cancel") return { ...session, run: { startedAt: change === "source-cancel" ? 1 : 9, state: change === "source-cancel" ? "cancelled" as const : "running" as const } };
    return { ...session, profile: { ...required(session.profile), ...(change.endsWith("model") ? { modelId: source ? "gpt-4.1-mini" : "gpt-5.5" } : change === "agent" ? { agentId: "builtin:reviewer" } : { workspaceId: "local:/other", workspaceRoot: "/other" }) } };
  }) }));
  if (change === "permissions") usePreferencesStore.setState({ agentPermissionProfiles: { "builtin:coder": { mode: "chat-only", categories: {} } } });
  if (change === "instructions") usePreferencesStore.setState({ customInstructions: "New policy" });
  if (change === "history") chats.set("coder", makeChat("New recipient instruction"));
  if (change === "task") usePeerTaskStore.setState(s => ({ tasks: s.tasks.map(t => t.id === task.id ? { ...t, prompt: "New task intent" } : t) }));
  if (change === "dependency") usePeerTaskStore.setState(s => ({ tasks: s.tasks.map(t => t.id === dependency.id ? { ...t, result: { ...required(t.result), summary: "Changed finding" } } : t) }));
  if (change === "tools") {
    fixtureTools.mockReturnValue({ read_file: tool({ description: "New assigned tool", inputSchema: jsonSchema({ type: "object", properties: {} }) }) });
    vi.mocked(serializedToolSchemas).mockImplementation(async tools => Object.keys(tools).map(name => ({ type: "function", function: { name, description: tools[name].description, parameters: { type: "object", properties: {} } } })));
  }
  if (change === "project") client.load.mockResolvedValue({ workspace: task.workspaceId, revision: 2, entries: [requirement] });
  if (change === "freshness") client.revalidate.mockResolvedValue({ revision: 1, entries: [{ id: requirement.id, freshness: "invalidated" }] });
  pause.release();
  await dispatch;
  const failed = required(usePeerTaskStore.getState().tasks.find(t => t.id === task.id));
  expect(failed).toMatchObject({ status: "failed", preRunFailure: true, error: { code: reason === "project_changed" ? "peer_handoff_project_changed" : "peer_handoff_preparation_stale", reason } });
  expect(sendMessageToSession).not.toHaveBeenCalled();
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

it("equivalent dependency, task, session and history reconstruction reuses cache but every hit validates current evidence", async () => {
  const dependency: PeerTask = { ...task, id: "dependency", status: "completed", result: { summary: "Verified result", artifacts: [], targetSessionId: "coder", targetAgentId: task.targetAgentId, targetModelId: task.targetModelId, completedAt: 1 } };
  const current = { ...task, dependsOn: [dependency.id] };
  usePeerTaskStore.setState({ tasks: [dependency, current] });
  const first = await preparePeerTaskHandoff(current, "");
  usePeerTaskStore.setState(s => ({ tasks: structuredClone(s.tasks).map(t => ({ ...t, updatedAt: 99, archivedAt: t.id === dependency.id ? 99 : undefined })) }));
  useChatStore.setState(s => ({ sessions: s.sessions.map(session => ({ ...session, title: "Renamed", profile: { ...required(session.profile) } })) }));
  usePreferencesStore.setState({ themeId: "tokyo-night", backgroundOpacity: 0.2, ollamaBaseURL: "http://localhost:9999" });
  const chat = required(chats.get("coder"));
  chat.messages = structuredClone(chat.messages);
  const second = await preparePeerTaskHandoff(required(usePeerTaskStore.getState().tasks.find(t => t.id === task.id)), "");
  expect(second.receipt).toBe(first.receipt);
  await expect(first.validate()).resolves.toBeUndefined();
  usePeerTaskStore.setState(s => ({ tasks: s.tasks.map(t => t.id === dependency.id ? { ...t, result: { ...required(t.result), summary: "Changed evidence" } } : t) }));
  await expect(second.validate()).rejects.toMatchObject({ reason: "dependency_changed" });
});

it.each(["schema", "revision"])("real %s tool changes invalidate an already prepared handoff", async change => {
  const serialize = (await vi.importActual<typeof import("@/modules/ai/lib/requestPreflight")>("@/modules/ai/lib/requestPreflight")).serializedToolSchemas;
  vi.mocked(serializedToolSchemas).mockImplementation(serialize);
  const initial = tool({ description: "Inspect", inputSchema: jsonSchema({ type: "object", properties: { path: { type: "string" } } }) });
  identifyTool(initial, { version: 1 });
  fixtureTools.mockReturnValue({ read_file: initial });
  const prepared = await preparePeerTaskHandoff(task, "");
  const next = tool({ description: "Inspect", inputSchema: jsonSchema({ type: "object", properties: { path: { type: change === "schema" ? "number" : "string" } } }) });
  identifyTool(next, { version: change === "revision" ? 2 : 1 });
  fixtureTools.mockReturnValue({ read_file: next });
  await expect(prepared.validate()).rejects.toMatchObject({ reason: "tools_changed" });
});

it("recipient effort changes invalidate policy without relying on session object identity", async () => {
  const current = { ...task, targetModelId: "gpt-5.5" };
  usePeerTaskStore.setState({ tasks: [current] });
  useChatStore.setState(s => ({ sessions: s.sessions.map(session => session.id === "coder" ? { ...session, profile: { ...required(session.profile), modelId: current.targetModelId } } : session) }));
  const effort = captureEffort(current.targetModelId, resolveModelTransportIdentity(current.targetModelId));
  const prepared = await preparePeerTaskHandoff(current, "");
  useChatStore.setState(s => ({ sessions: s.sessions.map(session => session.id === "coder" ? { ...session, effortPreferences: { version: 1, choices: [{ key: effort.key, choice: "high", revision: effort.capability.revision }] } } : session) }));
  await expect(prepared.validate()).rejects.toMatchObject({ reason: "policy_changed" });
});

it("actual Agent instruction policy changes invalidate the existing endpoint digest", async () => {
  const prepared = await preparePeerTaskHandoff(task, "");
  const state = useAgentsStore.getState();
  const agents = state.all();
  try {
    useAgentsStore.setState({ all: () => agents.map(agent => agent.id === task.targetAgentId ? { ...agent, instructions: "Changed trusted policy" } : agent) });
    await expect(prepared.validate()).rejects.toMatchObject({ reason: "endpoint_changed" });
  } finally { useAgentsStore.setState(state, true); }
});

it("bound prepared handoffs expire and changed capacity never reuses the cached result unchecked", async () => {
  const at = Date.now();
  const prepared = await preparePeerTaskHandoff(task, "");
  vi.mocked(modelBudgetLimits).mockResolvedValue({ deployed: 8192 });
  await expect(prepared.validate()).rejects.toMatchObject({ reason: "capability_changed" });
  vi.mocked(modelBudgetLimits).mockResolvedValue({ deployed: 4096 });
  vi.spyOn(Date, "now").mockReturnValue(at + 15_001);
  await expect(prepared.validate()).rejects.toBeInstanceOf(PeerHandoffPreparationError);
  await expect(prepared.validate()).rejects.toMatchObject({ reason: "expired" });
});

it("a dependency evidence change invalidates only its consumer, not independent prepared tasks", async () => {
  const dependency: PeerTask = { ...task, id: "dependency", status: "completed", result: { summary: "Shared finding", artifacts: [], targetSessionId: "coder", targetAgentId: task.targetAgentId, targetModelId: task.targetModelId, completedAt: 1 } };
  const independent = { ...task, id: "independent", rootTaskId: "independent" };
  const consumer = { ...task, dependsOn: [dependency.id] };
  usePeerTaskStore.setState({ tasks: [dependency, consumer, independent] });
  const [first, second] = await Promise.all([preparePeerTaskHandoff(consumer, ""), preparePeerTaskHandoff(independent, "")]);
  expect(first.receipt.key).not.toBe(second.receipt.key);
  usePeerTaskStore.setState(s => ({ tasks: s.tasks.map(t => t.id === dependency.id ? { ...t, review: { version: 1, files: [], patches: [], results: [{ taskId: "changed", hash: "b".repeat(64) }] } } : t) }));
  await expect(first.validate()).rejects.toMatchObject({ reason: "dependency_changed" });
  await expect(second.validate()).resolves.toBeUndefined();
});

it.each(["peer_handoff_preparation_deadline", "peer_handoff_target_unavailable", "peer_handoff_target_capability", "peer_handoff_artifact_denied", "peer_handoff_artifact_corrupt", "peer_handoff_project_changed"])("retains the known %s failure code before transmission", async code => {
  usePeerTaskStore.setState({ tasks: [{ ...task, status: "queued" }] });
  vi.mocked(buildConfiguredLanguageModel).mockRejectedValueOnce(new Error(code));
  await dispatchPeerTask(task.id);
  expect(usePeerTaskStore.getState().tasks[0]).toMatchObject({ status: "failed", preRunFailure: true, error: { code } });
  expect(sendMessageToSession).not.toHaveBeenCalled();
});

it("actual context overflow preserves its specific pre-send cause without sending or truncating", async () => {
  vi.mocked(modelBudgetLimits).mockResolvedValue({ deployed: 256 });
  usePeerTaskStore.setState({ tasks: [{ ...task, status: "queued" }] });
  await dispatchPeerTask(task.id);
  expect(usePeerTaskStore.getState().tasks[0]).toMatchObject({ status: "failed", preRunFailure: true, error: { code: "peer-handoff-required-overflow" } });
  expect(sendMessageToSession).not.toHaveBeenCalled();
});

it("task cancellation during a held preparation stops authoritatively without transmission", async () => {
  const pause = await pausePreparation();
  usePeerTaskStore.setState({ tasks: [{ ...task, status: "queued" }] });
  const dispatch = dispatchPeerTask(task.id);
  await pause.entered;
  usePeerTaskStore.setState(s => ({ tasks: s.tasks.map(t => ({ ...t, status: "cancelled" })) }));
  pause.release();
  await dispatch;
  expect(usePeerTaskStore.getState().tasks[0].status).toBe("cancelled");
  expect(usePeerTaskStore.getState().tasks[0].error).toBeUndefined();
  expect(sendMessageToSession).not.toHaveBeenCalled();
});

it("durable failure diagnostics retain only bounded known reason codes", () => {
  const record = { ...task, status: "failed", error: { code: "peer_handoff_preparation_stale", message: "Setup changed", reason: "policy_changed" } };
  expect(normalizePeerTask(JSON.parse(JSON.stringify(record)))?.error?.reason).toBe("policy_changed");
  expect(normalizePeerTask({ ...record, error: { ...record.error, reason: "untrusted arbitrary diagnostic text" } })?.error?.reason).toBeUndefined();
});
