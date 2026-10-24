/** Single Qwen3-Coder native-tool qualification. Production calibration and
 * Automatic verification own all inference, context, proof and retry limits.
 * This page never opens an Agent run or executes implementation tools.
 */
import { invoke } from "@tauri-apps/api/core";
import { calibrateModelContext } from "@/modules/ai/lib/contextCalibrationRuntime";
import { contextRuntime, snapshotContext, trustedContext } from "@/modules/ai/lib/contextCalibrationTrust";
import { profileBudgetLimits } from "@/modules/ai/lib/contextBudgetProfile";
import { createSelfHostedProbeClient } from "@/modules/ai/lib/selfHostedProbe";
import { readSelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { verifyModelTools } from "@/modules/ai/lib/toolVerificationRuntime";
import { modelOnboarding } from "@/modules/ai/lib/modelOnboarding";
import { automaticAgentRecommendation } from "@/modules/ai/lib/agentConfiguration";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { classifyR5hFailure } from "../../scripts/r5h-failure-classify.mjs";
import { installR5pCalibrationChannelAudit, R5P_STAGES } from "@/test/r5pCalibrationBoundaryAudit";

const configuration = new URL(location.href).searchParams.get("configuration");
if (!configuration) throw new Error("Qwen qualification configuration missing");
const config = await (await fetch(configuration)).json() as {
  report: string;
  realProduct: { phase: string; modelId: string };
};
if (config.realProduct?.phase !== "qualification" || config.realProduct.modelId !== "qwen3-coder:30b")
  throw new Error("Qwen native qualification identity mismatch");
const send = async (kind: string, details: Record<string, unknown> = {}) => {
  const response = await fetch(new URL("/evidence", config.report), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, at: Date.now(), details }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Qwen qualification evidence rejected");
};
const observe = (stage: string) => {
  if (R5P_STAGES.some(s => s === stage))
    void send("r5p-boundary", { stage }).catch(() => {});
};
const uninstallAudit = installR5pCalibrationChannelAudit(observe);
const heartbeat = setInterval(() => observe("webview-heartbeat"), 15000);
let calibrationRequests = 0;
let gate: Record<string, unknown> = { status: "not-started" };
let lastDurableStage = "none";
let failureStage = "configuration";
let delivered = false;
try {
  await send("r5p-boundary", { stage: "collector-synthetic-ack" });
  await usePreferencesStore.getState().init();
  failureStage = "profile-snapshot";
  const source = readSelfHostedState(new Map(
    await invoke<[string, unknown][]>("self_hosted_profiles_snapshot"),
  ).get("selfHostedInference"));
  const profile = source.profiles.find(p => p.endpointId === "real-qwen" && p.transportModelId === config.realProduct.modelId);
  const endpoint = source.endpoints.find(e => e.id === profile?.endpointId);
  if (!profile || !endpoint ||
      profile.modelRevision !== "06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca" ||
      endpoint.configurationRevision !== 1 || Object.keys(profile.overrides).length !== 0 ||
      profile.contextCalibration || profile.toolVerification || (profile.agentToolConfigurations?.length ?? 0) > 0)
    throw new Error("Qwen saved Automatic profile does not match original unqualified binding");
  lastDurableStage = "profile-verified";
  failureStage = "calibration-start";
  await send("r5h-calibration-start", { savedAutomatic: true });
  lastDurableStage = "calibration-start-ack";
  const controller = new AbortController();
  failureStage = "calibration-invocation";
  const result = await calibrateModelContext({
    state: source, profileId: profile.id, signal: controller.signal,
    onBoundary: observe,
    onProgress: record => {
      calibrationRequests = Math.max(calibrationRequests, record.attempts.length);
      void send("r5h-calibration-progress", {
        attempts: record.attempts.map(a => ({ context: a.context, loaded: a.loaded, outcome: a.outcome })),
      }).catch(() => {});
    },
  });
  observe("calibration-returned");
  failureStage = "loaded-context-refresh";
  const current = readSelfHostedState(new Map(
    await invoke<[string, unknown][]>("self_hosted_profiles_snapshot"),
  ).get("selfHostedInference"));
  const fresh = current.profiles.find(p => p.id === profile.id);
  const live = await createSelfHostedProbeClient().refresh({
    endpointId: endpoint.id, selectedModelId: profile.transportModelId, allowPrivateNetwork: true,
  });
  const runtime = contextRuntime(endpoint.id);
  const now = Date.now();
  const target = fresh ? snapshotContext(current, fresh, live, now) : undefined;
  const direct = fresh ? trustedContext({
    ...current, inventories: [{
      endpointId: live.endpointId, configurationRevision: live.configurationRevision,
      observedAt: live.observedAt, connected: live.connected, backend: live.backend, models: live.models,
    }],
  }, { ...fresh, evidence: live.models.find(m => m.id === fresh.transportModelId)?.evidence ?? [] }, now) : undefined;
  const limits = fresh ? profileBudgetLimits(current, fresh.id, live, now) : {};
  const budget = "runtimeTarget" in limits ? limits.runtimeTarget : undefined;
  const loadedMatches = typeof target === "number" && live.models.find(m => m.id === profile.transportModelId)?.evidence.some(
    e => e.metric === "probe.loadedContext" && e.value === target && e.observedAt !== null && now - e.observedAt < 30000,
  ) === true;
  failureStage = "numeric-trust-gate";
  gate = {
    status: result?.status ?? "missing-result",
    attempts: result && "attempts" in result && Array.isArray(result.attempts) ?
      result.attempts.map(a => ({ context: a.context, loaded: a.loaded, outcome: a.outcome })) : [],
    calibrationFresh: !!fresh?.contextCalibration && fresh.contextCalibration.expiresAt > now,
    runtimeEpochMatches: !!runtime && fresh?.contextCalibration?.scope.runtimeEpoch === runtime.epoch,
    loadedContextMatches: loadedMatches,
    snapshotTrustedTarget: target ?? null, directTrustedTarget: direct ?? null,
    budgetRuntimeTarget: typeof budget === "number" ? budget : null,
    numericalRouteQualified: typeof target === "number" && target === direct && target === budget &&
      loadedMatches && result?.status === "verified",
  };
  await send("r5h-calibration-gate", gate);
  lastDurableStage = "calibration-gate-ack";
  // A failure ends the ONE attempt rather than inferring authority or retrying.
  if (gate.numericalRouteQualified) {
    failureStage = "agent-execution"; // shared strictly sanitized failure-stage contract
    await send("r5ad-tool-verification-start");
    await verifyModelTools({ state: current, profileId: profile.id, signal: controller.signal, resolveAutomatic: true });
    const final = readSelfHostedState(new Map(
      await invoke<[string, unknown][]>("self_hosted_profiles_snapshot"),
    ).get("selfHostedInference"));
    const qualified = final.profiles.find(p => p.id === profile.id);
    const view = qualified ? modelOnboarding(final, qualified) : null;
    const selected = qualified ? automaticAgentRecommendation(final, qualified, target) : undefined;
    await send("r5ad-tool-verification-complete", {
      verdict: view?.tools ?? "Unverified",
      agentEligible: !!selected,
      defaultOutcome: qualified?.toolVerification?.outcome ?? "none",
      alternativeCount: qualified?.agentToolConfigurations?.length ?? 0,
    });
  }
  failureStage = "final-report";
  const response = await fetch(config.report, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: true, kind: "r5h-acceptance", missionStarted: false, calibrationRequests,
      missionRequests: 0, lastDurableStage, nativeDispatchAttempted: calibrationRequests > 0,
      calibrationGate: gate, correctionSent: false, sessions: [], cloudInference: 0,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Qwen final report not acknowledged");
  delivered = true;
} catch (error) {
  if (!delivered) {
    observe("final-report-attempt");
    const response = await fetch(config.report, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: false, kind: "r5h-acceptance", missionStarted: false, calibrationRequests,
        missionRequests: 0, ...classifyR5hFailure(error, failureStage, lastDurableStage, calibrationRequests > 0),
      }),
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    delivered = response?.ok === true;
  }
} finally {
  clearInterval(heartbeat);
  uninstallAudit();
  await invoke("coworking_exit");
}
