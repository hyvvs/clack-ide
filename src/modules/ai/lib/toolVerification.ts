import {
  TOOL_VERIFICATION,
  TOOL_PROBE_NAME,
  probeArguments,
  toolVerificationSchema,
  type ToolVerification,
  type ToolConfiguration,
  createToolRequestBudget,
  type ToolRequestBudget,
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
  | "Needs attention"
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
// Keep a bounded negative observation independently of native capability proof.
function toolFailure(record: ToolVerification | undefined) {
  if (record?.failure) return record.failure;
  if (record?.status === "incompatible" && record.completedAt !== null &&
    ["text-only", "wrong-tool", "invalid-arguments", "multiple-calls"].includes(record.outcome))
    return {
      at: record.completedAt,
      expiresAt: record.completedAt + TOOL_VERIFICATION.ttlMs,
      outcome: record.outcome as NonNullable<ToolVerification["failure"]>["outcome"],
    };
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
  const failure = toolFailure(record);
  if (failure && failure.at <= now && failure.expiresAt > now) return "Needs attention";
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
  tierProof = false,
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
    (verificationRecord(profile, record.configuration, tierProof ? record.context : undefined)?.id !== previousId &&
      verificationRecord(profile, record.configuration, tierProof ? record.context : undefined)?.id !== record.id)
  )
    throw new Error("Tool verification settings changed");
  const parsed = toolVerificationSchema.parse(record);
  return {
    ...state,
    profiles: state.profiles.map((p) =>
      p.id !== profileId ? p : tierProof ? {
        ...p,
        agentToolTierProofs: [
          ...(p.agentToolTierProofs ?? []).filter(r => r.context !== record.context ||
            !sameToolConfiguration(r.configuration, record.configuration)),
          parsed,
        ].slice(-18),
      } : record.configuration ? {
        ...p, agentToolConfigurations: [
          ...(p.agentToolConfigurations ?? []).filter(r => !sameToolConfiguration(r.configuration, record.configuration)), parsed,
        ].slice(-2),
      } : { ...p, toolVerification: parsed },
    ),
  };
}
export function sameToolConfiguration(a?: ToolConfiguration, b?: ToolConfiguration) {
  return a?.choice === b?.choice && a?.wire === b?.wire;
}
export function verificationRecord(profile: SelfHostedProfile, configuration?: ToolConfiguration, context?: number) {
  if (context !== undefined) {
    const tier = profile.agentToolTierProofs?.find(r => r.context === context &&
      sameToolConfiguration(r.configuration, configuration));
    if (tier) return tier;
  }
  const legacy = configuration ? profile.agentToolConfigurations?.find(r => sameToolConfiguration(r.configuration, configuration)) : profile.toolVerification;
  return context === undefined || legacy?.context === context ? legacy : undefined;
}
export function configuredToolState(state: SelfHostedState, profile: SelfHostedProfile, configuration?: ToolConfiguration, now = Date.now(), context?: number) {
  return toolVerificationState(state, {...profile, toolVerification: verificationRecord(profile, configuration, context)}, now, context);
}
// Failure-only, privacy-safe decision operands. Null means the operand cannot
// be evaluated from available evidence; it is never an affirmative PASS.
export function toolEligibilityPredicates(
  state: SelfHostedState,
  profile: SelfHostedProfile,
  configuration?: ToolConfiguration,
  now = Date.now(),
  expectedContext?: number,
) {
  const endpoint = state.endpoints.find(e => e.id === profile.endpointId && e.deletedAt == null);
  const runtime = endpoint ? contextRuntime(endpoint.id) : undefined;
  const record = verificationRecord(profile, configuration, expectedContext);
  const scope = endpoint ? toolScope(profile, endpoint, now) : undefined;
  const failure = toolFailure(record);
  return {
    endpointPresent: !!endpoint,
    modelRevisionPresent: !!profile.modelRevision,
    toolCapabilityNotDenied: endpoint ? contextMetadata(profile, endpoint, "trainedForTools", now, 300_000) !== false : null,
    recordPresent: !!record,
    runtimeObserved: !!runtime,
    runtimeFresh: runtime ? runtime.at <= now && now - runtime.at < 30_000 : null,
    endpointRevisionMatches: endpoint && runtime ? runtime.configurationRevision === endpoint.configurationRevision : null,
    modelIdentityMatches: record && scope ? record.scope.model === scope.model && record.scope.deployment === scope.deployment && record.scope.digest === scope.digest && record.scope.endpointId === scope.endpointId : null,
    runtimeEpochMatches: record && scope ? record.scope.runtimeEpoch === scope.runtimeEpoch : null,
    providerVersionMatches: record && scope ? record.scope.providerVersion === scope.providerVersion : null,
    reasoningIdentityMatches: record && scope ? record.scope.reasoning === scope.reasoning : null,
    toolProtocolMatches: record ? record.scope.protocol === TOOL_VERIFICATION.protocol : null,
    scopeMatches: record ? sameToolScope(record.scope, scope) : null,
    expectedContextMatches: record && expectedContext !== undefined ? record.context === expectedContext : null,
    failureInactive: record ? !(failure && failure.at <= now && failure.expiresAt > now) : null,
    proofFresh: record ? !!record.proof && record.proof.at <= now && record.proof.expiresAt > now : null,
    notVerifying: record ? record.status !== "verifying" : null,
    verdict: configuredToolState(state, profile, configuration, now, expectedContext),
  };
}
export type ToolProbeDependencies = {
  refresh: () => Promise<SelfHostedState>;
  inspect: () => Promise<void>;
  request: (
    state: SelfHostedState,
    signal: AbortSignal,
    configuration?: ToolConfiguration,
    output?: number,
  ) => Promise<ProbeObservation>;
  commit: (
    change: (state: SelfHostedState) => SelfHostedState,
  ) => Promise<SelfHostedState>;
  context: (state: SelfHostedState, profile: SelfHostedProfile) => number;
  clock?: () => number;
};
export async function runToolVerification(
  options: { profileId: string; signal: AbortSignal; force?: boolean; configuration?: ToolConfiguration; requestBudget?: ToolRequestBudget; tierContext?: number },
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
  if (options.tierContext !== undefined && options.tierContext !== context)
    throw new Error("Requested native tool verification context differs from the proof tier");
  const overrides = JSON.stringify(profile.overrides);
  const configuration = options.configuration ? { ...options.configuration } : undefined;
  const previous = verificationRecord(profile, options.configuration, options.tierContext),
    comparable =
      previous && previous.context === context && sameToolScope(previous.scope, scope) ? previous : undefined;
  const current = configuredToolState(state, profile, options.configuration, now(), context);
  if (
    !options.force &&
    (["Verified", "Incompatible", "Needs attention"].includes(current) ||
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
    attempts: [],
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
    ...(configuration ? {configuration: { ...configuration }} : {}),
    ...(comparable?.confirmation ? {confirmation: comparable.confirmation} : {}),
    ...(toolFailure(comparable) ? { failure: toolFailure(comparable) } : {}),
    retryAfter: 0,
  };
  const save = async () => {
    state = await deps.commit((s) =>
      commitToolVerification(s, profile.id, record, previous?.id, options.tierContext !== undefined),
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
    const budget = options.requestBudget ?? createToolRequestBudget();
    const checkCurrent = async () => {
      state = await deps.refresh();
      await deps.inspect();
      signal.throwIfAborted();
      const updated = state.profiles.find(p => p.id === profile.id);
      const server = state.endpoints.find(e => e.id === endpoint.id);
      if (!updated || !server ||
        !sameToolScope(scope, toolScope(updated, server, now())) ||
        deps.context(state, updated) !== context ||
        JSON.stringify(updated.overrides) !== overrides ||
        !sameToolConfiguration(configuration, options.configuration)) {
        record.proof = null;
        delete record.confirmation;
        delete record.failure;
        return "revision-changed" as const;
      }
      if (!state.inventories?.some(i => i.endpointId === endpoint.id &&
        i.configurationRevision === endpoint.configurationRevision && i.connected))
        return "offline" as const;
    };
    // A confirmation can reuse its exact same-scope successful allowance.
    const start = comparable?.status === "verified" && comparable.outcome === "native-call" &&
      comparable.proof && comparable.proof.expiresAt > now() ? comparable.output : TOOL_VERIFICATION.output;
    for (const output of TOOL_VERIFICATION.outputs.filter(n => n >= start)) {
      const before = await checkCurrent();
      if (before) { record.outcome = before; break; }
      if (budget.remaining <= 0) { record.outcome = "request-limit"; break; }
      budget.remaining--;
      record.output = output;
      const startedAt = now();
      const result = await deps.request(state, signal, configuration, output);
      signal.throwIfAborted();
      record.outcome = classifyToolObservation(result);
      record.calls = Math.min(2, result.calls.length);
      record.validArguments = record.outcome === "native-call";
      record.firstBodyAt = result.firstBodyAt;
      record.callAt = result.callAt;
      record.finish = result.finish.slice(0, 64);
      record.attempts?.push({ output, outcome: record.outcome, finish: record.finish, startedAt, completedAt: now() });
      record.textChars = Math.min(65536, result.text.length);
      record.textualIntent = /<tool|<function|"(?:tool|function|name)"\s*:|\bcall\b/i.test(result.text);
      const after = await checkCurrent();
      if (after) record.outcome = after;
      if (record.outcome !== "output-length" || output === 2048) break;
      await save();
    }
    record.status =
      record.outcome === "native-call"
        ? "verified"
        : [
              "wrong-tool",
              "invalid-arguments",
              "multiple-calls",
              "text-only",
            ].includes(record.outcome)
          ? "needs-attention"
          : "incomplete";
    if (record.status === "verified") {
      record.proof = { at: now(), expiresAt: now() + TOOL_VERIFICATION.ttlMs };
      if (record.configuration && comparable?.proof &&
        comparable.proof.at <= now() && comparable.proof.expiresAt > now() &&
        configuredToolState(state, profile, options.configuration, now(), context) === "Verified")
        record.confirmation = {id: comparable.id, ...comparable.proof};
    }
    if (record.status === "needs-attention")
      record.failure = {
        at: now(),
        expiresAt: now() + TOOL_VERIFICATION.ttlMs,
        outcome: record.outcome as NonNullable<ToolVerification["failure"]>["outcome"],
      };
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
