/** R5h: existing Clack calibration → exact original ForgeBoard Agent acceptance.
 * No trust overrides, model settings changes, tools, synthetic responses or retries.
 */
import { invoke } from "@tauri-apps/api/core";
import { calibrateModelContext } from "@/modules/ai/lib/contextCalibrationRuntime";
import { contextRuntime, snapshotContext, trustedContext } from "@/modules/ai/lib/contextCalibrationTrust";
import { profileBudgetLimits } from "@/modules/ai/lib/contextBudgetProfile";
import { createSelfHostedProbeClient } from "@/modules/ai/lib/selfHostedProbe";
import { readSelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { runRealLocalProduct } from "@/test/r5ahSmokeAgentAcceptance";
import { classifyR5hFailure } from "../../scripts/r5h-failure-classify.mjs";
import { installR5pCalibrationChannelAudit, R5P_STAGES } from "@/test/r5pCalibrationBoundaryAudit";

const configuration = new URL(location.href).searchParams.get("configuration");
if (!configuration) throw new Error("Exclusive R5h configuration missing");
const config = await (await fetch(configuration)).json() as Parameters<typeof runRealLocalProduct>[0];
if (config.realProduct?.phase !== "mission-a" || config.realProduct?.modelId !== "qwen3-coder:30b")
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
  const source = readSelfHostedState(new Map(await invoke<[string, unknown][]>("self_hosted_profiles_snapshot")).get("selfHostedInference"));
  const profile = source.profiles.find(p => p.endpointId === "real-qwen" && p.transportModelId === config.realProduct?.modelId);
  const endpoint = source.endpoints.find(e => e.id === profile?.endpointId);
  if (!profile || !endpoint || profile.overrides.workingContext || Object.keys(profile.overrides).length !== 0
    || endpoint.configurationRevision !== 1 || profile.modelRevision !==
    "06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca")
    throw new Error("Saved Automatic binding changed before normal context calibration");
  lastDurableStage = "profile-verified";
  failureStage = "calibration-start";
  await sendEvent("r5h-calibration-start", { previousExpired: (profile.contextCalibration?.expiresAt ?? 0) <= Date.now(),
    expectedContext: 65536, savedAutomatic: true });
  lastDurableStage = "calibration-start-ack";
  // The existing production calibration owns all probe limits (7 requests,
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
  gate = {
    status: result?.status ?? "missing-result",
    attempts: result && "attempts" in result && Array.isArray(result.attempts)
      ? result.attempts.map(a => ({ context: a.context, outcome: a.outcome, loaded: a.loaded, finish: a.finish })) : [],
    historicalHighest: result && "highest" in result ? result.highest : null,
    expiresAt: fresh?.contextCalibration?.expiresAt ?? null,
    calibrationFresh: !!fresh?.contextCalibration && fresh.contextCalibration.expiresAt > now,
    runtimeEpochMatches: !!runtime && fresh?.contextCalibration?.scope.runtimeEpoch === runtime.epoch,
    runtimeFreshMs: runtime ? now - runtime.at : null,
    loadedContextMatches: !!fresh && live.models.find(m => m.id === fresh.transportModelId)?.evidence?.some(
      e => e.metric === "probe.loadedContext" && e.value === 65536 && e.observedAt !== null && now - e.observedAt < 30000),
    snapshotTrustedTarget: target ?? null,
    directTrustedTarget: directTrust ?? null,
    budgetRuntimeTarget: "runtimeTarget" in limits ? limits.runtimeTarget ?? null : null,
    numericalRouteQualified: target === 65536 && directTrust === 65536 &&
      "runtimeTarget" in limits && limits.runtimeTarget === 65536,
  };
  await sendEvent("r5h-calibration-gate", gate);
  lastDurableStage = "calibration-gate-ack";
  if (!gate.numericalRouteQualified) throw new Error("Normal calibration did not qualify numeric 65536 runtime context");
  missionStarted = true;
  failureStage = "mission-start";
  await sendEvent("r5h-mission-start", { trustedTarget: 65536, calibrationRequests });
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
  uninstallAudit();
  await invoke("coworking_exit");
}
