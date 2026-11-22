import {
  deploymentIdentity, executionPolicyIdentity, requestedExecutionSchema,
  type ActualExecution, type RequestedExecution,
} from "./localComputeFabric";
import { deploymentRequestedExecution, observedActualExecution } from "./executionBackendSelection";
import {
  assertManagedLocalNativeRoute,
  type ManagedLocalNativeRoute, type ManagedLocalNativeStatus,
} from "./managedLocalRuntime";
import { resolveManagedLocalSelection } from "./managedLocalModels";
import type { SelfHostedState } from "./selfHostedProfiles";
import { evidence, unknown, nativeHardwareObservationSchema, type EvidenceValue,
  type NativeHardwareObservation } from "./hardwareProfile";

/**
 * Slice 5 joins one persisted Fabric deployment to ONE independently verified
 * native owner observation. There is no new receipt store, launcher, scheduler
 * or trust authority. `actual` is only produced by observedActualExecution().
 *
 * Stable identity deliberately excludes PID, epoch, route and timestamps.
 * An old record remains useful as historical evidence but can NEVER assert
 * current liveness without fresh native verification and route admission.
 */
export type ManagedExecutionIdentity = {
  version: 1;
  deployment: {
    hostId: string;
    runtimeId: string;
    artifactId: string;
    artifactDigest: string;
    deploymentId: string;
    deploymentIdentity: string;
    configurationRevision: number;
  };
  requested: RequestedExecution;
  /** A trust boundary over backend, device, variant/build and deployment policy. */
  stableExecutionIdentity: string;
  selected: {
    backend: string;
    deviceIds: string[];
    runtimeVariantId: string;
    policyPosition: number | null;
    requestedGpuLayers: number | null;
    selectedGpuLayers: number | null;
    cpuThreads: number | null;
    contextLength: number | null;
    fallbackUsed: boolean;
    fallbackAuthorized: boolean;
    fallbackReason: string | null;
  };
  actual: ActualExecution;
  runtime: {
    version: string;
    runtimeBuildDigest: string | null;
    processId: number;
    epoch: string;
    /** No key/bearer/secret is ever carried into durable history. */
    route: { baseUrl: string; alias: string; processId: number; epoch: string } | null;
  };
  memory: {
    /** Native observation of prelaunch *available* capacity, not usage. */
    hostAvailableBeforeBytes: number | null;
    deviceAvailableBeforeBytes: number | null;
    deviceAvailableAfterBytes: number | null;
    processVramBytes: number | null;
    /** Admission estimate, never a measured allocation. */
    estimatedDeviceRequiredBytes: number | null;
  };
  observedAt: number;
};

const validMemory = (value: number | null | undefined) =>
  value !== null && value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? value : null;

/** Stable trust/qualification key for one exact executed backend, device and
 * runtime archive, not just GPU hardware presence or a selected candidate.
 * Policy changes and CPU↔CUDA fallback produce distinct keys. */
export function stableManagedExecutionKey(input: {
  deploymentIdentity: string;
  runtimeVersion: string;
  policyIdentity: string;
  backend: string;
  deviceIds: readonly string[];
  runtimeVariantId: string;
  runtimeBuildDigest: string | null;
}): string {
  return JSON.stringify([
    "managed-execution-v1", input.deploymentIdentity, input.runtimeVersion,
    input.policyIdentity, input.backend, [...input.deviceIds],
    input.runtimeVariantId, input.runtimeBuildDigest,
  ]);
}

/**
 * Read-only native evidence join. A renderer request, selected plan, GPU
 * detection or old status cannot manufacture `actual`. Optional route is a
 * fresh independently authenticated native route; its bearer is discarded.
 */
