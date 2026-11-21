import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  index: 0, slots: [] as unknown[],
  onOpenChange: null as ((value: boolean) => void) | null,
  runButton: null as { disabled: boolean; click: (() => void) | null } | null,
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
vi.mock("@/modules/ai/lib/deploymentQualificationRuntime", () => ({
  runManagedChatQualification: vi.fn(),
}));
vi.mock("@/modules/ai/lib/deploymentMeasurementRuntime", () => ({
  runBoundedDeploymentMeasurement: vi.fn(),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, disabled, onClick }: {
    children: ReactNode; disabled?: boolean; onClick?: () => void;
  }) => {
    if (children === "Run this exact bounded procedure" ||
        children === "Running bounded qualification…")
      harness.runButton = { disabled: !!disabled, click: onClick ?? null };
    return <button type="button" disabled={disabled} onClick={onClick}>{children}</button>;
  },
}));
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
import { runManagedChatQualification } from "@/modules/ai/lib/deploymentQualificationRuntime";
import { runBoundedDeploymentMeasurement } from "@/modules/ai/lib/deploymentMeasurementRuntime";
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
const chatRunner = vi.mocked(runManagedChatQualification);
const lm6Runner = vi.mocked(runBoundedDeploymentMeasurement);

function authorizeChatOnly() {
  usePreferencesStore.setState({
    agentPermissionProfiles: { "builtin:coder": { mode: "chat-only", categories: {} } },
  });
}

function chooseProcedure(id: string) {
  // The server-renderer test's controlled useState slot, not a production override.
  harness.slots[5] = id;
  return render();
}

