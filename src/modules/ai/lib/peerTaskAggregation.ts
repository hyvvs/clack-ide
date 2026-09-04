import {
  PEER_TASK_MAX_HOPS,
  PEER_TASK_MAX_PER_ROOT,
  type PeerTask,
  type PeerTaskArtifactOrigin,
  type PeerTaskStatus,
} from "./peerTasks";

export const PEER_TASK_AGGREGATE_MAX_RESULTS = PEER_TASK_MAX_PER_ROOT;
export const PEER_TASK_AGGREGATE_MAX_PROMPT_CHARS = 240;
export const PEER_TASK_AGGREGATE_MAX_RESULT_CHARS = 800;
export const PEER_TASK_AGGREGATE_MAX_TOTAL_TEXT_CHARS = 8_000;
export const PEER_TASK_AGGREGATE_MAX_ARTIFACT_REFS = 16;
export const PEER_TASK_AGGREGATE_MAX_CHANGED_PATHS = 32;
export const PEER_TASK_AGGREGATE_MAX_TRAVERSAL = 64;

const MAX_ERROR_CHARS = 500;
const MAX_WARNING_CHARS = 500;
const MAX_REFERENCE_CHARS = 180;
const MAX_ARTIFACT_LABEL_CHARS = 180;
const MAX_MEDIA_TYPE_CHARS = 120;
const MAX_PATH_CHARS = 320;

export type PeerTaskAggregateRelation = "dependency" | "child" | "descendant";
export type PeerTaskAggregateStatus = PeerTaskStatus | "missing";

export type PeerTaskAggregateArtifactRef = {
  taskId: string;
  artifactId: string;
  contentId: string;
  displayName: string;
  mediaType: string;
  contentKind: string;
  byteSize: number;
  originType: PeerTaskArtifactOrigin;
};

export type PeerTaskAggregateEntry = {
  taskId: string;
  relation: PeerTaskAggregateRelation;
  depth: number;
  promptSummary: string;
  targetAgentId: string;
  targetModelId: string;
  status: PeerTaskAggregateStatus;
  completedAt?: number;
  resultSummary?: string;
  warnings: string[];
  error?: { code: string; message: string };
  cancellationReason?: string;
  artifactRefs: PeerTaskAggregateArtifactRef[];
  artifactCount: number;
  omittedArtifactCount: number;
  changedPaths: string[];
  changedPathCount: number;
  omittedChangedPathCount: number;
  patchAvailable: boolean;
  worktreeAvailable: boolean;
  rawResultAvailable: boolean;
  truncated: boolean;
  provenance: {
    rootTaskId: string;
    parentTaskId: string | null;
    sourceSessionId: string;
    targetSessionId: string;
  };
};

export type PeerTaskResultAggregate = {
  sourceTaskId: string;
  entries: PeerTaskAggregateEntry[];
  relevantTaskCount: number;
  omittedTaskCount: number;
  includedArtifactRefCount: number;
  omittedArtifactRefCount: number;
  includedChangedPathCount: number;
  omittedChangedPathCount: number;
  complete: boolean;
  allSuccessful: boolean;
  traversalTruncated: boolean;
  truncated: boolean;
};

export type FormattedPeerTaskAggregate = {
  text: string;
  truncated: boolean;
};

type Candidate = {
  taskId: string;
  task?: PeerTask;
  relation: PeerTaskAggregateRelation;
  depth: number;
};

type AggregateOptions = {
  dependencies?: boolean;
  descendants?: boolean;
};

type TraversalResult = {
  truncated: boolean;
  knownOmittedCount: number;
};

export function buildPeerTaskDependencyAggregate(
  source: PeerTask,
  tasks: readonly PeerTask[],
): PeerTaskResultAggregate {
  return buildPeerTaskResultAggregate(source, tasks, {
    dependencies: true,
  });
}

export function buildPeerTaskDescendantAggregate(
  source: PeerTask,
  tasks: readonly PeerTask[],
): PeerTaskResultAggregate {
  return buildPeerTaskResultAggregate(source, tasks, { descendants: true });
}

export function buildPeerTaskRelatedAggregate(
  source: PeerTask,
  tasks: readonly PeerTask[],
): PeerTaskResultAggregate {
  return buildPeerTaskResultAggregate(source, tasks, {
    dependencies: true,
    descendants: true,
  });
}

