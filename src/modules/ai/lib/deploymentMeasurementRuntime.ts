import { invoke } from "@tauri-apps/api/core";
import {
  appendLm6Run,
  completeLm6Run,
  lm6AttemptFromSignals,
  lm6ExactScope,
  lm6Failure,
  lm6SingleNativeRequest,
  LM6_MAX_ATTEMPTS,
  type Lm6Attempt,
  type Lm6Run,
  type Lm6Signals,
} from "./deploymentMeasurement";
import {
  MANAGED_QUALIFICATION_EXPECTED,
  MANAGED_QUALIFICATION_PROMPT,
  LM6_WARM_CHAT_PROMPT,
  LM6_CANCEL_CHAT_PROMPT,
  armDeploymentQualification,
  disarmDeploymentQualification,
  observeDeploymentQualificationCancellation,
  observeLm6CancellationQuiescence,
  peekDeploymentQualificationMeasurement,
  waitForRecordedLm6NativeSettlement,
  QualificationOperationDeadline,
  type QualificationFlightSnapshot,
} from "./deploymentQualificationFlight";
import { inspectBoundedChat } from "./deploymentQualificationRuntime";
import { readActivity } from "./activity";
import { readAnswer } from "./answerContinuation";
import type { UIMessage } from "ai";
import { evaluateInstructionAdherence } from "./instructionAdherenceQualification";
import { observedManagedFabric } from "./deploymentQualificationView";
import {
  reconcileLocalComputeFabric,
  type DeploymentRuntimeObservation,
  type LocalComputeFabric,
} from "./localComputeFabric";
import { isManagedLocalSelectionId, resolveManagedLocalSelection } from "./managedLocalModels";
import { admittedManagedLocalRoute, type ManagedLocalNativeStatus } from "./managedLocalRuntime";
import { projectModelResourceProfile } from "./modelResourceProfile";
import { nativeHardwareObservationSchema } from "./hardwareProfile";
import type { SelfHostedState } from "./selfHostedProfiles";
import { chats, useChatStore } from "@/modules/ai/store/chatStore";
import { getOrCreateChat, prepareSessionChat, sendMessageToSession } from "@/modules/ai/store/chatRuntime";
import { awaitSessionWrites, saveMessages } from "./sessions";
import { cancelSessionInference, sessionInference } from "./inferenceLifecycle";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { updateQualifiedSelfHostedProfiles } from "@/modules/settings/store";
import {
  beginNativeQualificationCas, cancelNativeQualificationCas,
  type NativeQualificationCasTicket,
} from "@/modules/settings/selfHostedPersistence";

/** This user-invoked path is limited to a single preselected deployment.
 * It never executes a high-impact tool, retries-to-pass or promotes LM2F.
 * Ordinary Chat and mere popover opening do not call this module's runner. */
const MAX_SINGLE_MS = 65_000;
const MAX_READY_MS = 60_000;
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
let active = false;
let uncertainPreviousMeasurement = false;

type Target = {
  state: SelfHostedState;
  fabric: LocalComputeFabric;
  deploymentId: string;
  selectionId: string;
  observation: DeploymentRuntimeObservation;
  contextTokens: number | null;
  backend: Lm6Run["backend"];
  thermal: "cold" | "warm" | "unknown";
  thermalSource: string;
  provider: "ollama" | "openai-compatible";
  managed: boolean;
  native?: ManagedLocalNativeStatus;
  endpointId?: string;
};

function managedStatus(raw: unknown): ManagedLocalNativeStatus {
  if (!raw || typeof raw !== "object" || typeof (raw as { state?: unknown }).state !== "string")
    throw new Error("Native runtime status unavailable");
  return raw as ManagedLocalNativeStatus;
}

