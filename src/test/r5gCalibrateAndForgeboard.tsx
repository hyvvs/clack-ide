/** R5g: existing Clack calibration → exact original ForgeBoard Agent acceptance.
 * No trust overrides, model settings changes, tools, synthetic responses or retries.
 */
import { invoke } from "@tauri-apps/api/core";
import { calibrateModelContext } from "@/modules/ai/lib/contextCalibrationRuntime";
import { contextRuntime, snapshotContext, trustedContext } from "@/modules/ai/lib/contextCalibrationTrust";
import { profileBudgetLimits } from "@/modules/ai/lib/contextBudgetProfile";
import { createSelfHostedProbeClient } from "@/modules/ai/lib/selfHostedProbe";
import { readSelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { runRealLocalProduct } from "@/test/realLocalProductAcceptance";

const configuration = new URL(location.href).searchParams.get("configuration");
if (!configuration) throw new Error("Exclusive R5g configuration missing");
const config = await (await fetch(configuration)).json() as Parameters<typeof runRealLocalProduct>[0];
if (config.realProduct?.phase !== "mission-a" || config.realProduct?.modelId !== "nemotron-3.5-lightning:30b-a3b-q4_K_M")
  throw new Error("Exclusive saved-model mission identity mismatch");

const sendEvent = async (kind: string, details: Record<string, unknown>) => {
  const response = await fetch(new URL("/evidence", config.report), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, at: Date.now(), details }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Calibration evidence collector rejected event");
};
let missionStarted = false;
let calibrationRequests = 0;
let gate: Record<string, unknown> = { status: "not-started" };
let sentFinal = false;
try {
  await usePreferencesStore.getState().init();
  const source = readSelfHostedState(new Map(await invoke<[string, unknown][]>("self_hosted_profiles_snapshot")).get("selfHostedInference"));
  const profile = source.profiles.find(p => p.endpointId === "real-qwen" && p.transportModelId === config.realProduct?.modelId);
  const endpoint = source.endpoints.find(e => e.id === profile?.endpointId);
  if (!profile || !endpoint || profile.overrides.workingContext || Object.keys(profile.overrides).length !== 0
    || endpoint.configurationRevision !== 1 || profile.modelRevision !==
    "e7a64ff15fb174c42b4f463e5c888c4f2c7b9cabf9e8d65a1c0874405426c1b2")
    throw new Error("Saved Automatic binding changed before normal context calibration");
  await sendEvent("r5g-calibration-start", { previousExpired: (profile.contextCalibration?.expiresAt ?? 0) <= Date.now(),
    expectedContext: 65536, savedAutomatic: true });
  // The existing production calibration owns all probe limits (7 requests,
  // 75s/request, 240s total) and context/epoch decisions. No forced context.
  const controller = new AbortController();
  const result = await calibrateModelContext({
    state: source,
    profileId: profile.id,
    signal: controller.signal,
    onProgress: record => {
      calibrationRequests = Math.max(calibrationRequests, record.attempts.length);
      void sendEvent("r5g-calibration-progress", {
        status: record.status, highest: record.highest,
        attempts: record.attempts.map(a => ({ context: a.context, outcome: a.outcome, loaded: a.loaded, finish: a.finish })),
      }).catch(() => {});
    },
  });
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
  await sendEvent("r5g-calibration-gate", gate);
  if (!gate.numericalRouteQualified) throw new Error("Normal calibration did not qualify numeric 65536 runtime context");
  missionStarted = true;
  await sendEvent("r5g-mission-start", { trustedTarget: 65536, calibrationRequests });
  const resultApp = await runRealLocalProduct(config);
  const report = { ok: true, ...resultApp, calibrationGate: gate, missionStarted: true, calibrationRequests };
  const response = await fetch(config.report, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(report), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Final acceptance report not acknowledged");
  sentFinal = true;
} catch (error) {
  if (!sentFinal) {
    const response = await fetch(config.report, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, calibrationGate: gate, missionStarted, calibrationRequests,
        failureClass: error instanceof Error ? error.name : "unknown",
        failureStage: missionStarted ? "agent-execution-or-report" : "calibration-and-trust" }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    sentFinal = response?.ok === true;
  }
} finally {
  await invoke("coworking_exit");
}
