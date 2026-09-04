import { describe, expect, it } from "vitest";
import {
  activePeerTaskDescendants,
  applyPeerTaskCancellationTargets,
  isPeerTaskActive,
  planPeerTaskCancellation,
} from "./peerTaskCancellation";
import {
  reconcilePeerTaskDependencies,
  recoverPeerTaskLedger,
  selectDispatchablePeerTaskIds,
} from "./peerTaskDependencies";
import {
  PEER_TASK_MAX_HOPS,
  PEER_TASK_MAX_PER_ROOT,
  PEER_TASK_SCHEMA_VERSION,
  collectPeerTaskContentIds,
  type PeerTask,
  type PeerTaskArtifact,
} from "./peerTasks";

describe("peer task cancellation planning", () => {
  it("cancels one task without descendants", () => {
    const root = task();
    const planned = plan(root, [root], false);

    expect(planned.targets.map((target) => target.taskId)).toEqual([root.id]);
    expect(planned.activeDescendantCount).toBe(0);
  });

  it.each([
    "queued",
    "waiting",
    "running",
  ] as const)("includes an active %s child in a cascading cancellation", (status) => {
    const root = task();
    const child = task({
      id: "child",
      parentTaskId: root.id,
      status,
    });

    const planned = plan(root, [child, root], true);

    expect(planned.targets.map((target) => target.taskId)).toEqual([
      root.id,
      child.id,
    ]);
    expect(planned.targets[1]?.cancellation.cause).toBe("orchestration");
  });

  it("traverses nested descendants deterministically", () => {
    const root = task();
    const later = task({
      id: "later",
      parentTaskId: root.id,
      createdAt: 3,
    });
    const first = task({
      id: "first",
      parentTaskId: root.id,
      createdAt: 2,
    });
    const grandchild = task({
      id: "grandchild",
      parentTaskId: first.id,
      hopCount: 2,
      createdAt: 4,
    });

    expect(
      plan(root, [grandchild, later, root, first], true).targets.map(
        (target) => target.taskId,
      ),
    ).toEqual([root.id, first.id, later.id, grandchild.id]);
  });

  it("cancels every active branch when the orchestration root is selected", () => {
    const root = task();
    const first = task({ id: "first", parentTaskId: root.id, createdAt: 2 });
    const second = task({ id: "second", parentTaskId: root.id, createdAt: 3 });
    const firstChild = task({
      id: "first-child",
      parentTaskId: first.id,
      hopCount: 2,
      createdAt: 4,
    });
    const secondChild = task({
      id: "second-child",
      parentTaskId: second.id,
      hopCount: 2,
      createdAt: 5,
    });

    expect(
      plan(
        root,
        [secondChild, root, firstChild, second, first],
        true,
      ).targets.map((target) => target.taskId),
    ).toEqual([root.id, first.id, second.id, firstChild.id, secondChild.id]);
  });

  it("leaves completed, failed, and unrelated sibling work unchanged", () => {
    const root = task();
    const branch = task({ id: "branch", parentTaskId: root.id });
    const completed = task({
      id: "completed",
      parentTaskId: branch.id,
      status: "completed",
    });
    const failed = task({
      id: "failed",
      parentTaskId: branch.id,
      status: "failed",
    });
    const sibling = task({ id: "sibling", parentTaskId: root.id });

    const planned = plan(
      branch,
      [root, branch, completed, failed, sibling],
      true,
    );

    expect(planned.targets.map((target) => target.taskId)).toEqual([branch.id]);
  });

  it("cancels only the selected parent when cascade is disabled", () => {
    const root = task();
    const child = task({
      id: "child",
      parentTaskId: root.id,
      status: "running",
    });

    expect(plan(root, [root, child], false).targets).toHaveLength(1);
  });

  it("ignores malformed cross-root children and terminates hierarchy cycles", () => {
    const root = task({ parentTaskId: "child" });
    const child = task({ id: "child", parentTaskId: root.id });
    const outside = task({
      id: "outside",
      rootTaskId: "outside",
      parentTaskId: root.id,
    });

    expect(activePeerTaskDescendants(root.id, [outside, child, root])).toEqual([
      child,
    ]);
  });

  it("rejects programmatic cancellation outside the caller root", () => {
    const root = task();
    expect(
      planPeerTaskCancellation(
        {
          taskId: root.id,
          cascade: true,
          actor: "programmatic",
          authorizedRootTaskId: "another-root",
        },
        [root],
      ),
    ).toMatchObject({ ok: false, code: "peer_cancellation_scope" });
  });

  it("enforces collaboration count and hierarchy depth bounds", () => {
    const root = task();
    const oversized = Array.from(
      { length: PEER_TASK_MAX_PER_ROOT },
      (_, index) =>
        task({
          id: `child-${index}`,
          parentTaskId: root.id,
          createdAt: index + 2,
        }),
    );
    expect(
      planPeerTaskCancellation(
        { taskId: root.id, cascade: true, actor: "user" },
        [root, ...oversized],
      ),
    ).toMatchObject({ ok: false, code: "peer_cancellation_limit" });

    const chain = [root];
    let parent = root;
    for (let depth = 1; depth <= PEER_TASK_MAX_HOPS + 1; depth += 1) {
      const child = task({
        id: `depth-${depth}`,
        parentTaskId: parent.id,
        hopCount: depth,
      });
      chain.push(child);
      parent = child;
    }
    expect(
      planPeerTaskCancellation(
        { taskId: root.id, cascade: true, actor: "user" },
        chain,
      ),
    ).toMatchObject({ ok: false, code: "peer_cancellation_depth" });
  });
});

