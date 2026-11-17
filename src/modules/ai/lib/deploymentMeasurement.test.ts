import { describe, expect, it } from "vitest";
import { attachManagedLocalGguf, resolveManagedLocalSelection } from "./managedLocalModels";
import { emptySelfHostedState, readSelfHostedState } from "./selfHostedProfiles";
import { observedManagedFabric } from "./deploymentQualificationView";
import { assessDeploymentAgentEligibility } from "./deploymentQualificationPolicy";
import {
  armDeploymentQualification,
  observeDeploymentQualificationNative,
  disarmDeploymentQualification,
} from "./deploymentQualificationFlight";
import { reconcileLocalComputeFabric, type DeploymentRuntimeObservation, type LocalComputeFabric } from "./localComputeFabric";
import {
  LM6_MAX_ATTEMPTS, LM6_PROCEDURE,
  appendLm6Run, completeLm6Run, deploymentMeasurementPanel, isCurrentLm6Run,
  lm6AttemptFromSignals, lm6AttemptSchema, lm6ExactScope, lm6Failure, lm6History,
  lm6RunSchema, lm6VerifyNativeTool, lm6VerifyStructuredOutput,
  lm6SingleNativeRequest,
  type Lm6Attempt, type Lm6Run,
} from "./deploymentMeasurement";

// Offline-only synthetic clocks and identities: no runtime startup, inference,
// provider HTTP, UI/store writes, or changed LM2F qualification receipts.
const NOW = 1_800_000_000_000;
const DIGEST = `sha256:${"a".repeat(64)}`;
const uuid = (id: number) => `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`;

function fixture() {
  const created = attachManagedLocalGguf(emptySelfHostedState(), {
    digest: DIGEST, displayName: "Fixture Qwen",
    material: { version: 1, context: 2048, gpu: 0, tool: false, grammar: false },
  });
  const selected = resolveManagedLocalSelection(created.state, created.selectionId);
  if (selected.status === "missing" || selected.status === "not-managed")
    throw new Error("Fixture registration failed");
  const native = {
    installed: true, state: "Ready" as const, version: "b12248",
    epoch: "epoch-verified", processId: 7001, port: 61234,
    deploymentId: selected.deployment.id, modelDigest: selected.artifact.digest,
  };
  const observed = observedManagedFabric(created.state, created.selectionId, native, NOW);
  if (!observed?.observation || !lm6ExactScope(observed.fabric, observed.deploymentId, observed.observation, NOW))
    throw new Error("Missing synthetic native Ready scope");
  return { ...created, selected, native, observed };
}
type Fixture = ReturnType<typeof fixture>;
type AttemptInput = Parameters<typeof lm6AttemptFromSignals>[0];

