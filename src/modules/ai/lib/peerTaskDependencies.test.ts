import { describe, expect, it } from "vitest";
import {
  evaluatePeerTaskDependencies,
  reconcilePeerTaskDependencies,
  recoverPeerTaskLedger,
  selectDispatchablePeerTaskIds,
  validatePeerTaskDependencies,
} from "./peerTaskDependencies";
import {
  PEER_TASK_MAX_DEPENDENCIES,
  PEER_TASK_MAX_DEPENDENCY_DEPTH,
  PEER_TASK_MAX_RUNNING,
  PEER_TASK_SCHEMA_VERSION,
  type PeerTask,
  type PeerTaskArtifact,
} from "./peerTasks";

describe("peer task dependency validation", () => {
  it("keeps a task without dependencies immediately ready", () => {
    expect(evaluatePeerTaskDependencies(task(), [])).toEqual({
      state: "ready",
    });
    expect(reconcilePeerTaskDependencies([task()])[0]?.status).toBe("queued");
    expect(
      reconcilePeerTaskDependencies([task({ status: "waiting" })])[0]?.status,
    ).toBe("queued");
  });

  it("rejects self dependencies", () => {
    expect(
      validatePeerTaskDependencies(
        { taskId: "candidate", rootTaskId: "root", dependsOn: ["candidate"] },
        [],
      ),
    ).toMatchObject({ ok: false, code: "peer_dependency_self" });
  });

  it("rejects duplicate dependencies", () => {
    const dependency = task({ id: "dependency", rootTaskId: "root" });
    expect(
      validatePeerTaskDependencies(
        {
          taskId: "candidate",
          rootTaskId: "root",
          dependsOn: [dependency.id, dependency.id],
        },
        [dependency],
      ),
    ).toMatchObject({ ok: false, code: "peer_dependency_duplicate" });
  });

  it("rejects missing and cross-root dependencies", () => {
    expect(
      validatePeerTaskDependencies(
        { taskId: "candidate", rootTaskId: "root", dependsOn: ["missing"] },
        [],
      ),
    ).toMatchObject({ ok: false, code: "peer_dependency_missing" });

    const outside = task({ id: "outside", rootTaskId: "other-root" });
    expect(
      validatePeerTaskDependencies(
        {
          taskId: "candidate",
          rootTaskId: "root",
          dependsOn: [outside.id],
        },
        [outside],
      ),
    ).toMatchObject({ ok: false, code: "peer_dependency_scope" });
  });

  it("rejects two-node and multi-node cycles", () => {
    const twoNode = task({
      id: "dependency",
      rootTaskId: "root",
      dependsOn: ["candidate"],
    });
    expect(
      validatePeerTaskDependencies(
        {
          taskId: "candidate",
          rootTaskId: "root",
          dependsOn: [twoNode.id],
        },
        [twoNode],
      ),
    ).toMatchObject({ ok: false, code: "peer_dependency_cycle" });

    const middle = task({
      id: "middle",
      rootTaskId: "root",
      dependsOn: ["last"],
    });
    const last = task({
      id: "last",
      rootTaskId: "root",
      dependsOn: ["candidate"],
    });
    expect(
      validatePeerTaskDependencies(
        {
          taskId: "candidate",
          rootTaskId: "root",
          dependsOn: [middle.id],
        },
        [middle, last],
      ),
    ).toMatchObject({ ok: false, code: "peer_dependency_cycle" });
  });

  it("enforces dependency count and graph depth limits", () => {
    const many = Array.from(
      { length: PEER_TASK_MAX_DEPENDENCIES + 1 },
      (_, i) => task({ id: `dependency-${i}`, rootTaskId: "root" }),
    );
    expect(
      validatePeerTaskDependencies(
        {
          taskId: "candidate",
          rootTaskId: "root",
          dependsOn: many.map((item) => item.id),
        },
        many,
      ),
    ).toMatchObject({ ok: false, code: "peer_dependency_limit" });

    const chain = Array.from(
      { length: PEER_TASK_MAX_DEPENDENCY_DEPTH + 1 },
      (_, index) =>
        task({
          id: `level-${index}`,
          rootTaskId: "root",
          dependsOn: index === 0 ? [] : [`level-${index - 1}`],
        }),
    );
    expect(
      validatePeerTaskDependencies(
        {
          taskId: "candidate",
          rootTaskId: "root",
          dependsOn: [chain[chain.length - 1]?.id ?? ""],
        },
        chain,
      ),
    ).toMatchObject({ ok: false, code: "peer_dependency_depth" });
  });
});

