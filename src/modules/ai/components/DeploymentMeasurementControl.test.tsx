import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The project intentionally has no DOM test environment. This small,
 * deterministic SSR state harness exposes the component's on-open rendering
 * and popover callback while retaining real fabric/scoping/measurement code.
 * No Run button callback is invoked in any test.
 */
const harness = vi.hoisted(() => ({
  index: 0,
  slots: [] as unknown[],
  onOpenChange: null as ((next: boolean) => void) | null,
  runMeasurement: vi.fn(),
}));

vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const index = harness.index++;
      if (!(index in harness.slots))
        harness.slots[index] = typeof initial === "function"
          ? (initial as () => T)() : initial;
      const set = (next: T | ((previous: T) => T)) => {
        const value = harness.slots[index] as T;
        harness.slots[index] = typeof next === "function"
          ? (next as (previous: T) => T)(value) : next;
      };
      return [harness.slots[index] as T, set] as const;
    },
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/components/ui/popover", () => {
  const Pass = ({ children }: { children: ReactNode }) => <>{children}</>;
  return {
    Popover: ({
      children,
      onOpenChange,
    }: {
      children: ReactNode;
      onOpenChange: (next: boolean) => void;
    }) => {
      harness.onOpenChange = onOpenChange;
      return <>{children}</>;
    },
    PopoverTrigger: Pass,
    PopoverContent: ({ children }: { children: ReactNode }) =>
      <section aria-label="Measurement popover">{children}</section>,
  };
});
// The real bounded runner must never be imported/executed by passive tests.
vi.mock("@/modules/ai/lib/deploymentMeasurementRuntime", () => ({
  runBoundedDeploymentMeasurement: harness.runMeasurement,
}));
vi.mock("@/modules/ai/store/chatStore", async importOriginal => {
  const actual = await importOriginal<typeof import("@/modules/ai/store/chatStore")>();
  return {
    ...actual,
    useChatStore: Object.assign(
      <T,>(select: (state: ReturnType<typeof actual.useChatStore.getState>) => T) =>
        select(actual.useChatStore.getState()),
      actual.useChatStore,
    ),
  };
});
vi.mock("@/modules/settings/preferences", async importOriginal => {
  const actual = await importOriginal<typeof import("@/modules/settings/preferences")>();
  return {
    ...actual,
    usePreferencesStore: Object.assign(
      <T,>(select: (state: ReturnType<typeof actual.usePreferencesStore.getState>) => T) =>
        select(actual.usePreferencesStore.getState()),
      actual.usePreferencesStore,
    ),
  };
});

