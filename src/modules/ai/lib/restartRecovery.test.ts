import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { isPeerTaskActive } from "./peerTaskCancellation";
import {
  buildPeerTaskDependencyAggregate,
  buildPeerTaskDescendantAggregate,
} from "./peerTaskAggregation";
import { selectDispatchablePeerTaskIds } from "./peerTaskDependencies";
import {
  PEER_TASK_SCHEMA_VERSION,
  collectPeerTaskContentIds,
  type PeerTask,
  type PeerTaskArtifact,
} from "./peerTasks";
import { recoverPeerTasks } from "./restartRecovery";
import {
  collectAttachmentContentIds,
  toAttachmentMessagePart,
} from "./attachmentMessages";
import { recoverInterruptedSessions, type SessionMeta } from "./sessions";
import type { AttachmentRecord } from "./attachments";

const NOW = 100;
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

describe("restart recovery crash boundaries", () => {
  it("marks a running chat interrupted while preserving its run metadata", () => {
    const running = session("target", {
      run: {
        state: "running",
        startedAt: 2,
        agentId: "agent-b",
        modelId: "model-b",
      },
    });
    const recovered = recoverInterruptedSessions([running], NOW);
    expect(recovered.interruptedIds).toEqual(["target"]);
    expect(recovered.sessions[0].run).toMatchObject({
      state: "interrupted",
      startedAt: 2,
      endedAt: NOW,
      agentId: "agent-b",
      modelId: "model-b",
    });
  });

  it("fails a running peer task with restart provenance and keeps recoverable work", () => {
    const original = task({
      status: "running",
      result: result([artifact(HASH_B)]),
      worktree: { checkoutRoot: "C:/cache/worktree", baseSha: HASH_C },
      changeSet: {
        baseSha: HASH_C,
        patch: "diff --git a/a b/a\n",
        changedPaths: ["a"],
      },
    });
    const recovered = recover([original], {
      worktrees: [{ taskId: original.id, state: "available" }],
    })[0];
    expect(recovered).toMatchObject({
      status: "failed",
      endedAt: NOW,
      error: { code: "peer_task_interrupted" },
      recovery: {
        interruption: { cause: "app-restart", detectedAt: NOW },
      },
      result: original.result,
      worktree: original.worktree,
      changeSet: original.changeSet,
    });
  });

  it("keeps a valid queued task eligible for later dispatch", () => {
    const recovered = recover([task()]);
    expect(recovered[0].status).toBe("queued");
    expect(selectDispatchablePeerTaskIds(recovered, new Map())).toEqual([
      "task",
    ]);
  });

  it("promotes waiting work after all dependencies completed", () => {
    const prerequisite = task({ id: "first", status: "completed" });
    const dependent = task({
      id: "second",
      status: "waiting",
      dependsOn: [prerequisite.id],
    });
    expect(recover([prerequisite, dependent])[1]).toMatchObject({
      status: "queued",
      dependenciesSatisfiedAt: NOW,
    });
  });

  it("blocks waiting work when a dependency failed", () => {
    const prerequisite = task({ id: "first", status: "failed" });
    const dependent = task({
      id: "second",
      status: "waiting",
      dependsOn: [prerequisite.id],
    });
    expect(recover([prerequisite, dependent])[1]).toMatchObject({
      status: "blocked",
      blockedByTaskId: "first",
      blockedByStatus: "failed",
    });
  });

  it("keeps cancellation terminal with its original provenance", () => {
    const cancelled = task({
      status: "cancelled",
      endedAt: 20,
      cancellation: {
        actor: "user",
        cause: "parent",
        requestedTaskId: "root",
        cancelledByTaskId: "root",
        reason: "Stopped by user.",
        cancelledAt: 20,
      },
    });
    expect(recover([cancelled])[0]).toEqual(cancelled);
  });

  it("keeps blocked work terminal with its cause and timestamps", () => {
    const blocked = task({
      status: "blocked",
      endedAt: 21,
      blockedByTaskId: "missing",
      blockedByStatus: "missing",
      error: {
        code: "peer_dependency_blocked",
        message: "Required task missing is unavailable.",
      },
    });
    expect(recover([blocked])[0]).toEqual(blocked);
  });

  it("removes stale running work from active counts", () => {
    const recovered = recover([
      task({ id: "running", status: "running" }),
      task({ id: "queued" }),
      task({ id: "done", status: "completed" }),
    ]);
    expect(recovered.filter(isPeerTaskActive).map((item) => item.id)).toEqual([
      "queued",
    ]);
  });

  it("preserves queued immutable artifact references", () => {
    const input = artifact(HASH_A);
    expect(recover([task({ artifactRefs: [input] })])[0].artifactRefs).toEqual([
      input,
    ]);
  });

  it("fails queued work before dispatch when input content is missing", () => {
    const recovered = recover([task({ artifactRefs: [artifact(HASH_A)] })], {
      contentIssues: [issue(HASH_A, "attachment_content_missing")],
    });
    expect(recovered[0]).toMatchObject({
      status: "failed",
      error: { code: "peer_artifact_unavailable" },
    });
    expect(selectDispatchablePeerTaskIds(recovered, new Map())).toEqual([]);
  });

  it("fails closed on an immutable artifact hash mismatch", () => {
    const recovered = recover([task({ artifactRefs: [artifact(HASH_A)] })], {
      contentIssues: [
        issue(HASH_A, "attachment_content_integrity_failed"),
      ],
    });
    expect(recovered[0]).toMatchObject({
      status: "failed",
      error: { code: "peer_artifact_integrity_failed" },
    });
  });

  it("preserves returned artifact metadata when its content is missing", () => {
    const returned = artifact(HASH_B);
    const completed = task({
      status: "completed",
      result: result([returned]),
    });
    const recovered = recover([completed], {
      contentIssues: [issue(HASH_B, "attachment_content_missing")],
    })[0];
    expect(recovered.status).toBe("completed");
    expect(recovered.result?.artifacts).toEqual([returned]);
    expect(recovered.recovery?.contentIssues?.[0]).toMatchObject({
      artifactId: returned.id,
      role: "returned",
      code: "attachment_content_missing",
    });
  });

  it("rebuilds the same aggregate after recovery", () => {
    const first = task({ id: "first", status: "completed" });
    const source = task({
      id: "source-task",
      dependsOn: [first.id],
      status: "waiting",
    });
    const before = buildPeerTaskDependencyAggregate(source, [first, source]);
    const recovered = recover([first, source]);
    const afterSource = recovered.find((item) => item.id === source.id);
    expect(afterSource).toBeDefined();
    if (!afterSource) return;
    const after = buildPeerTaskDependencyAggregate(afterSource, recovered);
    expect(after.entries).toEqual(before.entries);
  });

  it("does not duplicate aggregate contributors during repeated recovery", () => {
    const root = task({ id: "root", rootTaskId: "root" });
    const child = task({
      id: "child",
      rootTaskId: "root",
      parentTaskId: "root",
      status: "completed",
    });
    const once = recover([root, child]);
    const twice = recover(once);
    expect(buildPeerTaskDescendantAggregate(twice[0], twice).entries).toHaveLength(
      1,
    );
  });

  it("retains normal chat attachment content IDs", () => {
    const message = {
      id: "message",
      role: "user",
      parts: [toAttachmentMessagePart(attachmentRecord())],
    } as UIMessage;
    expect(collectAttachmentContentIds([message])).toEqual([HASH_A]);
  });

  it("retains peer inputs, returns, and archive source provenance during cleanup", () => {
    const archived = artifact(HASH_A, {
      archiveProvenance: {
        archiveAttachmentId: "archive",
        archiveContentId: HASH_C,
        archiveContentHash: HASH_C,
        archiveFormat: "zip",
        archiveDisplayName: "project.zip",
        entryIndex: 0,
        entryPath: "notes.txt",
        entryContentHash: HASH_A,
      },
    });
    const ids = collectPeerTaskContentIds([
      task({ artifactRefs: [archived], result: result([artifact(HASH_B)]) }),
    ]);
    expect(ids.sort()).toEqual([HASH_A, HASH_B, HASH_C].sort());
  });

  it("never persists a transient processing attachment as a message reference", () => {
    expect(() =>
      toAttachmentMessagePart({
        ...attachmentRecord(),
        processingState: "processing",
      }),
    ).toThrow("not ready");
  });

  it("preserves bounded PDF extraction and truncation provenance", () => {
    const pdf = artifact(HASH_A, {
      contentKind: "document",
      mediaType: "application/pdf",
      documentRepresentation: {
        pageCount: 42,
        extractedTextBytes: 5,
        truncated: true,
        pages: [{ pageNumber: 1, textBytes: 5, truncated: true }],
        textContentRef: { id: HASH_B, contentHash: HASH_B, byteSize: 5 },
      },
    });
    expect(recover([task({ artifactRefs: [pdf] })])[0].artifactRefs[0]).toEqual(
      pdf,
    );
  });

  it("preserves ZIP manifest state with nested depth zero", () => {
    const zip = archiveArtifact("zip");
    const recovered = recover([task({ artifactRefs: [zip] })])[0];
    expect(recovered.artifactRefs[0].archiveRepresentation).toEqual(
      zip.archiveRepresentation,
    );
  });

  it("preserves 7z manifest state with nested depth zero", () => {
    const sevenZip = archiveArtifact("7z");
    const recovered = recover([task({ artifactRefs: [sevenZip] })])[0];
    expect(recovered.artifactRefs[0].archiveRepresentation).toEqual(
      sevenZip.archiveRepresentation,
    );
  });

  it("keeps a validated isolated worktree reviewable", () => {
    const withWorktree = task({
      status: "failed",
      worktree: { checkoutRoot: "C:/cache/worktree", baseSha: HASH_C },
    });
    const recovered = recover([withWorktree], {
      worktrees: [{ taskId: withWorktree.id, state: "available" }],
    })[0];
    expect(recovered.worktree).toEqual(withWorktree.worktree);
    expect(recovered.recovery?.worktree).toBeUndefined();
  });

  it("marks a missing worktree unavailable without discarding patch metadata", () => {
    const withWorktree = task({
      status: "failed",
      worktree: { checkoutRoot: "C:/cache/worktree", baseSha: HASH_C },
      changeSet: {
        baseSha: HASH_C,
        patch: "saved patch",
        changedPaths: ["src/a.ts"],
      },
    });
    const recovered = recover([withWorktree], {
      worktrees: [
        {
          taskId: withWorktree.id,
          state: "missing",
          message: "The preserved worktree is no longer available.",
        },
      ],
    })[0];
    expect(recovered.recovery?.worktree?.state).toBe("missing");
    expect(recovered.changeSet).toEqual(withWorktree.changeSet);
  });

  it("is idempotent when recovery runs repeatedly", () => {
    const running = task({ status: "running" });
    const once = recover([running]);
    const twice = recover(once);
    expect(twice).toEqual(once);
  });

  it("does not dispatch cancelled or dependency-waiting tasks", () => {
    const prerequisite = task({ id: "first", status: "queued" });
    const waiting = task({
      id: "second",
      status: "waiting",
      dependsOn: [prerequisite.id],
    });
    const cancelled = task({ id: "cancelled", status: "cancelled" });
    const recovered = recover([prerequisite, waiting, cancelled]);
    expect(selectDispatchablePeerTaskIds(recovered, new Map())).toEqual([
      "first",
    ]);
  });

  it("keeps unrelated valid queued work eligible when another task fails", () => {
    const invalid = task({
      id: "invalid",
      artifactRefs: [artifact(HASH_A)],
    });
    const valid = task({ id: "valid", targetSessionId: "other-target" });
    const recovered = recover([invalid, valid], {
      sessions: [
        ...sessions(),
        session("other-target", {
          profile: profile("agent-b", "model-b"),
        }),
      ],
      contentIssues: [issue(HASH_A, "attachment_content_missing")],
    });
    expect(recovered.find((item) => item.id === "invalid")?.status).toBe(
      "failed",
    );
    expect(selectDispatchablePeerTaskIds(recovered, new Map())).toEqual([
      "valid",
    ]);
  });

  it("fails queued work whose target conversation was deleted", () => {
    expect(
      recover([task()], { sessions: [session("source")] })[0],
    ).toMatchObject({
      status: "failed",
      error: { code: "peer_target_missing" },
    });
  });

  it("fails queued work after target workspace identity changes", () => {
    const changed = session("target", {
      profile: {
        ...profile("agent-b", "model-b"),
        workspaceId: "local:c:/other",
        workspaceRoot: "C:/other",
      },
    });
    expect(
      recover([task()], { sessions: [session("source"), changed] })[0],
    ).toMatchObject({
      status: "failed",
      error: { code: "peer_workspace_mismatch" },
    });
  });

  it("fails queued work after its captured target identity changes", () => {
    const changed = session("target", {
      profile: profile("agent-c", "model-c"),
    });
    expect(
      recover([task()], { sessions: [session("source"), changed] })[0],
    ).toMatchObject({
      status: "failed",
      error: { code: "peer_target_configuration_changed" },
    });
  });

  it("fails queued work when its captured model is no longer configured", () => {
    expect(
      recover([task()], { isModelConfigured: () => false })[0],
    ).toMatchObject({
      status: "failed",
      error: { code: "peer_target_model_unavailable" },
    });
  });
});

