import { z } from "zod";
import type { ComputeHost, LocalRuntime } from "./localComputeFabric";
import {
  MANAGED_LLAMA_ENGINE_VERSION,
  MANAGED_LOCAL_HOST_ID,
  MANAGED_LOCAL_RUNTIME_TYPE,
} from "./managedLocalModels";

/** LM3: identity belongs to the Compute Fabric; this profile is a read-only
 * observation/projection, never another persistent host or execution authority. */
export const provenanceSchema = z.enum([
  "Measured",
  "Derived",
  "Estimated",
  "Unknown",
]);
export type Provenance = z.infer<typeof provenanceSchema>;
export type EvidenceValue<T> = {
  value: T | null;
  unit: string;
  provenance: Provenance;
  source: string;
  observedAt: number | null;
  assumptions: string[];
};
export function evidence<T>(
  value: T,
  unit: string,
  provenance: Exclude<Provenance, "Unknown">,
  source: string,
  observedAt: number | null = null,
  assumptions: string[] = [],
): EvidenceValue<T> {
  return { value, unit, provenance, source, observedAt, assumptions };
}
export function unknown<T>(unit: string, reason: string): EvidenceValue<T> {
  return {
    value: null,
    unit,
    provenance: "Unknown",
    source: reason,
    observedAt: null,
    assumptions: [],
  };
}

export type ExecutionBackend =
  | "cpu"
  | "cuda"
  | "rocm"
  | "vulkan"
  | "metal"
  | "directml";
export type GpuHardware = {
  deviceId: EvidenceValue<string>;
  vendor: EvidenceValue<string>;
  model: EvidenceValue<string>;
  totalVramBytes: EvidenceValue<number>;
  availableVramBytes: EvidenceValue<number>;
  computeArchitecture: EvidenceValue<string>;
  driverVersion: EvidenceValue<string>;
  supportedBackends: EvidenceValue<ExecutionBackend[]>;
};
export type HardwareProfile = {
  hostId: string;
  /** Backend support is runtime-specific, even for two runtimes on one host. */
  runtimeId: string;
  location: ComputeHost["location"];
  os: EvidenceValue<string>;
  cpu: {
    manufacturer: EvidenceValue<string>;
    model: EvidenceValue<string>;
    architecture: EvidenceValue<string>;
    physicalCores: EvidenceValue<number>;
    logicalProcessors: EvidenceValue<number>;
    instructions: EvidenceValue<string[]>;
  };
  memory: {
    totalRamBytes: EvidenceValue<number>;
    availableRamBytes: EvidenceValue<number>;
    pressure: EvidenceValue<number>;
  };
  gpus: GpuHardware[];
  gpuInventoryComplete: boolean;
  backends: Record<
    ExecutionBackend,
    {
      hardwareSupports: EvidenceValue<boolean>;
      installedRuntimeExecutes: EvidenceValue<boolean>;
    }
  >;
};

/** Native unprivileged OS observation; no GPU adapter guessed from display RAM.
 * Null fields are intentional, and stale free-memory is NEVER current budget. */
const nativeMoment = z.number().int().nonnegative().safe();
const nativeReported = <T extends z.ZodTypeAny>(value: T) =>
  z
    .object({
      value,
      source: z.string().min(1).max(128),
      observedAt: nativeMoment,
    })
    .strict();
const nativeText = nativeReported(z.string().min(1).max(512));
const nativeNumber = nativeReported(z.number().int().nonnegative().safe());
const nativeBool = nativeReported(z.boolean());
export const nativeGpuObservationSchema = z
  .object({
    deviceId: nativeText.nullable(),
    vendor: nativeText.nullable(),
    model: nativeText.nullable(),
    totalVramBytes: nativeNumber.nullable(),
    availableVramBytes: nativeNumber.nullable(),
    driverVersion: nativeText.nullable(),
    computeArchitecture: nativeText.nullable(),
    cudaHardwareCapable: nativeBool.nullable(),
  })
  .strict();
