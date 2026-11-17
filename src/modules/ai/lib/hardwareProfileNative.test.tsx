import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GpuTelemetryLine } from "../components/DeploymentSuitabilityControl";
import { assessDeploymentSuitability } from "./deploymentSuitability";
import {
  type NativeGpuObservation,
  type NativeHardwareObservation,
  nativeHardwareObservationSchema,
  projectHardwareProfile,
} from "./hardwareProfile";
import { attachManagedLocalGguf } from "./managedLocalModels";
import { projectModelResourceProfile } from "./modelResourceProfile";
import { emptySelfHostedState } from "./selfHostedProfiles";

const GiB = 1024 ** 3;
const at = 1_800_000_000_000;
const os = "native-os-readonly";
const vendor = "system32-nvidia-smi-readonly-vendor-telemetry";
const display = "windows-cim-win32-videocontroller";
const from = <T,>(value: T, source = vendor, observedAt = at - 100) => ({
  value,
  source,
  observedAt,
});
const wmi = (id: string, model: string): NativeGpuObservation => ({
  deviceId: from(id, display),
  vendor: id.includes("VEN_1002") ? from("AMD", display) : null,
  model: from(model, display),
  totalVramBytes: null,
  availableVramBytes: null,
  driverVersion: from("32.0.11024.2", display),
  computeArchitecture: null,
  cudaHardwareCapable: null,
});
const nvidia = (): NativeGpuObservation => ({
  deviceId: from("GPU-unique"),
  vendor: from("NVIDIA"),
  model: from("NVIDIA GeForce RTX 5070 Ti"),
  totalVramBytes: from(16303 * 1024 ** 2),
  availableVramBytes: from(13200 * 1024 ** 2),
  driverVersion: from("616.92"),
  computeArchitecture: from("CUDA compute capability 12.0"),
  cudaHardwareCapable: from(true),
});
const snapshot = (
  gpus: NativeGpuObservation[] = [
    wmi("ROOT\\DISPLAY\\0000", "Virtual Display"),
    nvidia(),
    wmi("PCI\\VEN_1002&DEV_13C0", "AMD Radeon Graphics"),
  ],
): NativeHardwareObservation => ({
  os: "windows",
  architecture: "x86_64",
  logicalProcessors: 24,
  logicalProcessorsSource: "windows-kernel-processor-topology",
  cpuManufacturer: from("AuthenticAMD", "windows-registry-cpu-identity"),
  cpuModel: from(
    "AMD Ryzen 9 9900X 12-Core Processor",
    "windows-registry-cpu-identity",
  ),
  physicalCores: from(12, "windows-kernel-processor-topology"),
  totalRamBytes: 64 * GiB,
  availableRamBytes: 32 * GiB,
  observedAt: at - 100,
  source: os,
  gpus,
  gpuInventoryComplete: true,
});

function exact(native: NativeHardwareObservation | null = snapshot()) {
  const saved = attachManagedLocalGguf(emptySelfHostedState(), {
    digest: `sha256:${"a".repeat(64)}`,
    fileIdentity: `${"a".repeat(64)}:491400032`,
    size: 491_400_032,
    family: "qwen2",
    declaredContext: 32768,
    displayName: "Exact Qwen",
    material: {
      version: 1,
      context: 2048,
      gpu: 0,
      tool: false,
      grammar: false,
    },
  });
  const fabric = saved.state.fabric!;
  const deployment = fabric.deployments[0];
  const host = fabric.hosts[0];
  const runtime = fabric.runtimes[0];
  const artifact = fabric.artifacts[0];
  const hardware = projectHardwareProfile(host, runtime, native, at);
  const resource = projectModelResourceProfile(artifact, runtime, deployment, {
    digest: artifact.digest!,
    size: 491_400_032,
    format: "gguf",
    fileIdentity: `${"a".repeat(64)}:491400032`,
    family: "qwen2",
    declaredContext: 32768,
    quantization: null,
    blockCount: 24,
    embeddingLength: 896,
    attentionHeadCount: 14,
    attentionHeadCountKv: 2,
    attentionKeyLength: 64,
    attentionValueLength: 64,
  });
  const rate = (
    workload: "Chat" | "Native Tools" | "Automatic Agent" = "Chat",
  ) =>
    assessDeploymentSuitability({
      fabric,
      deploymentId: deployment.id,
      hardware,
      resource,
      workload,
      context: 2048,
      now: at,
    });
  return {
    fabric,
    deployment,
    host,
    runtime,
    artifact,
    hardware,
    resource,
    rate,
  };
}

