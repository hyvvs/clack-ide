import { listen } from "@tauri-apps/api/event";
import type { SessionMeta } from "@/modules/ai/lib/sessions";
import { useChatStore } from "@/modules/ai/store/chatStore";

export function applyCommittedModelSwitch(saved: SessionMeta) {
  useChatStore.setState((state) => {
    const current = state.sessions.find((session) => session.id === saved.id);
    if (!current || (current.modelRevision ?? 0) >= (saved.modelRevision ?? 0))
      return state;
    return {
      sessions: state.sessions.map((session) =>
        session.id === saved.id ? saved : session,
      ),
      ...(state.activeSessionId === saved.id
        ? { selectedModelId: saved.profile?.modelId ?? state.selectedModelId }
        : {}),
    };
  });
}

export function applyCommittedFallback(saved: SessionMeta) {
  useChatStore.setState((state) => ({
    sessions: state.sessions.map((current) =>
      current.id === saved.id &&
      (current.modelRevision ?? 0) < (saved.modelRevision ?? 0)
        ? {
            ...current,
            fallback: saved.fallback,
            modelRevision: saved.modelRevision,
            updatedAt: Math.max(current.updatedAt, saved.updatedAt),
          }
        : current,
    ),
  }));
}

let subscription: Promise<unknown> | undefined;
let fallbackSubscription: Promise<unknown> | undefined;
export function synchronizeModelSwitches() {
  fallbackSubscription ??= listen<SessionMeta>(
    "clack:fallback",
    ({ payload }) => applyCommittedFallback(payload),
  ).catch(() => {
    fallbackSubscription = undefined;
  });
  subscription ??= listen<SessionMeta>("clack:model-switch", ({ payload }) =>
    applyCommittedModelSwitch(payload),
  ).catch(() => {
    subscription = undefined;
  });
  return Promise.all([subscription, fallbackSubscription]);
}
