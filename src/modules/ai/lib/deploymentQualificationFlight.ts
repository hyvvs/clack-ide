import type { ModelMessage, UIMessageChunk } from "ai";
import { lm11AcceptanceBarrier, type Lm11AcceptanceStage } from "./lm11AcceptanceBarrier";

/** One explicit, short Chat qualification uses Clack's real Agent request
 * construction and parsed UI stream. No raw prompts or output are persisted
 * in this observer. No mission/Agent tool actions are permitted. */
export const MANAGED_QUALIFICATION_PROMPT =
  "Reply with exactly LM2F-CHAT-QUALIFIED and nothing else.";
export const MANAGED_QUALIFICATION_EXPECTED = "LM2F-CHAT-QUALIFIED";
export const MANAGED_QUALIFICATION_MAX_OUTPUT = 128;
export const LM6_WARM_CHAT_PROMPT =
  "In one short sentence, describe what a CPU does. Do not use tools.";
export const LM6_CANCEL_CHAT_PROMPT =
  "Count from one to forty, one number per line, without using any tools.";

export type PreparedQualification = {
  modelId: string;
  messages: readonly ModelMessage[];
  activeTools: readonly string[];
  outputLimit: number;
};
export type QualificationFlightSnapshot = {
  prepared: number;
  systemContextDigest: `sha256:${string}` | null;
  modelMessagesDigest: `sha256:${string}` | null;
  textStarts: number;
  textDeltas: number;
  textEnds: number;
  textChars: number;
  finishes: number;
  metadataCount: number;
  violations: string[];
  /** Native request correlation is distinct from the AI SDK's settled Chat.
   * A native terminal event alone is NOT proof of transport quiescence or CAS. */
  native: {
    opens: number;
    requestId: string | null;
    terminal: "completed" | "cancelled" | null;
  };
  measurement?: {
    startedAt: number;
    preparedAt: number | null;
    requestStartAt: number | null;
    providerAdmittedAt: number | null;
    connectionStartAt: number | null;
    providerConnectedAt: number | null;
    firstFrameAt: number | null;
    firstMeaningfulAt: number | null;
    nativeTerminalAt: number | null;
    promptTokens: number | null;
    generatedTokens: number | null;
    promptDurationNs: number | null;
    generationDurationNs: number | null;
    loadDurationNs: number | null;
    cancelRequestedAt: number | null;
    cancelAcknowledgedAt: number | null;
    nativeRequestIds: string[];
    nativeRequestOpenEvents?: number;
  };
};
type LiveFlight = {
  sessionId: string;
  modelId: string;
  personaId: string;
  startedAt: number;
  expectedPrompt: string;
  snapshot: QualificationFlightSnapshot;
  dispatchOpen: boolean;
  snapshotConsumed: boolean;
  cancelChallenge: boolean;
  operation?: QualificationOperationDeadline;
};

// Closed flights remain as same-session no-dispatch tombstones. In particular,
// Chat.sendMessage can reject before its queued transport callback has begun.
// Removing its flight on disarm would let that delayed callback become an
// ordinary unbounded Chat. Re-arming a fresh explicit operation replaces only
// its own prior tombstone; captured old closures retain their revoked flight.
const flights = new Map<string, LiveFlight>();

/** Per-invocation LM11 safety budget, not a second request/receipt registry.
 * The only clock for admission -> native quiescence -> CAS acknowledgement is
 * monotonic. Races bound the caller, while every deferred continuation and
 * final native dispatch MUST also check this same revoked authority. */
export class QualificationOperationDeadline {
  private readonly start = performance.now();
  private readonly end: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly aborter = new AbortController();
  private stopReason: "cancelled" | "deadline" | "shutdown" | null = null;
  private persistence: "not-started" | "pending" | "acknowledged" | "rejected" | "ambiguous" = "not-started";
  private sdk = false;
  private native = false;
  private quiet = false;
  private finished = false;

  constructor(maxMs: number, private readonly onStop?: () => void) {
    if (!Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 300_000)
      throw new Error("Invalid bounded qualification aggregate wall deadline");
    this.end = this.start + maxMs;
    this.timer = setTimeout(() => this.stop("deadline"), maxMs);
  }

