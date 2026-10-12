import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";
import { useInferenceLifecycle } from "@/modules/ai/hooks/useInferenceLifecycle";
import { dispatcherTaskStatus } from "@/modules/ai/lib/dispatcherTasks";
import type { PeerTask } from "@/modules/ai/lib/peerTasks";

export function usePeerTaskStatus(task: PeerTask): string {
  const run = useChatStore(
    (s) =>
      s.sessions.find((session) => session.id === task.targetSessionId)?.run,
  );
  const approvals = useChatStore(
    (s) => s.runtimeBySession[task.targetSessionId]?.approvalsPending ?? 0,
  );
  const managing = usePeerTaskStore((s) => s.managingTaskIds.includes(task.id));
  const inference = useInferenceLifecycle(task.targetSessionId);
  const owned = run?.peerTaskId === task.id && run.state === "running";
  const current =
    owned &&
    inference?.scope?.runId === `${task.targetSessionId}:${run.startedAt}`
      ? inference
      : null;
  return dispatcherTaskStatus(task, current, {
    preparing: !task.handoff || !owned,
    approval: owned && approvals > 0,
    applying: managing && !!task.changeSet?.patch && !task.changeSet.appliedAt,
    finalizing: run?.peerTaskId === task.id && run.state !== "running",
  });
}
