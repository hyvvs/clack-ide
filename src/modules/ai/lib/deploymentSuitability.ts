import {
  assessDeploymentAgentEligibility,
  assessDeploymentCapability,
} from "./deploymentQualificationPolicy";
import {
  type EvidenceValue,
  evidence,
  type HardwareProfile,
  unknown,
} from "./hardwareProfile";
import {
  type DeploymentRuntimeObservation,
  deploymentQualificationScope,
  type LocalComputeFabric,
} from "./localComputeFabric";
import type {
  ExecutionPlacement,
  ModelResourceProfile,
} from "./modelResourceProfile";

/** LM4–LM5 estimates are not runtime admission and NEVER grant LM2F tools. */
export type Workload =
  | "Chat"
  | "Coding"
  | "Native Tools"
  | "Structured Output"
  | "Long-Context Coding"
  | "Automatic Agent";
export const WORKLOADS: readonly Workload[] = [
  "Chat",
  "Coding",
  "Native Tools",
  "Structured Output",
  "Long-Context Coding",
  "Automatic Agent",
];
export type SuitabilityRating =
  | "Excellent"
  | "Good"
  | "Marginal"
  | "Poor"
  | "Unknown";
export type Confidence = "High" | "Medium" | "Low";
export type Fit = "Fits" | "Tight" | "Insufficient" | "Unknown";
export type LoadState =
  | "Observed Loaded"
  | "Likely Fits"
  | "At Risk"
  | "Cannot Fit"
  | "Unknown";
export type LimitingFactor =
  | "System RAM"
  | "GPU VRAM"
  | "Context"
  | "Backend"
  | "Qualification"
  | "Telemetry"
  | "Latency"
  | "Model Capability";
export type SuggestedChange = {
  code:
    | "reduce-context"
    | "reduce-concurrency"
    | "smaller-model"
    | "smaller-quantization"
    | "cpu-spill"
    | "gpu-resident"
    | "gpu-runtime"
    | "another-host"
    | "cpu-only"
    | "avoid-agent";
  text: string;
  requiresUserAction: true;
};

/** LM6-compatible optional performance input. Not populated from historical
 * notes, provider advertisements, logs or arbitrary model responses. */
export type ScopedMeasuredPerformance = {
  source: "clack-native-measured";
  deploymentId: string;
  runtimeId: string;
  runtimeEpoch: string;
  configurationRevision: number;
  observedAt: number;
  coldFirstOutputMs?: number;
  warmFirstOutputMs?: number;
  prefillTokensPerSecond?: number;
  generationTokensPerSecond?: number;
  peakRamBytes?: number;
  peakVramBytes?: number;
  reliabilityFraction?: number;
  sampleCount?: number;
};
export type ContextCapacity = {
  target: number;
  configured: boolean;
  estimatedKvBytes: EvidenceValue<number>;
  estimatedRamBytes: EvidenceValue<number>;
  estimatedVramBytes: EvidenceValue<number>;
  estimatedRamHeadroomBytes: EvidenceValue<number>;
  estimatedVramHeadroomBytes: EvidenceValue<number>;
  ramFit: Fit;
  vramFit: Fit;
  fit: Fit;
  /** The model exceeds a known total physical budget, model context limit, or
   * verified executable backend. Transiently low free RAM/VRAM is not this. */
  structuralLimit: boolean;
  limitingFactor: LimitingFactor;
  reasons: string[];
};
export type SuitabilityAssessment = {
  hostId: string;
  runtimeId: string;
  artifactId: string;
  deploymentId: string;
  workload: Workload;
  context: number;
  placement: ExecutionPlacement;
  canLoad: LoadState;
  resourceRating: SuitabilityRating;
  rating: SuitabilityRating;
  confidence: Confidence;
  confidenceReasons: string[];
  workloadAuthorized: boolean;
  qualificationState: string;
  capacity: ContextCapacity;
  measuredPerformance: ScopedMeasuredPerformance | null;
  reasons: string[];
  warnings: string[];
  limitingResources: LimitingFactor[];
  recommendations: SuggestedChange[];
};

