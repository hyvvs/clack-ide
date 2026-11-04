/** R5ca: normal production calibration/verification of Ornith then unchanged notes mission.
 * No trust overrides, model setting changes, simulated tool calls, or retries.
 */
import { invoke } from "@tauri-apps/api/core";
import { Channel } from "@tauri-apps/api/core";
import { calibrateModelContext } from "@/modules/ai/lib/contextCalibrationRuntime";
import { contextRuntime, snapshotContext, trustedContext } from "@/modules/ai/lib/contextCalibrationTrust";
import { profileBudgetLimits } from "@/modules/ai/lib/contextBudgetProfile";
import { createSelfHostedProbeClient } from "@/modules/ai/lib/selfHostedProbe";
import { readSelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { runRealLocalProduct } from "@/test/forgeboardMuseAgent20261104";
import { ensureSelectedTools, readToolProfiles } from "@/modules/ai/lib/toolVerificationRuntime";
import { selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { saveSelfHostedModel } from "@/modules/ai/lib/selfHostedModels";
import { updateSelfHostedProfiles } from "@/modules/settings/store";
import { modelOnboarding } from "@/modules/ai/lib/modelOnboarding";
import { classifyR5hFailure } from "../../scripts/r5h-failure-classify.mjs";
import { installR5pCalibrationChannelAudit, R5P_STAGES } from "@/test/r5pCalibrationBoundaryAudit";
import { installOllamaParserFailureObserver, type OllamaParserFailure } from "@/modules/ai/lib/ollamaParserFailureDiagnostics";

const configuration = new URL(location.href).searchParams.get("configuration");
if (!configuration) throw new Error("Exclusive R5h configuration missing");
const config = await (await fetch(configuration)).json() as Parameters<typeof runRealLocalProduct>[0];
if (!["mission-a", "qualification"].includes(config.realProduct?.phase ?? "") || config.realProduct?.modelId !== "muse-glimmer:30b")
  throw new Error("Exclusive saved-model mission identity mismatch");

const sendEvent = async (kind: string, details: Record<string, unknown>) => {
  const response = await fetch(new URL("/evidence", config.report), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, at: Date.now(), details }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Calibration evidence collector rejected event");
};
const observe = (stage: string) => {
  if (!R5P_STAGES.some(allowed => allowed === stage)) return;
  void sendEvent("r5p-boundary", { stage }).catch(() => {});
};
// Critical: install BEFORE calibration, not inside runRealLocalProduct().
const uninstallAudit = installR5pCalibrationChannelAudit(observe);
// The committed production parser diagnostics are opted in *only* inside this
// isolated one-shot acceptance WebView. Record failure snapshots immediately
// and finish pending receipts before the host exits; never save normal frames.
const parserFailures: OllamaParserFailure[] = [];
const parserWrites: Promise<unknown>[] = [];
const uninstallParser = installOllamaParserFailureObserver(record => {
  if (parserFailures.length >= 12) return;
  parserFailures.push(record);
  parserWrites.push(sendEvent("r5di-parser-failure", { record }).catch(() => {}));
});
// Acceptance-only second observer: retain the first-cause provenance attached
// by production Rust to Settled. It does not inspect chunk contents or change
// cancellation/timeout behavior, callbacks, or the original Agent mission.
const originDescriptor = Object.getOwnPropertyDescriptor(Channel.prototype, "onmessage");
if (!originDescriptor?.get || !originDescriptor.set) throw new Error("Native channel origin observation unavailable");
// R5df acceptance metadata only. Record actual JS-visible delivery boundaries
// (headers/chunks/settled), not provider text, payload, or SDK internals.
const clientStream = new Map<string, { firstAt:number; previousAt:number; lastAt:number;
  chunks:number; maxGapMs:number; firstChunkAt:number|null }>();
Object.defineProperty(Channel.prototype, "onmessage", {
  ...originDescriptor,
  set(callback: (event: unknown) => void) {
    if (typeof callback !== "function") return originDescriptor.set?.call(this, callback);
    originDescriptor.set?.call(this, function(this: Channel<unknown>, event: unknown) {
      try {
        const e = event as {requestId?:string;kind?:string;phase?:string;cancellation?:{
          requestId:string; at:number;source:string;initiatingLayer:string;reason:string;
          category:string;providerRequestInFlight:boolean;
        }};
        if (typeof e.requestId === "string" && /^inference-[1-9]\d*$/.test(e.requestId)) {
          const at = Date.now();
          if (e.kind === "headers") {
            clientStream.set(e.requestId, { firstAt:at, previousAt:at, lastAt:at,
              chunks:0, maxGapMs:0, firstChunkAt:null });
          } else if (e.kind === "chunk") {
            const trace = clientStream.get(e.requestId);
            if (trace) {
              trace.maxGapMs = Math.max(trace.maxGapMs, at-trace.previousAt);
              trace.previousAt = at; trace.lastAt = at; trace.chunks++;
              if (trace.firstChunkAt === null) trace.firstChunkAt = at;
            }
          } else if (e.kind === "settled") {
            const trace = clientStream.get(e.requestId);
            if (trace) {
              trace.maxGapMs = Math.max(trace.maxGapMs, at-trace.previousAt);
              clientStream.delete(e.requestId);
              void sendEvent("r5di-client-stream", { requestId:e.requestId, phase:e.phase,
                firstAt:trace.firstAt, lastAt:at, firstChunkAt:trace.firstChunkAt,
                chunks:trace.chunks, maxGapMs:trace.maxGapMs }).catch(()=>{});
            }
          }
        }
        if (e.kind==="settled" && e.phase==="cancelled" &&
            typeof e.requestId === "string" && /^inference-[1-9]\d*$/.test(e.requestId)) {
          void sendEvent("r5de-cancellation", {requestId:e.requestId,
            provenance:e.cancellation ?? null}).catch(()=>{});
        }
      } catch { /* diagnostics must never influence the SDK callback */ }
      callback.call(this, event);
    });
  },
});
const heartbeat = setInterval(() => observe("webview-heartbeat"), 15000);
let missionStarted = false;
let calibrationRequests = 0;
let gate: Record<string, unknown> = { status: "not-started" };
let sentFinal = false;
let failureStage = "configuration";
let lastDurableStage = "none";
try {
  // Native/WebView reporter self-test, durably acknowledged before ANY model request.
  await sendEvent("r5p-boundary", { stage: "collector-synthetic-ack" });
  await usePreferencesStore.getState().init();
  failureStage = "profile-snapshot";
  // Normal production metadata onboarding creates the digest-bound profile;
  // save the selected model through Clack's normal production persistence.
  // This is isolated Tauri host data, not the operator's saved settings.
  const discovered = await createSelfHostedProbeClient().refresh({
    endpointId: "real-qwen", selectedModelId: "muse-glimmer:30b", allowPrivateNetwork: true,
  });
  if (!discovered.connected || discovered.models.find(m => m.id === "muse-glimmer:30b")?.digest !==
    "de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1")
    throw new Error("Live Ornith discovery/digest mismatch");
  await updateSelfHostedProfiles(state => saveSelfHostedModel(state, "real-qwen", "muse-glimmer:30b"));
  const source = readSelfHostedState(new Map(await invoke<[string, unknown][]>("self_hosted_profiles_snapshot")).get("selfHostedInference"));
  const profile = source.profiles.find(p => p.endpointId === "real-qwen" && p.transportModelId === config.realProduct?.modelId);
  const endpoint = source.endpoints.find(e => e.id === profile?.endpointId);
  if (!profile || !endpoint || profile.overrides.workingContext || Object.keys(profile.overrides).length !== 0
    || endpoint.configurationRevision !== 1 || profile.modelRevision !==
    "de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1")
    throw new Error("Saved Automatic binding changed before normal context calibration");
  lastDurableStage = "profile-verified";
  failureStage = "calibration-start";
  await sendEvent("r5h-calibration-start", { previousExpired: (profile.contextCalibration?.expiresAt ?? 0) <= Date.now(),
    expectedContext: 73728, savedAutomatic: true });
  lastDurableStage = "calibration-start-ack";
  // The existing production calibration owns all probe limits (8 requests,
  // 75s/request, 240s total) and context/epoch decisions. No forced context.
  const controller = new AbortController();
  failureStage = "calibration-invocation";
  const result = await calibrateModelContext({
    state: source,
    profileId: profile.id,
    signal: controller.signal,
    onBoundary: observe,
    onProgress: record => {
      calibrationRequests = Math.max(calibrationRequests, record.attempts.length);
      void sendEvent("r5h-calibration-progress", {
        status: record.status, highest: record.highest,
        attempts: record.attempts.map(a => ({ context: a.context, outcome: a.outcome, loaded: a.loaded, finish: a.finish })),
      }).catch(() => {});
    },
  });
  observe("calibration-returned");
  failureStage = "calibration-result";
  failureStage = "loaded-context-refresh";
  const current = readSelfHostedState(new Map(await invoke<[string, unknown][]>("self_hosted_profiles_snapshot")).get("selfHostedInference"));
  const fresh = current.profiles.find(p => p.id === profile.id);
  const live = await createSelfHostedProbeClient().refresh({
    endpointId: endpoint.id, selectedModelId: profile.transportModelId, allowPrivateNetwork: true,
  });
  const runtime = contextRuntime(endpoint.id);
  const now = Date.now();
  const target = fresh ? snapshotContext(current, fresh, live, now) : undefined;
  const directTrust = fresh ? trustedContext({
    ...current, inventories: [{ endpointId: live.endpointId, configurationRevision: live.configurationRevision,
      observedAt: live.observedAt, connected: live.connected, backend: live.backend, models: live.models }],
  }, { ...fresh, evidence: live.models.find(m => m.id === fresh.transportModelId)?.evidence ?? [] }, now) : undefined;
  const limits = fresh ? profileBudgetLimits(current, fresh.id, live, now) : {};
  failureStage = "numeric-trust-gate";
  const qualifiedTier = typeof target === "number" ? target : null;
  gate = {
    status: result?.status ?? "missing-result",
    attempts: result && "attempts" in result && Array.isArray(result.attempts)
      ? result.attempts.map(a => ({ context: a.context, outcome: a.outcome, loaded: a.loaded, finish: a.finish })) : [],
    historicalHighest: result && "highest" in result ? result.highest : null,
    expiresAt: fresh?.contextCalibration?.expiresAt ?? null,
    calibrationFresh: !!fresh?.contextCalibration && fresh.contextCalibration.expiresAt > now,
    runtimeEpochMatches: !!runtime && fresh?.contextCalibration?.scope.runtimeEpoch === runtime.epoch,
    runtimeFreshMs: runtime ? now - runtime.at : null,
    loadedContextMatches: !!fresh && qualifiedTier !== null && live.models.find(m => m.id === fresh.transportModelId)?.evidence?.some(
      e => e.metric === "probe.loadedContext" && e.value === qualifiedTier && e.observedAt !== null && now - e.observedAt < 30000),
    snapshotTrustedTarget: target ?? null,
    directTrustedTarget: directTrust ?? null,
    budgetRuntimeTarget: "runtimeTarget" in limits ? limits.runtimeTarget ?? null : null,
    numericalRouteQualified: qualifiedTier !== null && qualifiedTier <= 73728 && directTrust === qualifiedTier &&
      "runtimeTarget" in limits && limits.runtimeTarget === qualifiedTier,
  };
  await sendEvent("r5h-calibration-gate", gate);
  lastDurableStage = "calibration-gate-ack";
  if (!gate.numericalRouteQualified || !gate.loadedContextMatches || !gate.calibrationFresh || !gate.runtimeEpochMatches)
    throw new Error("Normal production calibration did not qualify a fresh matching Ornith runtime context");
  if (config.realProduct.phase === "qualification") {
    // The strict shared acceptance reporter has a fixed stage allowlist.
    // Reuse its existing agent-execution stage; qualification does not launch a mission.
    failureStage = "agent-execution";
    const verified = await ensureSelectedTools(await readToolProfiles(), selfHostedSelectionId(profile), controller.signal);
    const verifiedProfile = verified.profiles.find(p => p.id === profile.id);
    const verdict = verifiedProfile ? modelOnboarding(verified, verifiedProfile)?.tools : "Unverified";
    const proof = verifiedProfile?.toolVerification;
    const epoch = fresh?.contextCalibration?.scope.runtimeEpoch;
    if (verdict !== "Verified" || !proof || proof.status !== "verified" ||
      proof.outcome !== "native-call" || proof.validArguments !== true ||
      !proof.proof || proof.context !== qualifiedTier ||
      proof.scope.digest !== "de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1" ||
      proof.scope.providerVersion !== "0.40.11" || proof.scope.runtimeEpoch !== epoch)
      throw new Error("Exact-tier genuine Ornith native-tool verification was not persistently proven");
    // Re-read native persisted state; do not accept in-memory eligibility alone.
    const persisted = readSelfHostedState(new Map(await invoke<[string, unknown][]>("self_hosted_profiles_snapshot")).get("selfHostedInference"));
    const saved = persisted.profiles.find(p => p.id === profile.id)?.toolVerification;
    if (saved?.id !== proof.id || saved.context !== qualifiedTier || saved.status !== "verified" ||
      saved.outcome !== "native-call" || saved.validArguments !== true || !saved.proof ||
      saved.scope.runtimeEpoch !== epoch || saved.scope.digest !== proof.scope.digest)
      throw new Error("Exact-tier proof did not persist independently in native settings");
    // The proof is persisted by production ensureSelectedTools in the isolated
    // Clack profile; the shared report can only acknowledge known stage labels.
    lastDurableStage = "calibration-gate-ack";
    const response = await fetch(config.report, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, kind: "r5h-acceptance", calibrationGate: gate, missionStarted: false, calibrationRequests,
        missionRequests: 0, lastDurableStage, nativeDispatchAttempted: true,
        nativeToolQualified: true, toolStatus: verdict,
        exactTierProof: { context: saved.context, status: saved.status, outcome: saved.outcome,
          validArguments: saved.validArguments, calls: saved.calls, scope: saved.scope,
          proof: saved.proof } }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Qualification-only report not acknowledged");
    sentFinal = true;
  } else {
  missionStarted = true;
  failureStage = "mission-start";
  await sendEvent("r5h-mission-start", { trustedTarget: qualifiedTier, calibrationRequests });
  lastDurableStage = "mission-start-ack";
  failureStage = "agent-execution";
  const resultApp = await runRealLocalProduct(config);
  failureStage = "final-report";
  const report = { ok: true, kind: "r5h-acceptance", ...resultApp, calibrationGate: gate, missionStarted: true, calibrationRequests,
    missionRequests: 0, lastDurableStage, nativeDispatchAttempted: calibrationRequests > 0 };
  const response = await fetch(config.report, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(report), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Final acceptance report not acknowledged");
  sentFinal = true;
  }
} catch (error) {
  observe("calibration-failed");
  if (!sentFinal) {
    observe("final-report-attempt");
    const response = await fetch(config.report, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, kind: "r5h-acceptance", missionStarted, calibrationRequests,
        missionRequests: 0,
        ...classifyR5hFailure(error, failureStage, lastDurableStage, calibrationRequests > 0) }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    sentFinal = response?.ok === true;
  }
} finally {
  clearInterval(heartbeat);
  uninstallParser();
  await Promise.allSettled(parserWrites);
  await sendEvent("r5di-parser-final", { installed: true, failureCount: parserFailures.length,
    stages: parserFailures.map(f => f.stage) }).catch(() => {});
  clientStream.clear();
  Object.defineProperty(Channel.prototype, "onmessage", originDescriptor);
  uninstallAudit();
  await invoke("coworking_exit");
}
