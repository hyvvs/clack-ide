import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";
import {
  useDispatcherNavigation,
  viewTaskInDispatcher,
  focusTaskConversationPane,
  viewAllTasksInDispatcher,
} from "@/modules/ai/store/dispatcherNavigation";
import {
  createAiPaneLayout,
  useAiPaneStore,
} from "@/modules/ai/store/aiPaneStore";
import {
  dispatcherTaskConversation,
  dispatcherTaskStatus,
  workspaceDispatcherTasks,
  availableDispatcherTasks,
  visibleDispatcherTasks,
  dispatcherTaskNeighbors,
} from "@/modules/ai/lib/dispatcherTasks";
import { PeerTaskFeed } from "@/modules/ai/components/PeerTaskFeed";
import type { PeerTask } from "@/modules/ai/lib/peerTasks";

vi.mock("@/modules/ai/store/peerTaskStore", async (original) => {
  const actual =
    await original<typeof import("@/modules/ai/store/peerTaskStore")>();
  return {
    ...actual,
    usePeerTaskStore: Object.assign(
      (
        select: (
          s: ReturnType<typeof actual.usePeerTaskStore.getState>,
        ) => unknown,
      ) => select(actual.usePeerTaskStore.getState()),
      actual.usePeerTaskStore,
    ),
  };
});
vi.mock("@/modules/ai/store/chatStore", async (original) => {
  const actual =
    await original<typeof import("@/modules/ai/store/chatStore")>();
  return {
    ...actual,
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
const initialPanes = useAiPaneStore.getState();
afterEach(() => {
  useChatStore.setState(initialChat);
  usePeerTaskStore.setState(initialTasks);
  useAiPaneStore.setState(initialPanes);
  useDispatcherNavigation.setState({ request: null });
});
const session = (id: string, workspaceId = "local:/fixture") => ({
  id,
  title: `Parent ${id}`,
  createdAt: 1,
  updatedAt: 1,
  profile: {
    agentId: "builtin:coder",
    modelId: "gpt-5.4-mini",
    workspaceRoot: "/fixture",
    workspaceId,
  },
});
const task: PeerTask = {
  schemaVersion: 7,
  id: "assigned",
  sourceSessionId: "a",
  targetSessionId: "reviewer",
  sourceAgentId: "builtin:coder",
  sourceModelId: "gpt-5.4-mini",
  targetAgentId: "builtin:reviewer",
  targetModelId: "gpt-5.4-mini",
  workspaceId: "local:/fixture",
  workspaceRoot: "/fixture",
  workspaceEnvironment: { kind: "local" },
  kind: "review",
  executionMode: "read-only",
  prompt: "Review these bounds",
  artifactRefs: [],
  parentTaskId: null,
  rootTaskId: "assigned",
  hopCount: 0,
  dependsOn: [],
  status: "running",
  createdAt: 1,
  updatedAt: 2,
};

it("navigates the displayed attention/active/completed order with stable ties and no wrap", () => {
  const sessions = [session("a")];
  const attention = { ...task, id: "failed", status: "failed" as const, updatedAt: 1 };
  const done = { ...task, id: "done", status: "completed" as const, updatedAt: 100 };
  const visible = visibleDispatcherTasks([done, task, attention, { ...task, id: "orphan", sourceSessionId: "missing" }], sessions);
  expect(visible.map(t => t.id)).toEqual(["failed", "assigned", "done"]);
  expect(dispatcherTaskNeighbors(visible, attention.id)).toMatchObject({ index: 0, count: 3, previous: undefined, next: task });
  expect(dispatcherTaskNeighbors(visible, task.id)).toMatchObject({ previous: attention, next: done });
  expect(dispatcherTaskNeighbors(visible, done.id)).toMatchObject({ previous: task, next: undefined });
  expect(dispatcherTaskNeighbors([task], task.id)).toMatchObject({ previous: undefined, next: undefined });
  expect(dispatcherTaskNeighbors(visible, "deleted")).toMatchObject({ index: -1, previous: undefined, next: undefined });
});
it("uses only available/filter-visible rows and recalculates neighbors after updates/deletion", () => {
  const sessions = [session("a")];
  const b = { ...task, id: "b", updatedAt: 2 };
  const c = { ...task, id: "c", updatedAt: 3, status: "failed" as const };
  expect(visibleDispatcherTasks([b, c, task], sessions, "active").map(t => t.id)).toEqual(["assigned", "b"]);
  const reordered = visibleDispatcherTasks([{ ...b, updatedAt: 9 }, c, task], sessions, "active");
  expect(dispatcherTaskNeighbors(reordered, task.id).previous?.id).toBe("b");
  expect(dispatcherTaskNeighbors(reordered.filter(t => t.id !== task.id), task.id).next).toBeUndefined();
  expect(visibleDispatcherTasks([task], [], "active")).toEqual([]);
});

it("keeps global Dispatcher work visible across known workspaces without exposing orphaned or foreign task evidence", () => {
  const elsewhere = session("elsewhere");
  if (!elsewhere.profile) throw new Error("Fixture profile missing");
  elsewhere.profile = { ...elsewhere.profile, workspaceId: "local:/elsewhere", workspaceRoot: "/elsewhere" };
  const other = { ...task, id: "other", sourceSessionId: elsewhere.id, targetSessionId: "missing", workspaceId: elsewhere.profile.workspaceId, workspaceRoot: elsewhere.profile.workspaceRoot };
  const orphan = { ...other, id: "orphan", sourceSessionId: "deleted" };
  expect(availableDispatcherTasks([task, other, orphan], [session("a"), elsewhere]).map(t => t.id)).toEqual([task.id, other.id]);
  viewAllTasksInDispatcher();
  expect(useDispatcherNavigation.getState().request).toMatchObject({ taskId: null, sessionId: null });
  expect(useChatStore.getState().panelOpen).toBe(true);
  useChatStore.setState({ sessions: [session("a"), elsewhere] });
  usePeerTaskStore.setState({ tasks: [other] });
  expect(viewTaskInDispatcher(other.id, "a")).toBe(false);
});
it("focuses the already-open parent pane without rebinding another conversation", () => {
  vi.stubGlobal("requestAnimationFrame", vi.fn());
  try {
    useAiPaneStore.setState({ ...createAiPaneLayout("a"), initialized: true });
    const parentPane = useAiPaneStore.getState().activePaneId;
    const otherPane = useAiPaneStore.getState().splitPane(parentPane, "row");
    if (otherPane === null) throw new Error("Missing second pane");
    useAiPaneStore.getState().bindSession(otherPane, "b");
    const bindings = { ...useAiPaneStore.getState().bindings };
    focusTaskConversationPane("a");
    expect(useAiPaneStore.getState().activePaneId).toBe(parentPane);
    expect(useAiPaneStore.getState().bindings).toEqual(bindings);
    expect(useChatStore.getState().mini).toEqual({
      open: true,
      minimized: false,
    });
    focusTaskConversationPane("reviewer");
    expect(useAiPaneStore.getState().bindings[parentPane]).toBe("reviewer");
    expect(useAiPaneStore.getState().bindings[otherPane]).toBe("b");
  } finally {
    vi.unstubAllGlobals();
  }
});
it("connects a conversation task to the exact Dispatcher row without changing chat ownership", () => {
  useChatStore.setState({
    sessions: [session("a"), session("b"), session("reviewer")],
    activeSessionId: "b",
  });
  usePeerTaskStore.setState({ tasks: [task] });
  const a = renderToStaticMarkup(<PeerTaskFeed sessionId="a" />);
  const b = renderToStaticMarkup(<PeerTaskFeed sessionId="b" />);
  expect(a).toContain("Assigned tasks");
  expect(a).toContain("View task in Dispatcher");
  expect(a).toContain("Code Reviewer");
  expect(a).toContain("Parent a");
  expect(b).not.toContain("Review these bounds");
  expect(viewTaskInDispatcher(task.id, "a")).toBe(true);
  expect(useDispatcherNavigation.getState().request).toMatchObject({
    taskId: task.id,
    sessionId: "a",
  });
  expect(useChatStore.getState().panelOpen).toBe(true);
  expect(useChatStore.getState().activeSessionId).toBe("b");
  expect(
    dispatcherTaskConversation(task, useChatStore.getState().sessions),
  ).toBe("a");
});
it("denies another chat or workspace and keeps retained completed tasks findable", () => {
  useChatStore.setState({
    sessions: [session("a"), session("b"), session("foreign", "local:/other")],
  });
  const done = {
    ...task,
    status: "completed" as const,
    result: {
      summary: "Verified bounds",
      targetSessionId: "reviewer",
      targetAgentId: task.targetAgentId,
      targetModelId: task.targetModelId,
      completedAt: 3,
      artifacts: [],
    },
  };
  usePeerTaskStore.setState({
    tasks: [done, { ...task, id: "foreign-task", workspaceId: "local:/other" }],
  });
  expect(viewTaskInDispatcher(task.id, "b")).toBe(false);
  expect(viewTaskInDispatcher(task.id, "foreign")).toBe(false);
  expect(viewTaskInDispatcher("missing", "a")).toBe(false);
  expect(
    workspaceDispatcherTasks(
      usePeerTaskStore.getState().tasks,
      task.workspaceId,
    ),
  ).toEqual([done]);
  expect(viewTaskInDispatcher(done.id, "a")).toBe(true);
  expect(renderToStaticMarkup(<PeerTaskFeed sessionId="a" />)).toContain(
    "Verified bounds",
  );
  expect(
    dispatcherTaskConversation(task, [session("a", "local:/other")]),
  ).toBeNull();
});
it.each([
  ["queued", "Queued"],
  ["running", "Running"],
  ["waiting", "Waiting for required tasks"],
  ["blocked", "Blocked"],
  ["completed", "Done"],
  ["failed", "Failed"],
  ["cancelled", "Cancelled"],
] as const)("labels %s work as %s", (status, label) => {
  expect(dispatcherTaskStatus({ ...task, status })).toBe(label);
});