export function buildPeerTaskResultAggregate(
  source: PeerTask,
  tasks: readonly PeerTask[],
  options: AggregateOptions,
): PeerTaskResultAggregate {
  const seen = new Set<string>([source.id]);
  const candidates: Candidate[] = [];
  let traversalTruncated = false;
  let traversalOmittedCount = 0;

  if (options.dependencies) {
    const dependencyTraversal = collectDependencies(
      source,
      tasks,
      seen,
      candidates,
    );
    traversalTruncated ||= dependencyTraversal.truncated;
    traversalOmittedCount += dependencyTraversal.knownOmittedCount;
  }
  if (options.descendants) {
    const descendantTraversal = collectDescendants(
      source,
      tasks,
      seen,
      candidates,
      Math.max(0, PEER_TASK_AGGREGATE_MAX_TRAVERSAL - candidates.length),
    );
    traversalTruncated ||= descendantTraversal.truncated;
    traversalOmittedCount += descendantTraversal.knownOmittedCount;
  }

  const included = candidates.slice(0, PEER_TASK_AGGREGATE_MAX_RESULTS);
  let artifactSlots = PEER_TASK_AGGREGATE_MAX_ARTIFACT_REFS;
  let changedPathSlots = PEER_TASK_AGGREGATE_MAX_CHANGED_PATHS;
  const entries = included.map((candidate) => {
    const entry = aggregateCandidate(
      candidate,
      artifactSlots,
      changedPathSlots,
    );
    artifactSlots -= entry.artifactRefs.length;
    changedPathSlots -= entry.changedPaths.length;
    return entry;
  });
  const omittedTaskCount = Math.max(
    0,
    candidates.length - entries.length + traversalOmittedCount,
  );
  const omittedArtifactRefCount = entries.reduce(
    (total, entry) => total + entry.omittedArtifactCount,
    0,
  );
  const omittedChangedPathCount = entries.reduce(
    (total, entry) => total + entry.omittedChangedPathCount,
    0,
  );
  const complete =
    !traversalTruncated &&
    omittedTaskCount === 0 &&
    candidates.every(
      (candidate) =>
        candidate.task !== undefined && isTerminal(candidate.task.status),
    );
  const truncated =
    traversalTruncated ||
    omittedTaskCount > 0 ||
    entries.some((entry) => entry.truncated);

  return {
    sourceTaskId: source.id,
    entries,
    relevantTaskCount: candidates.length + traversalOmittedCount,
    omittedTaskCount,
    includedArtifactRefCount: entries.reduce(
      (total, entry) => total + entry.artifactRefs.length,
      0,
    ),
    omittedArtifactRefCount,
    includedChangedPathCount: entries.reduce(
      (total, entry) => total + entry.changedPaths.length,
      0,
    ),
    omittedChangedPathCount,
    complete,
    allSuccessful:
      candidates.length > 0 &&
      candidates.every((candidate) => candidate.task?.status === "completed"),
    traversalTruncated,
    truncated,
  };
}

export function formatPeerTaskAggregateForModel(
  aggregate: PeerTaskResultAggregate,
): FormattedPeerTaskAggregate {
  const full = serializeModelContext(aggregate, false);
  if (full.length <= PEER_TASK_AGGREGATE_MAX_TOTAL_TEXT_CHARS) {
    return { text: full, truncated: aggregate.truncated };
  }

  const compact = serializeModelContext(aggregate, true);
  if (compact.length <= PEER_TASK_AGGREGATE_MAX_TOTAL_TEXT_CHARS) {
    return { text: compact, truncated: true };
  }

  const minimalPayload = {
    sourceTaskRef: compactText(aggregate.sourceTaskId, MAX_REFERENCE_CHARS)
      .value,
    complete: aggregate.complete,
    truncated: true,
    relevantTaskCount: aggregate.relevantTaskCount,
    omittedTaskCount: aggregate.omittedTaskCount,
    results: aggregate.entries.map((entry) => ({
      taskRef: compactText(entry.taskId, MAX_REFERENCE_CHARS).value,
      relation: entry.relation,
      status: entry.status,
      targetAgentId: compactText(entry.targetAgentId, MAX_REFERENCE_CHARS)
        .value,
      resultSummary: entry.resultSummary
        ? compactText(entry.resultSummary, 160).value
        : undefined,
      rawResultAvailable: entry.rawResultAvailable,
      truncated: true,
    })),
  };
  const minimal = wrapModelContext(minimalPayload);
  if (minimal.length <= PEER_TASK_AGGREGATE_MAX_TOTAL_TEXT_CHARS) {
    return { text: minimal, truncated: true };
  }
  const referenceOnly = wrapModelContext({
    sourceTaskRef: compactText(aggregate.sourceTaskId, 80).value,
    complete: aggregate.complete,
    truncated: true,
    relevantTaskCount: aggregate.relevantTaskCount,
    omittedTaskCount: aggregate.omittedTaskCount + aggregate.entries.length,
    resultRefs: aggregate.entries.map((entry) => ({
      taskRef: compactText(entry.taskId, 80).value,
      relation: entry.relation,
      status: entry.status,
      rawResultAvailable: entry.rawResultAvailable,
    })),
  });
  return {
    text: referenceOnly,
    truncated: true,
  };
}