  get signal(): AbortSignal { return this.aborter.signal; }
  get state() {
    return {
      terminal: this.stopReason,
      sdkSettled: this.sdk,
      nativeAcknowledged: this.native,
      nativeQuiescent: this.quiet,
      persistence: this.persistence,
    } as const;
  }
  remainingMs(): number { return Math.max(0, this.end - performance.now()); }
  isOpen(): boolean {
    if (!this.stopReason && this.remainingMs() <= 0) this.stop("deadline");
    return !this.finished && this.stopReason === null;
  }
  assertOpen(): void {
    if (!this.isOpen()) throw new Error(
      this.stopReason === "deadline" ? "Qualification aggregate wall deadline exceeded"
        : "Qualification operation cancelled before further effects",
    );
  }
  stop(reason: "cancelled" | "deadline" | "shutdown"): void {
    if (this.stopReason) return;
    this.stopReason = reason;
    if (this.persistence === "pending") this.persistence = "ambiguous";
    this.aborter.abort();
    try { this.onStop?.(); } catch { /* terminal authority cannot be revoked by observer failure */ }
    clearTimeout(this.timer);
  }
  /** Do not confuse a timeout race with cancellation of an uncancellable IPC.
   * Post-await checks prevent a late response from advancing to the NEXT step. */
  async within<T>(work: () => Promise<T>): Promise<T> {
    this.assertOpen();
    return new Promise<T>((resolve, reject) => {
      const aborted = () => reject(new Error("Qualification operation deadline or cancellation"));
      this.signal.addEventListener("abort", aborted, { once: true });
      Promise.resolve().then(() => { this.assertOpen(); return work(); }).then(
        value => {
          this.signal.removeEventListener("abort", aborted);
          try { this.assertOpen(); resolve(value); } catch (error) { reject(error); }
        },
        error => { this.signal.removeEventListener("abort", aborted); reject(error); },
      );
    });
  }
  sdkSettled(): void { this.assertOpen(); this.sdk = true; }
  nativeAcknowledged(): void { this.assertOpen(); this.native = true; }
  nativeQuiescent(): void {
    this.assertOpen();
    if (!this.sdk || !this.native) throw new Error("SDK/native settlement not independently proven");
    this.quiet = true;
  }
  beginPersistence(): void {
    this.assertOpen();
    if (!this.quiet || this.persistence !== "not-started")
      throw new Error("Qualification has no native-quiescent single CAS authority");
    this.persistence = "pending";
  }
  persisted(): void {
    this.assertOpen();
    if (this.persistence !== "pending") throw new Error("No acknowledged qualification CAS");
    this.persistence = "acknowledged";
  }
  ambiguousPersistence(): void {
    if (this.persistence === "pending") this.persistence = "ambiguous";
  }
  /** A definite compare-and-swap conflict is different from a lost reply or
   * an already-started native save with unknown acknowledgement. Neither
   * constitutes a qualifying persistence success. */
  rejectPersistence(): void {
    if (this.persistence === "pending") this.persistence = "rejected";
  }
  finish(): void {
    // Any deferred continuation retaining this object remains revoked after
    // the invoking LM2F/LM6 runner has completed or failed.
    this.finished = true;
    clearTimeout(this.timer);
  }
}

async function digest(text: string): Promise<`sha256:${string}`> {
  const value = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `sha256:${[...new Uint8Array(value)]
    .map(b => b.toString(16).padStart(2, "0")).join("")}`;
}

