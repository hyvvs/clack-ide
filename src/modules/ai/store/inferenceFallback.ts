import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  hasKeyForModel,
  inferenceScopeForSession,
  useChatStore,
} from "@/modules/ai/store/chatStore";
import { applyCommittedFallback } from "@/modules/ai/store/modelSwitchSync";
import {
  awaitSessionWrites,
  type SessionMeta,
} from "@/modules/ai/lib/sessions";
import { resolveModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import {
  effectiveFallback,
  fallbackCompatibility,
  sameDestination,
  type FallbackDestination,
  type FallbackRequest,
} from "@/modules/ai/lib/inferenceFallback";
import { readSelfHostedSnapshot } from "@/modules/ai/lib/selfHostedCapabilities";
import { resolveModelInputCapabilities } from "@/modules/ai/lib/modelCapabilities";
import { normalizeAiError } from "@/modules/ai/lib/errors";
import { waitForInferenceSettlement } from "@/modules/ai/lib/inferenceLifecycle";
import type { PrepareFallback } from "@/modules/ai/lib/transport";
import type { ModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";

const CLOUD_BASES: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  xai: "https://api.x.ai/v1",
  cerebras: "https://api.cerebras.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com",
  mistral: "https://api.mistral.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

export async function describeFallbackDestination(
  modelId: string,
  captured?: ModelTransportIdentity,
): Promise<FallbackDestination> {
  const settings = usePreferencesStore.getState();
  const identity = captured ?? resolveModelTransportIdentity(modelId, settings);
  const baseUrl =
    identity.endpointBaseURL ??
    CLOUD_BASES[identity.providerId] ??
    {
      lmstudio: settings.lmstudioBaseURL,
      mlx: settings.mlxBaseURL,
      ollama: settings.ollamaBaseURL,
    }[identity.providerId as "lmstudio" | "mlx" | "ollama"];
  if (!baseUrl) throw new Error("Fallback destination is not configured.");
  return invoke("conversation_fallback_describe", {
    modelId,
    identity,
    baseUrl: baseUrl.replace(/\/+$/, ""),
  });
}

export async function setFallbackPolicy(
  sessionId: string,
  mode: "never" | "ask" | "trusted",
  modelId?: string,
  preview?: FallbackDestination | null,
) {
  await awaitSessionWrites(sessionId);
  const session = useChatStore
    .getState()
    .sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error("Chat is unavailable.");
  if (mode !== "never" && !session.profile?.modelId) throw new Error("Chat model is unavailable.");
  const primary =
    mode === "never"
      ? null
      : await describeFallbackDestination(session.profile?.modelId ?? "");
  const destination =
    mode === "never" ? null : await describeFallbackDestination(modelId ?? "");
  if (destination && (!preview || !sameDestination(destination, preview)))
    throw new Error(
      "Destination changed since preview. Review it again before granting consent.",
    );
  if (primary && destination && sameDestination(primary, destination))
    throw new Error("Choose a different fallback destination.");
  const saved = await invoke<SessionMeta>("conversation_fallback_set", {
    update: {
      owner: { sessionId, workspaceId: session.profile?.workspaceId ?? null },
      expectedRevision: effectiveFallback(session.fallback)?.revision ?? 0,
      mode,
      primary,
      destination,
    },
  });
  applyCommittedFallback(saved);
  resolveFallbackProposal(sessionId, false);
}

export type FallbackProposal = {
  id: string;
  primary: FallbackDestination;
  destination: FallbackDestination;
  reason: string;
};
export const useFallbackProposals = create<{
  proposals: Record<string, FallbackProposal | undefined>;
}>(() => ({ proposals: {} }));
const answers = new Map<string, (approved: boolean) => void>();

export function resolveFallbackProposal(
  sessionId: string,
  approved: boolean,
  id?: string,
) {
  if (id && useFallbackProposals.getState().proposals[sessionId]?.id !== id)
    return;
  answers.get(sessionId)?.(approved);
}

export function requestFallbackApproval(
  sessionId: string,
  proposal: FallbackProposal,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  resolveFallbackProposal(sessionId, false);
  return new Promise((resolve) => {
    const finish = (approved: boolean) => {
      if (answers.get(sessionId) !== finish) return;
      answers.delete(sessionId);
      signal?.removeEventListener("abort", abort);
      useFallbackProposals.setState((state) => ({
        proposals: { ...state.proposals, [sessionId]: undefined },
      }));
      resolve(approved);
    };
    const abort = () => finish(false);
    answers.set(sessionId, finish);
    signal?.addEventListener("abort", abort, { once: true });
    useFallbackProposals.setState((state) => ({
      proposals: { ...state.proposals, [sessionId]: proposal },
    }));
  });
}

export function prepareSessionFallback(sessionId: string): PrepareFallback {
  return async (input) => {
    const session = useChatStore
      .getState()
      .sessions.find((s) => s.id === sessionId);
    const policy = effectiveFallback(session?.fallback);
    const scope = inferenceScopeForSession(sessionId);
    if (
      !session?.run ||
      !scope ||
      !policy ||
      policy.mode === "never" ||
      !policy.primary ||
      !policy.destination
    )
      return null;
    const run = session.run;
    if (
      run.peerTaskId ||
      run.state !== "running" ||
      !input.primary.modelId ||
      policy.agentId !== (run.agentId ?? null) ||
      policy.workspaceId !== (session.profile?.workspaceId ?? null)
    )
      return null;
    await waitForInferenceSettlement(scope);
    input.signal?.throwIfAborted();
    const primary = await describeFallbackDestination(
      input.primary.modelId,
      input.primary.capturedModelIdentity,
    );
    const destination = await describeFallbackDestination(
      policy.destination.modelId,
    );
    if (
      !sameDestination(primary, policy.primary) ||
      !sameDestination(destination, policy.destination)
    )
      throw new Error(
        "Fallback consent no longer matches the primary or destination configuration. Review the chat's fallback policy.",
      );
    if (!hasKeyForModel(destination.modelId))
      throw new Error("Fallback credentials or model are unavailable.");
    const profiles = structuredClone(
      usePreferencesStore.getState().selfHostedInference,
    );
    const capabilities = resolveModelInputCapabilities(
      destination.modelId,
      profiles,
      await readSelfHostedSnapshot(profiles, destination.modelId),
    );
    const request: FallbackRequest = {
      primary,
      messages: input.originals,
      requirements: input.requirements,
      reasoning: input.primary.reasoning,
      error: input.error,
      signal: input.signal,
    };
    const reasoning = fallbackCompatibility(
      request,
      destination,
      capabilities,
      profiles,
    );
    await awaitSessionWrites(sessionId);
    const sourceHash = await invoke<string>("conversation_fallback_boundary", {
      owner: { sessionId, workspaceId: session.profile?.workspaceId ?? null },
      runId: run.startedAt,
    });
    if (policy.mode === "ask") {
      const unsubscribe = useChatStore.subscribe(() => {
        const current = useChatStore
          .getState()
          .sessions.find((s) => s.id === sessionId);
        if (
          !scope.isCurrent() ||
          effectiveFallback(current?.fallback)?.revision !== policy.revision
        )
          resolveFallbackProposal(sessionId, false);
      });
      try {
        if (
          !(await requestFallbackApproval(
            sessionId,
            {
              id: crypto.randomUUID(),
              primary,
              destination,
              reason: normalizeAiError(input.error).kind,
            },
            input.signal,
          ))
        )
          return null;
      } finally {
        unsubscribe();
      }
    }
    const validateRouting = async () => {
      input.signal?.throwIfAborted();
      const currentSession = useChatStore
        .getState()
        .sessions.find((s) => s.id === sessionId);
      const currentPolicy = effectiveFallback(currentSession?.fallback);
      const preferences = usePreferencesStore.getState();
      if (
        input.requirements.permissions !== undefined &&
        input.requirements.permissions !==
          JSON.stringify([
            preferences.agentPermissionProfiles,
            preferences.agentWorkspacePermissions,
          ])
      )
        throw new Error(
          "Fallback permission snapshot changed. Send a new instruction.",
        );
      if (
        !scope.isCurrent() ||
        currentSession?.run?.startedAt !== run.startedAt ||
        currentSession.profile?.workspaceId !== session.profile?.workspaceId ||
        currentSession.run?.agentId !== run.agentId ||
        currentPolicy?.revision !== policy.revision ||
        currentPolicy.mode === "never" ||
        !sameDestination(
          await describeFallbackDestination(primary.modelId),
          primary,
        ) ||
        !sameDestination(
          await describeFallbackDestination(destination.modelId),
          destination,
        )
      )
        throw new Error(
          "Fallback consent was revoked or its captured request changed.",
        );
    };
    await validateRouting();
    await awaitSessionWrites(sessionId);
    const approved = await invoke<{ token: string; session: SessionMeta }>(
      "conversation_fallback_begin",
      {
        begin: {
          owner: {
            sessionId,
            workspaceId: session.profile?.workspaceId ?? null,
          },
          runId: run.startedAt,
          revision: policy.revision,
          primary,
          destination,
          approvedOnce: policy.mode === "ask",
          sourceHash,
        },
      },
    );
    applyCommittedFallback(approved.session);
    await validateRouting();
    const preferences = usePreferencesStore.getState();
    return {
      capabilities,
      configuration: {
        ...Object.fromEntries(
          [
            "lmstudioBaseURL",
            "lmstudioModelId",
            "mlxBaseURL",
            "mlxModelId",
            "ollamaBaseURL",
            "ollamaModelId",
            "openaiCompatibleBaseURL",
            "openaiCompatibleModelId",
            "openaiCompatibleContextLimit",
            "openrouterModelId",
          ].map((key) => [key, preferences[key as keyof typeof preferences]]),
        ),
        modelId: destination.modelId,
        capturedModelIdentity: structuredClone(destination.identity),
        reasoning,
        keys: structuredClone(useChatStore.getState().apiKeys),
        customEndpointKeys: structuredClone(
          useChatStore.getState().customEndpointKeys,
        ),
        customEndpoints: structuredClone(preferences.customEndpoints),
        savedProviderModels: structuredClone(preferences.savedProviderModels),
        selfHostedInference: profiles,
        inferenceScope: { ...scope, fallbackToken: approved.token },
        validateRouting,
        mandatoryTools: input.requirements.tools,
        requiredOutput: input.requirements.output,
      },
    };
  };
}