function collectDependencies(
  source: PeerTask,
  tasks: readonly PeerTask[],
  seen: Set<string>,
  candidates: Candidate[],
): TraversalResult {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const remaining = Math.max(
    0,
    PEER_TASK_AGGREGATE_MAX_TRAVERSAL - candidates.length,
  );
  const boundedDependencies = source.dependsOn.slice(0, remaining);
  for (const dependencyId of boundedDependencies) {
    if (seen.has(dependencyId)) continue;
    seen.add(dependencyId);
    const task = byId.get(dependencyId);
    candidates.push({
      taskId: dependencyId,
      task:
        task?.rootTaskId === source.rootTaskId &&
        task.workspaceId === source.workspaceId
          ? task
          : undefined,
      relation: "dependency",
      depth: 1,
    });
  }
  const knownOmittedCount = Math.max(
    0,
    source.dependsOn.length - boundedDependencies.length,
  );
  return {
    truncated: knownOmittedCount > 0,
    knownOmittedCount,
  };
}

function collectDescendants(
  source: PeerTask,
  tasks: readonly PeerTask[],
  seen: Set<string>,
  candidates: Candidate[],
  traversalBudget: number,
): TraversalResult {
  const ordered = [...tasks]
    .map((task, index) => ({ task, index }))
    .sort(
      (left, right) =>
        left.task.createdAt - right.task.createdAt ||
        left.index - right.index ||
        left.task.id.localeCompare(right.task.id),
    );
  const childrenByParent = new Map<string, PeerTask[]>();
  for (const { task } of ordered) {
    if (
      task.rootTaskId !== source.rootTaskId ||
      task.workspaceId !== source.workspaceId ||
      !task.parentTaskId
    ) {
      continue;
    }
    const children = childrenByParent.get(task.parentTaskId) ?? [];
    children.push(task);
    childrenByParent.set(task.parentTaskId, children);
  }

  const queue = (childrenByParent.get(source.id) ?? []).map((task) => ({
    task,
    depth: 1,
  }));
  let traversed = 0;
  let knownOmittedCount = 0;
  let truncated = false;
  while (queue.length > 0 && traversed < traversalBudget) {
    const current = queue.shift();
    if (!current) break;
    traversed += 1;
    if (seen.has(current.task.id)) continue;
    seen.add(current.task.id);
    candidates.push({
      taskId: current.task.id,
      task: current.task,
      relation: current.depth === 1 ? "child" : "descendant",
      depth: current.depth,
    });
    if (current.depth >= PEER_TASK_MAX_HOPS) {
      const deeperChildren = childrenByParent.get(current.task.id) ?? [];
      if (deeperChildren.length > 0) {
        truncated = true;
        knownOmittedCount += deeperChildren.length;
      }
      continue;
    }
    for (const child of childrenByParent.get(current.task.id) ?? []) {
      if (!seen.has(child.id)) {
        queue.push({ task: child, depth: current.depth + 1 });
      }
    }
  }
  if (queue.length > 0) {
    truncated = true;
    knownOmittedCount += queue.length;
  }
  return { truncated, knownOmittedCount };
}

