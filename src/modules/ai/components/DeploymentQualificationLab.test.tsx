import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  index: 0, slots: [] as unknown[],
  onOpenChange: null as ((value: boolean) => void) | null,
}));
vi.mock("react", async originalImport => {
  const original = await originalImport<typeof import("react")>();
  return { ...original, useState: <T,>(initial: T | (() => T)) => {
    const i = harness.index++;
    if (!(i in harness.slots))
      harness.slots[i] = typeof initial === "function" ? (initial as () => T)() : initial;
    const update = (next: T | ((previous: T) => T)) => {
      const previous = harness.slots[i] as T;
      harness.slots[i] = typeof next === "function"
        ? (next as (previous: T) => T)(previous) : next;
    };
    return [harness.slots[i] as T, update] as const;
  } };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/ui/popover", () => {
  const Part = ({ children }: { children: ReactNode }) => <>{children}</>;
  return {
    Popover: ({ children, onOpenChange }: { children: ReactNode;
      onOpenChange: (next: boolean) => void }) => {
      harness.onOpenChange = onOpenChange;
      return <>{children}</>;
    },
    PopoverTrigger: Part,
    PopoverContent: ({ children }: { children: ReactNode }) =>
      <section aria-label="Qualification Lab dialog">{children}</section>,
  };
});
vi.mock("@/modules/ai/store/chatStore", async originalImport => {
  const original = await originalImport<typeof import("@/modules/ai/store/chatStore")>();
  return { ...original, useChatStore: Object.assign(
    <T,>(select: (s: ReturnType<typeof original.useChatStore.getState>) => T) =>
      select(original.useChatStore.getState()), original.useChatStore,
  ) };
});
vi.mock("@/modules/settings/preferences", async originalImport => {
  const original = await originalImport<typeof import("@/modules/settings/preferences")>();
  return { ...original, usePreferencesStore: Object.assign(
    <T,>(select: (s: ReturnType<typeof original.usePreferencesStore.getState>) => T) =>
      select(original.usePreferencesStore.getState()), original.usePreferencesStore,
  ) };
});

