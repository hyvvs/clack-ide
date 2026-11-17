import type { ModelMessage, UIMessageChunk } from "ai";

/** One explicit, short Chat qualification uses Clack's real Agent request
 * construction and parsed UI stream. No raw prompts or output are persisted
 * in this observer. No mission/Agent tool actions are permitted. */
export const MANAGED_QUALIFICATION_PROMPT =
  "Reply with exactly LM2F-CHAT-QUALIFIED and nothing else.";
export const MANAGED_QUALIFICATION_EXPECTED = "LM2F-CHAT-QUALIFIED";
export const MANAGED_QUALIFICATION_MAX_OUTPUT = 128;

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
};
type LiveFlight = {
  sessionId: string;
  modelId: string;
  personaId: string;
  startedAt: number;
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
): void {
  if (flights.size || !sessionId || !modelId || personaId !== "builtin:coder")
    throw new Error("Another bounded qualification is active or the persona is not Chat-only Coder");
  flights.set(sessionId, {
    sessionId, modelId, personaId, startedAt: Date.now(),
    snapshot: {
      prepared: 0, systemContextDigest: null, modelMessagesDigest: null,
      textStarts: 0, textDeltas: 0, textEnds: 0, textChars: 0,
      finishes: 0, metadataCount: 0, violations: [],
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
  if (!userText.endsWith(MANAGED_QUALIFICATION_PROMPT))
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
      if (s.textChars > 4096) s.violations.push("unbounded-output");
      break;
    case "text-end": s.textEnds++; break;
    case "finish": s.finishes++; break;
    case "message-metadata": s.metadataCount++; break;
  }
}
