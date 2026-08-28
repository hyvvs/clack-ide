import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
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
import type { PeerTask } from "../lib/peerTasks";
import { useChatStore } from "../store/chatStore";
import { usePeerTaskStore } from "../store/peerTaskStore";

export function PeerTaskFeed({ sessionId }: { sessionId: string }) {
  const allTasks = usePeerTaskStore((state) => state.tasks);
  const tasks = useMemo(
    () =>
      allTasks.filter(
      (task) =>
        task.sourceSessionId === sessionId || task.targetSessionId === sessionId,
      ),
    [allTasks, sessionId],
  );
  if (tasks.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-label="Inter-agent tasks">
      {tasks.map((task) => (
        <PeerTaskCard key={task.id} task={task} viewingSessionId={sessionId} />
      ))}
    </section>
  );
}

export function PeerTaskCard({
  task,
  viewingSessionId,
}: {
  task: PeerTask;
  viewingSessionId: string;
}) {
  const sessions = useChatStore((state) => state.sessions);
  const switchSession = useChatStore((state) => state.switchSession);
  const source = sessions.find((session) => session.id === task.sourceSessionId);
  const target = sessions.find((session) => session.id === task.targetSessionId);
  const viewingSource = viewingSessionId === task.sourceSessionId;
  const [applying, setApplying] = useState(false);
  const [showPatch, setShowPatch] = useState(false);
  const [discardingWorktree, setDiscardingWorktree] = useState(false);
  const peer = viewingSource ? target : source;
  const active = task.status === "queued" || task.status === "running";
  const tone =
    task.status === "failed"
      ? "text-destructive"
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
    <section className="clack-ai-block overflow-hidden" data-peer-task-id={task.id}>
      <div className="flex items-center gap-2 border-b border-[color:var(--clack-border-subtle)] px-2.5 py-2">
        {task.status === "running" || task.status === "queued" ? (
          <Spinner className="size-3" />
        ) : (
          <HugeiconsIcon
            icon={task.status === "completed" ? Tick02Icon : Cancel01Icon}
            size={12}
            strokeWidth={1.8}
            className={tone}
          />
        )}
        <span className="text-[11.5px] font-semibold capitalize text-[var(--clack-text-1)]">
          {task.kind}
        </span>
        <span className={cn("text-[10px] capitalize", tone)}>{task.status}</span>
        <button
          type="button"
          disabled={!peer}
          onClick={() => peer && switchSession(peer.id)}
          className="ml-auto flex min-w-0 items-center gap-1 text-[10.5px] text-[var(--clack-text-3)] hover:text-[var(--clack-text-1)] disabled:pointer-events-none"
          title={peer ? `Open ${peer.title}` : "Peer conversation deleted"}
        >
          <span className="max-w-36 truncate">{peer?.title ?? "Deleted chat"}</span>
          <HugeiconsIcon icon={ArrowRight01Icon} size={10} strokeWidth={1.8} />
        </button>
      </div>
      <div className="space-y-2 px-2.5 py-2 text-[11px]">
        <p className="whitespace-pre-wrap text-[var(--clack-text-1)]">
          {task.prompt}
        </p>
        {task.artifactRefs.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {task.artifactRefs.map((ref) => (
              <span
                key={`${ref.kind}:${ref.path}`}
                className="max-w-full truncate rounded-[var(--clack-radius-button)] bg-[var(--clack-surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--clack-text-3)]"
                title={ref.path}
              >
                {ref.kind}: {ref.path}
              </span>
            ))}
          </div>
        ) : null}
        {task.result ? (
          <div className="max-h-40 overflow-auto border-t border-[color:var(--clack-border-subtle)] pt-2 whitespace-pre-wrap text-[var(--clack-text-2)]">
            {task.result.summary}
          </div>
        ) : task.error ? (
          <p className="border-t border-[color:var(--clack-border-subtle)] pt-2 text-destructive">
            {task.error.message}
          </p>
        ) : null}
        {task.changeSet ? (
          <div className="space-y-1.5 border-t border-[color:var(--clack-border-subtle)] pt-2">
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
                  {showPatch ? "Hide patch" : "Review patch"}
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
        <div className="flex items-center gap-2 text-[9.5px] text-[var(--clack-text-3)]">
          <span className="capitalize">
            {task.executionMode.replace(/-/g, " ")}
          </span>
          <span className="truncate">Agent: {task.targetAgentId}</span>
          <span className="truncate">Model: {task.targetModelId}</span>
          <span className="ml-auto font-mono">hop {task.hopCount}</span>
          {active ? (
            <button
              type="button"
              onClick={() => void cancelPeerTask(task.id)}
              className="text-[10px] hover:text-destructive"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
