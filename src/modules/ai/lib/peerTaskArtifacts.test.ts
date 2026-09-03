import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import type { AttachmentRecord } from "./attachments";
import { materializeAttachmentMessages } from "./attachmentMessages";
import {
  PeerArtifactPackageError,
  collectPeerTaskAttachmentReferences,
  packagePeerTaskArtifacts,
  packageReturnedPeerTaskArtifacts,
  peerTaskArtifactToMessagePart,
} from "./peerTaskArtifacts";
import {
  PEER_TASK_MAX_INPUT_ARTIFACTS,
  PEER_TASK_MAX_RETURNED_ARTIFACTS,
} from "./peerTasks";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const context = {
  sourceSessionId: "source",
  sourceTaskId: null,
  sourceAgentId: "coder",
  sourceModelId: "model-a",
  workspaceId: "local:c:/workspace",
  workspaceRoot: "C:/workspace",
};

describe("PeerTask artifact packages", () => {
  it("packages text and image attachments without copying their content", async () => {
    const storeContent = vi.fn();
    const artifacts = await packagePeerTaskArtifacts(
      { attachmentRecords: [record("text"), record("image")] },
      context,
      deps({ storeContent }),
    );

    expect(artifacts.map((artifact) => artifact.contentRef.id)).toEqual([
      HASH_A,
      HASH_A,
    ]);
    expect(artifacts.map((artifact) => artifact.contentKind)).toEqual([
      "text",
      "image",
    ]);
    expect(storeContent).not.toHaveBeenCalled();
  });

  it("keeps the path snapshot returned at delegation time", async () => {
    let current = record("text", {
      displayName: "foo.ts",
      contentRef: { id: HASH_A, contentHash: HASH_A, byteSize: 5 },
    });
    const normalizePath = vi.fn(async () => current);
    const packaged = await packagePeerTaskArtifacts(
      { pathRefs: [{ kind: "file", path: "src/foo.ts" }] },
      context,
      deps({ normalizePath }),
    );
    current = record("text", {
      displayName: "foo.ts",
      contentRef: { id: HASH_B, contentHash: HASH_B, byteSize: 5 },
    });

    expect(packaged[0].contentRef.contentHash).toBe(HASH_A);
    expect(packaged[0].sourcePath).toBe("src/foo.ts");
    expect(normalizePath).toHaveBeenCalledOnce();
  });

  it.each([
    "zip",
    "7z",
  ] as const)("preserves %s entry provenance", async (format) => {
    const entry = record("text", {
      displayName: "docs/spec.md",
      source: {
        kind: "archive-entry",
        archiveAttachmentId: "archive-1",
        archiveContentId: HASH_B,
        archiveContentHash: HASH_B,
        archiveFormat: format,
        archiveDisplayName: `project.${format}`,
        entryIndex: 4,
        path: "docs/spec.md",
      },
    });
    const [artifact] = await packagePeerTaskArtifacts(
      { attachmentRecords: [entry] },
      context,
      deps(),
    );

    expect(artifact.originType).toBe("archive-entry");
    expect(artifact.archiveProvenance).toMatchObject({
      archiveFormat: format,
      archiveContentHash: HASH_B,
      entryPath: "docs/spec.md",
      entryContentHash: HASH_A,
    });
  });

  it("preserves bounded PDF page and extracted-text provenance", async () => {
    const [artifact] = await packagePeerTaskArtifacts(
      { attachmentRecords: [record("document")] },
      context,
      deps(),
    );

    expect(artifact.originType).toBe("pdf-derived");
    expect(artifact.pdfProvenance).toEqual({
      originalAttachmentId: "record-document",
      originalContentId: HASH_A,
      originalContentHash: HASH_A,
      pageNumbers: [1, 2],
      extractedTextRef: { id: HASH_B, contentHash: HASH_B, byteSize: 8 },
      truncated: true,
    });
  });

  it("rejects a path that fails the normal secret-path guard", async () => {
    const failed = record("text", {
      processingState: "failed",
      contentRef: undefined,
      error: { code: "secret_path_rejected", message: "Secret path blocked." },
    });
    await expect(
      packagePeerTaskArtifacts(
        { pathRefs: [{ kind: "file", path: ".env" }] },
        context,
        deps({ normalizePath: async () => failed }),
      ),
    ).rejects.toMatchObject({
      code: "secret_path_rejected",
      message: "Secret path blocked.",
    });
  });

  it("still enforces vision capabilities through the normal resolver", async () => {
    const [artifact] = await packagePeerTaskArtifacts(
      { attachmentRecords: [record("image")] },
      context,
      deps(),
    );
    await expect(
      materializeAttachmentMessages(
        [message(peerTaskArtifactToMessagePart(artifact))],
        {
          text: "supported",
          image: "unsupported",
          document: "unsupported",
          tools: "supported",
          audio: "unsupported",
          evidence: "registry",
        },
        { loadContent: vi.fn(), toDataUrl: vi.fn() },
      ),
    ).rejects.toMatchObject({ code: "attachment_capability_blocked" });
  });

  it("stores returned artifacts by content hash and preserves worktree provenance", async () => {
    const storeContent = vi.fn(async (bytes: Uint8Array) => ({
      id: HASH_B,
      contentHash: HASH_B,
      byteSize: bytes.byteLength,
    }));
    const artifacts = await packageReturnedPeerTaskArtifacts(
      [
        {
          displayName: "changes.patch",
          mediaType: "text/x-diff",
          contentKind: "text",
          bytes: new TextEncoder().encode("diff"),
          originType: "diff",
          worktreeProvenance: {
            taskId: "task-1",
            baseSha: "base",
            changedPaths: ["src/a.ts"],
          },
        },
        {
          displayName: "report.md",
          mediaType: "text/markdown",
          contentKind: "text",
          bytes: new TextEncoder().encode("# Report"),
          originType: "generated-file",
          sourcePath: "reports/review.md",
        },
      ],
      { ...context, sourceTaskId: "task-1" },
      deps({ storeContent }),
    );

    expect(storeContent).toHaveBeenCalledTimes(2);
    expect(artifacts[0]).toMatchObject({
      contentRef: { id: HASH_B },
      originType: "diff",
      worktreeProvenance: { changedPaths: ["src/a.ts"] },
    });
    expect(artifacts[1]).toMatchObject({
      displayName: "report.md",
      originType: "generated-file",
      sourcePath: "reports/review.md",
    });
  });

  it("enforces input and returned count limits", async () => {
    await expect(
      packagePeerTaskArtifacts(
        {
          attachmentRecords: Array.from(
            { length: PEER_TASK_MAX_INPUT_ARTIFACTS + 1 },
            () => record("text"),
          ),
        },
        context,
        deps(),
      ),
    ).rejects.toBeInstanceOf(PeerArtifactPackageError);

    await expect(
      packageReturnedPeerTaskArtifacts(
        Array.from({ length: PEER_TASK_MAX_RETURNED_ARTIFACTS + 1 }, () => ({
          displayName: "file.txt",
          mediaType: "text/plain",
          contentKind: "text" as const,
          bytes: new Uint8Array([1]),
          originType: "generated-file" as const,
        })),
        context,
        deps(),
      ),
    ).rejects.toMatchObject({ code: "peer_returned_artifact_count_limit" });
  });

  it("enforces aggregate byte limits independently of item count", async () => {
    const large = Array.from({ length: 8 }, (_, index) => {
      const hash = (index + 1).toString(16).repeat(64);
      return record("text", {
        id: `large-${index}`,
        byteSize: 3 * 1024 * 1024,
        contentRef: {
          id: hash,
          contentHash: hash,
          byteSize: 3 * 1024 * 1024,
        },
      });
    });
    await expect(
      packagePeerTaskArtifacts({ attachmentRecords: large }, context, deps()),
    ).rejects.toMatchObject({ code: "peer_artifact_aggregate_limit" });

    await expect(
      packageReturnedPeerTaskArtifacts(
        Array.from({ length: 3 }, (_, index) => ({
          displayName: `large-${index}.bin`,
          mediaType: "application/octet-stream",
          contentKind: "binary" as const,
          bytes: new Uint8Array(7 * 1024 * 1024),
          originType: "generated-file" as const,
        })),
        context,
        deps(),
      ),
    ).rejects.toMatchObject({
      code: "peer_returned_artifact_aggregate_limit",
    });
  });

  it("collects persisted chat attachment references once per content hash", () => {
    const part = peerTaskArtifactToMessagePart(
      artifactFixture({ displayName: "spec.md" }),
    );
    expect(
      collectPeerTaskAttachmentReferences([message(part), message(part)]),
    ).toHaveLength(1);
  });
});

