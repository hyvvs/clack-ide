import { create } from "zustand";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";
import {
  focusAiPaneElement,
  useAiPaneStore,
} from "@/modules/ai/store/aiPaneStore";

export const useDispatcherNavigation = create<{
  request: { taskId: string | null; sessionId: string | null; signal: number } | null;
}>(() => ({ request: null }));

export function viewAllTasksInDispatcher(): void {
  useDispatcherNavigation.setState(state => ({ request: { taskId: null, sessionId: null, signal: (state.request?.signal ?? 0) + 1 } }));
  useChatStore.getState().focusInput();
}

export function viewTaskInDispatcher(
  taskId: string,
  sessionId: string,
): boolean {
  const chat = useChatStore.getState();
  const session = chat.sessions.find((item) => item.id === sessionId);
  const task = usePeerTaskStore
    .getState()
    .tasks.find((item) => item.id === taskId);
  if (
    !task ||
    !session?.profile?.workspaceId ||
    task.workspaceId !== session.profile.workspaceId ||
    (task.sourceSessionId !== sessionId && task.targetSessionId !== sessionId)
  )
    return false;
  useDispatcherNavigation.setState((state) => ({
    request: { taskId, sessionId, signal: (state.request?.signal ?? 0) + 1 },
  }));
  chat.focusInput();
  return true;
}

export function focusTaskConversationPane(sessionId: string): void {
  const panes = useAiPaneStore.getState();
  panes.initialize(sessionId);
  const current = useAiPaneStore.getState();
  const existing = Object.entries(current.bindings).find(
    ([, owner]) => owner === sessionId,
  );
  const paneId = existing ? Number(existing[0]) : current.activePaneId;
  if (!existing && !current.bindSession(paneId, sessionId)) return;
  current.focusPane(paneId);
  useChatStore.getState().openMini();
  focusAiPaneElement(paneId);
}
