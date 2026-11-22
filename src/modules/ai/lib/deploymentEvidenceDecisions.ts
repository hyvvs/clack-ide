import { deploymentMeasurementPanel, type Lm6Run } from "./deploymentMeasurement";
import { observedActualExecution } from "./executionBackendSelection";
import { assessDeploymentAgentEligibility, assessDeploymentCapability, type CapabilityDecision } from "./deploymentQualificationPolicy";
import { observedManagedFabric } from "./deploymentQualificationView";
import {
  assessDeploymentSuitability,
  type SuitabilityAssessment, type SuitabilityRating, type Confidence,
  type ScopedMeasuredPerformance, type Workload,
} from "./deploymentSuitability";
import {
  projectHardwareProfile, unknown, type EvidenceValue,
  type NativeHardwareObservation,
} from "./hardwareProfile";
import {
  reconcileLocalComputeFabric, deploymentIdentity, deploymentQualificationEvidenceReceiptSchema,
  deploymentQualificationScope,
  type DeploymentRuntimeObservation, type LocalComputeFabric,
} from "./localComputeFabric";
import {
  MANAGED_LOCAL_HOST_ID, MANAGED_LOCAL_RUNTIME_TYPE,
  managedLocalSelectionId,
} from "./managedLocalModels";
import type { ManagedLocalNativeStatus } from "./managedLocalRuntime";
import { projectModelResourceProfile, type NativeGgufResource } from "./modelResourceProfile";
import type { SelfHostedState } from "./selfHostedProfiles";

/** LM8–LM10 are read-only explanations over the existing LM2F and LM6
 * authorities. No model reputation, model-name priority, networking, runtime
 * admission, settings writes or inferred metrics are used. */
export type EvidenceRecommendationCategory =
  | "Chat" | "Coding" | "Low latency" | "Long context"
  | "Structured Output" | "Native Tools" | "Automatic Agent"
  | "This PC" | "Connected hosts";

export const EVIDENCE_RECOMMENDATION_CATEGORIES: readonly EvidenceRecommendationCategory[] = [
  "Chat", "Coding", "Low latency", "Long context", "Structured Output",
  "Native Tools", "Automatic Agent", "This PC", "Connected hosts",
];

export type EvidenceCandidate = {
  deploymentId: string;
  deploymentIdentity: string;
  displayName: string;
  hostId: string;
  hostName: string;
  hostLocation: "local" | "remote" | "unknown";
  runtimeId: string;
  runtimeName: string;
  runtimeVersion: string | null;
  artifactDigest: string | null;
  artifactFormat: string;
  quantization: string | null;
  configurationIdentity: string | null;
  contextTokens: number | null;
  backend: "CPU" | "GPU" | "Hybrid" | "Unknown";
  /** Backend/offload are measured only after a native-v3 execution receipt;
   * legacy v1 CPU placement remains a distinct derived configuration fact. */
  backendEvidence?: EvidenceValue<"CPU" | "GPU" | "Hybrid" | "Unknown">;
  requestedGpuLayers?: EvidenceValue<number>;
  gpuLayers?: EvidenceValue<number>;
  observedBackend?: "cpu" | "cuda" | null;
  observedRuntimeVariantId?: string | null;
  ready: boolean;
  readiness: "Ready" | "Stopped" | "Unverified";
  observation: DeploymentRuntimeObservation | undefined;
  confidence: Confidence;
  hardwareFit: SuitabilityRating;
  fit: "Fits" | "Tight" | "Insufficient" | "Unknown";
  limitingFactor: string;
  estimatedRamBytes: EvidenceValue<number>;
  estimatedVramBytes: EvidenceValue<number>;
  qualification: {
    chat: CapabilityDecision;
    instruction: CapabilityDecision;
    structured: CapabilityDecision;
    nativeTools: CapabilityDecision;
    cancellation: CapabilityDecision;
    streaming: CapabilityDecision;
    terminal: CapabilityDecision;
    agent: ReturnType<typeof assessDeploymentAgentEligibility>;
  };
  workloadAssessments: Partial<Record<Workload, SuitabilityAssessment>>;
  coldFirstOutput: EvidenceValue<number>;
  warmFirstOutput: EvidenceValue<number>;
  terminalLatency: EvidenceValue<number>;
  generationThroughput: EvidenceValue<number>;
  currentRun: Lm6Run | null;
  historyRunCount: number;
  measuredChatSamples: number;
  normalChatReliability: number | null;
  evidenceReferences: string[];
};

