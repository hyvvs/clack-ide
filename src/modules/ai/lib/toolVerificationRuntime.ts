import { invoke } from "@tauri-apps/api/core";
import { streamText, tool } from "ai";
import {
  runToolVerification,
  type ProbeObservation,
  type ToolProbeDependencies,
} from "@/modules/ai/lib/toolVerification";
import {
  TOOL_VERIFICATION,
  TOOL_PROBE_NAME,
  TOOL_PROBE_PROMPT,
  probeArguments,
  type ToolConfiguration,
} from "@/modules/ai/lib/toolVerificationSchema";
import {
  readSelfHostedState,
  resolveSelfHostedSelection,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  endpointAllowsPrivate,
  compatibleServerBaseURL,
  selfHostedCredential,
  selfHostedSelectionId,
  selfHostedTransportIdentity,
} from "@/modules/ai/lib/selfHostedModels";
import { inspectContextRuntime } from "@/modules/ai/lib/contextRuntimeClient";
import { createSelfHostedProbeClient } from "@/modules/ai/lib/selfHostedProbe";
import { endpointInferenceAdmission } from "@/modules/ai/lib/inferenceAdmission";
import {
  beginInference,
  cancelSessionInference,
  type InferenceScope,
} from "@/modules/ai/lib/inferenceLifecycle";
import { waitForRecovery } from "@/modules/ai/lib/providerRetry";
import {
  EMPTY_PROVIDER_KEYS,
  getKey,
  getCustomEndpointKey,
} from "@/modules/ai/lib/keyring";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { updateSelfHostedProfiles } from "@/modules/settings/store";
import { useToolVerificationJobs } from "@/modules/ai/store/toolVerificationJobs";
import { modelOnboarding } from "@/modules/ai/lib/modelOnboarding";
import {resolveAutomaticAgentTools, toolEffortCapture} from "@/modules/ai/lib/agentConfiguration";
import {effortProviderOptions} from "@/modules/ai/lib/reasoningEffort";

