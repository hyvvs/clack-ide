import { describe, expect, it } from "vitest";
import type { EvidenceCandidate } from "./deploymentEvidenceDecisions";
import {
  AGENT_ACCEPTANCE_BOUNDS, AGENT_ACCEPTANCE_CHECKS,
  agentAcceptancePrerequisites, evaluateAgentAcceptance,
  profileCandidateDeployment, selectAgentAcceptanceCandidates,
  type AgentAcceptanceTaskReceipt, type CandidateBehavioralProof,
} from "./candidateQualification";

const granted = { state: "Qualified", available: true,
  reason: "Current scoped receipt", lastResultAt: 100 } as const;
const denied = { state: "Requires Qualification", available: false,
  reason: "No current proof", lastResultAt: null } as const;

function fixture(id = "deployment-a"): EvidenceCandidate {
  return {
    deploymentId: id, deploymentIdentity: `canonical-${id}`, displayName: "Model",
    hostId: "host", hostName: "Host", hostLocation: "local", runtimeId: "runtime",
    runtimeName: "Runtime", runtimeVersion: "1", artifactDigest: "sha256:test",
    artifactFormat: "gguf", quantization: "Q4", configurationIdentity: "config",
    contextTokens: 8192, backend: "CPU", ready: true, readiness: "Ready",
    observation: { runtimeId: "runtime", configurationRevision: 1,
      version: "1", epoch: "epoch-1", observedAt: 100 },
    confidence: "Medium", hardwareFit: "Good", fit: "Fits",
    limitingFactor: "No additional telemetry", estimatedRamBytes: {} as EvidenceCandidate["estimatedRamBytes"],
    estimatedVramBytes: {} as EvidenceCandidate["estimatedVramBytes"],
    qualification: {
      chat: granted, instruction: granted, structured: granted, nativeTools: granted,
      cancellation: granted, streaming: granted, terminal: granted,
      agent: { eligible: true, reason: "Current all five gates", requirements: {} },
    },
    workloadAssessments: {}, coldFirstOutput: {} as EvidenceCandidate["coldFirstOutput"],
    warmFirstOutput: {} as EvidenceCandidate["warmFirstOutput"],
    terminalLatency: {} as EvidenceCandidate["terminalLatency"],
    generationThroughput: { value: null, provenance: "Unknown" } as EvidenceCandidate["generationThroughput"],
    currentRun: { runId: "accepted" } as EvidenceCandidate["currentRun"],
    historyRunCount: 1, measuredChatSamples: 3, normalChatReliability: 1,
    evidenceReferences: ["receipt-1", "run-1"],
  };
}

function task(candidate: EvidenceCandidate): AgentAcceptanceTaskReceipt {
  return {
    deploymentId: candidate.deploymentId,
    deploymentIdentity: candidate.deploymentIdentity,
    taskId: "isolated-edit-and-test", attemptCount: 1,
    startedAt: 1_000, endedAt: 40_000, duplicateEffects: 0,
    verificationReference: "independent-test-verification",
    checks: Object.fromEntries(AGENT_ACCEPTANCE_CHECKS.map(key => [key, "pass"])) as
      AgentAcceptanceTaskReceipt["checks"],
  };
}

function independentBehavior(candidate: EvidenceCandidate): CandidateBehavioralProof[] {
  const { runtimeVersion, observation, configurationIdentity,
    artifactDigest, contextTokens } = candidate;
  if (!runtimeVersion || !observation ||
      !configurationIdentity || !artifactDigest || !contextTokens)
    throw new Error("Incomplete exact fixture identity");
  return (["Coding", "Long Context"] as const).map(workload => ({
    workload, outcome: "passed" as const, deploymentId: candidate.deploymentId,
    hostId: candidate.hostId, runtimeId: candidate.runtimeId,
    runtimeVersion, runtimeEpoch: observation.epoch,
    configurationIdentity, artifactDigest, backend: candidate.backend,
    contextTokens, verifiedAt: 150,
    attemptCount: 1, deterministicVerificationReference: `${workload}-fixture-test-passed`,
  }));
}

