// Offline forensic control: never calls an inference endpoint or Ollama.
// Uses preserved November 3 settings; only the mocked Tauri IPC is callable.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createRequestPreflight } from "@/modules/ai/lib/requestPreflight";
import { freshVerifiedContextTiers } from "@/modules/ai/lib/minimumSafeContext";
import { automaticAgentRecommendation } from "@/modules/ai/lib/agentConfiguration";
import { forgetContextRuntime, rememberContextRuntime } from "@/modules/ai/lib/contextCalibrationTrust";
import { readSelfHostedState, type SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const RUN = "src-tauri/target/real-qwen-product/museparallelnotes-20261103-01";
const FINAL_PREFLIGHT_AT = 1793692399200;
const CONTEXT = 49152;
const OUTPUT = 6144;

function preserved() {
  const json = JSON.parse(readFileSync(RUN + "/data/terax-settings.json", "utf8"));
  const state = readSelfHostedState(json.selfHostedInference);
  const profile = state.profiles.find(p => p.transportModelId === "muse-glimmer:30b");
  if (!profile?.contextCalibration) throw new Error("Original Muse calibration missing");
  const endpoint = state.endpoints.find(e => e.id === profile.endpointId);
  const proof = profile.agentToolTierProofs?.find(p => p.context === CONTEXT);
  if (!endpoint || !proof) throw new Error("Original 49K tier proof missing");
  // The runtime IPC return body was not persisted. Assume its epoch matched
  // the preserved calibration/proof scope. This is the most favorable case,
  // not a claim that the observed runtime IPC returned this value.
  rememberContextRuntime(endpoint.id, {
    epoch: profile.contextCalibration.scope.runtimeEpoch,
    version: profile.contextCalibration.scope.providerVersion,
    configurationRevision: endpoint.configurationRevision,
    at: 1793692399103,
  });
  const snapshot: ProbeSnapshot = {
    endpointId: endpoint.id,
    configurationRevision: endpoint.configurationRevision,
    selectedModelId: profile.transportModelId,
    observedAt: 1793692399075,
    connected: true, reachable: true, credentialUsed: false, stale: false,
    refreshing: false, inventoryTtlMs: 300000, instanceTtlMs: 30000,
    errors: [], backend: "ollama",
    models: [{
      id: profile.transportModelId, name: null, chat: "supported",
      digest: profile.modelRevision, evidence: profile.evidence,
    }],
  };
  const tiers = () => freshVerifiedContextTiers(state, profile, snapshot, FINAL_PREFLIGHT_AT);
  return { state, profile, endpoint, proof, snapshot, tiers };
}

function mockOffline(state: SelfHostedState, snapshot: ProbeSnapshot) {
  let current = state;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "self_hosted_profiles_snapshot")
      return [["selfHostedInference", current]];
    if (command === "self_hosted_probe_cache") return snapshot;
    throw new Error("Forbidden IPC in offline audit: " + String(command));
  });
  return { setCurrent: (next: SelfHostedState) => { current = next; } };
}

function preflight(f: ReturnType<typeof preserved>) {
  const admission = { endpointId: f.endpoint.id, profileId: f.profile.id, capacity: 1 };
  const gate = createRequestPreflight({
    state: f.state,
    local: true, providerId: "ollama", modelId: f.profile.transportModelId,
    admission,
    requiredRuntimeContext: CONTEXT,
    requiredContinuationProof: structuredClone(f.proof),
  });
  const body = {
    model: f.profile.transportModelId, stream: true,
    options: { num_ctx: CONTEXT, num_predict: OUTPUT },
    messages: [{ role: "user", content: "Offline synthetic control, no inference" }],
    tools: [{
      type: "function", function: { name: "read_file", description: "offline fixture",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    }],
  };
  return { gate, body };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FINAL_PREFLIGHT_AT);
  vi.mocked(invoke).mockReset();
});
afterEach(() => {
  forgetContextRuntime("real-qwen");
  vi.useRealTimers();
  vi.mocked(invoke).mockReset();
});

