/** Isolated, verifier-only WebView. All inference/trust/settlement is owned by
 * normal production calibration and native-tool verification. No Agent import,
 * session, mission, artificial tool result, alternate model or retry here. */
import { Channel, invoke } from "@tauri-apps/api/core";
import { calibrateModelContext } from "@/modules/ai/lib/contextCalibrationRuntime";
import { contextRuntime, snapshotContext, trustedContext } from "@/modules/ai/lib/contextCalibrationTrust";
import { profileBudgetLimits } from "@/modules/ai/lib/contextBudgetProfile";
import { createSelfHostedProbeClient } from "@/modules/ai/lib/selfHostedProbe";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { saveSelfHostedModel } from "@/modules/ai/lib/selfHostedModels";
import { updateSelfHostedProfiles } from "@/modules/settings/store";
import { readToolProfiles, verifyModelTools } from "@/modules/ai/lib/toolVerificationRuntime";
import { freshVerifiedContextTiers } from "@/modules/ai/lib/minimumSafeContext";
import { classifyR5hFailure } from "../../scripts/r5h-failure-classify.mjs";
import { installOllamaParserFailureObserver, type OllamaParserFailure } from "@/modules/ai/lib/ollamaParserFailureDiagnostics";

const id = "muse-glimmer:30b";
const digest = "de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1";
const tier = 73728;
const configuration = new URL(location.href).searchParams.get("configuration");
if (!configuration) throw new Error("Missing isolated diagnostic configuration");
const config = await (await fetch(configuration)).json() as {
  report: string; realProduct: { phase: string; modelId: string; reasoningChoice: string };
};
if (config.realProduct.phase !== "qualification" || config.realProduct.modelId !== id ||
    config.realProduct.reasoningChoice !== "automatic")
  throw new Error("Verifier-only identity/Automatic mismatch");

type SafeCancel = { requestId: string; at: number; source: string; reason: string;
  initiatingLayer: string; category: string; providerRequestInFlight: boolean };
type StreamInfo = { requestId: string; headersAt: number | null; firstChunkAt: number | null;
  lastChunkAt: number | null; count: number; maxGapMs: number; settledAt: number | null;
  phase: string | null; cancellation: SafeCancel | null };
const streams = new Map<string, StreamInfo>();
// Explicit opt-in scoped to this isolated verifier-only WebView. The observer
// is inert during normal inference and retains at most four bounded failures.
const parserFailures: OllamaParserFailure[] = [];
const removeParserObserver = installOllamaParserFailureObserver(record => {
  if (parserFailures.length < 4) parserFailures.push(record);
});
const descriptor = Object.getOwnPropertyDescriptor(Channel.prototype, "onmessage");
if (!descriptor?.set || !descriptor.get) throw new Error("Native channel interception unavailable");
// This is a passive, acceptance-only diagnostic observer; no payload bytes,
// raw exceptions, headers or tool arguments are recorded or modified.
Object.defineProperty(Channel.prototype, "onmessage", {
  ...descriptor,
  set(callback: (event: unknown) => void) {
    if (typeof callback !== "function") return descriptor.set?.call(this, callback);
    descriptor.set?.call(this, function(this: Channel<unknown>, event: unknown) {
      try {
        const e = event as { kind?: string; requestId?: string; phase?: string; cancellation?: SafeCancel };
        if (typeof e.requestId === "string" && /^inference-[1-9]\d*$/.test(e.requestId)) {
          const s = streams.get(e.requestId) ?? {
            requestId: e.requestId, headersAt: null, firstChunkAt: null, lastChunkAt: null,
            count: 0, maxGapMs: 0, settledAt: null, phase: null, cancellation: null,
          };
          const now = Date.now();
          if (e.kind === "headers") s.headersAt ??= now;
          if (e.kind === "chunk") {
            if (s.lastChunkAt !== null) s.maxGapMs = Math.max(s.maxGapMs, now - s.lastChunkAt);
            s.firstChunkAt ??= now;
            s.lastChunkAt = now;
            s.count++;
          }
          if (e.kind === "settled") {
            s.settledAt = now;
            s.phase = e.phase ?? "unknown";
            if (e.cancellation && e.phase === "cancelled") s.cancellation = {
              requestId: e.cancellation.requestId,
              at: e.cancellation.at, source: e.cancellation.source,
              reason: e.cancellation.reason, initiatingLayer: e.cancellation.initiatingLayer,
              category: e.cancellation.category,
              providerRequestInFlight: e.cancellation.providerRequestInFlight,
            };
          }
          streams.set(e.requestId, s);
        }
      } catch { /* observer never alters an SDK result */ }
      callback.call(this, event);
    });
  },
});

