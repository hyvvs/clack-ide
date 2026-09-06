import { useCallback, useSyncExternalStore } from "react";
import {
  chats,
  isModelSelectionLocked,
  useChatStore,
} from "@/modules/ai/store/chatStore";

export function useModelSelectionLock(sessionId?: string): boolean {
  const targetId = useChatStore((state) => sessionId ?? state.activeSessionId);
  const locked = useChatStore((state) =>
    isModelSelectionLocked(targetId, state),
  );
  const chat = targetId ? chats.get(targetId) : undefined;
  const subscribe = useCallback(
    (onChange: () => void) =>
      chat?.["~registerStatusCallback"](onChange) ?? (() => {}),
    [chat],
  );
  const getSnapshot = useCallback(
    () => chat?.status === "submitted" || chat?.status === "streaming",
    [chat],
  );
  // Stop marks the run cancelled before the SDK finishes draining its request.
  const requestBusy = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return locked || requestBusy;
}
