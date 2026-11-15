import { streamText, type LanguageModel } from "ai";
import { buildLanguageModel } from "@/modules/ai/lib/agent";
import { endpointInferenceAdmission } from "@/modules/ai/lib/inferenceAdmission";
import {
  beginInference,
  cancelSessionInference,
  type InferenceScope,
} from "@/modules/ai/lib/inferenceLifecycle";
import {
  appendCalibrationSamples,
  type ScopedCalibrationSample,
} from "@/modules/ai/lib/inferenceCalibration";
import type { SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { endpointBackend } from "@/modules/ai/lib/selfHostedProfiles";
import {
  endpointAllowsPrivate,
  selfHostedCredential,
  selfHostedTransportIdentity,
  selfHostedSelectionId,
} from "@/modules/ai/lib/selfHostedModels";
import {
  EMPTY_PROVIDER_KEYS,
  getKey,
  getCustomEndpointKey,
} from "@/modules/ai/lib/keyring";
import { updateSelfHostedProfiles } from "@/modules/settings/store";
import { waitForRecovery } from "@/modules/ai/lib/providerRetry";

export const OPTIMIZATION_LIMITS = {
  requests: 3,
  inputTokens: 4096,
  outputTokens: 512,
  wallMs: 60_000,
  concurrency: 1,
  retries: 0,
} as const;
const prompts = [
  "Write forty short words about counting numbers. No tools or external information.",
  "Write forty short words about sorting shapes. No tools or external information.",
  "Write forty short words about comparing letters. No tools or external information.",
];
const busy = new Set<string>();
type Options = {
  state: SelfHostedState;
  profileId: string;
  signal: AbortSignal;
  onProgress?: (completed: number) => void;
  scope?: InferenceScope;
};

// Injectable seams exercise the real model/admission path separately from the
// bounded orchestration; no second provider or benchmark transport is created.
export async function runBoundedOptimization(
  options: Options,
  deps: {
    build: (
      signal: AbortSignal,
      record: (sample: ScopedCalibrationSample) => void,
      queued: () => void,
    ) => Promise<LanguageModel>;
    call?: (
      model: LanguageModel,
      prompt: string,
      output: number,
      signal: AbortSignal,
    ) => Promise<{ inputTokens?: number; outputTokens?: number }>;
    commit: (
      change: (state: SelfHostedState) => SelfHostedState,
    ) => Promise<unknown>;
    settle?: () => Promise<void>;
  },
) {
  const profile = options.state.profiles.find(
    (p) => p.id === options.profileId,
  );
  const endpoint = options.state.endpoints.find(
    (e) => e.id === profile?.endpointId && e.deletedAt === undefined,
  );
  if (!profile || !endpoint) throw new Error("Server or model unavailable.");
  if (busy.has(endpoint.id))
    throw new Error("This server is already being optimized.");
  if (options.signal.aborted) throw options.signal.reason;
  busy.add(endpoint.id);
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const operation = beginInference(options.scope, () =>
    controller.abort(new DOMException("Cancelled", "AbortError")),
  );
  const timer = setTimeout(
    () =>
      controller.abort(new Error("Optimization reached its 60-second limit.")),
    OPTIMIZATION_LIMITS.wallMs,
  );
  const samples: ScopedCalibrationSample[] = [];
  let input = 0;
  let output = 0;
  let inputReported = true;
  let outputReported = true;
  const call =
    deps.call ??
    (async (model, prompt, maxOutputTokens, abortSignal) => {
      const result = streamText({
        model,
        prompt,
        maxOutputTokens,
        abortSignal,
        maxRetries: 0,
      });
      await result.consumeStream({
        onError: (error) => {
          throw error;
        },
      });
      const usage = await result.usage;
      return {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      };
    });
  try {
    const model = await waitForRecovery(
      deps.build(
        signal,
        (sample) => {
          if (samples.length < OPTIMIZATION_LIMITS.requests)
            samples.push(sample);
        },
        () =>
          controller.abort(
            new Error("Server is at capacity. Optimization stopped."),
          ),
      ),
      signal,
    );
    for (let i = 0; i < OPTIMIZATION_LIMITS.requests; i++) {
      if (signal.aborted) throw signal.reason;
      const reserve = Math.floor(
        OPTIMIZATION_LIMITS.outputTokens / OPTIMIZATION_LIMITS.requests,
      );
      const result = await waitForRecovery(
        call(model, prompts[i], reserve, signal),
        signal,
      );
      if (signal.aborted) throw signal.reason;
      // Missing usage remains unknown; the static prompts and serialized B1
      // preflight bound requested input/output even when usage is omitted.
      input += result.inputTokens ?? 0;
      output += result.outputTokens ?? 0;
      inputReported &&= result.inputTokens !== undefined;
      outputReported &&= result.outputTokens !== undefined;
      if (
        !Number.isSafeInteger(input) ||
        !Number.isSafeInteger(output) ||
        input < 0 ||
        output < 0 ||
        input > OPTIMIZATION_LIMITS.inputTokens ||
        output > OPTIMIZATION_LIMITS.outputTokens
      )
        throw new Error(
          "Server reported usage outside the optimization budget.",
        );
      options.onProgress?.(i + 1);
    }
    if (
      signal.aborted ||
      samples.length !== OPTIMIZATION_LIMITS.requests ||
      samples.some((s) => s.sample.outcome !== "success")
    )
      throw new Error("Insufficient verified optimization evidence.");
    await deps.commit((state) => {
      if (
        signal.aborted ||
        state.endpoints.find(
          (e) => e.id === endpoint.id && e.deletedAt === undefined,
        )?.configurationRevision !== endpoint.configurationRevision
      )
        throw new Error("Optimization cancelled or server settings changed.");
      return appendCalibrationSamples(state, samples);
    });
    return {
      completed: samples.length,
      inputTokens: inputReported ? input : null,
      outputTokens: outputReported ? output : null,
    };
  } finally {
    clearTimeout(timer);
    controller.abort(new DOMException("Optimization settled", "AbortError"));
    operation.settle();
    try {
      await deps.settle?.();
    } finally {
      busy.delete(endpoint.id);
    }
  }
}

export async function optimizeInferenceProfile(options: Options) {
  const profile = options.state.profiles.find(
    (p) => p.id === options.profileId,
  );
  const endpoint = options.state.endpoints.find(
    (e) => e.id === profile?.endpointId && e.deletedAt === undefined,
  );
  if (!profile || !endpoint) throw new Error("Server or model unavailable.");
  const sessionId = `calibration:${crypto.randomUUID()}`;
  const runId = crypto.randomUUID();
  const scope = {
    sessionId,
    runId,
    label: endpoint.alias,
    isCurrent: () => !options.signal.aborted,
  };
  return runBoundedOptimization(
    { ...options, scope },
    {
      build: async (signal, record, onQueued) => {
        const keys = { ...EMPTY_PROVIDER_KEYS };
        const ref = endpoint.credentialRef;
        if (ref?.kind === "provider")
          keys[ref.providerId] = await getKey(ref.providerId);
        const endpointKeys =
          ref?.kind === "custom-endpoint"
            ? { [ref.endpointId]: await getCustomEndpointKey(ref.endpointId) }
            : {};
        const identity = selfHostedTransportIdentity(
          endpoint.legacy?.profileId === profile.id
            ? endpoint.legacy.selectionId
            : selfHostedSelectionId(profile),
          options.state,
        );
        if (!identity) throw new Error("Model identity unavailable.");
        const model = await buildLanguageModel(
          endpointBackend(endpoint) === "ollama" ? "ollama" : "openai-compatible",
          EMPTY_PROVIDER_KEYS,
          profile.transportModelId,
          {
            selfHosted: true,
            selfHostedInference: options.state,
            inferenceScope: { ...scope, isCurrent: () => !signal.aborted },
            admission: endpointInferenceAdmission(
              endpoint.id,
              profile.id,
              options.state,
            ),
            allowPrivateNetwork: endpointAllowsPrivate(endpoint),
            openaiCompatibleBaseURL: identity.endpointBaseURL,
            ollamaBaseURL: identity.endpointBaseURL,
            calibration: { requestClass: "optimization", record, onQueued },
          },
          selfHostedCredential(identity, keys, endpointKeys),
        );
        if (signal.aborted) throw signal.reason;
        return model;
      },
      commit: updateSelfHostedProfiles,
      settle: async () => {
        await cancelSessionInference(sessionId);
      },
    },
  );
}
