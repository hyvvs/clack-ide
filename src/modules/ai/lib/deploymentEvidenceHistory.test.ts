import { describe, expect, it } from "vitest";
import {
  CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES,
  deploymentQualificationEvidenceReceiptSchema,
  deploymentQualificationReceiptSchema,
  deploymentQualificationScope,
  localComputeFabricSchema,
  reconcileLocalComputeFabric,
  type DeploymentQualificationEvidenceReceipt,
  type DeploymentRuntimeObservation,
  type RuntimeCapabilityName,
} from "./localComputeFabric";
import {
  completeLm6Run, lm6AttemptFromSignals, lm6ExactScope,
  type Lm6Attempt, type Lm6Run,
} from "./deploymentMeasurement";
import { readSelfHostedState, type SelfHostedState } from "./selfHostedProfiles";
import { buildDeploymentEvidenceHistory } from "./deploymentEvidenceHistory";

// Synthetic CAS registry and native observations only. No provider calls, IPC,
// processes, durable writes, or changes to the protected LM2F/LM6 evidence.
const NOW = 1_800_000_000_000;
const SHA = `sha256:${"a".repeat(64)}`;
const OTHER_SHA = `sha256:${"b".repeat(64)}`;
const HOST = "host-a";
const RUNTIME = "runtime-a";
const DEPLOYMENT = "deployment-a";
const CONTEXT = '{"version":1,"context":2048,"gpu":0,"tool":false,"grammar":false}';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function fixture(): { state: SelfHostedState; observation: DeploymentRuntimeObservation } {
  const capabilities = Object.fromEntries([
    "chat", "streaming", "terminal-completion", "instruction-adherence",
    "json-schema", "native-tools",
  ].map(key => [key, { status: "requires-qualification", source: "fixture-declaration" }]));
  return {
    state: {
      version: 1, revision: 1, endpoints: [], profiles: [],
      fabric: localComputeFabricSchema.parse({
        version: 1,
        hosts: [{ id: HOST, displayName: "Local", location: "local", enabled: true,
          reachability: "online", runtimeIds: [RUNTIME] }],
        runtimes: [{ id: RUNTIME, hostId: HOST, type: "fixture", displayName: "Fixture",
          version: "1.0", processIdentity: "pid:71", runtimeEpoch: "epoch-1",
          enabled: true, health: "online", configurationRevision: 1, capabilities }],
        artifacts: [{ id: "artifact-a", displayName: "Model", format: "gguf",
          digest: SHA, provenance: "user-supplied" }],
        deployments: [{ id: DEPLOYMENT, hostId: HOST, runtimeId: RUNTIME,
          artifactId: "artifact-a", runtimeModelName: "fixture-model",
          configurationRevision: 1, configurationIdentity: CONTEXT }],
      }),
    },
    observation: { runtimeId: RUNTIME, version: "1.0", epoch: "epoch-1",
      configurationRevision: 1, observedAt: NOW - 10 },
  };
}

function receipt(state: SelfHostedState, observation: DeploymentRuntimeObservation,
  capability: RuntimeCapabilityName = "chat",
  status: DeploymentQualificationEvidenceReceipt["status"] = "verified",
  at = NOW - 100,
  context: DeploymentQualificationEvidenceReceipt["context"] = {},
): DeploymentQualificationEvidenceReceipt {
  const scope = deploymentQualificationScope(reconcileLocalComputeFabric(state), DEPLOYMENT,
    observation, NOW);
  if (!scope) throw new Error("Synthetic current scope missing");
  const result = status === "verified" ? "pass" : status === "incomplete" ? "incomplete" : "fail";
  return deploymentQualificationEvidenceReceiptSchema.parse({
    version: 2, scope: { ...scope, deploymentId: DEPLOYMENT },
    capability, status, verifiedAt: at, expiresAt: at + 86_400_000,
    procedure: CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES[
      capability as keyof typeof CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES] ??
      { id: "unregistered", version: 1 },
    context, evidence: { source: "clack-transport", reference: uuid(91),
      digest: SHA, checks: [{ id: "verified-observation", result }] },
  });
}

function withReceipts(state: SelfHostedState, rows: unknown[]): SelfHostedState {
  return { ...state, fabric: { ...state.fabric!, qualificationReceipts: rows } };
}

