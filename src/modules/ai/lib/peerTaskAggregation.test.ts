import { describe, expect, it } from "vitest";
import {
  PEER_TASK_SCHEMA_VERSION,
  normalizePeerTask,
  type PeerTask,
  type PeerTaskArtifact,
} from "./peerTasks";
import {
  PEER_TASK_AGGREGATE_MAX_ARTIFACT_REFS,
  PEER_TASK_AGGREGATE_MAX_CHANGED_PATHS,
  PEER_TASK_AGGREGATE_MAX_RESULTS,
  PEER_TASK_AGGREGATE_MAX_RESULT_CHARS,
  PEER_TASK_AGGREGATE_MAX_TOTAL_TEXT_CHARS,
  buildPeerTaskDependencyAggregate,
  buildPeerTaskDescendantAggregate,
  buildPeerTaskRelatedAggregate,
  formatPeerTaskAggregateForModel,
} from "./peerTaskAggregation";

describe("peer task result aggregation", () => {
  it("aggregates a single child result without replacing its raw result", () => {
    const source = task();
    const child = completedTask({
      id: "child",
      parentTaskId: source.id,
      rootTaskId: source.id,
      prompt: "Inspect authentication",
      result: result("Authentication is bounded."),
    });

    const aggregate = buildPeerTaskDescendantAggregate(source, [source, child]);

    expect(aggregate.entries).toHaveLength(1);
    expect(aggregate.entries[0]).toMatchObject({
      taskId: child.id,
      relation: "child",
      status: "completed",
      resultSummary: "Authentication is bounded.",
      rawResultAvailable: true,
    });
    expect(child.result?.summary).toBe("Authentication is bounded.");
  });

  it("aggregates multiple child and deeper descendant results", () => {
    const source = task();
    const child = completedTask({
      id: "child",
      parentTaskId: source.id,
      rootTaskId: source.id,
      createdAt: 2,
    });
    const descendant = completedTask({
      id: "descendant",
      parentTaskId: child.id,
      rootTaskId: source.id,
      hopCount: 2,
      createdAt: 3,
    });

    const aggregate = buildPeerTaskDescendantAggregate(source, [
      descendant,
      source,
      child,
    ]);

    expect(
      aggregate.entries.map(({ taskId, relation }) => [taskId, relation]),
    ).toEqual([
      ["child", "child"],
      ["descendant", "descendant"],
    ]);
  });

  it("builds a dependency-only aggregate in declaration order", () => {
    const first = completedTask({ id: "first", createdAt: 3 });
    const second = completedTask({ id: "second", createdAt: 2 });
    const unrelatedChild = completedTask({
      id: "child",
      parentTaskId: "integrator",
      createdAt: 4,
    });
    const integrator = task({
      id: "integrator",
      dependsOn: [first.id, second.id],
    });

    const aggregate = buildPeerTaskDependencyAggregate(integrator, [
      second,
      unrelatedChild,
      first,
      integrator,
    ]);

    expect(aggregate.entries.map((entry) => entry.taskId)).toEqual([
      "first",
      "second",
    ]);
    expect(
      aggregate.entries.every((entry) => entry.relation === "dependency"),
    ).toBe(true);
  });

  it("marks a direct child separately from a deeper descendant", () => {
    const source = task();
    const direct = completedTask({
      id: "direct",
      parentTaskId: source.id,
      rootTaskId: source.id,
    });
    const deep = completedTask({
      id: "deep",
      parentTaskId: direct.id,
      rootTaskId: source.id,
      hopCount: 2,
    });

    const aggregate = buildPeerTaskDescendantAggregate(source, [
      source,
      direct,
      deep,
    ]);

    expect(aggregate.entries[0].relation).toBe("child");
    expect(aggregate.entries[1].relation).toBe("descendant");
  });

  it("uses dependency order followed by descendant creation order", () => {
    const dependencyA = completedTask({ id: "dependency-a", createdAt: 8 });
    const dependencyB = completedTask({ id: "dependency-b", createdAt: 7 });
    const source = task({
      dependsOn: [dependencyB.id, dependencyA.id],
    });
    const laterChild = completedTask({
      id: "later-child",
      parentTaskId: source.id,
      rootTaskId: source.id,
      createdAt: 5,
    });
    const earlierChild = completedTask({
      id: "earlier-child",
      parentTaskId: source.id,
      rootTaskId: source.id,
      createdAt: 4,
    });

    const aggregate = buildPeerTaskRelatedAggregate(source, [
      laterChild,
      dependencyA,
      source,
      earlierChild,
      dependencyB,
    ]);

    expect(aggregate.entries.map((entry) => entry.taskId)).toEqual([
      "dependency-b",
      "dependency-a",
      "earlier-child",
      "later-child",
    ]);
  });

  it("deduplicates a task reachable as both a dependency and a child", () => {
    const shared = completedTask({
      id: "shared",
      parentTaskId: "source",
      rootTaskId: "source",
    });
    const source = task({ dependsOn: [shared.id] });

    const aggregate = buildPeerTaskRelatedAggregate(source, [source, shared]);

    expect(aggregate.entries).toHaveLength(1);
    expect(aggregate.entries[0].relation).toBe("dependency");
  });

  it("enforces the maximum aggregated result count and reports omissions", () => {
    const source = task();
    const children = Array.from(
      { length: PEER_TASK_AGGREGATE_MAX_RESULTS + 3 },
      (_, index) =>
        completedTask({
          id: `child-${index}`,
          parentTaskId: source.id,
          rootTaskId: source.id,
          createdAt: index + 2,
        }),
    );

    const aggregate = buildPeerTaskDescendantAggregate(source, [
      source,
      ...children,
    ]);

    expect(aggregate.entries).toHaveLength(PEER_TASK_AGGREGATE_MAX_RESULTS);
    expect(aggregate.relevantTaskCount).toBe(children.length);
    expect(aggregate.omittedTaskCount).toBe(3);
    expect(aggregate.truncated).toBe(true);
  });

  it("truncates each result summary deterministically", () => {
    const source = task();
    const child = completedTask({
      id: "child",
      parentTaskId: source.id,
      rootTaskId: source.id,
      result: result("x".repeat(PEER_TASK_AGGREGATE_MAX_RESULT_CHARS + 100)),
    });

    const aggregate = buildPeerTaskDescendantAggregate(source, [source, child]);

    expect(aggregate.entries[0].resultSummary).toHaveLength(
      PEER_TASK_AGGREGATE_MAX_RESULT_CHARS,
    );
    expect(aggregate.entries[0].resultSummary?.endsWith("...")).toBe(true);
    expect(aggregate.entries[0].truncated).toBe(true);
  });

  it("bounds total model context and marks context compaction", () => {
    const source = task();
    const children = Array.from({ length: 8 }, (_, index) =>
      completedTask({
        id: `verbose-child-${index}`,
        parentTaskId: source.id,
        rootTaskId: source.id,
        prompt: `Prompt ${index} ${"p".repeat(400)}`,
        targetAgentId: `agent-${index}-${"a".repeat(160)}`,
        targetModelId: `model-${index}-${"m".repeat(160)}`,
        result: result("r".repeat(2_000)),
        changeSet: {
          baseSha: "abc",
          patch: "diff",
          changedPaths: Array.from(
            { length: 8 },
            (_, pathIndex) => `src/${index}/${"path".repeat(80)}-${pathIndex}`,
          ),
        },
      }),
    );

    const formatted = formatPeerTaskAggregateForModel(
      buildPeerTaskDescendantAggregate(source, [source, ...children]),
    );

    expect(formatted.text.length).toBeLessThanOrEqual(
      PEER_TASK_AGGREGATE_MAX_TOTAL_TEXT_CHARS,
    );
    expect(formatted.truncated).toBe(true);
    expect(formatted.text).toContain("</peer-task-results>");
    const payload = JSON.parse(formatted.text.split("\n")[1]);
    expect(payload.truncated).toBe(true);
    expect(payload.results ?? payload.resultRefs).toHaveLength(8);
    const compactSummary =
      payload.results?.[0]?.summary ?? payload.results?.[0]?.resultSummary;
    if (compactSummary) expect(compactSummary.length).toBeLessThanOrEqual(320);
  });

  it("caps returned artifact references across the whole aggregate", () => {
    const source = task();
    const children = [0, 1].map((index) =>
      completedTask({
        id: `child-${index}`,
        parentTaskId: source.id,
        rootTaskId: source.id,
        result: result(
          "Done",
          Array.from({ length: 12 }, (_, artifactIndex) =>
            artifact(`${index}-${artifactIndex}`),
          ),
        ),
      }),
    );

    const aggregate = buildPeerTaskDescendantAggregate(source, [
      source,
      ...children,
    ]);

    expect(aggregate.includedArtifactRefCount).toBe(
      PEER_TASK_AGGREGATE_MAX_ARTIFACT_REFS,
    );
    expect(aggregate.omittedArtifactRefCount).toBe(8);
    expect(aggregate.truncated).toBe(true);
  });

  it("caps changed paths across the whole aggregate", () => {
    const source = task();
    const child = completedTask({
      id: "child",
      parentTaskId: source.id,
      rootTaskId: source.id,
      changeSet: {
        baseSha: "abc",
        patch: "diff",
        changedPaths: Array.from(
          { length: PEER_TASK_AGGREGATE_MAX_CHANGED_PATHS + 4 },
          (_, index) => `src/file-${index}.ts`,
        ),
      },
    });

    const aggregate = buildPeerTaskDescendantAggregate(source, [source, child]);

    expect(aggregate.includedChangedPathCount).toBe(
      PEER_TASK_AGGREGATE_MAX_CHANGED_PATHS,
    );
    expect(aggregate.omittedChangedPathCount).toBe(4);
    expect(aggregate.entries[0].patchAvailable).toBe(true);
  });

  it("represents a failed child with its bounded error", () => {
    const source = task();
    const failed = task({
      id: "failed",
      parentTaskId: source.id,
      rootTaskId: source.id,
      status: "failed",
      endedAt: 4,
      error: { code: "review_failed", message: "Review failed." },
    });

    const aggregate = buildPeerTaskDescendantAggregate(source, [
      source,
      failed,
    ]);

    expect(aggregate.entries[0]).toMatchObject({
      status: "failed",
      error: { code: "review_failed", message: "Review failed." },
      rawResultAvailable: false,
    });
    expect(aggregate.complete).toBe(true);
    expect(aggregate.allSuccessful).toBe(false);
  });

  it("represents a cancelled child with its reason", () => {
    const source = task();
    const cancelled = task({
      id: "cancelled",
      parentTaskId: source.id,
      rootTaskId: source.id,
      status: "cancelled",
      cancellation: {
        actor: "user",
        cause: "direct",
        requestedTaskId: "cancelled",
        reason: "No longer needed.",
        cancelledAt: 5,
      },
    });

    const aggregate = buildPeerTaskDescendantAggregate(source, [
      source,
      cancelled,
    ]);

    expect(aggregate.entries[0]).toMatchObject({
      status: "cancelled",
      cancellationReason: "No longer needed.",
    });
  });

  it("represents a blocked child without inventing a result", () => {
    const source = task();
    const blocked = task({
      id: "blocked",
      parentTaskId: source.id,
      rootTaskId: source.id,
      status: "blocked",
      error: {
        code: "peer_dependency_blocked",
        message: "Required review failed.",
      },
    });

    const aggregate = buildPeerTaskDescendantAggregate(source, [
      source,
      blocked,
    ]);

    expect(aggregate.entries[0]).toMatchObject({
      status: "blocked",
      rawResultAvailable: false,
      resultSummary: undefined,
    });
  });

  it("marks an aggregate with a running child incomplete", () => {
    const source = task();
    const running = task({
      id: "running",
      parentTaskId: source.id,
      rootTaskId: source.id,
      status: "running",
    });

    const aggregate = buildPeerTaskDescendantAggregate(source, [
      source,
      running,
    ]);

    expect(aggregate.entries[0].status).toBe("running");
    expect(aggregate.complete).toBe(false);
  });

  it("reconstructs the same aggregate from normalized persisted tasks", () => {
    const source = task({ dependsOn: ["completed"] });
    const completed = completedTask({
      id: "completed",
      result: result("Stable persisted result", [artifact("persisted")]),
    });
    const before = buildPeerTaskDependencyAggregate(source, [
      source,
      completed,
    ]);
    const reloaded = [source, completed].map((value) =>
      normalizePeerTask(JSON.parse(JSON.stringify(value))),
    );

    expect(reloaded.every(Boolean)).toBe(true);
    const after = buildPeerTaskDependencyAggregate(
      reloaded[0] as PeerTask,
      reloaded as PeerTask[],
    );
    expect(after).toEqual(before);
    expect(formatPeerTaskAggregateForModel(after)).toEqual(
      formatPeerTaskAggregateForModel(before),
    );
  });

  it("does not mutate or shorten the durable raw result", () => {
    const source = task();
    const raw = "raw ".repeat(1_000);
    const child = completedTask({
      id: "child",
      parentTaskId: source.id,
      rootTaskId: source.id,
      result: result(raw),
    });
    const before = structuredClone(child);

    buildPeerTaskDescendantAggregate(source, [source, child]);

    expect(child).toEqual(before);
    expect(child.result?.summary).toBe(raw);
  });

  it("includes only explicitly declared prerequisite results", () => {
    const included = completedTask({
      id: "included",
      result: result("INCLUDED RESULT"),
    });
    const unrelated = completedTask({
      id: "unrelated",
      result: result("UNRELATED RESULT"),
    });
    const source = task({ dependsOn: [included.id] });

    const aggregate = buildPeerTaskDependencyAggregate(source, [
      source,
      unrelated,
      included,
    ]);
    const context = formatPeerTaskAggregateForModel(aggregate).text;

    expect(context).toContain("INCLUDED RESULT");
    expect(context).not.toContain("UNRELATED RESULT");
  });

  it("excludes descendants from another root or workspace", () => {
    const source = task();
    const wrongRoot = completedTask({
      id: "wrong-root",
      parentTaskId: source.id,
      rootTaskId: "another-root",
    });
    const wrongWorkspace = completedTask({
      id: "wrong-workspace",
      parentTaskId: source.id,
      rootTaskId: source.id,
      workspaceId: "local:c:/other",
    });

    const aggregate = buildPeerTaskDescendantAggregate(source, [
      source,
      wrongRoot,
      wrongWorkspace,
    ]);

    expect(aggregate.entries).toEqual([]);
  });

  it("exposes returned artifact metadata and references without content bytes", () => {
    const source = task();
    const returned = artifact("report", {
      displayName: "report.md",
      mediaType: "text/markdown",
    });
    const child = completedTask({
      id: "child",
      parentTaskId: source.id,
      rootTaskId: source.id,
      result: result("Report ready", [returned]),
    });

    const aggregate = buildPeerTaskDescendantAggregate(source, [source, child]);
    const serialized = JSON.stringify(aggregate);

    expect(aggregate.entries[0].artifactRefs[0]).toMatchObject({
      artifactId: returned.id,
      contentId: returned.contentRef.id,
      displayName: "report.md",
      mediaType: "text/markdown",
      byteSize: returned.byteSize,
    });
    expect(serialized).not.toContain("contentBytes");
    expect(serialized).not.toContain("SECRET_FILE_BYTES");
  });

  it("records patch, worktree, warnings, completion, and provenance", () => {
    const source = task();
    const child = completedTask({
      id: "child",
      parentTaskId: source.id,
      rootTaskId: source.id,
      endedAt: 9,
      worktree: { checkoutRoot: "C:/worktree", baseSha: "abc" },
      changeSet: {
        baseSha: "abc",
        patch: "diff",
        changedPaths: ["src/a.ts"],
        applyError: "Patch no longer applies cleanly.",
      },
    });

    const entry = buildPeerTaskDescendantAggregate(source, [source, child])
      .entries[0];

    expect(entry).toMatchObject({
      completedAt: 2,
      warnings: ["Patch no longer applies cleanly."],
      patchAvailable: true,
      worktreeAvailable: true,
      provenance: {
        rootTaskId: source.id,
        parentTaskId: source.id,
        sourceSessionId: "source",
        targetSessionId: "target",
      },
    });
  });

  it("represents a missing dependency as unavailable", () => {
    const source = task({ dependsOn: ["missing"] });

    const aggregate = buildPeerTaskDependencyAggregate(source, [source]);

    expect(aggregate.entries[0]).toMatchObject({
      taskId: "missing",
      status: "missing",
      error: { code: "peer_task_missing" },
    });
    expect(aggregate.complete).toBe(false);
  });

  it("keeps malformed parent cycles bounded and cycle-safe", () => {
    const source = task({ parentTaskId: "child" });
    const child = completedTask({
      id: "child",
      parentTaskId: source.id,
      rootTaskId: source.id,
    });

    const aggregate = buildPeerTaskDescendantAggregate(source, [source, child]);

    expect(aggregate.entries.map((entry) => entry.taskId)).toEqual(["child"]);
    expect(aggregate.entries.length).toBeLessThanOrEqual(
      PEER_TASK_AGGREGATE_MAX_RESULTS,
    );
  });
});