export const canonicalProbeTools = () => ({
  [TOOL_PROBE_NAME]: tool({
    description:
      "Return a deterministic compatibility probe value. No side effects.",
    inputSchema: probeArguments,
  }),
});
const flights = new Map<string, Promise<unknown>>();
export async function readToolProfiles() {
  return readSelfHostedState(
    new Map(
      await invoke<[string, unknown][]>("self_hosted_profiles_snapshot"),
    ).get("selfHostedInference"),
  );
}
function synchronize(state: SelfHostedState) {
  if (
    state.revision >=
    usePreferencesStore.getState().selfHostedInference.revision
  )
    usePreferencesStore.setState({ selfHostedInference: state });
  return state;
}
export async function verifyModelTools(options: {
  state: SelfHostedState;
  profileId: string;
  signal: AbortSignal;
  force?: boolean;
  scope?: InferenceScope;
  resolveAutomatic?: boolean;
}) {
  options.signal.throwIfAborted();
  const profile = options.state.profiles.find(
      (p) => p.id === options.profileId,
    ),
    endpoint = options.state.endpoints.find(
      (e) => e.id === profile?.endpointId && e.deletedAt == null,
    );
  if (!profile || !endpoint) throw new Error("Model unavailable");
  if ((endpoint.backendHint ?? endpoint.detectedBackend) !== "ollama")
    return { status: "unavailable" as const };
  const view = modelOnboarding(options.state, profile);
  const verdict = view?.tools ?? "Unverified";
  if (
    !options.force &&
    (options.resolveAutomatic ? ["Verified", "Unsupported"] : ["Verified", "Incompatible", "Needs attention", "Unsupported"]).includes(verdict)
  )
    return options.resolveAutomatic ? view?.reasoning.agentRecommendation?.record ?? profile.toolVerification : profile.toolVerification;
  const pending = flights.get(endpoint.id);
  if (pending) return waitForRecovery(pending, options.signal);
  const controller = new AbortController(),
    signal = AbortSignal.any([options.signal, controller.signal]),
    owner = crypto.randomUUID();
  const sessionId = `tool-verification:${owner}`;
  const operation = beginInference(
    options.scope ?? {
      sessionId,
      runId: owner,
      label: "Verifying tools",
      isCurrent: () => !signal.aborted,
    },
    () => controller.abort(),
  );
  const client = createSelfHostedProbeClient();
  let claimed = false;
  useToolVerificationJobs.setState((s) => ({
    jobs: { ...s.jobs, [endpoint.id]: { profileId: profile.id, controller } },
  }));
  const work = (async () => {
    await invoke("self_hosted_context_lease", {
      endpointId: endpoint.id,
      owner,
      release: false,
    });
    claimed = true;
    const deps: ToolProbeDependencies = {
        refresh: async () => {
          await client.refresh({
            endpointId: endpoint.id,
            selectedModelId: profile.transportModelId,
            allowPrivateNetwork: endpointAllowsPrivate(endpoint),
          });
          const state = synchronize(await readToolProfiles()),
            p = state.profiles.find((p) => p.id === profile.id),
            e = state.endpoints.find((e) => e.id === endpoint.id);
          if (
            !p ||
            p.modelRevision !== profile.modelRevision ||
            e?.configurationRevision !== endpoint.configurationRevision ||
            JSON.stringify(p.overrides) !== JSON.stringify(profile.overrides)
          )
            throw new Error("Tool verification settings changed");
          return state;
        },
        inspect: () => inspectContextRuntime(endpoint, true),
        commit: async (change) =>
          synchronize(await updateSelfHostedProfiles(change)),
        context: (state, p) => {
          const view = modelOnboarding(state, p);
          const context = view?.context.override ?? view?.context.recommended;
          if (typeof context !== "number")
            throw new Error("Context unavailable for tool verification");
          return context;
        },
        request: async (state, abortSignal, configuration?: ToolConfiguration, output = TOOL_VERIFICATION.output) => {
          const currentProfile = state.profiles.find(p => p.id === profile.id);
          if (!currentProfile) throw new Error("Model unavailable");
          const reasoning = toolEffortCapture(state, currentProfile, configuration);
          const identity = selfHostedTransportIdentity(
            selfHostedSelectionId(profile),
            state,
          );
          if (identity?.providerId !== "ollama")
            throw new Error("Native tool verification unavailable");
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
          const { buildLanguageModel } = await import("@/modules/ai/lib/agent");
          const observed: ProbeObservation = {
            calls: [],
            text: "",
            finish: "unknown",
            firstBodyAt: null,
            callAt: null,
          };
          const model = await buildLanguageModel(
            identity.providerId,
            EMPTY_PROVIDER_KEYS,
            profile.transportModelId,
            {
              selfHosted: true,
              selfHostedInference: state,
              toolVerification: true,
              reasoning,
              ollamaBaseURL: endpoint.baseURL,
              openaiCompatibleBaseURL: compatibleServerBaseURL(endpoint),
              allowPrivateNetwork: endpointAllowsPrivate(endpoint),
              inferenceScope: {
                sessionId,
                runId: owner,
                label: "Verifying tools",
                onResponseBody: () => {
                  observed.firstBodyAt ??= Date.now();
                },
                isCurrent: () => !abortSignal.aborted,
              },
              admission: endpointInferenceAdmission(
                endpoint.id,
                profile.id,
                state,
              ),
              calibration: {
                requestClass: "optimization",
                record: () => {},
                onQueued: () => controller.abort(new Error("Server busy")),
              },
            },
            selfHostedCredential(identity, keys, endpointKeys),
          );
          const result = streamText({
            model,
            prompt: TOOL_PROBE_PROMPT,
            tools: canonicalProbeTools(),
            maxOutputTokens: output,
            maxRetries: 0,
            abortSignal,
            providerOptions: effortProviderOptions(reasoning),
          });
          await waitForRecovery(
            (async () => {
              for await (const event of result.fullStream) {
                abortSignal.throwIfAborted();
                if (event.type === "error") throw event.error;
                if (event.type === "tool-call") {
                  observed.callAt ??= Date.now();
                  observed.calls.push({
                    name: event.toolName,
                    input: event.input,
                    invalid: event.invalid === true,
                  });
                  if (observed.calls.length > 2)
                    throw new Error("Unbounded native tool response");
                }
                if (event.type === "text-delta") {
                  observed.text += event.text;
                  if (observed.text.length > 65536)
                    throw new Error("Unbounded probe text");
                }
              }
              observed.finish = await result.finishReason;
            })(),
            abortSignal,
          );
          return observed;
        },
      };
    if (options.resolveAutomatic) {
      await resolveAutomaticAgentTools({...options, signal}, {
        refresh: deps.refresh, inspect: deps.inspect, context: deps.context,
        verify: (configuration, force, requestBudget) => runToolVerification({...options, configuration, force, requestBudget, signal}, deps),
      });
      const state = await readToolProfiles(), p = state.profiles.find(p => p.id === profile.id);
      return p ? modelOnboarding(state,p)?.reasoning.agentRecommendation?.record ?? p.toolVerification : undefined;
    }
    return runToolVerification({...options, signal}, deps);
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
    useToolVerificationJobs.setState((s) => {
      const jobs = { ...s.jobs };
      delete jobs[endpoint.id];
      return { jobs };
    });
  }
}
export async function ensureSelectedTools(
  state: SelfHostedState,
  selectionId: string,
  signal: AbortSignal,
  scope?: InferenceScope,
) {
  const target = resolveSelfHostedSelection(state, selectionId);
  if (
    target.status !== "available" ||
    !target.profile.modelRevision ||
    (target.endpoint.backendHint ?? target.endpoint.detectedBackend) !==
      "ollama"
  )
    return state;
  try {
    await verifyModelTools({
      state,
      profileId: target.profile.id,
      signal,
      scope,
      resolveAutomatic: true,
    });
  } catch (error) {
    if (signal.aborted) throw error;
  }
  signal.throwIfAborted();
  const current = await readToolProfiles(),
    profile = current.profiles.find((p) => p.id === target.profile.id),
    endpoint = current.endpoints.find((e) => e.id === target.endpoint.id);
  if (
    !profile ||
    profile.modelRevision !== target.profile.modelRevision ||
    endpoint?.configurationRevision !== target.endpoint.configurationRevision ||
    JSON.stringify(profile.overrides) !==
      JSON.stringify(target.profile.overrides)
  )
    throw new Error("Model settings changed during tool verification");
  const verdict = modelOnboarding(current, profile)?.tools ?? "Unverified";
  if (verdict !== "Verified")
    throw new Error(
      `Agent tool verification: ${verdict}. Use Chat Only or review tool evidence in model settings.`,
    );
  return {
    ...state,
    profiles: state.profiles.map((p) =>
      p.id === profile.id
        ? {
            ...p,
            evidence: profile.evidence,
            toolVerification: profile.toolVerification,
            agentToolConfigurations: profile.agentToolConfigurations,
          }
        : p,
    ),
    inventories: current.inventories,
  };
}