function attempt(id = 1, override: Partial<AttemptInput> = {}): Lm6Attempt {
  const startedAt = NOW - 1_800;
  const defaultSignals = {
    requestStart: startedAt + 100, providerAdmitted: startedAt + 20,
    connectionStart: startedAt + 30, providerConnected: startedAt + 90,
    firstFrame: startedAt + 240, firstMeaningful: startedAt + 310,
    firstVisible: startedAt + 350, terminal: startedAt + 780,
    promptTokens: 100, generatedTokens: 40,
    duplicateRequestObserved: false,
    providerPromptDurationNs: 250_000_000,
    providerGenerationDurationNs: 500_000_000,
    providerLoadDurationNs: 80_000_000,
    ramBeforeAt: startedAt + 10, ramDuringAt: startedAt + 300,
    ramAfterAt: startedAt + 700,
    vramBeforeAt: startedAt + 10, vramDuringAt: startedAt + 300,
    vramAfterAt: startedAt + 700,
    ramBeforeBytes: 10_000, ramDuringBytes: 9_200, ramAfterBytes: 9_800,
  };
  return lm6AttemptFromSignals({
    attemptId: `attempt-${id}`, requestId: uuid(id),
    nativeRequestId: `inference-${id}`,
    nativeRequestOpenEvents: 1, distinctNativeRequestCount: 1,
    workload: "chat", thermal: "warm", thermalSource: "native-current-deployment-ready",
    startedAt, endedAt: NOW - 900, result: "passed", failure: "none",
    capabilityCheck: "not-run", outputObserved: true, terminalObserved: true,
    ...override,
    signals: { ...defaultSignals, ...(override.signals ?? {}) },
  });
}
function run(f: Fixture, attempts: Lm6Attempt[] = [attempt()], id = 1): Lm6Run {
  const scope = lm6ExactScope(f.observed.fabric, f.observed.deploymentId, f.observed.observation, NOW);
  if (!scope) throw new Error("Fixture scope changed");
  return completeLm6Run({
    runId: uuid(id), scope, configuredContextTokens: 2048, backend: "CPU",
    startedAt: NOW - 2_000, endedAt: NOW - 100,
    requestedAttempts: attempts.length, attempts,
  });
}
function current(f: Fixture, value: Lm6Run, overrides: {
  fabric?: LocalComputeFabric; observation?: DeploymentRuntimeObservation;
  context?: number | null; backend?: Lm6Run["backend"]; now?: number;
} = {}) {
  return isCurrentLm6Run(value, overrides.fabric ?? f.observed.fabric,
    f.observed.deploymentId, overrides.observation ?? f.observed.observation,
    overrides.context === undefined ? 2048 : overrides.context,
    overrides.backend ?? "CPU", overrides.now ?? NOW);
}
function persist(f: Fixture, value: Lm6Run = run(f)) {
  return appendLm6Run(f.state, value, f.observed.observation, NOW, f.observed.fabric);
}

