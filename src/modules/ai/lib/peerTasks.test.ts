import { describe, expect, it } from "vitest";
import {
  PEER_TASK_MAX_STORED,
  PEER_TASK_SCHEMA_VERSION,
  compactPeerTasks,
  type PeerTask,
} from "./peerTasks";

describe("peer task retention", () => {
  it("keeps the ledger bounded to the newest durable tasks", () => {
    const tasks = Array.from(
      { length: PEER_TASK_MAX_STORED + 20 },
      (_, index) => task(`task-${index}`, index),
    );

    const compacted = compactPeerTasks(tasks);

    expect(compacted).toHaveLength(PEER_TASK_MAX_STORED);
    expect(compacted[0]?.id).toBe(`task-${PEER_TASK_MAX_STORED + 19}`);
    expect(compacted.some((item) => item.id === "task-0")).toBe(false);
  });

  it("retains an active task and its collaboration lineage", () => {
    const unrelated = Array.from(
      { length: PEER_TASK_MAX_STORED + 10 },
      (_, index) => task(`old-${index}`, index),
    );
    const root = task("root", -2, {
      rootTaskId: "root",
      status: "completed",
    });
    const active = task("active", -1, {
      rootTaskId: "root",
      parentTaskId: "root",
      status: "queued",
    });

    const compacted = compactPeerTasks([...unrelated, root, active]);

    expect(compacted).toHaveLength(PEER_TASK_MAX_STORED);
    expect(compacted.some((item) => item.id === "root")).toBe(true);
    expect(compacted.some((item) => item.id === "active")).toBe(true);
  });
});

function task(
  id: string,
  updatedAt: number,
  overrides: Partial<PeerTask> = {},
): PeerTask {
  return {
    schemaVersion: PEER_TASK_SCHEMA_VERSION,
    id,
    sourceSessionId: "source",
    targetSessionId: "target",
    sourceAgentId: "agent-a",
    sourceModelId: "model-a",
    targetAgentId: "agent-b",
    targetModelId: "model-b",
    workspaceId: "local:c:/workspace",
    workspaceRoot: "C:/workspace",
    workspaceEnvironment: { kind: "local" },
    kind: "review",
    executionMode: "read-only",
    prompt: "Review",
    artifactRefs: [],
    parentTaskId: null,
    rootTaskId: id,
    hopCount: 0,
    status: "completed",
    createdAt: updatedAt,
    updatedAt,
    ...overrides,
  };
}