export function armDeploymentQualification(
  sessionId: string,
  modelId: string,
  personaId: string,
  opts?: { expectedPrompt?: string; measure?: boolean;
    operation?: QualificationOperationDeadline; cancelChallenge?: boolean },
): void {
  if ([...flights.values()].some(f => !f.snapshotConsumed) ||
      !sessionId || !modelId || personaId !== "builtin:coder")
    throw new Error("Another bounded qualification is active or the persona is not Chat-only Coder");
  flights.set(sessionId, {
    sessionId, modelId, personaId, startedAt: Date.now(),
    expectedPrompt: opts?.expectedPrompt ?? MANAGED_QUALIFICATION_PROMPT,
    dispatchOpen: true, cancelChallenge: opts?.cancelChallenge === true,
    snapshotConsumed: false,
    operation: opts?.operation,
    snapshot: {
      prepared: 0, systemContextDigest: null, modelMessagesDigest: null,
      textStarts: 0, textDeltas: 0, textEnds: 0, textChars: 0,
      finishes: 0, metadataCount: 0, violations: [],
      native: { opens: 0, requestId: null, terminal: null },
      ...(opts?.measure ? { measurement: {
        startedAt: Date.now(), preparedAt: null, requestStartAt: null,
        providerAdmittedAt: null, connectionStartAt: null, providerConnectedAt: null,
        firstFrameAt: null, firstMeaningfulAt: null, nativeTerminalAt: null,
        promptTokens: null, generatedTokens: null, promptDurationNs: null,
        generationDurationNs: null, loadDurationNs: null,
        cancelRequestedAt: null, cancelAcknowledgedAt: null,
        nativeRequestIds: [],
        nativeRequestOpenEvents: 0,
      } } : {}),
    },
  });
}
export function disarmDeploymentQualification(sessionId: string): QualificationFlightSnapshot | null {
  const flight = flights.get(sessionId);
  if (!flight || flight.snapshotConsumed) return null;
  flight.dispatchOpen = false;
  flight.snapshotConsumed = true;
  // The tombstone must outlive any delayed request-preparation continuation.
  return structuredClone(flight.snapshot);
}
/** Capture this closure BEFORE any asynchronous Chat/Agent preparation. Even
 * after disarm the captured flight stays revoked; an old prepared callback
 * cannot become an ordinary, unarmed inference. */
export function qualificationDispatchAuthority(
  sessionId: string | undefined,
): (() => boolean) | undefined {
  const flight = sessionId ? flights.get(sessionId) : undefined;
  if (!flight) return undefined;
  return () => flight.dispatchOpen && (flight.operation?.isOpen() ?? true);
}
/** Capture the same qualification operation as the already-captured dispatch
 * authority. Non-qualification and LM6 flights cannot arm LM11 barriers. */
export function qualificationAcceptanceOperation(
  sessionId: string | undefined,
): QualificationOperationDeadline | undefined {
  const flight = sessionId ? flights.get(sessionId) : undefined;
  return flight && !flight.snapshot.measurement ? flight.operation : undefined;
}

export async function qualificationAcceptanceBoundary(
  sessionId: string | undefined, stage: Lm11AcceptanceStage,
): Promise<void> {
  const operation = qualificationAcceptanceOperation(sessionId);
  if (!operation || !sessionId) return;
  if (import.meta.env.VITE_CLACK_LM11_ACCEPTANCE !== "1") return;
  await lm11AcceptanceBarrier(stage, operation, sessionId);
  operation.assertOpen();
  if (!qualificationDispatchAuthority(sessionId)?.())
    throw new Error("Qualification revoked at acceptance boundary");
}
/** Called by the existing inference cancellation authority, including when
 * no native inference ID has yet been registered. */
export function cancelDeploymentQualificationBeforeDispatch(sessionId: string): void {
  const flight = flights.get(sessionId);
  if (!flight) return;
  // The original flight is intentionally disarmed after native quiescence,
  // BEFORE the same qualification's evidence evaluation and B03 CAS.
  // Disarming request dispatch must not lose its still-live operation's Stop
  // authority. In particular, a user Stop at B03 ACK/readback cannot promote
  // a previously cancelled caller to PASS. Finished/tombstoned operations
  // stay inert, and this does not create any second qualification authority.
  if (!flight.snapshotConsumed) flight.dispatchOpen = false;
  if (!flight.cancelChallenge && flight.operation?.isOpen())
    flight.operation.stop("cancelled");
}
export function cancelAllDeploymentQualificationBeforeDispatch(): void {
  for (const sessionId of flights.keys()) {
    const flight = flights.get(sessionId);
    // A challenge's intentional cancellation is not a host-shutdown grant.
    if (flight?.operation?.isOpen()) flight.operation.stop("shutdown");
    if (flight && !flight.snapshotConsumed) flight.dispatchOpen = false;
  }
}
export function peekDeploymentQualificationFlight(sessionId: string): QualificationFlightSnapshot | null {
  return flights.get(sessionId)?.snapshot ?? null;
}
export function hasActiveDeploymentQualification(sessionId: string | undefined): boolean {
  return !!sessionId && flights.get(sessionId)?.dispatchOpen === true;
}
/** Optional standardized streaming-usage request, only for a deliberately
 * armed LM6 flight; ordinary Clack Chats and LM2F stay unchanged. */
