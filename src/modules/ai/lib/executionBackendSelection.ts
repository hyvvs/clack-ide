import {
  KNOWN_EXECUTION_BACKENDS,
  actualExecutionSchema,
  deploymentIdentity,
  executionPolicyIdentity,
  requestedExecutionSchema,
  type ActualExecution,
  type BackendState,
  type ComputeHost,
  type LocalRuntime,
  type ModelArtifact,
  type ModelDeployment,
  type RequestedExecution,
  type RuntimeBackendVariant,
} from "./localComputeFabric";
import {
  evaluateExecutionCandidates,
  type CandidateEvaluation,
  type OrchestrationPlacement,
} from "./runtimeOrchestrationPolicy";
export { evaluateExecutionCandidates } from "./runtimeOrchestrationPolicy";
export type {
  BackendCandidate,
  RuntimeOrchestrationPolicy,
} from "./runtimeOrchestrationPolicy";
import type { HardwareProfile } from "./hardwareProfile";
import {
  MANAGED_LLAMA_ENGINE_VERSION,
  MANAGED_LOCAL_RUNTIME_ID,
  MANAGED_LOCAL_RUNTIME_TYPE,
  managedLocalMaterialSchema,
} from "./managedLocalModels";
import type { ManagedCudaVariantStatus, ManagedLocalNativeStatus } from "./managedLocalRuntime";

const PINNED_MANIFEST = "pinned-b12248-cpu-runtime-manifest";
/** Official b12248 Windows x64 CPU ZIP pinned by the native build manifest
 * (`src-tauri/src/modules/managed_llama_cpu_b12248_manifest.rs` and build.rs).
 * This describes the allowed build; installed/usable status is checked apart. */
const PINNED_CPU_ARCHIVE_DIGEST =
  "sha256:bb306bfd390f8782c0acaba490505d12f07392791b48f1dd039387a5bacf1181";
const canonicalArchiveDigest = (value: string): string | undefined => {
  const hash = value.startsWith("sha256:") ? value.slice(7) : value;
  return /^[a-f0-9]{64}$/.test(hash) ? `sha256:${hash}` : undefined;
};
const pinned = (runtime: LocalRuntime) =>
  runtime.id === MANAGED_LOCAL_RUNTIME_ID &&
  runtime.type === MANAGED_LOCAL_RUNTIME_TYPE &&
  runtime.version === MANAGED_LLAMA_ENGINE_VERSION;

/** Runtime *build* support, not device detection or permission to run inference.
 * Native installed status is intentionally separate from build support. */
export function runtimeBackendVariants(
  runtime: LocalRuntime,
  installed?: Pick<ManagedLocalNativeStatus, "installed" | "version"> | null,
  cudaVariant?: Pick<ManagedCudaVariantStatus,"installed"|"version"|"engineArchiveSha256"> | null,
): RuntimeBackendVariant[] {
  if (!pinned(runtime)) return runtime.backendVariants ?? [];
  const installation: BackendState = !installed ? "UNKNOWN" :
    installed.version !== MANAGED_LLAMA_ENGINE_VERSION ? "INSTALLED_NOT_USABLE" :
      installed.installed ? "AVAILABLE" : "UNAVAILABLE";
  return KNOWN_EXECUTION_BACKENDS.map(backend => ({
    id: `${MANAGED_LLAMA_ENGINE_VERSION}/${backend}`,
    backend,
    support: backend === "cpu" || backend === "cuda" ? "AVAILABLE" : "UNSUPPORTED",
    installation: backend === "cpu" ? installation : backend === "cuda"
      ? (!cudaVariant ? "UNKNOWN" : cudaVariant.version !== MANAGED_LLAMA_ENGINE_VERSION
        ? "INSTALLED_NOT_USABLE" : cudaVariant.installed ? "AVAILABLE" : "UNAVAILABLE")
      : "UNAVAILABLE",
    runtimeVersion: MANAGED_LLAMA_ENGINE_VERSION,
    source: backend === "cuda" ? "official-b12248-windows-x64-cuda13.5-pinned-release-manifest" : PINNED_MANIFEST,
    trust: "VERIFIED",
    ...(backend === "cpu" || backend === "cuda" ? { supportedArtifactFormats: ["gguf" as const] } : {}),
    // Archive identities come from the pinned release manifest (CPU) and the
    // independently verified native CUDA installation. Neither is the exe SHA.
    ...(backend === "cpu" ? {buildDigest: PINNED_CPU_ARCHIVE_DIGEST} : {}),
    ...(backend === "cuda" && cudaVariant?.installed &&
      canonicalArchiveDigest(cudaVariant.engineArchiveSha256) ?
      {buildDigest: canonicalArchiveDigest(cudaVariant.engineArchiveSha256)} : {}),
    ...(backend !== "cpu" && backend !== "cuda" ? { limitations: ["No managed executable implementation for this backend"] } : {}),
  }));
}

