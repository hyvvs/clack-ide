import { z } from "zod";
import { evidence, unknown, type EvidenceValue } from "./hardwareProfile";
import {
  deploymentQualificationScope,
  reconcileLocalComputeFabric,
  withLocalComputeFabric,
  type DeploymentRuntimeObservation,
  type LocalComputeFabric,
} from "./localComputeFabric";
import type { SelfHostedState } from "./selfHostedProfiles";

/**
 * LM6 is a bounded *observation ledger*, not a qualification receipt.
 * In particular it cannot satisfy LM2F tool, instruction, or Agent gates.
 * Every numeric field has independent provenance; absent server usage is
 * Unknown and an LM3 static estimate is never copied into this ledger.
 */
export const LM6_PROCEDURE = { id: "clack-lm6-bounded-deployment", version: 1 } as const;
export const LM6_MAX_ATTEMPTS = 3;
/** A native request is single-effect eligible only with exactly one native
 * open observation and one distinct Rust `inference-N` identifier. Clack
 * Chat activity UUIDs are a separate namespace and are checked via LM2F
 * activity receipts, not compared to this native identifier. */
export function lm6SingleNativeRequest(input: {
  nativeRequestIds: readonly string[];
  nativeRequestOpenEvents?: number | null;
}): string | null {
  const ids = input.nativeRequestIds;
  return input.nativeRequestOpenEvents === 1 && ids.length === 1 &&
    /^inference-[1-9]\d{0,19}$/.test(ids[0]) ? ids[0] : null;
}
const positive = z.number().int().positive().safe();
const moment = z.number().int().nonnegative().safe();
const nonnegative = z.number().finite().nonnegative().max(1e12);
const identifier = z.string().min(1).max(256);
const bounded = z.string().min(1).max(128);
const provenance = z.enum(["Measured", "Derived", "Estimated", "Unknown"]);
const observation = z.object({
  value: nonnegative.nullable(),
  unit: bounded,
  provenance,
  source: bounded,
  observedAt: moment.nullable(),
  assumptions: z.array(bounded).max(8),
}).strict().superRefine((row, ctx) => {
  if ((row.provenance === "Unknown") !== (row.value === null))
    ctx.addIssue({ code: "custom", message: "Unknown must have no value; observations require values" });
  if (row.provenance === "Measured" && row.observedAt === null)
    ctx.addIssue({ code: "custom", message: "Measured observations need a timestamp" });
});
export const lm6FailureSchema = z.enum([
  "none", "connectivity", "runtime-unavailable", "first-output-timeout",
  "stream-idle-timeout", "terminal-timeout", "cancelled", "malformed-structured-output",
  "instruction-adherence-failed", "native-tool-failed", "provider-error", "runtime-crash",
  "identity-changed", "incomplete-evidence", "unknown",
]);
const timingsSchema = z.object({
  requestAdmissionMs: observation,
  connectionSetupMs: observation,
  firstFrameMs: observation,
  // Transport chunks are not equivalent to decoded provider protocol frames.
  // Optional only for compatibility with the two earlier LM6 run receipts.
  firstNativeChunkMs: observation.optional(),
  firstMeaningfulOutputMs: observation,
  firstVisibleOutputMs: observation,
  terminalMs: observation,
  modelLoadMs: observation,
  promptEvaluationMs: observation,
  generationMs: observation,
}).strict();
const usageSchema = z.object({
  promptTokens: observation,
  generatedTokens: observation,
  promptTokensPerSecond: observation,
  generationTokensPerSecond: observation,
}).strict();
const resourceSchema = z.object({
  ramBeforeBytes: observation,
  ramDuringBytes: observation,
  ramAfterBytes: observation,
  vramBeforeBytes: observation,
  vramDuringBytes: observation,
  vramAfterBytes: observation,
}).strict();
export const lm6AttemptSchema = z.object({
  attemptId: identifier,
  workload: z.enum(["chat", "instruction-adherence", "structured-output", "native-tools", "cancellation"]),
  thermal: z.enum(["cold", "warm", "unknown"]),
  thermalSource: bounded,
  startedAt: moment,
  endedAt: moment,
  result: z.enum(["passed", "failed", "cancelled", "unavailable"]),
  failure: lm6FailureSchema,
  // Behavioral verdict is separate from successful terminal transport:
  // instruction adherence can FAIL on a completed Chat.
  capabilityCheck: z.enum(["passed", "failed", "incomplete", "unsupported", "not-run"]),
  requestId: identifier.nullable(),
  // Native Rust registry identifiers and Clack Chat activity request UUIDs
  // are intentionally DIFFERENT namespaces. Neither can impersonate the other.
  nativeRequestId: z.string().regex(/^inference-[1-9]\d{0,19}$/).nullable().optional(),
  nativeRequestOpenEvents: z.number().int().nonnegative().max(64).nullable().optional(),
  distinctNativeRequestCount: z.number().int().nonnegative().max(64).nullable().optional(),
  outputObserved: z.boolean(),
  terminalObserved: z.boolean(),
  // Evidence of cancellation acknowledgement, not just a local abort.
  cancelRequestedAt: moment.nullable(),
  cancelAcknowledgedAt: moment.nullable(),
  noContinuationObserved: z.boolean().nullable(),
  duplicateRequestObserved: z.boolean().nullable(),
  timings: timingsSchema,
  usage: usageSchema,
  resources: resourceSchema,
}).strict().superRefine((row, ctx) => {
  if (row.endedAt < row.startedAt || row.endedAt - row.startedAt > 10 * 60_000)
    ctx.addIssue({ code: "custom", message: "Invalid bounded attempt time window" });
  if (row.result === "passed" &&
      (!row.terminalObserved || row.failure !== "none" ||
       !row.requestId || !/^[0-9a-f-]{36}$/i.test(row.requestId) ||
       !row.nativeRequestId || row.nativeRequestOpenEvents !== 1 ||
       row.distinctNativeRequestCount !== 1 || row.duplicateRequestObserved !== false ||
       row.timings.terminalMs.value === null))
    ctx.addIssue({ code: "custom", message: "Passing attempt requires exact single native/Chat request and terminal proof" });
  if (row.cancelAcknowledgedAt !== null &&
      (row.cancelRequestedAt === null || row.cancelAcknowledgedAt < row.cancelRequestedAt))
    ctx.addIssue({ code: "custom", message: "Unverified cancellation ordering" });
  if (row.cancelRequestedAt !== null && row.cancelRequestedAt < row.startedAt)
    ctx.addIssue({ code: "custom", message: "Cancellation predates request" });
});
const runtimeScope = z.object({
  deploymentIdentity: z.string().min(1).max(40 * 1024),
  hostId: identifier,
  runtimeId: identifier,
  runtimeType: bounded,
  runtimeProcessIdentity: z.string().max(1024).nullable(),
  runtimeConfigurationRevision: positive,
  runtimeVersion: bounded,
  runtimeEpoch: z.string().min(1).max(2048),
  artifactId: z.string().min(1).max(40 * 1024),
  artifactDigest: z.string().min(1).max(1024),
  artifactFormat: z.enum(["ollama-manifest", "gguf", "safetensors", "mlx-package", "opaque"]),
  deploymentId: z.string().min(1).max(40 * 1024),
}).strict();
export const lm6RunSchema = z.object({
  version: z.literal(1),
  runId: z.string().uuid(),
  procedure: z.object({ id: z.literal(LM6_PROCEDURE.id), version: z.literal(LM6_PROCEDURE.version) }).strict(),
  scope: runtimeScope,
  configuredContextTokens: positive.nullable(),
  backend: z.enum(["CPU", "GPU", "Hybrid", "Unknown"]),
  startedAt: moment,
  endedAt: moment,
  requestedAttempts: z.number().int().min(1).max(LM6_MAX_ATTEMPTS),
  attempts: z.array(lm6AttemptSchema).max(LM6_MAX_ATTEMPTS),
  // Counts include failures and cancellations. No denominator laundering.
  reliability: z.object({
    requested: z.number().int().min(1).max(LM6_MAX_ATTEMPTS),
    attempted: z.number().int().min(0).max(LM6_MAX_ATTEMPTS),
    completed: z.number().int().min(0).max(LM6_MAX_ATTEMPTS),
    failed: z.number().int().min(0).max(LM6_MAX_ATTEMPTS),
    cancelled: z.number().int().min(0).max(LM6_MAX_ATTEMPTS),
    unavailable: z.number().int().min(0).max(LM6_MAX_ATTEMPTS),
    completionFraction: z.number().min(0).max(1),
  }).strict(),
}).strict().superRefine((run, ctx) => {
  const a = run.attempts;
  const groups = {
    completed: a.filter(row => row.result === "passed").length,
    failed: a.filter(row => row.result === "failed").length,
    cancelled: a.filter(row => row.result === "cancelled").length,
    unavailable: a.filter(row => row.result === "unavailable").length,
  };
  if (run.endedAt < run.startedAt || run.endedAt - run.startedAt > 20 * 60_000 ||
      a.length !== run.requestedAttempts || new Set(a.map(row => row.attemptId)).size !== a.length ||
      a.some(row => row.startedAt < run.startedAt || row.endedAt > run.endedAt) ||
      run.reliability.requested !== run.requestedAttempts ||
      run.reliability.attempted !== a.length ||
      Object.entries(groups).some(([key, value]) =>
        run.reliability[key as keyof typeof groups] !== value) ||
      Math.abs(run.reliability.completionFraction - groups.completed / run.requestedAttempts) > 1e-9)
    ctx.addIssue({ code: "custom", message: "LM6 attempt accounting is not exact" });
});
export type Lm6Run = z.infer<typeof lm6RunSchema>;
export type Lm6Attempt = z.infer<typeof lm6AttemptSchema>;
export type Lm6Failure = z.infer<typeof lm6FailureSchema>;
export type Lm6Timings = Lm6Attempt["timings"];
export type Lm6Usage = Lm6Attempt["usage"];
export type Lm6Resources = Lm6Attempt["resources"];

