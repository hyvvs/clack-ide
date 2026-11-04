import { invoke } from "@tauri-apps/api/core";
import { streamText } from "ai";
import {
  runContextCalibration,
  type ContextCalibrationOptions,
} from "@/modules/ai/lib/contextCalibration";
import { CONTEXT_CALIBRATION } from "@/modules/ai/lib/contextCalibrationSchema";
import { trustedContext } from "@/modules/ai/lib/contextCalibrationTrust";
import { inspectContextRuntime } from "@/modules/ai/lib/contextRuntimeClient";
import {
  resolveSelfHostedSelection,
  readSelfHostedState,
  endpointBackend,
} from "@/modules/ai/lib/selfHostedProfiles";
import { createSelfHostedProbeClient } from "@/modules/ai/lib/selfHostedProbe";
import {
  endpointAllowsPrivate,
  selfHostedCredential,
  selfHostedTransportIdentity,
  selfHostedSelectionId,
  compatibleServerBaseURL,
} from "@/modules/ai/lib/selfHostedModels";
import { endpointInferenceAdmission } from "@/modules/ai/lib/inferenceAdmission";
import {
  beginInference,
  cancelSessionInference,
  type InferenceScope,
} from "@/modules/ai/lib/inferenceLifecycle";
import {
  EMPTY_PROVIDER_KEYS,
  getKey,
  getCustomEndpointKey,
} from "@/modules/ai/lib/keyring";
import { updateSelfHostedProfiles } from "@/modules/settings/store";
import { waitForRecovery } from "@/modules/ai/lib/providerRetry";
import { useContextCalibrationJobs } from "@/modules/ai/store/contextCalibrationJobs";
import { usePreferencesStore } from "@/modules/settings/preferences";

const flights = new Map<
  string,
  Promise<Awaited<ReturnType<typeof runContextCalibration>>>
