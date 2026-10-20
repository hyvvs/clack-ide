import { invoke } from "@tauri-apps/api/core";
import {
  asSchema,
  wrapLanguageModel,
  type LanguageModel,
  type ToolSet,
} from "ai";
import type { ProviderId } from "@/modules/ai/config";
export { knownTransportContextLimit } from "@/modules/ai/config";
import { resolveProviderContext } from "@/modules/ai/lib/providerContext";
import {
  assertRequestBudget,
  assertMeasuredRequestBudget,
  ContextBudgetError,
  resolveContextBudget,
  type BudgetLimits,
  type SchemaKind,
} from "@/modules/ai/lib/contextBudget";
import {
  budgetIdentity,
  profileBudgetLimits,
} from "@/modules/ai/lib/contextBudgetProfile";
import {
  createSelfHostedProbeClient,
  PROBE_INSTANCE_TTL_MS,
  type ProbeSnapshot,
} from "@/modules/ai/lib/selfHostedProbe";
import {
  readSelfHostedState,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import { probeEvidenceIsFresh } from "@/modules/ai/lib/selfHostedProbe";
import type { InferenceAdmission } from "@/modules/ai/lib/inferenceAdmission";
import {
  endpointAllowsPrivate,
  endpointProvider,
} from "@/modules/ai/lib/selfHostedModels";
import {
  effortBudget,
  effortCapability,
  effortProviderOptions,
  sameEffortContract,
  type EffortCapture,
} from "@/modules/ai/lib/reasoningEffort";

// Native admission allows five seconds for its acknowledgement.
const REASONING_REVALIDATION_MS = 3_000;
const reasoningUnavailable = () => new ContextBudgetError(
  "reasoning-evidence-unavailable",
  "The captured reasoning control could not be revalidated with fresh model metadata. No inference was sent. Check the endpoint and retry explicitly; reasoning was not changed.",
);

async function boundedReasoning<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(reasoningUnavailable()), REASONING_REVALIDATION_MS);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

const modelBudgets = new WeakMap<object, () => Promise<BudgetLimits>>();
const modelDiagnostics = new WeakMap<
  object,
  (kinds: Record<string, SchemaKind>, available: number) => void
>();
export function setModelSchemaDiagnostics(
  model: LanguageModel,
  kinds: Record<string, SchemaKind>,
  available: number,
) {
  if (typeof model === "object") modelDiagnostics.get(model)?.(kinds, available);
}
export async function modelBudgetLimits(
  model: LanguageModel,
): Promise<BudgetLimits> {
  return typeof model === "object"
    ? ((await modelBudgets.get(model)?.()) ?? {})
    : {};
}
export async function serializedToolSchemas(tools: ToolSet) {
  return Promise.all(
    Object.entries(tools).map(async ([name, tool]) => ({
      type: "function",
      function: {
        name,
        description: tool.description,
        parameters: await asSchema(tool.inputSchema).jsonSchema,
      },
    })),
  );
}