function completedTask(overrides: Partial<PeerTask> = {}): PeerTask {
  return task({
    status: "completed",
    endedAt: 2,
    result: result("Completed result"),
    ...overrides,
  });
}

function task(overrides: Partial<PeerTask> = {}): PeerTask {
  return {
    schemaVersion: PEER_TASK_SCHEMA_VERSION,
    id: "source",
    sourceSessionId: "source",
    targetSessionId: "target",
    sourceAgentId: "agent-source",
    sourceModelId: "model-source",
    targetAgentId: "agent-target",
    targetModelId: "model-target",
    workspaceId: "local:c:/workspace",
    workspaceRoot: "C:/workspace",
    workspaceEnvironment: { kind: "local" },
    kind: "review",
    executionMode: "read-only",
    prompt: "Review the bounded result",
    artifactRefs: [],
    parentTaskId: null,
    rootTaskId: "source",
    hopCount: 0,
    dependsOn: [],
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function result(summary: string, artifacts: PeerTaskArtifact[] = []) {
  return {
    summary,
    targetSessionId: "target",
    targetAgentId: "agent-target",
    targetModelId: "model-target",
    completedAt: 2,
    artifacts,
  };
}

function artifact(
  suffix: string,
  overrides: Partial<PeerTaskArtifact> = {},
): PeerTaskArtifact {
  const digit = (suffix.length % 10).toString();
  const hash = digit.repeat(64);
  return {
    id: `artifact-${suffix}`,
    attachmentId: `attachment-${suffix}`,
    contentRef: { id: hash, contentHash: hash, byteSize: 16 },
    displayName: `result-${suffix}.txt`,
    mediaType: "text/plain",
    contentKind: "text",
    byteSize: 16,
    sourceSessionId: "target",
    sourceTaskId: "child",
    sourceAgentId: "agent-target",
    sourceModelId: "model-target",
    workspaceId: "local:c:/workspace",
    workspaceRoot: "C:/workspace",
    createdAt: 2,
    originType: "generated-file",
    accessPolicy: "model-input",
    ...overrides,
  };
}