const post = async (route: string, body: unknown) => {
  const response = await fetch(new URL(route, config.report), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Isolated diagnostic collector rejected ${route}`);
};
let phase = "configuration";
let lastDurableStage = "configuration-loaded";
let calibrationRequests = 0;
let gate: Record<string, unknown> = {};
let verifierRecord: unknown = null;
let errorKind = "none";
let toolPass = false;
let epoch: string | null = null;
try {
  await usePreferencesStore.getState().init();
  phase = "profile-snapshot";
  const live = await createSelfHostedProbeClient().refresh({
    endpointId: "real-qwen", selectedModelId: id, allowPrivateNetwork: true,
  });
  if (!live.connected || live.models.find(m => m.id === id)?.digest !== digest)
    throw new Error("Live Muse model identity mismatch");
  await updateSelfHostedProfiles(s => saveSelfHostedModel(s, "real-qwen", id));
  const state = await readToolProfiles();
  const profile = state.profiles.find(p => p.endpointId === "real-qwen" && p.transportModelId === id);
  const endpoint = state.endpoints.find(e => e.id === profile?.endpointId);
  if (!profile || !endpoint || profile.modelRevision !== digest ||
      Object.keys(profile.overrides).length !== 0 || endpoint.configurationRevision !== 1)
    throw new Error("Saved profile identity or Automatic settings changed");
  lastDurableStage = "profile-verified";
  phase = "calibration-invocation";
  const controller = new AbortController();
  // The official optional ceiling runs the seven necessary upward tiers;
  // it does not force a tier, override a profile, or manufacture numeric trust.
  const calibrated = await calibrateModelContext({
    state, profileId: profile.id, signal: controller.signal, ceiling: tier,
    onProgress: record => { calibrationRequests = Math.max(calibrationRequests, record.attempts.length); },
  });
  phase = "numeric-trust-gate";
  const saved = await readToolProfiles();
  const p = saved.profiles.find(x => x.id === profile.id);
  const latest = await createSelfHostedProbeClient().refresh({
    endpointId: endpoint.id, selectedModelId: id, allowPrivateNetwork: true,
  });
  const runtime = contextRuntime(endpoint.id);
  epoch = runtime?.epoch ?? null;
  const now = Date.now();
  const target = p ? snapshotContext(saved, p, latest, now) : undefined;
  const direct = p ? trustedContext(saved, p, now) : undefined;
  const budget = p ? profileBudgetLimits(saved, p.id, latest, now) : {};
  const available = p ? freshVerifiedContextTiers(saved, p, latest, now) : [];
  gate = {
    status: calibrated?.status ?? "missing-result",
    attempts: calibrated && "attempts" in calibrated && Array.isArray(calibrated.attempts) ?
      calibrated.attempts.map(a => ({context:a.context, loaded:a.loaded, outcome:a.outcome})) : [],
    snapshotTrustedTarget: target ?? null, directTrustedTarget: direct ?? null,
    budgetRuntimeTarget: "runtimeTarget" in budget ? budget.runtimeTarget ?? null : null,
    calibrationFresh: !!p?.contextCalibration && p.contextCalibration.expiresAt > now,
    runtimeEpochMatches: !!runtime && p?.contextCalibration?.scope.runtimeEpoch === runtime.epoch,
    loadedContextMatches: !!p && latest.models.find(m=>m.id===id)?.evidence?.some(e=>
      e.metric==="probe.loadedContext" && e.value===tier && e.observedAt!==null && now-e.observedAt<30000),
    numericalRouteQualified: target===tier && direct===tier &&
      "runtimeTarget" in budget && budget.runtimeTarget===tier && available.includes(tier),
  };
  lastDurableStage = "calibration-gate-ack";
  if (gate.status!=="verified" || !gate.numericalRouteQualified ||
      !gate.calibrationFresh || !gate.runtimeEpochMatches || !gate.loadedContextMatches)
    throw new Error("Production fresh 73K numeric trust gate failed");
  phase = "agent-execution"; // Existing strict collector's stage name; NO Agent.
  // One normal native-tool verifier. The isolated native host forbids any
  // second probe or Agent-shaped request even if production would retry.
  try {
    verifierRecord = await verifyModelTools({
      state: await readToolProfiles(), profileId: profile.id,
      signal: controller.signal, tierContext: tier,
    });
  } catch {
    errorKind = "verification-rejected";
  }
  const final = await readToolProfiles();
  const f = final.profiles.find(x => x.id===profile.id);
  const proof = f?.agentToolTierProofs?.find(x => x.context===tier &&
    x.configuration===undefined) ?? null;
  verifierRecord = proof ?? verifierRecord;
  toolPass = !!proof && proof.status === "verified" && proof.outcome === "native-call" &&
    proof.validArguments === true && proof.calls === 1 && !!proof.proof &&
    proof.scope.runtimeEpoch === epoch && proof.scope.digest === digest &&
    proof.scope.providerVersion === "0.40.11";
} catch {
  errorKind = "pre-verifier-or-trust-failure";
} finally {
  removeParserObserver();
  // Distinguish a genuinely successful, enabled observer with zero errors
  // from a collector that was never enabled. Never send prompts or full frames.
  try {
    await post("/evidence", { kind:"r5dh-parser-failures", at:Date.now(), details:{
      installed:true, failures:parserFailures,
    }});
  } catch {
    errorKind = "parser-diagnostic-persistence-failed";
    toolPass = false;
  }
  // Save the new native Settled.cancellation object *before* normal host exit;
  // the host exit cannot retroactively create a verifier cancellation.
  const all = [...streams.values()];
  await post("/evidence", { kind:"verifier-diagnostic", at:Date.now(), details:{
    runtimeEpoch:epoch, trustGate:gate, verifier:verifierRecord && typeof verifierRecord === "object" ? {
      status:(verifierRecord as {status?:string}).status,
      outcome:(verifierRecord as {outcome?:string}).outcome,
      context:(verifierRecord as {context?:number}).context,
      validArguments:(verifierRecord as {validArguments?:boolean}).validArguments,
      calls:(verifierRecord as {calls?:number}).calls,
    }:null,
    allStreams:all, success:toolPass, errorKind,
  }}).catch(() => {});
  const record = verifierRecord as { context?:number;status?:string;outcome?:string;
    validArguments?:boolean;calls?:number;scope?:unknown;proof?:unknown } | null;
  const proof = record && toolPass ? {context:record.context,status:record.status,
    outcome:record.outcome,validArguments:record.validArguments,calls:record.calls,
    scope:record.scope,proof:record.proof}:undefined;
  await post("/report", toolPass ? {
    ok:true, kind:"r5h-acceptance", missionStarted:false, calibrationRequests,
    missionRequests:0, lastDurableStage, nativeDispatchAttempted:true,
    calibrationGate:gate, exactTierProof:proof,
  } : {
    ok:false, kind:"r5h-acceptance", missionStarted:false, calibrationRequests,
    missionRequests:0,
    ...classifyR5hFailure(new Error(errorKind),phase,lastDurableStage,calibrationRequests>0),
    lastDurableStage, nativeDispatchAttempted:calibrationRequests>0,
  }).catch(() => {});
  Object.defineProperty(Channel.prototype, "onmessage", descriptor);
  await invoke("coworking_exit");
}
