import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PeerTask } from "@/modules/ai/lib/peerTasks";
import { applyPeerTaskChangeSet } from "@/modules/ai/lib/peerTaskCoordinator";
import {
  artifactFilePath,
  taskFailure,
  taskOutcomeLabel,
  taskRetryEligibility,
} from "@/modules/ai/lib/taskPresentation";
import {
  canAccessTaskResult,
  openTaskFile,
  readTaskArtifact,
  retryTaskWithoutEffects,
} from "@/modules/ai/lib/taskResultActions";
import { getChat, useChatStore } from "@/modules/ai/store/chatStore";
import { focusTaskConversationPane } from "@/modules/ai/store/dispatcherNavigation";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";

export function PeerTaskOutcome({
  task,
  sessionId,
  onOpenSession,
  onResultOpened,
}: {
  task: PeerTask;
  sessionId: string;
  onOpenSession?: (id: string) => void;
  onResultOpened?: () => void;
}) {
  const sessions = useChatStore((s) => s.sessions);
  const live = useChatStore((s) => s.live);
  const tasks = usePeerTaskStore((s) => s.tasks);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof readTaskArtifact>
  > | null>(null);
  const generation = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Transient results and in-flight callbacks must reset when their task/conversation owner changes.
  useEffect(() => {
    generation.current++;
    setPreview(null);
    setError("");
    setNotice("");
    setBusy(false);
    return () => {
      generation.current++;
    };
  }, [task.id, sessionId]);
  const accessible = canAccessTaskResult(task, sessionId);
  const target = sessions.find(
    (s) =>
      s.id === task.targetSessionId &&
      s.profile?.workspaceId === task.workspaceId,
  );
  const failure = taskFailure(task);
  const retryable =
    accessible &&
    !tasks.some(
      (t) =>
        t.targetSessionId === task.targetSessionId &&
        ["running", "queued", "waiting"].includes(t.status),
    ) &&
    taskRetryEligibility(
      task,
      target,
      getChat(task.targetSessionId)?.messages ?? [],
    );
  const action = async (work: () => Promise<unknown>) => {
    if (busy) return;
    const ticket = generation.current;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (err) {
      if (ticket === generation.current)
        setError(
          err instanceof Error ? err.message : "Task action unavailable.",
        );
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  };
  const openConversation = (id: string) => {
    if (onOpenSession) onOpenSession(id);
    else void useChatStore.getState().switchSession(id);
    focusTaskConversationPane(id);
  };
  const changeSet = task.changeSet;
  const openFile = async (input: Parameters<typeof openTaskFile>[2]) => {
    await openTaskFile(task.id, sessionId, input);
    onResultOpened?.();
  };
  return (
    <section
      aria-label="Task outcome"
      className="min-w-0 space-y-2 [overflow-wrap:anywhere]"
    >
      {changeSet && (
        <div className="space-y-2 border-b border-[var(--clack-border-subtle)] pb-2">
          <p className="font-semibold">{taskOutcomeLabel(task)}</p>
          <p className="text-[var(--clack-text-3)]">
            {changeSet.appliedAt
              ? "Applied to workspace"
              : task.executionMode === "isolated-worktree"
                ? "Isolated task changes; not yet applied to your workspace."
                : "Captured changes awaiting workspace review."}
          </p>
          <ul className="space-y-1">
            {changeSet.changedPaths.map((path) => (
              <li
                key={path}
                className="flex min-w-0 flex-wrap items-center gap-2"
              >
                <span className="min-w-0 flex-1 break-words font-mono">
                  {path}
                </span>
                {changeSet.appliedAt &&
                  accessible &&
                  live.openWorkspaceFile && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-auto max-w-full whitespace-normal text-xs"
                      disabled={busy}
                      onClick={() =>
                        void action(() => openFile({ changedPath: path }))
                      }
                    >
                      Open {path}
                    </Button>
                  )}
              </li>
            ))}
          </ul>
          {!changeSet.changedPaths.length && <p>No file changes</p>}
          {changeSet.patch && (
            <details>
              <summary className="cursor-pointer font-medium text-[var(--clack-accent)]">
                Review changes
              </summary>
              <textarea
                readOnly
                wrap="off"
                aria-label="Captured patch"
                className="mt-2 h-40 w-full min-w-0 resize-none overflow-auto bg-transparent font-mono text-[10px]"
                value={changeSet.patch}
              />
            </details>
          )}
          {changeSet.patch &&
            !changeSet.appliedAt &&
            accessible &&
            task.sourceSessionId === sessionId && (
              <Button
                size="sm"
                className="h-auto max-w-full whitespace-normal text-xs"
                disabled={
                  busy || ["running", "queued", "waiting"].includes(task.status)
                }
                onClick={() =>
                  void action(async () => {
                    if (!canAccessTaskResult(task, sessionId))
                      throw new Error("Task workspace unavailable.");
                    const result = await applyPeerTaskChangeSet(task.id);
                    if (!result.ok) throw new Error(result.message);
                  })
                }
              >
                {busy ? "Checking workspace..." : "Apply to workspace"}
              </Button>
            )}
          {changeSet.applyError && (
            <details>
              <summary className="cursor-pointer text-destructive">
                Apply failed: Details
              </summary>
              <p>{changeSet.applyError}</p>
            </details>
          )}
        </div>
      )}
      {task.status === "failed" && (
        <div className="space-y-2">
          <p role="status" className="font-medium text-destructive">
            {failure.title}
          </p>
          <p className="text-[var(--clack-text-3)]">{failure.detail}</p>
          <div className="flex flex-wrap gap-2">
            {failure.kind === "dirty" &&
              accessible &&
              live.openWorkspaceSourceControl && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-auto whitespace-normal text-xs"
                  onClick={() => {
                    if (canAccessTaskResult(task, sessionId))
                      live.openWorkspaceSourceControl?.();
                  }}
                >
                  View Source Control
                </Button>
              )}
            {failure.kind === "rate-limit" && retryable && (
              <Button
                size="sm"
                variant="outline"
                className="h-auto whitespace-normal text-xs"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const ticket = generation.current;
                    await retryTaskWithoutEffects(task.id, sessionId);
                    if (ticket === generation.current)
                      setNotice(
                        "New task attempt assigned; the failed record is retained.",
                      );
                  })
                }
              >
                Retry task
              </Button>
            )}
            {failure.kind === "rate-limit" && target && (
              <Button
                size="sm"
                variant="outline"
                className="h-auto whitespace-normal text-xs"
                onClick={() => openConversation(target.id)}
              >
                Open task chat to choose model
              </Button>
            )}
          </div>
          {failure.kind === "rate-limit" && !retryable && (
            <p className="text-[var(--clack-text-3)]">
              Retry unavailable until the task's effects and recovery state are
              reviewed.
            </p>
          )}
          <details>
            <summary className="cursor-pointer">Error details</summary>
            <p className="whitespace-pre-wrap">
              {task.error?.message ?? "Execution error unavailable"}
            </p>
            <p>{task.error?.code}</p>
          </details>
        </div>
      )}
      {task.result?.artifacts.map((artifact) => {
        const unavailable = task.recovery?.contentIssues?.some(
          (issue) =>
            issue.role === "returned" && issue.artifactId === artifact.id,
        );
        return (
          <div key={artifact.id} className="space-y-1">
            <p className="font-medium">
              Returned {artifact.displayName}
              {unavailable ? " - Unavailable" : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              {accessible && !unavailable && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-auto max-w-full whitespace-normal text-xs"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const ticket = generation.current;
                      const result = await readTaskArtifact(
                        task.id,
                        sessionId,
                        artifact.id,
                      );
                      if (ticket === generation.current) setPreview(result);
                    })
                  }
                >
                  View artifact: {artifact.displayName}
                </Button>
              )}
              {accessible &&
                !unavailable &&
                live.openWorkspaceFile &&
                artifactFilePath(task, artifact) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-auto max-w-full whitespace-normal text-xs"
                    disabled={busy}
                    onClick={() =>
                      void action(() => openFile({ artifactId: artifact.id }))
                    }
                  >
                    Open {artifact.displayName}
                  </Button>
                )}
            </div>
          </div>
        );
      })}
      {task.result?.summary.trim() && (
        <details>
          <summary className="cursor-pointer font-medium text-[var(--clack-accent)]">
            View result
          </summary>
          <section
            aria-label="Task textual result"
            className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap"
          >
            {task.result.summary}
          </section>
        </details>
      )}
      {task.status === "completed" &&
        !changeSet &&
        !task.result?.artifacts.length &&
        !task.result?.summary.trim() && <p>No files or artifacts returned</p>}
      {Boolean(changeSet || task.result?.artifacts.length) && !accessible && (
        <p className="text-[var(--clack-text-3)]">
          Open this task's workspace and owning conversation to access files or
          artifacts.
        </p>
      )}
      {preview && (
        <div className="space-y-1 border-t pt-2">
          <p className="font-medium">Immutable artifact: {preview.name}</p>
          <textarea
            readOnly
            aria-label="Immutable artifact preview"
            className="h-40 w-full min-w-0 resize-none overflow-auto bg-transparent font-mono text-xs"
            value={preview.text}
          />
          {preview.truncated && (
            <p>Preview truncated; original artifact retained.</p>
          )}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