function recover(
  tasks: readonly PeerTask[],
  overrides: Partial<Parameters<typeof recoverPeerTasks>[1]> = {},
) {
  return recoverPeerTasks(tasks, {
    sessions: sessions(),
    contentIssues: [],
    worktrees: [],
    now: NOW,
    ...overrides,
  });
}

function sessions(): SessionMeta[] {
  return [session("source"), session("target")];
}

function profile(agentId = "agent-a", modelId = "model-a") {
  return {
    agentId,
    modelId,
    workspaceId: "local:c:/workspace",
    workspaceRoot: "C:/workspace",
  };
}

function session(id: string, overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    profileVersion: 1,
    profile:
      id === "target"
        ? profile("agent-b", "model-b")
        : profile("agent-a", "model-a"),
    ...overrides,
  };
}

function task(overrides: Partial<PeerTask> = {}): PeerTask {
  return {
    schemaVersion: PEER_TASK_SCHEMA_VERSION,
    id: "task",
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
    rootTaskId: "root",
    hopCount: 0,
    dependsOn: [],
    status: "queued",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function artifact(
  hash: string,
  overrides: Partial<PeerTaskArtifact> = {},
): PeerTaskArtifact {
  return {
    id: `artifact-${hash[0]}`,
    attachmentId: `attachment-${hash[0]}`,
    contentRef: { id: hash, contentHash: hash, byteSize: 5 },
    displayName: `${hash[0]}.txt`,
    mediaType: "text/plain",
    contentKind: "text",
    byteSize: 5,
    sourceSessionId: "source",
    sourceTaskId: null,
    sourceAgentId: "agent-a",
    sourceModelId: "model-a",
    workspaceId: "local:c:/workspace",
    workspaceRoot: "C:/workspace",
    createdAt: 1,
    originType: "attachment",
    accessPolicy: "model-input",
    ...overrides,
  };
}

function archiveArtifact(format: "zip" | "7z"): PeerTaskArtifact {
  return artifact(HASH_A, {
    contentKind: "archive",
    mediaType:
      format === "zip" ? "application/zip" : "application/x-7z-compressed",
    archiveRepresentation: {
      format,
      entryCount: 1,
      fileCount: 1,
      folderCount: 0,
      totalCompressedBytes: 5,
      totalExpandedBytes: 5,
      nestedArchiveDepthLimit: 0,
      manifestContentRef: { id: HASH_B, contentHash: HASH_B, byteSize: 5 },
    },
  });
}

function result(artifacts: PeerTaskArtifact[]) {
  return {
    summary: "Done",
    targetSessionId: "target",
    targetAgentId: "agent-b",
    targetModelId: "model-b",
    completedAt: 3,
    artifacts,
  };
}

function issue(
  id: string,
  code:
    | "attachment_content_missing"
    | "attachment_content_integrity_failed"
    | "attachment_content_invalid",
) {
  return { id, code, message: `${code}: ${id}` };
}

function attachmentRecord(): AttachmentRecord {
  return {
    id: "attachment",
    source: { kind: "picker", token: "attachment" },
    displayName: "notes.txt",
    detectedMediaType: "text/plain",
    byteSize: 5,
    contentKind: "text",
    processingState: "ready",
    contentRef: { id: HASH_A, contentHash: HASH_A, byteSize: 5 },
    security: {
      secretPathCheck: "passed",
      workspaceScopeCheck: "not-applicable",
      mimeSniffed: true,
    },
    createdAt: 1,
  };
}
