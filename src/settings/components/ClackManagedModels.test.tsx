import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const policyControl = vi.hoisted(() => ({
  save: null as (() => void) | null,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, disabled, onClick }: {
    children: ReactNode; disabled?: boolean; onClick?: () => void;
  }) => {
    if (children === "Save new policy variant") policyControl.save = onClick ?? null;
    return <button type="button" disabled={disabled} onClick={onClick}>{children}</button>;
  },
}));
vi.mock("@/modules/settings/preferences", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/settings/preferences")>();
  return {
    ...original,
    usePreferencesStore: Object.assign(
      <T,>(selector: (state: ReturnType<typeof original.usePreferencesStore.getState>) => T) =>
        selector(original.usePreferencesStore.getState()),
      original.usePreferencesStore,
    ),
  };
});

import { usePreferencesStore } from "@/modules/settings/preferences";
import { attachManagedLocalGguf, attachManagedCudaVariant, managedLocalModelInfos, resolveManagedLocalSelection } from "@/modules/ai/lib/managedLocalModels";
import { emptySelfHostedState, type SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import type { ManagedLocalNativeStatus } from "@/modules/ai/lib/managedLocalRuntime";
import {
  buildManagedExecutionPolicyRequest,
  ClackManagedModels,
  DEFAULT_MANAGED_GGUF_MATERIAL,
  initialManagedExecutionPolicyDraft,
  ManagedExecutionPolicyEditor,
  ManagedExecutionReadout,
  saveManagedExecutionPolicyVariant,
} from "./ClackManagedModels";

const original = usePreferencesStore.getState().selfHostedInference;
afterEach(() => usePreferencesStore.setState({ selfHostedInference: original }));

describe("Clack Managed local model production settings", () => {
  it("offers explicit inspect/import and no implicit model or runtime installation", () => {
    usePreferencesStore.setState({ selfHostedInference: emptySelfHostedState() });
    const html = renderToStaticMarkup(<ClackManagedModels />);
    expect(html).toContain("This PC · Clack Managed");
    expect(html).toContain("Add Local Model");
    expect(html).toContain("Install approved runtime ZIP");
    expect(html).toContain("Install verified CUDA engine + DLL ZIPs");
    expect(html).toContain("llama.cpp b12248 / CUDA 13.5");
    expect(html).toContain("No managed GGUF deployments registered");
    expect(html).toContain("Not installed");
    expect(html).not.toContain("Ready · Chat only");
  });

  it("displays persisted exact GGUF deployments without an invented process", () => {
    const state = attachManagedLocalGguf(emptySelfHostedState(), {
      digest: `sha256:${"c".repeat(64)}`,
      displayName: "Local test model",
      material: DEFAULT_MANAGED_GGUF_MATERIAL,
    }).state;
    usePreferencesStore.setState({ selfHostedInference: state });
    const html = renderToStaticMarkup(<ClackManagedModels />);
    expect(html).toContain("Local test model");
    expect(html).toContain("4096 context");
    expect(html).toContain("Runtime not installed");
    expect(html).toContain("disabled");
    expect(html).not.toContain("Selected and ready");
  });

  it("renders separate canonical CUDA and legacy CPU deployments with truthful offload labels", () => {
    const cpu = attachManagedLocalGguf(emptySelfHostedState(), {
      digest: `sha256:${"a".repeat(64)}`,
      displayName: "Qwen CPU fixture",
      material: {version:1, context:2048, gpu:0, tool:false, grammar:false},
    });
    const cuda=attachManagedCudaVariant(cpu.state,cpu.selectionId,{
      deviceId:"clack-this-pc:accelerator:GPU-30ab48fd-809d-dc7d-c437-6ad626ece81a",
      gpuLayers:40,fallback:"disabled",
    });
    usePreferencesStore.setState({selfHostedInference:cuda.state});
    const html=renderToStaticMarkup(<ClackManagedModels />);
    expect(html).toContain("CPU · 0 GPU layers");
    expect(html).toContain("CUDA · 40 GPU layers");
    expect(html).toContain("Managed CUDA runtime variant");
    expect(html).not.toContain("CUDA Ready");
    expect(html).not.toContain("Selected and ready");
  });

  it("distinguishes saved CUDA intent from a missing native placement, even when a runtime is installed", () => {
    const html = renderToStaticMarkup(<ManagedExecutionReadout
      request={{backend:"cuda",gpuLayers:40,deviceIds:["clack-this-pc:accelerator:GPU-explicit"],
        fallback:{policy:"disabled"}}}
      native={{installed:true,state:"Stopped",version:"b12248",epoch:""}}
      actual={null} loaded={false} installed fileMissing={false}
    />);
    expect(html).toContain("Requested:");
    expect(html).toContain("CUDA · 40 GPU layers · disabled fallback");
    expect(html).toContain("Selected:");
    expect(html).toContain("No matching native selection");
    expect(html).toContain("Actual:");
    expect(html).toContain("Not verified");
    expect(html).toContain("Stopped · no matching native launch");
    expect(html).toContain("<details");
    expect(html).toContain("GPU-explicit");
  });

  it("shows native fallback and recovery as separate evidence from Ready and actual offload", () => {
    const native: ManagedLocalNativeStatus = {
      installed:true,state:"Ready",version:"b12248",epoch:"current-epoch",
      requestedBackend:"cuda",selectedBackend:"cpu",selectedGpuLayers:0,
      fallbackUsed:true,fallbackAuthorized:true,
      fallbackReason:"CUDA device out of memory",
    };
    const request = {backend:"cuda" as const,gpuLayers:40,deviceIds:["device-1"],
      fallback:{policy:"allow-compatible" as const}};
    const unverified = renderToStaticMarkup(<ManagedExecutionReadout
      request={request} native={native} actual={null} loaded installed fileMissing={false}
    />);
    expect(unverified).toContain("Native Ready · execution proof unavailable");
    expect(unverified).not.toContain("native execution verified");
    expect(unverified).toContain("Authorized · CUDA device out of memory");
    const verified = renderToStaticMarkup(<ManagedExecutionReadout
      request={request} native={native} loaded installed fileMissing={false}
      actual={{backend:"cpu",deviceIds:["cpu-0"],gpuLayers:0,runtimeVariantId:"b12248/cpu",
        runtimeEpoch:"current-epoch",source:"native-verified-managed-cpu-launch",observedAt:1}}
    />);
    expect(verified).toContain("Ready · native execution verified");
    expect(verified).toContain("b12248/cpu");
    expect(verified).toContain("Agent qualification separate");
  });

  it("keeps failure actionable without claiming readiness or an automatic recovery", () => {
    const html = renderToStaticMarkup(<ManagedExecutionReadout
      request={null} actual={null} loaded installed fileMissing={false}
      native={{installed:true,state:"Failed",version:"b12248",epoch:"",
        deploymentId:"broken",error:"Native launch rejected"}}
    />);
    expect(html).toContain("Failed · check native error");
    expect(html).toContain("Native error: Native launch rejected");
    expect(html).toContain("Review the native failure, then retry Start");
    expect(html).not.toContain("native execution verified");
  });

  it("distinguishes native in-progress recovery from an eligible but unverified CPU fallback", () => {
    const html = renderToStaticMarkup(<ManagedExecutionReadout
      request={{backend:"cuda",deviceIds:["device-1"],gpuLayers:40,
        fallback:{policy:"allow-compatible"}}}
      loaded installed fileMissing={false} actual={null}
      native={{installed:true,state:"Recovering",version:"b12248",epoch:"recovery-epoch",
        requestedBackend:"cuda",selectedBackend:"cpu",selectedGpuLayers:0,
        recoveryState:"pending-cpu-recovery",failureKind:"ready-timeout",
        fallbackUsed:true,fallbackAuthorized:true}}
    />);
    expect(html).toContain("Recovering · native CPU fallback has not become Ready");
    expect(html).toContain("CPU recovery pending; no Ready proof yet");
    expect(html).toContain("Failure category: ready-timeout");
    expect(html).not.toContain("native execution verified");
  });
});

describe("Slice 4 execution policy settings controls and CAS registration", () => {
  const digest = `sha256:${"8".repeat(64)}`;
  const deviceId = "clack-this-pc:accelerator:GPU-30ab48fd-809d-dc7d-c437-6ad626ece81a";
  const devices = [{ id: deviceId, label: "NVIDIA fixture", free: 8 * 1024 ** 3 }];

  const fixture = () => attachManagedLocalGguf(emptySelfHostedState(), {
    digest, displayName: "Immutable CPU source", material: {
      version: 1, context: 2048, gpu: 0, tool: false, grammar: false,
    },
  });

  it("renders progressive controls without importing, starting or claiming native placement", () => {
    const { state, selectionId } = fixture();
    usePreferencesStore.setState({ selfHostedInference: state });
    const settings = renderToStaticMarkup(<ClackManagedModels />);
    expect(settings).toContain("Create execution policy variant");
    expect(settings).toContain("Save new policy variant");
    expect(settings).toContain("Advanced · CPU, context and memory budgets");
    expect(settings).not.toContain("Ready · native execution verified");
    const editor = renderToStaticMarkup(<ManagedExecutionPolicyEditor
      sourceSelectionId={selectionId} request={null} contextLength={2048}
      devices={devices} disabled={false} onSave={async () => undefined} />);
    expect(editor).toContain('aria-label="Policy preferred backend"');
    expect(editor).toContain('aria-label="Policy fallback order"');
    expect(editor).toContain('aria-label="Policy CPU threads"');
    expect(editor).toContain('aria-label="Policy Context tokens"');
    expect(editor).toContain('aria-label="Policy Maximum host RAM (MiB)"');
    expect(editor).toContain('aria-label="Policy Maximum device VRAM (MiB)"');
    expect(editor).toContain('value="cpu" selected=""');
  });

  it("wires the Save control to a validated request for the exact source selection", async () => {
    const { selectionId } = fixture();
    const onSave = vi.fn(async () => undefined);
    policyControl.save = null;
    renderToStaticMarkup(<ManagedExecutionPolicyEditor
      sourceSelectionId={selectionId} request={null} contextLength={2048}
      devices={devices} disabled={false} onSave={onSave} />);
    const submit = policyControl.save as unknown as () => void;
    expect(submit).toBeTypeOf("function");
    submit();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const [source, requested] = onSave.mock.calls[0] as unknown as [string, ReturnType<typeof buildManagedExecutionPolicyRequest>];
    expect(source).toBe(selectionId);
    expect(requested.candidates?.map(candidate => candidate.backend)).toEqual(["cpu"]);
    expect(requested.fallback.policy).toBe("disabled");
  });

  it("creates an exact CPU-only v3 policy with no implicit CUDA or budgets", () => {
    const draft = initialManagedExecutionPolicyDraft(null, 2048, devices);
    const requested = buildManagedExecutionPolicyRequest(draft);
    expect(requested).toMatchObject({
      backend: "cpu",
      deviceIds: ["clack-this-pc:cpu:0"],
      gpuLayers: 0,
      contextLength: 2048,
      fallback: { policy: "disabled" },
      deviceStrategy: { kind: "single", primaryDeviceId: "clack-this-pc:cpu:0" },
      candidates: [{ backend: "cpu", deviceIds: ["clack-this-pc:cpu:0"],
        gpuLayers: 0, runtimeVariantId: "b12248/cpu" }],
    });
    expect(requested.memoryBudget).toBeUndefined();
    expect(requested.cpuThreads).toBeUndefined();
  });

  it("does not offer a CPU primary device as a CUDA choice after switching policy", () => {
    const cpu = buildManagedExecutionPolicyRequest({
      ...initialManagedExecutionPolicyDraft(null, 2048, devices),
      preferredBackend: "cpu",
    });
    expect(cpu.deviceStrategy?.primaryDeviceId).toBe("clack-this-pc:cpu:0");
    const switched = initialManagedExecutionPolicyDraft(cpu, 2048, devices);
    expect(switched.cudaDeviceId).toBe(deviceId);
    const cuda = buildManagedExecutionPolicyRequest({
      ...switched, preferredBackend: "cuda", gpuLayers: "20",
    });
    expect(cuda.deviceIds).toEqual([deviceId]);
    expect(cuda.candidates?.[0]).toMatchObject({
      backend: "cuda", deviceIds: [deviceId], gpuLayers: 20,
    });
  });

  it("honors preferred CUDA device, explicit CPU fallback, offload and advanced limits", () => {
    const request = buildManagedExecutionPolicyRequest({
      ...initialManagedExecutionPolicyDraft(null, 2048, devices),
      preferredBackend: "cuda", cudaDeviceId: deviceId,
      allowFallback: true, gpuLayers: "40", contextLength: "8192",
      cpuThreads: "6", maxHostMiB: "8192", maxDeviceMiB: "6144",
      reserveHostMiB: "512", reserveDeviceMiB: "256",
    });
    expect(request).toMatchObject({
      backend: "cuda", deviceIds: [deviceId], gpuLayers: 40,
      cpuThreads: 6, contextLength: 8192,
      fallback: { policy: "explicit-order", order: ["cpu"] },
      candidates: [
        { backend: "cuda", deviceIds: [deviceId], gpuLayers: 40, runtimeVariantId: "b12248/cuda" },
        { backend: "cpu", deviceIds: ["clack-this-pc:cpu:0"], gpuLayers: 0, runtimeVariantId: "b12248/cpu" },
      ],
      memoryBudget: {
        maxHostBytes: 8192 * 1024 ** 2, maxDeviceBytes: 6144 * 1024 ** 2,
        reserveHostBytes: 512 * 1024 ** 2, reserveDeviceBytes: 256 * 1024 ** 2,
      },
      deviceStrategy: { kind: "single", primaryDeviceId: deviceId },
    });
    const reversed = buildManagedExecutionPolicyRequest({
      ...initialManagedExecutionPolicyDraft(null, 2048, devices),
      preferredBackend: "cpu", allowFallback: true,
    });
    expect(reversed.candidates?.map(candidate => candidate.backend)).toEqual(["cpu", "cuda"]);
    expect(reversed.fallback).toEqual({ policy: "explicit-order", order: ["cuda"] });
    expect(reversed.deviceStrategy?.primaryDeviceId).toBe("clack-this-pc:cpu:0");
  });

  it("rejects missing GPU, invalid context, invalid offload and fractional memory before CAS", () => {
    const draft = initialManagedExecutionPolicyDraft(null, 2048, []);
    expect(() => buildManagedExecutionPolicyRequest({
      ...draft, preferredBackend: "cuda",
    })).toThrow("Select a discovered NVIDIA GPU");
    expect(() => buildManagedExecutionPolicyRequest({
      ...draft, contextLength: "0",
    })).toThrow("Context must be");
    expect(() => buildManagedExecutionPolicyRequest({
      ...draft, preferredBackend: "cuda", cudaDeviceId: deviceId, gpuLayers: "0",
    })).toThrow("GPU layers must be");
    expect(() => buildManagedExecutionPolicyRequest({
      ...draft, maxHostMiB: "1.5",
    })).toThrow("Host RAM budget");
    expect(() => buildManagedExecutionPolicyRequest({
      ...draft, cpuThreads: "65537",
    })).toThrow("CPU threads must be");
  });

  it("persists new immutable v3 deployment selection through one CAS update, preserving historical CPU and CUDA", async () => {
    const cpu = fixture();
    const cuda = attachManagedCudaVariant(cpu.state, cpu.selectionId, {
      deviceId, gpuLayers: 40, fallback: "disabled",
    });
    const originalDeploymentIds = cuda.state.fabric?.deployments.map(row => row.id);
    const request = buildManagedExecutionPolicyRequest({
      ...initialManagedExecutionPolicyDraft(null, 2048, devices),
      preferredBackend: "cuda", cudaDeviceId: deviceId, allowFallback: true,
    });
    let persisted: SelfHostedState = cuda.state;
    let commits = 0;
    const cas = async (update: (current: SelfHostedState) => SelfHostedState) => {
      commits++;
      persisted = update(persisted);
      return persisted;
    };
    const selectionId = await saveManagedExecutionPolicyVariant(cpu.selectionId, request, cas);
    expect(commits).toBe(1);
    expect(selectionId).not.toBe(cpu.selectionId);
    expect(selectionId).not.toBe(cuda.selectionId);
    expect(persisted.fabric?.deployments.map(row => row.id).slice(0, 2)).toEqual(originalDeploymentIds);
    expect(resolveManagedLocalSelection(persisted, cpu.selectionId).status).not.toBe("missing");
    expect(resolveManagedLocalSelection(persisted, cuda.selectionId).status).not.toBe("missing");
    const saved = resolveManagedLocalSelection(persisted, selectionId);
    expect(saved.status).not.toBe("missing");
    if (saved.status === "missing" || saved.status === "not-managed") throw Error("Missing saved selection");
    expect(saved.deployment.configurationIdentity).toContain('"version":3');
    expect(saved.deployment.requestedExecution).toEqual(request);
    expect(managedLocalModelInfos(persisted).map(model => model.id)).toContain(selectionId);
    expect(await saveManagedExecutionPolicyVariant(cpu.selectionId, request, cas)).toBe(selectionId);
    expect(persisted.fabric?.deployments).toHaveLength(3);
  });
});
