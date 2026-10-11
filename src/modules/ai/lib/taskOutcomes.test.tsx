import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { PeerTask, PeerTaskArtifact } from "@/modules/ai/lib/peerTasks";
import type { SessionMeta } from "@/modules/ai/lib/sessions";
import type { NormalizedAiError } from "@/modules/ai/lib/errors";
import { createConversationProfile } from "@/modules/ai/lib/sessions";
import {
  taskWorkGroup,
  taskOutcomeLabel,
  taskFailure,
  taskRetryEligibility,
  artifactFilePath,
} from "@/modules/ai/lib/taskPresentation";
import { capabilityGroups } from "@/modules/ai/lib/toolCapabilities";
import {
  canAccessTaskResult,
  openTaskFile,
  readTaskArtifact,
  retryTaskWithoutEffects,
} from "@/modules/ai/lib/taskResultActions";
import { native } from "@/modules/ai/lib/native";
import { loadAttachmentContent } from "@/modules/ai/lib/attachmentStore";
import { executionHistory } from "@/modules/ai/lib/customToolExecution";
import { requestPeerTask } from "@/modules/ai/lib/peerTaskCoordinator";
import { getChat, useChatStore } from "@/modules/ai/store/chatStore";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";
import { PeerTaskOutcome } from "@/modules/ai/components/PeerTaskOutcome";

