import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { stepCountIs, streamText, type UIMessage } from "ai";
import type { Chat } from "@ai-sdk/react";
import { buildStableSystem } from "@/modules/ai/lib/agent";
import * as agentRuntime from "@/modules/ai/lib/agent";
import * as preflight from "@/modules/ai/lib/requestPreflight";
import * as projectMemory from "@/modules/ai/lib/projectMemory";
import { preparePeerTaskHandoff } from "@/modules/ai/lib/peerHandoffRuntime";
import { useAgentsStore } from "@/modules/ai/store/agentsStore";
import { buildTools } from "@/modules/ai/tools/tools";
import type { ToolContext } from "@/modules/ai/tools/context";
import { native } from "@/modules/ai/lib/native";
import { createConversationProfile } from "@/modules/ai/lib/sessions";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { chats, useChatStore } from "@/modules/ai/store/chatStore";
import {
  flushPeerTasks,
  usePeerTaskStore,
} from "@/modules/ai/store/peerTaskStore";
import { sendMessageToSession } from "@/modules/ai/store/chatRuntime";
import {
  requestPeerTask,
  dispatchPeerTask,
  applyPeerTaskChangeSet,
  discardPeerTaskWorktree,
} from "@/modules/ai/lib/peerTaskCoordinator";
import {
  recoverInterruptedPeerTasks,
  type PeerTask,
} from "@/modules/ai/lib/peerTasks";
import {
  readTaskArtifact,
  openTaskFile,
  retryTaskWithoutEffects,
  checkTaskRetry,
} from "@/modules/ai/lib/taskResultActions";
import { peerTaskArtifactToMessagePart } from "@/modules/ai/lib/peerTaskArtifacts";
import { availableDispatcherTasks } from "@/modules/ai/lib/dispatcherTasks";
import { taskWorkGroup } from "@/modules/ai/lib/taskPresentation";
import {
  clearWorkspaceWriteLeasesForTests,
  releaseWorkspaceWriteLeasesForSession,
} from "@/modules/ai/lib/workspaceWriteLease";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
  Channel: class {},
}));
vi.mock("@/modules/ai/store/chatRuntime", () => ({
  sendMessageToSession: vi.fn(),
  sessionToolContext: (id: string) => ({ toolContext: context(id) }),
}));
vi.mock("@/modules/ai/lib/peerHandoffRuntime", () => ({
  preparePeerTaskHandoff: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/modules/ai/lib/attachmentStore", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/attachmentStore")>()),
  storeAttachmentContent: (bytes: Uint8Array) => storeContent(bytes),
  loadAttachmentContent: (id: string) =>
    fs.readFile(path.join(container, "content", id)),
}));
vi.mock("@/modules/ai/lib/peerTasks", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/peerTasks")>()),
  savePeerTasks: (tasks: PeerTask[]) => persist("tasks.json", tasks),
}));
vi.mock("@/modules/ai/lib/sessions", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/sessions")>()),
  saveSessionsList: (sessions: unknown) => persist("sessions.json", sessions),
}));

const originalChat = useChatStore.getState();
const originalTasks = usePeerTaskStore.getState();
const originalPreferences = usePreferencesStore.getState();
const originalAgents = useAgentsStore.getState();
const canary = "PRIVATE_ARCHITECT_HISTORY_NOT_SHARED";
const flawed = "# Acceptance\nTimeout: 900\n";
const corrected = "# Acceptance\nTimeout: 750\n";
const agents = {
  architect: {
    name: "Architect",
    instructions: "Prefix responses with ARCHITECT: and focus on design.",
  },
  coder: {
    name: "Coder",
    instructions:
      "Implement the explicit task using the authorized file tools.",
  },
  reviewer: {
    name: "Reviewer",
    instructions: "Prefix responses with REVIEW: and do not modify files.",
  },
};
let container: string, root: string, baseURL: string;
let server: Server;
let writes = Promise.resolve();
let requests: Record<string, unknown>[];
let maximum = 0,
  inFlight = 0;
