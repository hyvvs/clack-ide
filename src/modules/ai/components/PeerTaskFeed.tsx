import { Spinner } from "@/components/ui/spinner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  ArrowDown01Icon,
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
import {
  activePeerTaskDescendants,
  isPeerTaskActive,
} from "../lib/peerTaskCancellation";
import {
  buildPeerTaskDependencyAggregate,
  buildPeerTaskDescendantAggregate,
  type PeerTaskResultAggregate,
} from "../lib/peerTaskAggregation";
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
  const recoveryError = usePeerTaskStore((state) => state.recoveryError);
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
      {recoveryError ? (
        <div className="clack-ai-block px-2.5 py-2 text-[10.5px] text-[var(--clack-warning)]">
          {recoveryError}
        </div>
      ) : null}
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
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const [showDependencyContext, setShowDependencyContext] = useState(false);
  const [showDescendantResults, setShowDescendantResults] = useState(false);
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
  const activeDescendants = useMemo(
    () => activePeerTaskDescendants(task.id, allTasks),
    [allTasks, task.id],
  );
  const dependencyAggregate = useMemo(
    () => buildPeerTaskDependencyAggregate(task, allTasks),
    [allTasks, task],
  );
  const descendantAggregate = useMemo(
    () => buildPeerTaskDescendantAggregate(task, allTasks),
    [allTasks, task],
  );
  const descendantAgentCount = new Set(
    descendantAggregate.entries.map((entry) => entry.targetAgentId),
  ).size;
  const peer = viewingSource ? target : source;
  const peerAgentName = viewingSource ? targetAgentName : sourceAgentName;
  const active = isPeerTaskActive(task);
  const statusLabel = delegationStatusLabel(task);
  const unavailableReturnedArtifactIds = new Set(
    task.recovery?.contentIssues
      ?.filter((issue) => issue.role === "returned")
      .map((issue) => issue.artifactId) ?? [],
  );
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
  const cancellingTask = task.cancellation?.cancelledByTaskId
    ? allTasks.find((item) => item.id === task.cancellation?.cancelledByTaskId)
    : undefined;
  const cancelledTitle =
    task.status !== "cancelled"
      ? undefined
      : task.cancellation?.cause === "parent"
        ? `Cancelled by ${
            cancellingTask
              ? taskTargetAgentName(cancellingTask, sessions, agents)
              : "parent task"
          }`
        : task.cancellation?.cause === "orchestration"
          ? "Cancelled with orchestration"
          : undefined;
  const title =
    cancelledTitle ??
    (viewingSource &&
    task.status === "waiting" &&
    dependencyAgentNames.length > 0
      ? `Waiting for ${humanList(dependencyAgentNames)}`
      : viewingSource && task.status === "blocked"
        ? `Blocked: ${blockedAgentName} ${blockStatusText(task.blockedByStatus)}`
        : defaultTitle);
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
            {task.status !== "waiting" &&
            task.status !== "blocked" &&
            dependencyAggregate.entries.length > 0 ? (
              <AggregateDisclosure
                label={`Context from ${dependencyAggregate.relevantTaskCount} prerequisite ${dependencyAggregate.relevantTaskCount === 1 ? "task" : "tasks"}`}
                aggregate={dependencyAggregate}
                open={showDependencyContext}
                onOpenChange={setShowDependencyContext}
                allTasks={allTasks}
                sessions={sessions}
                agents={agents}
                onOpenSession={onOpenSession ?? switchSession}
              />
            ) : null}
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
                      {unavailableReturnedArtifactIds.has(artifact.id)
                        ? " · Unavailable"
                        : ""}
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
        {task.worktree && !active && !task.recovery?.worktree ? (
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
        {task.worktree && !active && task.recovery?.worktree ? (
          <div className="space-y-1 border-t border-[color:var(--clack-border-subtle)] pt-2">
            <p className="text-[10px] text-[var(--clack-warning)]">
              Preserved worktree unavailable
            </p>
            <p className="text-[10px] text-[var(--clack-text-3)]">
              {task.recovery.worktree.message}
            </p>
            {task.changeSet?.patch ? (
              <p className="text-[10px] text-[var(--clack-text-3)]">
                The captured patch remains available for review.
              </p>
            ) : null}
          </div>
        ) : null}
        {descendantAggregate.entries.length > 0 ? (
          <div className="border-t border-[color:var(--clack-border-subtle)] pt-2">
            <AggregateDisclosure
              label={`Results from ${descendantAgentCount} ${descendantAgentCount === 1 ? "agent" : "agents"}`}
              aggregate={descendantAggregate}
              open={showDescendantResults}
              onOpenChange={setShowDescendantResults}
              allTasks={allTasks}
              sessions={sessions}
              agents={agents}
              onOpenSession={onOpenSession ?? switchSession}
            />
          </div>
        ) : null}
        {parent ? (
          <div className="space-y-1 border-t border-[color:var(--clack-border-subtle)] pt-2 text-[10px] text-[var(--clack-text-3)]">
            <div className="font-medium text-[var(--clack-text-2)]">
              Related work
            </div>
            <div className="truncate">
              Follow-up to {taskTargetAgentName(parent, sessions, agents)}:{" "}
              {parent.prompt}
            </div>
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
              onClick={() => {
                if (activeDescendants.length > 0) {
                  setShowCancelConfirmation(true);
                  return;
                }
                void cancelPeerTask(task.id, {
                  actor: "user",
                  cascade: false,
                });
              }}
              className="shrink-0 text-[10px] hover:text-destructive"
            >
              Cancel task
            </button>
          ) : null}
        </div>
      </div>
      <AlertDialog
        open={showCancelConfirmation}
        onOpenChange={setShowCancelConfirmation}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancel this task and its active subtasks?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {activeDescendants.length} active subtask
              {activeDescendants.length === 1 ? "" : "s"} can be cancelled with
              this task. Completed and unrelated work will be left alone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep working</AlertDialogCancel>
            <AlertDialogAction
              variant="outline"
              onClick={() =>
                void cancelPeerTask(task.id, {
                  actor: "user",
                  cascade: false,
                })
              }
            >
              Cancel only this task
            </AlertDialogAction>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                void cancelPeerTask(task.id, {
                  actor: "user",
                  cascade: true,
                })
              }
            >
              Cancel task + subtasks
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function AggregateDisclosure({
  label,
  aggregate,
  open,
  onOpenChange,
  allTasks,
  sessions,
  agents,
  onOpenSession,
}: {
  label: string;
  aggregate: PeerTaskResultAggregate;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allTasks: readonly PeerTask[];
  sessions: readonly SessionMeta[];
  agents: readonly Agent[];
  onOpenSession: (sessionId: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-1.5 text-left text-[10px] text-[var(--clack-text-2)] hover:text-[var(--clack-text-1)]"
        aria-expanded={open}
      >
        <HugeiconsIcon
          icon={open ? ArrowDown01Icon : ArrowRight01Icon}
          size={10}
          strokeWidth={1.8}
        />
        <span className="font-medium">{label}</span>
        <span className="ml-auto text-[var(--clack-text-3)]">
          {aggregateProgressLabel(aggregate)}
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-l border-[color:var(--clack-border-subtle)] pl-2">
          {aggregate.entries.map((entry) => {
            const relatedTask = allTasks.find(
              (candidate) => candidate.id === entry.taskId,
            );
            const targetName = relatedTask
              ? taskTargetAgentName(relatedTask, sessions, agents)
              : entry.targetAgentId;
            const targetSession = relatedTask
              ? sessions.find(
                  (session) => session.id === relatedTask.targetSessionId,
                )
              : undefined;
            return (
              <div key={entry.taskId} className="space-y-1 text-[10px]">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-[var(--clack-text-1)]">
                    {targetName} | {aggregateRelationLabel(entry.relation)}:{" "}
                    {entry.promptSummary}
                  </span>
                  <span className="shrink-0 text-[var(--clack-text-3)]">
                    {aggregateStatusLabel(entry.status)}
                  </span>
                </div>
                {entry.resultSummary ? (
                  <p className="whitespace-pre-wrap text-[var(--clack-text-2)]">
                    {entry.resultSummary}
                  </p>
                ) : null}
                {entry.warnings.map((warning) => (
                  <p key={warning} className="text-[var(--clack-warning)]">
                    {warning}
                  </p>
                ))}
                {entry.error ? (
                  <p className="text-destructive">{entry.error.message}</p>
                ) : entry.cancellationReason ? (
                  <p className="text-[var(--clack-text-3)]">
                    {entry.cancellationReason}
                  </p>
                ) : null}
                {entry.artifactRefs.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {entry.artifactRefs.map((artifact) => (
                      <span
                        key={`${entry.taskId}:${artifact.artifactId}`}
                        className="max-w-full truncate rounded-[var(--clack-radius-button)] bg-[var(--clack-surface-2)] px-1.5 py-0.5 text-[9.5px] text-[var(--clack-text-3)]"
                        title={`${artifact.mediaType} | ${artifact.byteSize} bytes`}
                      >
                        {artifact.displayName}
                      </span>
                    ))}
                  </div>
                ) : null}
                {entry.omittedArtifactCount > 0 ? (
                  <p className="text-[var(--clack-text-3)]">
                    {entry.omittedArtifactCount} additional returned file
                    {entry.omittedArtifactCount === 1 ? "" : "s"} omitted from
                    this compact view.
                  </p>
                ) : null}
                {entry.changedPaths.length > 0 ? (
                  <p className="truncate font-mono text-[9.5px] text-[var(--clack-text-3)]">
                    {entry.changedPaths.join(", ")}
                  </p>
                ) : null}
                {entry.omittedChangedPathCount > 0 ? (
                  <p className="text-[var(--clack-text-3)]">
                    {entry.omittedChangedPathCount} additional changed path
                    {entry.omittedChangedPathCount === 1 ? "" : "s"} omitted.
                  </p>
                ) : null}
                {entry.patchAvailable || entry.worktreeAvailable ? (
                  <p className="text-[var(--clack-text-3)]">
                    {entry.patchAvailable ? "Patch available" : ""}
                    {entry.patchAvailable && entry.worktreeAvailable
                      ? " | "
                      : ""}
                    {entry.worktreeAvailable ? "Worktree available" : ""}
                  </p>
                ) : null}
                {entry.truncated ? (
                  <p className="text-[var(--clack-text-3)]">
                    Compact view truncated. Full task result is preserved.
                  </p>
                ) : null}
                {entry.rawResultAvailable && targetSession ? (
                  <button
                    type="button"
                    className="text-[10px] text-[var(--clack-accent)] hover:underline"
                    onClick={() => onOpenSession(targetSession.id)}
                  >
                    Open full result
                  </button>
                ) : null}
              </div>
            );
          })}
          {aggregate.omittedTaskCount > 0 || aggregate.traversalTruncated ? (
            <p className="text-[10px] text-[var(--clack-text-3)]">
              {aggregate.omittedTaskCount > 0
                ? `${aggregate.omittedTaskCount} additional result ${aggregate.omittedTaskCount === 1 ? "was" : "were"} omitted from this compact view.`
                : "Additional related tasks were omitted at the traversal limit."}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
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

function dependencyStatusLabel(task: Pick<PeerTask, "status">): string {
  if (task.status === "completed") return "Done";
  if (task.status === "running") return "Working";
  if (task.status === "queued") return "Queued";
  if (task.status === "waiting") return "Waiting";
  if (task.status === "failed") return "Failed";
  if (task.status === "cancelled") return "Cancelled";
  return "Blocked";
}

function aggregateStatusLabel(
  status: PeerTaskResultAggregate["entries"][number]["status"],
): string {
  if (status === "missing") return "Unavailable";
  return dependencyStatusLabel({ status });
}

function aggregateProgressLabel(aggregate: PeerTaskResultAggregate): string {
  if (aggregate.complete) {
    return aggregate.allSuccessful ? "Complete" : "Finished with issues";
  }
  return aggregate.entries.some(
    (entry) =>
      entry.status === "waiting" ||
      entry.status === "queued" ||
      entry.status === "running",
  )
    ? "In progress"
    : "Partial";
}

function aggregateRelationLabel(
  relation: PeerTaskResultAggregate["entries"][number]["relation"],
): string {
  if (relation === "dependency") return "Prerequisite";
  if (relation === "child") return "Direct task";
  return "Nested task";
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