export function observedManagedExecutionIdentity(
  state: SelfHostedState,
  selectionId: string,
  native: ManagedLocalNativeStatus | null,
  now = Date.now(),
  route: ManagedLocalNativeRoute | null = null,
): ManagedExecutionIdentity | null {
  const selected = resolveManagedLocalSelection(state, selectionId);
  if (selected.status !== "available" && selected.status !== "unavailable")
    return null;
  if (!native?.installed || native.state !== "Ready" ||
      native.deploymentId !== selected.deployment.id ||
      native.modelDigest !== selected.artifact.digest ||
      native.version !== selected.runtime.version ||
      !Number.isSafeInteger(native.processId) || (native.processId ?? 0) < 1 ||
      !selected.artifact.digest) return null;
  const actual = observedActualExecution(selected.runtime, selected.deployment, native, now);
  const requested = deploymentRequestedExecution(selected.deployment, selected.runtime);
  if (!actual || !requested || !requestedExecutionSchema.safeParse(requested).success ||
      actual.runtimeEpoch !== native.epoch ||
      native.selectedBackend !== actual.backend) return null;
  const nativeReceipt = actual.executionReceipt;
  const deploymentKey = deploymentIdentity(selected.deployment);
  if (selected.deployment.requestedExecution?.candidates &&
      (!nativeReceipt || nativeReceipt.deploymentIdentity !== deploymentKey ||
       !nativeReceipt.runtimeBuildDigest)) return null;
  let routeIdentity: ManagedExecutionIdentity["runtime"]["route"] = null;
  if (route) {
    try { assertManagedLocalNativeRoute(route); }
    catch { return null; }
    if (route.processId !== native.processId || route.epoch !== native.epoch ||
        route.modelAlias !== `clack-${selected.artifact.digest.slice(7, 23)}` ||
        (native.port && new URL(route.baseUrl).port !== String(native.port)))
      return null;
    routeIdentity = {
      baseUrl: route.baseUrl, alias: route.modelAlias,
      processId: route.processId, epoch: route.epoch,
    };
  }
  const fallbackUsed = native.fallbackUsed === true;
  const fallbackAuthorized = native.fallbackAuthorized === true;
  if (fallbackUsed && !fallbackAuthorized) return null;
  const buildDigest = nativeReceipt?.runtimeBuildDigest ?? null;
  const policyIdentity = executionPolicyIdentity(requested);
  return {
    version: 1,
    deployment: {
      hostId: selected.host.id, runtimeId: selected.runtime.id,
      artifactId: selected.artifact.id, artifactDigest: selected.artifact.digest,
      deploymentId: selected.deployment.id, deploymentIdentity: deploymentKey,
      configurationRevision: selected.deployment.configurationRevision,
    },
    requested,
    stableExecutionIdentity: stableManagedExecutionKey({
      deploymentIdentity: deploymentKey, runtimeVersion: native.version,
      policyIdentity, backend: actual.backend, deviceIds: actual.deviceIds,
      runtimeVariantId: actual.runtimeVariantId, runtimeBuildDigest: buildDigest,
    }),
    selected: {
      backend: actual.backend, deviceIds: [...actual.deviceIds],
      runtimeVariantId: actual.runtimeVariantId,
      policyPosition: nativeReceipt?.selectedCandidateIndex ?? null,
      requestedGpuLayers: native.requestedGpuLayers ?? requested.gpuLayers ?? null,
      selectedGpuLayers: native.selectedGpuLayers ?? null,
      cpuThreads: requested.cpuThreads ?? null,
      contextLength: actual.contextLength ?? requested.contextLength ?? null,
      fallbackUsed, fallbackAuthorized, fallbackReason: native.fallbackReason ?? null,
    },
    actual,
    runtime: {
      version: native.version, runtimeBuildDigest: buildDigest,
      processId: native.processId ?? 0, epoch: native.epoch, route: routeIdentity,
    },
    memory: {
      hostAvailableBeforeBytes: validMemory(nativeReceipt?.measuredHostBytes),
      deviceAvailableBeforeBytes: validMemory(nativeReceipt?.measuredDeviceBytes ??
        native.gpuFreeBeforeBytes),
      deviceAvailableAfterBytes: validMemory(native.gpuFreeAfterBytes),
      processVramBytes: validMemory(native.cudaProcessVramBytes),
      estimatedDeviceRequiredBytes: validMemory(native.gpuEstimatedRequiredBytes),
    },
    observedAt: actual.observedAt,
  };
}

/** Historical records never confer current readiness: exact PID/epoch and
 * authenticated route are rechecked against a NEW native observation. */