function aggregateCandidate(
  candidate: Candidate,
  artifactSlots: number,
  changedPathSlots: number,
): PeerTaskAggregateEntry {
  const task = candidate.task;
  if (!task) {
    return {
      taskId: candidate.taskId,
      relation: candidate.relation,
      depth: candidate.depth,
      promptSummary: "Required task unavailable",
      targetAgentId: "unknown",
      targetModelId: "unknown",
      status: "missing",
      warnings: [],
      error: {
        code: "peer_task_missing",
        message: "The referenced peer task is unavailable.",
      },
      artifactRefs: [],
      artifactCount: 0,
      omittedArtifactCount: 0,
      changedPaths: [],
      changedPathCount: 0,
      omittedChangedPathCount: 0,
      patchAvailable: false,
      worktreeAvailable: false,
      rawResultAvailable: false,
      truncated: false,
      provenance: {
        rootTaskId: "unknown",
        parentTaskId: null,
        sourceSessionId: "unknown",
        targetSessionId: "unknown",
      },
    };
  }

  const prompt = compactText(task.prompt, PEER_TASK_AGGREGATE_MAX_PROMPT_CHARS);
  const result = task.result
    ? compactText(task.result.summary, PEER_TASK_AGGREGATE_MAX_RESULT_CHARS)
    : undefined;
  const availableArtifacts = task.result?.artifacts ?? [];
  const artifactRefs = availableArtifacts
    .slice(0, Math.max(0, artifactSlots))
    .map((artifact) => ({
      taskId: task.id,
      artifactId: compactText(artifact.id, MAX_REFERENCE_CHARS).value,
      contentId: compactText(artifact.contentRef.id, MAX_REFERENCE_CHARS).value,
      displayName: compactText(artifact.displayName, MAX_ARTIFACT_LABEL_CHARS)
        .value,
      mediaType: compactText(artifact.mediaType, MAX_MEDIA_TYPE_CHARS).value,
      contentKind: artifact.contentKind,
      byteSize: artifact.byteSize,
      originType: artifact.originType,
    }));
  const availablePaths = task.changeSet?.changedPaths ?? [];
  const changedPathValues = availablePaths
    .slice(0, Math.max(0, changedPathSlots))
    .map((path) => compactText(path, MAX_PATH_CHARS));
  const warnings = [
    ...(task.changeSet?.applyError ? [task.changeSet.applyError] : []),
    ...(task.recovery?.contentIssues?.some(
      (issue) => issue.role === "returned",
    )
      ? ["One or more returned files are unavailable."]
      : []),
    ...(task.recovery?.worktree
      ? [task.recovery.worktree.message]
      : []),
    ...(task.status === "completed" && !task.result
      ? ["The task is marked completed but has no durable result payload."]
      : []),
  ].map((warning) => compactText(warning, MAX_WARNING_CHARS));
  const error = task.error
    ? {
        code: compactText(task.error.code, MAX_REFERENCE_CHARS),
        message: compactText(task.error.message, MAX_ERROR_CHARS),
      }
    : undefined;
  const cancellationReason = task.cancellation
    ? compactText(task.cancellation.reason, MAX_ERROR_CHARS)
    : undefined;
  const omittedArtifactCount = Math.max(
    0,
    availableArtifacts.length - artifactRefs.length,
  );
  const omittedChangedPathCount = Math.max(
    0,
    availablePaths.length - changedPathValues.length,
  );

  return {
    taskId: task.id,
    relation: candidate.relation,
    depth: candidate.depth,
    promptSummary: prompt.value,
    targetAgentId: task.targetAgentId,
    targetModelId: task.targetModelId,
    status: task.status,
    completedAt: task.result?.completedAt ?? task.endedAt,
    resultSummary: result?.value,
    warnings: warnings.map((warning) => warning.value),
    error: error
      ? { code: error.code.value, message: error.message.value }
      : undefined,
    cancellationReason: cancellationReason?.value,
    artifactRefs,
    artifactCount: availableArtifacts.length,
    omittedArtifactCount,
    changedPaths: changedPathValues.map((path) => path.value),
    changedPathCount: availablePaths.length,
    omittedChangedPathCount,
    patchAvailable: Boolean(task.changeSet?.patch),
    worktreeAvailable: Boolean(task.worktree && !task.recovery?.worktree),
    rawResultAvailable: Boolean(task.result),
    truncated:
      prompt.truncated ||
      Boolean(result?.truncated) ||
      warnings.some((warning) => warning.truncated) ||
      Boolean(error?.code.truncated || error?.message.truncated) ||
      Boolean(cancellationReason?.truncated) ||
      omittedArtifactCount > 0 ||
      omittedChangedPathCount > 0 ||
      changedPathValues.some((path) => path.truncated),
    provenance: {
      rootTaskId: task.rootTaskId,
      parentTaskId: task.parentTaskId,
      sourceSessionId: task.sourceSessionId,
      targetSessionId: task.targetSessionId,
    },
  };
}