describe("peer task cancellation transitions", () => {
  it("blocks an external dependent when its prerequisite is cancelled", () => {
    const prerequisite = task();
    const dependent = task({
      id: "dependent",
      parentTaskId: null,
      status: "waiting",
      dependsOn: [prerequisite.id],
    });
    const planned = plan(prerequisite, [prerequisite, dependent], false);
    const cancelled = applyPeerTaskCancellationTargets(
      [prerequisite, dependent],
      planned.targets,
    );
    const reconciled = reconcilePeerTaskDependencies(cancelled.tasks, 101);

    expect(reconciled.find((item) => item.id === dependent.id)).toMatchObject({
      status: "blocked",
      blockedByTaskId: prerequisite.id,
      blockedByStatus: "cancelled",
    });
  });

  it("keeps propagated descendants cancelled instead of dependency-blocked", () => {
    const root = task();
    const child = task({
      id: "child",
      parentTaskId: root.id,
      status: "waiting",
      dependsOn: [root.id],
    });
    const planned = plan(root, [root, child], true);
    const cancelled = applyPeerTaskCancellationTargets(
      [root, child],
      planned.targets,
    );
    const reconciled = reconcilePeerTaskDependencies(cancelled.tasks, 102);

    expect(reconciled.find((item) => item.id === child.id)).toMatchObject({
      status: "cancelled",
      cancellation: { cause: "orchestration", cancelledByTaskId: root.id },
    });
  });

  it.each([
    "queued",
    "waiting",
  ] as const)("never dispatches a cancelled %s task", (status) => {
    const selected = task({ status });
    const planned = plan(selected, [selected], false);
    const cancelled = applyPeerTaskCancellationTargets(
      [selected],
      planned.targets,
    );

    expect(selectDispatchablePeerTaskIds(cancelled.tasks, new Map())).toEqual(
      [],
    );
  });

  it("preserves propagated cancellation through restart recovery", () => {
    const root = task();
    const child = task({
      id: "child",
      parentTaskId: root.id,
      status: "waiting",
    });
    const planned = plan(root, [root, child], true);
    const cancelled = applyPeerTaskCancellationTargets(
      [root, child],
      planned.targets,
    ).tasks;

    expect(recoverPeerTaskLedger(cancelled, 500)).toEqual(cancelled);
  });

  it("removes cancelled tasks from active counts immediately", () => {
    const root = task();
    const child = task({
      id: "child",
      parentTaskId: root.id,
      status: "running",
    });
    const unrelated = task({ id: "unrelated", rootTaskId: "unrelated" });
    const planned = plan(root, [root, child, unrelated], true);
    const cancelled = applyPeerTaskCancellationTargets(
      [root, child, unrelated],
      planned.targets,
    ).tasks;

    expect(cancelled.filter(isPeerTaskActive).map((item) => item.id)).toEqual([
      unrelated.id,
    ]);
  });

  it("persists direct and propagated cancellation provenance", () => {
    const root = task();
    const child = task({ id: "child", parentTaskId: root.id });
    const planned = planPeerTaskCancellation(
      {
        taskId: root.id,
        cascade: true,
        actor: "programmatic",
        reason: "  Stop obsolete branch.  ",
      },
      [root, child],
      77,
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const cancelled = applyPeerTaskCancellationTargets(
      [root, child],
      planned.targets,
    ).tasks;

    expect(cancelled.find((item) => item.id === root.id)?.cancellation).toEqual(
      {
        actor: "programmatic",
        cause: "direct",
        requestedTaskId: root.id,
        cancelledByTaskId: undefined,
        reason: "Stop obsolete branch.",
        cancelledAt: 77,
        cancelledDescendantCount: 1,
      },
    );
    expect(
      cancelled.find((item) => item.id === child.id)?.cancellation,
    ).toMatchObject({
      cause: "orchestration",
      cancelledByTaskId: root.id,
    });
  });

  it("is idempotent and lets the first terminal transition win", () => {
    const root = task();
    const firstPlan = plan(root, [root], false);
    const first = applyPeerTaskCancellationTargets([root], firstPlan.targets);
    const repeated = applyPeerTaskCancellationTargets(
      first.tasks,
      firstPlan.targets,
    );

    expect(repeated.transitions).toEqual([]);
    expect(repeated.tasks).toEqual(first.tasks);

    const completed = task({ status: "completed" });
    const completedPlan = planPeerTaskCancellation(
      { taskId: completed.id, cascade: true, actor: "user" },
      [completed],
    );
    expect(completedPlan).toMatchObject({
      ok: true,
      alreadyTerminal: true,
      targets: [],
    });
  });

  it("retains content references, artifacts, changes, and worktree recovery", () => {
    const artifact = peerArtifact();
    const root = task({
      status: "running",
      artifactRefs: [artifact],
      worktree: { checkoutRoot: "C:/tmp/worktree", baseSha: "abc" },
      changeSet: {
        baseSha: "abc",
        patch: "diff --git a/a b/a\n",
        changedPaths: ["a"],
      },
    });
    const planned = plan(root, [root], false);
    const cancelled = applyPeerTaskCancellationTargets([root], planned.targets)
      .tasks[0];

    expect(cancelled?.artifactRefs).toEqual([artifact]);
    expect(cancelled?.changeSet?.patch).toContain("diff --git");
    expect(cancelled?.worktree?.checkoutRoot).toBe("C:/tmp/worktree");
    expect(collectPeerTaskContentIds(cancelled ? [cancelled] : [])).toEqual([
      artifact.contentRef.id,
    ]);
  });
});

function plan(root: PeerTask, tasks: PeerTask[], cascade: boolean) {
  const planned = planPeerTaskCancellation(
    { taskId: root.id, cascade, actor: "user" },
    tasks,
    50,
  );
  expect(planned.ok).toBe(true);
  if (!planned.ok) throw new Error(planned.message);
  return planned;
}

function task(overrides: Partial<PeerTask> = {}): PeerTask {
  return {
    schemaVersion: PEER_TASK_SCHEMA_VERSION,
    id: "root",
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