let liveHandoff = false;
let preparationChurn: () => void = () => {};
let preparationBarrier: (sessionId: string) => Promise<void> = async () => {};
const opened = vi.fn();
const canon = (value: string) => value.replace(/\\/g, "/");
function required<T>(value: T | undefined | null): T {
  if (value == null) throw new Error("Required fixture state is missing");
  return value;
}
function owned(value: string) {
  const resolved = path.resolve(value);
  if (resolved !== container && !resolved.startsWith(`${container}${path.sep}`))
    throw new Error("Fixture path outside owned temporary directory");
  return resolved;
}
function git(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-c", "core.autocrlf=false", ...args], {
    cwd: owned(cwd),
    encoding: "utf8",
    timeout: 10000,
  });
}
function persist(name: string, value: unknown) {
  const bytes = JSON.stringify(value);
  writes = writes.then(() => fs.writeFile(path.join(container, name), bytes));
  return writes;
}
async function storeContent(bytes: Uint8Array) {
  const id = createHash("sha256").update(bytes).digest("hex");
  await fs.writeFile(path.join(container, "content", id), bytes);
  return { id, contentHash: id, byteSize: bytes.length };
}
function context(sessionId: string, checkout = root): ToolContext {
  return {
    getCwd: () => checkout,
    getWorkspaceRoot: () => checkout,
    getWorkspaceId: () =>
      createConversationProfile({
        agentId: null,
        modelId: null,
        workspaceRoot: root,
        workspaceEnvironment: "local",
      }).workspaceId,
    getWorkspaceEnv: () => ({ kind: "local" }),
    getMutationMode: () =>
      checkout === root ? "read-only" : "isolated-worktree",
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => sessionId,
    getAgentId: () =>
      useChatStore.getState().sessions.find((s) => s.id === sessionId)?.profile
        ?.agentId ?? "",
  };
}
beforeEach(async () => {
  liveHandoff = false;
  preparationChurn = () => {};
  preparationBarrier = async () => {};
  vi.mocked(sendMessageToSession).mockClear();
  vi.mocked(invoke).mockImplementation(async command => command === "custom_tool_history" ? [] : null);
  vi.mocked(preparePeerTaskHandoff).mockResolvedValue(null as unknown as Awaited<ReturnType<typeof preparePeerTaskHandoff>>);
  requests = [];
  maximum = 0;
  inFlight = 0;
  writes = Promise.resolve();
  opened.mockClear();
  container = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "clack-acceptance-"),
  );
  root = canon(path.join(container, "workspace"));
  await fs.mkdir(root);
  await fs.mkdir(path.join(container, "content"));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Acceptance");
  git(root, "config", "user.email", "acceptance@invalid.local");
  git(root, "config", "commit.gpgsign", "false");
  await fs.writeFile(path.join(root, "seed.txt"), "Original user file\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "acceptance base");
  const sessions = [
    ["parent", "architect"],
    ["coder", "coder"],
    ["reviewer", "reviewer"],
    ["worker-a", "architect"],
    ["worker-b", "architect"],
  ].map(([id, agentId]) => ({
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    profile: createConversationProfile({
      agentId,
      modelId: `fixture-${agentId}`,
      workspaceRoot: root,
      workspaceEnvironment: "local",
    }),
  }));
  useChatStore.setState({
    sessions,
    sessionsHydrated: true,
    activeSessionId: "parent",
    live: {
      ...originalChat.live,
      getWorkspaceRoot: () => root,
      openWorkspaceFile: opened,
    },
  });
  usePeerTaskStore.setState({
    tasks: [],
    hydrated: true,
    recoveryReady: true,
    recoveryError: null,
  });
  usePreferencesStore.setState({
    agentPermissionProfiles: Object.fromEntries(
      Object.keys(agents).map((id) => [
        id,
        { mode: "full-access", categories: {} },
      ]),
    ),
    agentWorkspacePermissions: [],
  });
  chats.clear();
  for (const session of sessions)
    chats.set(session.id, {
      messages:
        session.id === "parent"
          ? [
              {
                id: "private",
                role: "user",
                parts: [{ type: "text", text: canary }],
              },
            ]
          : [],
    } as unknown as Chat<UIMessage>);
  vi.spyOn(native, "canonicalize").mockImplementation(async (value) => {
    const candidate = owned(value);
    try {
      return canon(await fs.realpath(candidate));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return canon(
        path.join(
          await fs.realpath(path.dirname(candidate)),
          path.basename(candidate),
        ),
      );
    }
  });
  vi.spyOn(native, "readFile").mockImplementation(async (value) => {
    const content = await fs.readFile(owned(value), "utf8");
    return { kind: "text", content, size: Buffer.byteLength(content) };
  });
  vi.spyOn(native, "writeFile").mockImplementation(async (value, content) => {
    await fs.writeFile(owned(value), content);
  });
  vi.spyOn(native, "stat").mockImplementation(async (value) => {
    const stat = await fs.stat(owned(value));
    return {
      kind: stat.isFile() ? "file" : "dir",
      size: stat.size,
      mtime: stat.mtimeMs,
    };
  });
  vi.spyOn(native, "gitResolveRepo").mockResolvedValue({
    repoRoot: root,
    branch: "main",
    upstream: null,
    isDetached: false,
  });
  vi.spyOn(native, "gitStatus").mockImplementation(async () => ({
    repoRoot: root, branch: "main", upstream: null, ahead: 0, behind: 0, isDetached: false, truncated: false,
    changedFiles: git(root, "status", "--porcelain").trim() ? [{ path: "fixture-change", originalPath: null, indexStatus: "M", worktreeStatus: "M", staged: false, unstaged: true, untracked: false, statusLabel: "Modified" }] : [],
  }));
  vi.spyOn(native, "gitAgentWorktreeCreate").mockImplementation(
    async (_repo, id) => {
      if (git(root, "status", "--porcelain").trim())
        throw new Error("workspace has uncommitted changes");
      const baseSha = git(root, "rev-parse", "HEAD").trim();
      const checkoutRoot = canon(path.join(container, id));
      git(root, "worktree", "add", "--detach", checkoutRoot, baseSha);
      return { baseSha, checkoutRoot };
    },
  );
  vi.spyOn(native, "gitAgentWorktreeCapture").mockImplementation(
    async (_repo, id, baseSha) => {
      const checkout = path.join(container, id);
      git(checkout, "add", "-A");
      const patch = git(
        checkout,
        "diff",
        "--cached",
        "--binary",
        "--full-index",
        baseSha,
      );
      const changedPaths = git(
        checkout,
        "diff",
        "--cached",
        "--name-only",
        baseSha,
      )
        .trim()
        .split("\n")
        .filter(Boolean);
      git(root, "worktree", "remove", "--force", checkout);
      return { patch, changedPaths };
    },
  );
  vi.spyOn(native, "gitAgentWorktreeRemove").mockImplementation(async (_repo, id) => {
    git(root, "worktree", "remove", "--force", canon(path.join(container, id)));
  });
  vi.spyOn(native, "gitAgentPatchApply").mockImplementation(
    async (_repo, baseSha, patch) => {
      if (git(root, "status", "--porcelain").trim())
        throw new Error("workspace has uncommitted changes");
      if (git(root, "rev-parse", "HEAD").trim() !== baseSha)
        throw new Error("agent patch base is stale");
      const file = path.join(container, "apply.patch");
      await fs.writeFile(file, patch);
      git(root, "apply", "--check", file);
      git(root, "apply", file);
    },
  );
  server = createServer(async (request, response) => {
    try {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw) as Record<string, unknown>;
      requests.push(body);
      inFlight++;
      maximum = Math.max(maximum, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 25));
      const messages = body.messages as { role: string; content: unknown }[];
      const isWrite =
        (body.tools as unknown[] | undefined)?.length &&
        messages[messages.length - 1]?.role !== "tool";
      const read = liveHandoff && JSON.stringify(body.tools ?? []).includes('"name":"read_file"');
      const hello = liveHandoff && raw.includes("Create acceptance.txt containing hello.");
      const delta = isWrite
        ? {
            tool_calls: [
              {
                index: 0,
                id: "write-acceptance",
                type: "function",
                function: {
                  name: read ? "read_file" : "write_file",
                  arguments: JSON.stringify(read ? { path: "seed.txt" } : {
                    path: hello ? "acceptance.txt" : "README.acceptance.md",
                    ...(hello ? { content: "hello" } : {
                    content: raw.includes("Correct the timeout")
                      ? corrected
                      : flawed,
                    }),
                  }),
                },
              },
            ],
          }
        : {
            content:
              body.model === "fixture-reviewer"
                ? "REVIEW: Seeded defect: timeout 900 must be 750."
                : "ARCHITECT: Structured result returned.",
          };
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        `data: ${JSON.stringify({ id: "acceptance", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: isWrite ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    } catch {
      response.writeHead(500);
      response.end();
    } finally {
      inFlight--;
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture address");
  baseURL = `http://127.0.0.1:${address.port}/v1`;
  vi.mocked(sendMessageToSession).mockImplementation(
    async (id, message, options) => {
      const session = useChatStore.getState().sessions.find((s) => s.id === id);
      const profile = session?.profile;
      if (!profile) throw new Error("Fixture session has no profile");
      const agent = agents[profile.agentId as keyof typeof agents];
      const modelId = profile.modelId;
      if (!modelId) throw new Error("Fixture session has no model");
      const parts = (
        message as {
          parts: {
            type: string;
            data?: { contentId: string };
            text?: string;
          }[];
        }
      ).parts;
      let prompt = parts.map((part) => part.text ?? "").join("\n");
      for (const part of parts)
        if (part.data?.contentId)
          prompt += `\nExplicit immutable evidence:\n${await fs.readFile(path.join(container, "content", part.data.contentId), "utf8")}`;
      const tools =
        agent === agents.coder
          ? {
              ...(liveHandoff && options?.mutationMode === "read-only"
                ? { read_file: buildTools(context(id)).read_file }
                : { write_file: buildTools(context(id, options?.checkoutRoot)).write_file }),
            }
          : undefined;
      const request = {
        model: createOpenAICompatible({ name: "acceptance", baseURL })(modelId),
        system: buildStableSystem(modelId, agent, undefined, null),
        tools,
        stopWhen: stepCountIs(2),
        maxRetries: 0,
      };
      try {
        const result = streamText({ ...request, prompt });
        let text = await result.text;
        if (tools && "write_file" in tools) {
          const approval = (await result.content).filter(part => part.type === "tool-approval-request");
          expect(approval).toHaveLength(1);
          const pending = required(approval[0]);
          expect(pending.toolCall.toolName).toBe("write_file");
          const checkout = required(options?.checkoutRoot);
          const expectedPath = liveHandoff && prompt.includes("Create acceptance.txt containing hello.")
            ? "acceptance.txt" : "README.acceptance.md";
          const expectedContent = expectedPath === "acceptance.txt" ? "hello" :
            prompt.includes("Correct the timeout") ? corrected : flawed;
          expect(pending.toolCall.input).toEqual({ path: expectedPath, content: expectedContent });
          const destination = owned(path.join(checkout, expectedPath));
          await expect(fs.stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
          const resumed = streamText({
            ...request,
            messages: [
              { role: "user", content: prompt },
              ...(await result.response).messages,
              { role: "tool", content: [{ type: "tool-approval-response", approvalId: pending.approvalId, approved: true }] },
            ],
          });
          text += await resumed.text;
          expect(await fs.readFile(destination, "utf8")).toBe(expectedContent);
          expect(git(checkout, "status", "--porcelain").trim()).toBe(`?? ${expectedPath}`);
        }
        const chat = chats.get(id);
        if (!chat) throw new Error("Fixture chat disappeared");
        chat.messages = [
          ...chat.messages,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            parts: [{ type: "text", text }],
          },
        ];
      } finally {
        releaseWorkspaceWriteLeasesForSession(id);
      }
    },
  );
});
afterEach(async () => {
  await flushPeerTasks();
  await writes;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  vi.restoreAllMocks();
  clearWorkspaceWriteLeasesForTests();
  chats.clear();
  useChatStore.setState(originalChat, true);
  usePeerTaskStore.setState(originalTasks, true);
  usePreferencesStore.setState(originalPreferences, true);
  useAgentsStore.setState(originalAgents, true);
  const parent = await fs.realpath(os.tmpdir());
  if (
    path.dirname(container) !== parent ||
    !path.basename(container).startsWith("clack-acceptance-")
  )
    throw new Error("Unsafe fixture cleanup");
  await fs.rm(container, { recursive: true, force: true });
});