const MiB = 1024 * 1024;
const gib = (value: number) => `${(value / 1024 ** 3).toFixed(2)} GiB`;
function validBytes(value: EvidenceValue<number>): number | null {
  return value.value !== null &&
    Number.isFinite(value.value) &&
    value.value >= 0
    ? value.value
    : null;
}
function bytesOrUnknown(
  value: number | null,
  source: string,
  assumptions: string[],
): EvidenceValue<number> {
  return value !== null &&
    Number.isFinite(value) &&
    value >= 0 &&
    Number.isSafeInteger(Math.ceil(value))
    ? evidence(
        Math.ceil(value),
        "bytes",
        "Estimated",
        source,
        null,
        assumptions,
      )
    : unknown("bytes", "Input memory/placement dimensions missing");
}
function headroom(value: number | null, source: string): EvidenceValue<number> {
  return value !== null &&
    Number.isFinite(value) &&
    Number.isSafeInteger(Math.floor(value))
    ? evidence(Math.floor(value), "bytes", "Estimated", source, null, [
        "Estimated demand subtracted from observed free memory; negative means shortfall",
      ])
    : unknown("bytes", "Available memory/demand unknown");
}
function budgetFit(need: number | null, available: number | null): Fit {
  if (need === null || available === null) return "Unknown";
  if (need > available) return "Insufficient";
  return need > Math.max(0, available - Math.max(512 * MiB, available * 0.2))
    ? "Tight"
    : "Fits";
}
function contextRequestedValid(target: number, profile: ModelResourceProfile) {
  return (
    Number.isSafeInteger(target) &&
    target > 0 &&
    (profile.declaredMaximumContext.value === null ||
      target <= profile.declaredMaximumContext.value)
  );
}
const ASSUMPTIONS = [
  "Weight memory 1.08× GGUF/on-disk bytes, not measured resident bytes",
  "Default fp16 KV estimate; actual KV precision/placement may differ",
  "Memory pressure includes estimated process and batch buffers",
  "Safety margin: max(512 MiB, 20% of currently available memory)",
];

/** Used both for actual configured context and hypothetical context tiers.
 * Nothing here changes an engine setting or a persisted deployment identity. */