describe("peer task dependency transitions", () => {
  it("waits for one or several unfinished prerequisites", () => {
    const first = task({ id: "first", status: "running" });
    const second = task({ id: "second", status: "queued" });
    expect(
      evaluatePeerTaskDependencies(task({ dependsOn: [first.id] }), [first]),
    ).toEqual({ state: "waiting", taskIds: [first.id] });
    expect(
      evaluatePeerTaskDependencies(task({ dependsOn: [first.id, second.id] }), [
        first,
        second,
      ]),
    ).toEqual({ state: "waiting", taskIds: [first.id, second.id] });
  });

  it("queues a waiting task only after every prerequisite succeeds", () => {
    const first = task({ id: "first", status: "completed" });
    const second = task({ id: "second", status: "completed" });
    const dependent = task({
      id: "dependent",
      status: "waiting",
      dependsOn: [first.id, second.id],
    });
    const reconciled = reconcilePeerTaskDependencies(
      [first, second, dependent],
      42,
    );
    expect(reconciled.find((item) => item.id === dependent.id)).toMatchObject({
      status: "queued",
      dependenciesSatisfiedAt: 42,
    });
  });

  it.each([
    "failed",
    "cancelled",
  ] as const)("blocks a dependent when a prerequisite is %s", (status) => {
    const prerequisite = task({ id: "prerequisite", status });
    const dependent = task({
      id: "dependent",
      status: "waiting",
      dependsOn: [prerequisite.id],
    });
    const reconciled = reconcilePeerTaskDependencies(
      [prerequisite, dependent],
      43,
    );
    expect(reconciled.find((item) => item.id === dependent.id)).toMatchObject({
      status: "blocked",
      blockedByTaskId: prerequisite.id,
      blockedByStatus: status,
      endedAt: 43,
      error: { code: "peer_dependency_blocked" },
    });
  });

  it("propagates blocking while leaving an unrelated sibling eligible", () => {
    const failed = task({ id: "failed", status: "failed" });
    const blocked = task({
      id: "blocked",
      status: "waiting",
      dependsOn: [failed.id],
    });
    const downstream = task({
      id: "downstream",
      status: "waiting",
      dependsOn: [blocked.id],
    });
    const sibling = task({ id: "sibling", targetSessionId: "other-target" });
    const reconciled = reconcilePeerTaskDependencies([
      failed,
      blocked,
      downstream,
      sibling,
    ]);
    expect(reconciled.find((item) => item.id === blocked.id)?.status).toBe(
      "blocked",
    );
    expect(reconciled.find((item) => item.id === downstream.id)?.status).toBe(
      "blocked",
    );
    expect(reconciled.find((item) => item.id === sibling.id)?.status).toBe(
      "queued",
    );
  });

  it("preserves immutable artifacts while a task waits", () => {
    const prerequisite = task({ id: "prerequisite", status: "running" });
    const artifact = peerArtifact();
    const dependent = task({
      id: "dependent",
      status: "waiting",
      dependsOn: [prerequisite.id],
      artifactRefs: [artifact],
    });
    const reconciled = reconcilePeerTaskDependencies([prerequisite, dependent]);
    expect(
      reconciled.find((item) => item.id === dependent.id)?.artifactRefs,
    ).toEqual([artifact]);
  });
});