export function hasActiveLm6Measurement(sessionId: string | undefined): boolean {
  return !!sessionId && flights.get(sessionId)?.dispatchOpen === true &&
    !!flights.get(sessionId)?.snapshot.measurement;
}
export function qualificationMaxOutputTokens(sessionId: string | undefined): number | undefined {
  return hasActiveDeploymentQualification(sessionId) ? MANAGED_QUALIFICATION_MAX_OUTPUT : undefined;
}

export async function observeDeploymentQualificationPrepared(
  sessionId: string | undefined,
  value: PreparedQualification,
): Promise<void> {
  const flight = sessionId ? flights.get(sessionId) : null;
  if (!flight) return;
  if (!flight.dispatchOpen || (flight.operation && !flight.operation.isOpen()))
    throw new Error("Qualification stopped during request preparation; dispatch forbidden");
  const s = flight.snapshot;
  if (s.measurement) s.measurement.preparedAt ??= Date.now();
  s.prepared++;
  if (s.prepared !== 1 || flight.modelId !== value.modelId ||
      value.activeTools.length !== 0 || value.outputLimit > MANAGED_QUALIFICATION_MAX_OUTPUT ||
      value.outputLimit < 16)
    s.violations.push("wrong-model-multiple-preparations-tools-or-output-limit");
  if (value.messages.length !== 2 ||
      value.messages[0]?.role !== "system" || value.messages[1]?.role !== "user")
    s.violations.push("not-one-system-and-one-user");
  // Assert this was Clack's real constructed system + environment-augmented
  // single user prompt, not an arbitrary other Chat invocation.
  const user = value.messages.find(message => message.role === "user");
  const userText = typeof user?.content === "string" ? user.content :
    user?.content?.filter(part => part.type === "text").map(part => part.text).join("") ?? "";
  if (!userText.endsWith(flight.expectedPrompt))
    s.violations.push("composer-or-env-context-unexpected");
  const systemText = value.messages.filter(message => message.role === "system")
    .map(message => message.content).join("\n");
  if (!systemText.includes("ACTIVE AGENT: Coder"))
    s.violations.push("actual-system-persona-differs");
  s.systemContextDigest = await digest(systemText);
  if (!flight.dispatchOpen || (flight.operation && !flight.operation.isOpen()))
    throw new Error("Qualification stopped during system-context digest; dispatch forbidden");
  s.modelMessagesDigest = await digest(JSON.stringify(value.messages));
  if (!flight.dispatchOpen || (flight.operation && !flight.operation.isOpen()))
    throw new Error("Qualification stopped during request digest; dispatch forbidden");
  if (s.violations.length)
    throw new Error("Bounded qualification request did not match its no-tools, exact-context contract");
  if (!s.measurement)
    await qualificationAcceptanceBoundary(sessionId, "preparation-complete");
}

export function observeDeploymentQualificationStream(
  sessionId: string | undefined,
  chunk: UIMessageChunk,
): void {
  const flight = sessionId ? flights.get(sessionId) : null;
  if (!flight) return;
  if (!flight.dispatchOpen) {
    // A cancelled flight still observes negative/no-continuation evidence.
    // Silencing its observer here would make the LM6 finite quiescence check
    // falsely PASS when text or terminal events arrive after cancellation.
    if (chunk.type === "text-delta" || chunk.type === "text-start" ||
        chunk.type === "text-end" || chunk.type === "finish")
      flight.snapshot.violations.push("stream-event-after-flight-revocation");
    return;
  }
  const s = flight.snapshot;
  switch (chunk.type) {
    case "text-start": s.textStarts++; break;
    case "text-delta":
      s.textDeltas++;
      s.textChars += chunk.delta.length;
      if (chunk.delta.length && s.measurement)
        s.measurement.firstMeaningfulAt ??= Date.now();
      if (s.textChars > 4096) s.violations.push("unbounded-output");
      break;
    case "text-end": s.textEnds++; break;
    case "finish": s.finishes++; break;
    case "message-metadata": s.metadataCount++; break;
  }
}