const gap = (unit: string, reason = "No authoritative provider/runtime boundary") =>
  unknown<number>(unit, reason);
function measured(value: number | undefined | null, unit: string, source: string, at: number): EvidenceValue<number> {
  return value !== undefined && value !== null && Number.isFinite(value) &&
    value >= 0 && value <= 1e12
    ? evidence(value, unit, "Measured", source, at)
    : gap(unit);
}
function derived(value: number | null, unit: string, source: string, at: number): EvidenceValue<number> {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 1e12
    ? evidence(value, unit, "Derived", source, at)
    : gap(unit);
}
function interval(start: number | null | undefined, end: number | null | undefined,
  at: number, source: string): EvidenceValue<number> {
  return start !== null && start !== undefined && end !== null && end !== undefined &&
    Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start
    ? measured(end - start, "ms", source, at) : gap("ms");
}
const blankTimings = (): Lm6Timings => ({
  requestAdmissionMs: gap("ms"), connectionSetupMs: gap("ms"), firstFrameMs: gap("ms"),
  firstNativeChunkMs: gap("ms"),
  firstMeaningfulOutputMs: gap("ms"), firstVisibleOutputMs: gap("ms"),
  terminalMs: gap("ms"), modelLoadMs: gap("ms"),
  promptEvaluationMs: gap("ms"), generationMs: gap("ms"),
});
const blankUsage = (): Lm6Usage => ({
  promptTokens: gap("tokens"), generatedTokens: gap("tokens"),
  promptTokensPerSecond: gap("tokens/s"), generationTokensPerSecond: gap("tokens/s"),
});
const blankResources = (): Lm6Resources => ({
  ramBeforeBytes: gap("bytes"), ramDuringBytes: gap("bytes"),
  ramAfterBytes: gap("bytes"), vramBeforeBytes: gap("bytes"),
  vramDuringBytes: gap("bytes"), vramAfterBytes: gap("bytes"),
});