function serializeModelContext(
  aggregate: PeerTaskResultAggregate,
  compact: boolean,
): string {
  const payload = {
    sourceTaskRef: compactText(aggregate.sourceTaskId, MAX_REFERENCE_CHARS)
      .value,
    complete: aggregate.complete,
    truncated: aggregate.truncated || compact,
    relevantTaskCount: aggregate.relevantTaskCount,
    omittedTaskCount: aggregate.omittedTaskCount,
    results: aggregate.entries.map((entry) => ({
      taskRef: compactText(entry.taskId, MAX_REFERENCE_CHARS).value,
      relation: entry.relation,
      depth: entry.depth,
      prompt: compactText(entry.promptSummary, compact ? 120 : 240).value,
      target: {
        agentId: compactText(entry.targetAgentId, MAX_REFERENCE_CHARS).value,
        modelId: compactText(entry.targetModelId, MAX_REFERENCE_CHARS).value,
      },
      status: entry.status,
      completedAt: entry.completedAt,
      summary: entry.resultSummary
        ? compactText(entry.resultSummary, compact ? 320 : 800).value
        : undefined,
      warnings: compact
        ? entry.warnings
            .slice(0, 1)
            .map((warning) => compactText(warning, 160).value)
        : entry.warnings,
      error: entry.error
        ? {
            code: compactText(entry.error.code, MAX_REFERENCE_CHARS).value,
            message: compactText(entry.error.message, compact ? 200 : 500)
              .value,
          }
        : undefined,
      cancellationReason: entry.cancellationReason
        ? compactText(entry.cancellationReason, compact ? 160 : 500).value
        : undefined,
      returnedArtifacts: entry.artifactRefs
        .slice(0, compact ? 2 : entry.artifactRefs.length)
        .map((artifact) => ({
          name: compactText(artifact.displayName, compact ? 100 : 180).value,
          mediaType: artifact.mediaType,
          byteSize: artifact.byteSize,
          contentRef: artifact.contentId,
        })),
      returnedArtifactCount: entry.artifactCount,
      omittedReturnedArtifactCount:
        entry.omittedArtifactCount +
        (compact ? Math.max(0, entry.artifactRefs.length - 2) : 0),
      changedPaths: entry.changedPaths
        .slice(0, compact ? 3 : entry.changedPaths.length)
        .map((path) => compactText(path, compact ? 140 : MAX_PATH_CHARS).value),
      changedPathCount: entry.changedPathCount,
      omittedChangedPathCount:
        entry.omittedChangedPathCount +
        (compact ? Math.max(0, entry.changedPaths.length - 3) : 0),
      patchAvailable: entry.patchAvailable,
      worktreeAvailable: entry.worktreeAvailable,
      rawResultAvailable: entry.rawResultAvailable,
      truncated: entry.truncated || compact,
      provenance: compact
        ? {
            parentTaskRef: entry.provenance.parentTaskId
              ? compactText(entry.provenance.parentTaskId, MAX_REFERENCE_CHARS)
                  .value
              : null,
          }
        : {
            rootTaskRef: compactText(
              entry.provenance.rootTaskId,
              MAX_REFERENCE_CHARS,
            ).value,
            parentTaskRef: entry.provenance.parentTaskId
              ? compactText(entry.provenance.parentTaskId, MAX_REFERENCE_CHARS)
                  .value
              : null,
            sourceSessionRef: compactText(
              entry.provenance.sourceSessionId,
              MAX_REFERENCE_CHARS,
            ).value,
            targetSessionRef: compactText(
              entry.provenance.targetSessionId,
              MAX_REFERENCE_CHARS,
            ).value,
          },
    })),
  };
  return wrapModelContext(payload);
}

function wrapModelContext(payload: object): string {
  return `<peer-task-results>\n${JSON.stringify(payload)}\n</peer-task-results>`;
}

function compactText(
  value: string,
  maxCharacters: number,
): { value: string; truncated: boolean } {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxCharacters) {
    return { value: normalized, truncated: false };
  }
  if (maxCharacters <= 3) {
    return { value: normalized.slice(0, maxCharacters), truncated: true };
  }
  return {
    value: `${normalized.slice(0, maxCharacters - 3)}...`,
    truncated: true,
  };
}

function isTerminal(status: PeerTaskStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "blocked"
  );
}