function deps(overrides: Record<string, unknown> = {}) {
  let index = 0;
  return {
    normalizePath: async () => record("text"),
    storeContent: async (bytes: Uint8Array) => ({
      id: HASH_B,
      contentHash: HASH_B,
      byteSize: bytes.byteLength,
    }),
    now: () => 10,
    newId: () => `artifact-${++index}`,
    ...overrides,
  };
}

function record(
  kind: "text" | "image" | "document",
  overrides: Partial<AttachmentRecord> = {},
): AttachmentRecord {
  const documentRepresentation =
    kind === "document"
      ? {
          pageCount: 3,
          extractedTextBytes: 8,
          truncated: true,
          pages: [
            { pageNumber: 1, textBytes: 4, truncated: false },
            { pageNumber: 2, textBytes: 4, truncated: true },
          ],
          textContentRef: {
            id: HASH_B,
            contentHash: HASH_B,
            byteSize: 8,
          },
        }
      : undefined;
  return {
    id: `record-${kind}`,
    source: { kind: "picker", token: kind },
    displayName:
      kind === "image"
        ? "screen.png"
        : kind === "document"
          ? "report.pdf"
          : "notes.txt",
    detectedMediaType:
      kind === "image"
        ? "image/png"
        : kind === "document"
          ? "application/pdf"
          : "text/plain",
    byteSize: 5,
    contentKind: kind,
    processingState: "ready",
    contentRef: { id: HASH_A, contentHash: HASH_A, byteSize: 5 },
    documentRepresentation,
    security: {
      secretPathCheck: "passed",
      workspaceScopeCheck: "not-applicable",
      mimeSniffed: true,
    },
    createdAt: 1,
    ...overrides,
  };
}

function artifactFixture(
  overrides: Partial<ReturnType<typeof baseArtifact>> = {},
) {
  return { ...baseArtifact(), ...overrides };
}

function baseArtifact() {
  return {
    id: "artifact-1",
    attachmentId: "attachment-1",
    contentRef: { id: HASH_A, contentHash: HASH_A, byteSize: 5 },
    displayName: "notes.txt",
    mediaType: "text/plain",
    contentKind: "text" as const,
    byteSize: 5,
    ...context,
    createdAt: 1,
    originType: "attachment" as const,
    accessPolicy: "model-input" as const,
  };
}

function message(...parts: unknown[]): UIMessage {
  return { id: "message", role: "user", parts } as UIMessage;
}
