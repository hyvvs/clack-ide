import { invoke } from "@tauri-apps/api/core";
import {
  communicationDigest,
  communicationPayload,
  parsePeerCommunication,
  reconcilePeerCommunication,
  type PeerCommunicationEvent,
} from "@/modules/ai/lib/peerCommunication";
import type { WorkspaceEnv } from "@/modules/workspace/env";
import type {
  ArchiveRepresentation,
  AttachmentContentKind,
  DocumentRepresentation,
} from "./attachments";
import type { AttachmentContentRef } from "./attachmentStore";
import {
  CLACK_ATTACHMENT_PART_TYPE,
  isAttachmentMessagePart,
} from "./attachmentMessages";
import { workspaceEnvironmentFromId } from "./sessions";

export const PEER_TASK_SCHEMA_VERSION = 6;
export const PEER_TASK_MAX_HOPS = 3;
export const PEER_TASK_MAX_PER_ROOT = 8;
export const PEER_TASK_MAX_ACTIVE = 32;
export const PEER_TASK_MAX_RUNNING = 8;
export const PEER_TASK_MAX_DEPENDENCIES = 8;
export const PEER_TASK_MAX_DEPENDENCY_DEPTH = 8;
export const PEER_TASK_MAX_STORED = 256;
export const PEER_TASK_MAX_INPUT_ARTIFACTS = 8;
export const PEER_TASK_MAX_INPUT_ARTIFACT_BYTES = 20 * 1024 * 1024;
export const PEER_TASK_MAX_RETURNED_ARTIFACTS = 8;
export const PEER_TASK_MAX_RETURNED_ARTIFACT_BYTES = 20 * 1024 * 1024;

export type PeerTaskKind = "delegate" | "review" | "question";
export type PeerTaskExecutionMode =
  | "read-only"
  | "shared-write"
  | "isolated-worktree";
export type PeerTaskStatus =
  | "waiting"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export type PeerTaskDependencyBlockStatus =
  | "failed"
  | "cancelled"
  | "blocked"
  | "missing";

export type PeerTaskCancellation = {
  actor: "user" | "programmatic";
  cause: "direct" | "parent" | "orchestration";
  requestedTaskId: string;
  cancelledByTaskId?: string;
  reason: string;
  cancelledAt: number;
  cancelledDescendantCount?: number;
};

export type PeerArtifactRef = {
  kind: "file" | "diff";
  path: string;
};

export type PeerTaskArtifactOrigin =
  | "attachment"
  | "workspace-file"
  | "archive-entry"
  | "pdf-derived"
  | "generated-file"
  | "worktree-file"
  | "diff";

export type PeerTaskArtifact = {
  id: string;
  attachmentId: string;
  contentRef: AttachmentContentRef;
  displayName: string;
  mediaType: string;
  contentKind: AttachmentContentKind;
  byteSize: number;
  sourceSessionId: string;
  sourceTaskId: string | null;
  sourceAgentId: string;
  sourceModelId: string;
  workspaceId: string;
  workspaceRoot: string;
  createdAt: number;
  originType: PeerTaskArtifactOrigin;
  accessPolicy: "model-input";
  sourcePath?: string;
  selectionSource?: "terminal" | "editor";
  documentRepresentation?: DocumentRepresentation;
  archiveRepresentation?: Omit<ArchiveRepresentation, "entries">;
  archiveProvenance?: {
    archiveAttachmentId: string;
    archiveContentId: string;
    archiveContentHash: string;
    archiveFormat: "zip" | "7z";
    archiveDisplayName: string;
    entryIndex: number;
    entryPath: string;
    entryContentHash: string;
  };
  pdfProvenance?: {
    originalAttachmentId: string;
    originalContentId: string;
    originalContentHash: string;
    pageNumbers: number[];
    extractedTextRef?: AttachmentContentRef;
    truncated: boolean;
  };
  worktreeProvenance?: {
    taskId: string;
    baseSha: string;
    changedPaths: string[];
  };
};

export type PeerTaskResult = {
  summary: string;
  targetSessionId: string;
  targetAgentId: string;
  targetModelId: string;
  completedAt: number;
  artifacts: PeerTaskArtifact[];
};