describe("LM6 bounded deployment measurement — deterministic 30-case matrix", () => {
  it("01 complete terminal signals retain independently sourced timings, counts, rates and resource points", () => {
    const row = attempt();
    expect(lm6AttemptSchema.parse(row)).toEqual(row);
    expect(row.timings).toMatchObject({
      requestAdmissionMs: { value: 20, provenance: "Measured", source: "native-inference-admission" },
      connectionSetupMs: { value: 60, provenance: "Measured", source: "native-connection" },
      firstFrameMs: { value: null, provenance: "Unknown" },
      firstNativeChunkMs: { value: 140, provenance: "Measured" },
      firstMeaningfulOutputMs: { value: 210, provenance: "Measured" },
      firstVisibleOutputMs: { value: 250, provenance: "Measured" },
      terminalMs: { value: 680, provenance: "Measured" },
      modelLoadMs: { value: 80, provenance: "Measured" },
      promptEvaluationMs: { value: 250, provenance: "Measured" },
      generationMs: { value: 500, provenance: "Measured" },
    });
    expect(row.usage).toMatchObject({
      promptTokens: { value: 100, provenance: "Measured" },
      generatedTokens: { value: 40, provenance: "Measured" },
      promptTokensPerSecond: { value: 400, provenance: "Derived" },
      generationTokensPerSecond: { value: 80, provenance: "Derived" },
    });
    expect(row.resources.ramDuringBytes).toMatchObject({ value: 9200, provenance: "Measured" });
  });

  it("02 partial provider timing preserves valid load/count evidence without inventing other fields", () => {
    const row = attempt(1, { signals: {
      providerPromptDurationNs: null, providerGenerationDurationNs: null,
      providerLoadDurationNs: 7_000_000, generatedTokens: null,
    } });
    expect(row.timings.modelLoadMs.value).toBe(7);
    expect(row.timings.promptEvaluationMs.provenance).toBe("Unknown");
    expect(row.timings.generationMs.value).toBeNull();
    expect(row.usage.promptTokens.value).toBe(100);
    expect(row.usage.generationTokensPerSecond.value).toBeNull();
  });

  it("03 absent or invalid provider data stays Unknown, never zero or an estimate", () => {
    const row = attempt(1, {
      result: "failed", failure: "incomplete-evidence", terminalObserved: false,
      signals: {
      promptTokens: -1, generatedTokens: Number.NaN, providerPromptDurationNs: -1,
      providerGenerationDurationNs: Number.POSITIVE_INFINITY,
      providerLoadDurationNs: 1.1, requestStart: null, firstMeaningful: null,
    } });
    for (const field of [row.usage.promptTokens, row.usage.generatedTokens,
      row.usage.promptTokensPerSecond, row.usage.generationTokensPerSecond,
      row.timings.modelLoadMs, row.timings.firstMeaningfulOutputMs]) {
      expect(field).toMatchObject({ value: null, provenance: "Unknown" });
    }
  });

  it("04 cold observation retains its observed thermal source independently of timing", () => {
    const row = attempt(1, { thermal: "cold", thermalSource: "native-status-stopped-then-ready" });
    expect(row.thermal).toBe("cold");
    expect(row.thermalSource).toBe("native-status-stopped-then-ready");
    expect(row.timings.firstMeaningfulOutputMs.value).toBe(210);
  });

  it("05 warm observation remains distinct from the cold attempt in one run", () => {
    const f = fixture(), value = run(f, [
      attempt(1, { thermal: "cold", thermalSource: "native-status-stopped-then-ready" }),
      attempt(2, { thermal: "warm" }),
    ]);
    expect(value.attempts.map(a => a.thermal)).toEqual(["cold", "warm"]);
    expect(value.reliability.completionFraction).toBe(1);
  });

  it("06 acknowledged cancellation preserves request and acknowledgement ordering", () => {
    const row = attempt(1, {
      workload: "cancellation", result: "cancelled", failure: "cancelled",
      terminalObserved: false, signals: {
        cancelRequestedAt: NOW - 1_500, cancelAcknowledgedAt: NOW - 1_400,
        noContinuationObserved: true, duplicateRequestObserved: false, terminal: null,
      },
    });
    expect(row).toMatchObject({
      result: "cancelled", cancelRequestedAt: NOW - 1500,
      cancelAcknowledgedAt: NOW - 1400, noContinuationObserved: true,
      duplicateRequestObserved: false, terminalObserved: false,
    });
  });

  it("07 unacknowledged cancellation cannot claim a confirmed stop or no continuation", () => {
    const row = attempt(1, {
      workload: "cancellation", result: "failed", failure: "incomplete-evidence",
      terminalObserved: false, signals: {
        cancelRequestedAt: NOW - 1500, cancelAcknowledgedAt: null,
        noContinuationObserved: null, duplicateRequestObserved: null,
      },
    });
    expect(row.cancelAcknowledgedAt).toBeNull();
    expect(row.noContinuationObserved).toBeNull();
    expect(row.result).toBe("failed");
  });

  it("08 first-output timeout records failure without fabricated first output", () => {
    const row = attempt(1, {
      result: "failed", failure: "first-output-timeout",
      outputObserved: false, terminalObserved: false,
      signals: { firstFrame: null, firstMeaningful: null, firstVisible: null, terminal: null },
    });
    expect(row.timings.firstFrameMs.value).toBeNull();
    expect(row.timings.firstNativeChunkMs?.value).toBeNull();
    expect(row.failure).toBe("first-output-timeout");
  });

  it("09 stream idle timeout may retain partial output without terminal success", () => {
    const row = attempt(1, {
      result: "failed", failure: "stream-idle-timeout", terminalObserved: false,
      signals: { terminal: null, generatedTokens: null, providerGenerationDurationNs: null },
    });
    expect(row.outputObserved).toBe(true);
    expect(row.timings.firstMeaningfulOutputMs.value).toBe(210);
    expect(row.timings.terminalMs.value).toBeNull();
    expect(row.usage.generationTokensPerSecond.value).toBeNull();
  });

  it("10 terminal deadline does not convert an incomplete request into a completion", () => {
    const row = attempt(1, {
      result: "failed", failure: "terminal-timeout", terminalObserved: false,
      signals: { terminal: null },
    });
    expect(run(fixture(), [row]).reliability).toMatchObject({
      completed: 0, failed: 1, completionFraction: 0,
    });
  });

  it("11 runtime crash has its own failure reason and remains part of the denominator", () => {
    const value = run(fixture(), [
      attempt(1), attempt(2, {
        result: "failed", failure: "runtime-crash", terminalObserved: false,
        signals: { terminal: null },
      }),
    ]);
    expect(value.attempts[1].failure).toBe("runtime-crash");
    expect(value.reliability).toMatchObject({ requested: 2, attempted: 2, completed: 1, failed: 1, completionFraction: 0.5 });
  });

  it("12 terminal Chat does not imply instruction-adherence passed", () => {
    const value = run(fixture(), [attempt(1, {
      workload: "instruction-adherence", capabilityCheck: "failed",
    })]);
    expect(value.attempts[0]).toMatchObject({
      result: "passed", terminalObserved: true, capabilityCheck: "failed",
    });
    expect(value.reliability.completed).toBe(1); // Transport completion is counted separately.
  });

  it("13 structured output passes only confirmed protocol plus validated JSON", () => {
    const result = lm6VerifyStructuredOutput('{"value":7}', value =>
      typeof value === "object" && value !== null && "value" in value &&
      (value as { value: unknown }).value === 7, true);
    expect(result).toBe("passed");
  });

  it("14 prose-shaped JSON with no confirmed structured protocol is unavailable", () => {
    expect(lm6VerifyStructuredOutput('{"value":7}', () => true, false)).toBe("unavailable");
  });

  it("15 malformed, schema-invalid and oversized structured content cannot pass", () => {
    const accepts = (v: unknown) => !!v && typeof v === "object" &&
      (v as { ok?: unknown }).ok === true;
    expect(lm6VerifyStructuredOutput("{broken", accepts, true)).toBe("failed");
    expect(lm6VerifyStructuredOutput('{"ok":false}', accepts, true)).toBe("failed");
    expect(lm6VerifyStructuredOutput("x".repeat(4097), accepts, true)).toBe("failed");
  });

  it("16 genuine native tool call with valid arguments and correlated result passes", () => {
    expect(lm6VerifyNativeTool({
      protocolSupported: true, expectedName: "get_probe_value",
      actualCall: { toolCallId: "call-1", toolName: "get_probe_value", input: { key: "known" } },
      actualResult: { toolCallId: "call-1", success: true },
      validArguments: v => !!v && typeof v === "object" && (v as { key?: unknown }).key === "known",
    })).toBe("passed");
  });

  it("17 mismatched result ID, wrong name and invalid arguments all fail native tool verification", () => {
    const sample = {
      protocolSupported: true, expectedName: "get_probe_value",
      actualCall: { toolCallId: "call-1", toolName: "get_probe_value", input: { key: "known" } },
      actualResult: { toolCallId: "call-1", success: true },
      validArguments: () => true,
    };
    expect(lm6VerifyNativeTool({ ...sample, actualResult: { toolCallId: "call-2", success: true } })).toBe("failed");
    expect(lm6VerifyNativeTool({ ...sample, actualCall: { ...sample.actualCall, toolName: "other" } })).toBe("failed");
    expect(lm6VerifyNativeTool({ ...sample, validArguments: () => false })).toBe("failed");
  });

  it("18 unsupported tool protocol cannot be upgraded by textual or synthetic calls", () => {
    expect(lm6VerifyNativeTool({
      protocolSupported: false, expectedName: "probe",
      actualCall: { toolCallId: "1", toolName: "probe", input: {} },
      actualResult: { toolCallId: "1", success: true },
      validArguments: () => true,
    })).toBe("unavailable");
  });

  it("19 changed ComputeHost identity invalidates the exact-scope current run", () => {
    const f = fixture(), value = run(f);
    const fabric = structuredClone(f.observed.fabric);
    fabric.hosts[0].id = "replacement-host";
    fabric.runtimes[0].hostId = "replacement-host";
    fabric.deployments[0].hostId = "replacement-host";
    expect(lm6ExactScope(fabric, f.observed.deploymentId, f.observed.observation, NOW)).not.toBeNull();
    expect(current(f, value, { fabric })).toBe(false);
  });

  it("20 changed LocalRuntime implementation invalidates history even with the same model label", () => {
    const f = fixture(), value = run(f), fabric = structuredClone(f.observed.fabric);
    fabric.runtimes[0].type = "ollama";
    expect(lm6ExactScope(fabric, f.observed.deploymentId, f.observed.observation, NOW)).not.toBeNull();
    expect(current(f, value, { fabric })).toBe(false);
  });

  it("21 changed configured context cannot inherit measured performance", () => {
    const f = fixture(), value = run(f);
    expect(current(f, value)).toBe(true);
    expect(current(f, value, { context: 8192 })).toBe(false);
  });

  it("22 switching CPU to GPU or Hybrid changes the measurement cohort", () => {
    const f = fixture(), value = run(f);
    expect(current(f, value, { backend: "GPU" })).toBe(false);
    expect(current(f, value, { backend: "Hybrid" })).toBe(false);
    expect(current(f, value, { backend: "Unknown" })).toBe(false);
  });

  it("23 a restarted native runtime epoch cannot reuse the old completion metrics", () => {
    const f = fixture(), value = run(f);
    const refreshed = observedManagedFabric(f.state, f.selectionId,
      { ...f.native, epoch: "new-epoch", processId: 7002 }, NOW)!;
    expect(refreshed.observation).toBeDefined();
    expect(current(f, value, {
      fabric: refreshed.fabric, observation: refreshed.observation,
    })).toBe(false);
  });

  it("24 unknown/changed measurement procedure version is historical and fails strict schema", () => {
    const f = fixture(), value = run(f);
    const incompatible = { ...value, procedure: { ...LM6_PROCEDURE, version: 2 } };
    expect(lm6RunSchema.safeParse(incompatible).success).toBe(false);
    expect(current(f, incompatible as unknown as Lm6Run)).toBe(false);
  });

  it("25 runtime version and current revision mismatch cannot transfer evidence", () => {
    const f = fixture(), value = run(f), fabric = structuredClone(f.observed.fabric);
    const live = { ...f.observed.observation!, version: "b12249" };
    fabric.runtimes[0].version = "b12249";
    expect(current(f, value, { fabric, observation: live })).toBe(false);
    const changed = structuredClone(f.observed.fabric);
    changed.runtimes[0].configurationRevision++;
    changed.deployments[0].configurationRevision++;
    expect(current(f, value, { fabric: changed, observation: {
      ...f.observed.observation!, configurationRevision: 2,
    } })).toBe(false);
  });

  it("26 native process replacement and artifact digest change each invalidate scope", () => {
    const f = fixture(), value = run(f);
    const process = observedManagedFabric(f.state, f.selectionId,
      { ...f.native, processId: 7102 }, NOW)!;
    expect(current(f, value, { fabric: process.fabric, observation: process.observation })).toBe(false);
    const digest = structuredClone(f.observed.fabric);
    digest.artifacts[0].digest = `sha256:${"b".repeat(64)}`;
    expect(current(f, value, { fabric: digest })).toBe(false);
  });

  it("27 run staleness expires independently of a refreshed runtime observation", () => {
    const f = fixture(), value = run(f), later = NOW + 30 * 60_000;
    expect(current(f, value, { now: later, observation: {
      ...f.observed.observation!, observedAt: later,
    } })).toBe(false);
    expect(current(f, value, { observation: {
      ...f.observed.observation!, observedAt: NOW - 30_000,
    } })).toBe(false);
  });

  it("28 historical measurements survive a new run and sort newest first", () => {
    const f = fixture();
    const first = { ...run(f, [attempt()], 1), endedAt: NOW - 300 };
    const next = run(f, [attempt(2)], 2);
    const once = persist(f, first);
    const twice = appendLm6Run(once, next, f.observed.observation, NOW, f.observed.fabric);
    const history = lm6History(reconcileLocalComputeFabric(twice), f.observed.deploymentId);
    expect(history).toHaveLength(2);
    expect(history.map(r => r.runId)).toEqual([next.runId, first.runId]);
    expect(twice.fabric?.measurementRuns).toHaveLength(2);
    expect(deploymentMeasurementPanel(twice, f.observed.deploymentId,
      f.observed.observation, 2048, "CPU", NOW).history).toHaveLength(2);
  });

  it("29 observed RAM/VRAM are host free-memory points; unknown samples stay Unknown", () => {
    const row = attempt(1, { signals: {
      ramBeforeBytes: 30_000, ramDuringBytes: null, ramAfterBytes: 29_000,
      vramBeforeBytes: null, vramDuringBytes: 5000, vramAfterBytes: null,
    } });
    expect(row.resources.ramBeforeBytes).toMatchObject({ value: 30_000, provenance: "Measured", source: "native-host-ram-point-before" });
    expect(row.resources.ramDuringBytes.provenance).toBe("Unknown");
    expect(row.resources.ramAfterBytes.value).toBe(29_000);
    expect(row.resources.vramDuringBytes).toMatchObject({ value: 5000, provenance: "Measured", source: "native-gpu-free-point-during" });
    expect(row.resources.vramAfterBytes.provenance).toBe("Unknown");
    expect(Object.keys(row.resources)).not.toContain("peakVramBytes");
  });

  it("30 exact reliability denominator includes success, failure and cancellation once", () => {
    const f = fixture();
    const value = run(f, [
      attempt(1),
      attempt(2, { result: "failed", failure: "provider-error", terminalObserved: false }),
      attempt(3, { workload: "cancellation", result: "cancelled", failure: "cancelled", terminalObserved: false }),
    ]);
    expect(value.reliability).toEqual({
      requested: 3, attempted: 3, completed: 1, failed: 1,
      cancelled: 1, unavailable: 0, completionFraction: 1 / 3,
    });
  });

  it("31 missing/unavailable attempt counts in the denominator rather than dropping evidence", () => {
    const value = run(fixture(), [
      attempt(1),
      attempt(2, { result: "unavailable", failure: "identity-changed", outputObserved: false, terminalObserved: false }),
      attempt(3, { result: "failed", failure: "incomplete-evidence", terminalObserved: false }),
    ]);
    expect(value.reliability).toMatchObject({
      requested: 3, attempted: 3, completed: 1, failed: 1, unavailable: 1,
      completionFraction: 1 / 3,
    });
  });

  it("32 no retry-to-pass: more than three, duplicate IDs, or altered counts reject", () => {
    const f = fixture();
    expect(LM6_MAX_ATTEMPTS).toBe(3);
    expect(() => run(f, [attempt(1), attempt(2), attempt(3), attempt(4)])).toThrow();
    expect(() => run(f, [attempt(1), attempt(1)])).toThrow();
    const value = run(f, [attempt(1), attempt(2)]);
    expect(lm6RunSchema.safeParse({
      ...value, reliability: { ...value.reliability, completed: 1, completionFraction: 0.5 },
    }).success).toBe(false);
  });

  it("33 append is CAS-scoped, rejects duplicate runs and leaves Agent qualification unchanged", () => {
    const f = fixture(), value = run(f);
    const before = assessDeploymentAgentEligibility(f.observed.fabric,
      f.observed.deploymentId, f.observed.observation, {}, NOW);
    const saved = persist(f, value);
    const after = assessDeploymentAgentEligibility(reconcileLocalComputeFabric(saved),
      f.observed.deploymentId, f.observed.observation, {}, NOW);
    expect(after.eligible).toBe(false);
    expect(before.eligible).toBe(false);
    expect(saved.fabric?.qualificationReceipts).toEqual(f.state.fabric?.qualificationReceipts);
    expect(saved.profiles).toEqual(f.state.profiles);
    expect(saved.endpoints).toEqual(f.state.endpoints);
    expect(f.state.fabric?.measurementRuns).toBeUndefined();
    expect(() => appendLm6Run(saved, value, f.observed.observation, NOW, f.observed.fabric))
      .toThrow(/Duplicate LM6 run ID/);
  });

  it("34 remote Ollama partial telemetry retains unknown thermal, resource and provider fields", () => {
    const f = fixture(), fabric = structuredClone(f.observed.fabric);
    fabric.hosts[0].id = "remote-host";
    fabric.hosts[0].location = "remote";
    fabric.hosts[0].runtimeIds = ["remote-ollama"];
    fabric.runtimes[0].id = "remote-ollama";
    fabric.runtimes[0].hostId = "remote-host";
    fabric.runtimes[0].type = "ollama";
    fabric.runtimes[0].version = "0.40.11";
    fabric.runtimes[0].runtimeEpoch = "remote-epoch";
    fabric.deployments[0].runtimeId = "remote-ollama";
    fabric.deployments[0].hostId = "remote-host";
    fabric.artifacts[0].format = "ollama-manifest";
    const observed = {
      runtimeId: "remote-ollama", version: "0.40.11",
      configurationRevision: 1, epoch: "remote-epoch", observedAt: NOW,
    };
    const scope = lm6ExactScope(fabric, f.observed.deploymentId, observed, NOW);
    expect(scope).not.toBeNull();
    const partial = attempt(1, {
      thermal: "unknown", thermalSource: "remote-ollama-model-residency-not-verified",
      signals: {
        providerLoadDurationNs: null, providerPromptDurationNs: null,
        providerGenerationDurationNs: null, ramBeforeBytes: null,
        ramDuringBytes: null, ramAfterBytes: null,
        vramBeforeBytes: null, vramDuringBytes: null, vramAfterBytes: null,
      },
    });
    const value = completeLm6Run({
      runId: uuid(34), scope: scope!, backend: "Unknown",
      configuredContextTokens: null, startedAt: NOW - 2_000,
      endedAt: NOW - 100, requestedAttempts: 1, attempts: [partial],
    });
    expect(isCurrentLm6Run(value, fabric, f.observed.deploymentId,
      observed, null, "Unknown", NOW)).toBe(true);
    expect(partial.resources.ramDuringBytes.provenance).toBe("Unknown");
    expect(partial.resources.vramDuringBytes.provenance).toBe("Unknown");
    expect(partial.thermal).toBe("unknown");
    expect(partial.usage.promptTokens.value).toBe(100);
    expect(partial.usage.promptTokensPerSecond.provenance).toBe("Unknown");
  });

  it("35 historical unknown-version rows are inert while valid records remain readable", () => {
    const f = fixture(), value = run(f);
    const saved = persist(f, value);
    const payload = structuredClone(saved);
    payload.fabric!.measurementRuns!.push({ version: 99, runId: uuid(99), data: "future" });
    const restored = readSelfHostedState(payload);
    expect(lm6History(reconcileLocalComputeFabric(restored), f.observed.deploymentId))
      .toEqual([value]);
    expect(restored.fabric?.measurementRuns).toHaveLength(2);
  });

  it("36 invalid attempt windows, cancellation order and unknown raw errors fail closed", () => {
    expect(lm6AttemptSchema.safeParse({
      ...attempt(), endedAt: NOW - 2_000,
    }).success).toBe(false);
    expect(lm6AttemptSchema.safeParse({
      ...attempt(), cancelRequestedAt: NOW - 1500,
      cancelAcknowledgedAt: NOW - 1600,
    }).success).toBe(false);
    expect(lm6Failure({ errorCode: "connect-timeout" })).toBe("connectivity");
    expect(lm6Failure({ errorCode: "overall-deadline" })).toBe("terminal-timeout");
    expect(lm6Failure({ message: "private provider secret and URL" })).toBe("provider-error");
  });

  it("37 native inference-N and Clack request UUID remain distinct, independently verified identities", () => {
    const row = attempt(37, {
      requestId: "10404673-ec8e-4c4b-aa50-1b2509fb8bfb",
      nativeRequestId: "inference-42",
      nativeRequestOpenEvents: 1,
      distinctNativeRequestCount: 1,
    });
    expect(lm6AttemptSchema.parse(row)).toEqual(row);
    expect(row.nativeRequestId).toBe("inference-42");
    expect(row.requestId).not.toBe(row.nativeRequestId);
    expect(row.nativeRequestOpenEvents).toBe(1);
    expect(row.distinctNativeRequestCount).toBe(1);
  });

  it("38 UUID passed as a native registry ID or a non-native fabricated ID is rejected", () => {
    const row = attempt(38, { nativeRequestId: "inference-1" });
    expect(lm6AttemptSchema.safeParse({
      ...row, nativeRequestId: "10404673-ec8e-4c4b-aa50-1b2509fb8bfb",
    }).success).toBe(false);
    expect(lm6AttemptSchema.safeParse({ ...row, nativeRequestId: "inference-zero" }).success).toBe(false);
    expect(lm6AttemptSchema.safeParse({
      ...row, nativeRequestId: "inference-1", distinctNativeRequestCount: 2,
    }).success).toBe(false);
  });

  it("39 a completed-but-unverified instruction request cannot be labeled model nonadherence", () => {
    const row = attempt(39, {
      workload: "instruction-adherence",
      result: "failed", failure: "incomplete-evidence",
      capabilityCheck: "incomplete", terminalObserved: false,
    });
    expect(lm6AttemptSchema.parse(row).capabilityCheck).toBe("incomplete");
    expect(run(fixture(), [row]).reliability).toMatchObject({ failed: 1, completed: 0 });
  });

  it("40 live-flight observer counts native opens independently from distinct native IDs", () => {
    const sessionId = "lm6-fixture-40";
    armDeploymentQualification(sessionId, "exact-managed-fixture", "builtin:coder", {
      expectedPrompt: "short bounded prompt", measure: true,
    });
    try {
      observeDeploymentQualificationNative(sessionId, "request", "inference-1", NOW - 500);
      observeDeploymentQualificationNative(sessionId, "frame", "inference-1", NOW - 300);
      observeDeploymentQualificationNative(sessionId, "request", "inference-1", NOW - 250);
      const snapshot = disarmDeploymentQualification(sessionId)?.measurement;
      expect(snapshot?.nativeRequestIds).toEqual(["inference-1"]);
      expect(snapshot?.nativeRequestOpenEvents).toBe(2);
      expect(snapshot?.firstFrameAt).toBe(NOW - 300);
      expect(snapshot?.requestStartAt).toBe(NOW - 500);
    } finally {
      disarmDeploymentQualification(sessionId);
    }
  });

  it("41 a repeated native dispatch cannot be misread as one successful request", () => {
    expect(lm6SingleNativeRequest({
      nativeRequestIds: ["inference-42"], nativeRequestOpenEvents: 1,
    })).toBe("inference-42");
    expect(lm6SingleNativeRequest({
      nativeRequestIds: ["inference-42"], nativeRequestOpenEvents: 2,
    })).toBeNull();
    expect(lm6SingleNativeRequest({
      nativeRequestIds: ["inference-42", "inference-43"], nativeRequestOpenEvents: 2,
    })).toBeNull();
    expect(lm6SingleNativeRequest({
      nativeRequestIds: ["some-uuid"], nativeRequestOpenEvents: 1,
    })).toBeNull();
  });
});