describe("Native Windows Hardware Profile — 15 required cases", () => {
  it("01: a native CPU model has an exact OS source and Measured provenance", () => {
    const h = exact().hardware;
    expect(h.cpu.model).toMatchObject({
      value: "AMD Ryzen 9 9900X 12-Core Processor",
      source: "windows-registry-cpu-identity",
      provenance: "Measured",
    });
    expect(h.cpu.manufacturer.value).toBe("AuthenticAMD");
  });
  it("02: physical cores are independent of logical processors and never divided/guessed", () => {
    const h = exact().hardware;
    expect(h.cpu.physicalCores.value).toBe(12);
    expect(h.cpu.logicalProcessors.value).toBe(24);
    const missing = exact({ ...snapshot(), physicalCores: null }).hardware;
    expect(missing.cpu.physicalCores.provenance).toBe("Unknown");
    expect(missing.cpu.logicalProcessors.value).toBe(24);
  });
  it("03: multiple OS and vendor GPU adapters retain individual identities", () => {
    const h = exact().hardware;
    expect(h.gpus).toHaveLength(3);
    expect(h.gpus[0].model.value).toBe("Virtual Display");
    expect(h.gpus[1].vendor.value).toBe("NVIDIA");
    expect(h.gpus[2].vendor.value).toBe("AMD");
    expect(h.gpuInventoryComplete).toBe(true);
  });
  it("04: only vendor-reported total VRAM is Measured", () => {
    const h = exact().hardware;
    expect(h.gpus[1].totalVramBytes.value).toBe(16303 * 1024 ** 2);
    expect(h.gpus[1].totalVramBytes.provenance).toBe("Measured");
    expect(h.gpus[1].totalVramBytes.source).toBe(vendor);
    expect(h.gpus[2].totalVramBytes.value).toBeNull();
  });
  it("05: missing free-VRAM telemetry remains Unknown even when total is measured", () => {
    const g = { ...nvidia(), availableVramBytes: null };
    const h = exact(snapshot([g])).hardware;
    expect(h.gpus[0].totalVramBytes.value).toBeGreaterThan(0);
    expect(h.gpus[0].availableVramBytes.provenance).toBe("Unknown");
  });
  it("06: vendor source failure leaves OS display identity but no invented VRAM or CUDA", () => {
    const h = exact(snapshot([wmi("PCI\\VEN_1002", "AMD Radeon")])).hardware;
    expect(h.gpus[0].driverVersion.provenance).toBe("Measured");
    expect(h.gpus[0].availableVramBytes.value).toBeNull();
    expect(h.backends.cuda.hardwareSupports.provenance).toBe("Unknown");
  });
  it("07: GPU CUDA hardware capability never certifies installed CUDA runtime", () => {
    const h = exact().hardware;
    expect(h.backends.cuda.hardwareSupports).toMatchObject({
      value: true,
      provenance: "Derived",
    });
    expect(h.backends.cuda.installedRuntimeExecutes).toMatchObject({
      value: false,
      provenance: "Derived",
    });
  });
  it("08: Qwen remains CPU-only on a CUDA-capable machine", () => {
    const e = exact();
    expect(e.resource.executionPlacement.value).toBe("CPU");
    expect(e.resource.gpuLayers.value).toBe(0);
    expect(e.rate().resourceRating).toBe("Good");
  });
  it("09: remote Ollama host must not inherit local CPU/GPU/VRAM despite a supplied snapshot", () => {
    const e = exact();
    const host = {
      ...e.host,
      id: "remote-secondary",
      location: "remote" as const,
    };
    const runtime = {
      ...e.runtime,
      id: "ollama-secondary",
      type: "ollama",
      hostId: host.id,
    };
    const remote = projectHardwareProfile(host, runtime, snapshot(), at);
    expect(remote.cpu.model.provenance).toBe("Unknown");
    expect(remote.gpus).toHaveLength(0);
    expect(remote.memory.availableRamBytes.value).toBeNull();
    expect(remote.backends.cuda.hardwareSupports.provenance).toBe("Unknown");
  });
  it("10: stale/partial native source fields preserve Unknown even with fresh RAM", () => {
    const gpu = {
      ...nvidia(),
      totalVramBytes: from(16303 * 1024 ** 2, vendor, at - 40_000),
    };
    const h = exact({ ...snapshot([gpu]), cpuModel: null }).hardware;
    expect(h.cpu.model.provenance).toBe("Unknown");
    expect(h.gpus[0].totalVramBytes.provenance).toBe("Unknown");
    expect(h.memory.availableRamBytes.provenance).toBe("Measured");
  });
  it("11: user-facing GPU labels separate Measured VRAM from Unknown VRAM", () => {
    const h = exact(
      snapshot([{ ...nvidia(), availableVramBytes: null }]),
    ).hardware;
    const html = renderToStaticMarkup(
      <GpuTelemetryLine gpu={h.gpus[0]} index={0} />,
    );
    expect(html).toContain("Total VRAM:");
    expect(html).toContain("Measured");
    expect(html).toContain("Free VRAM: Unknown");
    expect(html).toContain("Unknown");
  });
  it("12: projecting real telemetry and suitability never mutates native input or saved Fabric", () => {
    const native = snapshot();
    const before = JSON.stringify(native);
    const e = exact(native);
    const fabric = JSON.stringify(e.fabric);
    e.rate();
    expect(JSON.stringify(native)).toBe(before);
    expect(JSON.stringify(e.fabric)).toBe(fabric);
  });
  it("13: GPU recommendation requires user action and never modifies zero GPU layers", () => {
    const e = exact();
    const recommended = e.rate().recommendations;
    expect(recommended.some((row) => row.code === "gpu-runtime")).toBe(true);
    expect(recommended.every((row) => row.requiresUserAction)).toBe(true);
    expect(e.resource.gpuLayers.value).toBe(0);
    expect(e.deployment.configurationIdentity).toContain('"gpu":0');
  });
  it("14: Qwen Automatic Agent remains unqualified on hardware with ample headroom", () => {
    const e = exact();
    expect(e.rate().resourceRating).toBe("Good");
    expect(e.rate("Automatic Agent").workloadAuthorized).toBe(false);
    expect(e.rate("Automatic Agent").rating).not.toBe("Good");
  });
  it("15: LM2F native-tool authority is independent of hardware and never granted", () => {
    const e = exact();
    expect(e.rate("Native Tools").workloadAuthorized).toBe(false);
    expect(e.rate("Native Tools").rating).not.toBe("Good");
    expect(nativeHardwareObservationSchema.safeParse(snapshot()).success).toBe(
      true,
    );
    expect(e.fabric.qualificationReceipts ?? []).toHaveLength(0);
  });
});