export type EvidenceCatalogOptions = {
  now?: number;
  managedStatus?: ManagedLocalNativeStatus | null;
  managedObservedAt?: number | null;
  localHardware?: NativeHardwareObservation | null;
  localMetadata?: NativeGgufResource | null;
};

function validTime(at: number | null | undefined, now: number): boolean {
  return at !== null && at !== undefined && Number.isSafeInteger(at) &&
    at <= now && now - at < 30_000;
}

function runtimeScopeReceiptReferences(
  fabric: LocalComputeFabric, deploymentId: string,
  observation: DeploymentRuntimeObservation | undefined, now: number,
): string[] {
  const current = deploymentQualificationScope(fabric, deploymentId, observation, now);
  if (!current) return [];
  const out: string[] = [];
  for (const raw of fabric.qualificationReceipts ?? []) {
    const parsed = deploymentQualificationEvidenceReceiptSchema.safeParse(raw);
    if (parsed.success && parsed.data.scope.deploymentId === deploymentId &&
        parsed.data.status === "verified" && parsed.data.verifiedAt <= now &&
        parsed.data.expiresAt > now &&
        JSON.stringify(parsed.data.scope) === JSON.stringify({ ...current, deploymentId }) &&
        assessDeploymentCapability(fabric, deploymentId,
          parsed.data.capability, observation, parsed.data.context, now).available)
      out.push(parsed.data.evidence.reference);
  }
  return [...new Set(out)].slice(-24);
}

function currentMeasuredPerformance(
  panel: ReturnType<typeof deploymentMeasurementPanel>,
  resource: ReturnType<typeof projectModelResourceProfile>,
  observation: DeploymentRuntimeObservation | undefined,
): ScopedMeasuredPerformance | null {
  if (!panel.current || !observation) return null;
  const complete = panel.current.attempts.filter(a => a.result === "passed" &&
    a.terminalObserved && !!a.requestId && a.workload === "chat");
  if (!complete.length) return null;
  const speed = complete.find(a => a.usage.generationTokensPerSecond.value !== null);
  return {
    source: "clack-native-measured", deploymentId: resource.deploymentId,
    runtimeId: resource.runtimeId, runtimeEpoch: observation.epoch,
    configurationRevision: observation.configurationRevision,
    artifactDigest: resource.artifactDigest,
    configuredContext: resource.configuredContext.value,
    placement: resource.executionPlacement.value,
    observedAt: panel.current.endedAt, sampleCount: complete.length,
    reliabilityFraction: panel.current.reliability.completionFraction,
    ...(panel.coldFirstOutput.value !== null
      ? { coldFirstOutputMs: panel.coldFirstOutput.value } : {}),
    ...(panel.warmFirstOutput.value !== null
      ? { warmFirstOutputMs: panel.warmFirstOutput.value } : {}),
    ...(speed?.usage.generationTokensPerSecond.value !== null && speed
      ? { generationTokensPerSecond: speed.usage.generationTokensPerSecond.value! } : {}),
  };
}

/** Reconstruct every candidate by *ModelDeployment ID*. The only native
 * readings accepted are explicitly supplied, recently checked observations
 * of this PC; remote Ollama reachability never becomes a trusted epoch. */