async function readyManaged(status: ManagedLocalNativeStatus, selectionId: string,
  state: SelfHostedState, deadline?: QualificationOperationDeadline,
): Promise<{ status: ManagedLocalNativeStatus; thermal: Target["thermal"] }> {
  const selected = resolveManagedLocalSelection(state, selectionId);
  if (selected.status === "missing" || selected.status === "not-managed")
    throw new Error("Exact Qwen deployment unavailable");
  if (status.state === "Ready") return { status, thermal: "warm" };
  if (!status.installed || status.state !== "Stopped")
    throw new Error("Native runtime cannot be safely started from its current state");
  // This is an existing native lifecycle command. No runtime settings, GPU
  // layers, artifact, permissions, or driver configuration are changed.
  deadline?.assertOpen();
  const started = managedStatus(await invoke("managed_local_runtime_start", {
    deploymentId: selected.deployment.id,
    deploymentIdentity: selected.identity,
  }));
  if (!["Starting", "Loading", "Ready"].includes(started.state))
    throw new Error("Managed runtime start not accepted");
  const until = Date.now() + MAX_READY_MS;
  while (Date.now() < until) {
    deadline?.assertOpen();
    const next = managedStatus(await invoke("managed_local_runtime_status", {
      deploymentId: selected.deployment.id,
      deploymentIdentity: selected.identity,
    }));
    deadline?.assertOpen();
    if (next.state === "Ready") return { status: next, thermal: "cold" };
    if (next.state === "Stopped" || next.state === "Failed")
      throw new Error("Managed runtime did not reach Ready");
    if (deadline) await deadline.within(() => delay(500));
    else await delay(500);
  }
  throw new Error("Managed runtime Ready deadline exceeded");
}

async function targetFor(selectionId: string, allowStart: boolean,
  deadline?: QualificationOperationDeadline): Promise<Target | null> {
  deadline?.assertOpen();
  const state = usePreferencesStore.getState().selfHostedInference;
  if (isManagedLocalSelectionId(selectionId)) {
    const selected = resolveManagedLocalSelection(state, selectionId);
    if (selected.status === "missing" || selected.status === "not-managed") return null;
    const raw = managedStatus(await invoke("managed_local_runtime_status", {
      deploymentId: selected.deployment.id,
      deploymentIdentity: selected.identity,
    }));
    deadline?.assertOpen();
    const ready = allowStart ? await readyManaged(raw, selectionId, state, deadline) : {
      status: raw, thermal: raw.state === "Ready" ? "warm" as const : "unknown" as const,
    };
    const current = observedManagedFabric(state, selectionId, ready.status, Date.now());
    if (!current?.observation)
      return null;
    const resource = projectModelResourceProfile(selected.artifact, selected.runtime, selected.deployment);
    if (resource.executionPlacement.value !== "CPU") return null;
    const digest = selected.artifact.digest;
    if (!digest) return null;
    deadline?.assertOpen();
    await admittedManagedLocalRoute({
      deploymentId: selected.deployment.id,
      deploymentIdentity: selected.identity,
      artifactDigest: digest,
      configurationRevision: selected.deployment.configurationRevision,
    });
    deadline?.assertOpen();
    return {
      state, fabric: current.fabric, deploymentId: selected.deployment.id, selectionId,
      observation: current.observation, contextTokens: resource.configuredContext.value,
      backend: "CPU", thermal: ready.thermal,
      thermalSource: ready.thermal === "cold" ? "native-status-stopped-then-ready"
        : "native-current-deployment-ready",
      provider: "openai-compatible", managed: true, native: ready.status,
    };
  }
  // `self_hosted_context_runtime` verifies the remote Ollama /api/version,
  // but its epoch() originates in Clack's Rust process. It is not the remote
  // Ollama process/model epoch. Without independent remote identity and
  // residency evidence, LM6 must not mark remote runs current or dispatch.
  return null;
}

