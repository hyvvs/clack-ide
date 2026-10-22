import type { UIMessage } from "ai";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => new Map<string, unknown>());
vi.mock("./todos", async (importOriginal) => {
  const original = await importOriginal<typeof import("./todos")>();
  return {
    ...original,
    loadTodos: vi.fn(async (id: string) => structuredClone(disk.get(id) ?? [])),
    saveTodos: vi.fn(async (id: string, todos: unknown) => {
      disk.set(id, structuredClone(todos));
    }),
    deleteTodos: vi.fn(async (id: string) => {
      disk.delete(id);
    }),
  };
});

import { RunObligationEvidence } from "../components/RunObligationStatus";
import { flushTodoPersistence, useTodosStore } from "../store/todoStore";
import type { ToolContext } from "../tools/context";
import { buildShellTools } from "../tools/shell";
import { native } from "./native";
import { inspectRunObligations } from "./runObligations";
import { type NativeTodoCheck, reconcileTodos, type Todo } from "./todos";

const basePlan: Todo[] = [
  { id: "50", title: "Task page size 50", status: "completed" },
  { id: "api", title: "Backend API", status: "pending" },
];
const user = (message: string): UIMessage => ({
  id: message,
  role: "user",
  parts: [{ type: "text", text: message }],
});
const before = {
  state: "completed" as const,
  startedAt: 42,
  workspaceId: "local:/test",
};
const ctx = (): ToolContext => ({
  getCwd: () => "/test",
  getWorkspaceRoot: () => "/test",
  getWorkspaceId: () => "local:/test",
  getWorkspaceEnv: () => ({ kind: "local" }),
  getTerminalContext: () => null,
  isActiveTerminalPrivate: () => false,
  injectIntoActivePty: () => false,
  openPreview: () => false,
  spawnAgent: () => null,
  readAgentOutput: () => null,
  readCache: new Map(),
  getSessionId: () => "chat",
  getAgentId: () => "builtin:coder",
  getRunId: () => 42,
  getUserTurnCount: () => 1,
});
const report = (
  todos: Todo[],
  revision?: string,
  messages: UIMessage[] = [user("Build")],
) =>
  inspectRunObligations({
    sessionId: "chat",
    workspaceId: "local:/test",
    run: before,
    todos,
    messages,
    currentRevision: revision,
  });
const receipt = (changes: Partial<NativeTodoCheck> = {}): NativeTodoCheck => ({
  id: "native-result",
  purpose: "Run test",
  command: "npm test",
  sessionId: "chat",
  workspaceId: "local:/test",
  runStartedAt: 42,
  userTurnCount: 1,
  startedAt: 1,
  finishedAt: 2,
  exitCode: 0,
  status: "passed",
  beforeRevision: "A",
  afterRevision: "A",
  qualification: "bounded-local-source-tree-excluding-git-metadata",
  ...changes,
});

beforeEach(() => {
  disk.clear();
  useTodosStore.setState({ bySession: {}, hydrated: new Set() });
});
afterEach(() => vi.restoreAllMocks());