export function buildDeploymentEvidenceCatalog(
  state: SelfHostedState, options: EvidenceCatalogOptions = {},
): EvidenceCandidate[] {
  const now = options.now ?? Date.now();
  const base = reconcileLocalComputeFabric(state);
  return base.deployments.slice(0, 2048).flatMap(deployment => {
    if (base.deployments.filter(d => d.id === deployment.id).length !== 1) return [];
    const host = base.hosts.find(h => h.id === deployment.hostId);
    const runtime = base.runtimes.find(r => r.id === deployment.runtimeId);
    const artifact = base.artifacts.find(a => a.id === deployment.artifactId);
    if (!host || !runtime || !artifact || runtime.hostId !== host.id ||
        !host.enabled || !runtime.enabled) return [];
    const managed = runtime.type === MANAGED_LOCAL_RUNTIME_TYPE &&
      host.id === MANAGED_LOCAL_HOST_ID && host.location === "local";
    let projected = base;
    let observation: DeploymentRuntimeObservation | undefined;
    let ready = false;
    const isV3 = !!deployment.requestedExecution?.candidates;
    let verifiedActual: ReturnType<typeof observedActualExecution> = null;
    if (managed) {
      const recentStatus = validTime(options.managedObservedAt, now)
        ? options.managedStatus ?? null : null;
      const observed = observedManagedFabric(state, managedLocalSelectionId(deployment),
        recentStatus, now);
      if (!observed || observed.deploymentId !== deployment.id) return [];
      projected = observed.fabric;
      observation = observed.observation;
      if (isV3) {
        // A native Ready/PID hint is not an observed backend or authorized
        // qualification scope for v3 until the *same* exact policy/deployment
        // has a fresh, receipt-fenced native execution observation.
        verifiedActual = observation ?
          observedActualExecution(runtime, deployment, recentStatus, now) : null;
        if (!verifiedActual || recentStatus?.modelDigest !== artifact.digest)
          observation = undefined;
      }
      ready = !!observation;
    }
    // Remote runtime identity is unknown in this release. In particular an
    // Ollama /api/version epoch generated by Clack is NOT model residency.
    const resource = projectModelResourceProfile(artifact, runtime, deployment,
      managed ? options.localMetadata : null, verifiedActual);
    const backend = resource.executionPlacement.value ?? "Unknown";
    const hardware = projectHardwareProfile(host, runtime,
      managed ? options.localHardware : null, now);
    const panel = deploymentMeasurementPanel(
      { ...state, fabric: projected }, deployment.id, observation,
      resource.configuredContext.value, backend, now);
    const perf = currentMeasuredPerformance(panel, resource, observation);
    const capabilities = (name: Parameters<typeof assessDeploymentCapability>[2]) =>
      assessDeploymentCapability(projected, deployment.id, name, observation, {}, now);
    const qualification = {
      chat: capabilities("chat"), instruction: capabilities("instruction-adherence"),
      structured: capabilities("json-schema"), nativeTools: capabilities("native-tools"),
      cancellation: capabilities("cancellation"), streaming: capabilities("streaming"),
      terminal: capabilities("terminal-completion"),
      agent: assessDeploymentAgentEligibility(projected, deployment.id, observation, {}, now),
    };
    const allWorkloads: Workload[] = ["Chat", "Coding", "Native Tools", "Structured Output",
      "Long-Context Coding", "Automatic Agent"];
    const workloadAssessments: EvidenceCandidate["workloadAssessments"] = {};
    if (resource.configuredContext.value !== null) {
      for (const workload of allWorkloads) {
        try {
          workloadAssessments[workload] = assessDeploymentSuitability({
            fabric: projected, hardware, resource, deploymentId: deployment.id,
            workload, context: resource.configuredContext.value,
            observation, observedLoaded: ready, measuredPerformance: perf, now,
          });
        } catch { /* Invalid resource geometry cannot become a recommendation. */ }
      }
    }
    const chatAssessment = workloadAssessments.Chat;
    const completed = panel.current?.attempts.filter(a =>
      a.workload === "chat" && a.result === "passed" && a.terminalObserved &&
      !!a.requestId) ?? [];
    const normalAttempts = panel.current?.attempts.filter(a => a.workload === "chat") ?? [];
    const terminal = completed.find(a => a.timings.terminalMs.value !== null);
    const references = [
      ...runtimeScopeReceiptReferences(projected, deployment.id, observation, now),
      ...(panel.current ? [panel.current.runId] : []),
    ];
    return [{
      deploymentId: deployment.id, deploymentIdentity: deploymentIdentity(deployment),
      displayName: artifact.displayName, hostId: host.id, hostName: host.displayName,
      hostLocation: host.location, runtimeId: runtime.id, runtimeName: runtime.displayName,
      runtimeVersion: runtime.version ?? null, artifactDigest: artifact.digest ?? null,
      artifactFormat: artifact.format, quantization: artifact.quantization ?? null,
      configurationIdentity: deployment.configurationIdentity ?? null,
      contextTokens: resource.configuredContext.value, backend,
      backendEvidence: resource.executionPlacement,
      requestedGpuLayers: resource.requestedGpuLayers, gpuLayers: resource.gpuLayers,
      observedBackend: verifiedActual?.backend === "cpu" || verifiedActual?.backend === "cuda"
        ? verifiedActual.backend : null,
      observedRuntimeVariantId: verifiedActual?.runtimeVariantId ?? null,
      ready, readiness: ready ? "Ready" : managed && options.managedStatus?.state === "Stopped"
        ? "Stopped" : "Unverified",
      observation, confidence: chatAssessment?.confidence ?? "Low",
      hardwareFit: chatAssessment?.resourceRating ?? "Unknown",
      fit: chatAssessment?.capacity.fit ?? "Unknown",
      limitingFactor: chatAssessment?.capacity.limitingFactor ?? "Telemetry",
      estimatedRamBytes: chatAssessment?.capacity.estimatedRamBytes ??
        unknown("bytes", "No verified model/resource fit"),
      estimatedVramBytes: chatAssessment?.capacity.estimatedVramBytes ??
        unknown("bytes", "No verified model/resource fit"),
      qualification, workloadAssessments,
      coldFirstOutput: panel.coldFirstOutput, warmFirstOutput: panel.warmFirstOutput,
      terminalLatency: terminal?.timings.terminalMs ?? unknown("ms", "No current completed native terminal"),
      generationThroughput: panel.generation,
      currentRun: panel.current, historyRunCount: panel.history.length,
      measuredChatSamples: completed.length,
      normalChatReliability: normalAttempts.length
        ? completed.length / normalAttempts.length : null,
      evidenceReferences: [...new Set(references)].slice(-32),
    } satisfies EvidenceCandidate];
  }).sort((a, b) => a.deploymentId.localeCompare(b.deploymentId));
}