export type Lm6Signals = {
  requestStart?: number | null;
  providerAdmitted?: number | null;
  connectionStart?: number | null;
  providerConnected?: number | null;
  firstFrame?: number | null;
  firstMeaningful?: number | null;
  firstVisible?: number | null;
  terminal?: number | null;
  promptTokens?: number | null;
  generatedTokens?: number | null;
  providerPromptDurationNs?: number | null;
  providerGenerationDurationNs?: number | null;
  providerLoadDurationNs?: number | null;
  ramBeforeBytes?: number | null;
  ramBeforeAt?: number | null;
  ramDuringBytes?: number | null;
  ramDuringAt?: number | null;
  ramAfterBytes?: number | null;
  ramAfterAt?: number | null;
  vramBeforeBytes?: number | null;
  vramBeforeAt?: number | null;
  vramDuringBytes?: number | null;
  vramDuringAt?: number | null;
  vramAfterBytes?: number | null;
  vramAfterAt?: number | null;
  cancelRequestedAt?: number | null;
  cancelAcknowledgedAt?: number | null;
  noContinuationObserved?: boolean | null;
  duplicateRequestObserved?: boolean | null;
};

/**
 * Timestamp differences use only boundaries observed by the actual Clack
 * request path. SDK usage counts are Measured; throughput ratios are Derived.
 * A native Ollama nanosecond duration is NOT confused with end-to-end latency.
 */
