import { budgetIdentity } from "@/modules/ai/lib/contextBudgetProfile";
import { sameAgentRenewalIdentity } from "@/modules/ai/lib/agentRenewalIdentity";
import { contextRuntime } from "@/modules/ai/lib/contextCalibrationTrust";
import { CONTEXT_CALIBRATION } from "@/modules/ai/lib/contextCalibrationSchema";
import { endpointBackend } from "@/modules/ai/lib/selfHostedProfiles";
import { inspectContextRuntime } from "@/modules/ai/lib/contextRuntimeClient";
import { calibrateModelContext } from "@/modules/ai/lib/contextCalibrationRuntime";
import { automaticAgentRecommendation } from "@/modules/ai/lib/agentConfiguration";
import { freshVerifiedContextTiers } from "@/modules/ai/lib/minimumSafeContext";
import { profileSnapshot } from "@/modules/ai/lib/modelOnboarding";
import { createSelfHostedProbeClient } from "@/modules/ai/lib/selfHostedProbe";
import { endpointAllowsPrivate, selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { readToolProfiles, ensureVerifiedAgentTier } from "@/modules/ai/lib/toolVerificationRuntime";
import { verificationRecord, sameToolConfiguration } from "@/modules/ai/lib/toolVerification";
import type { ToolVerification } from "@/modules/ai/lib/toolVerificationSchema";
import type { SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";

/** Only request a new calibration at a safe provider-step boundary, never
 * interrupt an admitted generation or silently extend an old evidence lease. */
export const AGENT_CALIBRATION_RENEWAL_LEAD_MS = 30_000;
export function agentCalibrationRenewalDue(
  expiresAt: number | undefined,
  now = Date.now(),
  minimumRemainingMs = AGENT_CALIBRATION_RENEWAL_LEAD_MS,
) {
  return expiresAt !== undefined && expiresAt <= now + minimumRemainingMs;
}

type Renewal = { state: SelfHostedState; proof: ToolVerification };
type Dependencies = {
  read: typeof readToolProfiles;
  inspect: typeof inspectContextRuntime;
  calibrate: typeof calibrateModelContext;
  verify: typeof ensureVerifiedAgentTier;
  snapshot: typeof createSelfHostedProbeClient;
};
const production: Dependencies = {
  read: readToolProfiles,
  inspect: inspectContextRuntime,
  calibrate: calibrateModelContext,
  verify: ensureVerifiedAgentTier,
  snapshot: createSelfHostedProbeClient,
};

/**
 * One bounded, real qualification of the *same* exact Agent tier.
 * No loops, no promotion to a different digest/epoch/reasoning/tool variant.
 * The old proof is only retained if it remains independently eligible; when
 * expired, the existing native-tier verifier issues a genuinely new proof.
 */
export async function renewAgentCalibrationAtBoundary(
  state: SelfHostedState,
  profileId: string,
  retained: ToolVerification,
  signal: AbortSignal,
  isCurrent: () => boolean = () => !signal.aborted,
  deps: Dependencies = production,
  minimumRemainingMs = AGENT_CALIBRATION_RENEWAL_LEAD_MS,
): Promise<Renewal> {
  const stop = () => {
    signal.throwIfAborted();
    if (!isCurrent()) throw new Error("Agent calibration renewal owner changed. No inference was sent.");
  };
  const fail = (reason: string): never => {
    throw new Error(`Agent calibration renewal unavailable: ${reason}. No Agent inference was sent.`);
  };
  if (!Number.isSafeInteger(minimumRemainingMs) || minimumRemainingMs < 0 ||
      minimumRemainingMs > CONTEXT_CALIBRATION.evidenceMs)
    return fail("requested evidence horizon is invalid");
  stop();
  const original = state.profiles.find(p => p.id === profileId);
  const originalEndpoint = state.endpoints.find(e => e.id === original?.endpointId && e.deletedAt == null);
  if (!original || !originalEndpoint || !original.contextCalibration ||
      original.overrides.workingContext ||
      endpointBackend(originalEndpoint) !== "ollama" ||
      !Number.isSafeInteger(retained.context) || retained.context <= 0 ||
      retained.scope.digest !== original.modelRevision ||
      retained.scope.model !== original.transportModelId ||
      retained.scope.endpointId !== originalEndpoint.id ||
      retained.scope.configurationRevision !== originalEndpoint.configurationRevision ||
      retained.scope.runtimeEpoch !== original.contextCalibration.scope.runtimeEpoch ||
      retained.scope.providerVersion !== original.contextCalibration.scope.providerVersion ||
      retained.scope.reasoning !== original.contextCalibration.scope.reasoning ||
      verificationRecord(original, retained.configuration, retained.context)?.id !== retained.id)
    return fail("captured model, calibration or native-tool proof differs");

  const capturedBudgetIdentity = budgetIdentity(state, profileId);
  const originalScope = JSON.stringify(retained.scope);
  const configuration = retained.configuration;
  const validate = (current: SelfHostedState, requireRetained = false) => {
    const p = current.profiles.find(p => p.id === profileId);
    const e = current.endpoints.find(e => e.id === originalEndpoint.id && e.deletedAt == null);
    const runtime = contextRuntime(originalEndpoint.id);
    if (!p || !e ||
        (budgetIdentity(current, profileId) !== capturedBudgetIdentity &&
          !sameAgentRenewalIdentity(state, current, profileId)) ||
        !runtime || runtime.at > Date.now() || Date.now() - runtime.at >= 30_000 ||
        runtime.epoch !== retained.scope.runtimeEpoch ||
        runtime.version !== retained.scope.providerVersion ||
        runtime.configurationRevision !== e.configurationRevision)
      return fail("runtime or captured endpoint/model identity changed");
    if (requireRetained) {
      const proof = verificationRecord(p, configuration, retained.context);
      if (!proof || proof.id !== retained.id || JSON.stringify(proof.scope) !== originalScope ||
          !sameToolConfiguration(proof.configuration, configuration))
        return fail("retained native-tool verification was replaced");
    }
    return p;
  };

  // Read the authoritative persistent settings and inspect process identity
  // BEFORE spending any qualification inference; never renew across an epoch.
  await deps.inspect(originalEndpoint, true);
  stop();
  let current = await deps.read();
  let profile = validate(current, true);
  const expiry = profile.contextCalibration?.expiresAt;
  if (!agentCalibrationRenewalDue(expiry, Date.now(), minimumRemainingMs)) {
    const snapshot = profileSnapshot(current, profile);
    if (freshVerifiedContextTiers(current, profile, snapshot).includes(retained.context)) {
      const proof = automaticAgentRecommendation(current, profile, retained.context);
      if (proof?.record.id === retained.id &&
          sameToolConfiguration(proof.configuration, configuration)) return { state: current, proof: proof.record };
    }
    return fail("live calibration or retained proof is unavailable");
  }
  if (!profile.contextCalibration ||
      profile.contextCalibration.scope.runtimeEpoch !== retained.scope.runtimeEpoch ||
      profile.contextCalibration.scope.providerVersion !== retained.scope.providerVersion ||
      profile.contextCalibration.scope.digest !== retained.scope.digest ||
      profile.contextCalibration.scope.reasoning !== retained.scope.reasoning ||
      profile.contextCalibration.status !== "verified")
    return fail("calibration scope changed");

  const originalCalibrationUpdate = profile.contextCalibration.updatedAt;
  const result = await deps.calibrate({
    state: current, profileId, signal, renewalTier: retained.context, force: true,
  });
  stop();
  if (!result || !("status" in result) || result.status !== "verified" ||
      !("highest" in result) || result.highest !== retained.context)
    return fail("exact-tier requalification did not complete");
  current = await deps.read();
  profile = validate(current, true);
  if (!profile.contextCalibration || profile.contextCalibration.id !== result.id ||
      profile.contextCalibration.status !== "verified" ||
      profile.contextCalibration.highest !== retained.context ||
      profile.contextCalibration.updatedAt <= originalCalibrationUpdate ||
      profile.contextCalibration.expiresAt <= Date.now())
    return fail("new exact-tier calibration was not persisted");

  // This is not a proof waiver: only the existing real native verifier may
  // replace a proof, and it must keep the exact captured variant and scope.
  const selected = automaticAgentRecommendation(current, profile, retained.context);
  if (!selected || !sameToolConfiguration(selected.configuration, configuration)) {
    current = await deps.verify(current, selfHostedSelectionId(original),
      retained.context, configuration, signal);
    stop();
  }
  await deps.inspect(originalEndpoint, true);
  stop();
  current = await deps.read();
  profile = validate(current);
  // Verification can change the Ollama loaded KV allocation. Read or refresh
  // native provider metadata again; never fabricate the allocation receipt.
  const probe = deps.snapshot();
  const probeOptions = {
    endpointId: originalEndpoint.id,
    selectedModelId: original.transportModelId,
    allowPrivateNetwork: endpointAllowsPrivate(originalEndpoint),
  };
  let snapshot = await probe.read(probeOptions);
  if (!snapshot || snapshot.stale || !snapshot.connected ||
      snapshot.observedAt > Date.now() || Date.now() - snapshot.observedAt >= 30_000 ||
      !freshVerifiedContextTiers(current, profile, snapshot).includes(retained.context))
    snapshot = await probe.refresh(probeOptions);
  stop();
  if (!freshVerifiedContextTiers(current, profile, snapshot).includes(retained.context))
    return fail("fresh loaded allocation or calibrated context is missing");
  // Requalification is not complete merely because a lease was valid midway
  // through the native checks. A slow verification must still leave the
  // requested bounded preparation horizon at the actual safe boundary.
  if (!profile.contextCalibration ||
      profile.contextCalibration.expiresAt <= Date.now() + minimumRemainingMs)
    return fail("renewed exact-tier lease cannot cover bounded preparation");
  const renewedProof = automaticAgentRecommendation(current, profile, retained.context);
  if (!renewedProof || !sameToolConfiguration(renewedProof.configuration, configuration) ||
      JSON.stringify(renewedProof.record.scope) !== originalScope)
    return fail("exact-tier native proof is stale or identity changed");
  return { state: current, proof: structuredClone(renewedProof.record) };
}