export type NativeGpuObservation = z.infer<typeof nativeGpuObservationSchema>;
export const nativeHardwareObservationSchema = z
  .object({
    os: z.string().min(1).max(64),
    architecture: z.string().min(1).max(64),
    logicalProcessors: z.number().int().positive().max(65_536).nullable(),
    logicalProcessorsSource: z.string().min(1).max(128),
    cpuManufacturer: nativeText.nullable(),
    cpuModel: nativeText.nullable(),
    physicalCores: nativeReported(
      z.number().int().positive().max(65_536),
    ).nullable(),
    totalRamBytes: z.number().int().positive().safe().nullable(),
    availableRamBytes: z.number().int().nonnegative().safe().nullable(),
    observedAt: nativeMoment,
    source: z.literal("native-os-readonly"),
    gpus: z.array(nativeGpuObservationSchema).max(32),
    gpuInventoryComplete: z.boolean(),
  })
  .strict();
export type NativeHardwareObservation = z.infer<
  typeof nativeHardwareObservationSchema
>;

const backends = [
  "cpu",
  "cuda",
  "rocm",
  "vulkan",
  "metal",
  "directml",
] as const;
const notObserved = "No authorized host telemetry for this field";
const OS_SOURCE = "native-os-readonly";
const LOCAL_RAM_FRESH_MS = 30_000;