async function completed(input: Parameters<typeof requestPeerTask>[0]) {
  const response = await requestPeerTask(input);
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error(response.message);
  if (response.task.status === "waiting")
    await dispatchPeerTask(response.task.id);
  const task = usePeerTaskStore
    .getState()
    .tasks.find((t) => t.id === response.task.id);
  if (!task) throw new Error("Completed task disappeared");
  expect(task.status, JSON.stringify(task.error)).toBe("completed");
  return task;
}

async function useLiveHandoff() {
  liveHandoff = true;
  const actual = await vi.importActual<typeof import("@/modules/ai/lib/peerHandoffRuntime")>("@/modules/ai/lib/peerHandoffRuntime");
  vi.mocked(preparePeerTaskHandoff).mockImplementation(actual.preparePeerTaskHandoff);
  useAgentsStore.setState({ customAgents: Object.entries(agents).map(([id, agent]) => ({ ...agent, id, description: "Acceptance fixture", icon: "coder" as const, builtIn: false })) });
  useChatStore.setState(s => ({ apiKeys: { ...s.apiKeys, openai: "fixture-key" }, sessions: s.sessions.map(session => ({ ...session, profile: { ...required(session.profile), modelId: "gpt-4.1-mini" } })) }));
  vi.spyOn(agentRuntime, "buildConfiguredLanguageModel").mockImplementation(async () => createOpenAICompatible({ name: "acceptance", baseURL })("gpt-4.1-mini"));
  vi.spyOn(preflight, "modelBudgetLimits").mockResolvedValue({ deployed: 64_000 });
  vi.spyOn(projectMemory, "projectMemoryClient").mockImplementation(sessionId => {
    const workspace = useChatStore.getState().sessions.find(s => s.id === sessionId)?.profile?.workspaceId;
    return { load: async () => { await preparationBarrier(sessionId); preparationChurn(); return { workspace, revision: 1, entries: [] }; } } as unknown as ReturnType<typeof projectMemory.projectMemoryClient>;
  });
}

