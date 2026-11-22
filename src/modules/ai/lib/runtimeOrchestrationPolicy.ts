import type { HardwareProfile } from "./hardwareProfile";
import { KNOWN_EXECUTION_BACKENDS } from "./localComputeFabric";
import type {
  ComputeDevice,
  ComputeHost,
  LocalRuntime,
  ModelArtifact,
  ModelDeployment,
  RequestedExecution,
  RuntimeBackendVariant,
} from "./localComputeFabric";

/** Pure admission policy. A candidate is never evidence of a launched process. */
export type RuntimeOrchestrationPolicy =
  | "cpu-only"
  | "exact-cuda"
  | "prefer-cuda-then-cpu"
  | "explicit-order"
  | "exact-backend"
  | null;

export type OrchestrationPlacement = {
  backend: string;
  deviceIds: string[];
  gpuLayers: number;
  runtimeVariantId: string;
};

export type BackendCandidate = {
  backend: string;
  role: "requested" | "fallback";
  state: "eligible" | "rejected";
  selected: OrchestrationPlacement | null;
  /** IDs are exact runtime-build identities, never display names. */
  inspectedVariantIds: string[];
  reasons: string[];
};

export type CandidateEvaluation = {
  policy: RuntimeOrchestrationPolicy;
  requested: RequestedExecution | null;
  state: "selected" | "fallback" | "rejected";
  selected: OrchestrationPlacement | null;
  fallbackUsed: boolean;
  fallbackAuthorized: boolean;
  reasons: string[];
  candidates: BackendCandidate[];
};

export type CandidateEvaluationInput = {
  host: ComputeHost;
  runtime: LocalRuntime;
  deployment: ModelDeployment;
  artifact: ModelArtifact;
  hardware: HardwareProfile;
  requested: RequestedExecution | null;
  variants: RuntimeBackendVariant[];
  /** Evidence-backed memory requirements, in bytes. Missing is not an estimate. */
  requiredHostBytes?: number;
  requiredDeviceBytes?: number;
};

/** To add backend execution, implement and verify its device/launch contract.
 * Merely listing a backend in the Fabric or a fallback order cannot enable it. */
export const IMPLEMENTED_PLACEMENT_BACKENDS = ["cpu", "cuda"] as const;
const implemented = new Set<string>(IMPLEMENTED_PLACEMENT_BACKENDS);
const compareId = (a: { id: string }, b: { id: string }) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function backendOrder(requested: RequestedExecution): {
  policy: Exclude<RuntimeOrchestrationPolicy, null>;
  order: string[];
} {
  const fallback = requested.fallback;
  const order = fallback.policy === "explicit-order"
    ? [requested.backend, ...(fallback.order ?? [])]
    : fallback.policy === "allow-compatible"
      ? [requested.backend, "cpu"]
      : [requested.backend];
  const unique = [...new Set(order)];
  return {
    policy: fallback.policy === "explicit-order" ? "explicit-order"
      : requested.backend === "cpu" && unique.length === 1 ? "cpu-only"
      : requested.backend === "cuda" && unique.length === 1 ? "exact-cuda"
      : requested.backend === "cuda" && unique.join(",") === "cuda,cpu"
        ? "prefer-cuda-then-cpu"
        : "exact-backend",
    order: unique,
  };
}

/** Canonical ordered candidate evaluation for current CPU/CUDA placement.
 * All decisions are read-only. A device is never accepted solely because
 * a GPU was detected or because an unverified runtime claims support.
 * Unsupported backend identifiers stay representable for future adapters. */
