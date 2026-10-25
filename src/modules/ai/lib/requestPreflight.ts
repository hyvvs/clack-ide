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
  effectiveProfileValue,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import { probeEvidenceIsFresh } from "@/modules/ai/lib/selfHostedProbe";
import type { InferenceAdmission } from "@/modules/ai/lib/inferenceAdmission";
import {
  endpointAllowsPrivate,
  endpointProvider,
} from "@/modules/ai/lib/selfHostedModels";
import { contextMetadata, contextRuntime } from "@/modules/ai/lib/contextCalibrationTrust";
import { freshVerifiedContextTiers, minimumSafeContext } from "@/modules/ai/lib/minimumSafeContext";
import { agentContinuationReasoningMetadata, automaticAgentRecommendation } from "@/modules/ai/lib/agentConfiguration";
import { verificationRecord, sameToolConfiguration } from "@/modules/ai/lib/toolVerification";
import type { ToolVerification } from "@/modules/ai/lib/toolVerificationSchema";
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

/** Diagnose the *serialized* request versus the captured route; never relax the gate. */
export function assertOllamaContextRoute(
  body: Record<string, unknown>,
  capturedModel: string,
  trustedRuntimeTarget: number | undefined,
) {
  const actualModel = body.model;
  const actualContext = (body.options as { num_ctx?: unknown } | undefined)?.num_ctx;
  if (actualModel === capturedModel && actualContext === trustedRuntimeTarget) return;
  const observed = (value: unknown) =>
    value === undefined ? "omitted" : Number.isSafeInteger(value) && typeof value === "number" && value > 0
      ? String(value) : "invalid";
  const reasons = [
    ...(actualModel !== capturedModel ? ["serialized model differs from the captured model"] : []),
    ...(actualContext !== trustedRuntimeTarget ? [
      `serialized num_ctx ${observed(actualContext)}; trusted runtime target ${trustedRuntimeTarget === undefined ? "unavailable" : trustedRuntimeTarget}`,
    ] : []),
  ];
  // Do not include model IDs, endpoint URLs, prompt material or credential data.
  throw new ContextBudgetError("ollama-context-route", `Ollama context-route preflight rejected: ${reasons.join("; ")}. No inference was sent.`);
}

