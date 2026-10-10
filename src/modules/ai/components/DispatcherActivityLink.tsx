import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";
import { availableDispatcherTasks } from "@/modules/ai/lib/dispatcherTasks";
import { isPeerTaskActive } from "@/modules/ai/lib/peerTaskCancellation";
import { viewAllTasksInDispatcher } from "@/modules/ai/store/dispatcherNavigation";

export function DispatcherActivityLink() {
  const tasks = usePeerTaskStore((s) => s.tasks);
  const sessions = useChatStore((s) => s.sessions);
  const count = availableDispatcherTasks(tasks, sessions).filter(
    isPeerTaskActive,
  ).length;
  const runningChats = sessions.filter(
    (session) => session.run?.state === "running",
  ).length;
  return (
    <button
      type="button"
      onClick={viewAllTasksInDispatcher}
      aria-label={`View all tasks in Dispatcher. ${count} active tasks; ${runningChats} running chats.`}
      title="View all tasks in Dispatcher"
      className="min-w-0 truncate rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-1"
    >
      Dispatcher
      {count > 0 || runningChats > 0
        ? ` (${count} tasks, ${runningChats} chats)`
        : ""}
    </button>
  );
}