function attempt(n: number, workload: Lm6Attempt["workload"],
  thermal: Lm6Attempt["thermal"],
  result: Lm6Attempt["result"], start = NOW - 2_000): Lm6Attempt {
  const at = start + n * 200;
  const passed = result === "passed";
  const cancelled = result === "cancelled";
  return lm6AttemptFromSignals({
    attemptId: `attempt-${n}`, requestId: uuid(n), nativeRequestId: `inference-${n}`,
    nativeRequestOpenEvents: 1, distinctNativeRequestCount: 1,
    workload, thermal, thermalSource: "native-current-deployment-ready",
    startedAt: at, endedAt: at + 150,
    result, failure: passed ? "none" : cancelled ? "cancelled" : "incomplete-evidence",
    capabilityCheck: workload === "instruction-adherence" ? "failed" : "not-run",
    outputObserved: true, terminalObserved: passed,
    signals: {
      requestStart: at, firstFrame: at + 20, firstMeaningful: at + 30,
      ...(passed ? { terminal: at + 100, promptTokens: 50, generatedTokens: 9 } : {}),
      duplicateRequestObserved: false,
      ...(cancelled ? { cancelRequestedAt: at + 90, cancelAcknowledgedAt: at + 97,
        noContinuationObserved: true } : {}),
    },
  });
}

function run(state: SelfHostedState, observation: DeploymentRuntimeObservation,
  id: number, attempts: Lm6Attempt[], endedAt = NOW - 20): Lm6Run {
  const scope = lm6ExactScope(reconcileLocalComputeFabric(state), DEPLOYMENT, observation, NOW);
  if (!scope) throw new Error("Synthetic LM6 exact scope missing");
  return completeLm6Run({
    runId: uuid(id), scope, configuredContextTokens: 2048, backend: "CPU",
    startedAt: Math.min(...attempts.map(a => a.startedAt)) - 10,
    endedAt, requestedAttempts: attempts.length, attempts,
  });
}