export function evaluateExecutionCandidates(input: CandidateEvaluationInput): CandidateEvaluation {
  const {host, runtime, deployment, artifact, hardware, requested} = input;
  const reject = (reasons: string[], policy: RuntimeOrchestrationPolicy = null,
    candidates: BackendCandidate[] = []): CandidateEvaluation => ({
    policy, requested, state: "rejected", selected: null,
    fallbackUsed: false, fallbackAuthorized: false, reasons, candidates,
  });
  if (!requested)
    return reject(["No canonical backend request or recognized legacy configuration"]);
  const {policy, order} = backendOrder(requested);
  if (runtime.id !== deployment.runtimeId || hardware.runtimeId !== runtime.id ||
      hardware.hostId !== deployment.hostId || runtime.hostId !== deployment.hostId ||
      host.id !== deployment.hostId || !host.runtimeIds.includes(runtime.id))
    return reject(["Compute Fabric host/runtime/deployment identity mismatch"], policy);
  if (!host.enabled || !runtime.enabled)
    return reject(["Host or runtime is disabled; no backend admission permitted"], policy);
  if (deployment.configurationRevision !== runtime.configurationRevision)
    return reject(["Runtime/deployment configuration revision mismatch"], policy);
  if (artifact.id !== deployment.artifactId)
    return reject(["Compute Fabric artifact/deployment identity mismatch"], policy);
  if (requested.contextLength !== undefined && artifact.declaredContext !== undefined &&
      requested.contextLength > artifact.declaredContext)
    return reject(["Requested context exceeds model-declared context limit"], policy);
  if ([input.requiredHostBytes, input.requiredDeviceBytes].some(bytes =>
    bytes !== undefined && (!Number.isSafeInteger(bytes) || bytes < 0)))
    return reject(["Memory requirements must be nonnegative safe integer byte counts"], policy);

  const hostNeed = Math.max(input.requiredHostBytes ?? 0, requested.minAvailableHostBytes ?? 0);
  const deviceNeed = Math.max(input.requiredDeviceBytes ?? 0, requested.minAvailableDeviceBytes ?? 0);
  const allIds = new Set<string>();
  const ambiguousIds = new Set<string>();
  for (const variant of input.variants) {
    if (allIds.has(variant.id)) ambiguousIds.add(variant.id);
    allIds.add(variant.id);
  }
  const candidates = order.map((backend, index): BackendCandidate => {
    const role = index === 0 ? "requested" : "fallback";
    const inspectedVariantIds: string[] = [];
    const reasons: string[] = [];
    const rejected = (): BackendCandidate => ({
      backend, role, state: "rejected", selected: null, inspectedVariantIds, reasons,
    });
    if (!implemented.has(backend)) {
      // An unknown future identifier has unknown support. Known but
      // unimplemented adapters have explicit unsupported placement status.
      const unfamiliar = !KNOWN_EXECUTION_BACKENDS.some(kind => kind === backend);
      reasons.push(backend + (unfamiliar && !input.variants.some(v => v.backend === backend)
        ? ": runtime backend support UNKNOWN"
        : role === "fallback"
          ? ": fallback execution not implemented in this slice"
          : ": execution backend not implemented"));
      return rejected();
    }
    if (backend === "cpu" && role === "requested" && (requested.gpuLayers ?? 0) > 0) {
      reasons.push("CPU request cannot offload positive GPU layers");
      return rejected();
    }
    if (backend === "cuda" && (requested.gpuLayers ?? 0) === 0) {
      reasons.push("cuda: positive GPU offload layers are required for CUDA placement");
      return rejected();
    }
    const supports = input.variants.filter(variant => variant.backend === backend).sort(compareId);
    if (!supports.length) {
      reasons.push(`${backend}: runtime backend support UNKNOWN`);
      return rejected();
    }
    const devices = hardware.devices.filter(device =>
      device.hostId === deployment.hostId && device.backendKinds.includes(backend) &&
      (backend === "cpu" ? device.kind === "cpu" : device.kind === "accelerator"),
    ).sort(compareId);
    // A requested device pin is an exact identity constraint of the primary
    // backend. Fallback changes backend and therefore does not reuse that pin.
    const pinnedIds = role === "requested" ? requested.deviceIds : [];
    if (pinnedIds.length > 1 || new Set(pinnedIds).size !== pinnedIds.length) {
      reasons.push(`${backend}: multi-device placement is not implemented`);
      return rejected();
    }
    const configured = pinnedIds.length
      ? devices.filter(device => pinnedIds.includes(device.id)) : devices;
    if (pinnedIds.length && configured.length !== pinnedIds.length) {
      reasons.push(`${backend}: requested device identity unavailable`);
      return rejected();
    }
    for (const variant of supports) {
      inspectedVariantIds.push(variant.id);
      const prefix = `${backend}: `;
      if (ambiguousIds.has(variant.id)) {
        reasons.push(`${prefix}ambiguous runtime variant identity ${variant.id}`);
        continue;
      }
      if (role === "requested" && deployment.variantId &&
          deployment.variantId !== variant.id) {
        reasons.push(`${prefix}requested runtime variant identity mismatch ${variant.id}`);
        continue;
      }
      if (variant.support !== "AVAILABLE") {
        reasons.push(`${prefix}runtime build support ${variant.support}`);
        continue;
      }
      if (variant.installation !== "AVAILABLE") {
        reasons.push(`${prefix}runtime installation ${variant.installation}`);
        continue;
      }
      if (variant.trust !== "VERIFIED") {
        reasons.push(`${prefix}runtime build trust ${variant.trust}`);
        continue;
      }
      if (variant.runtimeVersion && variant.runtimeVersion !== runtime.version) {
        reasons.push(`${prefix}runtime build version does not match runtime identity`);
        continue;
      }
      if (!variant.supportedArtifactFormats?.includes(artifact.format)) {
        reasons.push(prefix + "artifact format " + artifact.format +
          " compatibility UNKNOWN or unsupported");
        continue;
      }
      if (!configured.length) {
        reasons.push(prefix + "host device " +
          (hardware.backendAvailability[backend as keyof HardwareProfile["backendAvailability"]] ?? "UNKNOWN"));
        continue;
      }
      for (const device of configured) {
        const problem = evaluateDevice(backend, device, input.hardware, hostNeed, deviceNeed);
        if (problem) {
          reasons.push(`${prefix + problem} (${device.id})`);
          continue;
        }
        return {
          backend, role, state: "eligible", reasons: [],
          inspectedVariantIds,
          selected: {
            backend, deviceIds: [device.id],
            gpuLayers: backend === "cpu" ? 0 : (requested.gpuLayers ?? 0),
            runtimeVariantId: variant.id,
          },
        };
      }
    }
    return rejected();
  });
  const chosen = candidates.find(candidate => candidate.selected);
  if (!chosen?.selected)
    return reject(candidates.flatMap(candidate => candidate.reasons), policy, candidates);
  const fallbackUsed = chosen.role === "fallback";
  const selectedIndex = candidates.indexOf(chosen);
  return {
    policy, requested, candidates, selected: chosen.selected,
    state: fallbackUsed ? "fallback" : "selected",
    fallbackUsed, fallbackAuthorized: fallbackUsed,
    reasons: fallbackUsed
      ? [...candidates.slice(0, selectedIndex).flatMap(candidate => candidate.reasons),
        requested.backend + " → " + chosen.backend +
        " authorized by " + requested.fallback.policy]
      : [],
  };
}

function evaluateDevice(backend: string, device: ComputeDevice, hardware: HardwareProfile,
  hostNeed: number, deviceNeed: number): string | null {
  if (device.availability !== "AVAILABLE")
    return `device availability ${device.availability}`;
  if (device.trust !== "VERIFIED")
    return `device trust ${device.trust}`;
  if (hostNeed > 0) {
    const free = hardware.memory.availableRamBytes;
    if (free.value === null || free.provenance !== "Measured")
      return "available host RAM UNKNOWN";
    if (free.value < hostNeed) return "insufficient available host RAM";
  }
  if (backend !== "cpu") {
    // No speculative VRAM multipliers: required bytes must be supplied from
    // independently measured capacity, a caller minimum, or both.
    if (device.availableMemoryBytes === undefined)
      return "available device memory UNKNOWN";
    if (device.availableMemoryBytes === 0 || device.availableMemoryBytes < deviceNeed)
      return "insufficient available device memory";
  }
  return null;
}