function benignPreparationChurn() {
  useChatStore.setState(s => ({ sessions: s.sessions.map(session => ({ ...session, title: `Refreshed ${session.id}`, updatedAt: session.updatedAt + 1, profile: { ...required(session.profile) } })) }));
  usePreferencesStore.setState(s => ({ backgroundBlur: s.backgroundBlur ? 0 : 12 }));
  usePeerTaskStore.setState(s => ({ tasks: structuredClone(s.tasks).map(task => ({ ...task, updatedAt: task.updatedAt + 1 })) }));
  for (const chat of chats.values()) chat.messages = structuredClone(chat.messages);
}

it("live handoff: 25 sequential same/distinct-Agent delegations survive benign store churn without duplicate requests or private-history leakage", async () => {
  await useLiveHandoff();
  preparationChurn = benignPreparationChurn;
  const targets = ["worker-a", "worker-b", "reviewer", "coder"];
  for (let index = 0; index < 25; index++) {
    const result = await completed({ sourceSessionId: "parent", targetSessionId: targets[index % targets.length], kind: "delegate", prompt: `Inspect README and summarize it. Iteration ${index}.`, executionMode: "read-only" });
    expect(result.handoff?.recipientSessionId).toBe(result.targetSessionId);
    expect(result.error).toBeUndefined();
  }
  expect(sendMessageToSession).toHaveBeenCalledTimes(25);
  const calls = vi.mocked(sendMessageToSession).mock.calls;
  expect(new Set(calls.map(call => call[2]?.peerTaskId)).size).toBe(25);
  for (const [sessionId, message, options] of calls) {
    const current = required(usePeerTaskStore.getState().tasks.find(t => t.id === options?.peerTaskId));
    expect(sessionId).toBe(current.targetSessionId);
    expect(JSON.stringify(message)).toContain(current.id);
    expect(current.status).toBe("completed");
  }
  expect(JSON.stringify(requests)).not.toContain(canary);
  expect(requests).toHaveLength(31); // 25 first requests plus six actual Coder read-tool result requests.
  expect(usePeerTaskStore.getState().tasks.filter(t => t.error?.code === "peer_handoff_preparation_stale")).toEqual([]);
}, 20000);