export function lm6AttemptFromSignals(input: {
  attemptId: string;
  requestId?: string | null;
  nativeRequestId?: string | null;
  nativeRequestOpenEvents?: number | null;
  distinctNativeRequestCount?: number | null;
  workload: Lm6Attempt["workload"];
  thermal: Lm6Attempt["thermal"];
  thermalSource: string;
  startedAt: number;
  endedAt: number;
  result: Lm6Attempt["result"];
  failure: Lm6Failure;
  capabilityCheck?: Lm6Attempt["capabilityCheck"];
  outputObserved: boolean;
  terminalObserved: boolean;
  signals?: Lm6Signals;
}): Lm6Attempt {
  const s = input.signals ?? {};
  const at = input.endedAt;
  const d = (ns: number | undefined | null) =>
    ns === null || ns === undefined || !Number.isSafeInteger(ns) || ns < 0
      ? null : ns / 1_000_000;
  const providerPrompt = d(s.providerPromptDurationNs);
  const providerGeneration = d(s.providerGenerationDurationNs);
  const providerLoad = d(s.providerLoadDurationNs);
  const promptTokens = s.promptTokens !== null && s.promptTokens !== undefined &&
    Number.isSafeInteger(s.promptTokens) && s.promptTokens >= 0
    ? s.promptTokens : null;
  const generatedTokens = s.generatedTokens !== null && s.generatedTokens !== undefined &&
    Number.isSafeInteger(s.generatedTokens) && s.generatedTokens >= 0
    ? s.generatedTokens : null;
  const speed = (count: number | null, ms: number | null) =>
    count !== null && ms !== null && ms > 0 ? count * 1000 / ms : null;
  const point = (value: number | null | undefined, at: number | null | undefined,
    source: string) => at != null && Number.isSafeInteger(at) && at >= input.startedAt &&
    at <= input.endedAt ? measured(value, "bytes", source, at) : gap("bytes");
  return lm6AttemptSchema.parse({
    attemptId: input.attemptId,
    workload: input.workload, thermal: input.thermal,
    thermalSource: input.thermalSource,
    startedAt: input.startedAt, endedAt: input.endedAt,
    result: input.result, failure: input.failure,
    capabilityCheck: input.capabilityCheck ?? "not-run",
    requestId: input.requestId ?? null,
    nativeRequestId: input.nativeRequestId ?? null,
    nativeRequestOpenEvents: input.nativeRequestOpenEvents ?? null,
    distinctNativeRequestCount: input.distinctNativeRequestCount ?? null,
    outputObserved: input.outputObserved,
    terminalObserved: input.terminalObserved,
    cancelRequestedAt: s.cancelRequestedAt ?? null,
    cancelAcknowledgedAt: s.cancelAcknowledgedAt ?? null,
    noContinuationObserved: s.noContinuationObserved ?? null,
    duplicateRequestObserved: s.duplicateRequestObserved ?? null,
    timings: {
      ...blankTimings(),
      requestAdmissionMs: interval(input.startedAt, s.providerAdmitted, at, "native-inference-admission"),
      connectionSetupMs: interval(s.connectionStart, s.providerConnected, at, "native-connection"),
      firstFrameMs: gap("ms", "First provider protocol frame is not independently observable"),
      firstNativeChunkMs: interval(s.requestStart, s.firstFrame, at, "webview-received-first-native-response-chunk"),
      firstMeaningfulOutputMs: interval(s.requestStart, s.firstMeaningful, at, "clack-stream-first-nonempty-text"),
      firstVisibleOutputMs: interval(s.requestStart, s.firstVisible, at, "clack-ui-visible-output"),
      terminalMs: interval(s.requestStart, s.terminal, at, "native-terminal-completion"),
      modelLoadMs: providerLoad === null ? gap("ms") : measured(providerLoad, "ms", "ollama-terminal-load-duration", at),
      promptEvaluationMs: providerPrompt === null ? gap("ms") : measured(providerPrompt, "ms", "ollama-terminal-prompt-duration", at),
      generationMs: providerGeneration === null ? gap("ms") : measured(providerGeneration, "ms", "ollama-terminal-eval-duration", at),
    },
    usage: {
      ...blankUsage(),
      promptTokens: measured(promptTokens, "tokens", "provider-structured-usage", at),
      generatedTokens: measured(generatedTokens, "tokens", "provider-structured-usage", at),
      promptTokensPerSecond: derived(speed(promptTokens, providerPrompt), "tokens/s", "measured-provider-count-divided-by-evaluation-time", at),
      generationTokensPerSecond: derived(speed(generatedTokens, providerGeneration), "tokens/s", "measured-provider-count-divided-by-evaluation-time", at),
    },
    resources: {
      ...blankResources(),
      // Host free RAM / GPU free VRAM are point observations, NOT usage peaks.
      ramBeforeBytes: point(s.ramBeforeBytes, s.ramBeforeAt, "native-host-ram-point-before"),
      ramDuringBytes: point(s.ramDuringBytes, s.ramDuringAt, "native-host-ram-point-during"),
      ramAfterBytes: point(s.ramAfterBytes, s.ramAfterAt, "native-host-ram-point-after"),
      vramBeforeBytes: point(s.vramBeforeBytes, s.vramBeforeAt, "native-gpu-free-point-before"),
      vramDuringBytes: point(s.vramDuringBytes, s.vramDuringAt, "native-gpu-free-point-during"),
      vramAfterBytes: point(s.vramAfterBytes, s.vramAfterAt, "native-gpu-free-point-after"),
    },
  });
}