export function estimateContextCapacity(
  hardware: HardwareProfile,
  resource: ModelResourceProfile,
  context: number,
): ContextCapacity {
  const reasons: string[] = [];
  const configured = resource.configuredContext.value === context;
  const placement = resource.executionPlacement.value;
  const weights = validBytes(resource.weightMemoryBytes);
  const runtime = validBytes(resource.runtimeOverheadBytes);
  const batch = validBytes(resource.batchOverheadBytes);
  const kvElements = validBytes(resource.kvBytesPerToken);
  const kvPrecision = validBytes(resource.kvPrecisionBytes);
  const concurrency = resource.concurrency.value;
  const validContext = contextRequestedValid(context, resource);
  const kv =
    validContext &&
    kvElements !== null &&
    kvPrecision !== null &&
    concurrency !== null &&
    Number.isSafeInteger(concurrency) &&
    concurrency > 0
      ? context * kvElements * kvPrecision * concurrency
      : null;
  const kvValue = bytesOrUnknown(
    kv,
    "gguf-kv-dimensions-and-assumed-cache-type",
    [
      "context tokens × derived K/V elements per token × assumed cache element bytes × concurrency",
      "Actual flash-attention/cache sharing and cache type may change consumption",
    ],
  );
  if (!configured)
    reasons.push(
      "Hypothetical context: changing context requires explicit user action and fresh qualification.",
    );
  if (
    resource.declaredMaximumContext.value !== null &&
    context > resource.declaredMaximumContext.value
  )
    reasons.push(
      "Context exceeds declared model maximum; no runtime configuration can fix that without different model support.",
    );
  if (kv === null)
    reasons.push(
      "KV cache cannot be sized from known tensor metadata/runtime precision/concurrency.",
    );
  let gpuFraction: number | null =
    placement === "CPU" ? 0 : placement === "GPU" ? 1 : null;
  if (placement === "Hybrid") {
    const gpuLayers = resource.gpuLayers.value;
    const layers = resource.totalLayers.value;
    if (gpuLayers !== null && layers !== null && layers > 0 && gpuLayers >= 0)
      gpuFraction = Math.min(gpuLayers / layers, 1);
    reasons.push(
      "Hybrid GPU/CPU transfer overhead and weight layer sizes are not measured; memory is fractionally approximated.",
    );
  }
  if (gpuFraction === null)
    reasons.push(
      "GPU offload allocation is unknown; GPU/CPU split cannot be certified.",
    );
  const cpuNeed =
    gpuFraction !== null &&
    weights !== null &&
    kv !== null &&
    runtime !== null &&
    batch !== null
      ? (weights + kv) * (1 - gpuFraction) + runtime + batch
      : null;
  // GPU buffers can be larger/different than CPU allocations. This modest
  // extra floor is an explicit conservative placeholder, not a GPU measurement.
  const gpuNeed =
    gpuFraction !== null && weights !== null && kv !== null
      ? gpuFraction === 0
        ? 0
        : (weights + kv) * gpuFraction + 128 * MiB
      : null;
  const availableRam = validBytes(hardware.memory.availableRamBytes);
  const totalRam = validBytes(hardware.memory.totalRamBytes);
  const freeVram = hardware.gpus
    .filter((g) => g.availableVramBytes.value !== null)
    .map((g) => g.availableVramBytes.value!);
  const vram =
    hardware.gpuInventoryComplete && hardware.gpus.length === 0
      ? 0
      : // Multi-device sums are unsupported unless offload device mapping is known.
        freeVram.length === 1
        ? freeVram[0]
        : null;
  const totalVram =
    hardware.gpus.length === 1
      ? validBytes(hardware.gpus[0].totalVramBytes)
      : null;
  const ramFit =
    cpuNeed !== null && totalRam !== null && cpuNeed > totalRam
      ? "Insufficient"
      : budgetFit(cpuNeed, availableRam);
  const vramFit: Fit =
    gpuFraction === 0
      ? "Fits"
      : gpuNeed !== null && totalVram !== null && gpuNeed > totalVram
        ? "Insufficient"
        : budgetFit(gpuNeed, vram);
  const backend =
    placement === "CPU"
      ? hardware.backends.cpu.installedRuntimeExecutes.value
      : placement === "GPU" || placement === "Hybrid"
        ? ["cuda", "rocm", "vulkan", "metal", "directml"].some(
            (name) =>
              hardware.backends[name as keyof HardwareProfile["backends"]]
                .installedRuntimeExecutes.value === true,
          )
        : null;
  if (backend === false)
    reasons.push(
      "Installed runtime cannot execute the requested backend; hardware support is not enough.",
    );
  if (backend === null)
    reasons.push("Installed runtime backend support is not verified.");
  if (availableRam === null)
    reasons.push(
      "Fresh available host RAM was not observed; memory fit is unknown.",
    );
  if (gpuFraction !== 0 && vram === null)
    reasons.push(
      "Usable GPU VRAM is unknown; display-adapter memory is not VRAM telemetry.",
    );
  const structuralLimit =
    !validContext ||
    backend === false ||
    (cpuNeed !== null && totalRam !== null && cpuNeed > totalRam) ||
    (gpuNeed !== null &&
      gpuFraction !== 0 &&
      totalVram !== null &&
      gpuNeed > totalVram);
  const fit: Fit =
    structuralLimit || ramFit === "Insufficient" || vramFit === "Insufficient"
      ? "Insufficient"
      : ramFit === "Unknown" || vramFit === "Unknown" || backend === null
        ? "Unknown"
        : ramFit === "Tight" || vramFit === "Tight"
          ? "Tight"
          : "Fits";
  const limitingFactor: LimitingFactor = !validContext
    ? "Context"
    : backend !== true
      ? "Backend"
      : ramFit === "Insufficient" || ramFit === "Tight"
        ? "System RAM"
        : vramFit === "Insufficient" || vramFit === "Tight"
          ? "GPU VRAM"
          : ramFit === "Unknown" || vramFit === "Unknown"
            ? "Telemetry"
            : "Model Capability";
  if (ramFit === "Tight")
    reasons.push("RAM headroom is narrow at the requested context.");
  if (vramFit === "Tight")
    reasons.push("VRAM headroom is narrow after KV cache and buffers.");
  return {
    target: context,
    configured,
    estimatedKvBytes: kvValue,
    estimatedRamBytes: bytesOrUnknown(
      cpuNeed,
      "weight-kv-runtime-batch-budget-v1",
      ASSUMPTIONS,
    ),
    estimatedVramBytes: bytesOrUnknown(
      gpuNeed,
      "offload-weight-kv-budget-v1",
      ASSUMPTIONS,
    ),
    estimatedRamHeadroomBytes: headroom(
      cpuNeed !== null && availableRam !== null ? availableRam - cpuNeed : null,
      "available-ram-minus-estimated-demand",
    ),
    estimatedVramHeadroomBytes:
      gpuFraction === 0
        ? evidence(
            0,
            "bytes",
            "Derived",
            "cpu-only-deployment-no-vram-allocation",
          )
        : headroom(
            gpuNeed !== null && vram !== null ? vram - gpuNeed : null,
            "available-vram-minus-estimated-demand",
          ),
    ramFit,
    vramFit,
    fit,
    structuralLimit,
    limitingFactor,
    reasons,
  };
}