vi.mock("@/modules/ai/lib/attachmentStore", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/attachmentStore")>()),
  loadAttachmentContent: vi.fn(),
}));
vi.mock("@/modules/ai/lib/customToolExecution", () => ({
  executionHistory: vi.fn(),
}));
vi.mock("@/modules/ai/lib/peerTaskCoordinator", () => ({
  requestPeerTask: vi.fn(),
  applyPeerTaskChangeSet: vi.fn(),
}));
vi.mock("@/modules/ai/store/peerTaskStore", async (original) => {
  const actual = await original<typeof import("@/modules/ai/store/peerTaskStore")>();
  return { ...actual, usePeerTaskStore: Object.assign(
    (select: (s: ReturnType<typeof actual.usePeerTaskStore.getState>) => unknown) => select(actual.usePeerTaskStore.getState()),
    actual.usePeerTaskStore,
  ) };
});
vi.mock("@/modules/ai/store/chatStore", async (original) => {
  const actual =
    await original<typeof import("@/modules/ai/store/chatStore")>();
  return {
    ...actual,
    getChat: vi.fn(),
    useChatStore: Object.assign(
      (
        select: (s: ReturnType<typeof actual.useChatStore.getState>) => unknown,
      ) => select(actual.useChatStore.getState()),
      actual.useChatStore,
    ),
  };
});
const initialChat = useChatStore.getState();
const initialTasks = usePeerTaskStore.getState();
let task: PeerTask;
let target: SessionMeta;
const opener = vi.fn();
const messages: UIMessage[] = [
  {
    id: "request",
    role: "user",
    parts: [{ type: "text", text: "Review README" }],
  },
];
const artifact = (): PeerTaskArtifact => ({
  id: "artifact",
  attachmentId: "attachment",
  contentRef: { id: "a".repeat(64), contentHash: "a".repeat(64), byteSize: 3 },
  displayName: "README.md",
  mediaType: "text/plain",
  contentKind: "text",
  byteSize: 3,
  sourceSessionId: "target",
  sourceTaskId: "task",
  sourceAgentId: "reviewer",
  sourceModelId: "gpt-5.4-mini",
  workspaceId: "local:/fixture",
  workspaceRoot: "/fixture",
  createdAt: 1,
  originType: "workspace-file",
  sourcePath: "README.md",
  accessPolicy: "model-input",
});
const result = (artifacts: PeerTaskArtifact[] = [], summary = "Reviewed") => ({
  summary,
  artifacts,
  targetSessionId: "target",
  targetAgentId: "reviewer",
  targetModelId: "gpt-5.4-mini",
  completedAt: 2,
});
beforeEach(() => {
  vi.resetAllMocks();
  task = {
    schemaVersion: 7,
    id: "task",
    sourceSessionId: "source",
    targetSessionId: "target",
    sourceAgentId: "coder",
    sourceModelId: "gpt-5.4-mini",
    targetAgentId: "reviewer",
    targetModelId: "gpt-5.4-mini",
    workspaceId: "local:/fixture",
    workspaceRoot: "/fixture",
    workspaceEnvironment: { kind: "local" },
    kind: "delegate",
    executionMode: "read-only",
    prompt: "Review README",
    artifactRefs: [],
    parentTaskId: null,
    rootTaskId: "task",
    hopCount: 0,
    dependsOn: [],
    status: "completed",
    createdAt: 1,
    updatedAt: 2,
  };
  target = {
    id: "target",
    title: "Review",
    createdAt: 1,
    updatedAt: 1,
    profile: createConversationProfile({
      agentId: "reviewer",
      modelId: "gpt-5.4-mini",
      workspaceRoot: "/fixture",
      workspaceEnvironment: "local",
    }),
  };
  useChatStore.setState({
    sessions: [{ ...target, id: "source" }, target],
    live: {
      ...initialChat.live,
      getWorkspaceRoot: () => "/fixture",
      openWorkspaceFile: opener,
      openWorkspaceSourceControl: vi.fn(),
    },
  });
  usePeerTaskStore.setState({ tasks: [task], recoveryReady: true, retryingTaskIds: [] });
  vi.spyOn(native, "gitStatus").mockResolvedValue({ repoRoot: "/fixture", branch: "main", upstream: null, ahead: 0, behind: 0, isDetached: false, truncated: false, changedFiles: [] });
  vi.spyOn(native, "canonicalize").mockImplementation(async (path) => path);
  vi.spyOn(native, "stat").mockResolvedValue({
    kind: "file",
    size: 3,
    mtime: 1,
  });
  vi.spyOn(native, "gitResolveRepo").mockResolvedValue({
    repoRoot: "/fixture",
  } as Awaited<ReturnType<typeof native.gitResolveRepo>>);
  vi.mocked(executionHistory).mockResolvedValue([]);
  vi.mocked(getChat).mockReturnValue({ messages } as NonNullable<
    ReturnType<typeof getChat>
  >);
  vi.mocked(requestPeerTask).mockResolvedValue({ ok: true, task });
});
afterEach(() => {
  useChatStore.setState(initialChat, true);
  usePeerTaskStore.setState(initialTasks, true);
  vi.restoreAllMocks();
});
function failed() {
  task.status = "failed";
  task.error = {
    code: "peer_run_failed",
    message: "OpenRouter rate limit reached",
  };
  target.run = {
    state: "failed",
    peerTaskId: task.id,
    agentId: task.targetAgentId,
    modelId: task.targetModelId,
    startedAt: 10,
    error: { kind: "rate_limit" } as NormalizedAiError,
  };
}
describe("task presentation and capabilities", () => {
  it.each([
    "failed",
    "blocked",
  ] as const)("surfaces %s under attention", (status) => {
    task.status = status;
    expect(taskWorkGroup(task)).toBe("attention");
  });
  it.each([
    "running",
    "queued",
    "waiting",
  ] as const)("groups %s as active", (status) => {
    task.status = status;
    expect(taskWorkGroup(task)).toBe("active");
  });
  it("keeps completed work and unapplied edits distinct", () => {
    expect(taskWorkGroup(task)).toBe("completed");
    task.changeSet = {
      baseSha: "base",
      patch: "patch",
      changedPaths: ["README.md"],
    };
    expect(taskWorkGroup(task)).toBe("attention");
    expect(taskOutcomeLabel(task)).toBe("1 file changed - Review required");
    task.changeSet.appliedAt = 3;
    expect(taskWorkGroup(task)).toBe("completed");
    expect(taskOutcomeLabel(task)).toContain("Applied");
  });
  it("uses returned records, never claimed file creation", () => {
    expect(taskOutcomeLabel(task)).toBe("No files or artifacts returned");
    task.result = result([], "I created README.md");
    expect(taskOutcomeLabel(task)).toBe("Result available");
    expect(
      artifactFilePath(task, { ...artifact(), originType: "attachment" }),
    ).toBeNull();
    task.result = result([artifact()]);
    expect(taskOutcomeLabel(task)).toBe("Returned README.md");
  });
  it("does not offer main-workspace paths for unapplied or worktree artifacts", () => {
    task.executionMode = "isolated-worktree";
    expect(artifactFilePath(task, artifact())).toBeNull();
    task.changeSet = {
      baseSha: "base",
      patch: "patch",
      changedPaths: ["README.md"],
      appliedAt: 3,
    };
    expect(artifactFilePath(task, artifact())).toBe("README.md");
    expect(
      artifactFilePath(task, { ...artifact(), originType: "worktree-file" }),
    ).toBeNull();
  });
  it("explains dirty-worktree and rate-limit failures without promising no effects", () => {
    failed();
    expect(taskFailure(task).title).toBe(
      "This model is temporarily rate-limited.",
    );
    task.error = {
      code: "peer_run_failed",
      message: "workspace has uncommitted changes: commit or stash",
    };
    expect(taskFailure(task)).toMatchObject({ kind: "dirty" });
    expect(taskFailure(task).detail).toContain(
      "Clack will not commit or stash",
    );
  });
  it("describes actual tools with categories, permissions and raw identities", () => {
    const grouped = capabilityGroups(
      [
        { name: "grep", decision: "allow" },
        { name: "write_file", decision: "prompt" },
        { name: "bash_run", decision: "deny" },
        { name: "request_peer_task", decision: "prompt" },
      ],
      "supported",
    );
    expect(grouped).toMatchObject([
      {
        category: "Files",
        entries: [
          {
            name: "grep",
            label: "Search project file contents",
            state: "Available",
          },
          { state: "Ask before use" },
        ],
      },
      { category: "Terminal", entries: [{ state: "Not allowed" }] },
      {
        category: "Collaboration",
        entries: [{ label: "Assign work to another Agent" }],
      },
    ]);
  });
  it.each([
    "unsupported",
    "unknown",
    undefined,
  ])("never promises model support for %s", (support) => {
    expect(
      capabilityGroups([{ name: "grep", decision: "allow" }], support)[0]
        .entries[0].state,
    ).toBe(
      support === "unsupported"
        ? "Unsupported by this model"
        : "Model support unverified",
    );
  });
  it("keeps read-only mutations denied even with Agent permission", () => {
    expect(
      capabilityGroups(
        [{ name: "write_file", decision: "allow" }],
        "supported",
        true,
      )[0].entries[0].state,
    ).toBe("Not allowed");
  });
});
describe("safe result navigation", () => {
  it("opens an actual owned workspace artifact through existing navigation", async () => {
    task.result = result([artifact()]);
    await openTaskFile(task.id, "source", { artifactId: "artifact" });
    expect(opener).toHaveBeenCalledWith("/fixture/README.md");
  });
  it("requires apply before opening changed paths", async () => {
    task.changeSet = {
      baseSha: "base",
      patch: "patch",
      changedPaths: ["README.md"],
    };
    await expect(
      openTaskFile(task.id, "source", { changedPath: "README.md" }),
    ).rejects.toThrow("apply");
    task.changeSet.appliedAt = 3;
    await openTaskFile(task.id, "source", { changedPath: "README.md" });
    expect(opener).toHaveBeenCalledWith("/fixture/README.md");
  });
  it.each([
    "../other/file",
    "/elsewhere/README.md",
    ".env",
    ".ssh/key",
    "sub/../README.md",
    "\\\\server\\share\\file",
  ])("denies unsafe artifact path %s", async (path) => {
    task.result = result([{ ...artifact(), sourcePath: path }]);
    await expect(
      openTaskFile(task.id, "source", { artifactId: "artifact" }),
    ).rejects.toThrow();
    expect(opener).not.toHaveBeenCalled();
  });
  it("rejects a canonical symlink escape", async () => {
    task.result = result([artifact()]);
    vi.mocked(native.canonicalize).mockImplementation(async (path) =>
      path.endsWith("README.md") ? "/elsewhere/private.txt" : path,
    );
    await expect(
      openTaskFile(task.id, "source", { artifactId: "artifact" }),
    ).rejects.toThrow("denied");
    expect(opener).not.toHaveBeenCalled();
  });
  it.each([
    "foreign",
    "deleted",
    "switched",
  ])("denies %s workspace/conversation", async (kind) => {
    task.result = result([artifact()]);
    if (kind === "foreign") task.workspaceId = "local:/foreign";
    if (kind === "deleted") useChatStore.setState({ sessions: [target] });
    if (kind === "switched")
      useChatStore.setState({
        live: { ...initialChat.live, getWorkspaceRoot: () => "/foreign" },
      });
    expect(canAccessTaskResult(task, "source")).toBe(false);
    await expect(
      openTaskFile(task.id, "source", { artifactId: "artifact" }),
    ).rejects.toThrow("owning conversation");
    expect(opener).not.toHaveBeenCalled();
  });
  it("rejects a workspace change during asynchronous stat", async () => {
    task.result = result([artifact()]);
    vi.mocked(native.stat).mockImplementation(async () => {
      useChatStore.setState({ sessions: [] });
      return { kind: "file", size: 3, mtime: 1 };
    });
    await expect(
      openTaskFile(task.id, "source", { artifactId: "artifact" }),
    ).rejects.toThrow();
    expect(opener).not.toHaveBeenCalled();
  });
  it("reports a missing file without opening a substitute", async () => {
    task.result = result([artifact()]);
    vi.mocked(native.stat).mockRejectedValue(new Error("File missing"));
    await expect(
      openTaskFile(task.id, "source", { artifactId: "artifact" }),
    ).rejects.toThrow("missing");
    expect(opener).not.toHaveBeenCalled();
  });
  it("reads immutable artifact bytes with identity checks", async () => {
    const bytes = new TextEncoder().encode("abc");
    const hash =
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    task.result = result([
      {
        ...artifact(),
        contentRef: { id: hash, contentHash: hash, byteSize: 3 },
      },
    ]);
    vi.mocked(loadAttachmentContent).mockResolvedValue(bytes);
    expect(await readTaskArtifact(task.id, "source", "artifact")).toEqual({
      name: "README.md",
      text: "abc",
      truncated: false,
    });
    expect(native.stat).not.toHaveBeenCalled();
  });
  it("rejects corrupt immutable content without rereading a path", async () => {
    task.result = result([artifact()]);
    vi.mocked(loadAttachmentContent).mockResolvedValue(
      new Uint8Array([1, 2, 3]),
    );
    await expect(
      readTaskArtifact(task.id, "source", "artifact"),
    ).rejects.toThrow("integrity");
    expect(native.stat).not.toHaveBeenCalled();
  });
  it("bounds oversized artifact metadata before loading content", async () => {
    const value = artifact();
    value.contentRef.byteSize = 21 * 1024 * 1024;
    task.result = result([value]);
    await expect(
      readTaskArtifact(task.id, "source", "artifact"),
    ).rejects.toThrow("unavailable");
    expect(loadAttachmentContent).not.toHaveBeenCalled();
  });
  it("reports missing immutable content without trying the workspace path", async () => {
    task.result = result([artifact()]);
    vi.mocked(loadAttachmentContent).mockRejectedValue(
      new Error("Content missing"),
    );
    await expect(
      readTaskArtifact(task.id, "source", "artifact"),
    ).rejects.toThrow("missing");
    expect(native.stat).not.toHaveBeenCalled();
  });
  it("honors recovery-marked unavailable artifacts at both action boundaries", async () => {
    task.result = result([artifact()]);
    task.recovery = {
      contentIssues: [
        {
          artifactId: "artifact",
          contentId: "a".repeat(64),
          role: "returned",
          representation: "content",
          code: "attachment_content_missing",
          message: "Missing",
        },
      ],
    };
    await expect(
      readTaskArtifact(task.id, "source", "artifact"),
    ).rejects.toThrow("unavailable");
    await expect(
      openTaskFile(task.id, "source", { artifactId: "artifact" }),
    ).rejects.toThrow("unavailable");
    expect(loadAttachmentContent).not.toHaveBeenCalled();
    expect(opener).not.toHaveBeenCalled();
  });
  it("keeps foreign artifacts unavailable even in an owned result record", async () => {
    task.result = result([{ ...artifact(), workspaceId: "local:/foreign" }]);
    await expect(
      readTaskArtifact(task.id, "source", "artifact"),
    ).rejects.toThrow("unavailable");
    await expect(
      openTaskFile(task.id, "source", { artifactId: "artifact" }),
    ).rejects.toThrow("immutable content");
    expect(loadAttachmentContent).not.toHaveBeenCalled();
  });
  it("retains ownership through chat title, model and Agent changes", () => {
    useChatStore.setState((s) => ({
      sessions: s.sessions.map((session) => ({
        ...session,
        title: "Renamed",
        profile: session.profile
          ? {
              ...session.profile,
              agentId: "other-agent",
              modelId: "other-model",
            }
          : undefined,
      })),
    }));
    expect(canAccessTaskResult(task, "source")).toBe(true);
  });
});
describe("effects-safe retry", () => {
  it.each(["provider_unavailable", "model_loading", "backend_restart", "network", "timeout"] as const)("allows proven pre-effect %s failures", async (kind) => {
    failed();
    if (!target.run?.error) throw new Error("Missing run");
    target.run.error.kind = kind;
    task.error = { code: "peer_run_failed", message: "Provider could not start" };
    expect(taskRetryEligibility(task, target, messages)).toBe(true);
    await retryTaskWithoutEffects(task.id, "source");
    expect(requestPeerTask).toHaveBeenCalledWith(expect.objectContaining({ retryOfTaskId: task.id, awaitCompletion: false }));
  });
  it("allows context preflight failure without weakening B1", () => {
    failed();
    if (!target.run?.error) throw new Error("Missing run");
    target.run.error = { ...target.run.error, kind: "bad_request", title: "Context preflight" };
    expect(taskRetryEligibility(task, target, messages)).toBe(true);
  });
  it("never retries authentication or authorization failures", async () => {
    failed();
    if (!target.run?.error) throw new Error("Missing run");
    target.run.error.kind = "authentication";
    task.error = { code: "authentication", message: "Invalid API key" };
    expect(taskRetryEligibility(task, target, messages)).toBe(false);
    expect(renderToStaticMarkup(<PeerTaskOutcome task={task} sessionId="source" />)).toContain("Fix connection");
    await expect(retryTaskWithoutEffects(task.id, "source")).rejects.toThrow("reviewing");
  });
  it("checks dirty workspace prerequisites without modifying files", async () => {
    failed();
    task.preRunFailure = true;
    task.executionMode = "isolated-worktree";
    task.error = { code: "peer_run_failed", message: "workspace has uncommitted changes" };
    target.run = undefined;
    vi.mocked(native.gitStatus).mockResolvedValueOnce({ truncated: false, changedFiles: [{}] } as Awaited<ReturnType<typeof native.gitStatus>>);
    await expect(retryTaskWithoutEffects(task.id, "source")).rejects.toThrow("Source Control");
    expect(requestPeerTask).not.toHaveBeenCalled();
    await retryTaskWithoutEffects(task.id, "source");
    expect(requestPeerTask).toHaveBeenCalledTimes(1);
  });
  it.each(["unknown", "completed"])("blocks %s external effect independently of visible tool output", async (effect) => {
    failed();
    vi.mocked(executionHistory).mockResolvedValue([{ runId: 10, effect }] as Awaited<ReturnType<typeof executionHistory>>);
    await expect(retryTaskWithoutEffects(task.id, "source")).rejects.toThrow("Previous tool executions");
    expect(requestPeerTask).not.toHaveBeenCalled();
  });
  it("retains both lineage directions on the shared outcome surface", () => {
    failed();
    const next = { ...task, id: "attempt", parentTaskId: task.id, retryOfTaskId: task.id, status: "completed" as const };
    usePeerTaskStore.setState({ tasks: [next, task] });
    expect(renderToStaticMarkup(<PeerTaskOutcome task={task} sessionId="source" />)).toContain("Retried as - completed");
    expect(renderToStaticMarkup(<PeerTaskOutcome task={next} sessionId="source" />)).toContain("Previous attempt - failed");
  });
  it("starts a new existing-coordinator task, retaining the failed original", async () => {
    failed();
    expect(taskRetryEligibility(task, target, messages)).toBe(true);
    await retryTaskWithoutEffects(task.id, "source");
    expect(requestPeerTask).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSessionId: "source",
        targetSessionId: "target",
        prompt: "Review README",
      }),
    );
    expect(task.status).toBe("failed");
  });
  it.each([
    "tool",
    "text",
    "no-source",
  ])("rejects %s evidence instead of blind replay", (kind) => {
    failed();
    const tail: UIMessage[] =
      kind === "no-source"
        ? []
        : [
            ...messages,
            {
              id: "reply",
              role: "assistant",
              parts:
                kind === "text"
                  ? [{ type: "text", text: "I did work" }]
                  : [
                      {
                        type: "tool-write_file",
                        toolCallId: "done",
                        state: "output-available",
                        input: {},
                        output: {},
                      },
                    ],
            },
          ];
    expect(taskRetryEligibility(task, target, tail)).toBe(false);
  });
  it.each([
    "model",
    "agent",
    "run",
    "error",
  ])("rejects changed %s ownership", (kind) => {
    failed();
    if (!target.profile || !target.run?.error)
      throw new Error("Missing fixture owner");
    if (kind === "model") target.profile.modelId = "other";
    if (kind === "agent") target.profile.agentId = "other";
    if (kind === "run") target.run.peerTaskId = "other";
    if (kind === "error") target.run.error.kind = "unknown";
    expect(taskRetryEligibility(task, target, messages)).toBe(false);
  });
  it.each([
    10,
    null,
  ])("blocks native execution history for run %s", async (runId) => {
    failed();
    vi.mocked(executionHistory).mockResolvedValue([{ runId }] as Awaited<
      ReturnType<typeof executionHistory>
    >);
    await expect(retryTaskWithoutEffects(task.id, "source")).rejects.toThrow(
      "Previous tool executions",
    );
    expect(requestPeerTask).not.toHaveBeenCalled();
  });
  it("fails closed if native execution history cannot be checked", async () => {
    failed();
    vi.mocked(executionHistory).mockRejectedValue(new Error("offline"));
    await expect(retryTaskWithoutEffects(task.id, "source")).rejects.toThrow(
      "offline",
    );
    expect(requestPeerTask).not.toHaveBeenCalled();
  });
  it("does not hide prior effects behind a later user/continuation message", () => {
    failed();
    expect(
      taskRetryEligibility(task, target, [
        {
          id: "old-effect",
          role: "assistant",
          parts: [
            {
              type: "tool-write_file",
              toolCallId: "done",
              state: "output-available",
              input: {},
              output: {},
            },
          ],
        },
        ...messages,
      ]),
    ).toBe(false);
  });
  it("rejects a second queued attempt", async () => {
    failed();
    usePeerTaskStore.setState({
      tasks: [task, { ...task, id: "attempt", status: "queued" }],
    });
    await expect(retryTaskWithoutEffects(task.id, "source")).rejects.toThrow(
      "already assigned",
    );
    expect(requestPeerTask).not.toHaveBeenCalled();
  });
  it("does not retry after restart or after an isolated patch was captured", () => {
    failed();
    task.recovery = { interruption: { cause: "app-restart", detectedAt: 3 } };
    expect(taskRetryEligibility(task, target, messages)).toBe(false);
    task.recovery = undefined;
    task.changeSet = {
      baseSha: "base",
      patch: "patch",
      changedPaths: ["README.md"],
    };
    expect(taskRetryEligibility(task, target, messages)).toBe(false);
  });
  it("rejects inconsistent task-root identity", async () => {
    task.workspaceRoot = "/foreign";
    expect(canAccessTaskResult(task, "source")).toBe(false);
    await expect(
      readTaskArtifact(task.id, "source", "artifact"),
    ).rejects.toThrow("owning conversation");
  });
  it("rejects stale checks if the owner changes while history loads", async () => {
    failed();
    vi.mocked(executionHistory).mockImplementation(async () => {
      useChatStore.setState({ sessions: [] });
      return [];
    });
    await expect(retryTaskWithoutEffects(task.id, "source")).rejects.toThrow();
    expect(requestPeerTask).not.toHaveBeenCalled();
  });
  it("coalesces concurrent chat/Dispatcher retries", async () => {
    failed();
    const results = await Promise.allSettled([
      retryTaskWithoutEffects(task.id, "source"),
      retryTaskWithoutEffects(task.id, "source"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(requestPeerTask).toHaveBeenCalledTimes(1);
  });
});
describe("shared chat/Dispatcher outcome surface", () => {
  it("promotes Review/Apply ahead of Open for isolated changes", () => {
    task.executionMode = "isolated-worktree";
    task.changeSet = {
      baseSha: "base",
      patch: "patch",
      changedPaths: ["README.md"],
    };
    const html = renderToStaticMarkup(
      <PeerTaskOutcome task={task} sessionId="source" />,
    );
    expect(html).toContain("Review changes");
    expect(html).toContain("Apply to workspace");
    expect(html).not.toContain("Open README");
  });
  it("offers Open after apply and distinguishes textual from empty results", () => {
    task.changeSet = {
      baseSha: "base",
      patch: "patch",
      changedPaths: ["README.md"],
      appliedAt: 3,
    };
    expect(
      renderToStaticMarkup(<PeerTaskOutcome task={task} sessionId="source" />),
    ).toContain("Open README.md");
    task.changeSet = undefined;
    task.result = result();
    expect(
      renderToStaticMarkup(<PeerTaskOutcome task={task} sessionId="source" />),
    ).toContain("View result");
    task.result = undefined;
    expect(
      renderToStaticMarkup(<PeerTaskOutcome task={task} sessionId="source" />),
    ).toContain("No files or artifacts returned");
  });
  it("shows Source Control only for an accessible dirty-workspace failure", () => {
    failed();
    task.error = {
      code: "peer_run_failed",
      message: "workspace has uncommitted changes",
    };
    expect(
      renderToStaticMarkup(<PeerTaskOutcome task={task} sessionId="source" />),
    ).toContain("View Source Control");
    expect(
      renderToStaticMarkup(
        <PeerTaskOutcome task={task} sessionId="unrelated" />,
      ),
    ).not.toContain("View Source Control");
  });
});