export function completeLm6Run(input: Omit<Lm6Run, "version" | "procedure" | "reliability">): Lm6Run {
  const attempted = input.attempts.length;
  const count = (result: Lm6Attempt["result"]) => input.attempts.filter(a => a.result === result).length;
  return lm6RunSchema.parse({
    ...input,
    version: 1, procedure: LM6_PROCEDURE,
    reliability: {
      requested: input.requestedAttempts, attempted,
      completed: count("passed"), failed: count("failed"),
      cancelled: count("cancelled"), unavailable: count("unavailable"),
      completionFraction: count("passed") / input.requestedAttempts,
    },
  });
}

export function lm6ExactScope(
  fabric: LocalComputeFabric, deploymentId: string,
  observation: DeploymentRuntimeObservation | undefined,
  now: number,
): Lm6Run["scope"] | null {
  const scope = deploymentQualificationScope(fabric, deploymentId, observation, now);
  return scope ? runtimeScope.parse({ ...scope, deploymentId }) : null;
}

/** Old runs are retained, never current after epoch/host/runtime/artifact/
 * configuration/context/backend/procedure changes. */
export function isCurrentLm6Run(
  run: Lm6Run, fabric: LocalComputeFabric,
  deploymentId: string, observation: DeploymentRuntimeObservation | undefined,
  configuredContextTokens: number | null,
  backend: Lm6Run["backend"],
  now = Date.now(),
): boolean {
  const scope = lm6ExactScope(fabric, deploymentId, observation, now);
  return !!scope && run.procedure.id === LM6_PROCEDURE.id &&
    run.procedure.version === LM6_PROCEDURE.version &&
    run.endedAt <= now && now - run.endedAt < 30 * 60_000 &&
    run.configuredContextTokens === configuredContextTokens &&
    run.backend === backend &&
    JSON.stringify(run.scope) === JSON.stringify(scope);
}

export function lm6History(fabric: LocalComputeFabric, deploymentId: string) {
  return (fabric.measurementRuns ?? []).flatMap(raw => {
    const parsed = lm6RunSchema.safeParse(raw);
    return parsed.success && parsed.data.scope.deploymentId === deploymentId ? [parsed.data] : [];
  }).sort((a, b) => b.endedAt - a.endedAt);
}

export function deploymentMeasurementPanel(
  state: SelfHostedState, deploymentId: string,
  observation: DeploymentRuntimeObservation | undefined,
  contextTokens: number | null,
  backend: Lm6Run["backend"],
  now = Date.now(),
) {
  const projected = reconcileLocalComputeFabric(state);
  const history = lm6History(projected, deploymentId);
  const current = history.find(r =>
    isCurrentLm6Run(r, projected, deploymentId, observation, contextTokens, backend, now)) ?? null;
  const attempts = current?.attempts ?? [];
  const cold = attempts.find(a => a.thermal === "cold" && a.outputObserved) ?? null;
  const warm = attempts.find(a => a.thermal === "warm" && a.outputObserved) ?? null;
  const speed = attempts.find(a => a.usage.generationTokensPerSecond.value !== null);
  return {
    current, history, historicalCount: history.length - (current ? 1 : 0),
    coldFirstOutput: cold?.timings.firstMeaningfulOutputMs ?? gap("ms"),
    warmFirstOutput: warm?.timings.firstMeaningfulOutputMs ?? gap("ms"),
    generation: speed?.usage.generationTokensPerSecond ?? gap("tokens/s"),
    reliability: current?.reliability ?? null,
  };
}