export function isCurrentManagedExecutionIdentity(
  historical: ManagedExecutionIdentity,
  state: SelfHostedState,
  selectionId: string,
  currentNative: ManagedLocalNativeStatus | null,
  currentRoute: ManagedLocalNativeRoute | null,
  now = Date.now(),
): boolean {
  if (!currentRoute) return false;
  const current = observedManagedExecutionIdentity(state, selectionId,
    currentNative, now, currentRoute);
  return !!current &&
    current.stableExecutionIdentity === historical.stableExecutionIdentity &&
    current.runtime.processId === historical.runtime.processId &&
    current.runtime.epoch === historical.runtime.epoch &&
    current.runtime.route?.baseUrl === currentRoute.baseUrl &&
    (!historical.runtime.route ||
      (historical.runtime.route.baseUrl === current.runtime.route.baseUrl &&
       historical.runtime.route.alias === current.runtime.route.alias));
}

export type CorrelatedExecutionTelemetry = {
  backend: string;
  deviceId: string;
  cpuLogicalProcessors: EvidenceValue<number>;
  gpuModel: EvidenceValue<string>;
  totalDeviceMemoryBytes: EvidenceValue<number>;
  availableDeviceMemoryBytes: EvidenceValue<number>;
  nativeAvailableBeforeBytes: EvidenceValue<number>;
  nativeEstimatedDeviceRequirementBytes: EvidenceValue<number>;
};

/** LM3 OS probes are correlated by durable native device identity, never by
 * GPU array position or model name. Missing/stale telemetry remains Unknown. */
export function correlateManagedExecutionTelemetry(
  execution: ManagedExecutionIdentity,
  native: NativeHardwareObservation | null,
  now = Date.now(),
): CorrelatedExecutionTelemetry {
  const deviceId = execution.actual.deviceIds[0] ?? "";
  const parsed = nativeHardwareObservationSchema.safeParse(native);
  const snapshot = parsed.success && parsed.data.observedAt <= now &&
    now - parsed.data.observedAt < 30_000 ? parsed.data : null;
  const unknownCpu = unknown<number>("processors", "No fresh same-host CPU observation");
  const unknownGpu = unknown<string>("model", "No exact same-device GPU measurement");
  const unknownBytes = (why: string) => unknown<number>("bytes", why);
  const observed = (value: number | null, source: string, at: number | null,
    reason: string): EvidenceValue<number> =>
    value === null || at === null || at > now || now - at >= 30_000
      ? unknownBytes(reason)
      : evidence(value, "bytes", "Measured", source, at);
  const gpu = execution.actual.backend === "cuda" ? snapshot?.gpus.find(candidate =>
    candidate.deviceId?.value &&
    `${execution.deployment.hostId}:accelerator:${candidate.deviceId.value}` === deviceId &&
    candidate.deviceId.observedAt <= now && now - candidate.deviceId.observedAt < 30_000)
    : undefined;
  return {
    backend: execution.actual.backend, deviceId,
    cpuLogicalProcessors: execution.actual.backend === "cpu" &&
      snapshot?.logicalProcessors !== null && snapshot?.logicalProcessors !== undefined
      ? evidence(snapshot.logicalProcessors, "processors", "Measured",
          snapshot.logicalProcessorsSource, snapshot.observedAt)
      : unknownCpu,
    gpuModel: gpu?.model && gpu.model.observedAt <= now &&
      now - gpu.model.observedAt < 30_000
      ? evidence(gpu.model.value, "model", "Measured", gpu.model.source, gpu.model.observedAt)
      : unknownGpu,
    totalDeviceMemoryBytes: gpu?.totalVramBytes
      ? observed(gpu.totalVramBytes.value,gpu.totalVramBytes.source,
          gpu.totalVramBytes.observedAt,"GPU total memory Unknown")
      : unknownBytes("GPU total memory Unknown"),
    availableDeviceMemoryBytes: gpu?.availableVramBytes
      ? observed(gpu.availableVramBytes.value,gpu.availableVramBytes.source,
          gpu.availableVramBytes.observedAt,"GPU available memory Unknown")
      : unknownBytes("GPU available memory Unknown"),
    nativeAvailableBeforeBytes: observed(
      execution.memory.deviceAvailableBeforeBytes,"native-managed-runtime",
      execution.memory.deviceAvailableBeforeBytes === null ? null : execution.observedAt,
      "No native prelaunch device memory observation"),
    nativeEstimatedDeviceRequirementBytes:
      execution.memory.estimatedDeviceRequiredBytes === null
        ? unknownBytes("No native admission estimate")
        : evidence(execution.memory.estimatedDeviceRequiredBytes,"bytes",
          "Estimated","native-managed-runtime-admission",execution.observedAt,
          ["Admission estimate, not an actual allocation"]),
  };
}