describe("R3b — explicit revision-scoped native check associations", () => {
  it("native shell result is recorded, saved with existing Todos, rehydrated and displayed with current revision", async () => {
    useTodosStore
      .getState()
      .setTodos("chat", [
        { id: "validation", title: "Run npm test", status: "completed" },
      ]);
    vi.spyOn(native, "agentWorkspaceFingerprint").mockResolvedValue({
      revision: "A",
      qualification: "bounded-local-source-tree-excluding-git-metadata",
      reason: null,
    });
    vi.spyOn(native, "shellSessionOpen").mockResolvedValue(1);
    const execute = vi.spyOn(native, "shellSessionRun").mockResolvedValue({
      stdout: "ok",
      stderr: "",
      exit_code: 0,
      timed_out: false,
      truncated: false,
      cwd_after: "/test",
    });
    const tool = buildShellTools(ctx()).bash_run;
    const call = tool.execute as (
      input: unknown,
      options: unknown,
    ) => Promise<unknown>;
    const output = await call(
      {
        command: "npm test",
        verify_todo_id: "validation",
        verification_purpose: "Run npm test",
      },
      { toolCallId: "native", messages: [] },
    );
    expect(output).toMatchObject({ exit_code: 0, timed_out: false });
    expect(output).toHaveProperty("nativeCheckEvidenceId");
    expect(execute).toHaveBeenCalledOnce();
    await flushTodoPersistence();
    expect(disk.get("chat")).toBeDefined();
    useTodosStore.setState({ bySession: {}, hydrated: new Set() });
    await useTodosStore.getState().hydrate("chat");
    const restored = useTodosStore.getState().bySession.chat;
    expect(restored[0].nativeChecks?.[0]).toMatchObject({
      status: "passed",
      beforeRevision: "A",
      afterRevision: "A",
    });
    const evidence = report(restored, "A");
    expect(evidence.nativeChecks[0]).toMatchObject({
      freshness: "current-source-check",
      outcome: "passed",
    });
    expect(evidence.obligations[0].state).toBe("completed-unverified");
    const html = renderToStaticMarkup(
      <RunObligationEvidence
        report={evidence}
        continuation="new-instruction"
      />,
    );
    expect(html).toContain("Native checks explicitly associated");
    expect(html).toContain("current source check");
    expect(html).not.toContain("Task status: independently verified");
  });

  it("native safety refusal leaves shell unopened and persists a blocked check, not a failed test", async () => {
    useTodosStore
      .getState()
      .setTodos("chat", [
        { id: "validation", title: "Run test", status: "completed" },
      ]);
    const open = vi.spyOn(native, "shellSessionOpen");
    const run = vi.spyOn(native, "shellSessionRun");
    const witness = vi.spyOn(native, "agentWorkspaceFingerprint");
    const call = buildShellTools(ctx()).bash_run.execute as (
      input: unknown,
      options: unknown,
    ) => Promise<unknown>;
    const denied = await call(
      { command: "npm test\nexit", verify_todo_id: "validation" },
      { toolCallId: "denied", messages: [] },
    );
    expect(denied).toHaveProperty("error");
    expect(open).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(witness).not.toHaveBeenCalled();
    expect(
      useTodosStore.getState().bySession.chat[0].nativeChecks?.[0],
    ).toMatchObject({ status: "blocked", exitCode: null });
    expect(
      report(useTodosStore.getState().bySession.chat, "A").nativeChecks[0]
        .freshness,
    ).toBe("unknown");
  });

  it("the same shell without explicit accepted Todo identity produces no verification record", async () => {
    useTodosStore
      .getState()
      .setTodos("chat", [
        { id: "test", title: "Run tests", status: "completed" },
      ]);
    vi.spyOn(native, "shellSessionOpen").mockResolvedValue(1);
    vi.spyOn(native, "shellSessionRun").mockResolvedValue({
      stdout: "ok",
      stderr: "",
      exit_code: 0,
      timed_out: false,
      truncated: false,
      cwd_after: "/test",
    });
    const call = buildShellTools(ctx()).bash_run.execute as (
      input: unknown,
      options: unknown,
    ) => Promise<unknown>;
    expect(
      await call(
        { command: "npm test" },
        { toolCallId: "unbound", messages: [] },
      ),
    ).not.toHaveProperty("nativeCheckEvidenceId");
    expect(
      useTodosStore.getState().bySession.chat[0].nativeChecks,
    ).toBeUndefined();
  });

  it("A to B stales old proof; a new B result restores check freshness but not feature semantics", () => {
    const todo: Todo = {
      id: "validation",
      title: "Run tests",
      status: "completed",
      nativeChecks: [receipt()],
    };
    expect(report([todo], "A").nativeChecks[0].freshness).toBe(
      "current-source-check",
    );
    expect(report([todo], "B").nativeChecks[0].freshness).toBe("stale");
    todo.nativeChecks?.push(
      receipt({ id: "native-B", beforeRevision: "B", afterRevision: "B" }),
    );
    expect(report([todo], "B").nativeChecks.map((c) => c.freshness)).toEqual([
      "stale",
      "current-source-check",
    ]);
    expect(report([todo], "B").obligations[0].state).toBe(
      "completed-unverified",
    );
  });

  it("denied, failed, timed-out, cancelled, unavailable and mid-run changed checks never prove a current source check", () => {
    for (const status of [
      "blocked",
      "failed",
      "timed-out",
      "cancelled",
      "not-started",
      "permission-denied",
    ] as const) {
      const current = report(
        [
          {
            id: "test",
            title: "Run tests",
            status: "completed",
            nativeChecks: [receipt({ status })],
          },
        ],
        "A",
      );
      expect(current.nativeChecks[0].outcome).toBe(status);
      expect(current.obligations[0].state).toBe("completed-unverified");
    }
    expect(
      report(
        [
          {
            id: "test",
            title: "Run tests",
            status: "completed",
            nativeChecks: [receipt({ beforeRevision: null })],
          },
        ],
        "A",
      ).nativeChecks[0].freshness,
    ).toBe("unknown");
    expect(
      report(
        [
          {
            id: "test",
            title: "Run tests",
            status: "completed",
            nativeChecks: [receipt({ afterRevision: "B" })],
          },
        ],
        "B",
      ).nativeChecks[0].freshness,
    ).toBe("stale");
  });

  it("foreign workspace/run and later user corrections cannot lend current evidence", () => {
    const done: Todo = {
      id: "t",
      title: "Test",
      status: "completed",
      nativeChecks: [receipt()],
    };
    expect(
      report([done], "A", [user("Build"), user("Change requirements")])
        .nativeChecks[0].freshness,
    ).toBe("stale");
    expect(
      report(
        [{ ...done, nativeChecks: [receipt({ workspaceId: "local:/other" })] }],
        "A",
      ).nativeChecks[0].freshness,
    ).toBe("stale");
    expect(
      report([{ ...done, nativeChecks: [receipt({ runStartedAt: 41 })] }], "A")
        .nativeChecks[0].freshness,
    ).toBe("stale");
  });

  it("exact 50 to 25 and subsequent correction preserve unrelated work and historical supersession", () => {
    const plan25 = reconcileTodos(basePlan, [
      {
        id: "25",
        title: "Task page size 25",
        status: "in_progress",
        supersedesIds: ["50"],
      },
      basePlan[1],
    ]);
    expect(plan25.map((t) => [t.id, t.superseded ?? false])).toEqual([
      ["25", false],
      ["api", false],
      ["50", true],
    ]);
    expect(report(plan25).obligations.find((t) => t.id === "50")?.state).toBe(
      "superseded",
    );
    const plan10 = reconcileTodos(plan25, [
      {
        id: "10",
        title: "Task page size 10",
        status: "in_progress",
        supersedesIds: ["25"],
      },
      basePlan[1],
    ]);
    expect(plan10.find((t) => t.id === "50")?.superseded).toBe(true);
    expect(plan10.find((t) => t.id === "25")?.superseded).toBe(true);
    expect(plan10.find((t) => t.id === "api")?.status).toBe("pending");
    const accepted = report(plan10, "A", [
      user("Task page size 50"),
      user("The new task page size is 25; 25 supersedes 50 everywhere."),
      user("Change 25 to 10."),
    ]);
    expect(accepted.obligations.find((t) => t.id === "50")?.state).toBe(
      "superseded",
    );
    expect(accepted.obligations.find((t) => t.id === "10")?.state).toBe(
      "in-progress",
    );
    expect(accepted.obligations.find((t) => t.id === "api")?.state).toBe(
      "not-started",
    );
    expect(() =>
      reconcileTodos(plan10, [
        { id: "50", title: "Task page size 50", status: "completed" },
      ]),
    ).toThrow("cannot be reactivated");
    expect(() =>
      reconcileTodos(basePlan, [
        { id: "50", title: "Task page size 25", status: "completed" },
      ]),
    ).toThrow("new id");
    expect(() =>
      reconcileTodos(basePlan, [
        {
          id: "25",
          title: "Task page size 25",
          status: "completed",
          supersedesIds: ["unknown"],
        },
      ]),
    ).toThrow("existing");
  });

  it("a write receipt, textual pseudo tool and finished model batch cannot replace the native check", () => {
    const evidence = report(basePlan, "A", [
      user("Build"),
      {
        id: "ai",
        role: "assistant",
        parts: [
          { type: "text", text: "<tool_call>npm test passed</tool_call>" },
        ],
      },
    ]);
    expect(evidence.nativeChecks).toHaveLength(0);
    expect(evidence.outcome).not.toBe("verified");
  });
});