export type EvidenceComparisonField = {
  label: string;
  left: string;
  right: string;
  provenance?: { left: string; right: string };
};

export type EvidenceComparison = {
  leftId: string;
  rightId: string;
  fields: EvidenceComparisonField[];
  warnings: string[];
  comparableTiming: boolean;
};

function metricLabel(row: EvidenceValue<number>): string {
  return row.value === null ? "Unknown" : row.unit === "ms"
    ? `${row.value.toFixed(0)} ms` : row.unit === "tokens/s"
      ? `${row.value.toFixed(2)} tokens/s` : `${Math.round(row.value)} ${row.unit}`;
}

export function comparisonTimingCompatible(a: EvidenceCandidate, b: EvidenceCandidate): boolean {
  return !!a.currentRun && !!b.currentRun && a.ready && b.ready &&
    a.hostId === b.hostId && a.runtimeId === b.runtimeId &&
    a.runtimeVersion === b.runtimeVersion && a.backend === b.backend &&
    a.contextTokens === b.contextTokens &&
    a.currentRun.procedure.id === b.currentRun.procedure.id &&
    a.currentRun.procedure.version === b.currentRun.procedure.version &&
    a.warmFirstOutput.provenance === "Measured" &&
    b.warmFirstOutput.provenance === "Measured" &&
    a.currentRun.attempts.some(x => x.workload === "chat" && x.result === "passed") &&
    b.currentRun.attempts.some(x => x.workload === "chat" && x.result === "passed");
}

