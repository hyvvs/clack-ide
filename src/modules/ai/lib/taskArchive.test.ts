import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  taskArchiveEligible,
  finishedTasksToArchive,
} from "@/modules/ai/lib/taskArchive";
import {
  normalizePeerTask,
  loadPeerTasks,
  collectPeerTaskContentIds,
  type PeerTask,
} from "@/modules/ai/lib/peerTasks";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";
import { useChatStore } from "@/modules/ai/store/chatStore";
import {
  visibleDispatcherTasks,
  dispatcherTaskNeighbors,
} from "@/modules/ai/lib/dispatcherTasks";
import {
  setTaskArchived,
  archiveFinishedTasks,
} from "@/modules/ai/lib/taskResultActions";
import { reconcilePeerTaskDependencies } from "@/modules/ai/lib/peerTaskDependencies";
import { buildPeerTaskDependencyAggregate } from "@/modules/ai/lib/peerTaskAggregation";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/modules/ai/lib/sessions", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/sessions")>()),
  reconcilePersistedAttachmentContent: vi
    .fn()
    .mockResolvedValue({ issues: [] }),
}));
const initialTasks = usePeerTaskStore.getState();
const initialChat = useChatStore.getState();
const task = (id = "task", patch: Partial<PeerTask> = {}): PeerTask => ({
  schemaVersion: 7,
  id,
  sourceSessionId: "source",
  targetSessionId: "target",
  sourceAgentId: "coder",
  sourceModelId: "model",
  targetAgentId: "reviewer",
  targetModelId: "model",
  workspaceId: "local:/fixture",
  workspaceRoot: "/fixture",
  workspaceEnvironment: { kind: "local" },
  kind: "review",
  executionMode: "read-only",
  prompt: "Inspect project",
  artifactRefs: [],
  parentTaskId: null,
  rootTaskId: id,
  hopCount: 0,
  dependsOn: [],
  status: "completed",
  createdAt: 1,
  updatedAt: 2,
  ...patch,
});
const sessions = ["source", "target"].map((id) => ({
  id,
  title: id,
  createdAt: 1,
  updatedAt: 1,
  profile: {
    agentId: "coder",
    modelId: "model",
    workspaceId: "local:/fixture",
    workspaceRoot: "/fixture",
  },
}));
let durable: { revision: number; tasks: PeerTask[] };
beforeEach(async () => {
  durable = { revision: 0, tasks: [] };
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "peer_ledger_read") return structuredClone(durable);
    if (command === "peer_ledger_commit") {
      const input = args as { expected: number; tasks: PeerTask[] };
      if (input.expected !== durable.revision)
        throw new Error("stale revision");
      durable = {
        revision: durable.revision + 1,
        tasks: structuredClone(input.tasks),
      };
      return durable.revision;
    }
    if (command === "git_agent_worktree_cleanup") return { preservedCount: 0 };
    return null;
  });
  await loadPeerTasks();
  usePeerTaskStore.setState({
    ...initialTasks,
    recoveryReady: true,
    tasks: [task()],
  });
  useChatStore.setState({
    sessions,
    live: { ...initialChat.live, getWorkspaceRoot: () => "/fixture" },
  });
});
afterEach(() => {
  usePeerTaskStore.setState(initialTasks, true);
  useChatStore.setState(initialChat, true);
  vi.clearAllMocks();
});

