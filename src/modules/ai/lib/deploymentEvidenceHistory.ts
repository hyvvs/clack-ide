import {
  CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES,
  capabilityStatus,
  deploymentIdentity,
  deploymentQualificationEvidenceReceiptSchema,
  deploymentQualificationReceiptSchema,
  deploymentQualificationScope,
  deploymentQualificationState,
  reconcileLocalComputeFabric,
  runtimeCapabilityAllows,
  type DeploymentQualificationEvidenceReceipt,
  type DeploymentRuntimeObservation,
  type LocalComputeFabric,
  type RuntimeCapabilityName,
} from "./localComputeFabric";
import {
  isCurrentLm6Run,
  lm6RunSchema,
  type Lm6Attempt,
  type Lm6Failure,
  type Lm6Run,
} from "./deploymentMeasurement";
import type { EvidenceValue } from "./hardwareProfile";
import type { SelfHostedState } from "./selfHostedProfiles";

/** LM7 is a rebuildable read-only view of two existing CAS-owned ledgers.
 * It never establishes runtime readiness or authorizes a capability. */
export type DeploymentHistoryStatus = "Current" | "Stale" | "Historical";
export type DeploymentHistoryVerdict =
  "Verified" | "Failed" | "Incomplete" | "Unsupported" |
  "Passed" | "Cancelled" | "Unavailable";
export type DeploymentHistorySource = "LM2F" | "LM6";
export type DeploymentHistoryProvenance =
  DeploymentQualificationEvidenceReceipt["evidence"]["source"] |
  "legacy-v1" | EvidenceValue<number>["provenance"];
export type DeploymentHistoryProcedure = { id: string; version: number };

export type DeploymentHistoryRow = {
  /** Stable within a particular bounded ledger snapshot; never a persistence key. */
  id: string;
  source: DeploymentHistorySource;
  capability: RuntimeCapabilityName | Lm6Attempt["workload"];
  at: number;
  procedure: DeploymentHistoryProcedure | null;
  status: DeploymentHistoryStatus;
  /** The original observed result, independent of current authority/freshness. */
  verdict: DeploymentHistoryVerdict;
  provenance: DeploymentHistoryProvenance;
  /** Bounded verifier or request ID; no prompt, model text or endpoint URL. */
  reference: string | null;
  hostId: string;
  runtimeId: string;
  runtimeVersion: string;
  runtimeEpoch: string;
  runtimeProcessIdentity: string | null;
  artifactId: string;
  artifactDigest: string;
  deploymentIdentity: string;
  /** Recovered only from the canonical scoped deployment identity. */
  configurationIdentity: string | null;
  backend: Lm6Run["backend"] | null;
  contextTokens: number | null;
  failure: Lm6Failure | null;
  firstMeaningfulOutputMs?: EvidenceValue<number>;
  terminalMs?: EvidenceValue<number>;
  runId?: string;
  attemptId?: string;
  /** Original LM6 ledger result, even if its proof is incomplete. */
  attemptResult?: Lm6Attempt["result"];
  /** The two IDs have different namespaces; neither proves the other. */
  chatRequestId?: string | null;
  nativeRequestId?: string | null;
  capabilityCheck?: Lm6Attempt["capabilityCheck"];
  receiptVersion?: 1 | 2;
  expiresAt?: number;
};

export type DeploymentHistorySample = {
  rowId: string;
  runId: string;
  at: number;
  status: DeploymentHistoryStatus;
  verdict: DeploymentHistoryVerdict;
  valueMs: number | null;
  provenance: EvidenceValue<number>["provenance"];
  source: string;
};

export type DeploymentEvidenceHistory = {
  rows: DeploymentHistoryRow[];
  total: number;
  /** Chronological samples; Unknown values stay null, never fabricated as zero. */
  coldSamples: DeploymentHistorySample[];
  warmSamples: DeploymentHistorySample[];
};

type Scoped = Pick<DeploymentHistoryRow,
  "hostId" | "runtimeId" | "runtimeVersion" | "runtimeEpoch" |
  "runtimeProcessIdentity" | "artifactId" | "artifactDigest" |
  "deploymentIdentity" | "configurationIdentity">;

function configurationIdentity(identity: string): string | null {
  try {
    const tuple: unknown = JSON.parse(identity);
    if (!Array.isArray(tuple) || tuple.length !== 7) return null;
    const configuration: unknown = tuple[6];
    return typeof configuration === "string" && configuration.length <= 4096
      ? configuration : null;
  } catch {
    return null;
  }
}

function scopeFields(scope: {
  deploymentIdentity: string;
  hostId: string;
  runtimeId: string;
  runtimeVersion: string;
  runtimeEpoch: string;
  runtimeProcessIdentity: string | null;
  artifactId: string;
  artifactDigest: string;
}): Scoped {
  return {
    hostId: scope.hostId,
    runtimeId: scope.runtimeId,
    runtimeVersion: scope.runtimeVersion,
    runtimeEpoch: scope.runtimeEpoch,
    runtimeProcessIdentity: scope.runtimeProcessIdentity,
    artifactId: scope.artifactId,
    artifactDigest: scope.artifactDigest,
    deploymentIdentity: scope.deploymentIdentity,
    configurationIdentity: configurationIdentity(scope.deploymentIdentity),
  };
}