/** Numeric timings are visible side by side but never interpreted as fair
 * cross-hardware or cross-procedure speed superiority. */
export function compareDeploymentEvidence(
  a: EvidenceCandidate, b: EvidenceCandidate,
): EvidenceComparison {
  const warnings: string[] = [];
  if (a.hostId !== b.hostId) warnings.push("Different hosts or hardware; timings are not directly comparable.");
  if (a.runtimeId !== b.runtimeId || a.runtimeVersion !== b.runtimeVersion)
    warnings.push("Different runtime identity/version; backend performance may not transfer.");
  if (a.backend !== b.backend) warnings.push("Different execution backends.");
  if (a.contextTokens !== b.contextTokens)
    warnings.push("Configured context differs; memory demand and latency are not directly comparable.");
  if (!a.currentRun || !b.currentRun)
    warnings.push("At least one measurement is historical/stale or unavailable.");
  else if (a.currentRun.procedure.id !== b.currentRun.procedure.id ||
      a.currentRun.procedure.version !== b.currentRun.procedure.version)
    warnings.push("Measurement procedure revision differs.");
  if (a.warmFirstOutput.provenance !== b.warmFirstOutput.provenance)
    warnings.push("Timing provenance differs; Measured is not equivalent to Estimated or Unknown.");
  const comparableTiming = comparisonTimingCompatible(a, b);
  if (!comparableTiming && !warnings.length)
    warnings.push("No pair of current like-for-like measured warm Chat observations.");
  const fields: EvidenceComparisonField[] = [
    { label: "Host", left: a.hostName, right: b.hostName },
    { label: "Runtime", left: `${a.runtimeName} ${a.runtimeVersion ?? "Unknown"}`,
      right: `${b.runtimeName} ${b.runtimeVersion ?? "Unknown"}` },
    { label: "Backend", left: a.backend, right: b.backend },
    { label: "Artifact digest", left: a.artifactDigest ?? "Unknown", right: b.artifactDigest ?? "Unknown" },
    { label: "Quantization", left: a.quantization ?? "Unknown", right: b.quantization ?? "Unknown" },
    { label: "Configured context", left: a.contextTokens?.toLocaleString() ?? "Unknown",
      right: b.contextTokens?.toLocaleString() ?? "Unknown" },
    { label: "Readiness", left: a.readiness, right: b.readiness },
    { label: "Hardware fit", left: a.hardwareFit, right: b.hardwareFit },
    { label: "Estimated RAM demand", left: metricLabel(a.estimatedRamBytes),
      right: metricLabel(b.estimatedRamBytes), provenance: {
        left: a.estimatedRamBytes.provenance, right: b.estimatedRamBytes.provenance,
      } },
    { label: "Cold first output", left: metricLabel(a.coldFirstOutput),
      right: metricLabel(b.coldFirstOutput), provenance: {
        left: a.coldFirstOutput.provenance, right: b.coldFirstOutput.provenance,
      } },
    { label: "Warm first output", left: metricLabel(a.warmFirstOutput),
      right: metricLabel(b.warmFirstOutput), provenance: {
        left: a.warmFirstOutput.provenance, right: b.warmFirstOutput.provenance,
      } },
    { label: "Native completion", left: metricLabel(a.terminalLatency),
      right: metricLabel(b.terminalLatency), provenance: {
        left: a.terminalLatency.provenance, right: b.terminalLatency.provenance,
      } },
    { label: "Generation throughput", left: metricLabel(a.generationThroughput),
      right: metricLabel(b.generationThroughput), provenance: {
        left: a.generationThroughput.provenance, right: b.generationThroughput.provenance,
      } },
    { label: "Normal Chat reliability", left: a.normalChatReliability === null ? "Unknown" :
      `${Math.round(a.normalChatReliability * 100)}% (${a.measuredChatSamples} completed)`,
      right: b.normalChatReliability === null ? "Unknown" :
      `${Math.round(b.normalChatReliability * 100)}% (${b.measuredChatSamples} completed)` },
    { label: "Instruction adherence", left: a.qualification.instruction.state,
      right: b.qualification.instruction.state },
    { label: "Structured output", left: a.qualification.structured.state,
      right: b.qualification.structured.state },
    { label: "Native tools", left: a.qualification.nativeTools.state,
      right: b.qualification.nativeTools.state },
    { label: "Agent", left: a.qualification.agent.eligible ? "Qualified" : "Unavailable",
      right: b.qualification.agent.eligible ? "Qualified" : "Unavailable" },
    { label: "Confidence", left: a.confidence, right: b.confidence },
    { label: "Evidence runs", left: String(a.historyRunCount), right: String(b.historyRunCount) },
  ];
  return { leftId: a.deploymentId, rightId: b.deploymentId,
    fields, warnings, comparableTiming };
}