/** Relative context tiers. No globally imposed 8K/32K or invented model max.
 * For configured 2K, a 32K native max produces 2K / 8K / 32K tiers. */
export function contextTargets(
  resource: ModelResourceProfile,
): { label: string; tokens: number }[] {
  const configured = resource.configuredContext.value;
  const maximum = resource.declaredMaximumContext.value;
  if (!configured && !maximum) return [];
  const base = configured ?? maximum!;
  const rows = [
    { label: "Small / configured", tokens: base },
    { label: "Medium (4×)", tokens: base * 4 },
    { label: "Large (16×)", tokens: base * 16 },
    ...(maximum
      ? [{ label: "Model maximum (declared)", tokens: maximum }]
      : []),
  ];
  const seen = new Set<number>();
  return rows.filter(
    (row) =>
      Number.isSafeInteger(row.tokens) &&
      row.tokens > 0 &&
      (!maximum || row.tokens <= maximum) &&
      !seen.has(row.tokens) &&
      !!seen.add(row.tokens),
  );
}

function scopeMatches(
  measured: ScopedMeasuredPerformance | null | undefined,
  resource: ModelResourceProfile,
  observation: DeploymentRuntimeObservation | undefined,
  now: number,
): measured is ScopedMeasuredPerformance {
  return (
    !!measured &&
    measured.source === "clack-native-measured" &&
    !!observation &&
    measured.deploymentId === resource.deploymentId &&
    measured.runtimeId === resource.runtimeId &&
    measured.runtimeEpoch === observation.epoch &&
    measured.configurationRevision === observation.configurationRevision &&
    measured.observedAt <= now &&
    now - measured.observedAt < 30 * 60_000 &&
    (measured.sampleCount ?? 0) > 0
  );
}