/** Opt-in, redacted receipt of the actual comparison; no prompt/URL/model identifiers. */
export type OllamaRouteDecision = {
  at: number;
  modelMatches: boolean;
  serializedContext: number | null;
  trustedTarget: number | null;
  admittedByRoute: boolean;
  capturedStateRevision: number | null;
  capturedConfigurationRevision: number | null;
  snapshotConfigurationRevision: number | null;
  snapshotAgeMs: number | null;
  snapshotConnected: boolean | null;
  snapshotDigestMatches: boolean | null;
  calibrationStatus: string | null;
  calibratedContext: number | null;
  calibrationExpired: boolean | null;
  runtimeObserved: boolean;
  runtimeAgeMs: number | null;
  runtimeEpochMatches: boolean | null;
  runtimeVersionMatches: boolean | null;
  loadedContextMatchesCalibration: boolean | null;
};

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
  /** Exact verified Agent logical-continuation allocation, not a B1 budget hint. */
  requiredRuntimeContext?: number;
  /** Record selected by real Automatic eligibility for this one logical run. */
  requiredContinuationProof?: ToolVerification;
  toolVerificationContext?: number;
  verifyAgentTier?: (tier: number) => Promise<SelfHostedState>;
  onAgentTierSelected?: (state: SelfHostedState, proof: ToolVerification) => void;
  validateEvidence?: () => Promise<void>;
  onOllamaRouteDecision?: (decision: OllamaRouteDecision) => void;
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
  let lastSelectedRequestTarget: number | undefined;
  let providerLimits: BudgetLimits = {};
  const reasoning = options.reasoning ? structuredClone(options.reasoning) : undefined;
  let reasoningValidation: Promise<ReturnType<typeof effortProviderOptions>> | undefined;
  const limits = (): BudgetLimits => ({
    ...(options.optimization ? { inputCap: 1365, outputCap: 170 } : {}),
    ...(profile && state
      ? profileBudgetLimits(state, profile.id, snapshot, Date.now(),
          options.calibrationContext ?? options.toolVerificationContext ?? options.requiredRuntimeContext)
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
      const pinnedTier = options.requiredRuntimeContext ?? options.toolVerificationContext;
      if (pinnedTier !== undefined && profile?.overrides.workingContext && state &&
          effectiveProfileValue(state, profile.id, "workingContext").value !== pinnedTier)
        throw new ContextBudgetError("ollama-context-tier-stale",
          "An explicit manual working-context pin differs from the Agent's verified tier. No inference was sent.");
      if (options.toolVerificationContext !== undefined &&
          (!profile || !state || !freshVerifiedContextTiers(state, profile, snapshot).includes(options.toolVerificationContext)))
        throw new ContextBudgetError("ollama-context-tier-stale",
          "The native-tool verification context is not freshly calibrated. No inference was sent.");
      const measured = assertRequestBudget(limits(), body, schemaKinds, availableSchemas);
      // Select from successful, still-trusted *loaded* calibration attempts.
      // Native tools also require a fresh proof for the chosen exact context.
      const originalTarget = runtimeTarget();
      let selectedTarget = originalTarget;
      let selectedProof: ToolVerification | undefined;
      let selectedProofState: SelfHostedState | undefined;
      if (options.providerId === "ollama" && profile && state && originalTarget !== undefined &&
          options.calibrationContext === undefined && options.toolVerificationContext === undefined &&
          options.requiredRuntimeContext === undefined &&
          !profile.overrides.workingContext &&
          // Preserve historical rejection diagnostics and never rewrite an
          // adapter request that was already mismatched before tier selection.
          body.model === options.modelId &&
          (body.options as { num_ctx?: unknown } | undefined)?.num_ctx === originalTarget) {
        const tiers = freshVerifiedContextTiers(state, profile, snapshot);
        const hasNativeTools = Array.isArray(body.tools) && body.tools.length > 0;
        const verifiedAtCapturedReasoning = (tier: number) => {
          const proof = automaticAgentRecommendation(state, profile, tier);
          return !!proof && proof.choice === (options.reasoning?.choice ?? "automatic");
        };
        selectedTarget = minimumSafeContext(limits(), measured.cost, measured.output, tiers,
          tier => !hasNativeTools || !!options.verifyAgentTier || verifiedAtCapturedReasoning(tier)) ?? originalTarget;
        if (hasNativeTools && selectedTarget !== undefined &&
            (options.verifyAgentTier || selectedTarget !== originalTarget)) {
          const current = await checkIdentity();
          const currentProfile = current?.profiles.find(p => p.id === profile.id);
          const existing = current && currentProfile ?
            automaticAgentRecommendation(current, currentProfile, selectedTarget) : undefined;
          if (!existing || existing.choice !== (options.reasoning?.choice ?? "automatic")) {
            if (!options.verifyAgentTier)
              throw new ContextBudgetError("agent-tier-tool-unverified",
                "The smaller Agent tier has no current native-tool proof. No inference was sent.");
            selectedProofState = await options.verifyAgentTier(selectedTarget);
          } else {
            selectedProofState = current;
          }
          // Verification executes actual provider inference and may change the
          // loaded KV allocation. Re-read the native snapshot before admission.
          await refresh();
          const authoritative = await checkIdentity();
          const authoritativeProfile = authoritative?.profiles.find(p => p.id === profile.id);
          const selected = authoritative && authoritativeProfile ?
            automaticAgentRecommendation(authoritative, authoritativeProfile, selectedTarget) : undefined;
          if (!authoritative || !authoritativeProfile || !selected ||
              selected.choice !== (options.reasoning?.choice ?? "automatic") ||
              !freshVerifiedContextTiers(authoritative, authoritativeProfile, snapshot).includes(selectedTarget))
            throw new ContextBudgetError("agent-tier-tool-unverified",
              "Exact-context native-tool verification did not pass or is stale. No Agent request was sent.");
          selectedProof = structuredClone(selected.record);
          selectedProofState = authoritative;
        }
        if (selectedTarget !== originalTarget) {
          const optionsBody = body.options;
          if (!optionsBody || typeof optionsBody !== "object" || Array.isArray(optionsBody))
            throw new ContextBudgetError("ollama-context-route", "Serialized Ollama context options are unavailable.");
          (optionsBody as Record<string, unknown>).num_ctx = selectedTarget;
        }
      }
      if (options.providerId === "ollama") {
        // Capture exactly once. A refresh/trust transition must not make the
        // comparison and its diagnostic describe different target values.
        const target = selectedTarget;
        if (options.onOllamaRouteDecision) {
          const at = Date.now();
          const calibration = profile?.contextCalibration;
          const runtime = endpoint && contextRuntime(endpoint.id);
          const activeModel = snapshot?.models.find(m => m.id === profile?.transportModelId);
          const serialized = (body.options as { num_ctx?: unknown } | undefined)?.num_ctx;
          const decision: OllamaRouteDecision = {
            at,
            modelMatches: body.model === options.modelId,
            serializedContext: typeof serialized === "number" && Number.isSafeInteger(serialized) && serialized > 0 ? serialized : null,
            trustedTarget: target ?? null,
            admittedByRoute: body.model === options.modelId && serialized === target,
            capturedStateRevision: state?.revision ?? null,
            capturedConfigurationRevision: endpoint?.configurationRevision ?? null,
            snapshotConfigurationRevision: snapshot?.configurationRevision ?? null,
            snapshotAgeMs: snapshot ? at - snapshot.observedAt : null,
            snapshotConnected: snapshot?.connected ?? null,
            snapshotDigestMatches: profile && activeModel ? activeModel.digest === profile.modelRevision : null,
            calibrationStatus: calibration?.status ?? null,
            calibratedContext: calibration?.highest ?? null,
            calibrationExpired: calibration ? calibration.expiresAt <= at : null,
            runtimeObserved: !!runtime,
            runtimeAgeMs: runtime ? at - runtime.at : null,
            runtimeEpochMatches: runtime && calibration ? runtime.epoch === calibration.scope.runtimeEpoch : null,
            runtimeVersionMatches: runtime && calibration ? runtime.version === calibration.scope.providerVersion : null,
            loadedContextMatchesCalibration: profile && endpoint && calibration
              ? contextMetadata(profile, endpoint, "loadedContext", at) === calibration.highest : null,
          };
          try { options.onOllamaRouteDecision(decision); }
          catch { /* Diagnostic delivery must never affect request admission. */ }
        }
        assertOllamaContextRoute(body, options.modelId, target);
      }
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
        if (options.providerId === "ollama" && selectedTarget !== originalTarget) {
          if (!profile || !state || selectedTarget === undefined ||
              !freshVerifiedContextTiers(state, profile, snapshot).includes(selectedTarget) ||
              (!selectedProof && Array.isArray(body.tools) && body.tools.length > 0 &&
                !(automaticAgentRecommendation(state, profile, selectedTarget)?.choice ===
                  (options.reasoning?.choice ?? "automatic"))))
            throw new ContextBudgetError("ollama-context-tier-stale",
              "Verified context or native-tool proof changed. No inference was sent.");
          assertMeasuredRequestBudget({ ...limits(), runtimeTarget: selectedTarget, deployed: undefined },
            measured.cost, measured.output);
        }
        await options.validateEvidence?.();
        await reasoningOptions();
        // B1 may legitimately resolve a smaller conservative context for an
        // independently small request. It may NOT authorize a body serialized
        // for an older, larger context after the final provider refresh.
        if (options.providerId === "ollama") {
          const currentTarget = runtimeTarget();
          if (currentTarget !== originalTarget)
            throw new ContextBudgetError("ollama-context-tier-stale",
              "Trusted context changed before dispatch. No inference was sent.");
          assertOllamaContextRoute(body, options.modelId, selectedTarget);
          if (options.requiredRuntimeContext !== undefined) {
            if (!profile || !state ||
                currentTarget !== options.requiredRuntimeContext ||
                !freshVerifiedContextTiers(state, profile, snapshot).includes(options.requiredRuntimeContext))
              throw new ContextBudgetError("ollama-continuation-allocation-stale",
                "Automatic Agent working context changed during continuation. No inference was sent; reverify context and tools for a new run.");
          }
        }
        // Verify owner/settings again after asynchronous snapshot and control
        // checks, just before giving the native HTTP dispatch its ACK.
        const currentSettings = await checkIdentity();
        const originalProof = options.requiredContinuationProof;
        if (originalProof) {
          const currentProfile = currentSettings?.profiles.find(p => p.id === profile?.id);
          if (!currentSettings || !currentProfile || options.providerId !== "ollama" ||
              options.requiredRuntimeContext === undefined ||
              originalProof.context !== options.requiredRuntimeContext)
            throw new ContextBudgetError("agent-tool-proof-stale", "Current Agent native-tool verification is unavailable. No inference was sent.");
          // Authoritative current settings own proof, failure and confirmation.
          // The native snapshot can refresh reasoning metadata only, never proof.
          const eligible = agentContinuationReasoningMetadata(currentSettings, currentProfile, snapshot);
          const eligibleProfile = eligible.profiles.find(p => p.id === currentProfile.id) ?? currentProfile;
          const currentProof = verificationRecord(eligibleProfile, originalProof.configuration, originalProof.context);
          const selected = automaticAgentRecommendation(eligible, eligibleProfile, originalProof.context);
          if (!currentProof || currentProof.id !== originalProof.id ||
              currentProof.status !== "verified" ||
              currentProof.context !== originalProof.context ||
              !sameToolConfiguration(currentProof.configuration, originalProof.configuration) ||
              JSON.stringify(currentProof.scope) !== JSON.stringify(originalProof.scope) ||
              !currentProof.proof || !originalProof.proof ||
              currentProof.proof.at !== originalProof.proof.at ||
              currentProof.proof.expiresAt !== originalProof.proof.expiresAt ||
              JSON.stringify(currentProof.confirmation ?? null) !== JSON.stringify(originalProof.confirmation ?? null) ||
              selected?.record.id !== originalProof.id ||
              !sameToolConfiguration(selected.configuration, originalProof.configuration))
            throw new ContextBudgetError("agent-tool-proof-stale", "Current Agent native-tool verification was replaced, revoked or expired. No inference was sent; verify tools before a new run.");
        }
        if (selectedProof) {
          const p = currentSettings?.profiles.find(p => p.id === profile?.id);
          const record = p && verificationRecord(p, selectedProof.configuration, selectedProof.context);
          const current = p && currentSettings &&
            automaticAgentRecommendation(currentSettings, p, selectedProof.context);
          if (!p || !record || !current || current.record.id !== selectedProof.id ||
              record.id !== selectedProof.id || record.status !== "verified" ||
              record.context !== selectedTarget ||
              JSON.stringify(record.scope) !== JSON.stringify(selectedProof.scope) ||
              !record.proof || !selectedProof.proof || record.proof.at !== selectedProof.proof.at ||
              record.proof.expiresAt !== selectedProof.proof.expiresAt ||
              JSON.stringify(record.confirmation ?? null) !== JSON.stringify(selectedProof.confirmation ?? null))
            throw new ContextBudgetError("agent-tier-tool-unverified",
              "Native-tool proof changed before Agent dispatch. No inference was sent.");
          if (selectedProofState) options.onAgentTierSelected?.(selectedProofState, selectedProof);
        }
        if (options.providerId === "ollama")
          lastSelectedRequestTarget = selectedTarget;
      };
    },
    async observeOllamaRuntime() {
      if (options.providerId !== "ollama" || !endpoint || !profile) return;
      const target = lastSelectedRequestTarget ?? runtimeTarget();
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
    const before = JSON.stringify(body);
    await (await preflight.prepare(body))();
    const updated = JSON.stringify(body);
    return fetcher(input, updated === before ? init : { ...init, body: updated });
  };
}