const confidenceRank: Record<Confidence, number> = { High: 3, Medium: 2, Low: 1 };
const ratingRank: Record<SuitabilityRating, number> = {
  Excellent: 4, Good: 3, Marginal: 2, Poor: 1, Unknown: 0,
};
const fitRank: Record<EvidenceCandidate["fit"], number> = {
  Fits: 3, Tight: 2, Unknown: 1, Insufficient: 0,
};

export type EvidenceRecommendation = {
  category: EvidenceRecommendationCategory;
  deploymentId: string | null;
  deploymentName: string | null;
  confidence: Confidence | "None";
  reasons: string[];
  limitingFactors: string[];
  evidenceReferences: string[];
  alternatives: { deploymentId: string; deploymentName: string }[];
};

function capabilityGate(c: EvidenceCandidate, category: EvidenceRecommendationCategory): boolean {
  if (!c.ready || !c.qualification.chat.available) return false;
  const assessed = c.workloadAssessments[
    category === "Coding" ? "Coding" :
    category === "Long context" ? "Long-Context Coding" :
    category === "Structured Output" ? "Structured Output" :
    category === "Native Tools" ? "Native Tools" :
    category === "Automatic Agent" ? "Automatic Agent" : "Chat"
  ];
  if (!assessed || assessed.capacity.fit === "Insufficient" || assessed.resourceRating === "Poor")
    return false;
  switch (category) {
    case "Coding": return c.qualification.instruction.available;
    case "Low latency": return !!c.currentRun && c.warmFirstOutput.value !== null &&
      c.warmFirstOutput.provenance === "Measured" && c.measuredChatSamples > 0 &&
      c.currentRun.attempts.some(a => a.workload === "chat" &&
        a.result === "passed" && a.terminalObserved);
    case "Long context": return c.contextTokens !== null && c.contextTokens >= 8192 &&
      c.qualification.instruction.available;
    case "Structured Output": return c.qualification.structured.available;
    case "Native Tools": return c.qualification.nativeTools.available;
    case "Automatic Agent": return c.qualification.agent.eligible &&
      c.qualification.instruction.available;
    case "This PC": return c.hostLocation === "local";
    case "Connected hosts": return c.hostLocation !== "unknown";
    default: return true;
  }
}

/** All categories use mandatory CURRENT capability gates; no "least bad"
 * choice for absent Agent/tools/Chat proof. Numeric speed is compared only
 * among matching host/runtime/backend/context/procedure scopes. */
