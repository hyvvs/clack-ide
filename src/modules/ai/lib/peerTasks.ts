import { LazyStore } from "@tauri-apps/plugin-store";

export const PEER_TASK_SCHEMA_VERSION = 1;
export const PEER_TASK_MAX_HOPS = 3;
export const PEER_TASK_MAX_PER_ROOT = 8;

export type PeerTaskKind = "delegate" | "review" | "question";
export type PeerTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type PeerArtifactRef = {
  kind: "file" | "diff";
  path: string;
};

export type PeerTaskResult = {
  summary: string;
  targetSessionId: string;
  targetAgentId: string;
  targetModelId: string;
  completedAt: number;
};

export type PeerTaskError = {
  code: string;
  message: string;
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
  kind: PeerTaskKind;
  prompt: string;
  artifactRefs: PeerArtifactRef[];
  parentTaskId: string | null;
  rootTaskId: string;
  hopCount: number;
  status: PeerTaskStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  result?: PeerTaskResult;
  error?: PeerTaskError;
};

const STORE_PATH = "clack-ai-peer-tasks.json";
const TASKS_KEY = "tasks";
const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export function newPeerTaskId(): string {
  return `pt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function loadPeerTasks(): Promise<PeerTask[]> {
  const raw = (await store.get<unknown[]>(TASKS_KEY)) ?? [];
  return raw.flatMap((value) => {
    const task = normalizePeerTask(value);
    return task ? [task] : [];
  });
}

export async function savePeerTasks(tasks: readonly PeerTask[]): Promise<void> {
  await store.set(TASKS_KEY, tasks);
}

export function recoverInterruptedPeerTasks(
  tasks: readonly PeerTask[],
  now = Date.now(),
): PeerTask[] {
  return tasks.map((task) =>
    task.status === "running"
      ? {
          ...task,
          status: "failed",
          updatedAt: now,
          endedAt: now,
          error: {
            code: "peer_task_interrupted",
            message: "Clack closed before the peer task completed.",
          },
        }
      : task,
  );
}

export function peerTaskFingerprint(input: {
  sourceSessionId: string;
  targetSessionId: string;
  kind: PeerTaskKind;
  prompt: string;
}): string {
  return [
    input.sourceSessionId,
    input.targetSessionId,
    input.kind,
    input.prompt.trim().replace(/\s+/g, " ").toLowerCase(),
  ].join("|");
}

function normalizePeerTask(value: unknown): PeerTask | null {
  if (!value || typeof value !== "object") return null;
  const task = value as Partial<PeerTask>;
  if (
    task.schemaVersion !== PEER_TASK_SCHEMA_VERSION ||
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
  return task as PeerTask;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isKind(value: unknown): value is PeerTaskKind {
  return value === "delegate" || value === "review" || value === "question";
}

function isStatus(value: unknown): value is PeerTaskStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
}