/** Actual native IPC/provider-observed phases on the SAME production
 * request path as the LM2F stream. Never activated by ordinary Chats. */
export function observeDeploymentQualificationNative(
  sessionId: string | undefined,
  stage: "request" | "admission" | "connection-start" | "connected" |
    "frame" | "terminal" | "cancelled",
  requestId: string,
  at = Date.now(),
  admittedAt?: number | null,
): void {
  const flight = sessionId ? flights.get(sessionId) : undefined;
  if (flight && stage === "request") {
    flight.snapshot.native.opens++;
    flight.snapshot.native.requestId ??= requestId;
    if (!flight.dispatchOpen || (flight.operation && !flight.operation.isOpen()) ||
        flight.snapshot.native.opens !== 1 ||
        flight.snapshot.native.requestId !== requestId)
      flight.snapshot.violations.push("native-dispatch-without-single-open-authority");
  } else if (flight && flight.snapshot.native.requestId === requestId &&
      flight.snapshot.native.opens === 1) {
    if (stage === "terminal" && !flight.dispatchOpen)
      flight.snapshot.violations.push("native-completed-after-cancellation");
    if (stage === "terminal") flight.snapshot.native.terminal = "completed";
    if (stage === "cancelled") flight.snapshot.native.terminal = "cancelled";
  }
  const m = flight?.snapshot.measurement;
  if (!m || !requestId || requestId.length > 256 || !Number.isSafeInteger(at)) return;
  if (stage === "request") {
    m.nativeRequestOpenEvents = (m.nativeRequestOpenEvents ?? 0) + 1;
    if (!m.nativeRequestIds.includes(requestId))
      m.nativeRequestIds.push(requestId);
    m.requestStartAt ??= at;
    if (!/^inference-[1-9]\d{0,19}$/.test(requestId) ||
        m.nativeRequestOpenEvents !== 1 || m.nativeTerminalAt || m.cancelAcknowledgedAt)
      flight!.snapshot.violations.push("invalid-or-duplicate-native-request");
    return;
  }
  // The session is necessary but not sufficient identity. Rust channel
  // stages must belong to exactly the one opened inference-N in this flight;
  // neither a stray terminal nor a prior flight can certify this request.
  if (m.nativeRequestOpenEvents !== 1 || m.nativeRequestIds.length !== 1 ||
      m.nativeRequestIds[0] !== requestId) {
    flight!.snapshot.violations.push("native-event-without-matching-open");
    return;
  }
  if ((m.nativeTerminalAt || m.cancelAcknowledgedAt) &&
      (stage === "terminal" || stage === "cancelled" || stage === "frame")) {
    flight!.snapshot.violations.push("native-event-after-terminal");
    return;
  }
  if (stage === "admission" && admittedAt != null && Number.isSafeInteger(admittedAt))
    m.providerAdmittedAt ??= admittedAt;
  if (stage === "connection-start") m.connectionStartAt ??= at;
  if (stage === "connected") m.providerConnectedAt ??= at;
  if (stage === "frame") m.firstFrameAt ??= at;
  if (stage === "terminal") m.nativeTerminalAt ??= at;
  if (stage === "cancelled") m.cancelAcknowledgedAt ??= at;
}

/** SDK usage, never inferred from string length or a model name. */
export function observeDeploymentQualificationUsage(
  sessionId: string | undefined, input: number | null | undefined,
  output: number | null | undefined,
): void {
  const m = sessionId ? flights.get(sessionId)?.snapshot.measurement : undefined;
  if (!m) return;
  if (input != null && Number.isSafeInteger(input) && input >= 0)
    m.promptTokens = input;
  if (output != null && Number.isSafeInteger(output) && output >= 0)
    m.generatedTokens = output;
}

