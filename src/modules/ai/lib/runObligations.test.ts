import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { createRunBudget, recordRunBatch } from "./runBudget";
import {
  inspectRunObligations,
  type ScopedObligationProof,
} from "./runObligations";
import { recoverInterruptedSessions } from "./sessions";
import { type Todo, terminalizeTodos } from "./todos";
import captured from "./toolObjective.fixture.json";

const user = (value: string): UIMessage => ({
  id: `user-${value.length}`,
  role: "user",
  parts: [{ type: "text", text: value }],
});
const assistant = (value: string): UIMessage => ({
  id: `assistant-${value.length}`,
  role: "assistant",
  parts: [{ type: "text", text: value }],
});
const result = (
  name: string,
  input: unknown,
  output: unknown,
  state = "output-available",
): UIMessage =>
  ({
    id: name,
    role: "assistant",
    parts: [
      {
        type: `tool-${name}`,
        toolCallId: name,
        state,
        input,
        output,
      },
    ],
  }) as UIMessage;
const plan: Todo[] = [
  { id: "api", title: "Implement API", status: "in_progress" },
  { id: "ui", title: "Build frontend", status: "pending" },
  { id: "test", title: "Run tests", status: "completed" },
];
const base = () => ({
  sessionId: "chat-a",
  workspaceId: "local:/a",
  run: {
    state: "completed" as const,
    startedAt: 100,
    workspaceId: "local:/a",
    budget: recordRunBatch(
      createRunBudget("ask"),
      { steps: 3, hitSoftLimit: false, finishReason: "stop" },
      "ask",
    ),
  },
  todos: plan,
  messages: [user("Build the app"), assistant("Done")],
});
const proof = (
  overrides: Partial<ScopedObligationProof> = {},
): ScopedObligationProof => ({
  source: "trusted-validation",
  obligationId: "test",
  sessionId: "chat-a",
  workspaceId: "local:/a",
  runStartedAt: 100,
  revision: "tree-hash-a",
  userTurnCount: 1,
  passed: true,
  ...overrides,
});
const check = (command: string, exit_code: number) =>
  result("bash_run", { command }, { command, exit_code, timed_out: false });
const write = (path: string) =>
  result(
    "write_file",
    { path, content: "src" },
    { ok: true, clackWorkspaceWrite: true, path, bytesWritten: 3 },
  );
const inspect = (
  overrides: Partial<Parameters<typeof inspectRunObligations>[0]> = {},
) => inspectRunObligations({ ...base(), ...overrides });

