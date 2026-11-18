import type { EvidenceCandidate } from "./deploymentEvidenceDecisions";

/** LM13/LM14 is a read-only admission and reporting projection. The existing
 * LM2F/LM6 ledgers remain the ONLY current qualification authority. A coding
 * or long-context fixture cannot be made current by naming a model or merely
 * supplying a result to this module. */
export type CandidateWorkload =
  "Chat" | "Coding" | "Structured Output" | "Native Tools" |
  "Long Context" | "Reliability" | "Automatic Agent";
export type CandidateWorkloadVerdict =
  "Qualified" | "Candidate" | "Requires Qualification" |
  "Qualification Failed" | "Stale" | "Unsupported" | "Unknown";

export type CandidateWorkloadEvidence = {
  workload: CandidateWorkload;
  verdict: CandidateWorkloadVerdict;
  reason: string;
  currentEvidenceReferences: string[];
};

export type CandidateQualificationProfile = {
  deploymentId: string;
  deploymentIdentity: string;
  displayName: string;
  hostId: string;
  runtimeId: string;
  runtimeVersion: string | null;
  backend: EvidenceCandidate["backend"];
  contextTokens: number | null;
  artifactDigest: string | null;
  ready: boolean;
  hardwareFit: EvidenceCandidate["hardwareFit"];
  confidence: EvidenceCandidate["confidence"];
  completedChatSamples: number;
  chatReliability: number | null;
  generationTokensPerSecond: number | null;
  reasons: string[];
  limitations: string[];
  workloads: CandidateWorkloadEvidence[];
};

function missingCapability(state: string): CandidateWorkloadVerdict {
  if (state === "Unsupported") return "Unsupported";
  if (state === "Qualification Failed") return "Qualification Failed";
  if (state === "Qualification Stale") return "Stale";
  if (state === "Unknown") return "Unknown";
  return "Requires Qualification";
}

export function profileCandidateDeployment(c: EvidenceCandidate): CandidateQualificationProfile {
  const currentRefs = c.ready ? [...c.evidenceReferences].slice(0, 32) : [];
  // A current Chat behavioral result is independent of hardware suitability.
  // A slow/poor-fit model can still have genuinely passed the Chat verifier;
  // hardware fit is reported separately and may still block Agent promotion.
  const currentChat = c.ready && c.qualification.chat.available;
  const entries: CandidateWorkloadEvidence[] = [];
  const add = (workload: CandidateWorkload, verdict: CandidateWorkloadVerdict, reason: string) =>
    entries.push({ workload, verdict, reason,
      currentEvidenceReferences: verdict === "Qualified" ? currentRefs : [] });
  const chatStatus = currentChat ? "Qualified" : !c.ready
    ? c.qualification.chat.state === "Qualified" ||
      c.qualification.chat.state === "Qualification Stale"
      ? "Stale" : missingCapability(c.qualification.chat.state) :
    missingCapability(c.qualification.chat.state);
  add("Chat", chatStatus, currentChat
    ? "Current LM2F Chat proof; hardware suitability is assessed separately."
    : !c.ready ? "No independently verified, fresh Ready runtime for this deployment."
      : c.qualification.chat.reason);
  const instruction = c.qualification.instruction.available;
  add("Coding", !currentChat ? chatStatus : !instruction
    ? missingCapability(c.qualification.instruction.state) : "Candidate",
  !currentChat ? "Current Chat is required for Coding."
    : !instruction ? c.qualification.instruction.reason
      : "Instruction proof exists, but no current independently verified coding patch and deterministic test result exists.");
  add("Structured Output", !currentChat ? chatStatus :
    c.qualification.structured.available ? "Qualified" :
      missingCapability(c.qualification.structured.state),
  c.qualification.structured.available && currentChat
    ? "Current LM2F JSON-schema protocol receipt."
    : c.qualification.structured.reason);
  add("Native Tools", !currentChat ? chatStatus :
    c.qualification.nativeTools.available ? "Qualified" :
      missingCapability(c.qualification.nativeTools.state),
  c.qualification.nativeTools.available && currentChat
    ? "Current LM2F native-tool protocol receipt; effects still require independent authorization."
    : c.qualification.nativeTools.reason);
  add("Long Context", !currentChat ? chatStatus : c.contextTokens === null
    ? "Unknown" : c.contextTokens < 8192
      ? "Requires Qualification" : !instruction
        ? missingCapability(c.qualification.instruction.state) : "Candidate",
  "Advertised/configured context is not a measured long-context retrieval and retention result.");
  const sampleCount = c.measuredChatSamples;
  const reliability = c.normalChatReliability;
  add("Reliability", !currentChat ? chatStatus : sampleCount < 3 || reliability === null
    ? "Requires Qualification" : reliability < 0.8
      ? "Qualification Failed" : "Candidate",
  sampleCount < 3
    ? `${sampleCount} current completed Chat samples; bounded multi-attempt reliability evidence is insufficient.`
    : `${sampleCount} completed samples, recorded normal-Chat completion fraction ${reliability === null ? "Unknown" : reliability.toFixed(3)}; small samples are not statistically robust.`);
  add("Automatic Agent", !currentChat ? chatStatus : !instruction
    ? missingCapability(c.qualification.instruction.state) :
    !c.qualification.agent.eligible ? "Requires Qualification" : "Candidate",
  !c.qualification.agent.eligible ? c.qualification.agent.reason :
    "Agent prerequisites may be satisfied; bounded coding/context/reliability and task acceptance remain independently required.");
  return {
    deploymentId: c.deploymentId, deploymentIdentity: c.deploymentIdentity,
    displayName: c.displayName, hostId: c.hostId, runtimeId: c.runtimeId,
    runtimeVersion: c.runtimeVersion, backend: c.backend,
    contextTokens: c.contextTokens, artifactDigest: c.artifactDigest,
    ready: c.ready, hardwareFit: c.hardwareFit, confidence: c.confidence,
    completedChatSamples: sampleCount, chatReliability: reliability,
    generationTokensPerSecond: c.generationThroughput.provenance === "Measured"
      ? c.generationThroughput.value : null,
    reasons: [...(currentChat ? ["Current exact-deployment Chat qualification."] : []),
      `${c.hardwareFit} hardware fit; ${c.confidence} evidence confidence.`],
    limitations: [c.limitingFactor,
      ...entries.filter(e => e.verdict !== "Qualified")
        .map(e => `${e.workload}: ${e.reason}`)],
    workloads: entries,
  };
}