export function recommendDeployment(
  candidates: readonly EvidenceCandidate[], category: EvidenceRecommendationCategory,
): EvidenceRecommendation {
  const valid = candidates.filter(c => capabilityGate(c, category));
  if (!valid.length) return {
    category, deploymentId: null, deploymentName: null, confidence: "None",
    reasons: ["No currently qualified deployment for this workload and scope."],
    limitingFactors: ["Current mandatory capability or runtime proof unavailable"],
    evidenceReferences: [], alternatives: [],
  };
  if (category === "Low latency" &&
      valid.some(a => valid.some(b => a !== b && !comparisonTimingCompatible(a, b)))) {
    return { category, deploymentId: null, deploymentName: null, confidence: "None",
      reasons: ["No defensible cross-deployment speed winner: measured scopes are not comparable."],
      limitingFactors: ["Host, backend, context, procedure or provenance differs"],
      evidenceReferences: [], alternatives: valid.map(c => ({ deploymentId: c.deploymentId,
        deploymentName: c.displayName })).sort((a, b) => a.deploymentId.localeCompare(b.deploymentId)),
    };
  }
  // Stable total ordering: current-only candidates, evidence provenance,
  // confidence, suitability, then comparable speed, reliability, fit, ID.
  const ranked = [...valid].sort((a, b) => {
    const measured = (c: EvidenceCandidate) => c.measuredChatSamples > 0 ? 1 : 0;
    const compare = (x: number, y: number) => y - x;
    for (const [x, y] of [
      [measured(a), measured(b)],
      [confidenceRank[a.confidence], confidenceRank[b.confidence]],
      [ratingRank[a.hardwareFit], ratingRank[b.hardwareFit]],
      [fitRank[a.fit], fitRank[b.fit]],
    ]) {
      if (x !== y) return compare(x, y);
    }
    if (comparisonTimingCompatible(a, b) &&
        a.warmFirstOutput.value !== null && b.warmFirstOutput.value !== null &&
        a.warmFirstOutput.value !== b.warmFirstOutput.value)
      return a.warmFirstOutput.value - b.warmFirstOutput.value;
    const reliability = (c: EvidenceCandidate) => c.normalChatReliability ?? -1;
    if (reliability(a) !== reliability(b)) return compare(reliability(a), reliability(b));
    return a.deploymentId.localeCompare(b.deploymentId);
  });
  const winner = ranked[0];
  const reasons = [
    "Current LM2F Chat capability proof for the exact deployment and runtime scope.",
    `${winner.hardwareFit} hardware/resource fit; ${winner.confidence.toLowerCase()} evidence confidence.`,
    ...(winner.warmFirstOutput.value !== null
      ? [`Warm first output ${metricLabel(winner.warmFirstOutput)} · ${winner.warmFirstOutput.provenance} (${winner.measuredChatSamples} completed Chat sample${winner.measuredChatSamples === 1 ? "" : "s"}).`]
      : ["Current warm timing Unknown; no estimate substituted."]),
    ...(category === "Coding" || category === "Long context" || category === "Automatic Agent"
      ? ["Current independent instruction-adherence qualification required."] : []),
    ...(category === "Native Tools" ? ["Current native-tool protocol qualification required."] : []),
    ...(category === "Structured Output" ? ["Current structured-output protocol qualification required."] : []),
    ...(category === "Automatic Agent" ? ["All five Agent tool/effect gates required."] : []),
  ];
  return {
    category, deploymentId: winner.deploymentId, deploymentName: winner.displayName,
    confidence: winner.confidence, reasons,
    limitingFactors: [winner.limitingFactor,
      ...(winner.qualification.instruction.available ? [] :
        [`Instruction adherence: ${winner.qualification.instruction.state}`]),
      ...(winner.qualification.nativeTools.available ? [] :
        [`Native tools: ${winner.qualification.nativeTools.state}`]),
      ...(winner.qualification.agent.eligible ? [] : ["Automatic Agent unavailable"]),
    ],
    evidenceReferences: winner.evidenceReferences,
    alternatives: ranked.slice(1, 5).map(c => ({ deploymentId: c.deploymentId,
      deploymentName: c.displayName })),
  };
}

export function recommendAllDeployments(candidates: readonly EvidenceCandidate[]) {
  return EVIDENCE_RECOMMENDATION_CATEGORIES.map(category =>
    recommendDeployment(candidates, category));
}