/** Read a legacy managed v1 deployment without mutating its persisted identity.
 * Unknown transport configuration is never guessed as CPU or CUDA. */
export function deploymentRequestedExecution(
  deployment: ModelDeployment, runtime: LocalRuntime,
): RequestedExecution | null {
  if (deployment.requestedExecution)
    return requestedExecutionSchema.parse(deployment.requestedExecution);
  if (!pinned(runtime) || !deployment.configurationIdentity) return null;
  try {
    const legacy = managedLocalMaterialSchema.safeParse(JSON.parse(deployment.configurationIdentity));
    return legacy.success ? requestedExecutionSchema.parse({
      backend: "cpu", gpuLayers: legacy.data.gpu,
      contextLength: legacy.data.context, fallback: { policy: "disabled" },
    }) : null;
  } catch { return null; }
}

export type SelectedExecution = OrchestrationPlacement;
export type ExecutionSelection = CandidateEvaluation & {
  /** ONLY independently verified native launch evidence. A selected plan is not actual. */
  actual: ActualExecution | null;
};
export type BackendSelectionInput = {
  host: ComputeHost;
  runtime: LocalRuntime;
  deployment: ModelDeployment;
  artifact: ModelArtifact;
  hardware: HardwareProfile;
  installedRuntime?: Pick<ManagedLocalNativeStatus, "installed" | "version"> | null;
  cudaVariant?: Pick<ManagedCudaVariantStatus,"installed"|"version"|"engineArchiveSha256"> | null;
  requested?: RequestedExecution | null;
  /** Measured/verified capacity requirement; not a made-up memory estimate. */
  requiredHostBytes?: number;
  requiredDeviceBytes?: number;
  nativeExecution?: ManagedLocalNativeStatus | null;
  now?: number;
};

/** A native owner's exact Ready/epoch/variant observation, never a backend hint.
 * A stopped or mismatched native process has no actual execution. */