describe("peer task bounded scheduling and recovery", () => {
  it("uses the existing queue when a newly eligible target is busy", () => {
    const prerequisite = task({ id: "prerequisite", status: "completed" });
    const dependent = task({
      id: "dependent",
      status: "queued",
      dependsOn: [prerequisite.id],
    });
    expect(
      selectDispatchablePeerTaskIds(
        [prerequisite, dependent],
        new Map([[dependent.targetSessionId, "running"]]),
      ),
    ).toEqual([]);
  });

  it("dispatches independent tasks concurrently and one task per target", () => {
    const first = task({ id: "first", targetSessionId: "target-a" });
    const sameTarget = task({
      id: "same-target",
      targetSessionId: "target-a",
      createdAt: 2,
    });
    const second = task({
      id: "second",
      targetSessionId: "target-b",
      createdAt: 3,
    });
    expect(
      selectDispatchablePeerTaskIds([second, sameTarget, first], new Map()),
    ).toEqual([first.id, second.id]);
  });

  it("enforces the global running-task limit", () => {
    const running = Array.from({ length: PEER_TASK_MAX_RUNNING }, (_, index) =>
      task({
        id: `running-${index}`,
        status: "running",
        targetSessionId: `target-${index}`,
      }),
    );
    expect(
      selectDispatchablePeerTaskIds(
        [...running, task({ id: "queued", targetSessionId: "available" })],
        new Map(),
      ),
    ).toEqual([]);
  });

  it("preserves waiting work across restart", () => {
    const prerequisite = task({ id: "prerequisite", status: "queued" });
    const dependent = task({
      id: "dependent",
      status: "waiting",
      dependsOn: [prerequisite.id],
    });
    expect(
      recoverPeerTaskLedger([prerequisite, dependent], 50).find(
        (item) => item.id === dependent.id,
      )?.status,
    ).toBe("waiting");
  });

  it("reevaluates completed and interrupted prerequisites on restart", () => {
    const completed = task({ id: "completed", status: "completed" });
    const ready = task({
      id: "ready",
      status: "waiting",
      dependsOn: [completed.id],
    });
    expect(
      recoverPeerTaskLedger([completed, ready], 51).find(
        (item) => item.id === ready.id,
      ),
    ).toMatchObject({ status: "queued", dependenciesSatisfiedAt: 51 });

    const interrupted = task({ id: "interrupted", status: "running" });
    const blocked = task({
      id: "blocked",
      status: "waiting",
      dependsOn: [interrupted.id],
    });
    expect(
      recoverPeerTaskLedger([interrupted, blocked], 52).find(
        (item) => item.id === blocked.id,
      ),
    ).toMatchObject({
      status: "blocked",
      blockedByTaskId: interrupted.id,
      blockedByStatus: "failed",
    });
  });
});

function task(overrides: Partial<PeerTask> = {}): PeerTask {
  return {
    schemaVersion: PEER_TASK_SCHEMA_VERSION,
    id: "task",
    sourceSessionId: "source",
    targetSessionId: "target",
    sourceAgentId: "coder",
    sourceModelId: "model-a",
    targetAgentId: "reviewer",
    targetModelId: "model-b",
    workspaceId: "local:c:/workspace",
    workspaceRoot: "C:/workspace",
    workspaceEnvironment: { kind: "local" },
    kind: "review",
    executionMode: "read-only",
    prompt: "Review the change",
    artifactRefs: [],
    parentTaskId: null,
    rootTaskId: "root",
    hopCount: 0,
    dependsOn: [],
    status: "queued",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function peerArtifact(): PeerTaskArtifact {
  const hash = "a".repeat(64);
  return {
    id: "artifact",
    attachmentId: "attachment",
    contentRef: { id: hash, contentHash: hash, byteSize: 4 },
    displayName: "spec.md",
    mediaType: "text/markdown",
    contentKind: "text",
    byteSize: 4,
    sourceSessionId: "source",
    sourceTaskId: null,
    sourceAgentId: "coder",
    sourceModelId: "model-a",
    workspaceId: "local:c:/workspace",
    workspaceRoot: "C:/workspace",
    createdAt: 1,
    originType: "attachment",
    accessPolicy: "model-input",
  };
}
