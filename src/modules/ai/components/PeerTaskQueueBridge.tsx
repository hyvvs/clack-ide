import { useEffect } from "react";
import { dispatchPeerTask } from "../lib/peerTaskCoordinator";
import { useChatStore } from "../store/chatStore";
import { usePeerTaskStore } from "../store/peerTaskStore";

export function PeerTaskQueueBridge() {
  const hydrated = usePeerTaskStore((state) => state.hydrated);
  const tasks = usePeerTaskStore((state) => state.tasks);
  const sessions = useChatStore((state) => state.sessions);
  const sessionsHydrated = useChatStore((state) => state.sessionsHydrated);

  useEffect(() => {
    if (!hydrated || !sessionsHydrated) return;
    const sessionState = new Map(
      sessions.map((session) => [session.id, session.run?.state]),
    );
    for (const task of tasks) {
      if (task.status !== "queued") continue;
      if (sessionState.get(task.targetSessionId) === "running") continue;
      void dispatchPeerTask(task.id);
    }
  }, [hydrated, sessions, sessionsHydrated, tasks]);

  return null;
}