import { invoke } from "@tauri-apps/api/core";
import {
  completeLm6Run,
  lm6AttemptFromSignals,
  lm6ExactScope,
} from "@/modules/ai/lib/deploymentMeasurement";
import { observedManagedFabric } from "@/modules/ai/lib/deploymentQualificationView";
import {
  attachManagedLocalGguf,
  MANAGED_LLAMA_ENGINE_VERSION,
} from "@/modules/ai/lib/managedLocalModels";
import type { ManagedLocalNativeStatus } from "@/modules/ai/lib/managedLocalRuntime";
import {
  createSelfHostedEndpoint,
  emptySelfHostedState,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import { saveSelfHostedModel, selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { DeploymentMeasurementControl } from "./DeploymentMeasurementControl";

const initialChat = useChatStore.getState();
const initialPrefs = usePreferencesStore.getState();
const invokeMock = vi.mocked(invoke);
const sessionId = "lm6-popover-fixture";
const digest = `sha256:${"b".repeat(64)}`;

function select(state: SelfHostedState, modelId: string) {
  usePreferencesStore.setState({ selfHostedInference: state });
  useChatStore.setState({
    sessions: [{ id: sessionId, profile: { modelId } } as (typeof initialChat.sessions)[number]],
  });
}

function markup() {
  harness.index = 0;
  return renderToStaticMarkup(<DeploymentMeasurementControl sessionId={sessionId} />);
}

async function openPopover() {
  expect(harness.onOpenChange).not.toBeNull();
  harness.onOpenChange!(true);
  // The read-only Tauri status is an asynchronous promise; allow its data and
  // completion handlers to settle without an inference request or fake clock.
  await Promise.resolve();
  await Promise.resolve();
  harness.slots[4] = Date.now();
  return markup();
}

function managedFixture() {
  const saved = attachManagedLocalGguf(emptySelfHostedState(), {
    digest,
    displayName: "Fixture Qwen GGUF",
    size: 491_400_032,
    material: { version: 1, context: 2048, gpu: 0, tool: false, grammar: false },
  });
  const deploymentId = saved.state.fabric!.deployments[0].id;
  const ready: ManagedLocalNativeStatus = {
    installed: true,
    state: "Ready",
    version: MANAGED_LLAMA_ENGINE_VERSION,
    epoch: "fixture-native-epoch-1",
    deploymentId,
    modelDigest: digest,
    processId: 8112,
    port: 42719,
    error: null,
  };
  return { ...saved, deploymentId, ready };
}

function storedMeasurement(fixture: ReturnType<typeof managedFixture>) {
  const now = Date.now();
  const observation = observedManagedFabric(
    fixture.state, fixture.selectionId, fixture.ready, now,
  );
  expect(observation?.observation).toBeDefined();
  const scope = lm6ExactScope(
    observation!.fabric, fixture.deploymentId, observation!.observation, now,
  );
  expect(scope).not.toBeNull();
  const attempt = lm6AttemptFromSignals({
    attemptId: "fixture-attempt",
    requestId: "00000000-0000-4000-8000-000000000042",
    nativeRequestId: "inference-42",
    nativeRequestOpenEvents: 1,
    distinctNativeRequestCount: 1,
    workload: "chat",
    thermal: "warm",
    thermalSource: "native-ready-observation",
    startedAt: now - 2000,
    endedAt: now - 1000,
    result: "passed",
    failure: "none",
    outputObserved: true,
    terminalObserved: true,
    signals: {
      requestStart: now - 2000,
      firstFrame: now - 1880,
      firstMeaningful: now - 1820,
      firstVisible: now - 1810,
      terminal: now - 1100,
      duplicateRequestObserved: false,
      promptTokens: 40,
      generatedTokens: 60,
      providerPromptDurationNs: 1_000_000_000,
      providerGenerationDurationNs: 2_000_000_000,
      // Deliberately no authoritative RAM/VRAM or peak telemetry.
    },
  });
  const run = completeLm6Run({
    runId: "00000000-0000-4000-8000-000000000001",
    scope: scope!,
    configuredContextTokens: 2048,
    backend: "CPU",
    startedAt: now - 2200,
    endedAt: now - 900,
    requestedAttempts: 1,
    attempts: [attempt],
  });
  return {
    ...fixture.state,
    fabric: {
      ...fixture.state.fabric!,
      measurementRuns: [run],
    },
  } satisfies SelfHostedState;
}

beforeEach(() => {
  harness.slots = [];
  harness.index = 0;
  harness.onOpenChange = null;
  harness.runMeasurement.mockReset();
  invokeMock.mockReset();
  useChatStore.setState(initialChat, true);
  usePreferencesStore.setState(initialPrefs, true);
});
afterEach(() => {
  useChatStore.setState(initialChat, true);
  usePreferencesStore.setState(initialPrefs, true);
});

describe("LM6 measurement popover is passive and scoped", () => {
  it("renders the managed entry without a native call, network probe, model request or runner", () => {
    const fixture = managedFixture();
    select(fixture.state, fixture.selectionId);
    const html = markup();
    expect(html).toContain("Deployment measurement details");
    expect(html).toContain("Measurement");
    expect(invokeMock).not.toHaveBeenCalled();
    expect(harness.runMeasurement).not.toHaveBeenCalled();
  });

  it("opening managed details invokes ONLY read-only status and shows exact current run evidence", async () => {
    const fixture = managedFixture();
    const state = storedMeasurement(fixture);
    select(state, fixture.selectionId);
    invokeMock.mockResolvedValue(fixture.ready);

    markup();
    const html = await openPopover();

    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "managed_local_runtime_status",
    ]);
    expect(harness.runMeasurement).not.toHaveBeenCalled();
    expect(html).toContain("Current scoped run");
    expect(html).toContain("Historical runs (0)");
    expect(html).toContain("Fixture Qwen GGUF");
    expect(html).toContain("1/1 completed");
    expect(html).toContain("180.0 ms");
    expect(html).toContain("30.00 tokens/s");
    expect(html).toContain("Run bounded measurement");
    expect(html).toContain("never authorize tools, Agent or permissions");
  });

  it("marks a restarted PID/epoch run historical and never re-labels old throughput as current", async () => {
    const fixture = managedFixture();
    select(storedMeasurement(fixture), fixture.selectionId);
    invokeMock.mockResolvedValue({
      ...fixture.ready,
      epoch: "fixture-native-epoch-2",
      processId: 8113,
    } satisfies ManagedLocalNativeStatus);

    markup();
    const html = await openPopover();

    expect(html).not.toContain("Current scoped run");
    expect(html).toContain("No current exact-scope measured run.");
    expect(html).toContain("Latency, throughput and reliability are Unknown.");
    expect(html).toContain("Historical runs (1)");
    expect(html).toContain("Historical only");
    // The historical evidence can be inspected but is not current authority.
    expect(html).toContain("180.0 ms");
    expect(html).toContain("30.00 tokens/s");
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "managed_local_runtime_status",
    ]);
    expect(harness.runMeasurement).not.toHaveBeenCalled();
  });

  it("retains independent Measured, Derived and Unknown sources, never inventing GPU telemetry", async () => {
    const fixture = managedFixture();
    select(storedMeasurement(fixture), fixture.selectionId);
    invokeMock.mockResolvedValue(fixture.ready);

    markup();
    const html = await openPopover();

    expect(html).toContain("180.0 ms · Measured");
    expect(html).toContain("clack-stream-first-nonempty-text");
    expect(html).toContain("30.00 tokens/s · Derived");
    expect(html).toContain("measured-provider-count-divided-by-evaluation-time");
    expect(html).toContain("Host free RAM before:</strong> Unknown · Unknown");
    expect(html).toContain("GPU free VRAM before:");
    expect(html).toContain("Unknown · Unknown");
    expect(html).toContain("No authoritative provider/runtime boundary");
    expect(harness.runMeasurement).not.toHaveBeenCalled();
  });

  it("remote selections open with saved information and no Tauri status read or inference", async () => {
    const endpoint = createSelfHostedEndpoint({
      alias: "Secondary Fixture", baseURL: "http://127.0.0.1:11434/",
      backendHint: "ollama",
    }, "secondary-measurement-fixture", 1);
    const state = saveSelfHostedModel({
      ...emptySelfHostedState(), endpoints: [endpoint],
    }, endpoint.id, "devstral:latest", "Devstral");
    select(state, selfHostedSelectionId(state.profiles[0]));

    markup();
    const html = await openPopover();

    expect(html).toContain("Deployment measurements");
    expect(html).toContain("No current exact-scope measured run.");
    expect(html).toContain("Ollama version reachability does not certify the remote runtime epoch");
    expect(html).toContain("Remote LM6 is unavailable without independent proof");
    expect(html).toContain("disabled");
    expect(invokeMock).not.toHaveBeenCalled();
    expect(harness.runMeasurement).not.toHaveBeenCalled();
  });

  it("never attaches the popover to unrelated cloud models", () => {
    select(emptySelfHostedState(), "gpt-5.4-mini");
    const html = markup();
    expect(html).not.toContain("Deployment measurement details");
    expect(harness.onOpenChange).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(harness.runMeasurement).not.toHaveBeenCalled();
  });
});