export type PeerTaskChangeSet = {
  baseSha: string;
  patch: string;
  changedPaths: string[];
  appliedAt?: number;
  applyError?: string;
};

export type PeerTaskError = {
  code: string;
  message: string;
};

export type PeerTaskRecoveryContentIssue = {
  artifactId: string;
  contentId: string;
  role: "input" | "returned";
  representation:
    | "content"
    | "pdf-text"
    | "archive-manifest"
    | "archive-source";
  code:
    | "attachment_content_missing"
    | "attachment_content_integrity_failed"
    | "attachment_content_invalid";
  message: string;
};

export type PeerTaskRecovery = {
  interruption?: {
    cause: "app-restart";
    detectedAt: number;
  };
  contentIssues?: PeerTaskRecoveryContentIssue[];
  worktree?: {
    state: "missing" | "invalid";
    message: string;
  };
};

export type PeerTask = {
  schemaVersion: typeof PEER_TASK_SCHEMA_VERSION;
  id: string;
  sourceSessionId: string;
  targetSessionId: string;
  sourceAgentId: string;
  sourceModelId: string;
  targetAgentId: string;
  targetModelId: string;
  workspaceId: string;
  workspaceRoot: string;
  workspaceEnvironment: WorkspaceEnv;
  kind: PeerTaskKind;
  executionMode: PeerTaskExecutionMode;
  prompt: string;
  artifactRefs: PeerTaskArtifact[];
  legacyArtifactRefs?: PeerArtifactRef[];
  parentTaskId: string | null;
  rootTaskId: string;
  hopCount: number;
  dependsOn: string[];
  status: PeerTaskStatus;
  createdAt: number;
  updatedAt: number;
  dependenciesSatisfiedAt?: number;
  blockedByTaskId?: string;
  blockedByStatus?: PeerTaskDependencyBlockStatus;
  cancellation?: PeerTaskCancellation;
  startedAt?: number;
  endedAt?: number;
  result?: PeerTaskResult;
  error?: PeerTaskError;
  recovery?: PeerTaskRecovery;
  worktree?: { checkoutRoot: string; baseSha: string };
  changeSet?: PeerTaskChangeSet;
  communication?: PeerCommunicationEvent[];
};

let ledgerRevision = 0;
let ledgerWrites: Promise<void> = Promise.resolve();

