/** One isolated production-Agent continuation reliability observation.
 * Native calibration, tool verification, recovery checkpoint and request
 * preflight are never mocked. The sole synthetic provider timeout is injected
 * at the existing native Channel ingress after genuine Agent tool receipts.
 * Only scalar authority/request metadata is reported.
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import { createRoot } from "react-dom/client";
import { AgentRunBridge } from "@/modules/ai/components/AgentRunBridge";
import { calibrateModelContext } from "@/modules/ai/lib/contextCalibrationRuntime";
import { createSelfHostedProbeClient } from "@/modules/ai/lib/selfHostedProbe";
import { readToolProfiles, ensureSelectedTools } from "@/modules/ai/lib/toolVerificationRuntime";
import { createSelfHostedEndpoint, addSelfHostedEndpoint, emptySelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { saveSelfHostedModel, selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { modelOnboarding, profileSnapshot } from "@/modules/ai/lib/modelOnboarding";
import { freshVerifiedContextTiers } from "@/modules/ai/lib/minimumSafeContext";
import { COMPACTION_POLICY } from "@/modules/ai/lib/compactionExtraction";
import { useContextCalibrationJobs } from "@/modules/ai/store/contextCalibrationJobs";
import { installPreparationObserver, type PreparationObservation } from "@/modules/ai/lib/preparationLifecycle";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { updateSelfHostedProfiles, setAgentPermissionProfiles } from "@/modules/settings/store";
import { useChatStore, chats } from "@/modules/ai/store/chatStore";
import { useAgentsStore } from "@/modules/ai/store/agentsStore";
import { prepareSessionChat, sendMessageToSession } from "@/modules/ai/store/chatRuntime";
import { createConversationProfile, saveSessionsList, type SessionMeta } from "@/modules/ai/lib/sessions";
import { native } from "@/modules/ai/lib/native";

type Config = { mode: string; runId: string; workspace: string; server: string; model: string; digest: string; report: string };
// Keep reporting errors observable without a direct throw in the outer
// completion finally block; native exit still runs even when reporting fails.
async function reportAndExit(report: string, result: Record<string, unknown>) {
  try {
    const response = await fetch(report, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(result), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Metadata-only final report rejected");
  } finally {
    await invoke("coworking_exit");
  }
}
const configUrl = new URL(location.href).searchParams.get("configuration");
if (!configUrl) throw new Error("Missing isolated test configuration");
const cfg = await fetch(configUrl, { signal: AbortSignal.timeout(8_000) }).then(r => r.json()) as Config;
if (cfg.mode !== "single-real-agent-recovery" || cfg.model !== "muse-glimmer:30b" ||
    !("__TAURI_INTERNALS__" in window)) throw new Error("Not an authorized isolated native host");

const endpointId = "continuation-reliability-ollama";
const sessionId = "controlled-continuation-1";
const horizonMs = COMPACTION_POLICY.timeoutMs * COMPACTION_POLICY.maxModelAttemptsPerPreparation + 30_000;
const observations: Array<Record<string, unknown>> = [];
const add = (phase: string, detail: Record<string, unknown> = {}) => {
  if (observations.length < 300) observations.push({ at: Date.now(), phase, ...detail });
};
const calibrationMeta = (profile: Awaited<ReturnType<typeof readToolProfiles>>["profiles"][number] | undefined) => profile?.contextCalibration && ({
  id: profile.contextCalibration.id, updatedAt: profile.contextCalibration.updatedAt,
  expiresAt: profile.contextCalibration.expiresAt, highest: profile.contextCalibration.highest,
  runtimeEpoch: profile.contextCalibration.scope.runtimeEpoch,
  digest: profile.contextCalibration.scope.digest,
});
const proofMeta = (profile: Awaited<ReturnType<typeof readToolProfiles>>["profiles"][number] | undefined) => profile?.toolVerification && ({
  id: profile.toolVerification.id, context: profile.toolVerification.context,
  runtimeEpoch: profile.toolVerification.scope.runtimeEpoch,
  digest: profile.toolVerification.scope.digest,
  expiresAt: profile.toolVerification.proof?.expiresAt ?? null,
});
let stage = "host-preparation";
let originalCalibration: ReturnType<typeof calibrationMeta> | undefined;
let originalProof: ReturnType<typeof proofMeta> | undefined;
let contractedOriginalExpiry: number | null = null;
let originalRemainingAtRecoveryMs: number | null = null;
let renewalAt: number | null = null;
let renewalStartedAt: number | null = null;
let beforeCompactionMs: number | null = null;
let afterCompactionMs: number | null = null;
let renewed: ReturnType<typeof calibrationMeta> | undefined;
let finalTier: number[] = [];
let injected = false;
let armed = false;
let targetRequestId: string | null = null;
let injectedError: string | null = null;
let recoveryCheckpointAt: number | null = null;
let recoveryCheckpoint: Record<string, unknown> | null = null;
let recoveryPhase: string | null = null;
let runState: string | null = null;
let runIdentity: string | null = null;
let initialCompletedTools = 0;
let completedToolsAfter = 0;
let extractionInFlight = false;
let extractorCreated = false;
let extractionDeadlineArms = 0;
let simulatedFirstExtractionTimeout = false;
let lastErrorCode: string | null = null;

const countCompleted = () => (chats.get(sessionId)?.messages ?? []).flatMap(message => message.parts)
  .filter(part => part.type.startsWith("tool-") && "state" in part && part.state === "output-available").length;
const currentProfile = () => usePreferencesStore.getState().selfHostedInference.profiles
  .find(p => p.endpointId === endpointId && p.transportModelId === cfg.model);

const detachPreparation = installPreparationObserver((event: PreparationObservation) => {
  if (event.sessionId !== sessionId) return;
  const scalar = {
    nativeRequestId: event.nativeRequestId ?? null,
    attempt: event.attempt ? {
      attempt: event.attempt.attempt, reason: event.attempt.reason,
      deadlineMs: event.attempt.deadlineMs, settlement: event.attempt.settlement ?? null,
      validation: event.attempt.validation ?? null,
    } : null,
  };
  add(event.phase, scalar);
  if (event.phase === "extractor-created" && recoveryPhase === "dispatched") extractorCreated = true;
  if (event.phase === "extraction-attempt-start") extractionInFlight = true;
  if (event.phase === "extraction-attempt-end") extractionInFlight = false;
  if (event.phase === "agent-prepare-start" && recoveryPhase) {
    const p = currentProfile();
    if (p?.contextCalibration) beforeCompactionMs = p.contextCalibration.expiresAt - Date.now();
  }
  if (event.phase === "agent-prepare-completed" && recoveryPhase) {
    const p = currentProfile();
    if (p?.contextCalibration) afterCompactionMs = p.contextCalibration.expiresAt - Date.now();
  }
});

const descriptor = Object.getOwnPropertyDescriptor(Channel.prototype, "onmessage");
if (!descriptor?.set || !descriptor.get) throw new Error("Native Channel ingress unavailable");
type NativeEvent = { requestId?: string; kind?: string; phase?: string; error?: { code: string } };
Object.defineProperty(Channel.prototype, "onmessage", {
  ...descriptor,
  set(callback: (event: NativeEvent) => void) {
    descriptor.set?.call(this, function(this: Channel<NativeEvent>, event: NativeEvent) {
      const requestId = event.requestId;
      if (event.kind === "preflight" && recoveryPhase === "dispatched")
        add("recovered-native-continuation-preflight", { nativeRequestId: requestId ?? null });
      if (requestId && targetRequestId === requestId) {
        // Prevent the real response from racing the synthetic *first-output*
        // terminal. The actual native request is cancelled and drained.
        return;
      }
      const complete = countCompleted();
      const currentRun = useChatStore.getState().sessions.find(s => s.id === sessionId)?.run;
      if (!injected && (armed || complete >= 3) && !extractionInFlight &&
          currentRun?.state === "running" && currentRun.agentId === "builtin:coder" &&
          event.kind === "headers" &&
          typeof requestId === "string" && /^inference-[1-9]\d*$/.test(requestId)) {
        injected = true;
        armed = true;
        initialCompletedTools = complete;
        targetRequestId = requestId;
        add("controlled-first-output-injection-start", { nativeRequestId: requestId,
          completedTools: complete });
        // The original state was conservatively shortened *before* capture
        // of the Agent run. No profile/permission mutation occurs here.
        callback.call(this, { requestId, kind: "settled", phase: "timed-out",
          error: { code: "first-output-timeout" } });
        void invoke("ai_http_cancel", { requestId, cancellationOrigin: "stream-consumer" })
          .catch(() => {});
        add("controlled-first-output-injection-complete", { nativeRequestId: requestId });
        return;
      }
      callback.call(this, event);
    });
  },
});

const detachRun = useChatStore.subscribe(state => {
  const session = state.sessions.find(item => item.id === sessionId);
  const run = session?.run;
  if (!run) return;
  runState = run.state;
  runIdentity = `${session.id}:${run.startedAt}`;
  lastErrorCode = run.error?.errorCode ?? null;
  const recovery = run.agentRequestRecovery;
  if (recovery && recovery.phase !== recoveryPhase) {
    recoveryPhase = recovery.phase;
    if (recovery.phase === "preparing" && contractedOriginalExpiry)
      originalRemainingAtRecoveryMs = contractedOriginalExpiry - Date.now();
    add("recovery-state", { recoveryPhase, attempts: recovery.attempts,
      consumedBy: recovery.consumedBy ?? null,
      checkpointToolReceipts: recovery.checkpoint?.toolReceipts.length ?? null,
      checkpointWorkspaceReceipts: recovery.checkpoint?.workspaceReceipts.length ?? null });
  }
  if (recovery?.checkpoint && !recoveryCheckpointAt) {
    recoveryCheckpointAt = Date.now();
    recoveryCheckpoint = {
      runId: recovery.checkpoint.runId, transcriptDigest: recovery.checkpoint.transcriptDigest,
      workspaceRevision: recovery.checkpoint.workspaceRevision,
      tools: recovery.checkpoint.toolReceipts.length,
      workspaceReceipts: recovery.checkpoint.workspaceReceipts.length,
    };
  }
});
const detachCalibrationJobs = useContextCalibrationJobs.subscribe(state => {
  if (recoveryPhase === "dispatched" && state.jobs[endpointId] && !renewalStartedAt) {
    renewalStartedAt = Date.now();
    add("genuine-native-calibration-renewal-start", { remainingOriginalMs:
      contractedOriginalExpiry === null ? null : contractedOriginalExpiry - Date.now() });
  }
});

let phase = "configuration";
let result: Record<string, unknown> = { runId: cfg.runId, ok: false, phase };
let monitor: ReturnType<typeof setInterval> | undefined;
let mounted: ReturnType<typeof createRoot> | undefined;
const originalSetTimeout = globalThis.setTimeout;
// Only the FIRST actual recovery-compaction model attempt receives an early
// delivery of its real 120000-ms deadline callback in this isolated WebView.
// The provider, abort, retry, freshness and trust mechanisms are unchanged.
(globalThis as { setTimeout: typeof setTimeout }).setTimeout = ((handler: TimerHandler,
  timeout?: number, ...args: unknown[]) => {
  if (extractorCreated && recoveryPhase === "dispatched" &&
      timeout === COMPACTION_POLICY.timeoutMs && !simulatedFirstExtractionTimeout) {
    extractionDeadlineArms++;
    if (extractionDeadlineArms === 2) {
      simulatedFirstExtractionTimeout = true;
      add("controlled-extraction-deadline-injected", {
        policyDeadlineMs: COMPACTION_POLICY.timeoutMs,
        injectedDeliveryMs: 3_000, atArm: Date.now(),
      });
      return originalSetTimeout(handler, 3_000, ...args);
    }
  }
  return originalSetTimeout(handler, timeout, ...args);
}) as typeof setTimeout;
try {
  stage = phase = "isolated-native-setup";
  await usePreferencesStore.getState().init();
  const workspace = await native.workspaceAuthorize(cfg.workspace);
  useChatStore.getState().setLive({ ...useChatStore.getState().live,
    getCwd: () => workspace, getWorkspaceRoot: () => workspace, getActiveFile: () => null });
  await useAgentsStore.getState().hydrate();
  await useChatStore.getState().hydrateSessions();
  await updateSelfHostedProfiles(() => addSelfHostedEndpoint(emptySelfHostedState(),
    createSelfHostedEndpoint({ alias: "Isolated continuation reliability",
      baseURL: cfg.server, backendHint: "ollama", allowPrivateNetwork: true }, endpointId)));
  stage = phase = "native-probe";
  const probed = await createSelfHostedProbeClient().refresh({
    endpointId, selectedModelId: cfg.model, allowPrivateNetwork: true });
  if (!probed.connected || probed.models.find(m => m.id === cfg.model)?.digest !== cfg.digest)
    throw new Error("Approved Ollama deployment/digest changed");
  await updateSelfHostedProfiles(s => saveSelfHostedModel(s, endpointId, cfg.model));
  let state = await readToolProfiles();
  const selected = state.profiles.find(p => p.endpointId === endpointId && p.transportModelId === cfg.model);
  if (!selected || selected.modelRevision !== cfg.digest || Object.keys(selected.overrides).length)
    throw new Error("Saved production model binding was not clean and digest-scoped");
  stage = phase = "native-32768-calibration";
  const signal = new AbortController().signal;
  const calibrated = await calibrateModelContext({ state, profileId: selected.id, signal, ceiling: 32768 });
  if (!calibrated || calibrated.status !== "verified" || calibrated.highest !== 32768)
    throw new Error("Genuine exact 32768 calibration unavailable");
  state = await readToolProfiles();
  stage = phase = "native-tool-verification";
  state = await ensureSelectedTools(state, selfHostedSelectionId(selected), signal);
  state = await readToolProfiles();
  const verifiedProfile = state.profiles.find(p => p.id === selected.id);
  const proof = verifiedProfile?.toolVerification;
  const eligibility = verifiedProfile ? modelOnboarding(state, verifiedProfile) : null;
  const tiers = verifiedProfile ? freshVerifiedContextTiers(state, verifiedProfile, profileSnapshot(state, verifiedProfile)) : [];
  if (eligibility?.tools !== "Verified" || !proof || proof.status !== "verified" ||
      proof.outcome !== "native-call" || !proof.proof || proof.context !== 32768 ||
      proof.scope.digest !== cfg.digest || !tiers.includes(32768))
    throw new Error("Automatic Agent native 32768 proof or allocated tier unavailable");
  originalCalibration = calibrationMeta(verifiedProfile);
  originalProof = proofMeta(verifiedProfile);
  if (!originalCalibration || !originalProof) throw new Error("Proof metadata not durable");
  add("automatic-agent-qualified", { originalCalibration, originalProof, requiredTier: 32768 });

  // Conservatively reduce only this *isolated* real calibration lease before
  // run capture. The measured 15-minute lease and its native identity remain
  // recorded above. No new trust, timeout or proof is issued by this fixture.
  // Both the record and its corresponding derived recommendation agree.
  stage = phase = "controlled-original-lease-contraction";
  const artificialExpiry = Math.min(originalCalibration.expiresAt, Date.now() + 165_000);
  if (artificialExpiry >= originalCalibration.expiresAt || artificialExpiry <= Date.now() + 120_000)
    throw new Error("Unable to establish safely bounded original-lease contraction");
  const narrowed = await updateSelfHostedProfiles(s => ({
    ...s, profiles: s.profiles.map(p => p.id === selected.id && p.contextCalibration
      ? { ...p,
          contextCalibration: { ...p.contextCalibration, expiresAt: artificialExpiry },
          recommendations: { ...p.recommendations,
            ...(p.recommendations.workingContext
              ? { workingContext: { ...p.recommendations.workingContext, expiresAt: artificialExpiry } }
              : {}),
          },
        }
      : p),
  }));
  const shortened = narrowed.profiles.find(p => p.id === selected.id)?.contextCalibration;
  if (!shortened || shortened.id !== originalCalibration.id ||
      shortened.highest !== 32768 || shortened.expiresAt !== artificialExpiry)
    throw new Error("Conservative test-only lease contraction was not persisted");
  contractedOriginalExpiry = artificialExpiry;
  add("original-lease-conservatively-shortened", { originalId: shortened.id,
    originalExpiry: originalCalibration.expiresAt, testOnlyExpiry: artificialExpiry,
    remainingMs: artificialExpiry - Date.now() });

  stage = phase = "automatic-agent-admission";
  const permissions = { "builtin:coder": { mode: "trusted-workspace" as const, categories: {} } };
  await setAgentPermissionProfiles(permissions);
  usePreferencesStore.setState({ agentPermissionProfiles: permissions });
  const createdAt = Date.now();
  const session: SessionMeta = { id: sessionId, title: "Isolated Agent continuation authority",
    createdAt, updatedAt: createdAt, profileVersion: 1,
    profile: createConversationProfile({ agentId: "builtin:coder", modelId: selfHostedSelectionId(verifiedProfile),
      workspaceRoot: workspace, workspaceEnvironment: "local" }) };
  useChatStore.setState(s => ({ sessions: [...s.sessions, session], activeSessionId: sessionId }));
  await saveSessionsList(useChatStore.getState().sessions);
  await prepareSessionChat(sessionId);
  mounted = createRoot(document.getElementById("root")!);
  mounted.render(<AgentRunBridge openAiDiffTab={() => null} closeAiDiffTab={() => {}} />);
  stage = phase = "automatic-agent-tools";
  let initialError: string | null = null;
  const submitted = sendMessageToSession(sessionId, { text:
    "This is an isolated reliability check in the CURRENT WORKSPACE only. Read each of the five files one.ts, two.ts, three.ts, four.ts, five.ts using the real read_file tool, one file per tool operation. Do not change files or run shell commands. When all five reads are complete, report only their filenames and that they were read. Continue the same mission if a provider request is interrupted; do not replay finished reads." })
    .catch(error => { initialError = error instanceof Error ? error.message.slice(0, 160) : "initial-send-error"; });
  monitor = setInterval(() => {
    const count = countCompleted();
    if (!armed && count >= 3) {
      initialCompletedTools = count;
      armed = true;
      add("injection-armed-after-genuine-tools", { completedTools: count });
    }
    const c = currentProfile()?.contextCalibration;
    if (c && contractedOriginalExpiry && c.id !== originalCalibration?.id && !renewed) {
      renewed = calibrationMeta(currentProfile());
      renewalAt = Date.now();
      add("genuine-calibration-renewal-observed", { renewed, remainingMs: c.expiresAt - Date.now() });
    }
  }, 100);
  const deadline = Date.now() + 540_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const latest = useChatStore.getState().sessions.find(x => x.id === sessionId)?.run;
    if (injectedError) throw new Error(`Injected terminal could not preserve original authority: ${injectedError}`);
    if (latest?.state === "failed" || latest?.state === "cancelled" || latest?.state === "interrupted") {
      phase = "agent-terminal-state";
      throw new Error(`Controlled Agent stopped at ${latest.state}; errorCode=${latest.error?.errorCode ?? "unknown"}`);
    }
    if (latest?.agentRequestRecovery?.phase === "finished" &&
        latest.state === "completed") break;
    if (!injected && latest?.state === "completed") {
      phase = "provider-timeout-not-reached";
      throw new Error("Agent completed without the authorized single recovery injection");
    }
  }
  await submitted;
  stage = phase = "final-authority-verification";
  const finalSession = useChatStore.getState().sessions.find(x => x.id === sessionId);
  const finalRun = finalSession?.run;
  completedToolsAfter = countCompleted();
  const authoritative = await readToolProfiles();
  const lastProfile = authoritative.profiles.find(p => p.id === selected.id);
  const snapshot = await createSelfHostedProbeClient().refresh({
    endpointId, selectedModelId: cfg.model, allowPrivateNetwork: true });
  finalTier = lastProfile ? freshVerifiedContextTiers(authoritative, lastProfile, snapshot) : [];
  const renewal = calibrationMeta(lastProfile);
  if (renewal && renewal.id !== originalCalibration.id) renewed = renewal;
  const timedOut = finalRun?.agentRequestRecovery;
  const compactionObserved = observations.some(o => o.phase === "extraction-attempt-start" || o.phase === "memory-commit-settled");
  const afterRenewalCompaction = observations.some(o => o.phase === "agent-prepare-completed") &&
    observations.some(o => o.phase === "agent-prepare-start");
  const extractorDeadlineObserved = observations.some(o => o.phase === "extractor-deadline-fired");
  const smallerPrefixRetried = observations.some(o => o.phase === "extraction-timeout-retry");
  const capturedRunUnchanged = !!timedOut?.checkpoint && timedOut.checkpoint.runId === runIdentity;
  const oldLeaseWouldExpireDuringFullExtraction = originalRemainingAtRecoveryMs !== null &&
    originalRemainingAtRecoveryMs > 0 &&
    originalRemainingAtRecoveryMs < COMPACTION_POLICY.timeoutMs;
  const leaseCoverage = !!renewed && renewed.expiresAt - (renewalAt ?? Date.now()) >= horizonMs;
  const pass = injected && initialCompletedTools >= 3 && !!timedOut && timedOut.attempts === 1 &&
    timedOut.phase === "finished" && !!recoveryCheckpoint && !!renewed && renewed.id !== originalCalibration.id &&
    renewed.runtimeEpoch === originalCalibration.runtimeEpoch &&
    renewed.digest === originalCalibration.digest &&
    proofMeta(lastProfile)?.id === originalProof.id &&
    renewed.highest === 32768 && leaseCoverage && finalTier.includes(32768) &&
    afterRenewalCompaction && compactionObserved && simulatedFirstExtractionTimeout &&
    extractorDeadlineObserved && smallerPrefixRetried && oldLeaseWouldExpireDuringFullExtraction &&
    capturedRunUnchanged && completedToolsAfter > initialCompletedTools &&
    finalRun?.state === "completed" && !lastErrorCode;
  result = { runId: cfg.runId, ok: pass, phase: pass ? "completed" : "final-invariants-failed",
    horizonMs, requiredTier: 32768, originalCalibration, contractedOriginalExpiry,
    originalRemainingAtRecoveryMs,
    originalProof, recoveryCheckpoint, recoveryCheckpointAt, recoveryPhase,
    renewalStartAt: renewalStartedAt, renewed, renewalObservedAt: renewalAt,
    renewalRemainingAtObservationMs: renewed && renewalAt ? renewed.expiresAt - renewalAt : null,
    beforeCompactionMs, afterCompactionMs, finalTier,
    simulatedFirstExtractionTimeout, extractorDeadlineObserved, smallerPrefixRetried,
    oldLeaseWouldExpireDuringFullExtraction, capturedRunUnchanged,
    initialCompletedTools, completedToolsAfter, injected, injectionNativeRequestId: targetRequestId,
    initialError, finalRunId: runIdentity, finalState: finalRun?.state ?? "missing",
    lastErrorCode, compactionObserved, observations };
} catch (error) {
  result = { runId: cfg.runId, ok: false, phase, stage,
    errorCode: error && typeof error === "object" && "code" in error ? String(error.code) : null,
    errorName: error instanceof Error ? error.name : "unknown",
    errorMessage: error instanceof Error ? error.message.slice(0, 320) : "unknown",
    horizonMs, requiredTier: 32768, originalCalibration, originalProof,
    contractedOriginalExpiry, renewed, renewalObservedAt: renewalAt,
    originalRemainingAtRecoveryMs,
    recoveryCheckpoint, recoveryCheckpointAt, recoveryPhase,
    beforeCompactionMs, afterCompactionMs, finalTier, injected,
    simulatedFirstExtractionTimeout,
    injectionNativeRequestId: targetRequestId, initialCompletedTools,
    completedToolsAfter: countCompleted(), finalRunId: runIdentity, finalState: runState,
    lastErrorCode, observations };
} finally {
  if (monitor) clearInterval(monitor);
  detachRun(); detachCalibrationJobs(); detachPreparation();
  Object.defineProperty(Channel.prototype, "onmessage", descriptor);
  globalThis.setTimeout = originalSetTimeout;
  await reportAndExit(cfg.report, result);
}
