import { useEffect, useState } from "react";
import { firePendingReviewForSession } from "@/modules/agents/lib/review";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { onKeysChanged } from "@/modules/settings/store";
import {
  getAllCustomEndpointKeys,
  getAllKeys,
  hasAnyKey,
} from "../lib/keyring";
import { useAgentsStore } from "../store/agentsStore";
import { useChatStore } from "../store/chatStore";
import { useSnippetsStore } from "../store/snippetsStore";
import { resolveRestoredModel } from "../lib/providerRestore";
import { usePeerTaskStore } from "../store/peerTaskStore";
import { hasKeyForModel } from "../store/chatStore";
import { savedSelfHostedModelInfos } from "@/modules/ai/lib/selfHostedModels";

/**
 * Startup wiring for the AI subsystem: loads provider keys (and keeps them in
 * sync), hydrates the preference store and mirrors the default model, hydrates
 * chat/agents/snippets stores, and fires any pending review for the active
 * session. Returns the two derived flags the shell needs.
 */
export function useAiBootstrap(): {
  hasComposer: boolean;
  keysLoaded: boolean;
} {
  const apiKeys = useChatStore((s) => s.apiKeys);
  const setApiKeys = useChatStore((s) => s.setApiKeys);
  const setCustomEndpointKeys = useChatStore((s) => s.setCustomEndpointKeys);
  const setSelectedModelId = useChatStore((s) => s.setSelectedModelId);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const hydrateSessions = useChatStore((s) => s.hydrateSessions);

  useEffect(() => {
    if (activeSessionId) firePendingReviewForSession(activeSessionId);
  }, [activeSessionId]);

  const lmstudioModelId = usePreferencesStore((s) => s.lmstudioModelId);
  const lmstudioBaseURL = usePreferencesStore((s) => s.lmstudioBaseURL);
  const mlxModelId = usePreferencesStore((s) => s.mlxModelId);
  const mlxBaseURL = usePreferencesStore((s) => s.mlxBaseURL);
  const ollamaModelId = usePreferencesStore((s) => s.ollamaModelId);
  const ollamaBaseURL = usePreferencesStore((s) => s.ollamaBaseURL);
  const openaiCompatibleModelId = usePreferencesStore(
    (s) => s.openaiCompatibleModelId,
  );
  const openaiCompatibleBaseURL = usePreferencesStore(
    (s) => s.openaiCompatibleBaseURL,
  );
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);
  const selfHostedInference = usePreferencesStore((s) => s.selfHostedInference);
  const openrouterModelId = usePreferencesStore((s) => s.openrouterModelId);
  const savedProviderModels = usePreferencesStore((s) => s.savedProviderModels);
  const lastUsedProviderId = usePreferencesStore((s) => s.lastUsedProviderId);
  const lastUsedModelId = usePreferencesStore((s) => s.lastUsedModelId);
  const hasLocalModel =
    savedSelfHostedModelInfos(selfHostedInference).length > 0 ||
    (lmstudioBaseURL.trim().length > 0 && lmstudioModelId.trim().length > 0) ||
    (mlxBaseURL.trim().length > 0 && mlxModelId.trim().length > 0) ||
    (ollamaBaseURL.trim().length > 0 && ollamaModelId.trim().length > 0) ||
    (openaiCompatibleBaseURL.trim().length > 0 &&
      openaiCompatibleModelId.trim().length > 0) ||
    customEndpoints.some(
      (e) => e.baseURL.trim().length > 0 && e.modelId.trim().length > 0,
    );
  const hasComposer = hasAnyKey(apiKeys) || hasLocalModel;

  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const [keysLoaded, setKeysLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    const reload = () => {
      void getAllKeys().then((keys) => {
        if (!alive) return;
        setApiKeys(keys);
        setKeysLoaded(true);
      });
      if (!prefsHydrated) return;
      void getAllCustomEndpointKeys(
        [
          ...new Set([
            ...usePreferencesStore.getState().customEndpoints.map((e) => e.id),
            ...usePreferencesStore
              .getState()
              .selfHostedInference.endpoints.flatMap((e) =>
                e.deletedAt === undefined &&
                e.credentialRef?.kind === "custom-endpoint"
                  ? [e.credentialRef.endpointId]
                  : [],
              ),
          ]),
        ].map((id) => ({ id })),
      ).then((epKeys) => {
        if (!alive) return;
        setCustomEndpointKeys(epKeys);
      });
    };
    reload();
    const unlistenP = onKeysChanged(reload);
    return () => {
      alive = false;
      void unlistenP.then((fn) => fn());
    };
  }, [setApiKeys, setCustomEndpointKeys, prefsHydrated]);

  // Hydrate preferences, then restore only a selection that is still usable.
  const initPrefs = usePreferencesStore((s) => s.init);
  const prefDefaultModel = usePreferencesStore((s) => s.defaultModelId);
  useEffect(() => {
    void initPrefs();
  }, [initPrefs]);
  useEffect(() => {
    if (!prefsHydrated || !keysLoaded) return;
    const restored = resolveRestoredModel({
      selfHostedInference,
      apiKeys,
      defaultModelId: prefDefaultModel,
      lastUsedProviderId,
      lastUsedModelId,
      lmstudioBaseURL,
      lmstudioModelId,
      mlxBaseURL,
      mlxModelId,
      ollamaBaseURL,
      ollamaModelId,
      openaiCompatibleBaseURL,
      openaiCompatibleModelId,
      openrouterModelId,
      customEndpoints,
      savedProviderModels,
    });
    if (restored) setSelectedModelId(restored, false);
  }, [
    apiKeys,
    customEndpoints,
    keysLoaded,
    lastUsedModelId,
    lastUsedProviderId,
    lmstudioBaseURL,
    lmstudioModelId,
    mlxBaseURL,
    mlxModelId,
    ollamaBaseURL,
    ollamaModelId,
    openaiCompatibleBaseURL,
    openaiCompatibleModelId,
    openrouterModelId,
    prefDefaultModel,
    prefsHydrated,
    savedProviderModels,
    selfHostedInference,
    setSelectedModelId,
  ]);

  useEffect(() => {
    if (!prefsHydrated || !keysLoaded) return;
    void (async () => {
      await useAgentsStore.getState().hydrate();
      await hydrateSessions();
      await usePeerTaskStore.getState().hydrate({
        sessions: useChatStore.getState().sessions,
        isAgentConfigured: (agentId) =>
          useAgentsStore
            .getState()
            .all()
            .some((agent) => agent.id === agentId),
        isModelConfigured: hasKeyForModel,
      });
    })();
  }, [hydrateSessions, keysLoaded, prefsHydrated]);

  useEffect(() => {
    void useSnippetsStore.getState().hydrate();
  }, []);

  return { hasComposer, keysLoaded };
}