function recordedVerdict(value: string): DeploymentHistoryVerdict {
  switch (value) {
    case "verified": return "Verified";
    case "failed": return "Failed";
    case "incomplete": return "Incomplete";
    case "unsupported": return "Unsupported";
    case "passed": return "Passed";
    case "cancelled": return "Cancelled";
    case "unavailable": return "Unavailable";
    default: return "Failed"; // Only schema-validated values reach this function.
  }
}

/** A failed evidence-correlation attempt is not a demonstrated model failure.
 * Preserve the persisted result and its independent typed failure reason. */
function attemptVerdict(attempt: Lm6Attempt): DeploymentHistoryVerdict {
  if (attempt.result === "failed" &&
      (attempt.failure === "incomplete-evidence" ||
        (attempt.failure === "terminal-timeout" && !attempt.terminalObserved) ||
        (!attempt.terminalObserved &&
          (attempt.failure === "none" || attempt.failure === "unknown"))))
    return "Incomplete";
  return recordedVerdict(attempt.result);
}

function validCurrentQualification(
  fabric: LocalComputeFabric, deploymentId: string,
  receipt: DeploymentQualificationEvidenceReceipt,
  observation: DeploymentRuntimeObservation | undefined,
  now: number,
): boolean {
  const scope = deploymentQualificationScope(fabric, deploymentId, observation, now);
  const runtime = fabric.runtimes.find(row => row.id === receipt.scope.runtimeId);
  const procedure = CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES as Partial<
    Record<RuntimeCapabilityName, DeploymentHistoryProcedure>>;
  const expected = procedure[receipt.capability];
  if (!scope || !runtime || !expected ||
      JSON.stringify(receipt.scope) !== JSON.stringify({ ...scope, deploymentId }) ||
      JSON.stringify(receipt.procedure) !== JSON.stringify(expected) ||
      receipt.verifiedAt > now || receipt.expiresAt <= now ||
      // The API has no live constructed persona, format or tool schema. A
      // recorded context digest cannot certify today's different request.
      Object.keys(receipt.context).length !== 0 ||
      capabilityStatus(runtime, receipt.capability) === "unknown") return false;
  const result = deploymentQualificationState(fabric, deploymentId, receipt.capability,
    observation, receipt, now, {});
  if (receipt.status === "verified")
    return result === "Verified" && runtimeCapabilityAllows(runtime, receipt.capability, true);
  if (receipt.status === "failed") return result === "Failed";
  if (receipt.status === "incomplete") return result === "Incomplete";
  return result === "Unsupported";
}

/** Read-only projection; the caller must supply an independently verified
 * native observation and its matching ephemeral observed fabric to obtain
 * Current (for managed runtimes, see observedManagedFabric). Otherwise every
 * recorded result is historical or stale and can never grant a permission. */
