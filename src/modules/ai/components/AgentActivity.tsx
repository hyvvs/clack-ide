import type { UIMessage } from "ai";
import { ActivityTimeline } from "@/modules/ai/components/ActivityTimeline";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";
import { useChatStore } from "@/modules/ai/store/chatStore";

export function AgentActivity({
  sessionId,
  messages,
}: {
  sessionId: string;
  messages: UIMessage[];
}) {
  const session = useChatStore((s) =>
    s.sessions.find((item) => item.id === sessionId),
  );
  const tasks = usePeerTaskStore((s) => s.tasks);
  return (
    <ActivityTimeline
      key={sessionId}
      sessionId={sessionId}
      messages={messages}
      tasks={tasks}
      workspaceId={session?.profile?.workspaceId ?? null}
      run={session?.run}
    />
  );
}