import { invoke } from "@tauri-apps/api/core";
import { attachManagedLocalGguf, MANAGED_LLAMA_ENGINE_VERSION } from "@/modules/ai/lib/managedLocalModels";
import { createSelfHostedEndpoint, emptySelfHostedState, type SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { saveSelfHostedModel, selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { DeploymentQualificationLab } from "./DeploymentQualificationLab";

const sessionId = "qualification-lab-test";
const digest = `sha256:${"a".repeat(64)}`;
const originalChat = useChatStore.getState();
const originalPrefs = usePreferencesStore.getState();
const native = vi.mocked(invoke);

function select(state: SelfHostedState, selectionId: string) {
  usePreferencesStore.setState({ selfHostedInference: state });
  useChatStore.setState({ sessions: [{ id: sessionId, profile: { modelId: selectionId } } as
    (typeof originalChat.sessions)[number]] });
}

function managed() {
  const added = attachManagedLocalGguf(emptySelfHostedState(), {
    digest, displayName: "Lab Test GGUF", size: 421_000_000,
    material: { version: 1, context: 2048, gpu: 0, tool: false, grammar: false },
  });
  const deploymentId = added.state.fabric?.deployments[0]?.id;
  if (!deploymentId) throw Error("No managed fixture deployment");
  return { ...added, deploymentId, ready: {
    installed: true, state: "Ready" as const, version: MANAGED_LLAMA_ENGINE_VERSION,
    epoch: "lab-epoch", deploymentId, modelDigest: digest,
    processId: 9098, port: 43001, error: null,
  } };
}

function render() {
  harness.index = 0;
  return renderToStaticMarkup(<DeploymentQualificationLab sessionId={sessionId} />);
}

async function openLab() {
  expect(harness.onOpenChange).not.toBeNull();
  harness.onOpenChange?.(true);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  return render();
}

beforeEach(() => {
  harness.index = 0;
  harness.slots = [];
  harness.onOpenChange = null;
  native.mockReset();
});
afterEach(() => {
  useChatStore.setState(originalChat, true);
  usePreferencesStore.setState(originalPrefs, true);
  vi.restoreAllMocks();
});

describe("LM11 Qualification Lab passive desktop surface", () => {
  it("01 closed Lab does not read native, send inference, or change settings", () => {
    const selected = managed();
    select(selected.state, selected.selectionId);
    const previous = usePreferencesStore.getState().selfHostedInference;
    expect(render()).toContain("Qualification Lab");
    expect(native).not.toHaveBeenCalled();
    expect(usePreferencesStore.getState().selfHostedInference).toBe(previous);
  });
  it("02 explicit open reads only allowed native status/metadata/hardware once", async () => {
    const selected = managed(); select(selected.state, selected.selectionId);
    native.mockImplementation(async command => command === "managed_local_runtime_status"
      ? selected.ready : null);
    render();
    const html = await openLab();
    expect(native.mock.calls.map(call => call[0])).toEqual([
      "local_hardware_observation", "managed_local_runtime_model_metadata",
      "managed_local_runtime_status",
    ]);
    expect(html).toContain("Lab Test GGUF");
    expect(html).toContain("managed-gguf"); // The full exact ID is HTML-escaped in SSR.
    expect(html).toContain(digest);
    expect(html).toContain("2,048");
    expect(html).toContain("Deterministic run plan");
  });
  it("03 shows real per-step hard limits and no arbitrary retries", async () => {
    const selected = managed(); select(selected.state, selected.selectionId);
    native.mockResolvedValue(selected.ready);
    render(); const html = await openLab();
    expect(html).toContain("Requests / hard output cap");
    expect(html).toContain("128");
    expect(html).toContain("Retries / continuations");
    expect(html).toContain("One Chat-only exact-output challenge");
    expect(html).toContain("qualificationReceipts");
  });
  it("04 unsupported protocols remain selectable for explanation but not runnable", async () => {
    const selected = managed(); select(selected.state, selected.selectionId);
    native.mockResolvedValue(selected.ready);
    render(); const html = await openLab();
    expect(html).toContain("Structured JSON Schema");
    expect(html).toContain("Native tool semantics");
    expect(html).toContain("disabled");
    expect(native.mock.calls.some(call => String(call[0]).includes("start"))).toBe(false);
  });
  it("05 an unverified remote never initiates local probes or remote inference", async () => {
    const endpoint = createSelfHostedEndpoint({
      alias: "Secondary PC", backendHint: "ollama", baseURL: "http://192.0.2.25:11434/",
    }, "lm11-remote-test", 1);
    const saved = saveSelfHostedModel({
      ...emptySelfHostedState(), endpoints: [endpoint],
    }, endpoint.id, "remote-model:latest", "Remote candidate");
    select(saved, selfHostedSelectionId(saved.profiles[0]));
    render(); const html = await openLab();
    expect(native).not.toHaveBeenCalled();
    expect(html).toContain("No Agent candidate");
    expect(html).toContain("Unavailable");
  });
  it("06 stopped runtime does not start itself and still shows its exact plan", async () => {
    const selected = managed(); select(selected.state, selected.selectionId);
    native.mockResolvedValue({ ...selected.ready, state: "Stopped" });
    render(); const html = await openLab();
    expect(html).toContain("Stopped");
    expect(html).toContain("Unavailable");
    expect(native.mock.calls.map(call => call[0])).not.toContain("managed_local_runtime_start");
    expect(html).toContain("disabled");
  });
  it("07 missing readiness and aggregate deadline cannot grant execution", async () => {
    const selected = managed(); select(selected.state, selected.selectionId);
    native.mockResolvedValue(selected.ready);
    render(); const html = await openLab();
    expect(html).toContain("aggregate wall deadline");
    expect(html).toContain("Run this exact bounded procedure");
    expect(html).toContain("disabled");
  });
  it("08 no unapproved tool permission or configuration change occurs on open", async () => {
    const selected = managed(); select(selected.state, selected.selectionId);
    native.mockResolvedValue(selected.ready);
    const before = usePreferencesStore.getState();
    render(); await openLab();
    expect(usePreferencesStore.getState().selfHostedInference).toBe(before.selfHostedInference);
    expect(usePreferencesStore.getState().agentPermissionProfiles).toBe(before.agentPermissionProfiles);
    expect(useChatStore.getState().sessions[0]?.profile?.modelId).toBe(selected.selectionId);
  });
  it("09 zero deployments produce an honest empty state", async () => {
    select(emptySelfHostedState(), "self-hosted:missing");
    render(); const html = await openLab();
    expect(html).toContain("No registered exact deployment");
    expect(native).not.toHaveBeenCalled();
  });
});
