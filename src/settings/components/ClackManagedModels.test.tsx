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
import { ClackManagedModels, DEFAULT_MANAGED_GGUF_MATERIAL } from "./ClackManagedModels";

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
});
