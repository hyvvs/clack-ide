import type { UIMessage } from "@ai-sdk/react";
import {
  ATTACHMENT_LIMITS,
  isDeliverableAttachment,
  normalizeAttachmentBytes,
  normalizeWorkspaceAttachment,
  persistAttachmentRecord,
  releaseAttachmentRecordContent,
  type AttachmentRecord,
} from "./attachments";
import {
  CLACK_ATTACHMENT_PART_TYPE,
  isAttachmentMessagePart,
  toAttachmentMessagePart,
  type AttachmentMessagePart,
  type AttachmentMessageReference,
} from "./attachmentMessages";
import {
  releaseAttachmentContent,
  retainAttachmentContent,
  storeAttachmentContent,
  type AttachmentContentRef,
} from "./attachmentStore";
import {
  PEER_TASK_MAX_INPUT_ARTIFACT_BYTES,
  PEER_TASK_MAX_INPUT_ARTIFACTS,
  PEER_TASK_MAX_RETURNED_ARTIFACT_BYTES,
  PEER_TASK_MAX_RETURNED_ARTIFACTS,
  type PeerArtifactRef,
  type PeerTaskArtifact,
  type PeerTaskArtifactOrigin,
} from "./peerTasks";

export type PeerArtifactPackageContext = {
  sourceSessionId: string;
  sourceTaskId: string | null;
  sourceAgentId: string;
  sourceModelId: string;
  workspaceId: string;
  workspaceRoot: string;
};

export type PeerArtifactPackageInput = {
  pathRefs?: readonly PeerArtifactRef[];
  attachmentRecords?: readonly AttachmentRecord[];
  attachmentReferences?: readonly AttachmentMessageReference[];
};

export type ReturnedPeerArtifactInput = {
  displayName: string;
  mediaType: string;
  contentKind: PeerTaskArtifact["contentKind"];
  bytes: Uint8Array;
  originType: Extract<
    PeerTaskArtifactOrigin,
    "generated-file" | "worktree-file" | "diff"
  >;
  sourcePath?: string;
  worktreeProvenance?: PeerTaskArtifact["worktreeProvenance"];
};

type PackageDeps = {
  normalizePath: (
    path: string,
    workspaceRoot: string,
  ) => Promise<AttachmentRecord>;
  storeContent: (bytes: Uint8Array) => Promise<AttachmentContentRef>;
  now: () => number;
  newId: () => string;
};

const DEFAULT_DEPS: PackageDeps = {
  normalizePath: (path, workspaceRoot) =>
    normalizeWorkspaceAttachment(path, workspaceRoot),
  storeContent: storeAttachmentContent,
  now: Date.now,
  newId: newPeerArtifactId,
};

export class PeerArtifactPackageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PeerArtifactPackageError";
  }
}

export async function packagePeerTaskArtifacts(
  input: PeerArtifactPackageInput,
  context: PeerArtifactPackageContext,
  deps: PackageDeps = DEFAULT_DEPS,
): Promise<PeerTaskArtifact[]> {
  const count =
    (input.pathRefs?.length ?? 0) +
    (input.attachmentRecords?.length ?? 0) +
    (input.attachmentReferences?.length ?? 0);
  assertCount(count, PEER_TASK_MAX_INPUT_ARTIFACTS, "input");

  const artifacts: PeerTaskArtifact[] = [];
  for (const record of input.attachmentRecords ?? []) {
    artifacts.push(artifactFromRecord(record, context, deps));
  }
  for (const reference of input.attachmentReferences ?? []) {
    artifacts.push(
      artifactFromReference(reference, context, deps, "attachment"),
    );
  }
  for (const ref of normalizePathRefs(input.pathRefs)) {
    const record = await deps.normalizePath(ref.path, context.workspaceRoot);
    try {
      if (!isDeliverableAttachment(record)) {
        throw new PeerArtifactPackageError(
          record.error?.code ?? "peer_artifact_not_deliverable",
          record.error?.message ??
            `${record.displayName} could not be packaged for delegation.`,
        );
      }
      artifacts.push(
        artifactFromRecord(
          record,
          context,
          deps,
          ref.kind === "diff" ? "diff" : "workspace-file",
          ref.path,
        ),
      );
    } finally {
      releaseAttachmentRecordContent(record);
    }
  }
  assertAggregate(artifacts, PEER_TASK_MAX_INPUT_ARTIFACT_BYTES, "input");
  return artifacts;
}

