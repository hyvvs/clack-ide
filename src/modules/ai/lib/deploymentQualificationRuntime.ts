import { invoke } from "@tauri-apps/api/core";
import type { UIMessage } from "ai";
import {
  readActivity,
} from "@/modules/ai/lib/activity";
import { readAnswer } from "@/modules/ai/lib/answerContinuation";
import {
  recordDeploymentQualification,
  type DeploymentQualificationEvidenceReceipt,
  type DeploymentRuntimeObservation,
  type LocalComputeFabric,
  type RuntimeCapabilityName,
} from "@/modules/ai/lib/localComputeFabric";
import type { SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import {
  isManagedLocalSelectionId,
  resolveManagedLocalSelection,
} from "@/modules/ai/lib/managedLocalModels";
import {
  admittedManagedLocalRoute, assertCurrentManagedLocalRoute,
} from "@/modules/ai/lib/managedLocalRuntime";
import type { ManagedLocalNativeStatus } from "@/modules/ai/lib/managedLocalRuntime";
import {
  MANAGED_QUALIFICATION_PROMPT, MANAGED_QUALIFICATION_EXPECTED,
  armDeploymentQualification, disarmDeploymentQualification,
  type QualificationFlightSnapshot,
} from "@/modules/ai/lib/deploymentQualificationFlight";
import {
  evaluateInstructionAdherence, instructionAdherenceReceipt,
} from "@/modules/ai/lib/instructionAdherenceQualification";
import { observedManagedFabric } from "@/modules/ai/lib/deploymentQualificationView";
import { useChatStore } from "@/modules/ai/store/chatStore";
import {
  getOrCreateChat, prepareSessionChat, sendMessageToSession,
} from "@/modules/ai/store/chatRuntime";
import { awaitSessionWrites, saveMessages } from "@/modules/ai/lib/sessions";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { updateSelfHostedProfiles } from "@/modules/settings/store";

/** A single explicitly initiated new Chat under a real Clack system/persona.
 * No direct HTTP shortcut, model download, Agent tool, retry or continuation. */
export type BoundedQualificationResult = {
  sessionId: string;
  requestId: string;
  deploymentId: string;
  chat: "verified" | "failed";
  streaming: "verified" | "failed";
  terminalCompletion: "verified" | "failed";
  instructionAdherence: "verified" | "failed" | "incomplete";
  receiptCount: number;
};

export type BoundedChatObservation = {
  requestId: string;
  assistantText: string;
  textPartCount: number;
  chat: boolean;
  streaming: boolean;
  terminalCompletion: boolean;
  finish: "stop" | "length" | "cancelled" | "error";
  evidenceDigestInput: string;
};

const QUALIFICATION_CAPABILITIES = [
  "chat", "streaming", "terminal-completion",
] as const satisfies readonly RuntimeCapabilityName[];

/** No model text is ever construed as a tool effect or arbitrary claim.
 * Only Clack's own structured response/activity and stream observation count.
 * The output is held transiently for adherence evaluation and hashing. */
export function inspectBoundedChat(
  messages: readonly UIMessage[],
  sessionId: string,
  workspaceId: string | null,
  selectedModelId: string,
  snapshot: QualificationFlightSnapshot,
): BoundedChatObservation | null {
  if (snapshot.prepared !== 1 || !snapshot.systemContextDigest ||
      !snapshot.modelMessagesDigest || snapshot.violations.length ||
      messages.length !== 2 || messages[0].role !== "user" ||
      messages[1].role !== "assistant" ||
      messages[0].parts.length !== 1 ||
      messages[0].parts[0].type !== "text" ||
      messages[0].parts[0].text !== MANAGED_QUALIFICATION_PROMPT)
    return null;
  const assistant = messages[1];
  const activity = readActivity(assistant, sessionId, workspaceId);
  const answer = readAnswer(assistant);
  if (!activity || !answer ||
      activity.owner.sessionId !== sessionId ||
      activity.owner.modelId !== selectedModelId ||
      activity.owner.agentId !== "builtin:coder" ||
      activity.owner.providerId !== "openai-compatible" ||
      activity.omitted !== 0 ||
      answer.segments.length !== 1 ||
      answer.continuations !== 0 || answer.repairs !== 0 ||
      answer.segments[0].provider !== "openai-compatible" ||
      answer.segments[0].model !== selectedModelId ||
      assistant.parts.some(p => p.type === "dynamic-tool" || p.type.startsWith("tool-")))
    return null;
  const requestIds = new Set(activity.receipts
    .filter(r => r.kind === "request" && r.id.startsWith("request:"))
    .map(r => r.id.split(":")[1]));
  if (requestIds.size !== 1 ||
      activity.receipts.some(r => r.kind === "retry" || r.kind === "recovered" || r.kind === "tool"))
    return null;
  const requestId = [...requestIds][0];
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return null;
  const owns = activity.receipts.filter(r => r.id.startsWith(`request:${requestId}:`));
  const completed = owns.some(r => r.label === "Request completed");
  const generated = owns.some(r => r.label === "Generating...");
  const finished = activity.receipts.some(r => r.kind === "response" &&
    r.label === "Response ended: stop");
  const textParts = assistant.parts.filter(p => p.type === "text");
  const assistantText = textParts.map(p => p.text).join("");
  if (assistantText.length > 4096) return null;
  const finish = answer.segments[0].finish === "stop" ? "stop"
    : answer.segments[0].finish === "length" ? "length"
    : answer.segments[0].finish === "cancelled" ? "cancelled" : "error";
  const terminalCompletion = answer.state === "complete" &&
    finish === "stop" && completed && finished && snapshot.finishes === 1;
  const stream = generated && completed && snapshot.textStarts === 1 &&
    snapshot.textDeltas >= 1 && snapshot.textEnds === 1 &&
    snapshot.textChars === assistantText.length && snapshot.finishes === 1;
  // A complete text answer is Chat evidence even when the streaming trace
  // did not meet its independent protocol criterion. Never make Chat's
  // qualification an alias of Streaming qualification.
  const chat = terminalCompletion && textParts.length === 1 &&
    assistantText.length > 0;
  return {
    requestId, assistantText, textPartCount: textParts.length,
    chat, streaming: stream, terminalCompletion, finish,
    evidenceDigestInput: JSON.stringify({
      requestId, modelId: selectedModelId, sessionId,
      context: snapshot.modelMessagesDigest,
      system: snapshot.systemContextDigest, text: assistantText,
      streamChunks: [snapshot.textStarts, snapshot.textDeltas,
        snapshot.textEnds, snapshot.textChars, snapshot.finishes],
      finish, completed, generated,
    }),
  };
}

async function sha256(value: string): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)]
    .map(x => x.toString(16).padStart(2, "0")).join("")}`;
}

export async function boundedChatReceipts(
  fabric: LocalComputeFabric,
  deploymentId: string,
  observation: DeploymentRuntimeObservation,
  result: BoundedChatObservation,
  flight: QualificationFlightSnapshot,
  now = Date.now(),
): Promise<DeploymentQualificationEvidenceReceipt[]> {
  const { deploymentQualificationScope, deploymentQualificationEvidenceReceiptSchema } =
    await import("@/modules/ai/lib/localComputeFabric");
  const scope = deploymentQualificationScope(fabric, deploymentId, observation, now);
  if (!scope || !flight.systemContextDigest)
    throw new Error("No current native deployment scope for bounded qualification");
  const evidenceDigest = await sha256(result.evidenceDigestInput);
  const receipts = QUALIFICATION_CAPABILITIES.map(capability => {
    const passed = capability === "chat" ? result.chat :
      capability === "streaming" ? result.streaming : result.terminalCompletion;
    return deploymentQualificationEvidenceReceiptSchema.parse({
      version: 2, scope: { ...scope, deploymentId }, capability,
      status: passed ? "verified" : "failed",
      verifiedAt: now, expiresAt: now + 86_400_000,
      procedure: { id: "clack-managed-chat-bounded", version: 1 },
      context: {},
      evidence: {
        source: "clack-transport", reference: result.requestId,
        digest: evidenceDigest,
        checks: [{ id: capability === "chat" ? "complete-chat-text" :
          capability === "streaming" ? "stream-deltas" : "terminal-stop",
          result: passed ? "pass" : "fail" }],
      },
    });
  });
  const adherence = await instructionAdherenceReceipt(
    fabric, deploymentId, observation, {
      output: result.assistantText,
      contract: { kind: "exact", expected: MANAGED_QUALIFICATION_EXPECTED },
      personaId: "builtin:coder",
      systemContextDigest: flight.systemContextDigest,
      requestId: result.requestId, finish: result.finish,
    }, now,
  );
  if (adherence.status !== evaluateInstructionAdherence({
    output: result.assistantText,
    contract: { kind: "exact", expected: MANAGED_QUALIFICATION_EXPECTED },
    personaId: "builtin:coder", systemContextDigest: flight.systemContextDigest,
    requestId: result.requestId, finish: result.finish,
  }).status) throw new Error("Adherence verifier results inconsistent");
  return [...receipts, adherence];
}

/** Safely persist only evidence into the existing CAS envelope. Runtime
 * Ready/epoch/PID are validated using the current native observation but
 * are NOT written as simulated persisted runtime state. */
export function appendManagedObservedQualification(
  current: SelfHostedState,
  selectionId: string,
  expectedIdentity: string,
  native: ManagedLocalNativeStatus,
  receipts: readonly DeploymentQualificationEvidenceReceipt[],
  now: number,
): SelfHostedState {
  const exact = resolveManagedLocalSelection(current, selectionId);
  const inspected = observedManagedFabric(current, selectionId, native, now);
  if (exact.status === "missing" || exact.status === "not-managed" ||
      exact.identity !== expectedIdentity || !inspected?.observation)
    throw new Error("Deployment changed during native qualification commit");
  return receipts.reduce((next, receipt) => {
    const ephemeral = {
      ...next,
      fabric: {
        ...inspected.fabric,
        qualificationReceipts: next.fabric?.qualificationReceipts ?? [],
      },
    };
    const accepted = recordDeploymentQualification(ephemeral,
      exact.deployment.id, inspected.observation!, receipt, now);
    return {
      ...next,
      fabric: {
        ...next.fabric!,
        qualificationReceipts: accepted.fabric!.qualificationReceipts,
      },
    };
  }, current);
}

let active = false;
let admissionTask: Promise<BoundedQualificationResult> | null = null;
/** One active qualification even during async native admission. */
export function runManagedChatQualification(
  selectionId: string,
): Promise<BoundedQualificationResult> {
  if (admissionTask)
    return Promise.reject(new Error("Another bounded qualification is already preparing"));
  const task = executeManagedChatQualification(selectionId);
  admissionTask = task;
  return task.finally(() => {
    if (admissionTask === task) admissionTask = null;
  });
}

async function executeManagedChatQualification(
  selectionId: string,
): Promise<BoundedQualificationResult> {
  if (active) throw new Error("Another LM2F bounded qualification is active");
  if (!isManagedLocalSelectionId(selectionId))
    throw new Error("Only the existing managed deployment is supported by this bounded verifier");
  if (usePreferencesStore.getState().agentPermissionProfiles["builtin:coder"]?.mode !== "chat-only")
    throw new Error("Coder must already be Chat Only; LM2F will not grant or change permissions");
  const state = usePreferencesStore.getState().selfHostedInference;
  const selected = resolveManagedLocalSelection(state, selectionId);
  if (selected.status === "missing" || selected.status === "not-managed")
    throw new Error("The exact managed deployment is unavailable");
  const artifactDigest = selected.artifact.digest;
  if (!artifactDigest) throw new Error("Managed artifact digest unavailable");
  const before = await invoke<ManagedLocalNativeStatus>("managed_local_runtime_status");
  const native = observedManagedFabric(state, selectionId, before, Date.now());
  if (!native?.observation) throw new Error("Exact managed native runtime is not Ready");
  const route = await admittedManagedLocalRoute({
    deploymentId: selected.deployment.id,
    deploymentIdentity: selected.identity,
    artifactDigest,
    configurationRevision: selected.deployment.configurationRevision,
  });
  if (route.epoch !== before.epoch || route.processId !== before.processId)
    throw new Error("Native runtime changed during qualification admission");
  active = true;
  const store = useChatStore.getState();
  const previousSessionId = store.activeSessionId;
  const previousModel = store.selectedModelId;
  let sessionId: string | null = null;
  let flight: QualificationFlightSnapshot | null = null;
  // A bounded, content-free failure phase can be surfaced after the Chat
  // session switch. Never put prompts, model output or native secrets here.
  let phase = "session-capture";
  try {
    sessionId = store.newSession();
    const next = useChatStore.getState();
    if (!next.setSessionModelId(sessionId, selectionId, false) ||
        !next.setSessionAgentId(sessionId, "builtin:coder"))
      throw new Error("LM2F test Chat cannot capture its exact model and persona");
    const session = useChatStore.getState().sessions.find(s => s.id === sessionId);
    if (!session?.profile || session.profile.modelId !== selectionId ||
        session.profile.agentId !== "builtin:coder" ||
        session.fallback?.mode && session.fallback.mode !== "never")
      throw new Error("LM2F test Chat is not in the required exact configuration");
    await awaitSessionWrites(sessionId);
    await prepareSessionChat(sessionId);
    armDeploymentQualification(sessionId, selectionId, "builtin:coder");
    phase = "bounded-request";
    try {
      await sendMessageToSession(sessionId, { text: MANAGED_QUALIFICATION_PROMPT });
    } finally {
      flight = disarmDeploymentQualification(sessionId);
    }
    phase = "flight-observation";
    if (!flight) throw new Error("Bounded qualification stream observation unavailable");
    const final = useChatStore.getState().sessions.find(s => s.id === sessionId);
    if (final?.profile?.modelId !== selectionId || final.profile.agentId !== "builtin:coder" ||
        final.run?.modelId !== selectionId || final.run?.agentId !== "builtin:coder")
      throw new Error("The qualification Chat selection or captured Agent changed");
    const messages = getOrCreateChat(sessionId).messages;
    // A detached bridge must not lose qualification evidence on exit.
    await saveMessages(sessionId, messages);
    await awaitSessionWrites(sessionId);
    phase = "persisted-chat-evidence";
    const observed = inspectBoundedChat(
      messages, sessionId, final.profile.workspaceId, selectionId, flight,
    );
    if (!observed) throw new Error("No complete single-request Clack transport evidence; no qualification promoted");
    phase = "native-revalidation";
    await assertCurrentManagedLocalRoute({
      deploymentId: selected.deployment.id,
      deploymentIdentity: selected.identity,
      artifactDigest,
      configurationRevision: selected.deployment.configurationRevision,
    }, route);
    const after = await invoke<ManagedLocalNativeStatus>("managed_local_runtime_status");
    if (after.epoch !== before.epoch || after.processId !== before.processId)
      throw new Error("Managed runtime changed after the qualifying Chat");
    const timestamp = Date.now();
    const fresh = observedManagedFabric(
      usePreferencesStore.getState().selfHostedInference, selectionId, after, timestamp,
    );
    if (!fresh?.observation)
      throw new Error("Native Ready identity unavailable after the qualifying Chat");
    phase = "receipt-scoring";
    const receipts = await boundedChatReceipts(fresh.fabric,
      selected.deployment.id, fresh.observation, observed, flight, timestamp);
    phase = "cas-commit";
    await updateSelfHostedProfiles(current =>
      appendManagedObservedQualification(
        current, selectionId, selected.identity, after, receipts, timestamp,
      ));
    return {
      sessionId, requestId: observed.requestId,
      deploymentId: selected.deployment.id,
      chat: observed.chat ? "verified" : "failed",
      streaming: observed.streaming ? "verified" : "failed",
      terminalCompletion: observed.terminalCompletion ? "verified" : "failed",
      instructionAdherence: receipts[3].status === "incomplete" ? "incomplete" :
        receipts[3].status === "verified" ? "verified" : "failed",
      receiptCount: receipts.length,
    };
  } catch (error) {
    // A stage alone is enough to diagnose whether the native observation,
    // real stream capture or CAS commit failed, without leaking Chat content
    // or promoting partial evidence to a receipt.
    const failure = new Error(`Bounded qualification unverified at ${phase}`);
    (failure as Error & { cause?: unknown }).cause = error;
    throw failure;
  } finally {
    if (sessionId) disarmDeploymentQualification(sessionId);
    const current = useChatStore.getState();
    if (previousSessionId && current.sessions.some(s => s.id === previousSessionId))
      current.switchSession(previousSessionId);
    else if (!previousSessionId) current.setSelectedModelId(previousModel, false);
    active = false;
  }
}
