import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

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
import { attachManagedLocalGguf, attachManagedCudaVariant } from "@/modules/ai/lib/managedLocalModels";
import { emptySelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import type { ManagedLocalNativeStatus } from "@/modules/ai/lib/managedLocalRuntime";
import { ClackManagedModels, DEFAULT_MANAGED_GGUF_MATERIAL, ManagedExecutionReadout } from "./ClackManagedModels";

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
