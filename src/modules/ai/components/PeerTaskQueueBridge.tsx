import { useEffect } from "react";
import { dispatchPeerTask } from "../lib/peerTaskCoordinator";
import { selectDispatchablePeerTaskIds } from "../lib/peerTaskDependencies";
import { useChatStore } from "../store/chatStore";
import { usePeerTaskStore } from "../store/peerTaskStore";

export function PeerTaskQueueBridge() {
  const hydrated = usePeerTaskStore((state) => state.hydrated);
  const recoveryReady = usePeerTaskStore((state) => state.recoveryReady);
  const tasks = usePeerTaskStore((state) => state.tasks);
  const sessions = useChatStore((state) => state.sessions);
  const sessionsHydrated = useChatStore((state) => state.sessionsHydrated);

  useEffect(() => {
    if (!hydrated || !recoveryReady || !sessionsHydrated) return;
    const sessionState = new Map(
      sessions.map((session) => [session.id, session.run?.state]),
    );
    for (const taskId of selectDispatchablePeerTaskIds(tasks, sessionState)) {
      void dispatchPeerTask(taskId);
    }
  }, [hydrated, recoveryReady, sessions, sessionsHydrated, tasks]);

  return null;
}