>();
function synchronize(state: ContextCalibrationOptions["state"]) {
  if (
    usePreferencesStore.getState().selfHostedInference.revision <=
    state.revision
  )
    usePreferencesStore.setState({ selfHostedInference: state });
  return state;
}
export async function calibrateModelContext(
  options: ContextCalibrationOptions & {
    scope?: InferenceScope;
    /** Optional observation only; failures never alter calibration. */
    onBoundary?: (stage: string) => void;
  },
) {
  const boundary = (stage: string) => {
    try { options.onBoundary?.(stage); } catch { /* diagnostics cannot affect trust */ }
  };
  const profile = options.state.profiles.find(
    (p) => p.id === options.profileId,
  );
  const endpoint = options.state.endpoints.find(
    (e) => e.id === profile?.endpointId && e.deletedAt == null,
  );
  if (!profile || !endpoint) throw new Error("Model unavailable");
  if (!options.force && trustedContext(options.state, profile) &&
      options.renewalTier === undefined) return profile.contextCalibration;
  const existing = flights.get(endpoint.id);
  if (existing) {
    await waitForRecovery(existing, options.signal);
    return;
  }
  const owner = crypto.randomUUID(),
    controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const sessionId = `context-calibration:${owner}`;
  const scope: InferenceScope = options.scope ?? {
    sessionId,
    runId: owner,
    label: "Verifying context",
    isCurrent: () => !signal.aborted,
  };
  const operation = beginInference(scope, () => controller.abort());
  const setJob = (context?: number) =>
    useContextCalibrationJobs.setState((s) => ({
      jobs: {
        ...s.jobs,
        [endpoint.id]: { profileId: profile.id, controller, context },
      },
    }));
  setJob();
  let claimed = false;
  const client = createSelfHostedProbeClient();
  const refresh = async () => {
    boundary("metadata-refresh-start");
    try {
    const snapshot = await client.refresh({
      endpointId: endpoint.id,
      selectedModelId: profile.transportModelId,
      allowPrivateNetwork: endpointAllowsPrivate(endpoint),
    });
    const state = readSelfHostedState(
      new Map(
        await invoke<[string, unknown][]>("self_hosted_profiles_snapshot"),
      ).get("selfHostedInference"),
    );
    const current = state.profiles.find((p) => p.id === profile.id),
      server = state.endpoints.find((e) => e.id === endpoint.id);
    if (
      !current ||
      current.modelRevision !== profile.modelRevision ||
      server?.configurationRevision !== endpoint.configurationRevision
    )
      throw new Error("Context verification identity changed");
    synchronize(state);
    boundary("metadata-refresh-end");
    return { snapshot, state };
    } catch (error) { boundary("metadata-refresh-failed"); throw error; }
  };
  const work = (async () => {
    await invoke("self_hosted_context_lease", {
      endpointId: endpoint.id,
      owner,
      release: false,
    });
    claimed = true;
    signal.throwIfAborted();
    return runContextCalibration(
      {
        ...options,
        signal,
        onProgress: (record) => {
          setJob(record.attempts[record.attempts.length - 1]?.context);
          options.onProgress?.(record);
        },
      },
      {
        refresh,
        inspectRuntime: async () => {
          boundary("runtime-inspection-start");
          try {
            await inspectContextRuntime(endpoint, true);
            boundary("runtime-inspection-end");
          } catch (error) { boundary("runtime-inspection-failed"); throw error; }
        },
        commit: async (change) =>
          synchronize(await updateSelfHostedProfiles(change)),
        request: async (context, state, abortSignal) => {
          setJob(context);
          const keys = { ...EMPTY_PROVIDER_KEYS };
          if (endpoint.credentialRef?.kind === "provider")
            keys[endpoint.credentialRef.providerId] = await getKey(
              endpoint.credentialRef.providerId,
            );
          const endpointKeys =
            endpoint.credentialRef?.kind === "custom-endpoint"
              ? {
                  [endpoint.credentialRef.endpointId]:
                    await getCustomEndpointKey(
                      endpoint.credentialRef.endpointId,
                    ),
                }
              : {};
          const identity = selfHostedTransportIdentity(
            selfHostedSelectionId(profile),
            state,
          );
          if (identity?.providerId !== "ollama")
            throw new Error(
              "Context calibration unsupported for this provider",
            );
          const { buildLanguageModel } = await import("@/modules/ai/lib/agent");
          const model = await buildLanguageModel(
            "ollama",
            EMPTY_PROVIDER_KEYS,
            profile.transportModelId,
            {
              selfHosted: true,
              selfHostedInference: state,
              calibrationContext: context,
              inferenceScope: {
                sessionId,
                runId: owner,
                label: "Verifying context",
                isCurrent: () => !abortSignal.aborted,
              },
              admission: endpointInferenceAdmission(
                endpoint.id,
                profile.id,
                state,
              ),
              allowPrivateNetwork: endpointAllowsPrivate(endpoint),
              ollamaBaseURL: endpoint.baseURL,
              openaiCompatibleBaseURL: compatibleServerBaseURL(endpoint),
              calibration: {
                requestClass: "optimization",
                record: () => {},
                onStreamBoundary: boundary,
                onProxyBoundary: boundary,
                onQueued: () =>
                  controller.abort(
                    new Error("Server busy; verification deferred"),
                  ),
              },
            },
            selfHostedCredential(identity, keys, endpointKeys),
          );
          abortSignal.throwIfAborted();
          boundary("sdk-consume-start");
          const result = streamText({
            model,
            prompt: "Reply with OK.",
            maxOutputTokens: CONTEXT_CALIBRATION.output,
            maxRetries: 0,
            abortSignal,
          });
          await waitForRecovery(
            result.consumeStream({
              onError: (error) => {
                throw error;
              },
            }),
            abortSignal,
          );
          boundary("sdk-consume-end");
          const finish = await waitForRecovery(result.finishReason, abortSignal);
          boundary("sdk-finish-end");
          return { finish };
        },
      },
    );
  })();
  flights.set(endpoint.id, work);
  try {
    return await work;
  } finally {
    operation.settle();
    controller.abort();
    await cancelSessionInference(sessionId);
    if (claimed)
      await invoke("self_hosted_context_lease", {
        endpointId: endpoint.id,
        owner,
        release: true,
      }).catch(() => {});
    flights.delete(endpoint.id);
    useContextCalibrationJobs.setState((s) => {
      const jobs = { ...s.jobs };
      delete jobs[endpoint.id];
      return { jobs };
    });
  }
}
export async function ensureSelectedContext(
  state: ContextCalibrationOptions["state"],
  selectionId: string,
  signal: AbortSignal,
  scope?: InferenceScope,
  ceiling?: number,
) {
  const target = resolveSelfHostedSelection(state, selectionId);
  if (
    target.status !== "available" ||
    target.profile.overrides.workingContext ||
    endpointBackend(target.endpoint) !== "ollama"
  )
    return state;
  try {
    await calibrateModelContext({
      state,
      profileId: target.profile.id,
      signal,
      scope,
      ceiling,
    });
  } catch (error) {
    if (signal.aborted) throw error;
  }
  signal.throwIfAborted();
  const current = readSelfHostedState(
    new Map(
      await invoke<[string, unknown][]>("self_hosted_profiles_snapshot"),
    ).get("selfHostedInference"),
  );
  const profile = current.profiles.find((p) => p.id === target.profile.id),
    endpoint = current.endpoints.find((e) => e.id === target.endpoint.id);
  if (
    !profile ||
    profile.modelRevision !== target.profile.modelRevision ||
    endpoint?.configurationRevision !== target.endpoint.configurationRevision
  )
    throw new Error(
      "Model settings changed during context verification. Choose the current model again.",
    );
  // Only this profile's derived context changes; captured explicit settings and peers stay owned by the run.
  if (
    JSON.stringify(profile.overrides) !==
    JSON.stringify(target.profile.overrides)
  )
    throw new Error("Model settings changed during context verification");
  return {
    ...state,
    profiles: state.profiles.map((p) =>
      p.id === profile.id
        ? {
            ...p,
            evidence: profile.evidence,
            recommendations: profile.recommendations,
            contextCalibration: profile.contextCalibration,
          }
        : p,
    ),
    inventories: current.inventories,
  };
}
