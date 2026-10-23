import {
  CONTEXT_CALIBRATION,
  contextCalibrationSchema,
  type ContextCalibration,
  type ContextOutcome,
} from "@/modules/ai/lib/contextCalibrationSchema";
import {
  contextMetadata,
  contextReasoningIdentity,
  contextRuntime,
  trustedContext,
} from "@/modules/ai/lib/contextCalibrationTrust";
import {
  endpointBackend,
  profileEvidence,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";
import { sanitizeAiErrorText } from "@/modules/ai/lib/errors";
import { waitForRecovery } from "@/modules/ai/lib/providerRetry";

export function calibrationCandidates(
  advertised: number,
  ceiling: number = CONTEXT_CALIBRATION.ceiling,
  previous?: ContextCalibration,
) {
  const upper = Math.min(
    advertised,
    ceiling,
    CONTEXT_CALIBRATION.ceiling,
    previous?.failedNext ? previous.failedNext - 1 : Infinity,
  );
  const ladder = CONTEXT_CALIBRATION.candidates.filter((n) => n <= upper);
  if (!ladder.length && upper >= 512 && !previous?.failedNext)
    return [Math.floor(upper)];
  return ladder.filter((n) => n >= (previous?.highest ?? 0));
}
export function classifyContextFailure(error: unknown): ContextOutcome {
  const message = sanitizeAiErrorText(
    error instanceof Error ? error.message : String(error),
  ).slice(0, 4096);
  if (
    /out of memory|insufficient (?:system |gpu |device )?memory|unable to allocate|failed to allocate|requires more (?:system )?memory|cuda.*memory/i.test(
      message,
    )
  )
    return "capacity";
  if (/timed?[- ]?out|deadline|stream[- ]idle|first[- ]output/i.test(message))
    return "timeout";
  return "transient";
}
export function commitContextCalibration(
  state: SelfHostedState,
  profileId: string,
  record: ContextCalibration,
  previousId?: string,
): SelfHostedState {
  const profile = state.profiles.find((p) => p.id === profileId),
    endpoint = state.endpoints.find(
      (e) => e.id === profile?.endpointId && e.deletedAt == null,
    );
  if (
    !profile ||
    !endpoint ||
    endpoint.id !== record.scope.endpointId ||
    endpoint.configurationRevision !== record.scope.configurationRevision ||
    profile.transportModelId !== record.scope.model ||
    profile.modelRevision !== record.scope.digest ||
    profile.deploymentId !== record.scope.deployment ||
    endpointBackend(endpoint) !== record.scope.backend ||
    (profile.contextCalibration?.id !== previousId &&
      profile.contextCalibration?.id !== record.id)
  )
    throw new Error("Context verification identity changed");
  const parsed = contextCalibrationSchema.parse(record);
  const recommendations = { ...profile.recommendations };
  if (parsed.highest)
    recommendations.workingContext = {
      ...profileEvidence(
        state,
        profileId,
        "workingContext",
        parsed.highest,
        "measured",
        parsed.updatedAt,
        "observed",
      ),
      expiresAt: parsed.expiresAt,
    };
  else delete recommendations.workingContext;
  return {
    ...state,
    profiles: state.profiles.map((p) =>
      p.id === profileId
        ? {
            ...p,
            contextCalibration: parsed,
            recommendations,
            updatedAt: record.updatedAt,
          }
        : p,
    ),
  };
}
type Options = {
  state: SelfHostedState;
  profileId: string;
  signal: AbortSignal;
  ceiling?: number;
  force?: boolean;
  onProgress?: (record: ContextCalibration) => void;
};
export type ContextCalibrationOptions = Options;
export type ContextCalibrationDependencies = {
  refresh: () => Promise<{ state: SelfHostedState; snapshot: ProbeSnapshot }>;
  inspectRuntime: () => Promise<void>;
  request: (
    context: number,
    state: SelfHostedState,
    signal: AbortSignal,
  ) => Promise<{ finish: string }>;
  commit: (
    change: (state: SelfHostedState) => SelfHostedState,
  ) => Promise<SelfHostedState>;
  clock?: () => number;
};
export async function runContextCalibration(
  options: Options,
  deps: ContextCalibrationDependencies,
) {
  const now = deps.clock ?? Date.now;
  options.signal.throwIfAborted();
  const initial = await deps.refresh();
  const profile = initial.state.profiles.find(
    (p) => p.id === options.profileId,
  );
  const endpoint = initial.state.endpoints.find(
    (e) => e.id === profile?.endpointId && e.deletedAt == null,
  );
  if (!profile || !endpoint) throw new Error("Model unavailable");
  const unsupported = () =>
    endpointBackend(endpoint) !== "ollama" ||
    !profile.modelRevision ||
    profile.deploymentId !== null ||
    contextMetadata(profile, endpoint, "runtimeContext", now(), 300_000) !==
      "per-request";
  if (unsupported()) return { status: "unsupported" as const };
  if (!initial.snapshot.connected) return { status: "offline" as const };
  if (profile.overrides.workingContext && !options.force)
    return { status: "manual" as const };
  await deps.inspectRuntime();
  const runtime = contextRuntime(endpoint.id);
  if (!runtime) throw new Error("Runtime verification unavailable");
  const prior = profile.contextCalibration;
  if (!options.force && trustedContext(initial.state, profile, now()))
    return prior;
  if (
    !options.force &&
    prior &&
    prior.retryAfter > now() &&
    prior.scope.runtimeEpoch === runtime.epoch &&
    prior.scope.providerVersion === runtime.version &&
    prior.scope.digest === profile.modelRevision &&
    prior.scope.configurationRevision === endpoint.configurationRevision
  )
    return prior;
  const reasoning = contextReasoningIdentity(profile, endpoint, now());
  const comparable =
    prior &&
    prior.scope.digest === profile.modelRevision &&
    prior.scope.providerVersion === runtime.version &&
    prior.scope.runtimeEpoch === runtime.epoch &&
    prior.scope.reasoning === reasoning &&
    prior.scope.configurationRevision === endpoint.configurationRevision
      ? prior
      : undefined;
  const advertised = contextMetadata(
    profile,
    endpoint,
    "advertisedContext",
    now(),
    300_000,
  );
  if (typeof advertised !== "number" || !Number.isSafeInteger(advertised))
    return { status: "unsupported" as const };
  const candidates = calibrationCandidates(
    advertised,
    options.ceiling,
    comparable,
  );
  if (!candidates.length && !comparable?.highest)
    return { status: "unsupported" as const };
  const retained = comparable?.highest ?? undefined;
  const record: ContextCalibration = {
    version: 1,
    id: crypto.randomUUID(),
    scope: {
      endpointId: endpoint.id,
      configurationRevision: endpoint.configurationRevision,
      model: profile.transportModelId,
      deployment: profile.deploymentId,
      digest: profile.modelRevision ?? "",
      backend: "ollama",
      runtimeEpoch: runtime.epoch,
      providerVersion: runtime.version,
      reasoning,
    },
    status: "verifying",
    highest: retained ?? null,
    failedNext: comparable?.failedNext ?? null,
    failure: comparable?.failure ?? null,
    allocation: retained ? (comparable?.allocation ?? null) : null,
    startedAt: now(),
    updatedAt: comparable?.updatedAt ?? now(),
    expiresAt: retained ? (comparable?.expiresAt ?? 0) : 0,
    retryAfter: 0,
    attempts: retained
      ? (comparable?.attempts
          .filter((a) => a.context === retained && a.outcome === "success")
          .slice(-1) ?? [])
      : [],
  };
  let state = initial.state;
  const save = async () => {
    state = await deps.commit((s) =>
      commitContextCalibration(s, profile.id, record, prior?.id),
    );
    options.onProgress?.(structuredClone(record));
  };
  await save();
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const timer = setTimeout(
    () => controller.abort(new Error("Context verification deadline")),
    CONTEXT_CALIBRATION.wallMs,
  );
  let requests = 0;
  const attempt = async (context: number) => {
    if (signal.aborted)
      return options.signal.aborted
        ? ("cancelled" as const)
        : ("timeout" as const);
    const started = now(),
      local = new AbortController();
    const timer = setTimeout(
      () => local.abort(new Error("Context verification request deadline")),
      CONTEXT_CALIBRATION.requestMs,
    );
    const requestSignal = AbortSignal.any([signal, local.signal]);
    let outcome: ContextOutcome = "transient",
      finish: string | null = null,
      loaded: number | null = null;
    let allocation: string | null = null;
    const before = state.profiles.find((p) => p.id === profile.id) ?? profile;
    const thermal =
      contextMetadata(before, endpoint, "loaded", now()) === true
        ? "warm"
        : contextMetadata(before, endpoint, "loaded", now()) === false
          ? "cold"
          : "unknown";
    try {
      requests++;
      const result = await waitForRecovery(
        deps.request(context, state, requestSignal),
        requestSignal,
      );
      requestSignal.throwIfAborted();
      finish = result.finish;
      if (!["stop", "length"].includes(finish))
        throw new Error(
          "Context verification did not receive a successful engine finish",
        );
      // Stream completion is not the end of the request's deadline: metadata
      // refresh can stall independently of native/SDK response settlement.
      const fresh = await waitForRecovery(deps.refresh(), requestSignal);
      requestSignal.throwIfAborted();
      state = fresh.state;
      const current = state.profiles.find((p) => p.id === profile.id);
      if (
        !current ||
        current.modelRevision !== record.scope.digest ||
        fresh.snapshot.configurationRevision !==
          record.scope.configurationRevision ||
        contextReasoningIdentity(current, endpoint, now()) !==
          record.scope.reasoning
      )
        outcome = "revision-changed";
      else if (!fresh.snapshot.connected || fresh.snapshot.stale)
        outcome = "offline";
      else {
        const value = contextMetadata(
          current,
          endpoint,
          "loadedContext",
          now(),
        );
        loaded = typeof value === "number" ? value : null;
        const runtimeAllocation = contextMetadata(
          current,
          endpoint,
          "runtimeAllocation",
          now(),
        );
        allocation =
          typeof runtimeAllocation === "string" ? runtimeAllocation : null;
        await waitForRecovery(deps.inspectRuntime(), requestSignal);
        requestSignal.throwIfAborted();
        if (
          contextRuntime(endpoint.id)?.version !==
            record.scope.providerVersion ||
          contextRuntime(endpoint.id)?.epoch !== record.scope.runtimeEpoch
        )
          outcome = "revision-changed";
        else
          outcome =
            loaded === context && allocation !== null
              ? "success"
              : loaded !== null && loaded < context
                ? "allocation-mismatch"
                : "transient";
      }
    } catch (error) {
      outcome = options.signal.aborted
        ? "cancelled"
        : requestSignal.aborted
          ? "timeout"
          : classifyContextFailure(error);
    } finally {
      clearTimeout(timer);
    }
    record.attempts.push({
      context,
      requested: context,
      loaded,
      outcome,
      at: now(),
      latencyMs: Math.min(600_000, Math.max(0, now() - started)),
      thermal,
      finish,
      think: "omitted",
    });
    record.attempts.splice(
      0,
      Math.max(0, record.attempts.length - CONTEXT_CALIBRATION.requests),
    );
    if (outcome === "success") {
      record.highest = Math.max(record.highest ?? 0, context);
      record.allocation = allocation;
      record.updatedAt = now();
      record.expiresAt = now() + CONTEXT_CALIBRATION.evidenceMs;
    }
    return outcome;
  };
  try {
    for (const candidate of candidates) {
      if (
        requests >= CONTEXT_CALIBRATION.requests - 1 ||
        now() - record.startedAt >= CONTEXT_CALIBRATION.wallMs
      ) {
        record.failure = "timeout";
        break;
      }
      const outcome = await attempt(candidate);
      if (outcome !== "success") {
        record.failure = outcome;
        if (["capacity", "allocation-mismatch"].includes(outcome))
          record.failedNext = candidate;
        if (
          ["capacity", "allocation-mismatch"].includes(outcome) &&
          record.highest !== null &&
          candidate <= record.highest
        ) {
          record.highest = null;
          record.allocation = null;
          record.expiresAt = 0;
        }
        break;
      }
      record.failure = null;
      await save();
    }
    if (
      record.failure &&
      record.failure !== "revision-changed" &&
      record.failure !== "cancelled"
    ) {
      const health = await waitForRecovery(deps.refresh(), signal);
      state = health.state;
      if (!health.snapshot.connected) record.failure = "offline";
      else if (
        record.highest &&
        ["capacity", "allocation-mismatch"].includes(record.failure) &&
        requests < CONTEXT_CALIBRATION.requests &&
        !signal.aborted
      ) {
        const latest = state.profiles.find((p) => p.id === profile.id);
        if (
          !latest ||
          contextMetadata(latest, endpoint, "loadedContext", now()) !==
            record.highest
        ) {
          const restored = await attempt(record.highest);
          if (restored !== "success") record.failure = restored;
        }
      }
    }
    options.signal.throwIfAborted();
    record.status =
      record.failure === null
        ? "verified"
        : ["capacity", "allocation-mismatch"].includes(record.failure)
          ? "capacity"
          : "incomplete";
  } catch (error) {
    record.failure = options.signal.aborted
      ? "cancelled"
      : classifyContextFailure(error);
    record.status = options.signal.aborted ? "cancelled" : "incomplete";
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  if (record.failure === "revision-changed") {
    record.highest = null;
    record.allocation = null;
    record.expiresAt = 0;
  }
  record.retryAfter = record.failure
    ? now() + CONTEXT_CALIBRATION.backoffMs
    : record.expiresAt;
  await save();
  return record;
}