export function projectHardwareProfile(
  host: ComputeHost,
  runtime: LocalRuntime,
  native: NativeHardwareObservation | null = null,
  now = Date.now(),
): HardwareProfile {
  // A machine-local OS snapshot may ONLY attach to the exact current-machine
  // managed host, never to a remote endpoint or a second local host by name.
  const exactLocal =
    host.id === MANAGED_LOCAL_HOST_ID &&
    host.location === "local" &&
    runtime.hostId === host.id;
  const parsed = exactLocal
    ? nativeHardwareObservationSchema.safeParse(native)
    : null;
  const snapshot =
    parsed?.success &&
    parsed.data.observedAt <= now &&
    now - parsed.data.observedAt <= LOCAL_RAM_FRESH_MS
      ? parsed.data
      : null;
  const cpuOnlyManaged =
    exactLocal &&
    runtime.type === MANAGED_LOCAL_RUNTIME_TYPE &&
    runtime.version === MANAGED_LLAMA_ENGINE_VERSION;
  const fresh = <T>(
    field: { value: T; source: string; observedAt: number } | null,
  ) =>
    field &&
    field.observedAt <= now &&
    now - field.observedAt <= LOCAL_RAM_FRESH_MS
      ? field
      : null;
  const fields =
    snapshot?.gpus.map((gpu) => ({
      deviceId: fresh(gpu.deviceId),
      vendor: fresh(gpu.vendor),
      model: fresh(gpu.model),
      totalVramBytes: fresh(gpu.totalVramBytes),
      availableVramBytes: fresh(gpu.availableVramBytes),
      driverVersion: fresh(gpu.driverVersion),
      computeArchitecture: fresh(gpu.computeArchitecture),
      cudaHardwareCapable: fresh(gpu.cudaHardwareCapable),
    })) ?? [];
  const known = <T>(
    reported: { value: T; source: string; observedAt: number } | null,
    unit: string,
    reason: string,
  ): EvidenceValue<T> =>
    reported
      ? evidence(
          reported.value,
          unit,
          "Measured",
          reported.source,
          reported.observedAt,
        )
      : unknown(unit, reason);
  const localGpus: GpuHardware[] = fields.map((gpu) => ({
    deviceId: known(
      gpu.deviceId,
      "device-id",
      "GPU device identity not verified",
    ),
    vendor: known(gpu.vendor, "vendor", "GPU PCI vendor identity unavailable"),
    model: known(gpu.model, "model", "GPU display/vendor model unavailable"),
    totalVramBytes: known(
      gpu.totalVramBytes,
      "bytes",
      "No verified vendor total VRAM",
    ),
    availableVramBytes: known(
      gpu.availableVramBytes,
      "bytes",
      "No fresh vendor free VRAM",
    ),
    computeArchitecture: known(
      gpu.computeArchitecture,
      "architecture",
      "No verified compute architecture",
    ),
    driverVersion: known(
      gpu.driverVersion,
      "version",
      "No verified driver version",
    ),
    supportedBackends:
      gpu.cudaHardwareCapable?.value === true
        ? evidence(
            ["cuda" as const],
            "backend",
            "Derived",
            gpu.cudaHardwareCapable.source,
            gpu.cudaHardwareCapable.observedAt,
            [
              "NVIDIA vendor CUDA compute capability exists; does not prove a CUDA runtime is installed",
              "Other backend capabilities remain unknown",
            ],
          )
        : unknown("backend", "No verified GPU hardware compute capability"),
  }));
  const cudaDevice = fields.find(
    (gpu) => gpu.cudaHardwareCapable?.value === true,
  )?.cudaHardwareCapable;
  const yesNoBackend = Object.fromEntries(
    backends.map((backend) => [
      backend,
      {
        hardwareSupports:
          backend === "cuda" && cudaDevice
            ? evidence(
                true,
                "boolean",
                "Derived",
                cudaDevice.source,
                cudaDevice.observedAt,
                ["NVIDIA compute capability, NOT installed runtime execution"],
              )
            : unknown<boolean>("boolean", notObserved),
        // CPU-only b12248 is a specifically pinned build, not a claim about
        // hardware potential or other runtimes (including remote Ollama).
        installedRuntimeExecutes: cpuOnlyManaged
          ? evidence(
              backend === "cpu",
              "boolean",
              "Derived",
              "pinned-b12248-cpu-runtime-manifest",
            )
          : unknown<boolean>(
              "boolean",
              "No verified installed backend observation",
            ),
      },
    ]),
  ) as HardwareProfile["backends"];
  const available = snapshot?.availableRamBytes ?? null;
  const total = snapshot?.totalRamBytes ?? null;
  const cpuModel = fresh(snapshot?.cpuModel ?? null);
  const cpuManufacturer = fresh(snapshot?.cpuManufacturer ?? null);
  const cores = fresh(snapshot?.physicalCores ?? null);
  return {
    hostId: host.id,
    runtimeId: runtime.id,
    location: host.location,
    os: snapshot
      ? evidence(snapshot.os, "os", "Measured", OS_SOURCE, snapshot.observedAt)
      : unknown("os", notObserved),
    cpu: {
      manufacturer: known(
        cpuManufacturer,
        "vendor",
        "No verified CPU manufacturer",
      ),
      model: known(cpuModel, "name", "No verified CPU model"),
      architecture: snapshot
        ? evidence(
            snapshot.architecture,
            "architecture",
            "Measured",
            OS_SOURCE,
            snapshot.observedAt,
          )
        : unknown("architecture", notObserved),
      physicalCores: known(
        cores,
        "cores",
        "No verified OS physical core topology",
      ),
      logicalProcessors:
        snapshot && snapshot.logicalProcessors !== null
          ? evidence(
              snapshot.logicalProcessors,
              "processors",
              "Measured",
              snapshot.logicalProcessorsSource,
              snapshot.observedAt,
            )
          : unknown("processors", notObserved),
      instructions: unknown("features", "No CPU ISA capability probe"),
    },
    memory: {
      totalRamBytes:
        snapshot && total !== null
          ? evidence(total, "bytes", "Measured", OS_SOURCE, snapshot.observedAt)
          : unknown("bytes", notObserved),
      availableRamBytes:
        snapshot && available !== null && total !== null && available <= total
          ? evidence(
              available,
              "bytes",
              "Measured",
              OS_SOURCE,
              snapshot.observedAt,
            )
          : unknown("bytes", "No fresh OS-available RAM observation"),
      pressure:
        snapshot &&
        available !== null &&
        total !== null &&
        total > 0 &&
        available <= total
          ? evidence(
              1 - available / total,
              "fraction",
              "Derived",
              OS_SOURCE,
              snapshot.observedAt,
              [
                "1 - available physical RAM / total physical RAM; not per-process memory usage",
              ],
            )
          : unknown("fraction", notObserved),
    },
    // Vendor-reported VRAM is not Win32 display AdapterRAM. Missing vendor
    // telemetry never becomes zero, and empty/incomplete does not mean no GPU.
    gpus: localGpus,
    gpuInventoryComplete: snapshot?.gpuInventoryComplete ?? false,
    backends: yesNoBackend,
  };
}

/** Explicit optional future evidence hook: never auto-promote timestamps or
 * memory figures from untrusted settings/history into a live host snapshot. */
export type HardwareTelemetryProvider = (
  host: ComputeHost,
  runtime: LocalRuntime,
) => Promise<NativeHardwareObservation | null>;