export function createRequestPreflight(options: {
  validateRouting?: () => Promise<void>;
  requireRequestedOutput?: boolean;
  cachedMetadataOnly?: boolean;
  modelId: string;
  providerId?: ProviderId;
  providerEvidence?: import("@/modules/ai/lib/providerModelEvidence").ProviderModelEvidence;
  local: boolean;
  state?: SelfHostedState;
  admission?: InferenceAdmission;
  assertedContext?: number;
  reasoning?: EffortCapture;
  optimization?: boolean;
  calibrationContext?: number;
  validateEvidence?: () => Promise<void>;
}) {
  const state = options.state;
  const profile =
    state?.profiles.find((p) => p.id === options.admission?.profileId) ??
    state?.profiles.find(
      (p) =>
        p.endpointId === options.admission?.endpointId &&
        p.transportModelId === options.modelId,
    );
  const endpoint = state?.endpoints.find((e) => e.id === profile?.endpointId);
  const identity =
    state && profile ? budgetIdentity(state, profile.id) : undefined;
  let snapshot: ProbeSnapshot | null = null;
  let refreshAttemptedAt = 0;
  let schemaKinds: Record<string, SchemaKind> = {};
  let availableSchemas: number | undefined;
  let providerLimits: BudgetLimits = {};
  const reasoning = options.reasoning ? structuredClone(options.reasoning) : undefined;
  let reasoningValidation: Promise<ReturnType<typeof effortProviderOptions>> | undefined;
  const limits = (): BudgetLimits => ({
    ...(options.optimization ? { inputCap: 1365, outputCap: 170 } : {}),
    ...(profile && state
      ? profileBudgetLimits(state, profile.id, snapshot, Date.now(), options.calibrationContext)
      : options.local
        ? { asserted: options.assertedContext }
        : {
            ...providerLimits,
            asserted: options.assertedContext,
          }),
    ...(effortBudget(options.reasoning)
      ? { reasoningBudget: effortBudget(options.reasoning) }
      : {}),
    ...(options.calibrationContext !== undefined ? { maxOutput: 32, outputReserve: undefined } : {}),
  });
  const runtimeTarget = () => {
    if (options.providerId !== "ollama" || !profile || !state) return undefined;
    const target = limits().runtimeTarget;
    if (typeof target !== "number") return undefined;
    limits();
    return target;
  };
  const refresh = async () => {
    await options.validateRouting?.();
    if (reasoning?.choice !== "automatic" && reasoning?.capability.expiresAt !== undefined)
      await checkIdentity();
    if (!options.local && !profile)
      providerLimits = await resolveProviderContext(
        options.modelId,
        options.providerId,
        options.cachedMetadataOnly,
        options.providerEvidence,
      );
    if (!endpoint || !profile) return;
    if (profile.contextCalibration && options.calibrationContext === undefined) {
      try { await (await import("@/modules/ai/lib/contextRuntimeClient")).inspectContextRuntime(endpoint); }
      catch { /* Loss of runtime evidence keeps Automatic conservative. */ }
    }
    const client = createSelfHostedProbeClient();
    const probeOptions = {
      endpointId: endpoint.id,
      selectedModelId: profile.transportModelId,
      allowPrivateNetwork: endpointAllowsPrivate(endpoint),
    };
    let failureCode: string | undefined;
    try {
      snapshot = await client.read(probeOptions);
      if (
        !options.cachedMetadataOnly &&
        (!snapshot ||
          snapshot.stale ||
          !snapshot.connected ||
          snapshot.configurationRevision !== endpoint.configurationRevision ||
          snapshot.endpointId !== endpoint.id ||
          Date.now() - snapshot.observedAt >= PROBE_INSTANCE_TTL_MS) &&
        Date.now() - refreshAttemptedAt >= PROBE_INSTANCE_TTL_MS
      ) {
        refreshAttemptedAt = Date.now();
        snapshot = await client.refresh(probeOptions);
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && typeof error.code === "string")
        failureCode = error.code;
      /* Optional metadata failure retains only evidence still fresh under A2. */
    }
    if (failureCode && ["unreachable", "dns-failure", "timeout", "tls-failure", "authentication-failed", "unsafe-endpoint"].includes(failureCode))
      throw new Error("Self-hosted server unavailable. Reconnect or refresh this server. No inference was sent.");
    if (snapshot?.connected && !snapshot.stale) {
      const current = snapshot.models.find(m => m.id === profile.transportModelId);
      if (!current || current.chat === "unsupported" ||
          (profile.modelRevision && profile.modelRevision !== current.digest))
        throw new Error("Model unavailable or revision changed. Refresh this server and explicitly choose a current model. No inference was sent.");
    }
    if (snapshot && !snapshot.connected && snapshot.errors.some(e =>
      ["unreachable", "dns-failure", "timeout", "tls-failure", "authentication-failed"].includes(e.error.code)))
      throw new Error("Self-hosted server unavailable. Reconnect or refresh this server. No inference was sent.");
  };
  const checkIdentity = async () => {
    if (!profile || !identity) return;
    const entries = await invoke<[string, unknown][]>(
      "self_hosted_profiles_snapshot",
    ).catch(() => {
      throw new ContextBudgetError(
        "context-settings-unavailable",
        "Current endpoint settings could not be revalidated. No inference was sent; retry once settings are available.",
      );
    });
    const current = readSelfHostedState(
      new Map(entries).get("selfHostedInference"),
    );
    if (budgetIdentity(current, profile.id) !== identity)
      throw new ContextBudgetError(
        "context-settings-changed",
        "Endpoint/model/profile settings changed while this request was waiting. Start a new request with the current settings.",
      );
    return current;
  };
  const reasoningOptions = async () => {
    if (!reasoning) return {};
    if (reasoning.choice === "automatic" || reasoning.capability.expiresAt === undefined)
      return effortProviderOptions(reasoning);
    if (!endpoint || !profile) throw reasoningUnavailable();
    if (!reasoningValidation) {
      const inspect = (current: SelfHostedState | undefined) => effortCapability({
        providerId: endpointProvider(endpoint),
        transportModelId: profile.transportModelId,
        selfHosted: {
          endpointId: endpoint.id, profileId: profile.id,
          configurationRevision: endpoint.configurationRevision,
          allowPrivateNetwork: endpointAllowsPrivate(endpoint),
          credentialRef: endpoint.credentialRef, credentialRequired: !!endpoint.credentialRef && !endpoint.legacy,
        },
      }, current);
      const work = async () => {
        let capability = inspect(await checkIdentity());
        let refreshed: ProbeSnapshot | undefined;
        const expiring = () => capability.expiresAt !== undefined &&
          capability.expiresAt - Date.now() <= REASONING_REVALIDATION_MS;
        if ((capability.status === "unknown" || expiring()) && !options.cachedMetadataOnly &&
            (expiring() || Date.now() - refreshAttemptedAt >= PROBE_INSTANCE_TTL_MS)) {
          refreshAttemptedAt = Date.now();
          try {
            refreshed = await createSelfHostedProbeClient().refresh({
              endpointId: endpoint.id, selectedModelId: profile.transportModelId,
              allowPrivateNetwork: endpointAllowsPrivate(endpoint),
            });
          } catch {
            throw reasoningUnavailable();
          }
          if (!refreshed.connected || refreshed.stale ||
              refreshed.endpointId !== endpoint.id ||
              refreshed.configurationRevision !== endpoint.configurationRevision ||
              refreshed.selectedModelId !== profile.transportModelId)
            throw reasoningUnavailable();
          capability = inspect(await checkIdentity());
        }
        if (capability.status === "unknown" || expiring()) throw reasoningUnavailable();
        if (!sameEffortContract(reasoning, capability))
          throw new ContextBudgetError("reasoning-evidence-changed",
            "The endpoint's reasoning-control contract changed. No inference was sent. Review this model's reasoning settings and start a new request; the captured choice was not changed.");
        effortProviderOptions({ ...reasoning, capability });
        return { capability, refreshed };
      };
      reasoningValidation = boundedReasoning(work()).then(result => {
        if (result.refreshed) snapshot = result.refreshed;
        return effortProviderOptions({ ...reasoning, capability: result.capability });
      }).finally(() => { reasoningValidation = undefined; });
    }
    return reasoningValidation;
  };
  return {
    thermal(): "cold" | "warm" | "unknown" {
      if (!endpoint || !profile) return "unknown";
      const loaded = snapshot?.models.find(m => m.id === profile.transportModelId)?.evidence.find(e =>
        e.metric === "probe.loaded" && typeof e.value === "boolean" &&
        (profile.deploymentId === null || e.scope.deploymentId === profile.deploymentId) &&
        probeEvidenceIsFresh(e, endpoint, snapshot),
      );
      return loaded?.value === true ? "warm" : loaded?.value === false ? "cold" : "unknown";
    },
    wrap(model: LanguageModel): LanguageModel {
      if (typeof model === "string" || model.specificationVersion !== "v3")
        throw new ContextBudgetError(
          "context-adapter-unsupported",
          "This adapter has no shared context preflight.",
        );
      const wrapped = wrapLanguageModel({
        model,
        middleware: {
          specificationVersion: "v3",
          async transformParams({ params }) {
            await refresh();
            const reasoningSettings = await reasoningOptions();
            const output = resolveContextBudget(limits(), undefined, params.maxOutputTokens).output;
            if (options.requireRequestedOutput && params.maxOutputTokens !== undefined && output < params.maxOutputTokens)
              throw new ContextBudgetError("fallback-output", "Fallback cannot preserve the requested output allowance.");
            const providerOptions = { ...params.providerOptions };
            for (const [provider, settings] of Object.entries(
              reasoningSettings,
            )) {
              providerOptions[provider] = {
                ...providerOptions[provider],
                ...settings,
              };
            }
            if (options.providerId === "ollama") {
              providerOptions.ollama = { ...providerOptions.ollama, numCtx: runtimeTarget() };
            }
            return {
              ...params,
              providerOptions,
              maxOutputTokens: output,
            };
          },
        },
      });
      modelBudgets.set(wrapped, async () => {
        await refresh();
        return limits();
      });
      modelDiagnostics.set(wrapped, (kinds, available) => {
        schemaKinds = { ...kinds };
        availableSchemas = available;
      });
      return wrapped;
    },
    async prepare(body: Record<string, unknown>) {
      if (options.calibrationContext !== undefined && (options.providerId !== "ollama" || !Number.isSafeInteger(options.calibrationContext) ||
        options.calibrationContext < 1 || options.calibrationContext > 65536 || (Array.isArray(body.tools) && body.tools.length > 0)))
        throw new ContextBudgetError("invalid-context-calibration", "Context verification requires a bounded native request without tools.");
      await refresh();
      await reasoningOptions();
      const measured = assertRequestBudget(limits(), body, schemaKinds, availableSchemas);
      if (options.providerId === "ollama" && (body.model !== options.modelId ||
        (body.options as { num_ctx?: unknown } | undefined)?.num_ctx !== runtimeTarget()))
        throw new ContextBudgetError("ollama-context-route", "Ollama runtime context/model does not match the captured profile.");
      return async () => {
        await checkIdentity();
        // Only stale explicit controls may use bounded metadata revalidation here.
        if (endpoint && profile) {
          try {
            snapshot = await createSelfHostedProbeClient().read({
              endpointId: endpoint.id,
              selectedModelId: profile.transportModelId,
              allowPrivateNetwork: endpointAllowsPrivate(endpoint),
            });
          } catch {
            snapshot = null;
          }
        }
        if (!options.local && !profile)
          providerLimits = await resolveProviderContext(
            options.modelId,
            options.providerId,
            true,
            options.providerEvidence,
          );
        assertMeasuredRequestBudget(limits(), measured.cost, measured.output);
        await options.validateEvidence?.();
        await reasoningOptions();
      };
    },
    async observeOllamaRuntime() {
      if (options.providerId !== "ollama" || !endpoint || !profile) return;
      const target = runtimeTarget();
      const current = snapshot?.models.find(m => m.id === profile.transportModelId);
      try {
        await checkIdentity();
        if (snapshot && Date.now() - snapshot.observedAt < PROBE_INSTANCE_TTL_MS &&
          (target === undefined ? current?.evidence.some(e => e.metric === "probe.loaded" && e.value === true)
            : current?.evidence.some(e => e.metric === "probe.requestedContext" && e.value === target) &&
              current.evidence.some(e => e.metric === "probe.loadedContext" && e.value === target))) return;
        snapshot = await createSelfHostedProbeClient().refresh({
          endpointId: endpoint.id, selectedModelId: profile.transportModelId,
          allowPrivateNetwork: endpointAllowsPrivate(endpoint), requestedContext: target,
        });
      } catch {
        // Optional metadata never retries or changes the already-sent inference.
      }
    },
  };
}

export function preflightFetch(
  fetcher: typeof fetch,
  preflight: ReturnType<typeof createRequestPreflight>,
): typeof fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string")
      throw new ContextBudgetError(
        "context-body-unsupported",
        "Cannot account for this request body before inference.",
      );
    const body = JSON.parse(init.body) as Record<string, unknown>;
    await (await preflight.prepare(body))();
    return fetcher(input, init);
  };
}
