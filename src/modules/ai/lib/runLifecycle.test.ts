import { describe, expect, it } from "vitest";
import {
  recoverInterruptedSessions,
  type SessionMeta,
} from "./sessions";
import { terminalizeTodos } from "./todos";

function session(state: "running" | "completed"): SessionMeta {
  return {
    id: state,
    title: state,
    createdAt: 1,
    updatedAt: 1,
    profileVersion: 1,
    profile: {
      agentId: "builtin:coder",
      modelId: "gpt-5.4-mini",
      workspaceId: null,
      workspaceRoot: null,
    },
    run: { state, startedAt: 2 },
  };
}

describe("recoverInterruptedSessions", () => {
  it("normalizes stale running sessions without changing completed runs", () => {
    const result = recoverInterruptedSessions(
      [session("running"), session("completed")],
      10,
    );

    expect(result.interruptedIds).toEqual(["running"]);
    expect(result.sessions[0].run).toEqual({
      state: "interrupted",
      startedAt: 2,
      endedAt: 10,
    });
    expect(result.sessions[1]).toEqual(session("completed"));
  });
});

describe("terminalizeTodos", () => {
  it.each(["completed", "failed", "interrupted", "cancelled"] as const)("keeps accepted obligation states when a run becomes %s", state => {
    const todos = terminalizeTodos(
      [
        { id: "done", title: "Done", status: "completed" },
        { id: "active", title: "Active", status: "in_progress" },
        { id: "next", title: "Next", status: "pending" },
        { id: "blocked", title: "Blocked", status: "blocked" },
        { id: "failed", title: "Failed", status: "failed" },
      ],
      state,
    );

    expect(todos.map((todo) => todo.status)).toEqual([
      "completed",
      "in_progress",
      "pending",
      "blocked",
      "failed",
    ]);
  });
});
