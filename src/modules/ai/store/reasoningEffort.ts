import { invoke } from "@tauri-apps/api/core";
import { captureEffort } from "@/modules/ai/lib/reasoningEffort";
import { resolveModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import {
  awaitSessionWrites,
  type SessionMeta,
} from "@/modules/ai/lib/sessions";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  isModelSelectionLocked,
  pendingEffortWrites,
  useChatStore,
} from "@/modules/ai/store/chatStore";
import { applyCommittedModelSwitch } from "@/modules/ai/store/modelSwitchSync";

export function sessionEffort(session: SessionMeta) {
  const preferences = usePreferencesStore.getState();
  const model = session.profile?.modelId;
  if (!model) throw new Error("Select a model first.");
  return captureEffort(
    model,
    resolveModelTransportIdentity(model, preferences),
    session.effortPreferences,
    preferences.selfHostedInference,
  );
}

export async function setSessionEffort(sessionId: string, choice: string) {
  if (isModelSelectionLocked(sessionId))
    throw new Error("Effort is locked until this run stops completely.");
  const session = useChatStore
    .getState()
    .sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error("Chat unavailable.");
  const captured = sessionEffort(session);
  if (choice !== "automatic" && !captured.capability.levels.includes(choice))
    throw new Error(
      "This effort is not supported by the selected model and API.",
    );
  pendingEffortWrites.add(sessionId);
  useChatStore.setState({ ...useChatStore.getState() });
  try {
    await awaitSessionWrites(sessionId);
    if (
      useChatStore.getState().sessions.find((s) => s.id === sessionId) !==
        session ||
      JSON.stringify(sessionEffort(session)) !== JSON.stringify(captured)
    )
      throw new Error("Chat or model settings changed. Select effort again.");
    const saved = await invoke<SessionMeta>("conversation_effort_set", {
      update: {
        owner: { sessionId, workspaceId: session.profile?.workspaceId ?? null },
        expectedSession: session,
        key: captured.key,
        choice,
        revision: captured.capability.revision,
      },
    });
    applyCommittedModelSwitch(saved);
  } finally {
    pendingEffortWrites.delete(sessionId);
    useChatStore.setState({ ...useChatStore.getState() });
  }
}