/** A future executor must independently attest these required bounded task
 * checks. This shape never grants LM2F tool/Agent authority and is not saved
 * to the authoritative qualification ledger by this module. */
export const AGENT_ACCEPTANCE_CHECKS = [
  "requirements-retained", "tool-selected", "arguments-valid",
  "no-duplicate-effects", "code-correct", "verification-passed",
  "recovery-safe", "task-complete", "final-report-complete",
] as const;
export type AgentAcceptanceCheck = typeof AGENT_ACCEPTANCE_CHECKS[number];
export type AgentAcceptanceTaskReceipt = {
  deploymentId: string;
  deploymentIdentity: string;
  taskId: string;
  attemptCount: number;
  startedAt: number;
  endedAt: number;
  // Only independently verified checks are meaningful. No model self-report.
  checks: Partial<Record<AgentAcceptanceCheck, "pass" | "fail" | "incomplete">>;
  duplicateEffects: number;
  verificationReference: string | null;
};
export type AgentAcceptanceEvaluation = {
  verdict: "Blocked" | "Failed" | "Incomplete" | "Passed";
  reason: string;
  attempts: number;
  failedChecks: AgentAcceptanceCheck[];
};

/** Fixed two attempts and a 5-minute ceiling are *admission* constraints,
 * not a promise to run the task. User-triggered execution must enforce both. */
export const AGENT_ACCEPTANCE_BOUNDS = Object.freeze({
  maxTasks: 2, maxAttemptsPerTask: 2, maxWallMsPerTask: 300_000,
  retryPolicy: "none" as const, externalEffects: "isolated-workspace-only" as const,
});

/** A purely descriptive, independently verified *behavioral* fixture receipt.
 * These must originate from a trusted bounded task verifier, not arbitrary
 * imported model reports. This module cannot authenticate such a verifier or
 * persist an authority. No such current receipts are yet produced by Clack. */
export type CandidateBehavioralProof = {
  workload: "Coding" | "Long Context";
  outcome: "passed" | "failed" | "incomplete";
  deploymentId: string;
  hostId: string;
  runtimeId: string;
  runtimeVersion: string;
  runtimeEpoch: string;
  configurationIdentity: string;
  artifactDigest: string;
  backend: EvidenceCandidate["backend"];
  contextTokens: number;
  verifiedAt: number;
  attemptCount: number;
  deterministicVerificationReference: string;
};

function verifiedCurrentBehavior(
  c: EvidenceCandidate, proofs: readonly CandidateBehavioralProof[],
  workload: CandidateBehavioralProof["workload"],
): boolean {
  if (!c.ready || !c.observation?.epoch || !c.runtimeVersion ||
      !c.configurationIdentity || !c.artifactDigest || !c.contextTokens) return false;
  const scoped = proofs.filter(p => p.workload === workload &&
    p.deploymentId === c.deploymentId && p.hostId === c.hostId &&
    p.runtimeId === c.runtimeId && p.runtimeVersion === c.runtimeVersion &&
    p.runtimeEpoch === c.observation?.epoch &&
    p.configurationIdentity === c.configurationIdentity &&
    p.artifactDigest === c.artifactDigest && p.backend === c.backend &&
    p.contextTokens === c.contextTokens &&
    Number.isSafeInteger(p.verifiedAt) && p.verifiedAt > 0 &&
    Number.isSafeInteger(p.attemptCount) && p.attemptCount === 1 &&
    p.deterministicVerificationReference.trim().length > 0);
  // Contradictory/failing current results remain evidence, not hidden behind
  // a later pass or a retry-until-green loop.
  return scoped.length === 1 && scoped[0].outcome === "passed";
}

