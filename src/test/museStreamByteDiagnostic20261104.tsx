/** ONE long-stream-only Muse diagnostic. No Agent, ForgeBoard, notes or tools.
 * Official production calibration, model serializer, native proxy, SDK parser.
 * Only task-owned test WebView; no production source or timeout modification.
 */
import { invoke } from "@tauri-apps/api/core";
import { calibrateModelContext } from "@/modules/ai/lib/contextCalibrationRuntime";
import { contextRuntime, snapshotContext, trustedContext } from "@/modules/ai/lib/contextCalibrationTrust";
import { profileBudgetLimits } from "@/modules/ai/lib/contextBudgetProfile";
import { createSelfHostedProbeClient } from "@/modules/ai/lib/selfHostedProbe";
import { readSelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { saveSelfHostedModel } from "@/modules/ai/lib/selfHostedModels";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { updateSelfHostedProfiles } from "@/modules/settings/store";
import { createOllamaModel, ollamaBody } from "@/modules/ai/lib/ollamaModel";
import { verifiedProviderFetch } from "@/modules/ai/lib/answerContinuation";
import { createProxyFetch } from "@/modules/ai/lib/proxyFetch";
import { InferenceTransportError } from "@/modules/ai/lib/inferenceErrors";
import { assertRequestBudget } from "@/modules/ai/lib/contextBudget";

const MODEL = "muse-glimmer:30b";
const DIGEST = "de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1";
const PROMPT = "For one local streaming transport diagnostic, write an extended technical exposition on HTTP streaming delivery boundaries, monotonic byte timing, TCP flow control, and NDJSON framing. Write at least eighty substantive numbered sections, each with several detailed sentences and a concrete hypothetical measurement example. Discuss only generic local networking and diagnostics; do not design, implement, or discuss ForgeBoard or a notes application. Produce the full sections continuously without concluding early.";
const configURL = new URL(location.href).searchParams.get("configuration");
if (!configURL) throw new Error("Diagnostic configuration missing");
const config = await (await fetch(configURL)).json() as {
  report: string;
  server: string;
  realProduct: { phase: string; modelId: string; reasoningChoice: string };
};
if (config.realProduct.phase !== "stream-diagnostic" || config.realProduct.modelId !== MODEL ||
    config.realProduct.reasoningChoice !== "automatic" || config.server !== "http://127.0.0.1:11438")
  throw new Error("Diagnostic model / Automatic / endpoint mismatch");

const post = async (route: string, value: unknown) => {
  const response = await fetch(new URL(route, config.report), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(value), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Diagnostic receipt failed: ${route}`);
};
let calibrationRequests = 0;
let terminal = "pre-calibration-failure";
let errorCode: string | null = null;
let targetStarted = false;
let targetEnded = false;
let gate: Record<string, unknown> = { status: "not-started" };
let target: Record<string, unknown> = {};
const startedAt = Date.now();

try {
  await usePreferencesStore.getState().init();
  const discovered = await createSelfHostedProbeClient().refresh({
    endpointId: "real-qwen", selectedModelId: MODEL, allowPrivateNetwork: true,
  });
  if (!discovered.connected || discovered.models.find(m => m.id === MODEL)?.digest !== DIGEST)
    throw new Error("Live Muse digest mismatch");
  await updateSelfHostedProfiles(state => saveSelfHostedModel(state, "real-qwen", MODEL));
  const source = readSelfHostedState(new Map(await invoke<[string, unknown][]>("self_hosted_profiles_snapshot")).get("selfHostedInference"));
  const profile = source.profiles.find(p => p.endpointId === "real-qwen" && p.transportModelId === MODEL);
  const endpoint = source.endpoints.find(e => e.id === profile?.endpointId);
  if (!profile || !endpoint || profile.modelRevision !== DIGEST ||
      Object.keys(profile.overrides).length !== 0 || endpoint.configurationRevision !== 1)
    throw new Error("Saved profile changed");

  const controller = new AbortController();
  const calibrated = await calibrateModelContext({ state: source, profileId: profile.id,
    signal: controller.signal,
    onProgress: record => { calibrationRequests = Math.max(calibrationRequests, record.attempts.length); },
  });
  const persisted = readSelfHostedState(new Map(await invoke<[string, unknown][]>("self_hosted_profiles_snapshot")).get("selfHostedInference"));
  const fresh = persisted.profiles.find(p => p.id === profile.id);
  const live = await createSelfHostedProbeClient().refresh({
    endpointId: endpoint.id, selectedModelId: MODEL, allowPrivateNetwork: true,
  });
  const runtime = contextRuntime(endpoint.id);
  const now = Date.now();
  const tier = fresh ? snapshotContext(persisted, fresh, live, now) : undefined;
  const trust = fresh ? trustedContext({ ...persisted,
    inventories: [{ endpointId: live.endpointId, configurationRevision: live.configurationRevision,
      observedAt: live.observedAt, connected: live.connected, backend: live.backend, models: live.models }],
  }, { ...fresh, evidence: live.models.find(m => m.id === MODEL)?.evidence ?? [] }, now) : undefined;
  const limits = fresh ? profileBudgetLimits(persisted, fresh.id, live, now) : {};
  gate = {
    status: calibrated?.status ?? "missing-result", highTier: tier ?? null,
    attempts: calibrated && "attempts" in calibrated && Array.isArray(calibrated.attempts)
      ? calibrated.attempts.map(a => ({ context:a.context, loaded:a.loaded, outcome:a.outcome })) : [],
    fresh: !!fresh?.contextCalibration && fresh.contextCalibration.expiresAt > now,
    runtimeEpochMatches: !!runtime && fresh?.contextCalibration?.scope.runtimeEpoch === runtime.epoch,
    trustMatches: tier === 73728 && trust === tier && "runtimeTarget" in limits && limits.runtimeTarget === tier,
    loadedMatches: !!live.models.find(m => m.id === MODEL)?.evidence?.some(e =>
      e.metric === "probe.loadedContext" && e.value === 73728 && e.observedAt !== null && now - e.observedAt < 30000),
  };
  await post("/evidence", { kind: "calibration-result", at: Date.now(), details: gate });
  if (gate.status !== "verified" || !gate.fresh || !gate.runtimeEpochMatches ||
      !gate.trustMatches || !gate.loadedMatches)
    throw new Error("Required production numeric qualification failed; no target request");

  // No secondary verifier/model/Agent. One genuinely serialized Clack native
  // Ollama request with the normal 8,192-output allowance and no tool schemas.
  const params = {
    prompt: [{ role: "user" as const, content: [{ type: "text" as const, text: PROMPT }] }],
    maxOutputTokens: 8192,
    providerOptions: { ollama: { numCtx: 32768 } },
    abortSignal: controller.signal,
  };
  const body = ollamaBody(MODEL, params, true);
  const budget = { runtimeTarget: 32768, maxOutput: 8192, outputReserve: 8192 };
  assertRequestBudget(budget, body);
  if (body.think !== undefined || body.tools !== undefined || body.stream !== true ||
      body.options.num_ctx !== 32768 || body.options.num_predict !== 8192)
    throw new Error("Automatic/native diagnostic serialization changed");

  const sdkCounts: Record<string, number> = {};
  let firstSdkAt: number | null = null;
  let lastSdkAt: number | null = null;
  let maxSdkGapMs = 0;
  let finishObserved = false;
  const native = createOllamaModel({ modelId: MODEL, baseURL: config.server,
    fetch: verifiedProviderFetch(createProxyFetch({ selfHosted: true, allowPrivateNetwork: true,
      admission: { endpointId: endpoint.id, profileId: profile.id, capacity: 1 } })) });
  const startTargetAt = Date.now();
  targetStarted = true;
  await post("/evidence", { kind: "target-start", at: startTargetAt, details: { context:32768, output:8192, thinkKind:"absent", tools:0 } });
  let bound: ReturnType<typeof setTimeout> | undefined;
  try {
    // 630s is safety teardown only. Native 180s idle / 600s overall remain authoritative.
    bound = setTimeout(() => controller.abort(), 630_000);
    const response = await native.doStream(params);
    const reader = response.stream.getReader();
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) { targetEnded = true; break; }
        const at = Date.now();
        firstSdkAt ??= at;
        if (lastSdkAt !== null) maxSdkGapMs = Math.max(maxSdkGapMs, at - lastSdkAt);
        lastSdkAt = at;
        const type = item.value.type;
        sdkCounts[type] = (sdkCounts[type] ?? 0) + 1;
        if (type === "finish") finishObserved = true;
        if (type === "error") throw item.value.error;
      }
    } finally { reader.releaseLock(); }
    terminal = finishObserved && targetEnded ? "completed" : "incomplete";
  } catch (error) {
    terminal = controller.signal.aborted ? "diagnostic-bound-aborted" : "stream-failed";
    errorCode = error instanceof InferenceTransportError ? error.code : "adapter-error";
  } finally {
    if (bound) clearTimeout(bound);
  }
  target = { at: startTargetAt, durationMs: Date.now() - startTargetAt,
    sdkCounts, firstSdkAt, lastSdkAt, maxSdkGapMs, finishObserved, targetEnded,
    outcome: terminal, errorCode };
  await post("/evidence", { kind: "target-finish", at: Date.now(), details: target });
} catch {
  if (!targetStarted) terminal = "pre-target-blocked";
} finally {
  await post("/report", { ok: true, kind: "stream-byte-diagnostic", startedAt,
    endedAt:Date.now(), calibrationRequests, gate, targetStarted, targetEnded,
    outcome:terminal, errorCode, target, cloudInference:0 }).catch(() => {});
  await invoke("coworking_exit");
}