describe("Nov 3 Muse terminal preflight, strictly offline (preserved evidence)", () => {
  it("reproduces the precise stale pre-dispatch error with matching runtime, fresh allocation and expired calibration", async () => {
    const f = preserved();
    expect(f.profile.contextCalibration!.expiresAt).toBe(1793692395881);
    expect(f.tiers()).toEqual([]);
    mockOffline(f.state, f.snapshot);
    const p = preflight(f);
    await expect((await p.gate.prepare(p.body))()).rejects.toMatchObject({
      code: "ollama-continuation-allocation-stale",
    });
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "self_hosted_probe")).toBe(false);
  });

  it("fresh allocation and recent runtime observations alone cannot renew expired calibration", () => {
    const f = preserved();
    expect(FINAL_PREFLIGHT_AT - 1793692399075).toBe(125);
    expect(FINAL_PREFLIGHT_AT - 1793692399103).toBe(97);
    expect(f.tiers()).toEqual([]);
  });

  it("counterfactual unexpired calibration makes the exact same allocation/identity eligible (no inference)", async () => {
    const f = preserved();
    // This is an isolated Boolean-control variant; artificially changing the
    // expiresAt field is NOT an authorized way to refresh calibration.
    f.profile.contextCalibration!.expiresAt = FINAL_PREFLIGHT_AT + 60_000;
    expect(f.tiers()).toContain(CONTEXT);
    expect(automaticAgentRecommendation(f.state, f.profile, CONTEXT, FINAL_PREFLIGHT_AT)?.record.id).toBe(f.proof.id);
    mockOffline(f.state, f.snapshot);
    const p = preflight(f);
    await expect((await p.gate.prepare(p.body))()).resolves.toBeUndefined();
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "self_hosted_probe")).toBe(false);
  });

  it("changing the runtime epoch blocks even when calibration expiry is hypothetically extended", () => {
    const f = preserved();
    f.profile.contextCalibration!.expiresAt = FINAL_PREFLIGHT_AT + 60_000;
    rememberContextRuntime(f.endpoint.id, {
      epoch: "changed-runtime-process", version: "0.40.11",
      configurationRevision: f.endpoint.configurationRevision,
      at: 1793692399103,
    });
    expect(f.tiers()).toEqual([]);
    expect(automaticAgentRecommendation(f.state, f.profile, CONTEXT, FINAL_PREFLIGHT_AT)).toBeUndefined();
  });

  it("a different digest blocks even with an otherwise fresh allocation and counterfactual unexpired calibration", () => {
    const f = preserved();
    f.profile.contextCalibration!.expiresAt = FINAL_PREFLIGHT_AT + 60_000;
    f.snapshot.models[0].digest = "changed-digest";
    expect(f.tiers()).toEqual([]);
  });

  it("loaded context mismatch blocks despite a current allocation observation", () => {
    const f = preserved();
    f.profile.contextCalibration!.expiresAt = FINAL_PREFLIGHT_AT + 60_000;
    const loaded = f.snapshot.models[0].evidence.find(e => e.metric === "probe.loadedContext");
    if (!loaded) throw new Error("Missing preserved loaded context");
    loaded.value = 40_960; // neither requested nor calibrated
    expect(f.tiers()).toEqual([]);
  });

  it("expired exact-tier proof is independent and is not renewed by fresh allocation/calibration control", async () => {
    const f = preserved();
    f.profile.contextCalibration!.expiresAt = FINAL_PREFLIGHT_AT + 60_000;
    f.proof.proof!.expiresAt = FINAL_PREFLIGHT_AT - 1;
    expect(f.tiers()).toContain(CONTEXT);
    expect(automaticAgentRecommendation(f.state, f.profile, CONTEXT, FINAL_PREFLIGHT_AT)).toBeUndefined();
    mockOffline(f.state, f.snapshot);
    const p = preflight(f);
    await expect((await p.gate.prepare(p.body))()).rejects.toMatchObject({
      code: "agent-tool-proof-stale",
    });
  });

  it("immediately before dispatch, a replaced proof is rejected with a separate error", async () => {
    const f = preserved();
    f.profile.contextCalibration!.expiresAt = FINAL_PREFLIGHT_AT + 60_000;
    const mocked = mockOffline(f.state, f.snapshot);
    const p = preflight(f);
    const finalGate = await p.gate.prepare(p.body);
    const replaced = structuredClone(f.state);
    const freshProfile = replaced.profiles.find(p => p.id === f.profile.id)!;
    freshProfile.agentToolTierProofs = [];
    mocked.setCurrent(replaced);
    await expect(finalGate()).rejects.toMatchObject({ code: "agent-tool-proof-stale" });
  });
});
