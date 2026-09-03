import { describe, expect, it } from "vitest";
import {
  PEER_TASK_MAX_STORED,
  PEER_TASK_SCHEMA_VERSION,
  collectPeerTaskContentIds,
  compactPeerTasks,
  normalizePeerTask,
  peerTaskFingerprint,
  type PeerTask,
  type PeerTaskArtifact,
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

  it("includes sorted artifact hashes in loop fingerprints", () => {
    const base = {
      sourceSessionId: "source",
      targetSessionId: "target",
      kind: "review" as const,
      prompt: "Review it",
    };
    expect(
      peerTaskFingerprint({ ...base, artifactRefs: [artifact("a")] }),
    ).not.toBe(
      peerTaskFingerprint({ ...base, artifactRefs: [artifact("b")] }),
    );
    expect(
      peerTaskFingerprint({
        ...base,
        artifactRefs: [artifact("a"), artifact("b")],
      }),
    ).toBe(
      peerTaskFingerprint({
        ...base,
        artifactRefs: [artifact("b"), artifact("a")],
      }),
    );
  });

  it("retains input, returned, PDF, and archive content references", () => {
    const input = artifact("a", {
      documentRepresentation: {
        pageCount: 1,
        extractedTextBytes: 2,
        truncated: false,
        pages: [{ pageNumber: 1, textBytes: 2, truncated: false }],
        textContentRef: contentRef("c", 2),
      },
    });
    const returned = artifact("b", {
      archiveRepresentation: {
        format: "7z",
        entryCount: 1,
        fileCount: 1,
        folderCount: 0,
        totalCompressedBytes: 1,
        totalExpandedBytes: 1,
        nestedArchiveDepthLimit: 0,
        manifestContentRef: contentRef("d", 2),
      },
    });
    const stored = task("task", 1, {
      artifactRefs: [input],
      result: {
        summary: "Done",
        targetSessionId: "target",
        targetAgentId: "agent-b",
        targetModelId: "model-b",
        completedAt: 2,
        artifacts: [returned],
      },
    });

    expect(collectPeerTaskContentIds([stored]).sort()).toEqual(
      ["a", "b", "c", "d"].map((letter) => letter.repeat(64)).sort(),
    );
  });

  it("round-trips artifact provenance and fails old queued path refs closed", () => {
    const original = task("task", 1, { artifactRefs: [artifact("a")] });
    expect(normalizePeerTask(JSON.parse(JSON.stringify(original)))).toEqual(
      original,
    );

    const legacy = normalizePeerTask({
      ...original,
      schemaVersion: 1,
      artifactRefs: [{ kind: "file", path: "src/old.ts" }],
      status: "queued",
    });
    expect(legacy).toMatchObject({
      schemaVersion: PEER_TASK_SCHEMA_VERSION,
      status: "failed",
      artifactRefs: [],
      legacyArtifactRefs: [{ kind: "file", path: "src/old.ts" }],
      error: { code: "peer_artifact_upgrade_required" },
    });
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

function contentRef(letter: string, byteSize = 5) {
  const id = letter.repeat(64);
  return { id, contentHash: id, byteSize };
}

function artifact(
  letter: string,
  overrides: Partial<PeerTaskArtifact> = {},
): PeerTaskArtifact {
  return {
    id: `artifact-${letter}`,
    attachmentId: `attachment-${letter}`,
    contentRef: contentRef(letter),
    displayName: `${letter}.txt`,
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
