import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  ArrowRight01Icon,
  Cancel01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";
import {
  applyPeerTaskChangeSet,
  cancelPeerTask,
  discardPeerTaskWorktree,
} from "../lib/peerTaskCoordinator";
import {
  delegationCardTitle,
  delegationStatusLabel,
} from "../lib/delegationUx";
import type { PeerTask, PeerTaskDependencyBlockStatus } from "../lib/peerTasks";
import { resolveModelSelectionInfo } from "../lib/savedProviderModels";
import { BUILTIN_AGENTS, type Agent } from "../lib/agents";
import type { SessionMeta } from "../lib/sessions";
import { useAgentsStore } from "../store/agentsStore";
import { useChatStore } from "../store/chatStore";
import { usePeerTaskStore } from "../store/peerTaskStore";

export function PeerTaskFeed({
  sessionId,
  onOpenSession,
}: {
  sessionId: string;
  onOpenSession?: (sessionId: string) => void;
}) {
  const allTasks = usePeerTaskStore((state) => state.tasks);
  const tasks = useMemo(
    () =>
      allTasks.filter(
        (task) =>
          task.sourceSessionId === sessionId ||
          task.targetSessionId === sessionId,
      ),
    [allTasks, sessionId],
  );
  if (tasks.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-label="Inter-agent tasks">
      {tasks.map((task) => (
        <PeerTaskCard
          key={task.id}
          task={task}
          viewingSessionId={sessionId}
          allTasks={allTasks}
          onOpenSession={onOpenSession}
        />
      ))}
    </section>
  );
}