it("live handoff: independent parallel preparations and real isolated edits survive churn and retain review/apply boundaries", async () => {
  await useLiveHandoff();
  preparationChurn = benignPreparationChurn;
  const entered = new Set<string>();
  let allEntered!: () => void, release!: () => void;
  const allPreparing = new Promise<void>(resolve => { allEntered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  preparationBarrier = async id => { entered.add(id); if (entered.size === 3) allEntered(); await held; };
  const preparing = Promise.all(["worker-a", "worker-b", "reviewer"].map(id => completed({ sourceSessionId: "parent", targetSessionId: id, kind: "delegate", prompt: `Inspect README for ${id}`, executionMode: "read-only" })));
  await allPreparing;
  expect(sendMessageToSession).not.toHaveBeenCalled();
  benignPreparationChurn();
  release();
  const results = await preparing;
  preparationBarrier = async () => {};
  expect(new Set(results.map(t => t.id)).size).toBe(3);
  expect(sendMessageToSession).toHaveBeenCalledTimes(3);
  const edit = await completed({ sourceSessionId: "parent", targetSessionId: "coder", kind: "delegate", prompt: "Create acceptance.txt containing hello.", executionMode: "isolated-worktree" });
  expect(edit.changeSet?.changedPaths).toEqual(["acceptance.txt"]);
  expect(edit.changeSet?.patch).toContain("+hello");
  expect(git(root, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  await expect(fs.stat(path.join(root, "acceptance.txt"))).rejects.toThrow();
  await expect(applyPeerTaskChangeSet(edit.id)).resolves.toEqual({ ok: true });
  expect(await fs.readFile(path.join(root, "acceptance.txt"), "utf8")).toBe("hello");
  expect(JSON.stringify(requests)).not.toContain(canary);
}, 20000);

it.each([false, true])("live handoff: stale setup with cleanup failure %s preserves truthful Retry and real worktree recovery", async cleanupFails => {
  await useLiveHandoff();
  let changed = false;
  preparationChurn = () => {
    if (changed) return;
    changed = true;
    usePreferencesStore.setState({ customInstructions: "Changed during setup" });
  };
  if (cleanupFails) vi.mocked(native.gitAgentWorktreeRemove).mockRejectedValueOnce(new Error("fixture cleanup failed"));
  const assigned = await requestPeerTask({ sourceSessionId: "parent", targetSessionId: "coder", kind: "delegate", prompt: "Create acceptance.txt containing hello.", executionMode: "isolated-worktree" });
  if (!assigned.ok) throw new Error(assigned.message);
  const failed = required(usePeerTaskStore.getState().tasks.find(t => t.id === assigned.task.id));
  expect(failed).toMatchObject({ status: "failed", error: { code: "peer_handoff_preparation_stale", reason: "policy_changed" } });
  expect(sendMessageToSession).not.toHaveBeenCalled();
  if (cleanupFails) {
    expect(failed.worktree).toBeDefined();
    expect(failed.preRunFailure).toBeUndefined();
    await expect(checkTaskRetry(failed.id, "parent")).rejects.toThrow("reviewing");
    expect(git(root, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(2);
    await expect(fs.stat(required(failed.worktree).checkoutRoot)).resolves.toBeDefined();
    await expect(discardPeerTaskWorktree(failed.id)).resolves.toEqual({ ok: true });
    expect(usePeerTaskStore.getState().tasks.find(t => t.id === failed.id)?.worktree).toBeUndefined();
    expect(git(root, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  } else {
    expect(failed.worktree).toBeUndefined();
    expect(failed.preRunFailure).toBe(true);
    await expect(checkTaskRetry(failed.id, "parent")).resolves.toEqual(failed);
    const retried = await retryTaskWithoutEffects(failed.id, "parent");
    expect(retried.retryOfTaskId).toBe(failed.id);
    const outcome = await new Promise<PeerTask>(resolve => {
      const check = () => {
        const current = required(usePeerTaskStore.getState().tasks.find(t => t.id === retried.id));
        if (["completed", "failed", "cancelled", "blocked"].includes(current.status)) { unsubscribe(); resolve(current); }
      };
      const unsubscribe = usePeerTaskStore.subscribe(check);
      check();
    });
    expect(outcome.status, JSON.stringify(outcome.error)).toBe("completed");
    expect(sendMessageToSession).toHaveBeenCalledTimes(1);
    expect(git(root, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  }
}, 20000);

it("live handoff: a failure after transmission retains real isolated changes instead of treating them as reversible setup", async () => {
  await useLiveHandoff();
  const send = required(vi.mocked(sendMessageToSession).getMockImplementation());
  vi.mocked(sendMessageToSession).mockImplementation(async (...args) => { await send(...args); throw new Error("Provider disconnected after file creation"); });
  const result = await requestPeerTask({ sourceSessionId: "parent", targetSessionId: "coder", kind: "delegate", prompt: "Create acceptance.txt containing hello.", executionMode: "isolated-worktree" });
  if (!result.ok) throw new Error(result.message);
  const failed = required(usePeerTaskStore.getState().tasks.find(t => t.id === result.task.id));
  expect(failed.status).toBe("failed");
  expect(failed.preRunFailure).toBeUndefined();
  expect(await fs.readFile(path.join(required(failed.worktree).checkoutRoot, "acceptance.txt"), "utf8")).toBe("hello");
  expect(native.gitAgentWorktreeRemove).not.toHaveBeenCalled();
  await expect(checkTaskRetry(failed.id, "parent")).rejects.toThrow("reviewing");
}, 20000);
it("Architect -> Coder -> Reviewer -> correction returns immutable real file changes and survives ledger reinitialization", async () => {
  const implementation = await completed({
    sourceSessionId: "parent",
    targetSessionId: "coder",
    kind: "delegate",
    prompt: "Create README.acceptance.md with timeout 900",
    executionMode: "isolated-worktree",
  });
  expect(implementation.changeSet?.changedPaths).toEqual([
    "README.acceptance.md",
  ]);
  expect(implementation.artifactRefs).toEqual([]);
  expect(taskWorkGroup(implementation)).toBe("attention");
  await expect(
    fs.stat(path.join(root, "README.acceptance.md")),
  ).rejects.toThrow();
  await expect(
    openTaskFile(implementation.id, "parent", {
      changedPath: "README.acceptance.md",
    }),
  ).rejects.toThrow("apply");
  const artifact = implementation.result?.artifacts[0];
  if (!artifact) throw new Error("Implementation has no result artifact");
  expect(
    (await readTaskArtifact(implementation.id, "parent", artifact.id)).text,
  ).toContain("+Timeout: 900");
  const review = await completed({
    sourceSessionId: "parent",
    targetSessionId: "reviewer",
    kind: "review",
    prompt: "Review the actual patch for the seeded timeout defect",
    followUpTo: implementation.id,
    attachmentReferences: [peerTaskArtifactToMessagePart(artifact).data],
  });
  expect(review.review?.files).toEqual([]);
  expect(review.review?.patches[0].taskId).toBe(implementation.id);
  expect(review.result?.summary).toContain("900 must be 750");
  expect(review.rootTaskId).toBe(implementation.id);
  expect(review.parentTaskId).toBe(implementation.id);
  const correction = await completed({
    sourceSessionId: "parent",
    targetSessionId: "coder",
    kind: "delegate",
    prompt: "Correct the timeout to 750 in README.acceptance.md",
    executionMode: "isolated-worktree",
    followUpTo: review.id,
  });
  expect(correction.targetSessionId).toBe("coder");
  expect(correction.rootTaskId).toBe(implementation.id);
  expect(await applyPeerTaskChangeSet(correction.id)).toEqual({ ok: true });
  await openTaskFile(correction.id, "parent", {
    changedPath: "README.acceptance.md",
  });
  expect(opened).toHaveBeenCalledWith(
    canon(path.join(root, "README.acceptance.md")),
  );
  expect(
    await fs.readFile(path.join(root, "README.acceptance.md"), "utf8"),
  ).toBe(corrected);
  expect(await fs.readFile(path.join(root, "seed.txt"), "utf8")).toBe(
    "Original user file\n",
  );
  await flushPeerTasks();
  await writes;
  const persisted = JSON.parse(
    await fs.readFile(path.join(container, "tasks.json"), "utf8"),
  ) as PeerTask[];
  usePeerTaskStore.setState({ tasks: recoverInterruptedPeerTasks(persisted) });
  expect(usePeerTaskStore.getState().tasks).toHaveLength(3);
  expect(
    availableDispatcherTasks(
      usePeerTaskStore.getState().tasks,
      useChatStore.getState().sessions,
    ),
  ).toHaveLength(3);
  expect(JSON.stringify(requests)).not.toContain(canary);
  expect(
    requests.some(
      (body) =>
        body.model === "fixture-reviewer" &&
        JSON.stringify(body).includes("+Timeout: 900"),
    ),
  ).toBe(true);
  const system = (
    requests.find((body) => body.model === "fixture-reviewer")?.messages as {
      role: string;
      content: string;
    }[]
  ).find((m) => m.role === "system")?.content;
  expect(system).toContain(agents.reviewer.instructions);
  expect(system).not.toContain(agents.architect.instructions);
  const calls = vi.mocked(sendMessageToSession).mock.calls.length;
  expect(await applyPeerTaskChangeSet(correction.id)).toMatchObject({
    ok: false,
  });
  expect(vi.mocked(sendMessageToSession)).toHaveBeenCalledTimes(calls);
}, 20000);
it("same-Agent distinct workers run independently in parallel without copying the parent's private history", async () => {
  const responses = await Promise.all(
    ["worker-a", "worker-b"].map((targetSessionId) =>
      requestPeerTask({
        sourceSessionId: "parent",
        targetSessionId,
        kind: "delegate",
        prompt: `Inspect the design in ${targetSessionId}`,
        awaitCompletion: false,
      }),
    ),
  );
  expect(responses.every((response) => response.ok)).toBe(true);
  await vi.waitFor(() =>
    expect(
      usePeerTaskStore
        .getState()
        .tasks.every((task) => task.status === "completed"),
    ).toBe(true),
  );
  const tasks = usePeerTaskStore.getState().tasks;
  expect(tasks).toHaveLength(2);
  expect(new Set(tasks.map((task) => task.targetSessionId)).size).toBe(2);
  expect(
    tasks.every(
      (task) =>
        task.targetAgentId === task.sourceAgentId &&
        task.targetSessionId !== task.sourceSessionId,
    ),
  ).toBe(true);
  expect(maximum).toBe(2);
  expect(JSON.stringify(requests)).not.toContain(canary);
  expect(chats.get("parent")?.messages[0].parts).toEqual([
    { type: "text", text: canary },
  ]);
});
it("a conflicting user file prevents apply while retaining the isolated patch and truthful task state", async () => {
  const task = await completed({
    sourceSessionId: "parent",
    targetSessionId: "coder",
    kind: "delegate",
    prompt: "Create README.acceptance.md",
    executionMode: "isolated-worktree",
  });
  await fs.writeFile(
    path.join(root, "README.acceptance.md"),
    "User's newer content\n",
  );
  expect(await applyPeerTaskChangeSet(task.id)).toMatchObject({ ok: false });
  const retained = usePeerTaskStore
    .getState()
    .tasks.find((t) => t.id === task.id);
  if (!retained) throw new Error("Conflicting task disappeared");
  expect(retained.changeSet?.appliedAt).toBeUndefined();
  expect(retained.changeSet?.patch).toContain("+Timeout: 900");
  expect(retained.changeSet?.applyError).toContain("uncommitted");
  expect(
    await fs.readFile(path.join(root, "README.acceptance.md"), "utf8"),
  ).toBe("User's newer content\n");
  expect(opened).not.toHaveBeenCalled();
}, 20000);