/** Existing CAS owner of selfHostedInference is the only durable writer.
 * This append cannot change LM2F receipts, runtime topology or permissions. */
export function appendLm6Run(
  state: SelfHostedState, value: Lm6Run,
  observation: DeploymentRuntimeObservation | undefined,
  now = Date.now(),
  // This projection must come from a *fresh native/runtime observation* made
  // against the passed current state. Never persist projected online/epoch
  // fields: only the actual measurement ledger joins the saved CAS registry.
  verifiedCurrentFabric?: LocalComputeFabric,
): SelfHostedState {
  const run = lm6RunSchema.parse(value);
  const fabric = reconcileLocalComputeFabric(state);
  const verified = verifiedCurrentFabric ?? fabric;
  if (!isCurrentLm6Run(run, verified, run.scope.deploymentId,
    observation, run.configuredContextTokens, run.backend, now))
    throw new Error("LM6 run no longer matches the current exact deployment");
  const target = fabric.deployments.find(row => row.id === run.scope.deploymentId);
  const checked = verified.deployments.find(row => row.id === run.scope.deploymentId);
  if (!target || !checked || JSON.stringify(target) !== JSON.stringify(checked))
    throw new Error("Saved LM6 deployment changed since runtime observation");
  const existing = fabric.measurementRuns ?? [];
  if (existing.some(row => !!row && typeof row === "object" &&
      "runId" in row && row.runId === run.runId))
    throw new Error("Duplicate LM6 run ID");
  return withLocalComputeFabric({
    ...state,
    fabric: {
      ...fabric,
      measurementRuns: [...existing, run].slice(-48),
    },
  });
}

/** A schema-looking answer alone is not structured protocol evidence. */
export function lm6VerifyStructuredOutput(
  received: unknown, schemaValidate: (value: unknown) => boolean,
  protocolConfirmed: boolean,
): "passed" | "failed" | "unavailable" {
  if (!protocolConfirmed) return "unavailable";
  if (typeof received !== "string" || received.length > 4096) return "failed";
  try { return schemaValidate(JSON.parse(received)) ? "passed" : "failed"; }
  catch { return "failed"; }
}

/** Prose imitation cannot qualify a native tool; only actual SDK tool
 * call + parsed arguments + tool-result correlation are relevant. */
export function lm6VerifyNativeTool(input: {
  protocolSupported: boolean;
  expectedName: string;
  actualCall?: { toolCallId: string; toolName: string; input: unknown } | null;
  actualResult?: { toolCallId: string; success: boolean } | null;
  validArguments: (value: unknown) => boolean;
}): "passed" | "failed" | "unavailable" {
  if (!input.protocolSupported) return "unavailable";
  const call = input.actualCall, result = input.actualResult;
  return call && result && !!call.toolCallId && call.toolName === input.expectedName &&
    result.toolCallId === call.toolCallId && result.success &&
    input.validArguments(call.input) ? "passed" : "failed";
}

/** A closed vocabulary; never persist raw provider errors or private URLs. */
export function lm6Failure(error: unknown): Lm6Failure {
  const code = typeof error === "object" && error !== null
    ? ("errorCode" in error ? (error as { errorCode?: unknown }).errorCode :
      "code" in error ? (error as { code?: unknown }).code : null)
    : null;
  if (code === "first-output-timeout" || code === "stream-idle-timeout" ||
      code === "connect-timeout" || code === "overall-deadline" ||
      code === "cancelled") {
    return code === "connect-timeout" ? "connectivity" :
      code === "overall-deadline" ? "terminal-timeout" : code;
  }
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
  if (code === "dns-failure" || code === "tls-failure" || code === "connection-failed" ||
      code === "remote-disconnect") return "connectivity";
  if (code === "missing-final-event" || code === "malformed-stream") return "incomplete-evidence";
  if (code === "runtime-crash") return "runtime-crash";
  if (code === "runtime-unavailable" || code === "invalid-request") return "runtime-unavailable";
  return "provider-error";
}
