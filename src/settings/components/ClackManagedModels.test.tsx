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
import { attachManagedLocalGguf } from "@/modules/ai/lib/managedLocalModels";
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
});