describe("R3a truthful completion and obligations — frozen offline evidence", () => {
  it("1. ForgeBoard retains missing API/frontend after real native source writes and inert textual pseudo tools", () => {
    const messages = captured.messages as UIMessage[];
    const accepted = messages
      .flatMap((m) => m.parts)
      .find((p) => p.type === "tool-todo_write") as {
      input: { todos: Todo[] };
    };
    const original = JSON.stringify(messages);
    const report = inspect({
      todos: accepted.input.todos,
      messages: [
        ...messages,
        assistant(
          "<tool_call><function=write_file>src/server.ts</function></tool_call>",
        ),
      ],
    });
    expect(report.obligations.length).toBeGreaterThan(10);
    expect(
      report.obligations.filter((o) => o.state === "verified-complete"),
    ).toHaveLength(0);
    expect(
      report.obligations.some(
        (o) => /backend API/i.test(o.title) && o.state !== "verified-complete",
      ),
    ).toBe(true);
    expect(report.outcome).not.toBe("verified");
    expect(JSON.stringify(messages)).toBe(original);
  });
  it("2. 50 to 25 correction is exact and an older plan cannot certify the corrected requirement", () => {
    const correction =
      "Change the task page size requirement from 50 to 25. The new value supersedes 50 everywhere.";
    const report = inspect({
      messages: [
        user("Page size 50"),
        result("todo_write", { todos: plan }, { ok: true }),
        user(correction),
        user("Continue."),
        assistant("Done"),
      ],
      todos: [{ id: "test", title: "Page size 50", status: "completed" }],
      proofs: [proof({ userTurnCount: 3 })],
      currentRevision: "tree-hash-a",
    });
    expect(report.unmatchedInstructions).toBe(true);
    expect(report.latestInstruction).toBe(correction);
    expect(report.laterInstructions).toContain(correction);
    expect(report.obligations[0].state).toBe("completed-unverified");
    expect(report.outcome).toBe("unverified");
  });
  it("3. a verified write is an effect, not a passing app test", () => {
    const report = inspect({ messages: [user("Build"), write("/a/src/a.ts")] });
    expect(report.writesObserved).toBe(1);
    expect(report.checks).toHaveLength(0);
    expect(report.toolFailures).toHaveLength(0);
    expect(report.obligations.find((o) => o.id === "test")?.state).toBe(
      "completed-unverified",
    );
  });
  it("4. failed build is not counted as passing validation", () => {
    const report = inspect({
      messages: [user("Build"), check("npm run build", 1)],
    });
    expect(report.checks).toEqual([
      {
        id: "bash_run:0",
        kind: "build",
        command: "npm run build",
        result: "failed",
      },
    ]);
    expect(report.outcome).not.toBe("verified");
  });
  it("5. passing tests followed by a source write become stale", () => {
    const report = inspect({
      messages: [user("Build"), check("npm.cmd test", 0), write("/a/src/a.ts")],
    });
    expect(report.checks[0]?.result).toBe("stale-after-write");
  });
  it("6. unfinished dependencies and tool failures cannot establish success", () => {
    const report = inspect({
      messages: [
        user("Build"),
        result(
          "bash_run",
          { command: "npm test" },
          { error: "denied" },
          "output-error",
        ),
      ],
      peerTasks: [
        {
          sourceSessionId: "chat-a",
          workspaceId: "local:/a",
          status: "blocked",
          createdAt: 110,
        },
      ],
    });
    expect(report.peerOutstanding).toBe(1);
    expect(report.outcome).toBe("blocked");
    expect(report.checks).toHaveLength(0);
    expect(report.toolFailures).toHaveLength(1);
  });
  it("7. model stop is batch termination; unfinished work persists", () => {
    const report = inspect();
    expect(report.terminalReason).toContain("Model response ended");
    expect(report.outcome).toBe("unfinished");
    expect(report.obligations.find((o) => o.id === "api")?.state).toBe(
      "in-progress",
    );
  });
  it("8. cumulative deadline remains incomplete with its actual reason", () => {
    const state = {
      version: 1,
      runId: "chat-a:100",
      state: "incomplete",
      continuations: 3,
      repairs: 0,
      continuationTimeMs: 120000,
      reason: "Cancelled or deadline expired",
      segments: [],
    };
    const report = inspect({
      messages: [
        user("Build"),
        {
          ...assistant("partial"),
          metadata: { clackAnswer: state },
        },
      ],
    });
    expect(report.terminalReason).toContain("Cancelled or deadline expired");
    expect(report.outcome).toBe("unfinished");
  });
  it("9. protected context budget block remains incomplete and never a verified app", () => {
    const state = {
      version: 1,
      runId: "chat-a:100",
      state: "incomplete",
      continuations: 0,
      repairs: 0,
      reason:
        "The incomplete answer cannot continue within the captured context budget.",
      segments: [],
    };
    expect(
      inspect({
        messages: [
          user("Build"),
          { ...assistant("partial"), metadata: { clackAnswer: state } },
        ],
      }).terminalReason,
    ).toContain("context budget");
  });
  it("10. cancellation preserves pending/in-progress/blocked evidence", () => {
    const todos = terminalizeTodos(plan, "cancelled");
    const report = inspect({
      run: { state: "cancelled", startedAt: 100 },
      todos,
    });
    expect(report.terminalReason).toContain("cancelled");
    expect(todos).toEqual(plan);
  });
  it("does not invent supersession from a cancelled Todo", () => {
    const report = inspect({
      todos: [
        {
          id: "legacy",
          title: "Unreconciled requirement",
          status: "cancelled",
        },
      ],
    });
    expect(report.obligations[0]?.state).toBe("blocked");
    expect(report.obligations[0]?.explanation).toContain(
      "no authoritative replacement",
    );
    expect(report.outcome).toBe("blocked");
  });
  it("11. run-budget exhaustion does not declare the objective finished", () => {
    const limit = recordRunBatch(
      { ...createRunBudget("full-access"), totalSteps: 239 },
      { steps: 2, hitSoftLimit: true, finishReason: "tool-calls" },
      "full-access",
    );
    const report = inspect({
      run: { state: "running", startedAt: 100, budget: limit },
    });
    expect(report.terminalReason).toContain("budget exhausted");
    expect(report.outcome).toBe("unfinished");
  });
  it("12. interruption/restart preserves the exact accepted Todo states and transcript", () => {
    const input = {
      id: "chat-a",
      title: "R",
      createdAt: 1,
      updatedAt: 1,
      run: { state: "running" as const, startedAt: 100 },
    };
    const recovered = recoverInterruptedSessions([input], 120);
    expect(recovered.sessions[0].run?.state).toBe("interrupted");
    expect(
      inspect({
        run: recovered.sessions[0].run,
        todos: terminalizeTodos(plan, "interrupted"),
      }).outcome,
    ).toBe("unfinished");
  });
  it("13. foreign workspace/conversation proof and tasks never cross owners", () => {
    const report = inspect({
      todos: [plan[2]],
      proofs: [
        proof({ sessionId: "chat-b" }),
        proof({ workspaceId: "local:/b" }),
      ],
      currentRevision: "tree-hash-a",
      peerTasks: [
        {
          sourceSessionId: "chat-b",
          workspaceId: "local:/a",
          status: "failed",
          createdAt: 110,
        },
      ],
    });
    expect(report.outcome).toBe("unverified");
    expect(report.peerOutstanding).toBe(0);
  });
  it("14. a completed peer report without independent validation is not proof", () => {
    const report = inspect({
      todos: [
        {
          id: "task",
          title: "Implement delegated feature",
          status: "completed",
        },
      ],
      peerTasks: [
        {
          sourceSessionId: "chat-a",
          workspaceId: "local:/a",
          status: "completed",
          createdAt: 110,
        },
      ],
    });
    expect(report.peerClaimedComplete).toBe(1);
    expect(report.outcome).toBe("unverified");
  });
  it("15. an explicitly bound independent check of current revision can verify a completed obligation", () => {
    const report = inspect({
      todos: [plan[2]],
      proofs: [proof()],
      currentRevision: "tree-hash-a",
    });
    expect(report.outcome).toBe("verified");
    expect(report.obligations[0].state).toBe("verified-complete");
    expect(
      inspect({
        todos: [plan[2]],
        proofs: [proof()],
        currentRevision: "tree-hash-b",
      }).outcome,
    ).toBe("unverified");
  });
  it("does not mistake arbitrary text commands or errors for actual native checks", () => {
    const report = inspect({
      messages: [
        user("Build"),
        assistant("npm test passed"),
        check("npm test && echo success", 0),
      ],
    });
    expect(report.checks).toHaveLength(0);
  });
  it("does not promote completed Todo claims without a trusted current workspace revision witness", () => {
    expect(inspect({ todos: [plan[2]], proofs: [proof()] }).outcome).toBe(
      "unverified",
    );
    expect(
      inspect({
        todos: [plan[2]],
        proofs: [proof({ userTurnCount: 0 })],
        currentRevision: "tree-hash-a",
      }).outcome,
    ).toBe("unverified");
    expect(
      inspect({
        todos: [plan[2]],
        proofs: [proof({ passed: false })],
        currentRevision: "tree-hash-a",
      }).outcome,
    ).toBe("blocked");
  });
  it("retains exact corrections after repeated plain continuations and a model switch", () => {
    const correction =
      "Change page size 50 to 25. The new value supersedes 50 everywhere.";
    const report = inspect({
      messages: [
        user("Page size 50"),
        result("todo_write", { todos: plan }, { ok: true }),
        user(correction),
        ...Array.from({ length: 24 }, () => user("Continue the same project.")),
      ],
      todos: [
        {
          id: "test",
          title: "Implement 50-page pagination",
          status: "completed",
        },
      ],
    });
    expect(report.latestInstruction).toBe(correction);
    expect(report.laterInstructions).toEqual([correction]);
    expect(report.outcome).toBe("unverified");
  });
});
