import {
  KNOWN_EXECUTION_BACKENDS,
  actualExecutionSchema,
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
    // b12248 CPU and CUDA releases may share a small llama-server executable
    // stub. CUDA *build* identity therefore anchors the separately pinned
    // CUDA engine archive, never the exe SHA as proof of backend provenance.
    ...(backend === "cuda" && cudaVariant?.installed ? {buildDigest: cudaVariant.engineArchiveSha256} : {}),
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
  // Currently only the verified CPU launcher has an owner-backed observation.
  if (!pinned(runtime) || parsed.data.backend !== (status.selectedBackend ?? "cpu")) return null;
  if (parsed.data.backend === "cuda") {
    if (deployment.requestedExecution?.backend !== "cuda" ||
        parsed.data.gpuLayers < 1 || parsed.data.runtimeVariantId !== "b12248/cuda" ||
        parsed.data.source !== "native-verified-cuda-init-and-layer-offload" ||
        parsed.data.deviceIds.length !== 1 ||
        parsed.data.deviceIds[0] !== deployment.requestedExecution.deviceIds[0]) return null;
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
  const plan = evaluateExecutionCandidates({
    ...input, requested: requested ?? null,
    variants: runtimeBackendVariants(input.runtime, input.installedRuntime, input.cudaVariant),
  });
  return {
    ...plan,
    actual: observedActualExecution(input.runtime, input.deployment, input.nativeExecution, input.now),
  };
}