export function assessDeploymentSuitability(input: {
  fabric: LocalComputeFabric;
  hardware: HardwareProfile;
  resource: ModelResourceProfile;
  deploymentId: string;
  workload: Workload;
  context: number;
  observation?: DeploymentRuntimeObservation;
  /** Native Ready must have been independently checked against this exact
   * deployment, digest, process and epoch by the read-only status adapter.
   * A generic runtime observation is NOT proof that weights are resident. */
  observedLoaded?: boolean;
  measuredPerformance?: ScopedMeasuredPerformance | null;
  now?: number;
}): SuitabilityAssessment {
  const {
    fabric,
    hardware,
    resource,
    deploymentId,
    workload,
    context,
    observation,
  } = input;
  const now = input.now ?? Date.now();
  const deployment = fabric.deployments.find((d) => d.id === deploymentId);
  const runtime = fabric.runtimes.find((r) => r.id === deployment?.runtimeId);
  const artifact = fabric.artifacts.find(
    (a) => a.id === deployment?.artifactId,
  );
  const host = fabric.hosts.find((h) => h.id === deployment?.hostId);
  const validIdentity =
    !!deployment &&
    !!runtime &&
    !!artifact &&
    !!host &&
    deployment.hostId === hardware.hostId &&
    runtime.hostId === host.id &&
    hardware.location === host.location &&
    hardware.runtimeId === runtime.id &&
    deployment.runtimeId === resource.runtimeId &&
    deployment.artifactId === resource.artifactId &&
    resource.deploymentId === deploymentId &&
    deployment.configurationRevision === resource.configurationRevision &&
    deployment.configurationIdentity ===
      (resource.configurationIdentity ?? undefined) &&
    (artifact.digest ?? null) === resource.artifactDigest;
  const capacity = estimateContextCapacity(hardware, resource, context);
  const changedContext = !capacity.configured;
  const currentObservation =
    validIdentity &&
    !changedContext &&
    deploymentQualificationScope(fabric, deploymentId, observation, now)
      ? observation
      : undefined;
  const latest = (cap: Parameters<typeof assessDeploymentCapability>[2]) =>
    assessDeploymentCapability(
      fabric,
      deploymentId,
      cap,
      currentObservation,
      {},
      now,
    );
  const chat = validIdentity ? latest("chat") : null;
  const instruction = validIdentity ? latest("instruction-adherence") : null;
  const structured = validIdentity ? latest("json-schema") : null;
  const nativeTools = validIdentity ? latest("native-tools") : null;
  const agent = validIdentity
    ? assessDeploymentAgentEligibility(
        fabric,
        deploymentId,
        currentObservation,
        {},
        now,
      )
    : null;
  let qualificationState: string = chat?.state ?? "Unknown";
  let authorized = chat?.available ?? false;
  if (workload === "Structured Output") {
    qualificationState = structured?.state ?? "Unknown";
    authorized = structured?.available ?? false;
  } else if (workload === "Native Tools") {
    qualificationState = nativeTools?.state ?? "Unknown";
    authorized = nativeTools?.available ?? false;
  } else if (workload === "Automatic Agent") {
    qualificationState =
      agent?.eligible && instruction?.available
        ? "Qualified"
        : `Agent ${agent?.eligible ? "instruction-adherence" : "requirements"} unqualified`;
    authorized = !!agent?.eligible && !!instruction?.available;
  }
  const warnings: string[] = [];
  const reasons = [...capacity.reasons];
  const limitations: LimitingFactor[] = [];
  const recommendations: SuggestedChange[] = [];
  const add = (code: SuggestedChange["code"], text: string) => {
    if (!recommendations.some((row) => row.code === code))
      recommendations.push({ code, text, requiresUserAction: true });
  };
  const perf = scopeMatches(
    input.measuredPerformance,
    resource,
    currentObservation,
    now,
  )
    ? input.measuredPerformance!
    : null;
  let resourceRating: SuitabilityRating =
    capacity.fit === "Fits"
      ? "Good"
      : capacity.fit === "Tight"
        ? "Marginal"
        : capacity.fit === "Insufficient"
          ? "Poor"
          : "Unknown";
  if (!validIdentity) {
    resourceRating = "Unknown";
    warnings.push(
      "Host, runtime, artifact or deployment identity does not match; no authority or fit is transferable.",
    );
  }
  if (
    resource.executionPlacement.value === "Hybrid" &&
    resourceRating === "Good"
  )
    resourceRating = "Marginal";
  if (
    resource.executionPlacement.value === "CPU" &&
    (resource.weightMemoryBytes.value ?? 0) > 8 * 1024 ** 3 &&
    resourceRating === "Good"
  ) {
    resourceRating = "Marginal";
    warnings.push(
      "Large CPU-resident weights may load yet generate slowly; no throughput was measured.",
    );
    limitations.push("Latency");
    add(
      "gpu-runtime",
      "Consider a GPU-capable runtime only after verifying actual backend support and VRAM.",
    );
  }
  if (
    perf?.generationTokensPerSecond !== undefined &&
    perf.generationTokensPerSecond > 0
  ) {
    if (perf.generationTokensPerSecond < 5) {
      resourceRating = "Poor";
      warnings.push(
        "Current scoped measured generation speed is below 5 tokens/sec.",
      );
      limitations.push("Latency");
    } else if (
      resourceRating === "Good" &&
      perf.generationTokensPerSecond >= 30 &&
      (perf.reliabilityFraction ?? 0) >= 0.95 &&
      (perf.sampleCount ?? 0) >= 5
    )
      resourceRating = "Excellent";
  }
  if (capacity.fit === "Insufficient") {
    limitations.push(capacity.limitingFactor);
    if (
      capacity.limitingFactor === "Context" ||
      capacity.limitingFactor === "System RAM" ||
      capacity.limitingFactor === "GPU VRAM"
    ) {
      add(
        "reduce-context",
        "Consider a smaller context, then re-evaluate memory and requalify; do not change it automatically.",
      );
      add(
        "smaller-model",
        "Consider a smaller model or verified smaller quantization when current memory is insufficient.",
      );
      add(
        "another-host",
        "Consider another host with observed usable memory and supported backend.",
      );
    }
  } else if (capacity.fit === "Tight") {
    limitations.push(capacity.limitingFactor);
    add(
      "reduce-concurrency",
      "Reduce concurrency if configuration allows it, with an explicit user choice.",
    );
    add(
      "reduce-context",
      "A smaller context target may preserve memory headroom; it requires a new configuration.",
    );
  } else if (capacity.fit === "Unknown") limitations.push("Telemetry");
  if (resource.executionPlacement.value === "CPU")
    add(
      "cpu-only",
      "Keep the current CPU-only backend until a GPU-capable runtime and usable VRAM are independently verified.",
    );
  else if (
    resource.executionPlacement.value === "GPU" &&
    capacity.fit === "Fits"
  )
    add(
      "gpu-resident",
      "Keep the model fully GPU-resident if device placement and measured VRAM headroom are confirmed.",
    );
  else if (resource.executionPlacement.value === "Hybrid")
    add(
      "cpu-spill",
      "Partial CPU offload can permit loading, but cross-device transfers may reduce generation throughput.",
    );
  if (workload === "Long-Context Coding" && !changedContext && context < 16_384)
    warnings.push(
      "Current context is smaller than typical large coding projects; long-context utility not proven.",
    );
  if (!authorized) {
    limitations.push("Qualification");
    reasons.push(
      `${workload} execution qualification is ${qualificationState}; hardware fit does not authorize this workload.`,
    );
  }
  if (workload === "Automatic Agent") {
    if (instruction?.lastResult === "failed")
      warnings.push(
        "An instruction-adherence receipt previously failed; its current scope may be stale.",
      );
    reasons.push(
      "Automatic Agent requires current native tool, argument, result, sequential-effect AND instruction-adherence evidence.",
    );
    if (!authorized)
      add(
        "avoid-agent",
        "Do not run Automatic Agent until current exact-deployment reliability and tool qualifications pass.",
      );
  }
  if (
    workload === "Coding" ||
    workload === "Long-Context Coding" ||
    workload === "Automatic Agent"
  )
    warnings.push(
      "Compute-fit cannot predict coding accuracy, instruction quality or tool reliability.",
    );
  if (resource.quantization.value === null)
    warnings.push(
      "Quantization metadata is unknown; no filename-based size assumption was used.",
    );
  if (resource.parameterCount.value === null)
    warnings.push(
      "Exact parameter count is unknown; model capability is not inferred from its name.",
    );
  if (perf === null)
    warnings.push(
      "No current, exact-scope measured latency or throughput; performance rating is a heuristic only.",
    );
  if (changedContext)
    warnings.push(
      "A different context creates a different execution configuration; prior LM2F receipts cannot be reused.",
    );
  const confidenceReasons = [] as string[];
  const measuredRam =
    hardware.memory.availableRamBytes.provenance === "Measured";
  const identifiedWeights =
    resource.artifactSizeBytes.provenance === "Measured";
  const knownKv = capacity.estimatedKvBytes.value !== null;
  if (!measuredRam)
    confidenceReasons.push("No fresh measured host available RAM.");
  if (!identifiedWeights)
    confidenceReasons.push(
      "Artifact byte identity is missing or backend-reported rather than native-verified.",
    );
  if (!knownKv)
    confidenceReasons.push(
      "KV memory geometry/precision or concurrency is not known.",
    );
  if (!hardware.gpuInventoryComplete)
    confidenceReasons.push("GPU inventory/available VRAM is incomplete.");
  if (!perf)
    confidenceReasons.push("No exact-epoch measured performance samples.");
  // No high-confidence workload speed claims without actual measured timings.
  const confidence: Confidence =
    perf && measuredRam && identifiedWeights && knownKv
      ? "High"
      : measuredRam &&
          identifiedWeights &&
          knownKv &&
          resource.executionPlacement.value === "CPU"
        ? "Medium"
        : "Low";
  let rating = resourceRating;
  if (
    !authorized &&
    ["Native Tools", "Structured Output", "Automatic Agent"].includes(workload)
  ) {
    rating =
      qualificationState === "Unsupported" ||
      (nativeTools?.state === "Unsupported" && workload === "Automatic Agent")
        ? "Poor"
        : "Unknown";
  }
  if (!validIdentity) rating = "Unknown";
  // A native Ready/epoch is evidence of loading the *configured* context only,
  // never evidence of fast generation or hypothetical larger context.
  const canLoad: LoadState =
    validIdentity &&
    !changedContext &&
    currentObservation &&
    input.observedLoaded === true
      ? "Observed Loaded"
      : !validIdentity
        ? "Unknown"
        : capacity.fit === "Fits"
          ? "Likely Fits"
          : capacity.fit === "Tight"
            ? "At Risk"
            : capacity.fit === "Insufficient"
              ? capacity.structuralLimit
                ? "Cannot Fit"
                : "At Risk"
              : "Unknown";
  if (capacity.estimatedRamBytes.value !== null)
    reasons.push(
      `Estimated system RAM demand at ${context.toLocaleString()} tokens: ${gib(capacity.estimatedRamBytes.value)}; not measured allocation.`,
    );
  if (
    capacity.estimatedVramBytes.value !== null &&
    resource.executionPlacement.value !== "CPU"
  )
    reasons.push(
      `Estimated GPU allocation: ${gib(capacity.estimatedVramBytes.value)}; not measured VRAM.`,
    );
  return {
    hostId: hardware.hostId,
    runtimeId: resource.runtimeId,
    artifactId: resource.artifactId,
    deploymentId,
    workload,
    context,
    placement: resource.executionPlacement.value ?? "Unknown",
    canLoad,
    resourceRating,
    rating,
    confidence,
    confidenceReasons,
    workloadAuthorized: authorized && validIdentity,
    qualificationState,
    capacity,
    measuredPerformance: perf,
    reasons,
    warnings,
    limitingResources: [...new Set(limitations)],
    recommendations,
  };
}
