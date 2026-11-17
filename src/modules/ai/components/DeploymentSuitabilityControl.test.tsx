import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/modules/ai/store/chatStore", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/ai/store/chatStore")>();
  return {
    ...actual,
    useChatStore: Object.assign(
      <T,>(
        select: (state: ReturnType<typeof actual.useChatStore.getState>) => T,
      ) => select(actual.useChatStore.getState()),
      actual.useChatStore,
    ),
  };
});
vi.mock("@/modules/settings/preferences", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/settings/preferences")>();
  return {
    ...actual,
    usePreferencesStore: Object.assign(
      <T,>(
        select: (
          state: ReturnType<typeof actual.usePreferencesStore.getState>,
        ) => T,
      ) => select(actual.usePreferencesStore.getState()),
      actual.usePreferencesStore,
    ),
  };
});

import {
  attachManagedLocalGguf,
  managedLocalSelectionId,
} from "@/modules/ai/lib/managedLocalModels";
import {
  saveSelfHostedModel,
  selfHostedSelectionId,
} from "@/modules/ai/lib/selfHostedModels";
import {
  createSelfHostedEndpoint,
  emptySelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { invoke } from "@tauri-apps/api/core";
import { DeploymentSuitabilityControl } from "./DeploymentSuitabilityControl";

const initialChat = useChatStore.getState();
const initialPrefs = usePreferencesStore.getState();
const invokeMock = vi.mocked(invoke);

function setSelected(modelId: string) {
  const session = {
    id: "suitability-session",
    profile: { modelId },
  } as (typeof initialChat.sessions)[number];
  useChatStore.setState({ sessions: [session] });
}

beforeEach(() => {
  invokeMock.mockReset();
  useChatStore.setState(initialChat, true);
  usePreferencesStore.setState(initialPrefs, true);
});
afterEach(() => {
  useChatStore.setState(initialChat, true);
  usePreferencesStore.setState(initialPrefs, true);
});

describe("LM3-LM5 advanced suitability entry point", () => {
  it("shows managed deployment details entry without probing, loading, or qualifying during render", () => {
    const saved = attachManagedLocalGguf(emptySelfHostedState(), {
      digest: `sha256:${"a".repeat(64)}`,
      displayName: "Fixture GGUF",
      size: 491_400_032,
      material: {
        version: 1,
        context: 2048,
        gpu: 0,
        tool: false,
        grammar: false,
      },
    });
    usePreferencesStore.setState({ selfHostedInference: saved.state });
    setSelected(managedLocalSelectionId(saved.state.fabric!.deployments[0]));
    const html = renderToStaticMarkup(
      <DeploymentSuitabilityControl sessionId="suitability-session" />,
    );
    expect(html).toContain("Deployment hardware suitability details");
    expect(html).toContain("Suitability");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("does not make any local native call merely to list a remote Ollama selection", () => {
    const endpoint = createSelfHostedEndpoint(
      {
        alias: "Secondary PC",
        baseURL: "http://127.0.0.1:11434/",
        backendHint: "ollama",
      },
      "secondary-fixture",
      1,
    );
    const state = saveSelfHostedModel(
      {
        ...emptySelfHostedState(),
        endpoints: [endpoint],
      },
      endpoint.id,
      "devstral:latest",
      "Devstral",
    );
    usePreferencesStore.setState({ selfHostedInference: state });
    setSelected(selfHostedSelectionId(state.profiles[0]));
    const html = renderToStaticMarkup(
      <DeploymentSuitabilityControl sessionId="suitability-session" />,
    );
    expect(html).toContain("Suitability");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("does not attach a suitability widget to an unrelated cloud model", () => {
    setSelected("gpt-5.4-mini");
    expect(
      renderToStaticMarkup(
        <DeploymentSuitabilityControl sessionId="suitability-session" />,
      ),
    ).not.toContain("Deployment hardware suitability details");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
