import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No DOM test environment: this SSR harness exercises the real popover-open
// callback while keeping the model runner and all mutations out of the test.
const harness = vi.hoisted(() => ({
  index: 0,
  slots: [] as unknown[],
  onOpenChange: null as ((next: boolean) => void) | null,
}));
vi.mock("react", async importOriginal => {
  const original = await importOriginal<typeof import("react")>();
  return {
    ...original,
    useState: <T,>(initial: T | (() => T)) => {
      const i = harness.index++;
      if (!(i in harness.slots))
        harness.slots[i] = typeof initial === "function" ? (initial as () => T)() : initial;
      const set = (next: T | ((previous: T) => T)) => {
        const previous = harness.slots[i] as T;
        harness.slots[i] = typeof next === "function"
          ? (next as (previous: T) => T)(previous) : next;
      };
      return [harness.slots[i] as T, set] as const;
    },
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/components/ui/popover", () => {
  const Fragment = ({ children }: { children: ReactNode }) => <>{children}</>;
  return {
    Popover: ({ children, onOpenChange }: {
      children: ReactNode; onOpenChange: (next: boolean) => void;
    }) => {
      harness.onOpenChange = onOpenChange;
      return <>{children}</>;
    },
    PopoverTrigger: Fragment,
    PopoverContent: ({ children }: { children: ReactNode }) =>
      <section aria-label="Deployment guide popover">{children}</section>,
  };
});
vi.mock("@/modules/ai/store/chatStore", async importOriginal => {
  const original = await importOriginal<typeof import("@/modules/ai/store/chatStore")>();
  return {
    ...original,
    useChatStore: Object.assign(
      <T,>(select: (state: ReturnType<typeof original.useChatStore.getState>) => T) =>
        select(original.useChatStore.getState()),
      original.useChatStore,
    ),
  };
});
vi.mock("@/modules/settings/preferences", async importOriginal => {
  const original = await importOriginal<typeof import("@/modules/settings/preferences")>();
  return {
    ...original,
    usePreferencesStore: Object.assign(
      <T,>(select: (state: ReturnType<typeof original.usePreferencesStore.getState>) => T) =>
        select(original.usePreferencesStore.getState()),
      original.usePreferencesStore,
    ),
  };
});

import { invoke } from "@tauri-apps/api/core";
import { completeLm6Run, lm6AttemptFromSignals, lm6ExactScope } from "@/modules/ai/lib/deploymentMeasurement";
import { observedManagedFabric } from "@/modules/ai/lib/deploymentQualificationView";
import { CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES, deploymentIdentity,
  deploymentQualificationScope, executionPolicyIdentity, requestedExecutionSchema } from "@/modules/ai/lib/localComputeFabric";
import { attachManagedExecutionPolicyVariant, attachManagedLocalGguf,
  MANAGED_LLAMA_ENGINE_VERSION, resolveManagedLocalSelection } from "@/modules/ai/lib/managedLocalModels";
import { createSelfHostedEndpoint, emptySelfHostedState, type SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { saveSelfHostedModel, selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { DeploymentEvidenceExplorer } from "./DeploymentEvidenceExplorer";

const sessionId = "evidence-guide-test";
const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const originalChat = useChatStore.getState();
const originalPrefs = usePreferencesStore.getState();
const native = vi.mocked(invoke);

function select(state: SelfHostedState, selectionId: string) {
  usePreferencesStore.setState({ selfHostedInference: state });
  useChatStore.setState({
    sessions: [{ id: sessionId, profile: { modelId: selectionId } } as
      (typeof originalChat.sessions)[number]],
  });
}

function render() {
  harness.index = 0;
  return renderToStaticMarkup(<DeploymentEvidenceExplorer sessionId={sessionId} />);
}

async function openGuide() {
  expect(harness.onOpenChange).not.toBeNull();
  harness.onOpenChange?.(true);
  for (let i = 0; i < 9; i++) await Promise.resolve();
  return render();
}

function managed() {
  const first = attachManagedLocalGguf(emptySelfHostedState(), {
    digest: digestA,
    displayName: "Alpha GGUF",
    size: 491_400_032,
    material: { version: 1, context: 2048, gpu: 0, tool: false, grammar: false },
  });
  const second = attachManagedLocalGguf(first.state, {
    digest: digestB,
    displayName: "Beta GGUF",
    size: 391_400_032,
    material: { version: 1, context: 4096, gpu: 0, tool: false, grammar: false },
  });
  const firstId = first.state.fabric?.deployments[0]?.id;
  if (!firstId) throw new Error("Missing first fixture deployment");
  const ready = {
    installed: true, state: "Ready" as const, version: MANAGED_LLAMA_ENGINE_VERSION,
    epoch: "test-native-epoch", deploymentId: firstId, modelDigest: digestA,
    processId: 8112, port: 42719, error: null,
  };
  return { first, second, firstId, ready };
}

function withHistoricalEvidence(fixture: ReturnType<typeof managed>): SelfHostedState {
  const at = Date.now();
  const observed = observedManagedFabric(fixture.first.state, fixture.first.selectionId, fixture.ready, at);
  if (!observed?.observation) throw new Error("Fixture native observation missing");
  const scope = lm6ExactScope(observed.fabric, fixture.firstId, observed.observation, at);
  const receiptScope = deploymentQualificationScope(
    observed.fabric, fixture.firstId, observed.observation, at,
  );
  if (!scope || !receiptScope) throw new Error("Fixture scope missing");
  const measurementRuns = [1, 2, 3].map(index => {
    const startedAt = at - 6000 + 700 * index;
    const attempt = lm6AttemptFromSignals({
      attemptId: `attempt-${index}`,
      requestId: `00000000-0000-4000-8000-00000000000${index}`,
      nativeRequestId: `inference-${index}`,
      nativeRequestOpenEvents: 1,
      distinctNativeRequestCount: 1,
      workload: "chat", thermal: "warm", thermalSource: "native-ready-before-request",
      startedAt, endedAt: startedAt + 600,
      result: "passed", failure: "none", outputObserved: true, terminalObserved: true,
      signals: {
        requestStart: startedAt + 100,
        firstMeaningful: startedAt + 270,
        terminal: startedAt + 500,
        duplicateRequestObserved: false,
      },
    });
    return completeLm6Run({
      runId: `00000000-0000-4000-8000-00000000000${index}`,
      scope, configuredContextTokens: 2048, backend: "CPU",
      startedAt: startedAt - 100, endedAt: startedAt + 800,
      requestedAttempts: 1, attempts: [attempt],
    });
  });
  const receipt = {
    version: 2 as const,
    scope: { ...receiptScope, deploymentId: fixture.firstId },
    capability: "instruction-adherence" as const,
    status: "failed" as const,
    verifiedAt: at - 3000,
    expiresAt: at + 60_000,
    procedure: CURRENT_DEPLOYMENT_QUALIFICATION_PROCEDURES["instruction-adherence"],
    context: { personaId: "coder", systemContextDigest: `sha256:${"d".repeat(64)}` },
    evidence: {
      source: "deterministic-evaluator" as const,
      reference: "synthetic-test-receipt",
      digest: `sha256:${"f".repeat(64)}`,
      checks: [{ id: "instruction-following", result: "fail" as const }],
    },
  };
  const fabric = fixture.first.state.fabric;
  if (!fabric) throw new Error("Fixture fabric missing");
  return {
    ...fixture.first.state,
    fabric: {
      ...fabric,
      measurementRuns,
      qualificationReceipts: [receipt],
    },
  };
}

beforeEach(() => {
  harness.slots = [];
  harness.index = 0;
  harness.onOpenChange = null;
  native.mockReset();
  useChatStore.setState(originalChat, true);
  usePreferencesStore.setState(originalPrefs, true);
});
afterEach(() => {
  useChatStore.setState(originalChat, true);
  usePreferencesStore.setState(originalPrefs, true);
});

describe("LM8–LM10 passive deployment guide", () => {
  it("mounts only for a local/self-hosted selection and does not invoke native or mutate settings on initial render", () => {
    const fixture = managed();
    select(fixture.first.state, fixture.first.selectionId);
    const saved = usePreferencesStore.getState().selfHostedInference;
    const html = render();
    expect(html).toContain("Deployment guide details");
    expect(html).toContain("Deployment guide");
    expect(native).not.toHaveBeenCalled();
    expect(usePreferencesStore.getState().selfHostedInference).toBe(saved);

    select(emptySelfHostedState(), "gpt-5.4-mini");
    expect(render()).not.toContain("Deployment guide details");
    expect(native).not.toHaveBeenCalled();
  });

  it("opens the managed guide with only the three approved native reads, no inference or registry write", async () => {
    const fixture = managed();
    select(fixture.first.state, fixture.first.selectionId);
    const saved = usePreferencesStore.getState().selfHostedInference;
    native.mockImplementation(async (command: string) => {
      if (command === "managed_local_runtime_status") return fixture.ready;
      return null; // Missing hardware/metadata are Unknown, never guessed.
    });
    render();
    const html = await openGuide();
    expect(native.mock.calls.map(call => call[0])).toEqual([
      "local_hardware_observation",
      "managed_local_runtime_model_metadata",
      "managed_local_runtime_status",
    ]);
    expect(html).toContain("Selected deployment overview");
    expect(html).toContain("Alpha GGUF");
    expect(html).toContain("Readiness");
    expect(html).toContain("Chat qualification");
    expect(html).toContain("Main limiting factor");
    expect(html).toContain("Ready");
    expect(html).toContain("Current warm first output");
    expect(html).toContain("Unknown");
    expect(html).toContain("Instruction adherence");
    expect(html).toContain("Native tools");
    expect(html).toContain("Automatic Agent");
    expect(html).toContain("Advanced evidence history (0)");
    expect(html).toContain("LM6 saved runs");
    expect(html).toContain("No currently qualified recommendation");
    expect(usePreferencesStore.getState().selfHostedInference).toBe(saved);
  });

  it("discloses native CUDA observed offload separately from the persisted GPU layer cap",async()=>{
    const legacy=managed();
    const device="clack-this-pc:accelerator:GPU-30ab48fd-809d-dc7d-c437-6ad626ece81a";
    const buildDigest="sha256:ae0a1e064a94db82f3352c843ffa96eb190254fefafc29ce0213798c549a2799";
    const requested=requestedExecutionSchema.parse({
      backend:"cuda",deviceIds:[device],gpuLayers:40,contextLength:2048,
      fallback:{policy:"disabled"},
      candidates:[{backend:"cuda",deviceIds:[device],gpuLayers:40,
        runtimeVariantId:"b12248/cuda",runtimeBuildDigest:buildDigest}],
    });
    const attached=attachManagedExecutionPolicyVariant(legacy.first.state,
      legacy.first.selectionId,requested);
    const exact=resolveManagedLocalSelection(attached.state,attached.selectionId);
    if(exact.status==="missing"||exact.status==="not-managed")throw Error("missing v3 selection");
    select(attached.state,attached.selectionId);
    const status={...legacy.ready,deploymentId:exact.deployment.id,selectedBackend:"cuda",
      fallbackUsed:false,fallbackAuthorized:false,
      actualExecution:{backend:"cuda",deviceIds:[device],gpuLayers:25,
        runtimeVariantId:"b12248/cuda",runtimeEpoch:legacy.ready.epoch,
        source:"native-verified-cuda-init-and-layer-offload",contextLength:2048,
        observedAt:Date.now()-100,
        executionReceipt:{version:3,deploymentId:exact.deployment.id,
          deploymentIdentity:deploymentIdentity(exact.deployment),
          policyIdentity:executionPolicyIdentity(requested),selectedCandidateIndex:0,
          processId:legacy.ready.processId,fallbackUsed:false,fallbackAuthorized:false,
          runtimeBuildDigest:buildDigest}},
    };
    native.mockImplementation(async (command:string)=>
      command==="managed_local_runtime_status" ? status : null);
    render();
    const html=await openGuide();
    expect(html).toContain("Execution backend evidence</dt><dd>CUDA · Native verified");
    expect(html).toContain("Requested GPU layer cap</dt><dd>40 layers · Derived");
    expect(html).toContain("Observed GPU offload</dt><dd>25 layers · Measured");
    expect(html).toContain("native backend observations do not measure full GPU memory residency");
    expect(html).toContain("No currently qualified recommendation");
    expect(native.mock.calls.map(call=>call[0])).toEqual([
      "local_hardware_observation","managed_local_runtime_model_metadata","managed_local_runtime_status",
    ]);
  });

  it("never probes an untrusted remote host and keeps remote metrics and recommendations unverified", async () => {
    const endpoint = createSelfHostedEndpoint({
      alias: "Secondary PC", baseURL: "http://192.0.2.20:11434/",
      backendHint: "ollama",
    }, "evidence-remote-test", 1);
    const state = saveSelfHostedModel({
      ...emptySelfHostedState(), endpoints: [endpoint],
    }, endpoint.id, "remote:latest", "Remote Candidate");
    select(state, selfHostedSelectionId(state.profiles[0]));
    render();
    const html = await openGuide();
    expect(native).not.toHaveBeenCalled();
    expect(html).toContain("remote:latest");
    expect(html).toContain("Unknown"); // LM15 public readiness state, not internal Unverified.
    expect(html).toContain("Current warm first output");
    expect(html).toContain("Unknown");
    expect(html).toContain("No currently qualified recommendation");
    expect(html).toContain("No saved LM2F or LM6 evidence");
  });

  it("shows mixed deployment comparison warnings without claiming a speed winner", async () => {
    const fixture = managed();
    select(fixture.second.state, fixture.first.selectionId);
    native.mockImplementation(async (command: string) =>
      command === "managed_local_runtime_status" ? fixture.ready : null);
    render();
    const html = await openGuide();
    expect(html).toContain("Compare two deployments");
    expect(html).toContain("Compare deployment");
    expect(html).toContain("Alpha GGUF");
    expect(html).toContain("Beta GGUF");
    expect(html).toContain("Not like-for-like; no speed winner inferred");
    expect(html).toContain("At least one measurement is historical/stale or unavailable");
    expect(html).toContain("Recommendation category");
    expect(html).toContain("Automatic Agent");
    expect(html).toContain("Connected hosts");
    expect(html).toContain("No currently qualified recommendation");
  });

  it("shows three saved LM6 runs and a failed instruction receipt as stale history, not current performance", async () => {
    const fixture = managed();
    select(withHistoricalEvidence(fixture), fixture.first.selectionId);
    native.mockImplementation(async (command: string) => command === "managed_local_runtime_status"
      ? { ...fixture.ready, epoch: "different-live-process", processId: 9002 } : null);
    render();
    const html = await openGuide();
    expect(html).toContain("LM6 saved runs</dt><dd>3</dd>");
    expect(html).toContain("Evidence history</dt><dd>4 records</dd>");
    expect(html).toContain("Advanced evidence history (4)");
    expect(html).toContain("Warm samples: 3");
    expect(html).toContain("Cold/warm output observations over time (small samples, not a benchmark)");
    expect(html).toContain("Last recorded instruction evidence: Failed · Stale");
    expect(html).toContain("synthetic-test-receipt");
    expect(html).toContain("Historical");
    expect(html).toContain("Stale");
    expect(html).toContain("Current warm first output</dt><dd>Unknown</dd>");
    expect(html).toContain("No currently qualified recommendation");
    expect(native.mock.calls.map(call => call[0])).toEqual([
      "local_hardware_observation",
      "managed_local_runtime_model_metadata",
      "managed_local_runtime_status",
    ]);
  });

  it("ages a native observation to Unknown without any repeat native request", async () => {
    const fixture = managed();
    select(fixture.first.state, fixture.first.selectionId);
    native.mockImplementation(async (command: string) =>
      command === "managed_local_runtime_status" ? fixture.ready : null);
    render();
    const fresh = await openGuide();
    expect(fresh).toContain("Ready");
    const calls = native.mock.calls.length;
    // Fourth useState slot is the display TTL clock; no clock mocking or probe.
    harness.slots[3] = Date.now() + 31_000;
    const expired = render();
    expect(expired).toContain("Unknown"); // Expired native observation has no authority.
    expect(expired).toContain("Unknown");
    expect(expired).toContain("No currently qualified recommendation");
    expect(native.mock.calls.length).toBe(calls);
  });
});