export function PeerTaskCard({
  task,
  viewingSessionId,
  allTasks: providedTasks,
  onOpenSession,
}: {
  task: PeerTask;
  viewingSessionId: string;
  allTasks?: readonly PeerTask[];
  onOpenSession?: (sessionId: string) => void;
}) {
  const sessions = useChatStore((state) => state.sessions);
  const switchSession = useChatStore((state) => state.switchSession);
  const storedTasks = usePeerTaskStore((state) => state.tasks);
  const allTasks = providedTasks ?? storedTasks;
  const source = sessions.find(
    (session) => session.id === task.sourceSessionId,
  );
  const target = sessions.find(
    (session) => session.id === task.targetSessionId,
  );
  const customAgents = useAgentsStore((state) => state.customAgents);
  const customEndpoints = usePreferencesStore((state) => state.customEndpoints);
  const savedProviderModels = usePreferencesStore(
    (state) => state.savedProviderModels,
  );
  const agents = [...BUILTIN_AGENTS, ...customAgents];
  const sourceAgentId = source?.profile?.agentId ?? task.sourceAgentId;
  const targetAgentId = target?.profile?.agentId ?? task.targetAgentId;
  const sourceAgentName =
    agents.find((agent) => agent.id === sourceAgentId)?.name ?? sourceAgentId;
  const targetAgentName =
    agents.find((agent) => agent.id === targetAgentId)?.name ?? targetAgentId;
  const viewingSource = viewingSessionId === task.sourceSessionId;
  const [applying, setApplying] = useState(false);
  const [showPatch, setShowPatch] = useState(false);
  const [discardingWorktree, setDiscardingWorktree] = useState(false);
  const lineage = useMemo(
    () => buildPeerTaskLineage(task, allTasks),
    [allTasks, task],
  );
  const dependencies = useMemo(
    () =>
      task.dependsOn.flatMap((dependencyId) => {
        const dependency = allTasks.find((item) => item.id === dependencyId);
        return dependency ? [dependency] : [];
      }),
    [allTasks, task.dependsOn],
  );
  const parent = task.parentTaskId
    ? allTasks.find((item) => item.id === task.parentTaskId)
    : undefined;
  const children = allTasks.filter((item) => item.parentTaskId === task.id);
  const peer = viewingSource ? target : source;
  const peerAgentName = viewingSource ? targetAgentName : sourceAgentName;
  const active =
    task.status === "waiting" ||
    task.status === "queued" ||
    task.status === "running";
  const statusLabel = delegationStatusLabel(task);
  const defaultTitle = delegationCardTitle(
    task,
    viewingSource,
    sourceAgentName,
    targetAgentName,
  );
  const dependencyAgentNames = dependencies.map((dependency) =>
    taskTargetAgentName(dependency, sessions, agents),
  );
  const blockedDependency = task.blockedByTaskId
    ? allTasks.find((item) => item.id === task.blockedByTaskId)
    : undefined;
  const blockedAgentName = blockedDependency
    ? taskTargetAgentName(blockedDependency, sessions, agents)
    : "A required task";
  const title =
    viewingSource &&
    task.status === "waiting" &&
    dependencyAgentNames.length > 0
      ? `Waiting for ${humanList(dependencyAgentNames)}`
      : viewingSource && task.status === "blocked"
        ? `Blocked: ${blockedAgentName} ${blockStatusText(task.blockedByStatus)}`
        : defaultTitle;
  const tone =
    task.status === "failed"
      ? "text-destructive"
      : task.status === "blocked"
        ? "text-[var(--clack-warning)]"
        : task.status === "completed"
          ? "text-[var(--clack-success)]"
          : task.status === "cancelled"
            ? "text-[var(--clack-text-3)]"
            : "text-[var(--clack-accent)]";
  const applyChangeSet = async () => {
    if (applying) return;
    setApplying(true);
    await applyPeerTaskChangeSet(task.id);
    setApplying(false);
  };

  return (
    <section
      className="clack-ai-block overflow-hidden"
      data-peer-task-id={task.id}
    >
      <div className="flex items-center gap-2 border-b border-[color:var(--clack-border-subtle)] px-2.5 py-2">
        {task.status === "waiting" ||
        task.status === "running" ||
        task.status === "queued" ? (
          <Spinner className="size-3" />
        ) : (
          <HugeiconsIcon
            icon={task.status === "completed" ? Tick02Icon : Cancel01Icon}
            size={12}
            strokeWidth={1.8}
            className={tone}
          />
        )}
        <span className="min-w-0 truncate text-[11.5px] font-semibold text-[var(--clack-text-1)]">
          {title}
        </span>
        <span className={cn("shrink-0 text-[10px]", tone)}>{statusLabel}</span>
        <button
          type="button"
          disabled={!peer}
          onClick={() => {
            if (!peer) return;
            if (onOpenSession) onOpenSession(peer.id);
            else switchSession(peer.id);
          }}
          className="ml-auto flex min-w-0 shrink-0 items-center gap-1 text-[10.5px] text-[var(--clack-text-3)] hover:text-[var(--clack-text-1)] disabled:pointer-events-none"
          title={peer ? `Open ${peer.title}` : "Other conversation deleted"}
          aria-label={
            peer ? `Open ${peerAgentName}` : "Other conversation deleted"
          }
        >
          <span className="max-w-28 truncate">
            {peer ? `Open ${peerAgentName}` : "Deleted chat"}
          </span>
          <HugeiconsIcon icon={ArrowRight01Icon} size={10} strokeWidth={1.8} />
        </button>
      </div>
      <div className="space-y-2 px-2.5 py-2 text-[11px]">
        <div>
          <div className="mb-0.5 text-[9.5px] font-medium uppercase text-[var(--clack-text-3)]">
            Task
          </div>
          <p className="whitespace-pre-wrap text-[var(--clack-text-1)]">
            {task.prompt}
          </p>
        </div>
        {task.status === "queued" ? (
          <p className="text-[10px] text-[var(--clack-text-3)]">
            {target?.run?.state === "running"
              ? "Currently finishing another task. This one will start next."
              : "Waiting to start."}
          </p>
        ) : null}
        {task.dependsOn.length > 0 ? (
          <div className="space-y-1 border-t border-[color:var(--clack-border-subtle)] pt-2">
            <div className="text-[10px] font-medium text-[var(--clack-text-2)]">
              {task.status === "waiting" ? "Waiting on" : "Prerequisites"}
            </div>
            <div className="space-y-1">
              {task.dependsOn.map((dependencyId) => {
                const dependency = allTasks.find(
                  (item) => item.id === dependencyId,
                );
                return (
                  <div
                    key={dependencyId}
                    className="flex min-w-0 items-center gap-2 text-[10px]"
                  >
                    <span className="min-w-0 flex-1 truncate text-[var(--clack-text-2)]">
                      {dependency
                        ? `${taskTargetAgentName(dependency, sessions, agents)}: ${dependency.prompt}`
                        : "Required task unavailable"}
                    </span>
                    <span className="shrink-0 text-[var(--clack-text-3)]">
                      {dependency
                        ? dependencyStatusLabel(dependency)
                        : "Unavailable"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {task.artifactRefs.length > 0 ? (
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-[var(--clack-text-2)]">
              {viewingSource ? "Context sent" : "Context received"}
            </div>
            <div className="flex flex-wrap gap-1">
              {task.artifactRefs.map((artifact) => (
                <span
                  key={artifact.id}
                  className="max-w-full truncate rounded-[var(--clack-radius-button)] bg-[var(--clack-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--clack-text-3)]"
                  title={artifactProvenanceTitle(artifact)}
                >
                  {artifact.displayName}
                  {artifact.archiveProvenance
                    ? ` from ${artifact.archiveProvenance.archiveDisplayName}`
                    : ""}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {task.result ? (
          <div className="max-h-40 overflow-auto border-t border-[color:var(--clack-border-subtle)] pt-2 whitespace-pre-wrap text-[var(--clack-text-2)]">
            {task.result.summary}
            {task.result.artifacts.length > 0 ? (
              <div className="mt-2 space-y-1">
                <div className="text-[10px] font-medium text-[var(--clack-text-2)]">
                  Returned files
                </div>
                <div className="flex flex-wrap gap-1">
                  {task.result.artifacts.map((artifact) => (
                    <span
                      key={artifact.id}
                      className="max-w-full truncate rounded-[var(--clack-radius-button)] bg-[var(--clack-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--clack-text-3)]"
                      title={artifactProvenanceTitle(artifact)}
                    >
                      {artifact.displayName}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : task.status === "blocked" ? (
          <div className="space-y-0.5 border-t border-[color:var(--clack-border-subtle)] pt-2 text-[var(--clack-warning)]">
            <p>
              This task did not start because {blockedAgentName}{" "}
              {blockStatusText(task.blockedByStatus)}.
            </p>
            <p className="text-[10px] text-[var(--clack-text-3)]">
              Other independent tasks are unaffected.
            </p>
          </div>
        ) : task.error ? (
          <div className="space-y-0.5 border-t border-[color:var(--clack-border-subtle)] pt-2 text-destructive">
            <p>
              {targetAgentName} could not complete this task:{" "}
              {task.error.message}
            </p>
            <p className="text-[10px] text-[var(--clack-text-3)]">
              Nothing was returned.
            </p>
          </div>
        ) : null}
        {task.changeSet ? (
          <div className="space-y-1.5 border-t border-[color:var(--clack-border-subtle)] pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10.5px] font-medium text-[var(--clack-text-1)]">
                Changes ready to review
              </span>
              <span className="text-[10px] text-[var(--clack-text-3)]">
                {task.changeSet.changedPaths.length} file
                {task.changeSet.changedPaths.length === 1 ? "" : "s"} changed
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {task.changeSet.changedPaths.map((path) => (
                <span
                  key={path}
                  className="max-w-full truncate rounded-[var(--clack-radius-button)] bg-[var(--clack-surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--clack-text-3)]"
                  title={path}
                >
                  {path}
                </span>
              ))}
              {task.changeSet.changedPaths.length === 0 ? (
                <span className="text-[10px] text-[var(--clack-text-3)]">
                  No file changes
                </span>
              ) : null}
            </div>
            {task.changeSet.applyError ? (
              <p className="text-[10px] text-destructive">
                {task.changeSet.applyError}
              </p>
            ) : null}
            {task.changeSet.patch.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowPatch((visible) => !visible)}
                  className="text-[10px] text-[var(--clack-text-2)] hover:underline"
                >
                  {showPatch ? "Hide changes" : "Review changes"}
                </button>
                {showPatch ? (
                  <pre className="max-h-48 overflow-auto whitespace-pre font-mono text-[9.5px] text-[var(--clack-text-2)]">
                    {task.changeSet.patch}
                  </pre>
                ) : null}
              </>
            ) : null}
            {viewingSource &&
            task.changeSet.patch.length > 0 &&
            !task.changeSet.appliedAt ? (
              <button
                type="button"
                onClick={() => void applyChangeSet()}
                disabled={applying}
                className="text-[10px] font-medium text-[var(--clack-accent)] hover:underline disabled:opacity-50"
              >
                {applying ? "Checking workspace..." : "Apply patch"}
              </button>
            ) : task.changeSet.appliedAt ? (
              <span className="text-[10px] text-[var(--clack-success)]">
                Applied to workspace
              </span>
            ) : null}
          </div>
        ) : null}
        {task.worktree && !active ? (
          <div className="space-y-1 border-t border-[color:var(--clack-border-subtle)] pt-2">
            <p className="text-[10px] text-[var(--clack-text-2)]">
              Preserved worktree
            </p>
            <p
              className="truncate font-mono text-[9.5px] text-[var(--clack-text-3)]"
              title={task.worktree.checkoutRoot}
            >
              {task.worktree.checkoutRoot}
            </p>
            <button
              type="button"
              disabled={discardingWorktree}
              onClick={() => {
                setDiscardingWorktree(true);
                void discardPeerTaskWorktree(task.id).finally(() =>
                  setDiscardingWorktree(false),
                );
              }}
              className="text-[10px] text-destructive hover:underline disabled:opacity-50"
            >
              {discardingWorktree ? "Discarding..." : "Discard worktree"}
            </button>
          </div>
        ) : null}
        {parent || children.length > 0 ? (
          <div className="space-y-1 border-t border-[color:var(--clack-border-subtle)] pt-2 text-[10px] text-[var(--clack-text-3)]">
            <div className="font-medium text-[var(--clack-text-2)]">
              Related work
            </div>
            {parent ? (
              <div className="truncate">
                Follow-up to {taskTargetAgentName(parent, sessions, agents)}:{" "}
                {parent.prompt}
              </div>
            ) : null}
            {children.length > 0 ? (
              <div>
                {children.length} delegated task
                {children.length === 1 ? "" : "s"}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center gap-2 border-t border-[color:var(--clack-border-subtle)] pt-2 text-[9.5px] text-[var(--clack-text-3)]">
          <span>{executionModeLabel(task)}</span>
          <span className="truncate">
            {targetAgentName} |{" "}
            {modelLabel(
              task.targetModelId,
              customEndpoints,
              savedProviderModels,
            )}
          </span>
          {lineage.length > 1 ? (
            <span className="shrink-0">{lineage.length} linked tasks</span>
          ) : null}
          <span className="ml-auto" />
          {active ? (
            <button
              type="button"
              onClick={() => void cancelPeerTask(task.id)}
              className="shrink-0 text-[10px] hover:text-destructive"
            >
              Cancel task
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function executionModeLabel(task: PeerTask): string {
  if (task.executionMode === "shared-write") return "Can edit workspace";
  if (task.executionMode === "isolated-worktree") return "Isolated changes";
  return "Read only";
}

function taskTargetAgentName(
  task: PeerTask,
  sessions: readonly SessionMeta[],
  agents: readonly Agent[],
): string {
  const session = sessions.find(
    (candidate) => candidate.id === task.targetSessionId,
  );
  const agentId = session?.profile?.agentId ?? task.targetAgentId;
  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}

function dependencyStatusLabel(task: PeerTask): string {
  if (task.status === "completed") return "Done";
  if (task.status === "running") return "Working";
  if (task.status === "queued") return "Queued";
  if (task.status === "waiting") return "Waiting";
  if (task.status === "failed") return "Failed";
  if (task.status === "cancelled") return "Cancelled";
  return "Blocked";
}

function blockStatusText(
  status: PeerTaskDependencyBlockStatus | undefined,
): string {
  if (status === "failed") return "failed";
  if (status === "cancelled") return "was cancelled";
  if (status === "blocked") return "was blocked";
  return "is unavailable";
}

function humanList(values: readonly string[]): string {
  const unique = [...new Set(values)];
  if (unique.length <= 1) return unique[0] ?? "required work";
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
}

function modelLabel(
  modelId: string,
  customEndpoints: ReturnType<
    typeof usePreferencesStore.getState
  >["customEndpoints"],
  savedProviderModels: ReturnType<
    typeof usePreferencesStore.getState
  >["savedProviderModels"],
): string {
  try {
    return resolveModelSelectionInfo(
      modelId,
      customEndpoints,
      savedProviderModels,
    ).label;
  } catch {
    return modelId;
  }
}

function artifactProvenanceTitle(
  artifact: PeerTask["artifactRefs"][number],
): string {
  if (artifact.archiveProvenance) {
    return `${artifact.archiveProvenance.entryPath} from ${artifact.archiveProvenance.archiveDisplayName}`;
  }
  if (artifact.pdfProvenance) {
    const pages = artifact.pdfProvenance.pageNumbers.join(", ");
    return `PDF pages ${pages || "none"}${artifact.pdfProvenance.truncated ? " (truncated)" : ""}`;
  }
  return artifact.sourcePath ?? artifact.displayName;
}

export function buildPeerTaskLineage(
  task: PeerTask,
  tasks: readonly PeerTask[],
): PeerTask[] {
  const byId = new Map(tasks.map((item) => [item.id, item]));
  const lineage: PeerTask[] = [];
  const visited = new Set<string>();
  let current: PeerTask | undefined = task;

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    lineage.unshift(current);
    current = current.parentTaskId ? byId.get(current.parentTaskId) : undefined;
  }

  return lineage;
}
