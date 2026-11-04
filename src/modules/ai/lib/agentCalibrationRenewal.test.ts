import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ollamaEffortFixture } from "@/modules/ai/lib/reasoningEffort.fixture";
import { profileEvidence, readSelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { contextReasoningIdentity, forgetContextRuntime, rememberContextRuntime, trustedContext } from "@/modules/ai/lib/contextCalibrationTrust";
import { profileSnapshot } from "@/modules/ai/lib/modelOnboarding";
import { freshVerifiedContextTiers } from "@/modules/ai/lib/minimumSafeContext";
import { toolScope } from "@/modules/ai/lib/toolVerification";
import type { ToolVerification } from "@/modules/ai/lib/toolVerificationSchema";
import { runContextCalibration } from "@/modules/ai/lib/contextCalibration";
import { automaticAgentRecommendation } from "@/modules/ai/lib/agentConfiguration";
import { selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { agentCalibrationRenewalDue, renewAgentCalibrationAtBoundary } from "@/modules/ai/lib/agentCalibrationRenewal";
import { createRequestPreflight } from "@/modules/ai/lib/requestPreflight";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const NOW = 1_800_000_000_000;
const TIER = 49152;
const TIERS = [4096, 8192, 16384, 32768, 49152, 65536, 73728];

function fixture() {
  const f = ollamaEffortFixture([false, true], "renewal-generic-model");
  let state = f.state;
  const endpoint = f.endpoint;
  const p = f.profile;
  p.modelRevision = "long-running-digest";
  p.backend = "ollama";
  const endpointId = endpoint.id;
  const epoch = "same-native-runtime";
  let realEpoch = epoch;
  let requests = 0;
  let verifications = 0;
  let failCalibration = false;
  let failVerification = false;
  let staleAllocation = false;
  let changeDigest = false;
  let changeEpochDuringInference = false;
  let acquired = true;
  const refreshEvidence = (loaded: number, allocation: string) => {
    const current = state.profiles.find(x => x.id === p.id)!;
    const evidence: [string, string | number | boolean, boolean?][] = [
      ["runtimeContext", "per-request"], ["advertisedContext", 131072],
      ["thinking", true], ["thinkingControls", "[false,true]"],
      ["thinkingDefault", true], ["trainedForTools", true], ["loaded", true],
      ["loadedContext", loaded], ["runtimeAllocation", allocation],
      ["requestedContext", loaded, true],
    ];
    current.evidence = evidence.map(([metric, value, measured]) =>
      profileEvidence(state, current.id, "probe." + metric, value,
        measured ? "measured" : "backend-reported", Date.now(),
        measured ? "observed" : "reported"));
    state.inventories = [{
      endpointId, configurationRevision: endpoint.configurationRevision,
      observedAt: Date.now(), connected: true, backend: "ollama",
      models: [{ id: current.transportModelId, name: null, chat: "supported", digest: current.modelRevision }],
    }];
  };
  rememberContextRuntime(endpointId, { epoch, version: "0.40.11",
    configurationRevision: endpoint.configurationRevision, at: Date.now() });
  refreshEvidence(TIER, "old-49k-allocation");
  const scope = toolScope(p, endpoint)!;
  const proof: ToolVerification = {
    version: 1, id: "retained-exact-tier", scope, status: "verified",
    outcome: "native-call", context: TIER, output: 512,
    attempts: [{ output: 512, outcome: "native-call", finish: "tool-calls",
      startedAt: NOW - 6000, completedAt: NOW - 5900 }],
    startedAt: NOW - 6100, completedAt: NOW - 5900,
    firstBodyAt: NOW - 5900, callAt: NOW - 5900, calls: 1,
    validArguments: true, textualIntent: false, textChars: 0,
    finish: "tool-calls", proof: { at: NOW - 5900, expiresAt: NOW + 86_400_000 },
    retryAfter: NOW + 86_400_000,
  };
  p.agentToolTierProofs = [proof];
  const updatedAt = NOW - 900_100;
  p.contextCalibration = {
    version: 1, id: "old-seven-tier", status: "verified",
    highest: 73728, failedNext: null, failure: null,
    allocation: "old-73k-allocation",
    startedAt: updatedAt - 60_000, updatedAt,
    expiresAt: updatedAt + 900_000, retryAfter: updatedAt + 900_000,
    scope: {
      endpointId, configurationRevision: endpoint.configurationRevision,
      model: p.transportModelId, deployment: p.deploymentId,
      digest: p.modelRevision, backend: "ollama", runtimeEpoch: epoch,
      providerVersion: "0.40.11", reasoning: contextReasoningIdentity(p, endpoint),
    },
    attempts: TIERS.map((context, i) => ({
      context, requested: context, loaded: context,
      at: updatedAt - 1000 + i, outcome: "success" as const,
      latencyMs: 50, thermal: "warm" as const,
      finish: "stop", think: "omitted" as const,
    })),
  };
  state = readSelfHostedState(state);
  const currentProfile = () => state.profiles.find(x => x.id === p.id)!;
  const snapshot = () => profileSnapshot(state, currentProfile())!;
  const deps: Parameters<typeof renewAgentCalibrationAtBoundary>[5] = {
    read: vi.fn(async () => state),
    inspect: vi.fn(async () => {
      rememberContextRuntime(endpointId, { epoch: realEpoch, version: "0.40.11",
        configurationRevision: endpoint.configurationRevision, at: Date.now() });
    }),
    calibrate: vi.fn(async (options) => {
      if (failCalibration) throw new Error("qualification unavailable");
      if (changeDigest) {
        currentProfile().modelRevision = "different-digest";
      }
      return runContextCalibration(options, {
        refresh: async () => ({ state, snapshot: snapshot() }),
        inspectRuntime: async () => {
          rememberContextRuntime(endpointId, { epoch: realEpoch, version: "0.40.11",
            configurationRevision: endpoint.configurationRevision, at: Date.now() });
        },
        request: async (context, _captured, signal) => {
          signal.throwIfAborted();
          requests++;
          if (changeEpochDuringInference) realEpoch = "new-runtime-during-qualification";
          if (staleAllocation) {
            refreshEvidence(4096, "provider-returned-wrong-allocation");
            return { finish: "stop" };
          }
          refreshEvidence(context, "fresh-remeasured-exact-tier-allocation");
          return { finish: "stop" };
        },
        commit: async change => {
          state = readSelfHostedState(change(state));
          return state;
        },
      });
    }),
    verify: vi.fn(async (_state, _selection, tier, configuration) => {
      verifications++;
      if (failVerification) throw new Error("native proof failed");
      const profile = currentProfile();
      profile.agentToolTierProofs = [{
        ...proof, id: "renewed-native-proof", context: tier, configuration,
        proof: { at: Date.now(), expiresAt: Date.now() + 86_400_000 },
      }];
      return state;
    }),
    snapshot: (() => ({
      read: async () => acquired ? snapshot() : null,
      refresh: async () => acquired ? snapshot() : { ...snapshot(), stale: true },
    })) as unknown as NonNullable<Parameters<typeof renewAgentCalibrationAtBoundary>[5]>["snapshot"],
  };
  const run = (retained = proof, signal = new AbortController().signal,
    owner: () => boolean = () => true) =>
    renewAgentCalibrationAtBoundary(state, p.id, retained, signal, owner, deps);
  return {
    run, proof, deps, currentProfile, snapshot, state: () => state,
    get requests() { return requests; }, get verifications() { return verifications; },
    epoch: (next: string) => { realEpoch = next; },
    failed: (value: boolean) => { failCalibration = value; },
    verificationFailure: (value: boolean) => { failVerification = value; },
    stale: (value: boolean) => { staleAllocation = value; },
    digestChange: (value: boolean) => { changeDigest = value; },
    epochDuringInference: (value: boolean) => { changeEpochDuringInference = value; },
    unload: () => { acquired = false; },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.mocked(invoke).mockReset();
});
afterEach(() => {
  forgetContextRuntime("server");
  vi.mocked(invoke).mockReset();
  vi.useRealTimers();
});

describe("long-running Agent: safe-boundary exact-tier qualification, offline", () => {
  it("fresh lease does not trigger renewal; an admitted request finishes after TTL without cancellation", async () => {
    const f = fixture();
    f.currentProfile().contextCalibration!.expiresAt = NOW + 60_000;
    expect(agentCalibrationRenewalDue(f.currentProfile().contextCalibration!.expiresAt)).toBe(false);
    expect(freshVerifiedContextTiers(f.state(), f.currentProfile(), f.snapshot())).toContain(TIER);
    const admitted = Promise.resolve("HTTP completion from an already admitted mock");
    vi.setSystemTime(NOW + 61_000);
    expect(await admitted).toContain("completion");
    expect(agentCalibrationRenewalDue(f.currentProfile().contextCalibration!.expiresAt)).toBe(true);
    expect(f.requests).toBe(0);
  });

  it("expired calibration is blocked before next request and one authentic exact-tier calibration reopens trust", async () => {
    const f = fixture();
    expect(agentCalibrationRenewalDue(f.currentProfile().contextCalibration!.expiresAt)).toBe(true);
    expect(freshVerifiedContextTiers(f.state(), f.currentProfile(), f.snapshot())).toEqual([]);
    const result = await f.run();
    expect(f.requests).toBe(1);
    expect(f.verifications).toBe(0);
    expect(result.state.profiles.find(p => p.id === f.currentProfile().id)?.contextCalibration).toMatchObject({
      status: "verified", highest: TIER, attempts: [{ context: TIER, loaded: TIER, outcome: "success" }],
    });
    expect(result.proof.id).toBe(f.proof.id);
    expect(trustedContext(result.state, f.currentProfile())).toBe(TIER);
    expect(freshVerifiedContextTiers(result.state, f.currentProfile(), f.snapshot())).toEqual([TIER]);
    expect(automaticAgentRecommendation(result.state, f.currentProfile(), TIER)?.record.id).toBe(f.proof.id);
    expect(await f.run()).toMatchObject({ proof: { id: f.proof.id } });
    expect(f.requests).toBe(1); // no repeat renewal loop
  });

  it("a changed runtime epoch is rejected before qualification inference", async () => {
    const f = fixture();
    f.epoch("different-process");
    await expect(f.run()).rejects.toThrow(/runtime.*identity changed/i);
    expect(f.requests).toBe(0);
  });

  it("runtime epoch changing during the requalification inference invalidates the new calibration", async () => {
    const f = fixture();
    f.epochDuringInference(true);
    await expect(f.run()).rejects.toThrow(/did not complete/);
    expect(f.requests).toBe(1);
    expect(f.currentProfile().contextCalibration?.status).not.toBe("verified");
  });

  it("a changed digest must not be reused under the original task", async () => {
    const f = fixture();
    f.currentProfile().modelRevision = "another-model";
    await expect(f.run()).rejects.toThrow(/captured model.*differs/i);
    expect(f.requests).toBe(0);
  });

  it("non-calibration settings and unrelated recommendations cannot be silently changed", async () => {
    const f = fixture();
    const captured = structuredClone(f.state());
    const p = f.currentProfile();
    p.recommendations.outputReserve = profileEvidence(f.state(), p.id,
      "outputReserve", 1234, "measured", NOW, "observed");
    await expect(renewAgentCalibrationAtBoundary(captured, p.id, f.proof,
      new AbortController().signal, () => true, f.deps))
      .rejects.toThrow(/identity changed/);
    expect(f.requests).toBe(0);
  });

  it("a digest change observed during qualification fails closed", async () => {
    const f = fixture();
    f.digestChange(true);
    await expect(f.run()).rejects.toThrow(/identity changed|did not complete/i);
    expect(f.requests).toBe(0);
  });

  it("expired exact-tier native-tool proof must be reissued, not extended by context calibration", async () => {
    const f = fixture();
    f.currentProfile().agentToolTierProofs![0].proof!.expiresAt = NOW - 1;
    const result = await f.run(f.proof);
    expect(f.requests).toBe(1);
    expect(f.verifications).toBe(1);
    expect(f.deps.verify).toHaveBeenCalledWith(expect.anything(),
      selfHostedSelectionId(f.currentProfile()), TIER, undefined, expect.anything());
    expect(result.proof.id).toBe("renewed-native-proof");
    expect(result.proof.proof?.at).toBe(NOW);
  });

  it("failed exact-tier native proof verification fails closed", async () => {
    const f = fixture();
    f.currentProfile().agentToolTierProofs![0].proof!.expiresAt = NOW - 1;
    f.verificationFailure(true);
    await expect(f.run()).rejects.toThrow(/native proof failed/);
    expect(f.requests).toBe(1);
    expect(f.verifications).toBe(1);
  });

  it("stale or unrefreshed allocation cannot authorize a new Agent inference", async () => {
    const f = fixture();
    f.unload();
    await expect(f.run()).rejects.toThrow(/fresh loaded allocation/);
    expect(f.requests).toBe(1);
  });

  it("a calibrated tier with provider loaded-context mismatch never becomes eligible", async () => {
    const f = fixture();
    f.stale(true);
    await expect(f.run()).rejects.toThrow(/did not complete/);
    expect(f.requests).toBe(1);
  });

  it("failed qualification does not dispatch Agent generation and never retries", async () => {
    const f = fixture();
    f.failed(true);
    await expect(f.run()).rejects.toThrow(/qualification unavailable/);
    expect(f.requests).toBe(0);
    expect(f.deps.calibrate).toHaveBeenCalledTimes(1);
    expect(f.deps.verify).not.toHaveBeenCalled();
  });

  it("cancelled or superseded owners are blocked before any qualification", async () => {
    const f = fixture();
    await expect(f.run(f.proof, new AbortController().signal, () => false))
      .rejects.toThrow(/owner changed/);
    expect(f.requests).toBe(0);
  });

  it("the SAME pinned native-preflight object is re-bound after real qualification, with final guard intact", async () => {
    const f = fixture();
    const profile = f.currentProfile();
    const endpoint = f.state().endpoints.find(e => e.id === profile.endpointId)!;
    const body = () => ({
      model: profile.transportModelId, stream: true,
      options: { num_ctx: TIER, num_predict: 6144 },
      messages: [{ role: "user", content: "Offline Agent generation, no inference" }],
      tools: [{ type: "function", function: { name: "read_file",
        parameters: { type: "object", properties: { path: { type: "string" } } } } }],
    });
    vi.mocked(invoke).mockImplementation(async command => {
      if (command === "self_hosted_profiles_snapshot")
        return [["selfHostedInference", f.state()]];
      if (command === "self_hosted_probe_cache") return f.snapshot();
      if (command === "self_hosted_context_runtime") return {
        epoch: "same-native-runtime", version: "0.40.11",
        configurationRevision: endpoint.configurationRevision, at: Date.now(),
      };
      throw new Error("No native inference or extra qualification allowed in offline fixture: " + String(command));
    });
    const preflight = createRequestPreflight({
      state: f.state(), local: true, providerId: "ollama",
      modelId: profile.transportModelId, requiredRuntimeContext: TIER,
      requiredContinuationProof: structuredClone(f.proof),
      admission: { endpointId: endpoint.id, profileId: profile.id, capacity: 1 },
    });
    await expect((await preflight.prepare(body()))()).rejects.toMatchObject({
      code: "ollama-continuation-allocation-stale",
    });
    const renewed = await f.run();
    preflight.updateAgentTrust(renewed.state, renewed.proof);
    await expect((await preflight.prepare(body()))()).resolves.toBeUndefined();
    const finalGate = await preflight.prepare(body());
    // Native metadata changed AFTER preparation; final dispatch must fail
    // even if both the newly calibrated context and proof are still in date.
    const loaded = f.currentProfile().evidence.find(e => e.metric === "probe.loadedContext");
    if (!loaded) throw new Error("Expected refreshed native loaded-context evidence");
    loaded.value = 4096;
    await expect(finalGate()).rejects.toMatchObject({
      code: "ollama-context-mismatch",
    });
    expect(f.requests).toBe(1);
    expect(vi.mocked(invoke).mock.calls.every(([command]) =>
      ["self_hosted_profiles_snapshot", "self_hosted_probe_cache", "self_hosted_context_runtime"].includes(String(command)))).toBe(true);
  });
});