function runDisabled(html: string) {
  expect(html).toMatch(/Run this exact bounded procedure|Running bounded qualification/);
  expect(harness.runButton?.disabled).toBe(true);
  expect(html).toContain("disabled");
}

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
  harness.runButton = null;
  native.mockReset();
  chatRunner.mockReset();
  lm6Runner.mockReset();
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
  it("07 missing permission still denies even the independently proven Chat deadline", async () => {
    const selected = managed(); select(selected.state, selected.selectionId);
    native.mockResolvedValue(selected.ready);
    render(); const html = await openLab();
    expect(html).toContain("Chat Only");
    runDisabled(html);
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

  it("10 current exact Chat-only Ready exposes Run without any inference on opening", async () => {
    const selected = managed(); select(selected.state, selected.selectionId);
    authorizeChatOnly();
    native.mockImplementation(async command => command === "managed_local_runtime_status"
      ? selected.ready : null);
    render(); const html = await openLab();
    expect(html).toContain("Procedure eligible after a separate native preflight");
    expect(harness.runButton?.disabled).toBe(false);
    expect(native.mock.calls.map(call => call[0])).toEqual([
      "local_hardware_observation", "managed_local_runtime_model_metadata",
      "managed_local_runtime_status",
    ]);
    expect(chatRunner).not.toHaveBeenCalled();
    expect(lm6Runner).not.toHaveBeenCalled();
  });

  it("11 changing procedure selection does not dispatch and LM6/runner-null stay disabled", async () => {
    const selected = managed(); select(selected.state, selected.selectionId);
    authorizeChatOnly(); native.mockResolvedValue(selected.ready);
    render(); await openLab();
    const before = native.mock.calls.length;
    for (const id of ["cold-warm-cancellation", "structured-json-schema",
      "native-tool-correlation", "agent-readiness", "standalone-cancellation"]) {
      const html = chooseProcedure(id);
      runDisabled(html);
      expect(html).toContain("Unavailable");
    }
    expect(native.mock.calls.length).toBe(before);
    expect(chatRunner).not.toHaveBeenCalled();
    expect(lm6Runner).not.toHaveBeenCalled();
    chooseProcedure("chat-and-adherence");
    expect(harness.runButton?.disabled).toBe(false);
  });

  it("12 stale native Ready, missing PID and stopped status fail closed at display", async () => {
    const selected = managed(); select(selected.state, selected.selectionId);
    authorizeChatOnly(); native.mockResolvedValue(selected.ready);
    render(); await openLab();
    expect(harness.runButton?.disabled).toBe(false);
    const originalRead = harness.slots[2] as { observedAt: number;
      status: typeof selected.ready };
    for (const change of [
      { ...originalRead, observedAt: originalRead.observedAt - 30_001 },
      { ...originalRead, status: { ...selected.ready, processId: null } },
      { ...originalRead, status: { ...selected.ready, state: "Stopped" } },
    ]) {
      harness.slots[2] = change;
      runDisabled(render());
    }
    expect(chatRunner).not.toHaveBeenCalled();
  });

  it("13 changed selected deployment, permission and concurrent run block Run", async () => {
    const selected = managed(); select(selected.state, selected.selectionId);
    authorizeChatOnly(); native.mockResolvedValue(selected.ready);
    render(); await openLab();
    expect(harness.runButton?.disabled).toBe(false);
    useChatStore.setState({ sessions: [{ id: sessionId, profile: {
      modelId: "unrelated-selection",
    } } as (typeof originalChat.sessions)[number]] });
    expect(render()).toBe(""); // The Lab itself is ineligible for a non-managed selection.
    select(selected.state, selected.selectionId);
    usePreferencesStore.setState({ agentPermissionProfiles: {
      "builtin:coder": { mode: "full-access", categories: {} },
    } });
    runDisabled(render());
    authorizeChatOnly();
    harness.slots[6] = true; // simulated active bounded Lab run
    runDisabled(render());
    expect(chatRunner).not.toHaveBeenCalled();
  });

  it("14 request-time fresh native preflight rejects changed PID/epoch/permission/selection", async () => {
    const selected = managed(); select(selected.state, selected.selectionId);
    authorizeChatOnly(); native.mockResolvedValue(selected.ready);
    render(); await openLab();
    for (const changed of [
      { ...selected.ready, processId: 10001 },
      { ...selected.ready, epoch: "new-process-epoch" },
      { ...selected.ready, modelDigest: `sha256:${"b".repeat(64)}` },
      { ...selected.ready, state: "Stopped" },
    ]) {
      const click = harness.runButton?.click;
      expect(harness.runButton?.disabled).toBe(false);
      native.mockResolvedValueOnce(changed);
      click?.();
      await vi.waitFor(() => expect(native.mock.calls.filter(c =>
        c[0] === "managed_local_runtime_status").length).toBeGreaterThan(1));
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(chatRunner).not.toHaveBeenCalled();
      // The previous asynchronous run has settled; a separate explicit click
      // is needed for every preflight probe in this mock-only test.
      harness.slots[6] = false;
      render();
    }
    expect(lm6Runner).not.toHaveBeenCalled();
  });

  it("15 only explicit Run dispatches one mocked original runner after fresh preflight", async () => {
    const selected = managed(); select(selected.state, selected.selectionId);
    authorizeChatOnly(); native.mockResolvedValue(selected.ready);
    chatRunner.mockResolvedValue({
      sessionId: "mock-session", requestId: "mock-request",
      deploymentId: selected.deploymentId, receiptCount: 4,
      chat: "verified", streaming: "verified", terminalCompletion: "verified",
      instructionAdherence: "failed",
    });
    render(); await openLab();
    expect(chatRunner).not.toHaveBeenCalled();
    const click = harness.runButton?.click;
    click?.();
    click?.(); // duplicate before first preflight resolves must not dispatch twice
    await vi.waitFor(() => expect(chatRunner).toHaveBeenCalledTimes(1));
    expect(chatRunner).toHaveBeenCalledWith(selected.selectionId);
    expect(lm6Runner).not.toHaveBeenCalled();
    expect(native.mock.calls.filter(c => c[0] === "managed_local_runtime_status")).toHaveLength(2);
  });

  it("16 permission revoked during request-time native preflight cannot dispatch", async () => {
    const selected = managed(); select(selected.state, selected.selectionId);
    authorizeChatOnly();
    let returnPreflight: ((value: unknown) => void) | null = null;
    native.mockImplementation(async command => {
      if (command !== "managed_local_runtime_status") return null;
      const statusReads = native.mock.calls.filter(call =>
        call[0] === "managed_local_runtime_status").length;
      if (statusReads === 1) return selected.ready;
      return new Promise(resolve => { returnPreflight = resolve; });
    });
    render(); await openLab();
    expect(harness.runButton?.disabled).toBe(false);
    harness.runButton?.click?.();
    await vi.waitFor(() => expect(returnPreflight).not.toBeNull());
    usePreferencesStore.setState({ agentPermissionProfiles: {
      "builtin:coder": { mode: "full-access", categories: {} },
    } });
    if (!returnPreflight) throw new Error("Synthetic preflight not reached");
    (returnPreflight as (value: unknown) => void)(selected.ready);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(chatRunner).not.toHaveBeenCalled();
    expect(lm6Runner).not.toHaveBeenCalled();
  });

  it("17 selected deployment changes during request-time preflight cannot dispatch", async () => {
    const selected = managed(); select(selected.state, selected.selectionId);
    authorizeChatOnly();
    let returnPreflight: ((value: unknown) => void) | null = null;
    native.mockImplementation(async command => {
      if (command !== "managed_local_runtime_status") return null;
      if (native.mock.calls.filter(call => call[0] === "managed_local_runtime_status").length === 1)
        return selected.ready;
      return new Promise(resolve => { returnPreflight = resolve; });
    });
    render(); await openLab();
    harness.runButton?.click?.();
    await vi.waitFor(() => expect(returnPreflight).not.toBeNull());
    useChatStore.setState({ sessions: [{ id: sessionId, profile: {
      modelId: "another-deployment",
    } } as (typeof originalChat.sessions)[number]] });
    if (!returnPreflight) throw new Error("Synthetic preflight not reached");
    (returnPreflight as (value: unknown) => void)(selected.ready);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(chatRunner).not.toHaveBeenCalled();
    expect(lm6Runner).not.toHaveBeenCalled();
  });
});