it.each([
  "completed",
  "failed",
  "cancelled",
  "blocked",
] as const)("archives terminal %s without changing lifecycle identity", async (status) => {
  const original = task("task", {
    status,
    error:
      status === "failed"
        ? { code: "failed", message: "possible effects" }
        : undefined,
  });
  usePeerTaskStore.setState({ tasks: [original] });
  await setTaskArchived(original.id, "source", true);
  expect(usePeerTaskStore.getState().tasks[0]).toEqual({
    ...original,
    archivedAt: expect.any(Number),
  });
  expect(durable.tasks[0]).toEqual(usePeerTaskStore.getState().tasks[0]);
});
it.each([
  "running",
  "queued",
  "waiting",
] as const)("refuses to archive %s", async (status) => {
  usePeerTaskStore.setState({ tasks: [task("task", { status })] });
  await expect(setTaskArchived("task", "source", true)).rejects.toThrow(
    "must remain visible",
  );
  expect(durable.revision).toBe(0);
});
it("pending clarification blocks archive even on a terminal record", () => {
  const question = { kind: "clarification-request", state: "delivered" };
  expect(
    taskArchiveEligible(
      task("question", {
        communication: [question] as PeerTask["communication"],
      }),
      [],
    ),
  ).toBe(false);
});
it.each([
  "managingTaskIds",
  "retryingTaskIds",
] as const)("in-progress %s blocks archive in every surface", async (key) => {
  usePeerTaskStore.setState({ [key]: ["task"] });
  await expect(setTaskArchived("task", "source", true)).rejects.toThrow(
    "must remain visible",
  );
});
it("active dependents and transitive prerequisites remain visible", () => {
  const root = task("root");
  const middle = task("middle", { dependsOn: [root.id] });
  const active = task("active", { status: "waiting", dependsOn: [middle.id] });
  expect(taskArchiveEligible(root, [root, middle, active])).toBe(false);
  expect(taskArchiveEligible(middle, [root, middle, active])).toBe(false);
  expect(
    taskArchiveEligible(root, [
      root,
      middle,
      { ...active, status: "completed" },
    ]),
  ).toBe(true);
});
it("active descendants protect their parent and cycles terminate", () => {
  const root = task("root", { dependsOn: ["cycle"] });
  const cycle = task("cycle", { dependsOn: ["root"] });
  const child = task("child", { parentTaskId: "root", status: "running" });
  expect(taskArchiveEligible(root, [root, cycle, child])).toBe(false);
  expect(taskArchiveEligible(task("unrelated"), [root, cycle, child])).toBe(
    true,
  );
});
it("clear finished archives only eligible completed tasks, never failures or review/recovery", async () => {
  const tasks = [
    task("completed"),
    task("failed", { status: "failed" }),
    task("blocked", { status: "blocked" }),
    task("cancelled", { status: "cancelled" }),
    task("running", { status: "running" }),
    task("patch", {
      changeSet: { baseSha: "base", patch: "patch", changedPaths: ["a"] },
    }),
    task("recovery", {
      recovery: { interruption: { cause: "app-restart", detectedAt: 3 } },
    }),
    task("archived", { archivedAt: 3 }),
  ];
  usePeerTaskStore.setState({ tasks });
  expect(finishedTasksToArchive(tasks).map((t) => t.id)).toEqual(["completed"]);
  await archiveFinishedTasks(["completed"]);
  expect(
    usePeerTaskStore
      .getState()
      .tasks.filter((t) => t.archivedAt)
      .map((t) => t.id),
  ).toEqual(["completed", "archived"]);
  await expect(archiveFinishedTasks(["failed"])).rejects.toThrow(
    "eligible finished",
  );
});
it("archive retains results, content hashes, change sets, recovery and retry lineage", async () => {
  const contentRef = {
    id: "a".repeat(64),
    contentHash: "a".repeat(64),
    byteSize: 3,
  };
  const original = task("retry", {
    parentTaskId: "failed",
    retryOfTaskId: "failed",
    rootTaskId: "failed",
    dependsOn: ["prerequisite"],
    result: {
      summary: "Verified",
      artifacts: [
        {
          id: "artifact",
          attachmentId: "attachment",
          contentRef,
          displayName: "report.txt",
          mediaType: "text/plain",
          contentKind: "text",
          byteSize: 3,
          sourceSessionId: "target",
          sourceTaskId: "retry",
          sourceAgentId: "reviewer",
          sourceModelId: "model",
          workspaceId: "local:/fixture",
          workspaceRoot: "/fixture",
          createdAt: 3,
          originType: "generated-file",
          accessPolicy: "model-input",
        },
      ],
      targetSessionId: "target",
      targetAgentId: "reviewer",
      targetModelId: "model",
      completedAt: 3,
    },
    changeSet: {
      baseSha: "base",
      patch: "patch",
      changedPaths: ["a"],
      appliedAt: 4,
    },
    recovery: { interruption: { cause: "app-restart", detectedAt: 4 } },
  });
  usePeerTaskStore.setState({ tasks: [original] });
  await setTaskArchived("retry", "source", true);
  const saved = normalizePeerTask(JSON.parse(JSON.stringify(durable.tasks[0])));
  expect(saved).toMatchObject({ ...original, archivedAt: expect.any(Number) });
  expect(collectPeerTaskContentIds([saved as PeerTask])).toContain(
    contentRef.id,
  );
});
it("restore changes only archive visibility", async () => {
  const original = task("task", { archivedAt: 3 });
  usePeerTaskStore.setState({ tasks: [original] });
  await setTaskArchived("task", "source", false);
  expect(usePeerTaskStore.getState().tasks[0]).toEqual({
    ...original,
    archivedAt: undefined,
  });
});
it("actual ledger reload and store hydration preserve archived state idempotently", async () => {
  await setTaskArchived("task", "source", true);
  const saved = structuredClone(durable.tasks);
  usePeerTaskStore.setState({
    tasks: [],
    hydrated: false,
    recoveryReady: false,
  });
  await usePeerTaskStore
    .getState()
    .hydrate({
      sessions,
      isAgentConfigured: () => true,
      isModelConfigured: () => true,
    });
  expect(usePeerTaskStore.getState().recoveryReady).toBe(true);
  expect(usePeerTaskStore.getState().tasks).toEqual(saved);
  await usePeerTaskStore
    .getState()
    .hydrate({
      sessions,
      isAgentConfigured: () => true,
      isModelConfigured: () => true,
    });
  expect(usePeerTaskStore.getState().tasks).toHaveLength(1);
});
it("archived prerequisites still resolve results and dependencies", () => {
  const prerequisite = task("before", {
    archivedAt: 3,
    result: {
      summary: "Verified evidence",
      artifacts: [],
      targetSessionId: "target",
      targetAgentId: "reviewer",
      targetModelId: "model",
      completedAt: 2,
    },
  });
  const dependent = task("after", {
    status: "waiting",
    rootTaskId: prerequisite.id,
    dependsOn: [prerequisite.id],
  });
  expect(
    reconcilePeerTaskDependencies([prerequisite, dependent])[1].status,
  ).toBe("queued");
  expect(
    buildPeerTaskDependencyAggregate(dependent, [prerequisite, dependent])
      .entries[0].resultSummary,
  ).toBe("Verified evidence");
});
it("visible counters and navigation exclude archive while evidence remains available", () => {
  const before = task("before", { archivedAt: 3, status: "failed" });
  const current = task("current");
  expect(
    visibleDispatcherTasks([before, current], sessions).map((t) => t.id),
  ).toEqual(["current"]);
  const archive = visibleDispatcherTasks(
    [before, current],
    sessions,
    undefined,
    true,
  );
  expect(archive.map((t) => t.id)).toEqual(["before"]);
  expect(dispatcherTaskNeighbors(archive, before.id)).toMatchObject({
    index: 0,
    count: 1,
    previous: undefined,
    next: undefined,
  });
});
it.each([
  -1,
  0,
  NaN,
  Infinity,
  "3",
])("invalid archive timestamp %s restores visibility safely", (archivedAt) => {
  expect(
    normalizePeerTask({ ...task(), archivedAt })?.archivedAt,
  ).toBeUndefined();
});
it("legacy tasks remain current and malformed archived active tasks cannot be hidden", () => {
  expect(normalizePeerTask(task())?.archivedAt).toBeUndefined();
  expect(
    normalizePeerTask(task("active", { status: "running", archivedAt: 3 }))
      ?.archivedAt,
  ).toBeUndefined();
});
it("wrong conversation/workspace cannot archive or bulk clear", async () => {
  await expect(setTaskArchived("task", "other", true)).rejects.toThrow(
    "owning conversation",
  );
  useChatStore.setState({
    live: { ...initialChat.live, getWorkspaceRoot: () => "/other" },
  });
  await expect(setTaskArchived("task", "source", true)).rejects.toThrow(
    "owning conversation",
  );
  await expect(archiveFinishedTasks(["task"])).rejects.toThrow(
    "eligible finished",
  );
  expect(durable.revision).toBe(0);
});
it("persistence failure pauses management rather than claiming durable success", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("stale revision"));
  await expect(setTaskArchived("task", "source", true)).rejects.toThrow(
    "stale revision",
  );
  expect(usePeerTaskStore.getState().recoveryReady).toBe(false);
  expect(durable.tasks).toHaveLength(0);
  expect(usePeerTaskStore.getState().tasks[0].archivedAt).toBeUndefined();
});
