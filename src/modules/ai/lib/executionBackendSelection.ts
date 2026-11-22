import {
  KNOWN_EXECUTION_BACKENDS,
  actualExecutionSchema,
  requestedExecutionSchema,
  type ActualExecution,
  type BackendState,
  type ComputeDevice,
  type ComputeHost,
  type LocalRuntime,
  type ModelArtifact,
  type ModelDeployment,
  type RequestedExecution,
  type RuntimeBackendVariant,
} from "./localComputeFabric";
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

export type SelectedExecution = {
  backend: string;
  deviceIds: string[];
  gpuLayers: number;
  runtimeVariantId: string;
};
export type ExecutionSelection = {
  state: "selected" | "fallback" | "rejected";
  requested: RequestedExecution | null;
  selected: SelectedExecution | null;
  fallbackUsed: boolean;
  fallbackAuthorized: boolean;
  reasons: string[];
  /** This is ONLY populated by independently verified native launch evidence. */
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
  const {host, runtime, deployment, hardware, artifact} = input;
  const requested = input.requested === undefined
    ? deploymentRequestedExecution(deployment, runtime) : input.requested;
  const actual = observedActualExecution(runtime, deployment, input.nativeExecution, input.now);
  const reject = (reasons: string[]): ExecutionSelection => ({
    state: "rejected", requested: requested ?? null, selected: null,
    fallbackUsed: false, fallbackAuthorized: false, reasons, actual,
  });
  if (!requested) return reject(["No canonical backend request or recognized legacy configuration"]);
  if (runtime.id !== deployment.runtimeId || hardware.runtimeId !== runtime.id ||
      hardware.hostId !== deployment.hostId || runtime.hostId !== deployment.hostId ||
      host.id !== deployment.hostId || !host.runtimeIds.includes(runtime.id))
    return reject(["Compute Fabric host/runtime/deployment identity mismatch"]);
  if (!host.enabled || !runtime.enabled)
    return reject(["Host or runtime is disabled; no backend admission permitted"]);
  if (artifact.id !== deployment.artifactId)
    return reject(["Compute Fabric artifact/deployment identity mismatch"]);
  if (requested.contextLength !== undefined && artifact.declaredContext !== undefined &&
      requested.contextLength > artifact.declaredContext)
    return reject(["Requested context exceeds model-declared context limit"]);
  const variants = runtimeBackendVariants(runtime, input.installedRuntime, input.cudaVariant);
  const evaluate = (backend: string): { selected: SelectedExecution | null; reason: string } => {
    const support = variants.find(v => v.backend === backend);
    if (!support) return {selected: null, reason: `${backend}: runtime backend support UNKNOWN`};
    if (support.support !== "AVAILABLE")
      return {selected: null, reason: `${backend}: runtime build support ${support.support}`};
    if (support.installation !== "AVAILABLE")
      return {selected: null, reason: `${backend}: runtime installation ${support.installation}`};
    if (support.trust !== "VERIFIED")
      return {selected: null, reason: `${backend}: runtime build trust ${support.trust}`};
    if (!support.supportedArtifactFormats?.includes(artifact.format))
      return {selected: null, reason: `${backend}: artifact format ${artifact.format} compatibility UNKNOWN or unsupported`};
    const candidates = hardware.devices.filter(d => d.hostId === deployment.hostId &&
      d.backendKinds.includes(backend)).sort((a, b) => a.id.localeCompare(b.id));
    if (backend === "cuda" && (requested.gpuLayers ?? 0) === 0)
      return {selected: null, reason: "cuda: positive GPU offload layers are required for CUDA placement"};
    const constrainDevices = backend === requested.backend && requested.deviceIds.length > 0;
    const configured = constrainDevices
      ? candidates.filter(d => requested.deviceIds.includes(d.id)) : candidates;
    if (constrainDevices && configured.length !== requested.deviceIds.length)
      return {selected: null, reason: `${backend}: requested device identity unavailable`};
    const device: ComputeDevice | undefined = configured.find(d => d.availability === "AVAILABLE" &&
      d.trust === "VERIFIED");
    if (!device) return {selected: null, reason: `${backend}: host device ${hardware.backendAvailability[backend as keyof typeof hardware.backendAvailability] ?? "UNKNOWN"}`};
    const hostNeed = Math.max(input.requiredHostBytes ?? 0, requested.minAvailableHostBytes ?? 0);
    if (hostNeed > 0) {
      const available = hardware.memory.availableRamBytes.value;
      if (available === null || hardware.memory.availableRamBytes.provenance !== "Measured")
        return {selected: null, reason: `${backend}: available host RAM UNKNOWN`};
      if (available < hostNeed) return {selected: null, reason: `${backend}: insufficient available host RAM`};
    }
    if (backend !== "cpu") {
      const requiredEstimate = artifact.size === undefined ? 0 : artifact.size +
        Math.max(512 * 1024 ** 2, (requested.contextLength ?? 2048) * 64 * 1024);
      const need = Math.max(input.requiredDeviceBytes ?? 0, requested.minAvailableDeviceBytes ?? 0,requiredEstimate);
      if (need > 0 && device.availableMemoryBytes === undefined)
        return {selected: null, reason: `${backend}: available device memory UNKNOWN`};
      if (need > 0 && device.availableMemoryBytes !== undefined &&
          device.availableMemoryBytes < need)
        return {selected: null, reason: `${backend}: insufficient available device memory`};
    }
    if (backend === "cpu" && requested.backend === "cpu" && (requested.gpuLayers ?? 0) > 0)
      return {selected: null, reason: "CPU request cannot offload positive GPU layers"};
    return {selected: {
      backend, deviceIds: [device.id],
      gpuLayers: backend === "cpu" ? 0 : (requested.gpuLayers ?? 0),
      runtimeVariantId: support.id,
    }, reason: ""};
  };
  const primary = evaluate(requested.backend);
  if (primary.selected) return {
    state: "selected", requested, selected: primary.selected,
    fallbackUsed: false, fallbackAuthorized: false, reasons: [], actual,
  };
  const fallback = requested.fallback;
  const order = fallback.policy === "allow-compatible" ? ["cpu"] :
    fallback.policy === "explicit-order" ? fallback.order ?? [] : [];
  const reasons = [primary.reason];
  for (const backend of order) {
    if (backend === requested.backend) continue;
    // The first slice implements actual alternate placement only on CPU.
    if (backend !== "cpu") {
      reasons.push(`${backend}: fallback execution not implemented in this slice`);
      continue;
    }
    const evaluated = evaluate(backend);
    if (evaluated.selected) return {
      state: "fallback", requested, selected: evaluated.selected,
      fallbackUsed: true, fallbackAuthorized: true,
      reasons: [...reasons, `${requested.backend} → cpu authorized by ${fallback.policy}`], actual,
    };
    reasons.push(evaluated.reason);
  }
  return reject(reasons);
}