async function localResourcePoint(): Promise<{
  ram: number | null; vram: number | null;
  ramAt: number | null; vramAt: number | null;
}> {
  try {
    const raw = await invoke<unknown>("local_hardware_observation");
    const validated = nativeHardwareObservationSchema.safeParse(raw);
    if (!validated.success) throw new Error("No validated native host resource observation");
    const value = validated.data;
    const now = Date.now();
    if (value.observedAt > now || now - value.observedAt > 30_000)
      throw new Error("Native host resource observation is stale");
    // A single measured NVIDIA VRAM reading is a host free-memory point,
    // not a process allocation and never an aggregated multi-GPU budget.
    const nvidia = value.gpus.filter(g => g.vendor?.value === "NVIDIA");
    const gpu = nvidia.length === 1 ? nvidia[0].availableVramBytes : null;
    const validVram = !!gpu &&
      gpu.source === "system32-nvidia-smi-readonly-vendor-telemetry" &&
      gpu.observedAt <= now && now - gpu.observedAt <= 30_000;
    return {
      ram: value.source === "native-os-readonly" ? value.availableRamBytes : null,
      vram: validVram ? gpu!.value : null,
      ramAt: value.availableRamBytes !== null ? value.observedAt : null,
      vramAt: validVram ? gpu!.observedAt : null,
    };
  } catch {
    return { ram: null, vram: null, ramAt: null, vramAt: null };
  }
}

/** LM6 never interprets the existence of output as correctness. */
function verifiedResponse(selectionId: string, sessionId: string,
  provider: Target["provider"], prompt: string, flight: QualificationFlightSnapshot | null) {
  if (!flight) return null;
  const final = useChatStore.getState().sessions.find(s => s.id === sessionId);
  if (final?.profile?.modelId !== selectionId ||
      final.profile.agentId !== "builtin:coder" ||
      final.run?.modelId !== selectionId || final.run?.agentId !== "builtin:coder")
    return null;
  return inspectBoundedChat(getOrCreateChat(sessionId).messages, sessionId,
    final.profile.workspaceId, selectionId, flight, prompt, provider);
}

/** A cancelled answer must not be mistaken for a complete Chat, but its own
 * Clack activity receipts can still independently attest one Chat UUID.
 * The native inference-N remains a separate authenticated registry namespace. */