describe("LM7 bounded rebuildable deployment evidence history", () => {
  it("keeps mixed LM2F observations and a newer same-millisecond failure separate from freshness", () => {
    const { state, observation } = fixture();
    const passed = receipt(state, observation);
    const failed = receipt(state, observation, "chat", "failed");
    const incomplete = receipt(state, observation, "streaming", "incomplete");
    const unsupported = receipt(state, observation, "native-tools", "unsupported", NOW - 100,
      { toolProtocol: "native-v1", toolSchemaDigest: OTHER_SHA });
    const result = buildDeploymentEvidenceHistory(
      withReceipts(state, [passed, failed, incomplete, unsupported]),
      DEPLOYMENT, observation, undefined, undefined, NOW);
    expect(result.total).toBe(4);
    const chat = result.rows.filter(row => row.capability === "chat");
    expect(chat.map(row => [row.verdict, row.status])).toEqual([
      ["Failed", "Current"], ["Verified", "Historical"],
    ]);
    expect(result.rows.find(row => row.capability === "streaming")).toMatchObject({
      verdict: "Incomplete", status: "Current",
    });
    expect(result.rows.find(row => row.capability === "native-tools")).toMatchObject({
      verdict: "Unsupported", status: "Stale",
    });
    expect(chat[0]).toMatchObject({
      source: "LM2F", hostId: HOST, runtimeId: RUNTIME, runtimeVersion: "1.0",
      artifactDigest: SHA, configurationIdentity: CONTEXT,
      reference: uuid(91), provenance: "clack-transport", failure: null,
    });
    expect(JSON.stringify(result)).not.toContain("model text");
  });

  it("stales exact receipts on PID/epoch, artifact, procedure, expiry and missing observation", () => {
    const { state, observation } = fixture();
    const good = receipt(state, observation);
    const source = withReceipts(state, [good]);
    const project = (s: SelfHostedState, o = observation, now = NOW) =>
      buildDeploymentEvidenceHistory(s, DEPLOYMENT, o, undefined, undefined, now).rows[0];
    expect(project(source).status).toBe("Current");
    expect(project(source, { ...observation, epoch: "epoch-2" }).status).toBe("Stale");
    expect(project(source, { ...observation, observedAt: NOW - 30_000 }).status).toBe("Stale");
    const moved = structuredClone(source);
    moved.fabric!.runtimes[0].processIdentity = "pid:72";
    expect(project(moved).status).toBe("Stale");
    const changed = structuredClone(source);
    changed.fabric!.artifacts[0].digest = OTHER_SHA;
    expect(project(changed).status).toBe("Stale");
    const movedHost = structuredClone(source);
    movedHost.fabric!.hosts[0].id = "replacement-host";
    movedHost.fabric!.runtimes[0].hostId = "replacement-host";
    movedHost.fabric!.deployments[0].hostId = "replacement-host";
    expect(project(movedHost).status).toBe("Stale");
    const revoked = withReceipts(state, [{ ...good, procedure: { id: "changed", version: 2 } }]);
    expect(project(revoked).status).toBe("Stale");
    expect(project(source, { ...observation, observedAt: good.expiresAt - 1 }, good.expiresAt).status)
      .toBe("Stale");
    expect(buildDeploymentEvidenceHistory(source, DEPLOYMENT).rows[0].status).toBe("Stale");
  });

  it("retains contextual failures but cannot call old persona/schema evidence current", () => {
    const { state, observation } = fixture();
    const contextual = receipt(state, observation, "instruction-adherence", "failed", NOW - 100,
      { personaId: "builtin:coder", systemContextDigest: OTHER_SHA });
    const schema = receipt(state, observation, "json-schema", "verified", NOW - 101,
      { formatSchemaDigest: OTHER_SHA });
    const result = buildDeploymentEvidenceHistory(
      withReceipts(state, [contextual, schema]), DEPLOYMENT,
      observation, 2048, "CPU", NOW);
    expect(result.rows.map(r => [r.verdict, r.status])).toEqual([
      ["Failed", "Stale"], ["Verified", "Stale"],
    ]);
  });

  it("retains v1 as historical only, without transferring ambiguous/changed identities", () => {
    const { state, observation } = fixture();
    const original = deploymentQualificationScope(reconcileLocalComputeFabric(state),
      DEPLOYMENT, observation, NOW)!;
    const old = deploymentQualificationReceiptSchema.parse({
      version: 1, scope: original, capability: "chat", status: "verified",
      verifiedAt: NOW - 10_000, expiresAt: NOW + 10_000,
    });
    const source = withReceipts(state, [old]);
    expect(buildDeploymentEvidenceHistory(source, DEPLOYMENT, observation, 2048, "CPU", NOW)
      .rows).toMatchObject([{ receiptVersion: 1, verdict: "Verified", status: "Historical",
        reference: null, procedure: null, provenance: "legacy-v1" }]);
    const changed = structuredClone(source);
    changed.fabric!.deployments[0].configurationIdentity = "changed";
    expect(buildDeploymentEvidenceHistory(changed, DEPLOYMENT, observation, 2048, "CPU", NOW)
      .rows).toHaveLength(0);
    const ambiguous = structuredClone(source);
    ambiguous.fabric!.deployments.push({ ...ambiguous.fabric!.deployments[0], id: "another-id" });
    expect(buildDeploymentEvidenceHistory(ambiguous, DEPLOYMENT, observation, 2048, "CPU", NOW)
      .rows).toHaveLength(0);
  });

  it("keeps unknown future-version receipts inert and denies resurrection of an older pass", () => {
    const { state, observation } = fixture();
    const older = receipt(state, observation);
    const future = { ...older, version: 3, verifiedAt: NOW - 10,
      futurePermission: { grant: true } };
    const persisted = readSelfHostedState(JSON.parse(JSON.stringify(
      withReceipts(state, [older, future]))));
    const result = buildDeploymentEvidenceHistory(persisted, DEPLOYMENT,
      observation, 2048, "CPU", NOW);
    expect(result.rows).toMatchObject([{
      verdict: "Verified", status: "Historical", receiptVersion: 2,
    }]);
    expect(persisted.fabric?.qualificationReceipts).toContainEqual(future);
  });

  it("projects LM6 attempts, actual cancellation, provenance and cold/warm trends", () => {
    const { state, observation } = fixture();
    const cold = attempt(1, "chat", "cold", "passed");
    const warm = attempt(2, "chat", "warm", "passed");
    const cancelled = attempt(3, "cancellation", "warm", "cancelled");
    const latest = run(state, observation, 1, [cold, warm, cancelled]);
    const oldAdherence = { ...attempt(4, "instruction-adherence", "cold", "failed", NOW - 4_000),
      requestId: null };
    const older = run(state, observation, 2, [oldAdherence], NOW - 2_900);
    const persisted = readSelfHostedState(JSON.parse(JSON.stringify({
      ...state, fabric: { ...state.fabric!, measurementRuns: [older, latest] },
    })));
    const initial = JSON.stringify(persisted);
    const result = buildDeploymentEvidenceHistory(persisted, DEPLOYMENT,
      observation, 2048, "CPU", NOW);
    expect(JSON.stringify(persisted)).toBe(initial);
    expect(result.total).toBe(4);
    expect(result.rows.filter(row => row.status === "Current")).toHaveLength(3);
    expect(result.rows.find(row => row.runId === older.runId)).toMatchObject({
      status: "Historical", verdict: "Incomplete", attemptResult: "failed",
      failure: "incomplete-evidence", capabilityCheck: "incomplete",
    });
    expect(result.rows.find(row => row.capability === "cancellation")).toMatchObject({
      status: "Current", verdict: "Cancelled", failure: "cancelled",
      chatRequestId: uuid(3), nativeRequestId: "inference-3",
      terminalMs: { value: null, provenance: "Unknown" },
    });
    expect(result.coldSamples.map(sample => [sample.runId, sample.valueMs]))
      .toEqual([[older.runId, 30], [latest.runId, 30]]);
    expect(result.warmSamples).toHaveLength(2);
    expect(result.warmSamples[0]).toMatchObject({
      valueMs: 30, provenance: "Measured", status: "Current",
    });
    expect(result.rows.find(row => row.at === cold.endedAt)?.firstMeaningfulOutputMs)
      .toMatchObject({ value: 30, provenance: "Measured" });
  });

  it("stales LM6 on procedure epoch/config/backend/context/age without rewriting older results", () => {
    const { state, observation } = fixture();
    const qualified = run(state, observation, 1, [attempt(1, "chat", "cold", "passed")]);
    const persisted = { ...state, fabric: { ...state.fabric!, measurementRuns: [qualified] } };
    const first = (s: SelfHostedState, o = observation, ctx: number | null = 2048,
      back: Lm6Run["backend"] = "CPU", at = NOW) =>
      buildDeploymentEvidenceHistory(s, DEPLOYMENT, o, ctx, back, at).rows[0];
    expect(first(persisted).status).toBe("Current");
    expect(first(persisted, { ...observation, epoch: "epoch-2" }).status).toBe("Stale");
    expect(first(persisted, observation, 4096).status).toBe("Stale");
    expect(first(persisted, observation, 2048, "GPU").status).toBe("Stale");
    const moved = structuredClone(persisted);
    moved.fabric!.deployments[0].configurationIdentity = "new-config";
    expect(first(moved).status).toBe("Stale");
    const procedure = structuredClone(persisted);
    (procedure.fabric!.measurementRuns![0] as Lm6Run).procedure.version = 2 as 1;
    expect(first(procedure)).toBeUndefined(); // unrecognized future run is inert
    expect(first(persisted, { ...observation, observedAt: NOW + 30 * 60_000 },
      2048, "CPU", NOW + 30 * 60_000).status).toBe("Stale");
    expect(first(persisted).verdict).toBe("Passed");
  });

  it("keeps an older exact-current LM6 run when newer saved history belongs to another epoch", () => {
    const { state, observation } = fixture();
    const current = run(state, observation, 1, [attempt(1, "chat", "warm", "passed")]);
    const laterOtherEpoch: Lm6Run = {
      ...current, runId: uuid(2), endedAt: NOW - 10,
      scope: { ...current.scope, runtimeEpoch: "previous-or-foreign-epoch" },
    };
    const stored: SelfHostedState = {
      ...state, fabric: { ...state.fabric!, measurementRuns: [current, laterOtherEpoch] },
    };
    const history = buildDeploymentEvidenceHistory(stored, DEPLOYMENT,
      observation, 2048, "CPU", NOW);
    expect(history.rows.find(row => row.runId === current.runId)?.status).toBe("Current");
    expect(history.rows.find(row => row.runId === laterOtherEpoch.runId)?.status).toBe("Stale");
  });

  it("distinguishes old incomplete correlation from an observed provider failure", () => {
    const { state, observation } = fixture();
    const incomplete = { ...attempt(1, "chat", "cold", "failed"),
      failure: "incomplete-evidence" as const };
    const failed = { ...attempt(2, "chat", "warm", "failed"),
      failure: "provider-error" as const };
    const historical = run(state, observation, 1, [incomplete, failed]);
    const stored: SelfHostedState = {
      ...state, fabric: { ...state.fabric!, measurementRuns: [historical] },
    };
    const rows = buildDeploymentEvidenceHistory(stored, DEPLOYMENT,
      observation, 2048, "CPU", NOW).rows;
    expect(rows.find(row => row.at === incomplete.endedAt)).toMatchObject({
      verdict: "Incomplete", attemptResult: "failed", failure: "incomplete-evidence",
    });
    expect(rows.find(row => row.at === failed.endedAt)).toMatchObject({
      verdict: "Failed", attemptResult: "failed", failure: "provider-error",
    });
  });
});
