import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/settings/preferences", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/settings/preferences")>();
  return {
    ...actual,
    usePreferencesStore: Object.assign(
      <T,>(selector: (state: ReturnType<typeof actual.usePreferencesStore.getState>) => T) =>
        selector(actual.usePreferencesStore.getState()),
      actual.usePreferencesStore,
    ),
  };
});
import { createSelfHostedEndpoint, type SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { SelfHostedServers } from "./SelfHostedServers";

const original = usePreferencesStore.getState().selfHostedInference;

afterEach(() => {
  usePreferencesStore.setState({ selfHostedInference: original });
});

describe("self-hosted Settings host grouping", () => {
  it("shows disabled local Ollama hosts separately while preserving other providers", () => {
    const local = {
      ...createSelfHostedEndpoint({
        alias: "Local Ollama",
        baseURL: "http://127.0.0.1:11434/",
        backendHint: "ollama",
        allowPrivateNetwork: true,
      }, "settings-local-ollama", 1),
      enabled: false,
    };
    const other = createSelfHostedEndpoint({
      alias: "Local Studio",
      baseURL: "http://127.0.0.1:1234/",
      backendHint: "lmstudio",
      allowPrivateNetwork: true,
    }, "settings-lmstudio", 1);
    const state: SelfHostedState = {
      version: 1,
      revision: 0,
      endpoints: [local, other],
      profiles: [],
      inventories: [{
        endpointId: local.id,
        configurationRevision: local.configurationRevision,
        observedAt: Date.now(),
        lastSuccessAt: Date.now() - 20_000,
        connected: false,
        backend: "ollama",
        version: "0.40.11",
        error: "unreachable",
        models: [{ id: "muse:latest", name: "Muse", chat: "supported" }],
      }],
    };
    usePreferencesStore.setState({ selfHostedInference: state });

    const html = renderToStaticMarkup(<SelfHostedServers />);
    expect(html).toContain("Ollama hosts");
    expect(html).toContain("Add Ollama host");
    expect(html).toContain("Local Ollama");
    expect(html).toContain("This PC");
    expect(html).toContain("Disabled");
    expect(html).toContain("1 discovered model");
    expect(html).toContain("Last reported Ollama 0.40.11");
    expect(html).toContain("Last successful check:");
    expect(html).toContain("Last probe: Server could not be reached");
    expect(html).toContain("Enable this Ollama host before refreshing");
    expect(html).toContain(">Refresh</button>");
    expect(html).toContain("Other self-hosted servers");
    expect(html).toContain("Local Studio");
    expect(html).toContain('aria-label="Enable Ollama host Local Ollama"');
    expect(html).not.toContain("Another computer (SSH)");
  });

  it("treats a legacy host with no enabled field as enabled and connection unknown", () => {
    const { enabled: _enabled, ...legacy } = createSelfHostedEndpoint({
      alias: "Legacy Ollama",
      baseURL: "http://127.0.0.1:11434/",
      backendHint: "ollama",
      allowPrivateNetwork: true,
    }, "settings-legacy-ollama", 1);
    usePreferencesStore.setState({
      selfHostedInference: { version: 1, revision: 0, endpoints: [legacy], profiles: [] },
    });
    const html = renderToStaticMarkup(<SelfHostedServers />);
    expect(html).toContain("Legacy Ollama");
    expect(html).toContain("Unknown — refresh to check");
    expect(html).toContain('aria-label="Disable Ollama host Legacy Ollama"');
  });
});
