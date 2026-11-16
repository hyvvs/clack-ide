import type { AriaAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/ai/store/chatStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/ai/store/chatStore")>();
  return {
    ...actual,
    useChatStore: Object.assign(
      <T,>(selector: (state: ReturnType<typeof actual.useChatStore.getState>) => T) =>
        selector(actual.useChatStore.getState()),
      actual.useChatStore,
    ),
  };
});

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

// The native Radix portal is closed in server rendering. Expose only its
// ordinary picker content to inspect the real model grouping and row state.
vi.mock("@/components/ui/dropdown-menu", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    DropdownMenu: Container,
    DropdownMenuContent: Container,
    DropdownMenuTrigger: Container,
    DropdownMenuItem: ({ children, disabled, "aria-label": label,
      "aria-description": description }: {
      children?: ReactNode;
      disabled?: boolean;
      "aria-label"?: string;
      "aria-description"?: AriaAttributes["aria-description"];
    }) => <div role="menuitem" aria-label={label} aria-description={description}
      aria-disabled={disabled}>{children}</div>,
  };
});

import { ModelDropdown, modelPickerHostAvailability } from "./AiStatusBarControls";
import { attachManagedLocalGguf, managedLocalSelectionId } from "@/modules/ai/lib/managedLocalModels";
import { saveSelfHostedModel } from "@/modules/ai/lib/selfHostedModels";
import { createSelfHostedEndpoint, type SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";

const originalPreferences = usePreferencesStore.getState();
const originalChat = useChatStore.getState();

function managedWithOllama(): SelfHostedState {
  const ollamaId = "managed-ui-ollama";
  const base: SelfHostedState = {
    version: 1, revision: 0,
    endpoints: [createSelfHostedEndpoint({
      alias: "This PC", baseURL: "http://127.0.0.1:11434/", backendHint: "ollama",
    }, ollamaId, 1)], profiles: [],
  };
  const withOllama = saveSelfHostedModel(base, ollamaId, "local:latest", "Same label");
  const material = { version: 1 as const, context: 8192, gpu: 0 as const,
    tool: false as const, grammar: false as const };
  const first = attachManagedLocalGguf(withOllama, {
    digest: `sha256:${"a".repeat(64)}`, displayName: "Same label", material,
  });
  return attachManagedLocalGguf(first.state, {
    digest: `sha256:${"b".repeat(64)}`, displayName: "Same label", material,
  }).state;
}

beforeEach(() => {
  usePreferencesStore.setState({
    ...originalPreferences,
    selfHostedInference: managedWithOllama(),
    savedProviderModels: [],
    customEndpoints: [],
  });
  useChatStore.setState({
    ...originalChat,
    activeSessionId: null,
    sessions: [],
    selectedModelId: "gpt-5.4-mini",
  });
});

afterEach(() => {
  usePreferencesStore.setState(originalPreferences);
  useChatStore.setState(originalChat);
});

describe("normal model picker managed GGUF presentation", () => {
  it("surfaces a deleted imported GGUF distinctly from an unavailable runtime", () => {
    const state = managedWithOllama();
    const managed = state.fabric!.deployments.find(d => d.runtimeId === "clack-managed-llama.cpp")!;
    const digest = state.fabric!.artifacts.find(a => a.id === managed.artifactId)!.digest!;
    const selectionId = managedLocalSelectionId(managed);
    expect(modelPickerHostAvailability(selectionId, state, {
      installed: true, state: "Stopped",
    }, { [digest]: false })).toEqual({
      label: "Registered · model file missing", disabled: true,
    });
  });

  it("renders real This PC → Clack Managed GGUF rows with unavailable statuses and keeps Ollama", () => {
    const html = renderToStaticMarkup(<ModelDropdown />);
    expect(html).toContain('role="group" aria-label="Host This PC (local)"');
    expect(html).toContain('role="group" aria-label="Runtime Clack Managed on This PC"');
    expect(html).toContain("Runtime · Ollama");
    expect(html).toContain("Runtime · Clack Managed");
    expect(html).toContain("Deployments");
    expect(html).toContain('title="Clack Managed"');
    const managedRows = html.match(/role="menuitem" aria-label="Same label\. GGUF sha256:[^"]+" aria-description="Registered · runtime status unknown" aria-disabled="true"/g);
    expect(managedRows).toHaveLength(2);
    expect(managedRows![0]).not.toBe(managedRows![1]);
    expect(html).not.toContain("Ready · Chat only");
    expect(html).toContain("Cloud connection");
  });
});
