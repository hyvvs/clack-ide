import { useEffect } from "react";
import { dispatchPeerTask } from "../lib/peerTaskCoordinator";
import { selectDispatchablePeerTaskIds } from "../lib/peerTaskDependencies";
import { useChatStore } from "../store/chatStore";
import { usePeerTaskStore } from "../store/peerTaskStore";
import { pumpPeerCommunication } from "@/modules/ai/lib/peerCommunicationCoordinator";
import { subscribeInference } from "@/modules/ai/lib/inferenceLifecycle";
import { listen } from "@tauri-apps/api/event";
import { peerLedgerRevision } from "@/modules/ai/lib/peerTasks";

export function PeerTaskQueueBridge() {
  const hydrated = usePeerTaskStore((state) => state.hydrated);
  const recoveryReady = usePeerTaskStore((state) => state.recoveryReady);
  const tasks = usePeerTaskStore((state) => state.tasks);
  const hasPendingCommunication = tasks.some((task) =>
    task.communication?.some(
      (event) =>
        event.state === "queued" ||
        event.state === "delivered" ||
        (event.state === "acknowledged" &&
          event.kind === "clarification-request"),
    ),
  );
  const sessions = useChatStore((state) => state.sessions);
  const runtime = useChatStore((state) =>
    hasPendingCommunication ? state.runtimeBySession : null,
  );
  const sessionsHydrated = useChatStore((state) => state.sessionsHydrated);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = listen<number>(
      "clack:peer-ledger-changed",
      ({ payload }) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!disposed && payload > peerLedgerRevision())
            usePeerTaskStore.setState({
              recoveryReady: false,
              recoveryError:
                "Peer tasks changed in another window. Reload before dispatching new work.",
            });
        }, 100);
      },
    );
    return () => {
      disposed = true;
      clearTimeout(timer);
      void subscription.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !recoveryReady || !sessionsHydrated) return;
    if (hasPendingCommunication) void pumpPeerCommunication();
    const sessionState = new Map(
      sessions.map((session) => [session.id, session.run?.state]),
    );
    for (const taskId of selectDispatchablePeerTaskIds(tasks, sessionState)) {
      void dispatchPeerTask(taskId);
    }
  }, [
    hydrated,
    recoveryReady,
    sessions,
    sessionsHydrated,
    tasks,
    hasPendingCommunication,
  ]);

  useEffect(() => {
    if (runtime && recoveryReady) void pumpPeerCommunication();
  }, [runtime, recoveryReady]);

  useEffect(() => {
    if (!hydrated || !recoveryReady || !hasPendingCommunication) return;
    const unsubscribe = subscribeInference(() => {
      void pumpPeerCommunication();
    });
    const pending = tasks
      .flatMap((task) => task.communication ?? [])
      .filter(
        (event) =>
          event.state === "queued" ||
          event.state === "delivered" ||
          (event.state === "acknowledged" &&
            event.kind === "clarification-request"),
      );
    const deadline = pending.length
      ? Math.min(...pending.map((event) => event.deadline))
      : undefined;
    const timer =
      deadline === undefined
        ? undefined
        : setTimeout(
            () => {
              void pumpPeerCommunication();
            },
            Math.max(1, deadline - Date.now()),
          );
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [hydrated, recoveryReady, tasks, hasPendingCommunication]);

  return null;
}
