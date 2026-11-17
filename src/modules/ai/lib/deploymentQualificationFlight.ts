import type { ModelMessage, UIMessageChunk } from "ai";

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
};

const flights = new Map<string, LiveFlight>();

async function digest(text: string): Promise<`sha256:${string}`> {
  const value = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `sha256:${[...new Uint8Array(value)]
    .map(b => b.toString(16).padStart(2, "0")).join("")}`;
}

export function armDeploymentQualification(
  sessionId: string,
  modelId: string,
  personaId: string,
  opts?: { expectedPrompt?: string; measure?: boolean },
): void {
  if (flights.size || !sessionId || !modelId || personaId !== "builtin:coder")
    throw new Error("Another bounded qualification is active or the persona is not Chat-only Coder");
  flights.set(sessionId, {
    sessionId, modelId, personaId, startedAt: Date.now(),
    expectedPrompt: opts?.expectedPrompt ?? MANAGED_QUALIFICATION_PROMPT,
    snapshot: {
      prepared: 0, systemContextDigest: null, modelMessagesDigest: null,
      textStarts: 0, textDeltas: 0, textEnds: 0, textChars: 0,
      finishes: 0, metadataCount: 0, violations: [],
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
  if (!flight) return null;
  flights.delete(sessionId);
  return structuredClone(flight.snapshot);
}
export function hasActiveDeploymentQualification(sessionId: string | undefined): boolean {
  return !!sessionId && flights.has(sessionId);
}
/** Optional standardized streaming-usage request, only for a deliberately
 * armed LM6 flight; ordinary Clack Chats and LM2F stay unchanged. */
export function hasActiveLm6Measurement(sessionId: string | undefined): boolean {
  return !!sessionId && !!flights.get(sessionId)?.snapshot.measurement;
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
  s.modelMessagesDigest = await digest(JSON.stringify(value.messages));
  if (s.violations.length)
    throw new Error("Bounded qualification request did not match its no-tools, exact-context contract");
}

export function observeDeploymentQualificationStream(
  sessionId: string | undefined,
  chunk: UIMessageChunk,
): void {
  const flight = sessionId ? flights.get(sessionId) : null;
  if (!flight) return;
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
