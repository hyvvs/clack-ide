import {
  TOOL_VERIFICATION,
  TOOL_PROBE_NAME,
  probeArguments,
  toolVerificationSchema,
  type ToolVerification,
} from "@/modules/ai/lib/toolVerificationSchema";
import {
  contextMetadata,
  contextReasoningIdentity,
  contextRuntime,
} from "@/modules/ai/lib/contextCalibrationTrust";
import type {
  SelfHostedEndpoint,
  SelfHostedProfile,
  SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";

export type ToolVerificationState =
  | "Advertised / unverified"
  | "Verified"
  | "Unsupported"
  | "Incompatible"
  | "Unverified"
  | "Incomplete"
  | "Stale"
  | "Verifying";
export type ProbeObservation = {
  calls: { name: string; input: unknown; invalid?: boolean }[];
  text: string;
  finish: string;
  firstBodyAt: number | null;
  callAt: number | null;
};
export function classifyToolObservation(value: ProbeObservation) {
  if (!["stop", "tool-calls", "length"].includes(value.finish))
    return "transport" as const;
  if (value.calls.length > 1) return "multiple-calls" as const;
  const call = value.calls[0];
  if (call)
    return call.name !== TOOL_PROBE_NAME
      ? ("wrong-tool" as const)
      : call.invalid || !probeArguments.safeParse(call.input).success
        ? ("invalid-arguments" as const)
        : ("native-call" as const);
  if (value.finish === "length") return "output-length" as const;
  return value.text.trim() ? ("text-only" as const) : ("empty" as const);
}
export function toolScope(
  profile: SelfHostedProfile,
  endpoint: SelfHostedEndpoint,
  now = Date.now(),
): ToolVerification["scope"] | undefined {
  const runtime = contextRuntime(endpoint.id);
  if (
    (endpoint.backendHint ?? endpoint.detectedBackend) !== "ollama" ||
    !profile.modelRevision ||
    !runtime ||
    runtime.configurationRevision !== endpoint.configurationRevision ||
    runtime.at > now ||
    now - runtime.at >= 30_000
  )
    return;
  return {
    endpointId: endpoint.id,
    configurationRevision: endpoint.configurationRevision,
    model: profile.transportModelId,
    deployment: profile.deploymentId,
    digest: profile.modelRevision,
    backend: "ollama",
    runtimeEpoch: runtime.epoch,
    providerVersion: runtime.version,
    reasoning: contextReasoningIdentity(profile, endpoint, now),
    protocol: TOOL_VERIFICATION.protocol,
  };
}
export function sameToolScope(
  a: ToolVerification["scope"],
  b: ToolVerification["scope"] | undefined,
) {
  return !!b && JSON.stringify(a) === JSON.stringify(b);
}
export function toolVerificationState(
  state: SelfHostedState,
  profile: SelfHostedProfile,
  now = Date.now(),
  expectedContext?: number,
): ToolVerificationState {
  const endpoint = state.endpoints.find(
    (e) => e.id === profile.endpointId && e.deletedAt == null,
  );
  if (!endpoint) return "Unverified";
  if (
    contextMetadata(profile, endpoint, "trainedForTools", now, 300_000) ===
    false
  )
    return "Unsupported";
  const record = profile.toolVerification;
  if (!record)
    return contextMetadata(
      profile,
      endpoint,
      "trainedForTools",
      now,
      300_000,
    ) === true
      ? "Advertised / unverified"
      : "Unverified";
  if (!sameToolScope(record.scope, toolScope(profile, endpoint, now)))
    return "Stale";
  if (expectedContext !== undefined && record.context !== expectedContext) return "Stale";
  if (record.status === "verifying") return "Incomplete";
  if (record.proof && record.proof.at <= now && record.proof.expiresAt > now)
    return "Verified";
  if (record.status === "incomplete") return "Incomplete";
  if (
    record.completedAt === null ||
    now - record.completedAt >= TOOL_VERIFICATION.ttlMs
  )
    return "Stale";
  return record.status === "incompatible"
    ? "Incompatible"
    : record.status === "unsupported"
      ? "Unsupported"
      : "Stale";
}
export function commitToolVerification(
  state: SelfHostedState,
  profileId: string,
  record: ToolVerification,
  previousId?: string,
) {
  const profile = state.profiles.find((p) => p.id === profileId),
    endpoint = state.endpoints.find(
      (e) => e.id === profile?.endpointId && e.deletedAt == null,
    );
  if (
    !profile ||
    !endpoint ||
    profile.endpointId !== record.scope.endpointId ||
    endpoint.configurationRevision !== record.scope.configurationRevision ||
    profile.transportModelId !== record.scope.model ||
    profile.modelRevision !== record.scope.digest ||
    profile.deploymentId !== record.scope.deployment ||
    (endpoint.backendHint ?? endpoint.detectedBackend) !==
      record.scope.backend ||
    (profile.toolVerification?.id !== previousId &&
      profile.toolVerification?.id !== record.id)
  )
    throw new Error("Tool verification settings changed");
  const parsed = toolVerificationSchema.parse(record);
  return {
    ...state,
    profiles: state.profiles.map((p) =>
      p.id === profileId ? { ...p, toolVerification: parsed } : p,
    ),
  };
}
export type ToolProbeDependencies = {
  refresh: () => Promise<SelfHostedState>;
  inspect: () => Promise<void>;
  request: (
    state: SelfHostedState,
    signal: AbortSignal,
  ) => Promise<ProbeObservation>;
  commit: (
    change: (state: SelfHostedState) => SelfHostedState,
  ) => Promise<SelfHostedState>;
  context: (state: SelfHostedState, profile: SelfHostedProfile) => number;
  clock?: () => number;
};
export async function runToolVerification(
  options: { profileId: string; signal: AbortSignal; force?: boolean },
  deps: ToolProbeDependencies,
) {
  const now = deps.clock ?? Date.now;
  options.signal.throwIfAborted();
  let state = await deps.refresh();
  const profile = state.profiles.find((p) => p.id === options.profileId),
    endpoint = state.endpoints.find(
      (e) => e.id === profile?.endpointId && e.deletedAt == null,
    );
  if (!profile || !endpoint) throw new Error("Model unavailable");
  const inventory = state.inventories?.find(
    (i) =>
      i.endpointId === endpoint.id &&
      i.configurationRevision === endpoint.configurationRevision,
  );
  if (!inventory?.connected) return { status: "offline" as const };
  if (
    contextMetadata(profile, endpoint, "trainedForTools", now(), 300_000) ===
    false
  )
    return { status: "unsupported" as const };
  if (
    (endpoint.backendHint ?? endpoint.detectedBackend) !== "ollama" ||
    !profile.modelRevision
  )
    return { status: "unavailable" as const };
  await deps.inspect();
  const scope = toolScope(profile, endpoint, now());
  if (!scope) return { status: "unavailable" as const };
  const context = deps.context(state, profile);
  const previous = profile.toolVerification,
    comparable =
      previous && previous.context === context && sameToolScope(previous.scope, scope) ? previous : undefined;
  const current = toolVerificationState(state, profile, now(), context);
  if (
    !options.force &&
    (["Verified", "Incompatible"].includes(current) ||
      (comparable?.retryAfter ?? 0) > now())
  )
    return previous;
  const record: ToolVerification = {
    version: 1,
    id: crypto.randomUUID(),
    scope,
    status: "verifying",
    outcome: "interrupted",
    context,
    output: TOOL_VERIFICATION.output,
    startedAt: now(),
    completedAt: null,
    firstBodyAt: null,
    callAt: null,
    calls: 0,
    validArguments: false,
    textualIntent: false,
    textChars: 0,
    finish: null,
    proof: comparable?.proof ?? null,
    retryAfter: 0,
  };
  const save = async () => {
    state = await deps.commit((s) =>
      commitToolVerification(s, profile.id, record, previous?.id),
    );
  };
  await save();
  const deadline = new AbortController(),
    timer = setTimeout(
      () => deadline.abort(new Error("Tool verification deadline")),
      TOOL_VERIFICATION.deadlineMs,
    );
  const signal = AbortSignal.any([deadline.signal, options.signal]);
  try {
    const result = await deps.request(state, signal);
    signal.throwIfAborted();
    record.outcome = classifyToolObservation(result);
    record.calls = Math.min(2, result.calls.length);
    record.validArguments = record.outcome === "native-call";
    record.firstBodyAt = result.firstBodyAt;
    record.callAt = result.callAt;
    record.finish = result.finish.slice(0, 64);
    record.textChars = Math.min(65536, result.text.length);
    record.textualIntent =
      /<tool|<function|"(?:tool|function|name)"\s*:|\bcall\b/i.test(
        result.text,
      );
    state = await deps.refresh();
    await deps.inspect();
    const updated = state.profiles.find((p) => p.id === profile.id),
      server = state.endpoints.find((e) => e.id === endpoint.id);
    if (
      !updated ||
      !server ||
      !sameToolScope(scope, toolScope(updated, server, now())) || deps.context(state, updated) !== record.context
    ) {
      record.outcome = "revision-changed";
      record.proof = null;
    } else if (
      !state.inventories?.some(
        (i) =>
          i.endpointId === endpoint.id &&
          i.configurationRevision === endpoint.configurationRevision &&
          i.connected,
      )
    )
      record.outcome = "offline";
    record.status =
      record.outcome === "native-call"
        ? "verified"
        : [
              "wrong-tool",
              "invalid-arguments",
              "multiple-calls",
              "text-only",
            ].includes(record.outcome)
          ? "incompatible"
          : "incomplete";
    if (record.status === "verified")
      record.proof = { at: now(), expiresAt: now() + TOOL_VERIFICATION.ttlMs };
    if (record.status === "incompatible") record.proof = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record.status = "incomplete";
    record.outcome = options.signal.aborted
      ? "cancelled"
      : signal.aborted ||
          /timeout|timed.out|deadline|stream.idle|first.output/i.test(message)
        ? "timeout"
        : "transport";
  } finally {
    clearTimeout(timer);
    deadline.abort();
  }
  record.completedAt = now();
  record.retryAfter =
    now() +
    (record.status === "incomplete"
      ? TOOL_VERIFICATION.backoffMs
      : TOOL_VERIFICATION.ttlMs);
  await save();
  return record;
}
