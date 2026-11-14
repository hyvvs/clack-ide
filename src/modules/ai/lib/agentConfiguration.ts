import {
  captureEffort,
  effortProviderOptions,
  type EffortCapture,
} from "@/modules/ai/lib/reasoningEffort";
import { contextMetadata, contextReasoningIdentity, contextRuntime, snapshotContext } from "@/modules/ai/lib/contextCalibrationTrust";
import { CONTEXT_CALIBRATION } from "@/modules/ai/lib/contextCalibrationSchema";
import { inspectContextRuntime } from "@/modules/ai/lib/contextRuntimeClient";
import { createSelfHostedProbeClient } from "@/modules/ai/lib/selfHostedProbe";
import { endpointAllowsPrivate } from "@/modules/ai/lib/selfHostedModels";
import {
  configuredToolState,
  verificationRecord,
  sameToolConfiguration,
  sameToolScope,
  toolScope,
  toolEligibilityPredicates,
} from "@/modules/ai/lib/toolVerification";
import { createToolRequestBudget, TOOL_VERIFICATION, type ToolConfiguration, type ToolRequestBudget } from "@/modules/ai/lib/toolVerificationSchema";
import type {
  SelfHostedProfile,
  SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import { probeEvidenceIsFresh, type ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";

// A long native inference can outlive the *observation* TTL without outliving
// calibration or native-tool proof. This is only an admission to inspect again,
// never a substitute for trustedContext/configuredToolState or final preflight.
// In particular, do not manufacture a newer runtime timestamp or proof.
export async function refreshStaleAutomaticContinuationRuntime(
  state: SelfHostedState,
  profile: SelfHostedProfile,
  cachedProvider: ProbeSnapshot | null,
  retainedRecordId: string | undefined,
  retainedVariant: string | undefined,
  signal?: AbortSignal,
  providerRecovery = false,
): Promise<ProbeSnapshot | null> {
  const now = Date.now();
  const endpoint = state.endpoints.find(e => e.id === profile.endpointId && e.deletedAt == null);
  const runtime = endpoint && contextRuntime(endpoint.id);
  if (!endpoint || !runtime || runtime.at > now ||
      runtime.configurationRevision !== endpoint.configurationRevision) return cachedProvider;
  const cachedModel = cachedProvider?.models.find(m => m.id === profile.transportModelId);
  const metadataFresh = !!cachedProvider && !cachedProvider.stale &&
    cachedProvider.connected && cachedProvider.observedAt <= now &&
    now - cachedProvider.observedAt < CONTEXT_CALIBRATION.runtimeMs &&
    !!cachedModel && ["thinking", "thinkingControls", "thinkingDefault"].every(metric =>
      contextMetadata({ ...profile, evidence: cachedModel.evidence }, endpoint,
        metric, now, 300_000) !== undefined);
  // Native runtime and provider metadata are independently cached. A different
  // observer may have refreshed only the runtime while a long inference left
  // the provider metadata old. Neither cache can stand in for the other.
  if (now - runtime.at < CONTEXT_CALIBRATION.runtimeMs &&
      (!providerRecovery || metadataFresh))
    return cachedProvider;

  const fail = (): never => { throw new Error("Automatic Agent runtime identity could not be reverified. No inference was sent."); };
  signal?.throwIfAborted();
  const calibration = profile.contextCalibration;
  const records = [profile.toolVerification, ...(profile.agentToolTierProofs ?? []),
    ...(profile.agentToolConfigurations ?? [])].filter(r => r?.status === "verified");
  // A stale observation alone may trigger a single inspection only for an
  // original, identified, unexpired and otherwise matching proof and context.
  const record = retainedRecordId
    ? records.find(r => r?.id === retainedRecordId)
    : records.length === 1 ? records[0] : undefined;
  if (!record) throw new Error("Automatic Agent runtime identity could not be reverified. No inference was sent.");
  const cacheFresh = !!cachedProvider && !cachedProvider.stale &&
    cachedProvider.observedAt <= now &&
    now - cachedProvider.observedAt < CONTEXT_CALIBRATION.runtimeMs;
  const snapshotModel = cachedProvider?.models.find(m => m.id === profile.transportModelId);
  // An actual 180-second provider stream-idle timeout necessarily outlives the
  // 30-second native metadata observation. Do not mistake its OLD cache for
  // current authority, or require it to be fresh before a new observation.
  // The bounded native inspection and fresh provider probe below must prove
  // the exact original epoch, digest, context and reasoning before admission.
  const recentReasoning = cacheFresh && snapshotModel &&
    contextReasoningIdentity({ ...profile, evidence: snapshotModel.evidence }, endpoint, now);
  if (!record.proof || record.proof.at > now || record.proof.expiresAt <= now ||
      (retainedVariant && JSON.stringify(record.configuration ?? null) !== retainedVariant) ||
      (record.configuration && (!record.confirmation || record.confirmation.at > now || record.confirmation.expiresAt <= now)) ||
      (record.failure && record.failure.at <= now && record.failure.expiresAt > now) ||
      verificationRecord(profile, record.configuration, record.context)?.id !== record.id ||
      !calibration?.highest || calibration.status !== "verified" ||
      calibration.updatedAt > now || calibration.expiresAt <= now ||
      record.context > calibration.highest ||
      (endpoint.backendHint ?? endpoint.detectedBackend) !== "ollama" ||
      contextMetadata(profile, endpoint, "trainedForTools", now, 300_000) === false ||
      record.scope.endpointId !== endpoint.id ||
      record.scope.configurationRevision !== endpoint.configurationRevision ||
      record.scope.model !== profile.transportModelId ||
      record.scope.deployment !== profile.deploymentId ||
      record.scope.digest !== profile.modelRevision ||
      record.scope.backend !== "ollama" ||
      record.scope.runtimeEpoch !== runtime.epoch ||
      record.scope.providerVersion !== runtime.version ||
      (cacheFresh && record.scope.reasoning !== recentReasoning) ||
      record.scope.protocol !== TOOL_VERIFICATION.protocol ||
      calibration.scope.endpointId !== endpoint.id ||
      calibration.scope.configurationRevision !== endpoint.configurationRevision ||
      calibration.scope.model !== profile.transportModelId ||
      calibration.scope.deployment !== profile.deploymentId ||
      calibration.scope.digest !== profile.modelRevision ||
      calibration.scope.backend !== "ollama" ||
      calibration.scope.runtimeEpoch !== runtime.epoch ||
      calibration.scope.providerVersion !== runtime.version ||
      (cacheFresh && calibration.scope.reasoning !== recentReasoning) ||
      (cacheFresh && (!cachedProvider!.connected ||
        cachedProvider!.backend !== "ollama" ||
        cachedProvider!.endpointId !== endpoint.id ||
        cachedProvider!.configurationRevision !== endpoint.configurationRevision ||
        cachedProvider!.selectedModelId !== profile.transportModelId ||
        snapshotModel?.digest !== profile.modelRevision || snapshotModel.chat === "unsupported" ||
        contextMetadata({ ...profile, evidence: snapshotModel.evidence }, endpoint, "loadedContext", now) !== record.context))) fail();

  // Native inspection and a genuinely new provider probe are both bounded.
  // No retries, native-tool verifier or context calibrator are invoked.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const bounded = async <T>(work: () => Promise<T>): Promise<T> => {
    signal?.throwIfAborted();
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Runtime inspection timed out")), 30_000);
      onAbort = () => reject(new Error("Runtime inspection cancelled"));
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    try { return await Promise.race([work(), deadline]); }
    finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
  };
  try {
    await bounded(() => inspectContextRuntime(endpoint, true));
    signal?.throwIfAborted();
    const inspected = contextRuntime(endpoint.id);
    if (!inspected || inspected.at < now || inspected.at > Date.now() ||
        inspected.configurationRevision !== runtime.configurationRevision ||
        inspected.epoch !== runtime.epoch || inspected.version !== runtime.version) fail();
    const refreshed = await bounded(() => createSelfHostedProbeClient().refresh({
      endpointId: endpoint.id,
      selectedModelId: profile.transportModelId,
      allowPrivateNetwork: endpointAllowsPrivate(endpoint),
    }));
    signal?.throwIfAborted();
    const selected = refreshed.models.find(m => m.id === profile.transportModelId);
    if (!refreshed.connected || refreshed.stale || refreshed.backend !== "ollama" ||
        refreshed.endpointId !== endpoint.id ||
        refreshed.configurationRevision !== endpoint.configurationRevision ||
        refreshed.selectedModelId !== profile.transportModelId ||
        refreshed.observedAt < now || refreshed.observedAt > Date.now() ||
        selected?.digest !== profile.modelRevision || selected?.chat === "unsupported" ||
        contextReasoningIdentity({ ...profile, evidence: selected?.evidence ?? [] }, endpoint) !== record.scope.reasoning ||
        contextReasoningIdentity({ ...profile, evidence: selected?.evidence ?? [] }, endpoint) !== calibration?.scope.reasoning ||
        (selected && contextMetadata({ ...profile, evidence: selected.evidence }, endpoint, "loadedContext") !== record.context) ||
        snapshotContext(state, profile, refreshed) === undefined) fail();
    const eligibility = agentContinuationReasoningMetadata(state, profile, refreshed);
    const acceptedProfile = eligibility.profiles.find(p => p.id === profile.id) ?? profile;
    if (configuredToolState(eligibility, acceptedProfile, record.configuration, Date.now(), record.context) !== "Verified") fail();
    return refreshed;
  } catch { return fail(); }
}

// Only the short-lived reasoning capability metadata may be refreshed from the
// current native cache. Keep the captured profile's native tool proof, identity,
// revisions, overrides and confirmation unmodified. Validate proof on the
// refreshed view: checking the old 300-second reasoning metadata first blocks
// legitimate long-running Agents before the matching fresh metadata can arrive.
export function agentContinuationReasoningMetadata(
  state: SelfHostedState,
  profile: SelfHostedProfile,
  snapshot: ProbeSnapshot | null,
  now = Date.now(),
): SelfHostedState {
  const endpoint = state.endpoints.find(e => e.id === profile.endpointId && e.deletedAt == null);
  const model = snapshot?.models.find(m => m.id === profile.transportModelId);
  if (!endpoint || !snapshot || !model || snapshot.selectedModelId !== profile.transportModelId ||
      snapshot.endpointId !== endpoint.id || snapshot.configurationRevision !== endpoint.configurationRevision ||
      snapshot.stale || !snapshot.connected || model.digest !== profile.modelRevision ||
      snapshot.observedAt > now || now - snapshot.observedAt >= 30_000)
    return state;
  const metrics = new Set(["probe.thinking", "probe.thinkingControls", "probe.thinkingDefault", "probe.trainedForTools"]);
  const current = model.evidence.filter(e => metrics.has(e.metric) &&
    e.confidence === "reported" && ["backend-reported", "advertised"].includes(e.source) &&
    e.scope.transportModelId === profile.transportModelId &&
    e.scope.modelRevision === profile.modelRevision &&
    e.scope.deploymentId === profile.deploymentId &&
    probeEvidenceIsFresh(e, endpoint, snapshot, now));
  // Do not replace only half a reasoning contract or accept duplicates.
  if (["probe.thinking", "probe.thinkingControls", "probe.thinkingDefault"].some(metric =>
    current.filter(e => e.metric === metric).length !== 1)) return state;
  const replacement = new Set(current.map(e => e.metric));
  const merged = { ...state, profiles: state.profiles.map(p => p.id !== profile.id ? p : {
    ...p, evidence: [...p.evidence.filter(e => !replacement.has(e.metric)), ...current],
  }) };
  const freshProfile = merged.profiles.find(p => p.id === profile.id);
  const capturedReasoningConsistent = (record: NonNullable<SelfHostedProfile["toolVerification"]>) => {
    let recorded: unknown;
    try { recorded = JSON.parse(record.scope.reasoning); }
    catch { return false; }
    if (!Array.isArray(recorded) || recorded.length !== 3) return false;
    // Aging metadata may be supplied by the native cache, but a still-fresh
    // contradictory captured value must never be replaced to revive a proof.
    return ["thinking", "thinkingControls", "thinkingDefault"].every((metric, index) => {
      const captured = contextMetadata(profile, endpoint, metric, now, 300_000);
      return captured === undefined || JSON.stringify(captured) === JSON.stringify(recorded[index]);
    });
  };
  // No proof is refreshed or newly granted: a captured record must still be
  // verified under the standard native-tool validators (including scope,
  // epoch, negative observations, context, proof TTL and confirmation).
  const capturedProofStillEligible = freshProfile &&
    [freshProfile.toolVerification, ...(freshProfile.agentToolTierProofs ?? []),
      ...(freshProfile.agentToolConfigurations ?? [])]
      .some(record => record?.status === "verified" &&
        capturedReasoningConsistent(record) &&
        (!record.configuration || (!!record.confirmation && record.confirmation.at <= now && record.confirmation.expiresAt > now)) &&
        configuredToolState(merged, freshProfile, record.configuration, now, record.context) === "Verified");
  return capturedProofStillEligible ? merged : state;
}

const order = [
  "none",
  "minimal",
  "low",
  "medium",
  "on",
  "high",
  "xhigh",
  "max",
];
export function toolEffortCapture(
  state: SelfHostedState,
  profile: SelfHostedProfile,
  configuration?: ToolConfiguration,
): EffortCapture {
  const endpoint = state.endpoints.find(
    (e) => e.id === profile.endpointId && e.deletedAt == null,
  );
  if (!endpoint) throw new Error("Model unavailable");
  const capture = captureEffort(
    profile.id,
    {
      providerId: "ollama",
      transportModelId: profile.transportModelId,
      selfHosted: {
        endpointId: endpoint.id,
        profileId: profile.id,
        configurationRevision: endpoint.configurationRevision,
        allowPrivateNetwork: !!endpoint.allowPrivateNetwork,
        credentialRequired: !!endpoint.credentialRef,
        credentialRef: endpoint.credentialRef,
      },
    },
    undefined,
    state,
  );
  if (!configuration) return capture;
  const explicit = { ...capture, choice: configuration.choice };
  const wire = effortProviderOptions(explicit).ollama?.think;
  if (wire !== configuration.wire)
    throw new Error("Agent reasoning configuration changed");
  return explicit;
}

// Provider omission is candidate zero. Only advertised, wire-distinct alternatives follow.
export function agentToolCandidates(
  state: SelfHostedState,
  profile: SelfHostedProfile,
): ToolConfiguration[] {
  const endpoint = state.endpoints.find(
    (e) => e.id === profile.endpointId && e.deletedAt == null,
  );
  if (
    !endpoint ||
    (endpoint.backendHint ?? endpoint.detectedBackend) !== "ollama"
  )
    return [];
  const capture = toolEffortCapture(state, profile);
  if (capture.capability.status !== "supported") return [];
  const defaultWire = contextMetadata(
    profile,
    endpoint,
    "thinkingDefault",
    Date.now(),
    300_000,
  );
  let candidates: ToolConfiguration[];
  try {
    candidates = order
      .filter((choice) => capture.capability.levels.includes(choice))
      .map((choice) => {
        const wire = effortProviderOptions({ ...capture, choice }).ollama?.think;
        if (typeof wire !== "boolean" && typeof wire !== "string")
          throw new Error("Invalid native reasoning control");
        return { choice, wire };
      });
  } catch {
    return [];
  }
  return candidates
    .sort(
      (a, b) => Number(b.wire === defaultWire) - Number(a.wire === defaultWire),
    )
    .slice(0, 2);
}

export function automaticAgentRecommendation(
  state: SelfHostedState,
  profile: SelfHostedProfile,
  context?: number,
  now = Date.now(),
) {
  if (
    verificationRecord(profile, undefined, context) &&
    configuredToolState(state, profile, undefined, now, context) === "Verified"
  )
    return {
      record: verificationRecord(profile, undefined, context)!,
      configuration: undefined,
      choice: "automatic",
    };
  for (const configuration of agentToolCandidates(state, profile)) {
    const record = verificationRecord(profile, configuration, context);
    if (
      record?.confirmation &&
      record.confirmation.at <= now &&
      record.confirmation.expiresAt > now &&
      configuredToolState(state, profile, configuration, now, context) ===
        "Verified"
    )
      return { record, configuration, choice: configuration.choice };
  }
}

// A logical continuation must verify the context actually used by the first
// batch, not a conservative recommendation recomputed from its aging profile
// snapshot. This does not refresh or grant proof: applyAgentRecommendation still
// validates the original record, scope, runtime epoch, reasoning and TTL.
export function automaticAgentBatchContext(
  state: SelfHostedState,
  profile: SelfHostedProfile,
  view: { override?: unknown; recommended?: number } | undefined,
  logicalContinuation: boolean | undefined,
  retainedRecordId?: string,
) {
  const projected =
    typeof view?.override === "number" ? view.override : view?.recommended;
  if (
    !logicalContinuation ||
    view?.override !== undefined
  )
    return { expected: projected, pinned: undefined };
  // Search exactly the same default-then-confirmed alternatives as production
  // Automatic selection. Each candidate must independently qualify at its OWN
  // recorded context; a verified default must never lend proof to an alternative.
  const records = [
    { record: profile.toolVerification, configuration: undefined },
    ...(profile.agentToolTierProofs ?? []).map(record => ({ record, configuration: record.configuration })),
    ...agentToolCandidates(state, profile).map((configuration) => ({
      record: verificationRecord(profile, configuration), configuration,
    })),
  ];
  if (retainedRecordId) {
    const retained = records.find(({record}) => record?.id === retainedRecordId);
    if (!retained || !retained.record ||
        automaticAgentRecommendation(state, profile, retained.record.context)?.record.id !== retainedRecordId)
      return { expected: projected, pinned: undefined };
    return { expected: retained.record.context, pinned: retained.record.context };
  }
  for (const { record, configuration } of records) {
    if (record?.status !== "verified" || !Number.isSafeInteger(record.context) || record.context <= 0)
      continue;
    const selected = automaticAgentRecommendation(state, profile, record.context);
    if (selected?.record.id === record.id &&
        sameToolConfiguration(selected.configuration, configuration))
      return { expected: record.context, pinned: record.context };
  }
  return { expected: projected, pinned: undefined };
}

// Proof acceptance is not an allocation waiver. A continuation may use its
// original verified context only if the normal request preflight independently
// resolves that same live Ollama runtime target. Otherwise stop before inference.
export function requireAgentContinuationAllocation(
  pinned: number | undefined,
  liveRuntimeTarget: number | undefined,
) {
  if (pinned !== undefined && pinned !== liveRuntimeTarget)
    throw new Error(
      "Automatic Agent working context changed during continuation. Reverify the original context and tools before starting a new run.",
    );
}

export function applyAgentRecommendation(
  state: SelfHostedState,
  profile: SelfHostedProfile,
  context?: number,
  captured?: EffortCapture,
) {
  if (captured?.unresolvedExplicitChoice)
    throw new Error("The saved explicit reasoning choice needs revalidation; Automatic recovery cannot replace it.");
  if (captured && captured.choice !== "automatic") return captured;
  const selected = automaticAgentRecommendation(state, profile, context);
  if (!selected) {
    const now = Date.now();
    // Only stable predicate keys, booleans/null and fixed verdict labels.
    // No model IDs, endpoint URLs, tool payloads or private exception bodies.
    console.warn("agent-automatic-eligibility", {
      default: toolEligibilityPredicates(state, profile, undefined, now, context),
      alternatives: agentToolCandidates(state, profile).map(configuration => {
        const record = verificationRecord(profile, configuration);
        return {
          ...toolEligibilityPredicates(state, profile, configuration, now, context),
          confirmationFresh: record ? !!record.confirmation && record.confirmation.at <= now && record.confirmation.expiresAt > now : null,
        };
      }),
    });
    throw new Error(
      "Automatic Agent configuration is not verified. Use Chat Only or verify tools in model settings.",
    );
  }
  if (!selected.configuration)
    return captured ?? toolEffortCapture(state, profile);
  const effective = toolEffortCapture(state, profile, selected.configuration);
  return {
    ...effective,
    key: captured?.key ?? effective.key,
    automaticAgentRecommendation: selected.record.id,
  };
}

export async function resolveAutomaticAgentTools(
  options: { profileId: string; signal: AbortSignal; force?: boolean },
  deps: {
    refresh: () => Promise<SelfHostedState>;
    inspect: () => Promise<void>;
    context: (state: SelfHostedState, profile: SelfHostedProfile) => number;
    verify: (
      configuration?: ToolConfiguration,
      force?: boolean,
      requestBudget?: ToolRequestBudget,
    ) => Promise<unknown>;
  },
) {
  options.signal.throwIfAborted();
  let state = await deps.refresh();
  await deps.inspect();
  const get = () => {
    const p = state.profiles.find((p) => p.id === options.profileId);
    if (!p) throw new Error("Model unavailable");
    return p;
  };
  let profile = get();
  const endpoint = state.endpoints.find(
    (e) => e.id === profile.endpointId && e.deletedAt == null,
  );
  if (
    !endpoint ||
    !state.inventories?.some(
      (i) =>
        i.endpointId === endpoint.id &&
        i.configurationRevision === endpoint.configurationRevision &&
        i.connected,
    )
  )
    return;
  const scope = toolScope(profile, endpoint),
    context = deps.context(state, profile);
  if (!scope) return;
  const selected = automaticAgentRecommendation(state, profile, context);
  const candidates = agentToolCandidates(state, profile);
  let requests = 0;
  const requestBudget = createToolRequestBudget();
  const verify = async (configuration?: ToolConfiguration, force?: boolean) => {
    if (++requests > TOOL_VERIFICATION.maxRequests)
      throw new Error("Automatic Agent verification bound exceeded");
    options.signal.throwIfAborted();
    await deps.verify(configuration, force, requestBudget);
    options.signal.throwIfAborted();
    state = await deps.refresh();
    await deps.inspect();
    profile = get();
    const currentEndpoint = state.endpoints.find(
      (e) => e.id === profile.endpointId,
    );
    if (
      !currentEndpoint ||
      !sameToolScope(scope, toolScope(profile, currentEndpoint)) ||
      deps.context(state, profile) !== context
    )
      throw new Error("Automatic Agent settings changed during verification");
  };
  if (selected) {
    if (options.force) await verify(selected.configuration, true);
    return;
  }
  await verify(
    undefined,
    options.force &&
      configuredToolState(state, profile, undefined, Date.now(), context) !==
        "Needs attention",
  );
  if (automaticAgentRecommendation(state, profile, context)) return;
  if (
    configuredToolState(state, profile, undefined, Date.now(), context) !==
    "Needs attention"
  )
    return;
  for (const configuration of candidates) {
    const verdict = configuredToolState(
      state,
      profile,
      configuration,
      Date.now(),
      context,
    );
    if (
      verdict === "Needs attention" ||
      verdict === "Unsupported" ||
      verdict === "Incompatible"
    )
      continue;
    const previous = verificationRecord(profile, configuration);
    if (previous?.status === "incomplete" && previous.retryAfter > Date.now())
      return;
    await verify(configuration);
    if (automaticAgentRecommendation(state, profile, context)) return;
    const current = configuredToolState(
      state,
      profile,
      configuration,
      Date.now(),
      context,
    );
    if (current === "Verified") {
      await verify(configuration, true);
      if (automaticAgentRecommendation(state, profile, context)) return;
      if (
        configuredToolState(
          state,
          profile,
          configuration,
          Date.now(),
          context,
        ) !== "Needs attention"
      )
        return;
    } else if (current !== "Needs attention") return;
  }
}