export function observeDeploymentQualificationOllamaTiming(
  sessionId: string | undefined,
  data: { promptEvalDurationNs?: number; evalDurationNs?: number;
    loadDurationNs?: number; promptEvalCount?: number; evalCount?: number },
): void {
  const m = sessionId ? flights.get(sessionId)?.snapshot.measurement : undefined;
  if (!m) return;
  const valid = (n: number | undefined) =>
    n !== undefined && Number.isSafeInteger(n) && n >= 0 ? n : null;
  m.promptDurationNs = valid(data.promptEvalDurationNs);
  m.generationDurationNs = valid(data.evalDurationNs);
  m.loadDurationNs = valid(data.loadDurationNs);
  if (data.promptEvalCount !== undefined) m.promptTokens = valid(data.promptEvalCount);
  if (data.evalCount !== undefined) m.generatedTokens = valid(data.evalCount);
}

export function observeDeploymentQualificationCancellation(
  sessionId: string, at = Date.now(),
): void {
  const m = flights.get(sessionId)?.snapshot.measurement;
  if (m) m.cancelRequestedAt ??= at;
}

/** Read only the one explicitly armed bounded request's volatile progress.
 * No request is started by this observer and nothing is persisted here. */
export function peekDeploymentQualificationMeasurement(sessionId: string) {
  return flights.get(sessionId)?.snapshot.measurement ?? null;
}

/** Native no-continuation proof is bounded to this already-open flight and its
 * observation window. Never equate the finite window with eternal provider
 * inactivity or infer anything from another session's activity. */
export async function observeLm6CancellationQuiescence(
  sessionId: string, windowMs = 1_500,
): Promise<boolean | null> {
  if (!Number.isSafeInteger(windowMs) || windowMs < 1 || windowMs > 1_500)
    throw new Error("LM6 cancellation observation exceeds its fixed bound");
  const flight = flights.get(sessionId);
  const m = flight?.snapshot.measurement;
  if (!flight || !m || !m.cancelRequestedAt || !m.cancelAcknowledgedAt ||
      !m.firstMeaningfulAt || m.nativeRequestOpenEvents !== 1 ||
      m.nativeRequestIds.length !== 1 || m.nativeTerminalAt || flight.snapshot.violations.length)
    return null;
  const original = {
    opens: m.nativeRequestOpenEvents, id: m.nativeRequestIds[0],
    output: flight.snapshot.textChars, deltas: flight.snapshot.textDeltas,
    failures: flight.snapshot.violations.length,
  };
  await new Promise<void>(resolve => setTimeout(resolve, windowMs));
  const after = flights.get(sessionId);
  const current = after?.snapshot.measurement;
  if (!after || !current) return null;
  return current.nativeRequestOpenEvents === original.opens &&
    current.nativeRequestIds.length === 1 && current.nativeRequestIds[0] === original.id &&
    current.cancelAcknowledgedAt === m.cancelAcknowledgedAt &&
    current.nativeTerminalAt === null && after.snapshot.textChars === original.output &&
    after.snapshot.textDeltas === original.deltas &&
    after.snapshot.violations.length === original.failures;
}

/** Allow the existing native request's asynchronous settled event to reach
 * Clack before LM6 disarms its observer. This only waits for actual evidence:
 * it never dispatches/retries inference and absence remains Unknown. */
export async function waitForRecordedLm6NativeSettlement(
  sessionId: string, maxWaitMs = 1_500,
): Promise<void> {
  if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs < 0 || maxWaitMs > 1_500)
    throw new Error("LM6 native settlement observation exceeds its fixed bound");
  const until = Date.now() + maxWaitMs;
  while (true) {
    const m = peekDeploymentQualificationMeasurement(sessionId);
    if (!m || m.nativeTerminalAt || m.cancelAcknowledgedAt)
      return;
    const remaining = until - Date.now();
    if (remaining <= 0) return;
    await new Promise<void>(resolve => setTimeout(resolve, Math.min(50, remaining)));
  }
}