export function observedActualExecution(
  runtime: LocalRuntime, deployment: ModelDeployment,
  status?: ManagedLocalNativeStatus | null,
  now = Date.now(),
): ActualExecution | null {
  if (!status?.installed || status.state !== "Ready" ||
      status.version !== runtime.version || status.deploymentId !== deployment.id ||
      !status.epoch || !status.actualExecution) return null;
  const parsed = actualExecutionSchema.safeParse(status.actualExecution);
  if (!parsed.success || parsed.data.runtimeEpoch !== status.epoch ||
      parsed.data.observedAt > now || now - parsed.data.observedAt > 30_000) return null;
  const policy = deployment.requestedExecution?.candidates;
  if (policy) {
    const receipt = parsed.data.executionReceipt;
    const candidate = receipt && policy[receipt.selectedCandidateIndex];
    const requested = requestedExecutionSchema.safeParse(deployment.requestedExecution);
    const requestedGpuLayerCap = candidate?.gpuLayers ??
      (candidate?.backend === "cpu" ? 0 :
        receipt?.selectedCandidateIndex === 0 && requested.success
          ? requested.data.gpuLayers : undefined);
    if (!receipt || !candidate || !requested.success ||
        receipt.deploymentId !== deployment.id ||
        receipt.deploymentIdentity !== deploymentIdentity(deployment) ||
        receipt.policyIdentity !== executionPolicyIdentity(requested.data) ||
        !status.processId || receipt.processId !== status.processId ||
        parsed.data.contextLength !== requested.data.contextLength ||
        receipt.fallbackUsed !== (receipt.selectedCandidateIndex > 0) ||
        receipt.fallbackAuthorized !== (receipt.selectedCandidateIndex > 0) ||
        status.fallbackUsed !== receipt.fallbackUsed ||
        status.fallbackAuthorized !== receipt.fallbackAuthorized ||
        candidate.backend !== parsed.data.backend ||
        // A CUDA layer request is a cap, not evidence of how many blocks the
        // loaded GGUF actually has. Native reports the independently observed
        // offload count, which can be lower (e.g. 25/25 with a 40-layer cap).
        // CPU never offloads; unknown caps cannot authorize CUDA observation.
        (candidate.backend === "cuda"
          ? requestedGpuLayerCap === undefined || requestedGpuLayerCap < 1 ||
            parsed.data.gpuLayers < 1 || parsed.data.gpuLayers > requestedGpuLayerCap
          : requestedGpuLayerCap !== parsed.data.gpuLayers) ||
        (candidate.runtimeVariantId !== undefined &&
          candidate.runtimeVariantId !== parsed.data.runtimeVariantId) ||
        (candidate.runtimeBuildDigest !== undefined &&
          candidate.runtimeBuildDigest !== receipt.runtimeBuildDigest) ||
        (candidate.deviceIds.length > 0 &&
          JSON.stringify(candidate.deviceIds) !== JSON.stringify(parsed.data.deviceIds)) ||
        (requested.data.deviceStrategy?.kind === "multi") ||
        (requested.data.deviceStrategy?.splitStrategy &&
          requested.data.deviceStrategy.splitStrategy !== "none") ||
        parsed.data.deviceIds.length !== 1) return null;
    // Receipt memory fields are prelaunch AVAILABLE capacity snapshots;
    // native validates policy maxima against independent load estimates.
  } else if (parsed.data.executionReceipt) return null;
  // Currently only the verified CPU launcher has an owner-backed observation.
  if (!pinned(runtime) || parsed.data.backend !== (status.selectedBackend ?? "cpu")) return null;
  if (parsed.data.backend === "cuda") {
    if ((!policy && deployment.requestedExecution?.backend !== "cuda") ||
        parsed.data.gpuLayers < 1 || parsed.data.runtimeVariantId !== "b12248/cuda" ||
        parsed.data.source !== "native-verified-cuda-init-and-layer-offload" ||
        parsed.data.deviceIds.length !== 1 ||
        (!policy && parsed.data.deviceIds[0] !== deployment.requestedExecution?.deviceIds[0])) return null;
  } else if (parsed.data.backend === "cpu") {
    if (parsed.data.gpuLayers !== 0 || parsed.data.runtimeVariantId !== "b12248/cpu" ||
        parsed.data.source !== "native-verified-managed-cpu-launch" ||
        (deployment.requestedExecution?.backend === "cuda" &&
         (!status.fallbackUsed || !status.fallbackAuthorized))) return null;
  } else return null;
  return parsed.data;
}

/** Deterministic admission below the existing ComputeHost → LocalRuntime →
 * ModelArtifact → ModelDeployment authority. This decides a plan, NOT proof
 * that any model or backend was actually launched. */
export function selectDeploymentExecution(input: BackendSelectionInput): ExecutionSelection {
  const requested = input.requested === undefined
    ? deploymentRequestedExecution(input.deployment, input.runtime) : input.requested;
  // Persisted v3 policy is authoritative for managed launch. A renderer's
  // alternate request cannot silently switch trust, budget, or fallback order.
  if (input.deployment.requestedExecution?.candidates &&
      (!requested || !requestedExecutionSchema.safeParse(requested).success ||
        executionPolicyIdentity(requested) !== executionPolicyIdentity(input.deployment.requestedExecution)))
    return {policy:"persisted-candidates-v3",requested:requested ?? null,
      state:"rejected",selected:null,fallbackUsed:false,fallbackAuthorized:false,
      candidates:[],reasons:["Requested policy differs from persisted deployment identity"],
      actual:null};
  const plan = evaluateExecutionCandidates({
    ...input, requested: requested ?? null,
    variants: runtimeBackendVariants(input.runtime, input.installedRuntime, input.cudaVariant),
  });
  return {
    ...plan,
    actual: observedActualExecution(input.runtime, input.deployment, input.nativeExecution, input.now),
  };
}