describe("LM13–LM14 exact-evidence candidate and Agent acceptance admission", () => {
  it("01 returns independent workload statuses without a single opaque score", () => {
    const profile = profileCandidateDeployment(fixture());
    expect(profile.workloads).toHaveLength(7);
    expect(profile.workloads.find(w => w.workload === "Chat")?.verdict).toBe("Qualified");
    expect(profile.workloads.find(w => w.workload === "Coding")?.verdict).toBe("Candidate");
  });
  it("02 never claims coding test success from instruction proof alone", () => {
    expect(profileCandidateDeployment(fixture()).workloads.find(w => w.workload === "Coding")?.reason)
      .toContain("no current independently verified coding patch");
  });
  it("03 native tools without current qualification is not a qualified candidate", () => {
    const c = fixture(); c.qualification.nativeTools = denied;
    expect(profileCandidateDeployment(c).workloads.find(w => w.workload === "Native Tools")?.verdict)
      .toBe("Requires Qualification");
    expect(selectAgentAcceptanceCandidates([c])).toEqual([]);
  });
  it("04 an Agent with missing independent effect proofs cannot enter acceptance", () => {
    const c = fixture(); c.qualification.agent = { ...c.qualification.agent, eligible: false };
    expect(agentAcceptancePrerequisites(c)).toContain("Current native-tool and Agent effect qualification");
  });
  it("05 stale runtime revokes candidate status without discarding saved references", () => {
    const c = fixture(); c.ready = false;
    const out = profileCandidateDeployment(c);
    expect(out.workloads.find(w => w.workload === "Chat")?.verdict).toBe("Stale");
    expect(out.workloads.find(w => w.workload === "Chat")?.currentEvidenceReferences).toEqual([]);
    expect(out.deploymentId).toBe(c.deploymentId);
  });
  it("06 context configuration is not proof of long-context retention", () => {
    const c = fixture(); c.contextTokens = 32_768;
    expect(profileCandidateDeployment(c).workloads.find(w => w.workload === "Long Context")?.verdict)
      .toBe("Candidate");
  });
  it("07 narrow context cannot enter Agent acceptance", () => {
    const c = fixture(); c.contextTokens = 2048;
    expect(agentAcceptancePrerequisites(c)).toContain("At least 8192 configured context tokens");
  });
  it("08 hardware fit Good does not hide behavior failure", () => {
    const c = fixture(); c.qualification.instruction = {
      state: "Qualification Failed", available: false, reason: "failed",
      lastResultAt: 100, lastResult: "failed",
    };
    expect(selectAgentAcceptanceCandidates([c])).toEqual([]);
    expect(profileCandidateDeployment(c).workloads.find(w => w.workload === "Coding")?.verdict)
      .toBe("Qualification Failed");
  });
  it("09 behavior proof with insufficient hardware cannot enter Agent", () => {
    const c = fixture(); c.hardwareFit = "Poor";
    expect(selectAgentAcceptanceCandidates([c], independentBehavior(c))).toEqual([]);
    expect(profileCandidateDeployment(c).workloads.find(w => w.workload === "Chat")?.verdict)
      .toBe("Qualified"); // Hardware does not erase valid Chat behavior.
  });
  it("10 insufficient measured Chat samples cannot masquerade as reliability", () => {
    const c = fixture(); c.measuredChatSamples = 1;
    expect(agentAcceptancePrerequisites(c).join(" ")).toContain("two complete");
  });
  it("11 low measured normal-Chat completion fraction prevents promotion", () => {
    const c = fixture(); c.normalChatReliability = 0.5;
    expect(selectAgentAcceptanceCandidates([c])).toEqual([]);
  });
  it("12 no candidate is an empty list, not an unqualified fallback", () => {
    expect(selectAgentAcceptanceCandidates([])).toEqual([]);
    expect(selectAgentAcceptanceCandidates([{ ...fixture(), ready: false }])).toEqual([]);
  });
  it("13 at most two candidates, with deterministic rank/tie-break", () => {
    const ids = ["z", "b", "a", "c"];
    const receipts = ids.flatMap(id => independentBehavior(fixture(id)));
    const first = selectAgentAcceptanceCandidates(ids.map(fixture), receipts);
    const second = selectAgentAcceptanceCandidates([...ids].reverse().map(fixture), receipts);
    expect(first.map(c => c.deploymentId)).toEqual(["a", "b"]);
    expect(second.map(c => c.deploymentId)).toEqual(["a", "b"]);
  });
  it("14 task acceptance requires independent deterministic verification", () => {
    const c = fixture();
    expect(evaluateAgentAcceptance(c, task(c), independentBehavior(c)).verdict).toBe("Passed");
    const t = task(c); t.checks["code-correct"] = "incomplete";
    expect(evaluateAgentAcceptance(c, t, independentBehavior(c)).verdict).toBe("Incomplete");
  });
  it("15 duplicate effects are an Agent failure even when all other checks say pass", () => {
    const c = fixture(); const t = task(c); t.duplicateEffects = 1;
    expect(evaluateAgentAcceptance(c, t, independentBehavior(c)).failedChecks).toContain("no-duplicate-effects");
  });
  it("16 the original failed Agent task is never retried to PASS by this evaluator", () => {
    const c = fixture(); const t = task(c); t.checks["tool-selected"] = "fail";
    expect(evaluateAgentAcceptance(c, t, independentBehavior(c)).verdict).toBe("Failed");
    expect(evaluateAgentAcceptance(c, t, independentBehavior(c)).attempts).toBe(1);
    expect(AGENT_ACCEPTANCE_BOUNDS.retryPolicy).toBe("none");
  });
  it("17 cross-deployment and stale identity receipts never pass", () => {
    const c = fixture(); const t = task(c); t.deploymentIdentity = "other-identity";
    expect(evaluateAgentAcceptance(c, t, independentBehavior(c)).verdict).toBe("Incomplete");
  });
  it("18 out-of-bounds task runtime and attempts never pass", () => {
    const c = fixture(); const t = task(c);
    t.endedAt = t.startedAt + AGENT_ACCEPTANCE_BOUNDS.maxWallMsPerTask + 1;
    expect(evaluateAgentAcceptance(c, t, independentBehavior(c)).verdict).toBe("Incomplete");
    t.endedAt = 30_000; t.attemptCount = 3;
    expect(evaluateAgentAcceptance(c, t, independentBehavior(c)).verdict).toBe("Incomplete");
  });
  it("19 unknown throughput is Unknown, not a fabricated number", () => {
    expect(profileCandidateDeployment(fixture()).generationTokensPerSecond).toBeNull();
  });
  it("20 current structured capability is reported separately from tool support", () => {
    const c = fixture(); c.qualification.structured = denied;
    const w = profileCandidateDeployment(c).workloads;
    expect(w.find(x => x.workload === "Structured Output")?.verdict).toBe("Requires Qualification");
    expect(w.find(x => x.workload === "Native Tools")?.verdict).toBe("Qualified");
  });
  it("21 apparently qualified protocol gates cannot substitute for coding and context fixture results", () => {
    const c = fixture();
    expect(selectAgentAcceptanceCandidates([c])).toEqual([]);
    expect(agentAcceptancePrerequisites(c)).toContain(
      "Current exact-runtime independently verified Coding fixture",
    );
    expect(agentAcceptancePrerequisites(c)).toContain(
      "Current exact-runtime independently verified long-context retrieval fixture",
    );
    expect(evaluateAgentAcceptance(c, task(c)).verdict).toBe("Blocked");
  });
  it("22 stale epoch, wrong host and failing same-scope results are not Agent proof", () => {
    const c = fixture();
    const [code, context] = independentBehavior(c);
    const wrongHost = { ...code, hostId: "unrelated-host" };
    expect(selectAgentAcceptanceCandidates([c], [wrongHost, context])).toEqual([]);
    const failed = { ...code, outcome: "failed" as const };
    expect(selectAgentAcceptanceCandidates([c], [code, failed, context])).toEqual([]);
    if (!c.observation) throw new Error("Fixture native observation unavailable");
    const changed = { ...c, observation: { ...c.observation, epoch: "new-runtime-epoch" } };
    expect(selectAgentAcceptanceCandidates([changed], [code, context])).toEqual([]);
  });
});