export async function packageReturnedPeerTaskArtifacts(
  inputs: readonly ReturnedPeerArtifactInput[],
  context: PeerArtifactPackageContext,
  deps: PackageDeps = DEFAULT_DEPS,
): Promise<PeerTaskArtifact[]> {
  assertCount(inputs.length, PEER_TASK_MAX_RETURNED_ARTIFACTS, "returned");
  const total = inputs.reduce((sum, input) => sum + input.bytes.byteLength, 0);
  if (total > PEER_TASK_MAX_RETURNED_ARTIFACT_BYTES) {
    throw new PeerArtifactPackageError(
      "peer_returned_artifact_aggregate_limit",
      `Returned files exceed the ${formatBytes(PEER_TASK_MAX_RETURNED_ARTIFACT_BYTES)} task limit.`,
    );
  }
  const artifacts: PeerTaskArtifact[] = [];
  for (const input of inputs) {
    if (
      input.bytes.byteLength === 0 ||
      input.bytes.byteLength > ATTACHMENT_LIMITS.maxIndividualBytes
    ) {
      throw new PeerArtifactPackageError(
        "peer_returned_artifact_size_limit",
        `${input.displayName} must be between 1 byte and ${formatBytes(ATTACHMENT_LIMITS.maxIndividualBytes)}.`,
      );
    }
    const normalized = await normalizeAttachmentBytes({
      source: {
        kind: "picker",
        token: `peer-result:${input.displayName}:${input.bytes.byteLength}`,
      },
      displayName: input.displayName,
      bytes: input.bytes,
      reportedMediaType: input.mediaType,
      security: {
        secretPathCheck: "not-applicable",
        workspaceScopeCheck: "not-applicable",
        mimeSniffed: true,
      },
    });
    const persisted = await persistAttachmentRecord(
      normalized,
      input.bytes,
      deps.storeContent,
    );
    try {
      if (!isDeliverableAttachment(persisted)) {
        throw new PeerArtifactPackageError(
          persisted.error?.code ?? "peer_returned_artifact_not_deliverable",
          persisted.error?.message ??
            `${input.displayName} could not be packaged as a returned file.`,
        );
      }
      if (persisted.contentKind !== input.contentKind) {
        throw new PeerArtifactPackageError(
          "peer_returned_artifact_type_mismatch",
          `${input.displayName} did not match its declared content type.`,
        );
      }
      artifacts.push({
        ...artifactFromRecord(
          persisted,
          context,
          deps,
          input.originType,
          input.sourcePath,
        ),
        worktreeProvenance: input.worktreeProvenance,
      });
    } finally {
      releaseAttachmentRecordContent(persisted);
    }
  }
  return artifacts;
}

export function peerTaskArtifactToMessagePart(
  artifact: PeerTaskArtifact,
): AttachmentMessagePart {
  return {
    type: CLACK_ATTACHMENT_PART_TYPE,
    data: {
      attachmentId: artifact.attachmentId,
      contentId: artifact.contentRef.id,
      contentHash: artifact.contentRef.contentHash,
      displayName: artifact.displayName,
      mediaType: artifact.mediaType,
      byteSize: artifact.byteSize,
      contentKind: artifact.contentKind,
      selectionSource: artifact.selectionSource,
      documentRepresentation: artifact.documentRepresentation,
      archiveRepresentation: artifact.archiveRepresentation,
      ...(artifact.archiveProvenance
        ? {
            archiveEntryProvenance: {
              archiveAttachmentId:
                artifact.archiveProvenance.archiveAttachmentId,
              archiveContentId: artifact.archiveProvenance.archiveContentId,
              archiveContentHash: artifact.archiveProvenance.archiveContentHash,
              archiveFormat: artifact.archiveProvenance.archiveFormat,
              archiveDisplayName: artifact.archiveProvenance.archiveDisplayName,
              entryIndex: artifact.archiveProvenance.entryIndex,
              entryPath: artifact.archiveProvenance.entryPath,
            },
          }
        : {}),
    },
  };
}

export function retainPeerTaskArtifactContent(
  artifacts: readonly PeerTaskArtifact[],
): void {
  for (const artifact of artifacts) {
    retainAttachmentContent(artifact.contentRef.id);
    const extracted = artifact.documentRepresentation?.textContentRef;
    if (extracted && extracted.id !== artifact.contentRef.id) {
      retainAttachmentContent(extracted.id);
    }
    const manifest = artifact.archiveRepresentation?.manifestContentRef;
    if (manifest && manifest.id !== artifact.contentRef.id) {
      retainAttachmentContent(manifest.id);
    }
  }
}

export function releasePeerTaskArtifactContent(
  artifacts: readonly PeerTaskArtifact[],
): void {
  for (const artifact of artifacts) {
    releaseAttachmentContent(artifact.contentRef.id);
    const extracted = artifact.documentRepresentation?.textContentRef;
    if (extracted && extracted.id !== artifact.contentRef.id) {
      releaseAttachmentContent(extracted.id);
    }
    const manifest = artifact.archiveRepresentation?.manifestContentRef;
    if (manifest && manifest.id !== artifact.contentRef.id) {
      releaseAttachmentContent(manifest.id);
    }
  }
}

