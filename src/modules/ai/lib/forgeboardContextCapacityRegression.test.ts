/** Offline regression derived from real, redacted, preserved ForgeBoard trust
 * records. No model calls: all Tauri commands and any refreshed metadata are
 * local test doubles, never evidence of a new real-world observation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import preserved from "./fixtures/forgeboardContextCapacityEvidence20261105.json";
import { readSelfHostedState, type SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { contextRuntime, forgetContextRuntime, rememberContextRuntime, snapshotContext } from "@/modules/ai/lib/contextCalibrationTrust";
import { resolveContextBudget, measureRequest, type RequestCost } from "@/modules/ai/lib/contextBudget";
import { profileBudgetLimits } from "@/modules/ai/lib/contextBudgetProfile";
import { profileSnapshot } from "@/modules/ai/lib/modelOnboarding";
import { freshVerifiedContextTiers, minimumSafeContext } from "@/modules/ai/lib/minimumSafeContext";
import { automaticAgentRecommendation, requireAgentContinuationAllocation } from "@/modules/ai/lib/agentConfiguration";
import { agentCalibrationRenewalDue } from "@/modules/ai/lib/agentCalibrationRenewal";
import { createRequestPreflight } from "@/modules/ai/lib/requestPreflight";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const T14 = preserved.request14At;
const T15 = preserved.request15At;
const T14_FINISH = 1793833029752; // native completed record, not assumed provider time
const RECEIPT_AT = 1793832999823;
const TIER = 32768;
const CALIBRATED = 73728;
const OUTPUT = 8192;
const ESTIMATE: RequestCost = {
  system: 4729, tools: 6499, conversation: 4364, uncertainMedia: false,
};
const EXPECTED = {
  id: "9bc2ae35-e3ac-46b2-92fc-c5ea55bef30d",
  proof32: "cb19394f-4fa7-4af8-ac6d-1a28486d16a0",
  proof73: "7a4774db-370c-42f5-803a-9316b57eb8a8",
  epoch: "40776:1793832712338782000",
};

function evidence(now: number, source = preserved.state): {
  state: SelfHostedState;
  profile: SelfHostedState["profiles"][number];
  snapshot: ProbeSnapshot;
} {
  vi.setSystemTime(now);
  const state = readSelfHostedState(structuredClone(source));
  expect(state.profiles).toHaveLength(1);
  expect(state.endpoints).toHaveLength(1);
  const profile = state.profiles[0];
  const snapshot = profileSnapshot(state, profile);
  expect(snapshot).not.toBeNull();
  rememberContextRuntime(profile.endpointId, {
    epoch: EXPECTED.epoch, version: "0.40.11",
    at: now, configurationRevision: state.endpoints[0].configurationRevision,
  });
  return { state, profile, snapshot: snapshot! };
}
const tiers = (f: ReturnType<typeof evidence>) =>
  freshVerifiedContextTiers(f.state, f.profile, f.snapshot);
const budget = (f: ReturnType<typeof evidence>) =>
  resolveContextBudget(profileBudgetLimits(f.state, f.profile.id, f.snapshot),
    ESTIMATE, OUTPUT);

const exactProof = (f: ReturnType<typeof evidence>) =>
  f.profile.agentToolTierProofs?.find(r => r.context === TIER);

function body() {
  return {
    model: preserved.model, stream: true,
    options: { num_ctx: TIER, num_predict: OUTPUT },
    messages: [{ role: "user", content: "Offline trust test only; never call an inference provider." }],
    tools: [{ type: "function", function: { name: "test_native_tool",
      description: "Offline schema validation only", parameters: { type: "object", properties: {} } } }],
  };
}
function mockNative(f: ReturnType<typeof evidence>, refreshed?: () => ProbeSnapshot) {
  let cached = f.snapshot;
  vi.mocked(invoke).mockImplementation(async (name) => {
    if (name === "self_hosted_profiles_snapshot") return [["selfHostedInference", f.state]];
    if (name === "self_hosted_probe_cache") return structuredClone(cached);
    if (name === "self_hosted_probe") {
      if (!refreshed) throw new Error("No real metadata requalification available in offline test");
      cached = refreshed();
      return structuredClone(cached);
    }
    if (name === "self_hosted_context_runtime") return {
      epoch: EXPECTED.epoch, version: "0.40.11", at: Date.now(), configurationRevision: 1,
    };
    throw new Error("Unexpected native operation in offline regression: " + name);
  });
  return { getSnapshot: () => cached };
}
function preflight(f: ReturnType<typeof evidence>) {
  return createRequestPreflight({
    state: f.state, modelId: f.profile.transportModelId, providerId: "ollama", local: true,
    admission: { endpointId: f.profile.endpointId, profileId: f.profile.id, capacity: 1 },
    requiredRuntimeContext: TIER,
    requiredContinuationProof: exactProof(f),
  });
}
function fullInitialBody() {
  const request = body();
  request.options.num_ctx = CALIBRATED;
  request.messages[0].content = "Offline synthetic retained work ".repeat(1000);
  const measured = measureRequest(request);
  const b = resolveContextBudget({ runtimeTarget: TIER }, measured, OUTPUT);
  expect(b.fits, JSON.stringify({ system: measured.system, tools: measured.tools, conversation: measured.conversation, output: b.output, margin: b.margin })).toBe(true);
  expect(resolveContextBudget({ runtimeTarget: 16384 }, measured, OUTPUT).fits).toBe(false);
  return request;
}
function initialAgentPreflight(f: ReturnType<typeof evidence>) {
  return createRequestPreflight({
    state: f.state, modelId: f.profile.transportModelId, providerId: "ollama", local: true,
    admission: { endpointId: f.profile.endpointId, profileId: f.profile.id, capacity: 1 },
    verifyAgentTier: async () => { throw new Error("Offline native verification is unavailable"); },
  });
}

beforeEach(() => { vi.useFakeTimers(); vi.mocked(invoke).mockReset(); });
afterEach(() => {
  forgetContextRuntime("real-qwen");
  vi.useRealTimers();
});

describe("preserved ForgeBoard 14->15 native-capacity boundary (no inference)", () => {
  it("copies original identity, calibration, exact-tier proofs and real observation timestamps", () => {
    const f = evidence(T14);
    expect(f.profile.transportModelId).toBe(preserved.model);
    expect(f.profile.modelRevision).toBe(preserved.digest);
    expect(f.profile.contextCalibration).toMatchObject({
      id: EXPECTED.id, highest: CALIBRATED, status: "verified",
      expiresAt: 1793833681648,
      scope: { runtimeEpoch: EXPECTED.epoch, providerVersion: "0.40.11" },
    });
    expect(f.profile.toolVerification).toMatchObject({ id: EXPECTED.proof73, context: CALIBRATED });
    expect(exactProof(f)).toMatchObject({ id: EXPECTED.proof32, context: TIER, status: "verified" });
    const requested = f.profile.evidence.find(e => e.metric === "probe.requestedContext");
    const loaded = f.profile.evidence.find(e => e.metric === "probe.loadedContext");
    expect(requested).toMatchObject({ source: "measured", confidence: "observed", value: TIER, observedAt: RECEIPT_AT });
    expect(loaded).toMatchObject({ value: TIER, observedAt: 1793833000503 });
    expect(T14 - RECEIPT_AT).toBe(21263);
    expect(T15 - RECEIPT_AT).toBe(30011);
    expect(T15 - 1793833000503).toBe(29331);
    expect(f.profile.contextCalibration!.expiresAt - T15).toBe(651814);
    expect(agentCalibrationRenewalDue(f.profile.contextCalibration!.expiresAt, T15)).toBe(false);
  });

  it("request 14: real 73K calibrated ceiling and 32K exact proof allow 15592+8192+margin", () => {
    const f = evidence(T14);
    expect(contextRuntime(f.profile.endpointId)?.epoch).toBe(EXPECTED.epoch);
    expect(snapshotContext(f.state, f.profile, f.snapshot)).toBe(CALIBRATED);
    expect(tiers(f)).toContain(TIER);
    expect(tiers(f)).toContain(CALIBRATED);
    expect(automaticAgentRecommendation(f.state, f.profile, TIER)?.record.id).toBe(EXPECTED.proof32);
    expect(budget(f)).toMatchObject({ ceiling: CALIBRATED, source: "requested", fits: true });
    expect(minimumSafeContext(profileBudgetLimits(f.state, f.profile.id, f.snapshot),
      ESTIMATE, OUTPUT, tiers(f), tier =>
        !!automaticAgentRecommendation(f.state, f.profile, tier))).toBe(TIER);
    expect(ESTIMATE.system + ESTIMATE.tools + ESTIMATE.conversation).toBe(15592);
    expect(15592 + OUTPUT + 1560).toBe(25344);
  });

  it("request 15: original measured request receipt expires at exactly 30s; generic 4096 is reproduced", () => {
    const f = evidence(T15); // runtime modeled fresh and matching: isolates the *real* expired request receipt
    expect(f.profile.contextCalibration?.expiresAt).toBeGreaterThan(T15);
    expect(exactProof(f)?.proof?.expiresAt).toBeGreaterThan(T15);
    expect(f.profile.toolVerification?.proof?.expiresAt).toBeGreaterThan(T15);
    expect(snapshotContext(f.state, f.profile, f.snapshot)).toBeUndefined();
    expect(tiers(f)).toEqual([]);
    expect(profileBudgetLimits(f.state, f.profile.id, f.snapshot).runtimeTarget).toBeUndefined();
    expect(budget(f)).toMatchObject({ ceiling: 4096, source: "unknown-policy", fits: false });
    expect(budget(f).reason).toContain("4096-token planning policy");
    // Repaired Agent path should never disguise this loss as a model context-overflow.
    mockNative(f);
    return expect(initialAgentPreflight(f).prepare(body())).rejects.toMatchObject({
      code: "ollama-context-unverified",
    });
  });

  it("completed inference-14 refreshes a nearly expired real receipt before the next Agent request", async () => {
    const f = evidence(T14);
    const native = mockNative(f, () => {
      // Simulates what the actual native provider metadata handshake returns
      // AFTER a completed request, not an invented historical proof.
      const next = structuredClone(f.snapshot);
      next.observedAt = Date.now();
      next.models[0].evidence = next.models[0].evidence.map(e =>
        ["probe.requestedContext", "probe.loadedContext", "probe.runtimeAllocation", "probe.loaded"].includes(e.metric)
          ? { ...e, observedAt: Date.now() } : e);
      return next;
    });
    const p = preflight(f);
    await (await p.prepare(body()))(); // only mocked native identity/preflight; no provider fetch
    vi.setSystemTime(T14_FINISH);
    await p.observeOllamaRuntime();
    expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === "self_hosted_probe")).toHaveLength(1);
    expect(native.getSnapshot().models[0].evidence.find(e =>
      e.metric === "probe.requestedContext")?.observedAt).toBe(T14_FINISH);
    vi.setSystemTime(T15);
    rememberContextRuntime(f.profile.endpointId, {
      epoch: EXPECTED.epoch, version: "0.40.11", at: T15,
      configurationRevision: f.state.endpoints[0].configurationRevision,
    });
    await (await p.prepare(body()))(); // same genuine stored proof, new metadata only
    expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === "self_hosted_probe")).toHaveLength(1);
    expect(native.getSnapshot().models[0].evidence.find(e =>
      e.metric === "probe.loadedContext")?.value).toBe(TIER);
  });

  it("genuine persisted 32K proof survives successive initial Agent generations after a bounded post-finish metadata refresh", async () => {
    const f = evidence(T14);
    const native = mockNative(f, () => {
      // Test-only simulated read of the known selected tier after a real
      // completed request; original saved proof ID, scope, TTL stay unchanged.
      const next = structuredClone(f.snapshot);
      next.observedAt = Date.now();
      next.models[0].evidence = next.models[0].evidence.map(e =>
        ["probe.requestedContext", "probe.loadedContext", "probe.runtimeAllocation", "probe.loaded"].includes(e.metric)
          ? { ...e, observedAt: Date.now() } : e);
      return next;
    });
    const initial = initialAgentPreflight(f);
    const request14 = fullInitialBody();
    await (await initial.prepare(request14))();
    expect(request14.options.num_ctx).toBe(TIER);
    vi.setSystemTime(T14_FINISH);
    await initial.observeOllamaRuntime();
    vi.setSystemTime(T15);
    rememberContextRuntime(f.profile.endpointId, {
      epoch: EXPECTED.epoch, version: "0.40.11", at: T15,
      configurationRevision: f.state.endpoints[0].configurationRevision,
    });
    const next = initialAgentPreflight(f);
    const request15 = fullInitialBody();
    await (await next.prepare(request15))();
    expect(request15.options.num_ctx).toBe(TIER);
    expect(automaticAgentRecommendation(f.state, f.profile, TIER)?.record.id).toBe(EXPECTED.proof32);
    expect(native.getSnapshot().models[0].evidence.find(e => e.metric === "probe.requestedContext")?.observedAt)
      .toBe(T14_FINISH);
    // Exactly one native *metadata* refresh across the two preflights.
    expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === "self_hosted_probe")).toHaveLength(1);
  });

  it("after a long gap without a new measured receipt, Agent fails with requalification error, never capacity overflow", async () => {
    const f = evidence(T15 + 60000);
    mockNative(f);
    expect(tiers(f)).toEqual([]);
    await expect(initialAgentPreflight(f).prepare(body())).rejects.toMatchObject({
      code: "ollama-context-unverified",
    });
  });

  it("digest, epoch, missing exact proof and genuinely expired calibration each remain fail-closed", async () => {
    {
      const f = evidence(T14);
      f.profile.modelRevision = "changed-digest";
      expect(tiers(f)).toEqual([]);
      mockNative(f);
      await expect(initialAgentPreflight(f).prepare(body())).rejects.toThrow();
    }
    {
      const f = evidence(T14);
      f.profile.contextCalibration!.scope.runtimeEpoch = "changed-epoch";
      expect(tiers(f)).toEqual([]);
      mockNative(f);
      await expect(initialAgentPreflight(f).prepare(body())).rejects.toThrow();
    }
    {
      const f = evidence(T14);
      f.profile.agentToolTierProofs = [];
      expect(automaticAgentRecommendation(f.state, f.profile, TIER)).toBeUndefined();
      mockNative(f);
      await expect(initialAgentPreflight(f).prepare(body())).rejects.toThrow();
    }
    {
      const f = evidence(T14);
      f.profile.contextCalibration!.expiresAt = T14 - 1;
      expect(tiers(f)).toEqual([]);
      mockNative(f);
      await expect(initialAgentPreflight(f).prepare(body())).rejects.toThrow();
    }
  });

  it("stale allocation blocks the Agent and unverified model cannot inherit 32K; 73K proof cannot be borrowed for 32K", async () => {
    const f = evidence(T14);
    const loaded = f.profile.evidence.find(e => e.metric === "probe.loadedContext")!;
    loaded.observedAt = T14 - 30001;
    f.snapshot.models[0].evidence = f.profile.evidence;
    expect(tiers(f)).toEqual([]);
    expect(budget(f)).toMatchObject({ ceiling: 4096, source: "unknown-policy" });
    mockNative(f);
    await expect(initialAgentPreflight(f).prepare(body())).rejects.toMatchObject({
      code: "ollama-context-unverified",
    });
    // Separate legitimate lower trusted tier and higher proof do not commute.
    const valid = evidence(T14);
    valid.profile.agentToolTierProofs = [];
    expect(automaticAgentRecommendation(valid.state, valid.profile, TIER)).toBeUndefined();
    expect(automaticAgentRecommendation(valid.state, valid.profile, CALIBRATED)?.record.id)
      .toBe(EXPECTED.proof73);
    expect(minimumSafeContext(profileBudgetLimits(valid.state, valid.profile.id, valid.snapshot),
      ESTIMATE, OUTPUT, tiers(valid), tier =>
        !!automaticAgentRecommendation(valid.state, valid.profile, tier))).toBe(CALIBRATED);
    expect(resolveContextBudget({}, ESTIMATE, OUTPUT)).toMatchObject({
      ceiling: 4096, source: "unknown-policy", fits: false,
    });
  });

  it("a truly trusted smaller ceiling fails required complete budget rather than borrowing higher proof", () => {
    const limits = { runtimeTarget: TIER, advertised: 131072 };
    const budget32 = resolveContextBudget(limits, ESTIMATE, OUTPUT);
    expect(budget32).toMatchObject({ ceiling: TIER, fits: true, source: "requested", margin: 1560 });
    expect(resolveContextBudget({ ...limits, runtimeTarget: 16384 }, ESTIMATE, OUTPUT))
      .toMatchObject({ ceiling: 16384, fits: false });
    expect(requireAgentContinuationAllocation(TIER, TIER)).toBeUndefined();
    expect(() => requireAgentContinuationAllocation(TIER, 16384)).toThrow(/changed/);
  });
});
