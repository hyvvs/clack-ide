import type { UIMessage } from "ai";
import { ActivityTimeline } from "@/modules/ai/components/ActivityTimeline";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { chatActivityLabel } from "@/modules/ai/lib/chatActivityLabel";
import { useInferenceLifecycle } from "@/modules/ai/hooks/useInferenceLifecycle";
import { inferenceLabel } from "@/modules/ai/lib/inferenceLifecycle";

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
  const meta = useChatStore(s => s.runtimeBySession[sessionId]);
  const inference = useInferenceLifecycle(sessionId);
  return (
    <ActivityTimeline
      key={sessionId}
      sessionId={sessionId}
      messages={messages}
      tasks={tasks}
      workspaceId={session?.profile?.workspaceId ?? null}
      run={session?.run}
      statusLabel={inference && session?.run?.state === "running" ? inferenceLabel(inference) : chatActivityLabel(session?.run, meta)}
    />
  );
}