export function collectPeerTaskAttachmentReferences(
  messages: readonly UIMessage[],
): AttachmentMessageReference[] {
  const byContent = new Map<string, AttachmentMessageReference>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isAttachmentMessagePart(part)) continue;
      byContent.set(part.data.contentId, part.data);
    }
  }
  return [...byContent.values()];
}

function artifactFromRecord(
  record: AttachmentRecord,
  context: PeerArtifactPackageContext,
  deps: PackageDeps,
  originOverride?: PeerTaskArtifactOrigin,
  sourcePathOverride?: string,
): PeerTaskArtifact {
  if (!isDeliverableAttachment(record)) {
    throw new PeerArtifactPackageError(
      record.error?.code ?? "peer_artifact_not_deliverable",
      record.error?.message ??
        `${record.displayName} is not ready for delegation.`,
    );
  }
  const reference = toAttachmentMessagePart(record).data;
  const sourcePath =
    sourcePathOverride ??
    (record.source.kind === "workspace-path" ? record.source.path : undefined);
  return artifactFromReference(
    reference,
    context,
    deps,
    originOverride ?? originFromRecord(record),
    sourcePath,
  );
}

function artifactFromReference(
  reference: AttachmentMessageReference,
  context: PeerArtifactPackageContext,
  deps: PackageDeps,
  originType: PeerTaskArtifactOrigin,
  sourcePath?: string,
): PeerTaskArtifact {
  if (
    !isAttachmentMessagePart({
      type: CLACK_ATTACHMENT_PART_TYPE,
      data: reference,
    })
  ) {
    throw new PeerArtifactPackageError(
      "peer_artifact_reference_invalid",
      "An attachment reference is invalid and cannot be delegated.",
    );
  }
  const archive = reference.archiveEntryProvenance;
  const document = reference.documentRepresentation;
  return {
    id: deps.newId(),
    attachmentId: reference.attachmentId,
    contentRef: {
      id: reference.contentId,
      contentHash: reference.contentHash,
      byteSize: reference.byteSize,
    },
    displayName: reference.displayName,
    mediaType: reference.mediaType,
    contentKind: reference.contentKind,
    byteSize: reference.byteSize,
    ...context,
    createdAt: deps.now(),
    originType: archive
      ? "archive-entry"
      : document
        ? "pdf-derived"
        : originType,
    accessPolicy: "model-input",
    sourcePath,
    selectionSource: reference.selectionSource,
    documentRepresentation: document,
    archiveRepresentation: reference.archiveRepresentation,
    ...(archive
      ? {
          archiveProvenance: {
            ...archive,
            entryContentHash: reference.contentHash,
          },
        }
      : {}),
    ...(document
      ? {
          pdfProvenance: {
            originalAttachmentId: reference.attachmentId,
            originalContentId: reference.contentId,
            originalContentHash: reference.contentHash,
            pageNumbers: document.pages.map((page) => page.pageNumber),
            extractedTextRef: document.textContentRef,
            truncated: document.truncated,
          },
        }
      : {}),
  };
}

function originFromRecord(record: AttachmentRecord): PeerTaskArtifactOrigin {
  if (record.source.kind === "archive-entry") return "archive-entry";
  if (record.contentKind === "document") return "pdf-derived";
  if (record.source.kind === "workspace-path") return "workspace-file";
  return "attachment";
}

function normalizePathRefs(
  refs: readonly PeerArtifactRef[] | undefined,
): PeerArtifactRef[] {
  const seen = new Set<string>();
  const normalized: PeerArtifactRef[] = [];
  for (const ref of refs ?? []) {
    const path = ref.path.trim();
    const key = `${ref.kind}:${path}`;
    if (!path || seen.has(key)) continue;
    seen.add(key);
    normalized.push({ kind: ref.kind, path });
  }
  return normalized;
}

function assertCount(
  count: number,
  max: number,
  direction: "input" | "returned",
) {
  if (count <= max) return;
  throw new PeerArtifactPackageError(
    direction === "input"
      ? "peer_artifact_count_limit"
      : "peer_returned_artifact_count_limit",
    `A peer task can include up to ${max} ${direction} files.`,
  );
}

function assertAggregate(
  artifacts: readonly PeerTaskArtifact[],
  max: number,
  direction: "input" | "returned",
) {
  const total = artifacts.reduce((sum, artifact) => sum + artifact.byteSize, 0);
  if (total <= max) return;
  throw new PeerArtifactPackageError(
    direction === "input"
      ? "peer_artifact_aggregate_limit"
      : "peer_returned_artifact_aggregate_limit",
    `Peer task ${direction} files exceed the ${formatBytes(max)} limit.`,
  );
}

function newPeerArtifactId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `peer-artifact-${crypto.randomUUID()}`;
  }
  return `peer-artifact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}