export function agentAcceptancePrerequisites(
  c: EvidenceCandidate, behavioralProofs: readonly CandidateBehavioralProof[] = [],
): string[] {
  const missing: string[] = [];
  if (!c.ready || !c.qualification.chat.available) missing.push("Current exact-deployment Chat qualification");
  if (c.hardwareFit === "Poor" || c.hardwareFit === "Unknown" ||
      c.fit === "Insufficient" || c.fit === "Unknown") missing.push("Acceptable verified hardware fit");
  if (!c.qualification.instruction.available) missing.push("Current instruction adherence");
  if (!c.qualification.nativeTools.available || !c.qualification.agent.eligible)
    missing.push("Current native-tool and Agent effect qualification");
  if (!c.qualification.structured.available) missing.push("Current structured output qualification");
  // Advertised context capacity is not demonstrated retention, and good
  // instruction adherence is not deterministic patch correctness.
  if (c.contextTokens === null || c.contextTokens < 8192)
    missing.push("At least 8192 configured context tokens");
  if (!verifiedCurrentBehavior(c, behavioralProofs, "Coding"))
    missing.push("Current exact-runtime independently verified Coding fixture");
  if (!verifiedCurrentBehavior(c, behavioralProofs, "Long Context"))
    missing.push("Current exact-runtime independently verified long-context retrieval fixture");
  if (!c.currentRun || c.measuredChatSamples < 2 ||
      c.normalChatReliability === null || c.normalChatReliability < 0.8)
    missing.push("At least two complete current Chat measurements and >=80% normal-Chat reliability");
  return missing;
}

/** Selection is stable across input order and never selects the least-bad
 * Agent. Current evidence, then confidence/fit/reliability, then exact ID. */
export function selectAgentAcceptanceCandidates(
  candidates: readonly EvidenceCandidate[],
  behavioralProofs: readonly CandidateBehavioralProof[] = [],
): EvidenceCandidate[] {
  const confidence = { High: 3, Medium: 2, Low: 1 } as const;
  const fit = { Excellent: 4, Good: 3, Marginal: 2, Poor: 1, Unknown: 0 } as const;
  return candidates.filter(c => agentAcceptancePrerequisites(c, behavioralProofs).length === 0)
    .sort((a, b) => confidence[b.confidence] - confidence[a.confidence] ||
      fit[b.hardwareFit] - fit[a.hardwareFit] ||
      (b.normalChatReliability ?? 0) - (a.normalChatReliability ?? 0) ||
      a.deploymentId.localeCompare(b.deploymentId))
    .slice(0, 2);
}

export function evaluateAgentAcceptance(
  candidate: EvidenceCandidate, receipt: AgentAcceptanceTaskReceipt,
  behavioralProofs: readonly CandidateBehavioralProof[] = [],
): AgentAcceptanceEvaluation {
  const blocked = agentAcceptancePrerequisites(candidate, behavioralProofs);
  if (blocked.length) return { verdict: "Blocked", reason: blocked.join("; "),
    attempts: 0, failedChecks: [] };
  if (receipt.deploymentId !== candidate.deploymentId ||
      receipt.deploymentIdentity !== candidate.deploymentIdentity ||
      !receipt.taskId.trim() || !receipt.verificationReference?.trim() ||
      !Number.isSafeInteger(receipt.startedAt) || !Number.isSafeInteger(receipt.endedAt) ||
      receipt.endedAt < receipt.startedAt ||
      receipt.endedAt - receipt.startedAt > AGENT_ACCEPTANCE_BOUNDS.maxWallMsPerTask ||
      !Number.isSafeInteger(receipt.attemptCount) || receipt.attemptCount < 1 ||
      receipt.attemptCount > AGENT_ACCEPTANCE_BOUNDS.maxAttemptsPerTask ||
      !Number.isSafeInteger(receipt.duplicateEffects) || receipt.duplicateEffects < 0)
    return { verdict: "Incomplete", reason: "Unverified or out-of-bounds Agent task receipt.",
      attempts: 0, failedChecks: [] };
  const failedChecks = AGENT_ACCEPTANCE_CHECKS.filter(key =>
    receipt.checks[key] === "fail" ||
    (key === "no-duplicate-effects" && receipt.duplicateEffects > 0));
  if (failedChecks.length) return { verdict: "Failed", reason: "Deterministic acceptance checks failed.",
    attempts: receipt.attemptCount, failedChecks };
  const incomplete = AGENT_ACCEPTANCE_CHECKS.filter(key => receipt.checks[key] !== "pass");
  if (incomplete.length) return { verdict: "Incomplete",
    reason: `Missing independently verified checks: ${incomplete.join(", ")}.`,
    attempts: receipt.attemptCount, failedChecks: [] };
  return { verdict: "Passed", reason: "All bounded task checks passed once; no duplicate tool effects.",
    attempts: receipt.attemptCount, failedChecks: [] };
}