export function lm6CancelledChatRequestId(
  messages: readonly UIMessage[], sessionId: string, workspaceId: string | null,
  modelId: string, prompt: string, provider: string,
): string | null {
  if (messages.length !== 2 || messages[0].role !== "user" ||
      messages[0].parts.length !== 1 || messages[0].parts[0].type !== "text" ||
      messages[0].parts[0].text !== prompt || messages[1].role !== "assistant" ||
      messages[1].parts.some(p => p.type.startsWith("tool-") || p.type === "dynamic-tool"))
    return null;
  const activity = readActivity(messages[1], sessionId, workspaceId);
  const answer = readAnswer(messages[1]);
  if (!activity || !answer || activity.omitted !== 0 ||
      activity.owner.sessionId !== sessionId ||
      activity.owner.workspaceId !== workspaceId ||
      activity.owner.modelId !== modelId ||
      activity.owner.agentId !== "builtin:coder" ||
      activity.owner.providerId !== provider ||
      answer.state !== "incomplete" || answer.segments.length !== 1 ||
      answer.segments[0].finish !== "cancelled" ||
      answer.segments[0].provider !== provider || answer.segments[0].model !== modelId ||
      answer.continuations !== 0 || answer.repairs !== 0 ||
      activity.receipts.some(r => r.kind === "retry" || r.kind === "recovered" || r.kind === "tool"))
    return null;
  const ids = new Set(activity.receipts.filter(r => r.kind === "request" &&
    r.id.startsWith("request:")).map(r => r.id.split(":")[1]));
  if (ids.size !== 1 || !activity.receipts.some(r => r.kind === "request" &&
      r.label === "Request cancelled")) return null;
  const id = [...ids][0];
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

async function boundedSend(sessionId: string, prompt: string, cancellation: boolean) {
  const sent = sendMessageToSession(sessionId, { text: prompt });
  // Prevent unhandled rejections if an explicit bound interrupts the sender.
  let error: unknown = null;
  const finished = sent.then(() => true, reason => { error = reason; return false; });
  if (!cancellation) {
    const done = await Promise.race([finished, delay(MAX_SINGLE_MS).then(() => false)]);
    if (!done) {
      await cancelSessionInference(sessionId, {
        source: "explicit-user", reason: "cancel-requested",
      });
      getOrCreateChat(sessionId).stop();
    }
    return { completedWithoutBound: done, error };
  }
  // One cancellation after the first observed nonempty UI-model delta, or
  // after a fixed short bound when the model never generates output.
  const until = Date.now() + 10_000;
  let startedOutput = false;
  while (Date.now() < until) {
    const snapshot = peekDeploymentQualificationMeasurement(sessionId);
    if (snapshot?.firstMeaningfulAt) { startedOutput = true; break; }
    const completed = await Promise.race([finished, delay(75).then(() => null)]);
    if (completed !== null) break;
  }
  observeDeploymentQualificationCancellation(sessionId);
  await cancelSessionInference(sessionId, {
    source: "explicit-user", reason: "cancel-requested",
  });
  getOrCreateChat(sessionId).stop();
  const acknowledged = await Promise.race([finished, delay(10_000).then(() => false)]);
  return { completedWithoutBound: false, startedOutput, acknowledged, error };
}

/** Fixed 3-attempt plan: cold/unknown first Chat + warm/unknown one Chat +
 * one cancellation. No attempt is repeated to improve a result. */
export async function runBoundedDeploymentMeasurement(
  selectionId: string,
  mode: "standard" | "final-live-three" = "standard",
): Promise<{
  status: "recorded" | "unavailable";
  runId: string | null;
  deploymentId: string | null;
  attempted: number;
}> {
  if (active) throw new Error("A bounded LM6 qualification is already active");
  if (uncertainPreviousMeasurement)
    throw new Error("Prior LM6 native/persistence outcome is unresolved; no automatic re-dispatch");
  active = true;
  const previousSessionId = useChatStore.getState().activeSessionId;
  const previousModelId = useChatStore.getState().selectedModelId;
  let preparingSessionId: string | null = null;
  let casTicket: NativeQualificationCasTicket | null = null;
  const deadline = new QualificationOperationDeadline(300_000, () => {
    if (casTicket)
      void cancelNativeQualificationCas(casTicket).catch(() => undefined);
    if (!preparingSessionId) return;
    void cancelSessionInference(preparingSessionId, {
      source: "explicit-user", reason: "cancel-requested",
    }).catch(() => undefined);
    void chats.get(preparingSessionId)?.stop().catch(() => undefined);
  });
  try {
    if (usePreferencesStore.getState().agentPermissionProfiles["builtin:coder"]?.mode !== "chat-only")
      throw new Error("LM6 requires existing Coder Chat Only; it will not edit permissions");
    const initial = await deadline.within(() => targetFor(selectionId, true, deadline));
    if (!initial) return { status: "unavailable", runId: null, deploymentId: null, attempted: 0 };
    if (!lm6ExactScope(initial.fabric, initial.deploymentId, initial.observation, Date.now()))
      return { status: "unavailable", runId: null, deploymentId: initial.deploymentId, attempted: 0 };
    const startedAt = Date.now();
    const runId = crypto.randomUUID();
    const attempts: Lm6Attempt[] = [];
    // Final-live-three is a separately authorized measurement-only procedure:
    // cold Chat, same-epoch warm Chat, cancellation. Do NOT re-run the known
    // LM2F adherence failure. Existing standard UI procedure is unchanged.
    const procedures = (mode === "final-live-three" ? [
      { kind: "chat" as const, prompt: LM6_WARM_CHAT_PROMPT, cancel: false },
      { kind: "chat" as const, prompt: LM6_WARM_CHAT_PROMPT, cancel: false },
      { kind: "cancellation" as const, prompt: LM6_CANCEL_CHAT_PROMPT, cancel: true },
    ] : [
      { kind: "instruction-adherence" as const, prompt: MANAGED_QUALIFICATION_PROMPT, cancel: false },
      { kind: "chat" as const, prompt: LM6_WARM_CHAT_PROMPT, cancel: false },
      { kind: "cancellation" as const, prompt: LM6_CANCEL_CHAT_PROMPT, cancel: true },
    ]).slice(0, LM6_MAX_ATTEMPTS);
    let unsafeToDispatchAgain = false;
    for (let i = 0; i < procedures.length; i++) {
      deadline.assertOpen();
      const plan = procedures[i];
      if (unsafeToDispatchAgain) {
        const at = Date.now();
        attempts.push(lm6AttemptFromSignals({
          attemptId: `attempt-${i + 1}`, workload: plan.kind,
          thermal: "unknown", thermalSource: "prior-native-settlement-unverified",
          startedAt: at, endedAt: at, result: "unavailable",
          failure: "incomplete-evidence", outputObserved: false, terminalObserved: false,
        }));
        continue;
      }
      const before = await deadline.within(() => targetFor(selectionId, false, deadline));
      // Never transfer evidence after restart/host/config/model changes.
      const stillSame = !!before && before.observation.epoch === initial.observation.epoch &&
        before.deploymentId === initial.deploymentId &&
        JSON.stringify(lm6ExactScope(before.fabric, before.deploymentId, before.observation, Date.now())) ===
        JSON.stringify(lm6ExactScope(initial.fabric, initial.deploymentId, initial.observation, Date.now()));
      const start = Date.now();
      if (!stillSame) {
        attempts.push(lm6AttemptFromSignals({
          attemptId: `attempt-${i + 1}`, workload: plan.kind,
          thermal: "unknown", thermalSource: "runtime-identity-changed",
          startedAt: start, endedAt: start, result: "unavailable",
          failure: "identity-changed", outputObserved: false, terminalObserved: false,
        }));
        continue;
      }
      let sessionId: string | null = null;
      let flight: QualificationFlightSnapshot | null = null;
      let failed: unknown = null;
      let settled = false;
      let sdkActuallySettled = false;
      let cancellationResult: { startedOutput?: boolean; acknowledged?: boolean } = {};
      let noContinuationObserved: boolean | null = null;
      const pointBefore = initial.managed ? await deadline.within(localResourcePoint) :
        { ram: null, vram: null, ramAt: null, vramAt: null };
      let pointDuring: Awaited<ReturnType<typeof localResourcePoint>> =
        { ram: null, vram: null, ramAt: null, vramAt: null };
      try {
        sessionId = useChatStore.getState().newSession();
        preparingSessionId = sessionId;
        // Register the single-use dispatch authority BEFORE session writes,
        // retrieval, provider preparation and native inference registration.
        armDeploymentQualification(sessionId, selectionId, "builtin:coder", {
          expectedPrompt: plan.prompt, measure: true,
          operation: deadline, cancelChallenge: plan.cancel,
        });
        const store = useChatStore.getState();
        if (!store.setSessionModelId(sessionId, selectionId, false) ||
            !store.setSessionAgentId(sessionId, "builtin:coder"))
          throw new Error("Cannot capture bounded LM6 model/persona");
        const session = useChatStore.getState().sessions.find(s => s.id === sessionId);
        if (session?.profile?.modelId !== selectionId ||
            session.profile.agentId !== "builtin:coder" ||
            (session.fallback?.mode && session.fallback.mode !== "never"))
          throw new Error("LM6 Chat not bound to exact model with fallback disabled");
        await deadline.within(() => awaitSessionWrites(sessionId!));
        await deadline.within(() => prepareSessionChat(sessionId!));
        deadline.assertOpen();
        const sent = deadline.within(() => boundedSend(sessionId!, plan.prompt, plan.cancel));
        if (initial.managed) pointDuring = await deadline.within(localResourcePoint);
        const outcome = await sent;
        settled = outcome.completedWithoutBound;
        failed = outcome.error;
        cancellationResult = outcome;
        sdkActuallySettled = plan.cancel
          ? outcome.acknowledged === true
          : outcome.completedWithoutBound || outcome.error !== null;
        // Chat may settle just ahead of Rust's native Settled channel event.
        // Allow only a fixed observation grace; never replay the provider.
        await deadline.within(() => waitForRecordedLm6NativeSettlement(sessionId!));
        if (plan.cancel) {
          const quiet = await deadline.within(() => observeLm6CancellationQuiescence(sessionId!));
          const chat = getOrCreateChat(sessionId);
          const native = await deadline.within(() =>
            targetFor(selectionId!, false, deadline)).catch(() => null);
          noContinuationObserved = quiet === true &&
            !sessionInference(sessionId) && chat.status !== "submitted" &&
            chat.status !== "streaming" && !!native &&
            native.native?.state === "Ready" &&
            isCurrentSameDeployment(native, initial) ? true :
            quiet === false ? false : null;
        }
      } catch (error) {
        failed = error;
      } finally {
        if (sessionId) flight = disarmDeploymentQualification(sessionId);
        preparingSessionId = null;
      }
      const m = flight?.measurement;
      const response = sessionId && !failed && !plan.cancel
        ? verifiedResponse(selectionId, sessionId, initial.provider, plan.prompt, flight)
        : null;
      const cancelledChatId = sessionId && plan.cancel && !failed
        ? (() => {
            const session = useChatStore.getState().sessions.find(s => s.id === sessionId);
            return session?.profile?.modelId === selectionId &&
              session.profile.agentId === "builtin:coder"
              ? lm6CancelledChatRequestId(getOrCreateChat(sessionId).messages, sessionId,
                  session.profile.workspaceId, selectionId, plan.prompt, initial.provider)
              : null;
          })() : null;
      const ids = m?.nativeRequestIds ?? [];
      // Native ai_http_open IDs are "inference-N", while Chat activity owns
      // separate request UUIDs. Requiring equality would reject real traffic.
      const nativeRequestId = lm6SingleNativeRequest({
        nativeRequestIds: ids,
        nativeRequestOpenEvents: m?.nativeRequestOpenEvents,
      });
      const uniqueOne = nativeRequestId !== null;
      const verified = !!response?.chat && !!response.streaming &&
        !!response.terminalCompletion && !!m?.nativeTerminalAt && uniqueOne &&
        !flight?.violations.length && settled;
      // Legitimate behavior FAIL is not a Chat transport failure.
      let capabilityCheck: Lm6Attempt["capabilityCheck"] = "not-run";
      if (plan.kind === "instruction-adherence") {
        const verdict = verified && response ? evaluateInstructionAdherence({
            output: response.assistantText,
            contract: { kind: "exact", expected: MANAGED_QUALIFICATION_EXPECTED },
            personaId: "builtin:coder",
            systemContextDigest: flight!.systemContextDigest!,
            requestId: response.requestId, finish: response.finish,
          }).status : "incomplete";
        capabilityCheck = verdict === "verified" ? "passed" : verdict;
      }
      const pointAfter = initial.managed ? await deadline.within(localResourcePoint) :
        { ram: null, vram: null, ramAt: null, vramAt: null };
      const endedAt = Date.now();
      const signals: Lm6Signals = {
        requestStart: m?.requestStartAt, providerAdmitted: m?.providerAdmittedAt,
        connectionStart: m?.connectionStartAt, providerConnected: m?.providerConnectedAt,
        firstFrame: m?.firstFrameAt, firstMeaningful: m?.firstMeaningfulAt,
        terminal: verified ? m?.nativeTerminalAt : null,
        promptTokens: m?.promptTokens, generatedTokens: m?.generatedTokens,
        providerPromptDurationNs: m?.promptDurationNs,
        providerGenerationDurationNs: m?.generationDurationNs,
        providerLoadDurationNs: m?.loadDurationNs,
        ramBeforeBytes: pointBefore.ram, ramDuringBytes: pointDuring.ram,
        ramAfterBytes: pointAfter.ram, vramBeforeBytes: pointBefore.vram,
        vramDuringBytes: pointDuring.vram, vramAfterBytes: pointAfter.vram,
        ramBeforeAt: pointBefore.ramAt, ramDuringAt: pointDuring.ramAt,
        ramAfterAt: pointAfter.ramAt, vramBeforeAt: pointBefore.vramAt,
        vramDuringAt: pointDuring.vramAt, vramAfterAt: pointAfter.vramAt,
        cancelRequestedAt: m?.cancelRequestedAt,
        cancelAcknowledgedAt: m?.cancelAcknowledgedAt,
        // A cancelled SDK promise alone cannot prove all future provider
        // effects stopped; leave this Unknown absent a native no-continuation
        // proof instead of silently upgrading cancellation confidence.
        noContinuationObserved,
        duplicateRequestObserved:
          ids.length > 1 || (m?.nativeRequestOpenEvents ?? 0) > 1,
      };
      const cancelled = plan.cancel && !!m?.cancelRequestedAt &&
        !!m?.cancelAcknowledgedAt && cancellationResult.startedOutput === true &&
        cancellationResult.acknowledged === true && !!cancelledChatId &&
        noContinuationObserved === true && uniqueOne && !flight?.violations.length;
      const failure = verified ? "none" as const :
        cancelled ? "cancelled" as const :
        failed && !plan.cancel ? lm6Failure(failed) :
        !plan.cancel && !settled && !m?.firstMeaningfulAt ? "first-output-timeout" as const :
        !plan.cancel && !settled ? "terminal-timeout" as const :
        "incomplete-evidence" as const;
      attempts.push(lm6AttemptFromSignals({
        attemptId: `attempt-${i + 1}`,
        requestId: response?.requestId ?? cancelledChatId ?? null,
        nativeRequestId,
        nativeRequestOpenEvents: m?.nativeRequestOpenEvents ?? null,
        distinctNativeRequestCount: m?.nativeRequestIds.length ?? null,
        workload: plan.kind,
        thermal: i === 0 ? initial.thermal :
          before!.thermal === "warm" && initial.managed ? "warm" : "unknown",
        thermalSource: i === 0 ? initial.thermalSource :
          initial.managed ? "native-same-resident-process-before-request" :
            "remote-ollama-model-residency-not-verified",
        startedAt: start, endedAt,
        result: verified ? "passed" : cancelled ? "cancelled" : "failed",
        failure, capabilityCheck,
        outputObserved: !!m?.firstMeaningfulAt,
        terminalObserved: verified,
        signals,
      }));
      if (sessionId) {
        const messages = getOrCreateChat(sessionId).messages;
        // A successful native response without durable Chat evidence is not
        // an accepted measurement. Preserve failed attempts in memory, but
        // do not commit a positive measurement ledger from failed writes.
        try {
          await deadline.within(() => saveMessages(sessionId!, messages));
          await deadline.within(() => awaitSessionWrites(sessionId!));
        } catch {
          unsafeToDispatchAgain = true;
        }
      }
      // Never start the next provider request if this one's native terminal
      // state is not observed. A settled SDK promise alone is not a drain.
      if (!sdkActuallySettled || !m ||
          (!m.nativeTerminalAt && !m.cancelAcknowledgedAt) ||
          flight?.violations.length ||
          (plan.cancel && noContinuationObserved !== true) ||
          (sessionId && !!sessionInference(sessionId)))
        unsafeToDispatchAgain = true;
    }
    // Do not write a potentially qualifying measurement when native
    // terminal/quiescence remains Unknown. The prior attempts cannot be
    // replayed to manufacture success.
    if (unsafeToDispatchAgain) {
      uncertainPreviousMeasurement = true;
      return { status: "unavailable", runId: null, deploymentId: initial.deploymentId,
        attempted: attempts.length };
    }
    deadline.sdkSettled();
    deadline.nativeAcknowledged();
    deadline.nativeQuiescent();
    const endedAt = Date.now();
    const scope = lm6ExactScope(initial.fabric, initial.deploymentId, initial.observation, startedAt);
    if (!scope) return {
      status: "unavailable", runId: null, deploymentId: initial.deploymentId, attempted: attempts.length,
    };
    const run = completeLm6Run({
      runId, scope,
      configuredContextTokens: initial.contextTokens, backend: initial.backend,
      startedAt, endedAt, requestedAttempts: procedures.length, attempts,
    });
    const final = await deadline.within(() => targetFor(selectionId, false, deadline));
    if (!final || final.observation.epoch !== initial.observation.epoch ||
        !isCurrentSameDeployment(final, initial))
      return { status: "unavailable", runId: null, deploymentId: initial.deploymentId, attempted: attempts.length };
    // Existing CAS writer, new and historical data in separate measurementRuns
    // stream. Reproject native Ready against CAS *current* state inside update.
    deadline.beginPersistence();
    try {
      casTicket = await deadline.within(() => beginNativeQualificationCas({
        kind: "lm6", deploymentId: initial.deploymentId,
        runtimeEpoch: final.observation.epoch,
        processId: initial.managed ? final.native?.processId ?? null : null,
        remainingMs: Math.floor(deadline.remainingMs()),
      }));
      deadline.assertOpen();
      const ticket = casTicket;
      await deadline.within(() => updateQualifiedSelfHostedProfiles(current => {
        deadline.assertOpen();
        const expected = reconcileLocalComputeFabric(current).deployments
          .find(d => d.id === initial.deploymentId);
        if (!expected) throw new Error("Deployment removed before LM6 evidence commit");
        const observed = initial.managed
          ? observedManagedFabric(current, selectionId, final.native ?? null, Date.now())
          : { fabric: reconcileLocalComputeFabric(current), observation: final.observation };
        return appendLm6Run(current, run, observed?.observation, Date.now(), observed?.fabric);
      }, ticket, () => deadline.assertOpen()));
      deadline.persisted();
    } catch (error) {
      if (casTicket)
        void cancelNativeQualificationCas(casTicket).catch(() => undefined);
      if (error instanceof Error &&
          error.message === "Self-hosted settings changed in another window. Try again.")
        deadline.rejectPersistence();
      else deadline.ambiguousPersistence();
      uncertainPreviousMeasurement = true;
      throw error;
    }
    return { status: "recorded", runId: run.runId, deploymentId: run.scope.deploymentId, attempted: attempts.length };
  } finally {
    if (deadline.state.terminal)
      uncertainPreviousMeasurement = true;
    deadline.finish();
    const store = useChatStore.getState();
    if (previousSessionId && store.sessions.some(s => s.id === previousSessionId))
      store.switchSession(previousSessionId);
    else if (!previousSessionId) store.setSelectedModelId(previousModelId, false);
    active = false;
  }
}

function isCurrentSameDeployment(a: Target, b: Target): boolean {
  return a.deploymentId === b.deploymentId &&
    a.observation.runtimeId === b.observation.runtimeId &&
    a.observation.version === b.observation.version &&
    a.observation.configurationRevision === b.observation.configurationRevision &&
    a.observation.epoch === b.observation.epoch &&
    JSON.stringify(lm6ExactScope(a.fabric, a.deploymentId, a.observation, Date.now())) ===
    JSON.stringify(lm6ExactScope(b.fabric, b.deploymentId, b.observation, Date.now()));
}