export function buildDeploymentEvidenceHistory(
  state: SelfHostedState,
  deploymentId: string,
  observation?: DeploymentRuntimeObservation,
  contextTokens?: number | null,
  backend?: Lm6Run["backend"],
  now = Date.now(),
): DeploymentEvidenceHistory {
  const fabric = reconcileLocalComputeFabric(state);
  const deployment = fabric.deployments.find(row => row.id === deploymentId);
  const identity = deployment ? deploymentIdentity(deployment) : null;
  const v1MatchesUniquely = (scope: {
    deploymentIdentity: string; hostId: string; runtimeId: string;
    artifactId: string; artifactDigest: string;
  }) => !!deployment && identity === scope.deploymentIdentity &&
    deployment.hostId === scope.hostId && deployment.runtimeId === scope.runtimeId &&
    deployment.artifactId === scope.artifactId &&
    fabric.artifacts.find(a => a.id === scope.artifactId)?.digest === scope.artifactDigest &&
    fabric.deployments.filter(d => deploymentIdentity(d) === identity).length === 1;

  const latestQualification = new Map<string, { at: number; index: number }>();
  (fabric.qualificationReceipts ?? []).forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || !("scope" in raw) ||
        !("capability" in raw) || !("verifiedAt" in raw) ||
        !raw.scope || typeof raw.scope !== "object" ||
        !("deploymentId" in raw.scope) || raw.scope.deploymentId !== deploymentId ||
        typeof raw.capability !== "string") return;
    const at = typeof raw.verifiedAt === "number" && Number.isSafeInteger(raw.verifiedAt)
      ? raw.verifiedAt : 0;
    const previous = latestQualification.get(raw.capability);
    if (!previous || at > previous.at || (at === previous.at && index > previous.index))
      latestQualification.set(raw.capability, { at, index });
  });

  const ordered: Array<{ row: DeploymentHistoryRow; position: number }> = [];
  (fabric.qualificationReceipts ?? []).forEach((raw, index) => {
    const v2 = deploymentQualificationEvidenceReceiptSchema.safeParse(raw);
    if (v2.success && v2.data.scope.deploymentId === deploymentId) {
      const receipt = v2.data;
      const latest = latestQualification.get(receipt.capability)?.index === index;
      const status: DeploymentHistoryStatus = !latest ? "Historical" :
        validCurrentQualification(fabric, deploymentId, receipt, observation, now)
          ? "Current" : "Stale";
      ordered.push({ position: index, row: {
        id: `lm2f-v2:${index}:${receipt.evidence.digest}`,
        source: "LM2F", capability: receipt.capability, at: receipt.verifiedAt,
        procedure: receipt.procedure, status,
        verdict: recordedVerdict(receipt.status),
        provenance: receipt.evidence.source, reference: receipt.evidence.reference,
        ...scopeFields(receipt.scope), backend: null, contextTokens: receipt.context.contextTokens ?? null,
        failure: null, receiptVersion: 2, expiresAt: receipt.expiresAt,
      } });
      return;
    }
    const v1 = deploymentQualificationReceiptSchema.safeParse(raw);
    if (!v1.success || !v1MatchesUniquely(v1.data.scope)) return;
    const receipt = v1.data;
    ordered.push({ position: index, row: {
      id: `lm2f-v1:${index}`,
      source: "LM2F", capability: receipt.capability, at: receipt.verifiedAt,
      procedure: null, status: "Historical", verdict: recordedVerdict(receipt.status),
      provenance: "legacy-v1", reference: null,
      ...scopeFields(receipt.scope), backend: null, contextTokens: null,
      failure: null, receiptVersion: 1, expiresAt: receipt.expiresAt,
    } });
  });

  const matchingRuns = (fabric.measurementRuns ?? []).flatMap((raw, index) => {
    const parsed = lm6RunSchema.safeParse(raw);
    return parsed.success && parsed.data.scope.deploymentId === deploymentId
      ? [{ run: parsed.data, index }] : [];
  });
  // Match the existing LM6 panel: the newest exact-current run wins, even if
  // another epoch/configuration wrote a newer historical run afterward.
  const newestFirst = [...matchingRuns]
    .sort((a, b) => b.run.endedAt - a.run.endedAt || b.index - a.index);
  const latestRun = newestFirst[0];
  const currentRun = backend === undefined || contextTokens === undefined ? undefined :
    newestFirst.find(({ run }) => isCurrentLm6Run(run, fabric, deploymentId,
      observation, contextTokens, backend, now));
  const coldSamples: DeploymentHistorySample[] = [];
  const warmSamples: DeploymentHistorySample[] = [];
  const measurementStart = (fabric.qualificationReceipts ?? []).length;
  matchingRuns.forEach(({ run, index }) => {
    const status: DeploymentHistoryStatus = currentRun?.index === index ? "Current" :
      latestRun?.index === index ? "Stale" : "Historical";
    run.attempts.forEach((attempt, attemptIndex) => {
      // Persisted future/opaque ledger edits may contain duplicate run UUIDs;
      // the storage position keeps display identities distinct without trust.
      const id = `lm6:${index}:${run.runId}:${attempt.attemptId}`;
      const verdict = attemptVerdict(attempt);
      const row: DeploymentHistoryRow = {
        id, source: "LM6", capability: attempt.workload,
        at: attempt.endedAt, procedure: run.procedure, status, verdict,
        provenance: attempt.timings.firstMeaningfulOutputMs.provenance,
        reference: attempt.requestId ?? attempt.nativeRequestId ?? run.runId,
        ...scopeFields(run.scope),
        backend: run.backend, contextTokens: run.configuredContextTokens,
        failure: attempt.failure,
        firstMeaningfulOutputMs: attempt.timings.firstMeaningfulOutputMs,
        terminalMs: attempt.timings.terminalMs,
        runId: run.runId, attemptId: attempt.attemptId, attemptResult: attempt.result,
        chatRequestId: attempt.requestId, nativeRequestId: attempt.nativeRequestId ?? null,
        // Old uncorrelated adherence failures do not prove disobedience.
        capabilityCheck: attempt.workload === "instruction-adherence" &&
          !attempt.requestId && attempt.capabilityCheck === "failed"
          ? "incomplete" : attempt.capabilityCheck,
      };
      ordered.push({ position: measurementStart + index * 3 + attemptIndex, row });
      if ((attempt.thermal === "cold" || attempt.thermal === "warm") &&
          attempt.outputObserved) {
        const metric = attempt.timings.firstMeaningfulOutputMs;
        const sample: DeploymentHistorySample = {
          rowId: id, runId: run.runId, at: attempt.endedAt, status, verdict,
          valueMs: metric.value, provenance: metric.provenance, source: metric.source,
        };
        (attempt.thermal === "cold" ? coldSamples : warmSamples).push(sample);
      }
    });
  });
  ordered.sort((a, b) => b.row.at - a.row.at || b.position - a.position);
  const oldestFirst = (a: DeploymentHistorySample, b: DeploymentHistorySample) =>
    a.at - b.at || a.rowId.localeCompare(b.rowId);
  coldSamples.sort(oldestFirst);
  warmSamples.sort(oldestFirst);
  return { rows: ordered.map(item => item.row), total: ordered.length, coldSamples, warmSamples };
}
