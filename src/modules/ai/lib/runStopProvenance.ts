// Fixed, privacy-safe codes only: never persist AbortSignal.reason,
// SDK errors, endpoint URLs, prompts or tool payloads.
export const RUN_STOP_SOURCES = [
  "explicit-user", "agent-watchdog", "provider-timeout", "parent-signal",
  "host-shutdown", "chat-disposal", "unknown",
] as const;
export const RUN_STOP_REASONS = [
  "user-stop", "cancel-requested", "parent-abort", "host-shutdown",
  "session-deleted", "provider-retry-deadline", "connect-timeout",
  "first-output-timeout", "stream-idle-timeout", "overall-deadline",
  "excessive_whitespace", "repeated_output", "repeated_tool_call",
  "continuation_loop", "unspecified",
] as const;
export const RUN_STOP_POLICIES = [
  "provider-recovery-120s", "native-self-hosted", "native-legacy",
  "output-watchdog",
] as const;
export type RunStopSource = (typeof RUN_STOP_SOURCES)[number];
export type RunStopReason = (typeof RUN_STOP_REASONS)[number];
export type RunStopPolicy = (typeof RUN_STOP_POLICIES)[number];
export type RunStopCause = {
  source: RunStopSource;
  reason: RunStopReason;
  policy?: RunStopPolicy;
};
export type RunStopProvenance = RunStopCause & { at: number };
export function safeRunStopCause(value: unknown): RunStopCause | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!RUN_STOP_SOURCES.some(v => v === candidate.source) ||
      !RUN_STOP_REASONS.some(v => v === candidate.reason) ||
      (candidate.policy !== undefined && !RUN_STOP_POLICIES.some(v => v === candidate.policy)))
    return null;
  return {
    source: candidate.source as RunStopSource,
    reason: candidate.reason as RunStopReason,
    ...(candidate.policy ? { policy: candidate.policy as RunStopPolicy } : {}),
  };
}
export function unknownRunStop(at: number): RunStopProvenance {
  return { source: "unknown", reason: "unspecified", at };
}