export function newPeerTaskId(): string {
  return `pt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function loadPeerTasks(): Promise<PeerTask[]> {
  const ledger = await invoke<{ revision: number; tasks: unknown[] }>(
    "peer_ledger_read",
  );
  ledgerRevision = ledger.revision;
  ledgerWrites = Promise.resolve();
  const tasks = ledger.tasks.flatMap((value) => {
    const task = normalizePeerTask(value);
    if (!task && value && typeof value === "object" && "communication" in value)
      throw new Error("peer_communication_schema_unsupported");
    return task ? [task] : [];
  });
  for (const task of tasks) {
    for (const event of task.communication ?? []) {
      if (
        event.taskId !== task.id ||
        event.workspaceId !== task.workspaceId ||
        event.rootTaskId !== task.rootTaskId ||
        event.digest !==
          (await communicationDigest(communicationPayload(event)))
      ) {
        throw new Error("peer_communication_integrity_failed");
      }
    }
  }
  return tasks;
}

export function peerLedgerRevision(): number {
  return ledgerRevision;
}

export async function savePeerTasks(tasks: readonly PeerTask[]): Promise<void> {
  const snapshot = compactPeerTasks(tasks);
  ledgerWrites = ledgerWrites.then(async () => {
    ledgerRevision = await invoke<number>("peer_ledger_commit", {
      expected: ledgerRevision,
      tasks: snapshot,
    });
  });
  return ledgerWrites;
}

export function compactPeerTasks(tasks: readonly PeerTask[]): PeerTask[] {
  if (tasks.length <= PEER_TASK_MAX_STORED) return [...tasks];

  const protectedRoots = new Set(
    tasks
      .filter(
        (task) =>
          task.status === "waiting" ||
          task.status === "queued" ||
          task.status === "running" ||
          Boolean(task.worktree) ||
          Boolean(task.changeSet?.patch && !task.changeSet.appliedAt),
      )
      .map((task) => task.rootTaskId),
  );
  const protectedIds = new Set(
    tasks
      .filter((task) => protectedRoots.has(task.rootTaskId))
      .map((task) => task.id),
  );
  const retained = tasks
    .filter((task) => protectedIds.has(task.id))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const remaining = tasks
    .filter((task) => !protectedIds.has(task.id))
    .sort((left, right) => right.updatedAt - left.updatedAt);

  return [...retained, ...remaining].slice(0, PEER_TASK_MAX_STORED);
}

export function recoverInterruptedPeerTasks(
  tasks: readonly PeerTask[],
  now = Date.now(),
): PeerTask[] {
  return reconcilePeerCommunication(
    tasks.map((task) =>
      task.status === "running"
        ? {
            ...task,
            status: "failed",
            updatedAt: now,
            endedAt: now,
            error: {
              code: "peer_task_interrupted",
              message: task.worktree
                ? `Interrupted when Clack closed. Changes remain in the preserved worktree at ${task.worktree.checkoutRoot}.`
                : "Interrupted when Clack closed.",
            },
            recovery: {
              ...task.recovery,
              interruption: {
                cause: "app-restart",
                detectedAt: now,
              },
            },
          }
        : task,
    ),
    now,
    true,
  );
}

export function peerTaskFingerprint(input: {
  sourceSessionId: string;
  targetSessionId: string;
  kind: PeerTaskKind;
  executionMode?: PeerTaskExecutionMode;
  prompt: string;
  artifactRefs?: readonly Pick<PeerTaskArtifact, "contentRef">[];
  dependsOn?: readonly string[];
}): string {
  const artifactHashes = (input.artifactRefs ?? [])
    .map((artifact) => artifact.contentRef.contentHash)
    .sort()
    .join(",");
  return [
    input.sourceSessionId,
    input.targetSessionId,
    input.kind,
    input.executionMode ?? "read-only",
    input.prompt.trim().replace(/\s+/g, " ").toLowerCase(),
    artifactHashes,
    [...(input.dependsOn ?? [])].sort().join(","),
  ].join("|");
}

type StoredPeerTask = Omit<
  Partial<PeerTask>,
  "schemaVersion" | "artifactRefs" | "result"
> & {
  schemaVersion?: number;
  artifactRefs?: unknown;
  result?: Omit<Partial<PeerTaskResult>, "artifacts"> & {
    artifacts?: unknown;
  };
};

export function normalizePeerTask(value: unknown): PeerTask | null {
  if (!value || typeof value !== "object") return null;
  const task = value as StoredPeerTask;
  if (
    (task.schemaVersion !== 1 &&
      task.schemaVersion !== 2 &&
      task.schemaVersion !== 3 &&
      task.schemaVersion !== 4 &&
      task.schemaVersion !== 5 &&
      task.schemaVersion !== PEER_TASK_SCHEMA_VERSION) ||
    !nonEmpty(task.id) ||
    !nonEmpty(task.sourceSessionId) ||
    !nonEmpty(task.targetSessionId) ||
    !nonEmpty(task.workspaceId) ||
    !nonEmpty(task.workspaceRoot) ||
    !nonEmpty(task.prompt) ||
    !isKind(task.kind) ||
    !isStatus(task.status)
  ) {
    return null;
  }
  if (task.schemaVersion === 1) return migrateVersionOneTask(task);
  const artifactRefs = normalizeArtifacts(task.artifactRefs);
  const result = normalizeResult(
    task.result,
    normalizeArtifacts(task.result?.artifacts),
  );
  return {
    ...(task as PeerTask),
    schemaVersion: PEER_TASK_SCHEMA_VERSION,
    artifactRefs,
    result,
    workspaceEnvironment: task.workspaceEnvironment ??
      workspaceEnvironmentFromId(task.workspaceId) ?? { kind: "local" },
    executionMode: isExecutionMode(task.executionMode)
      ? task.executionMode
      : "read-only",
    dependsOn: normalizeDependencyIds(task.dependsOn),
    cancellation: normalizeCancellation(task.cancellation),
    recovery: normalizeRecovery(task.recovery),
    communication:
      task.communication === undefined
        ? undefined
        : parsePeerCommunication(task.communication),
  };
}

export type PeerTaskContentReference = {
  taskId: string;
  artifactId: string;
  contentId: string;
  role: "input" | "returned";
  representation: PeerTaskRecoveryContentIssue["representation"];
};

export function collectPeerTaskContentReferences(
  tasks: readonly PeerTask[],
): PeerTaskContentReference[] {
  const references = new Map<string, PeerTaskContentReference>();
  const addArtifact = (
    task: PeerTask,
    artifact: PeerTaskArtifact,
    role: PeerTaskContentReference["role"],
  ) => {
    const add = (
      contentId: string | undefined,
      representation: PeerTaskContentReference["representation"],
    ) => {
      if (!contentId) return;
      const key = `${task.id}:${artifact.id}:${role}:${representation}:${contentId}`;
      references.set(key, {
        taskId: task.id,
        artifactId: artifact.id,
        contentId,
        role,
        representation,
      });
    };
    add(artifact.contentRef.id, "content");
    add(artifact.documentRepresentation?.textContentRef?.id, "pdf-text");
    add(
      artifact.archiveRepresentation?.manifestContentRef.id,
      "archive-manifest",
    );
    add(artifact.archiveProvenance?.archiveContentId, "archive-source");
    add(artifact.pdfProvenance?.originalContentId, "content");
    add(artifact.pdfProvenance?.extractedTextRef?.id, "pdf-text");
  };
  for (const task of tasks) {
    for (const artifact of task.artifactRefs) {
      addArtifact(task, artifact, "input");
    }
    for (const artifact of task.result?.artifacts ?? []) {
      addArtifact(task, artifact, "returned");
    }
  }
  return [...references.values()];
}

export function collectPeerTaskContentIds(
  tasks: readonly PeerTask[],
): string[] {
  const ids = new Set(
    collectPeerTaskContentReferences(tasks).map(
      (reference) => reference.contentId,
    ),
  );
  return [...ids];
}

function migrateVersionOneTask(task: StoredPeerTask): PeerTask {
  const legacyArtifactRefs = Array.isArray(task.artifactRefs)
    ? task.artifactRefs.flatMap((value) => {
        const candidate = value as unknown as Partial<PeerArtifactRef>;
        return (candidate.kind === "file" || candidate.kind === "diff") &&
          nonEmpty(candidate.path)
          ? [{ kind: candidate.kind, path: candidate.path }]
          : [];
      })
    : [];
  const now = Date.now();
  const wasQueued = task.status === "queued" && legacyArtifactRefs.length > 0;
  return {
    ...(task as unknown as PeerTask),
    schemaVersion: PEER_TASK_SCHEMA_VERSION,
    artifactRefs: [],
    legacyArtifactRefs,
    status: wasQueued ? "failed" : (task.status as PeerTaskStatus),
    updatedAt: wasQueued ? now : (task.updatedAt ?? now),
    ...(wasQueued
      ? {
          endedAt: now,
          error: {
            code: "peer_artifact_upgrade_required",
            message:
              "This queued task used legacy path-only artifacts and was not replayed. Create it again to package immutable file snapshots.",
          },
        }
      : {}),
    result: normalizeResult(task.result, []),
    workspaceEnvironment: task.workspaceEnvironment ??
      workspaceEnvironmentFromId(task.workspaceId) ?? { kind: "local" },
    executionMode: isExecutionMode(task.executionMode)
      ? task.executionMode
      : "read-only",
    dependsOn: [],
    cancellation: undefined,
    recovery: undefined,
  };
}

function normalizeRecovery(value: unknown): PeerTaskRecovery | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<PeerTaskRecovery>;
  const interruption =
    raw.interruption?.cause === "app-restart" &&
    typeof raw.interruption.detectedAt === "number"
      ? raw.interruption
      : undefined;
  const contentIssues = Array.isArray(raw.contentIssues)
    ? raw.contentIssues.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const issue = value as Partial<PeerTaskRecoveryContentIssue>;
        if (
          !nonEmpty(issue.artifactId) ||
          !/^[a-f0-9]{64}$/.test(issue.contentId ?? "") ||
          (issue.role !== "input" && issue.role !== "returned") ||
          !isRecoveryRepresentation(issue.representation) ||
          !isRecoveryIssueCode(issue.code) ||
          !nonEmpty(issue.message)
        ) {
          return [];
        }
        return [issue as PeerTaskRecoveryContentIssue];
      })
    : undefined;
  const worktree =
    (raw.worktree?.state === "missing" ||
      raw.worktree?.state === "invalid") &&
    nonEmpty(raw.worktree.message)
      ? {
          state: raw.worktree.state,
          message: raw.worktree.message,
        }
      : undefined;
  if (!interruption && !contentIssues?.length && !worktree) return undefined;
  return {
    ...(interruption ? { interruption } : {}),
    ...(contentIssues?.length ? { contentIssues } : {}),
    ...(worktree ? { worktree } : {}),
  };
}

function isRecoveryRepresentation(
  value: unknown,
): value is PeerTaskRecoveryContentIssue["representation"] {
  return (
    value === "content" ||
    value === "pdf-text" ||
    value === "archive-manifest" ||
    value === "archive-source"
  );
}

function isRecoveryIssueCode(
  value: unknown,
): value is PeerTaskRecoveryContentIssue["code"] {
  return (
    value === "attachment_content_missing" ||
    value === "attachment_content_integrity_failed" ||
    value === "attachment_content_invalid"
  );
}

function normalizeArtifacts(value: unknown): PeerTaskArtifact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((artifact) => {
    const normalized = normalizeArtifact(artifact);
    return normalized ? [normalized] : [];
  });
}

function normalizeResult(
  value: StoredPeerTask["result"],
  artifacts: PeerTaskArtifact[],
): PeerTaskResult | undefined {
  if (
    !value ||
    typeof value.summary !== "string" ||
    !nonEmpty(value.targetSessionId) ||
    !nonEmpty(value.targetAgentId) ||
    !nonEmpty(value.targetModelId) ||
    typeof value.completedAt !== "number"
  ) {
    return undefined;
  }
  return {
    summary: value.summary,
    targetSessionId: value.targetSessionId,
    targetAgentId: value.targetAgentId,
    targetModelId: value.targetModelId,
    completedAt: value.completedAt,
    artifacts,
  };
}

function normalizeArtifact(value: unknown): PeerTaskArtifact | null {
  if (!value || typeof value !== "object") return null;
  const artifact = value as Partial<PeerTaskArtifact>;
  const ref = artifact.contentRef;
  if (
    !nonEmpty(artifact.id) ||
    !nonEmpty(artifact.attachmentId) ||
    !nonEmpty(artifact.displayName) ||
    !nonEmpty(artifact.mediaType) ||
    !nonEmpty(artifact.sourceSessionId) ||
    !nonEmpty(artifact.sourceAgentId) ||
    !nonEmpty(artifact.sourceModelId) ||
    !nonEmpty(artifact.workspaceId) ||
    !nonEmpty(artifact.workspaceRoot) ||
    typeof artifact.contentKind !== "string" ||
    typeof artifact.byteSize !== "number" ||
    !Number.isInteger(artifact.byteSize) ||
    artifact.byteSize <= 0 ||
    !ref ||
    !/^[a-f0-9]{64}$/.test(ref.id) ||
    ref.contentHash !== ref.id ||
    ref.byteSize !== artifact.byteSize ||
    artifact.accessPolicy !== "model-input" ||
    !isArtifactOrigin(artifact.originType)
  ) {
    return null;
  }
  if (
    artifact.archiveProvenance &&
    artifact.archiveProvenance.entryContentHash !== ref.contentHash
  ) {
    return null;
  }
  const candidate: PeerTaskArtifact = {
    id: artifact.id,
    attachmentId: artifact.attachmentId,
    contentRef: { ...ref },
    displayName: artifact.displayName,
    mediaType: artifact.mediaType,
    contentKind: artifact.contentKind,
    byteSize: artifact.byteSize,
    sourceSessionId: artifact.sourceSessionId,
    sourceTaskId: artifact.sourceTaskId ?? null,
    sourceAgentId: artifact.sourceAgentId,
    sourceModelId: artifact.sourceModelId,
    workspaceId: artifact.workspaceId,
    workspaceRoot: artifact.workspaceRoot,
    createdAt: artifact.createdAt ?? 0,
    originType: artifact.originType,
    accessPolicy: "model-input",
    ...(artifact.sourcePath ? { sourcePath: artifact.sourcePath } : {}),
    ...(artifact.selectionSource
      ? { selectionSource: artifact.selectionSource }
      : {}),
    ...(artifact.documentRepresentation
      ? { documentRepresentation: artifact.documentRepresentation }
      : {}),
    ...(artifact.archiveRepresentation
      ? { archiveRepresentation: artifact.archiveRepresentation }
      : {}),
    ...(artifact.archiveProvenance
      ? { archiveProvenance: artifact.archiveProvenance }
      : {}),
    ...(artifact.pdfProvenance
      ? { pdfProvenance: artifact.pdfProvenance }
      : {}),
    ...(artifact.worktreeProvenance
      ? { worktreeProvenance: artifact.worktreeProvenance }
      : {}),
  };
  const messageReference = {
    type: CLACK_ATTACHMENT_PART_TYPE,
    data: {
      attachmentId: candidate.attachmentId,
      contentId: candidate.contentRef.id,
      contentHash: candidate.contentRef.contentHash,
      displayName: candidate.displayName,
      mediaType: candidate.mediaType,
      byteSize: candidate.byteSize,
      contentKind: candidate.contentKind,
      selectionSource: candidate.selectionSource,
      documentRepresentation: candidate.documentRepresentation,
      archiveRepresentation: candidate.archiveRepresentation,
      ...(candidate.archiveProvenance
        ? {
            archiveEntryProvenance: {
              archiveAttachmentId:
                candidate.archiveProvenance.archiveAttachmentId,
              archiveContentId: candidate.archiveProvenance.archiveContentId,
              archiveContentHash:
                candidate.archiveProvenance.archiveContentHash,
              archiveFormat: candidate.archiveProvenance.archiveFormat,
              archiveDisplayName:
                candidate.archiveProvenance.archiveDisplayName,
              entryIndex: candidate.archiveProvenance.entryIndex,
              entryPath: candidate.archiveProvenance.entryPath,
            },
          }
        : {}),
    },
  };
  return isAttachmentMessagePart(messageReference) ? candidate : null;
}

function isArtifactOrigin(value: unknown): value is PeerTaskArtifactOrigin {
  return (
    value === "attachment" ||
    value === "workspace-file" ||
    value === "archive-entry" ||
    value === "pdf-derived" ||
    value === "generated-file" ||
    value === "worktree-file" ||
    value === "diff"
  );
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isKind(value: unknown): value is PeerTaskKind {
  return value === "delegate" || value === "review" || value === "question";
}

function isStatus(value: unknown): value is PeerTaskStatus {
  return (
    value === "waiting" ||
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "blocked"
  );
}

function normalizeDependencyIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(nonEmpty))].slice(
    0,
    PEER_TASK_MAX_DEPENDENCIES,
  );
}

function normalizeCancellation(
  value: unknown,
): PeerTaskCancellation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<PeerTaskCancellation>;
  if (
    (candidate.actor !== "user" && candidate.actor !== "programmatic") ||
    (candidate.cause !== "direct" &&
      candidate.cause !== "parent" &&
      candidate.cause !== "orchestration") ||
    !nonEmpty(candidate.requestedTaskId) ||
    !nonEmpty(candidate.reason) ||
    typeof candidate.cancelledAt !== "number" ||
    !Number.isFinite(candidate.cancelledAt)
  ) {
    return undefined;
  }
  return {
    actor: candidate.actor,
    cause: candidate.cause,
    requestedTaskId: candidate.requestedTaskId,
    cancelledByTaskId: nonEmpty(candidate.cancelledByTaskId)
      ? candidate.cancelledByTaskId
      : undefined,
    reason: candidate.reason.slice(0, 500),
    cancelledAt: candidate.cancelledAt,
    cancelledDescendantCount:
      typeof candidate.cancelledDescendantCount === "number" &&
      Number.isInteger(candidate.cancelledDescendantCount) &&
      candidate.cancelledDescendantCount >= 0
        ? Math.min(
            candidate.cancelledDescendantCount,
            PEER_TASK_MAX_PER_ROOT - 1,
          )
        : undefined,
  };
}

function isExecutionMode(value: unknown): value is PeerTaskExecutionMode {
  return (
    value === "read-only" ||
    value === "shared-write" ||
    value === "isolated-worktree"
  );
}
