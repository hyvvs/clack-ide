import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Archive02Icon,
  ArrowTurnBackwardIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import type { PeerTask } from "@/modules/ai/lib/peerTasks";
import { taskArchiveEligible } from "@/modules/ai/lib/taskArchive";
import {
  canAccessTaskResult,
  setTaskArchived,
} from "@/modules/ai/lib/taskResultActions";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";

export function TaskArchiveAction({
  task,
  sessionId,
  onChanged,
}: {
  task: PeerTask;
  sessionId: string;
  onChanged?: () => void;
}) {
  useChatStore((s) => s.sessions);
  useChatStore((s) => s.live);
  const tasks = usePeerTaskStore((s) => s.tasks);
  const managing = usePeerTaskStore((s) => s.managingTaskIds);
  const retrying = usePeerTaskStore((s) => s.retryingTaskIds);
  const ready = usePeerTaskStore((s) => s.recoveryReady);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (
    !canAccessTaskResult(task, sessionId) ||
    (!task.archivedAt &&
      !taskArchiveEligible(task, tasks, [...managing, ...retrying]))
  )
    return null;
  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="ghost"
        aria-label={task.archivedAt ? "Restore task" : "Archive task"}
        className="h-auto max-w-full whitespace-normal text-xs"
        disabled={busy || !ready}
        onClick={() => {
          setBusy(true);
          setError("");
          void setTaskArchived(task.id, sessionId, !task.archivedAt)
            .then(onChanged)
            .catch((e) => setError(String(e)))
            .finally(() => setBusy(false));
        }}
      >
        <HugeiconsIcon
          icon={task.archivedAt ? ArrowTurnBackwardIcon : Archive02Icon}
          size={14}
        />
        {task.archivedAt ? "Restore" : "Archive"}
      </Button>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
