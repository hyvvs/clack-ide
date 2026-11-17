/** Pure, offline contract tests: no provider, model, Tauri command, or network.
 * Uses the already preserved authentic 2026-11-04 calibration and native-tool
 * records; hypothetical changes below are adversarial inputs, not new proofs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import preserved from "./fixtures/forgeboardContextCapacityEvidence20261105.json";
import { agentBudgetLimits, resolveAgentOutputBudget } from "@/modules/ai/lib/agentOutputBudget";
import { resolveContextBudget, type RequestCost } from "@/modules/ai/lib/contextBudget";
import { targetContextKey } from "@/modules/ai/lib/targetContext";
import { readSelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { profileBudgetLimits } from "@/modules/ai/lib/contextBudgetProfile";
import { profileSnapshot } from "@/modules/ai/lib/modelOnboarding";
import { rememberContextRuntime, forgetContextRuntime } from "@/modules/ai/lib/contextCalibrationTrust";
import { freshVerifiedContextTiers, minimumSafeContext } from "@/modules/ai/lib/minimumSafeContext";
import { automaticAgentBatchContext, automaticAgentRecommendation, requireAgentContinuationAllocation } from "@/modules/ai/lib/agentConfiguration";
import { agentCalibrationRenewalDue } from "@/modules/ai/lib/agentCalibrationRenewal";
import { resolveModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import { selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { captureEffort } from "@/modules/ai/lib/reasoningEffort";
import type { LocalProviderConfig } from "@/modules/ai/lib/agent";

const NOW = preserved.request14At;
const TIER = 32768;
const UPPER = 73728;
const PROOF = "cb19394f-4fa7-4af8-ac6d-1a28486d16a0";
const EPOCH = "40776:1793832712338782000";
const cost: RequestCost = {
  system: 4729, tools: 6499, conversation: 4364, uncertainMedia: false,
};
const capabilities = {
  text: "supported", image: "unknown", document: "unknown",
  tools: "supported", audio: "unknown", evidence: "server",
} as const;

function preservedState() {
  const state = readSelfHostedState(structuredClone(preserved.state));
  const profile = state.profiles[0];
  const endpoint = state.endpoints[0];
  expect(profile?.modelRevision).toBe(preserved.digest);
  expect(profile.contextCalibration?.status).toBe("verified");
  rememberContextRuntime(endpoint.id, {
    epoch: EPOCH, version: "0.40.11",
    configurationRevision: endpoint.configurationRevision, at: NOW,
  });
  return { state, profile, endpoint };
}
type Fixture = ReturnType<typeof preservedState>;
function config(f: Fixture): LocalProviderConfig {
  const selectionId = selfHostedSelectionId(f.profile);
  const identity = resolveModelTransportIdentity(selectionId, { selfHostedInference: f.state });
  const reasoning = captureEffort(selectionId, identity, undefined, f.state);
  return { selfHostedInference: f.state, reasoning };
}
function budgets(f: Fixture) {
  const snap = profileSnapshot(f.state, f.profile);
  expect(snap).not.toBeNull();
  const raw = profileBudgetLimits(f.state, f.profile.id, snap);
  const prepared = agentBudgetLimits(raw, config(f).reasoning, { hasExposedAgentTools: true });
  return { raw, prepared, snap: snap! };
}
function input(f: Fixture, limits = budgets(f).prepared): Parameters<typeof targetContextKey>[0] {
  return {
    modelId: selfHostedSelectionId(f.profile),
    configuration: config(f),
    system: [{ role: "system", content: "Keep requirements and exact tool effects." }],
    tools: { exposure: "verified-native-tools", schemas: [{ name: "read_file", type: "function" }] },
    limits, capabilities,
    permissions: [["agent-approved"], ["workspace-read"]],
    workspace: ["local:/offline-project", "builtin:coder"],
    credentials: [{}, {}],
  };
}
function verified(f: Fixture) {
  return freshVerifiedContextTiers(f.state, f.profile, profileSnapshot(f.state, f.profile));
}
function select(f: Fixture, output = 8192) {
  return minimumSafeContext(budgets(f).prepared, cost, output, verified(f),
    tier => !!automaticAgentRecommendation(f.state, f.profile, tier));
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { forgetContextRuntime("real-qwen"); vi.useRealTimers(); });

describe("staged target-context key and Agent output/verified-context contract (offline)", () => {
  it("1: identical provider/model/runtime, system, tools and Agent output contract generate the identical staged and run key", async () => {
    const f = preservedState();
    const limits = budgets(f);
    const staged = input(f, agentBudgetLimits(limits.raw, config(f).reasoning));
    const running = input(f, agentBudgetLimits(limits.raw, config(f).reasoning,
      { hasExposedAgentTools: true }));
    expect(await targetContextKey(staged)).toBe(await targetContextKey(running));
    expect(staged.limits.outputReserve).toBe(running.limits.outputReserve);
    expect(resolveModelTransportIdentity(staged.modelId, staged.configuration).providerId).toBe("ollama");
  });

  it("2: staged 32K native proof and 32K measured allocation preserve 32K selection for the complete 25.3K budget", async () => {
    const f = preservedState();
    expect(verified(f)).toContain(TIER);
    expect(f.profile.agentToolTierProofs?.[0].id).toBe(PROOF);
    expect(automaticAgentRecommendation(f.state, f.profile, TIER)?.record.id).toBe(PROOF);
    expect(select(f)).toBe(TIER);
    expect(resolveContextBudget({ runtimeTarget: TIER, outputReserve: 8192 }, cost, 8192))
      .toMatchObject({ ceiling: TIER, reserve: 8192, fits: true });
    expect(await targetContextKey(input(f))).toBe(await targetContextKey(input(f)));
  });

  it("3: an eligible higher calibrated 73K tier does not replace the selected, exact-proved 32K tier", () => {
    const f = preservedState();
    expect(f.profile.contextCalibration?.highest).toBe(UPPER);
    expect(verified(f)).toContain(UPPER);
    expect(select(f)).toBe(TIER);
    // No proof borrowing: remove only lower proof from a hypothetical state.
    f.profile.agentToolTierProofs = [];
    expect(automaticAgentRecommendation(f.state, f.profile, TIER)).toBeUndefined();
    expect(automaticAgentRecommendation(f.state, f.profile, UPPER)?.record.context).toBe(UPPER);
    expect(select(f)).toBe(UPPER);
  });

  it("4: digest change invalidates old selected identity, key, calibrated context and native proof", async () => {
    const f = preservedState();
    const before = input(f);
    await expect(targetContextKey(before)).resolves.toMatch(/^[0-9a-f]{64}$/);
    const oldSelection = before.modelId;
    f.profile.modelRevision = "changed-digest-without-new-measurement";
    expect(() => resolveModelTransportIdentity(oldSelection, config(f))).toThrow();
    expect(verified(f)).toEqual([]);
    expect(automaticAgentRecommendation(f.state, f.profile, TIER)).toBeUndefined();
    // The stronger deployment-identity gate rejects this hypothetical
    // changed digest altogether; it cannot be transformed into a seemingly
    // qualified new context key for an old model selection.
    expect(() => input(f)).toThrow(/Model unavailable|Model changed/);
  });

  it("5: runtime epoch mismatch invalidates trust and a changed scoped calibration changes the target key", async () => {
    const f = preservedState();
    const before = await targetContextKey(input(f));
    rememberContextRuntime(f.endpoint.id, {
      epoch: "different-runtime", version: "0.40.11", configurationRevision: 1, at: NOW,
    });
    expect(verified(f)).toEqual([]);
    expect(automaticAgentRecommendation(f.state, f.profile, TIER)).toBeUndefined();
    // Hypothetical different recorded epoch, never accepted as real proof.
    f.profile.contextCalibration!.scope.runtimeEpoch = "unproven-calibration-epoch";
    expect(await targetContextKey(input(f))).not.toBe(before);
    expect(verified(f)).toEqual([]);
  });

  it("6: provider, transport model and endpoint identity changes invalidate keys independently", async () => {
    const f = preservedState();
    const baseline = input(f);
    const old = await targetContextKey(baseline);
    const changedEndpoint = structuredClone(baseline);
    changedEndpoint.configuration.selfHostedInference!.endpoints[0].baseURL =
      "http://127.0.0.1:11991/";
    expect(await targetContextKey(changedEndpoint)).not.toBe(old);
    // Public, offline ID mapping only: no network access to either adapter.
    const cloud = { ...baseline, modelId: "deepseek-v4-flash", configuration: {} };
    const another = { ...baseline, modelId: "gpt-4.1-mini", configuration: {} };
    expect(resolveModelTransportIdentity(cloud.modelId, cloud.configuration).providerId).toBe("deepseek");
    expect(resolveModelTransportIdentity(another.modelId, another.configuration).providerId).toBe("openai");
    expect(await targetContextKey(cloud)).not.toBe(old);
    expect(await targetContextKey(another)).not.toBe(await targetContextKey(cloud));
  });

  it("7: calibration renewal is not due; later calibration-data changes conservatively invalidate saved context without granting proof", async () => {
    const f = preservedState();
    expect(agentCalibrationRenewalDue(f.profile.contextCalibration?.expiresAt, NOW)).toBe(false);
    const beforeKey = await targetContextKey(input(f));
    const beforeTier = select(f);
    expect(beforeTier).toBe(TIER);
    // Hypothetical calibration ID change tests cache invalidation only; it
    // is not a claim that a new calibration or native proof was performed.
    const clone = structuredClone(f.state);
    clone.profiles[0].contextCalibration!.id = "new-unproven-calibration-id";
    const changed = { ...f, state: clone, profile: clone.profiles[0] };
    expect(await targetContextKey(input(changed))).not.toBe(beforeKey);
    expect(await targetContextKey(input(f))).toBe(beforeKey);
    expect(select(f)).toBe(beforeTier);
  });

  it("8: a read-only metadata refresh does not promote context; a changed receipt invalidates only cached snapshot reuse", async () => {
    const f = preservedState();
    const oldKey = await targetContextKey(input(f));
    const originalProof = f.profile.agentToolTierProofs?.[0].id;
    const refreshed = structuredClone(f.state);
    // A simulated hypothetical native metadata receipt, not a new proof:
    // same exact measured 32K pair and loaded allocation, later observation.
    for (const e of refreshed.profiles[0].evidence) {
      if (["probe.requestedContext", "probe.loadedContext",
        "probe.runtimeAllocation", "probe.loaded"].includes(e.metric))
        e.observedAt = NOW;
    }
    const changed = { ...f, state: refreshed, profile: refreshed.profiles[0] };
    expect(await targetContextKey(input(changed))).not.toBe(oldKey);
    expect(changed.profile.agentToolTierProofs?.[0].id).toBe(originalProof);
    expect(verified(changed)).toContain(TIER);
    expect(select(changed)).toBe(TIER);
  });

  it("9: continuation after compaction is pinned to its own real 32K proof, not recomputed to the larger calibration", async () => {
    const f = preservedState();
    const beforeKey = await targetContextKey(input(f));
    const next = automaticAgentBatchContext(f.state, f.profile,
      { recommended: UPPER }, true, PROOF);
    expect(next).toEqual({ expected: TIER, pinned: TIER });
    expect(automaticAgentRecommendation(f.state, f.profile, next.pinned)?.record.id).toBe(PROOF);
    expect(requireAgentContinuationAllocation(next.pinned, TIER)).toBeUndefined();
    expect(() => requireAgentContinuationAllocation(next.pinned, UPPER)).toThrow(/changed/);
    expect(await targetContextKey(input(f))).toBe(beforeKey);
  });

  it("10: key invalidation for different output allowance does not turn intact 32K trust into 4K unverified fallback", async () => {
    const f = preservedState();
    const { raw, prepared } = budgets(f);
    const rawKey = await targetContextKey(input(f, raw));
    const safeKey = await targetContextKey(input(f, prepared));
    expect(rawKey).not.toBe(safeKey); // previous production mismatch is real
    expect(prepared.outputReserve).toBeGreaterThan(0);
    const rawBudget = resolveContextBudget(raw, cost, 8192);
    const safeBudget = resolveContextBudget(prepared, cost, 8192);
    expect(rawBudget.source).not.toBe("unknown-policy");
    expect(safeBudget.source).not.toBe("unknown-policy");
    expect(safeBudget.ceiling).toBeGreaterThanOrEqual(TIER);
    expect(safeBudget.fits).toBe(true);
    expect(select(f)).toBe(TIER);
    expect(resolveAgentOutputBudget(raw, config(f).reasoning))
      .toBe(prepared.outputReserve);
  });

  it("extra: required output, verified caps and disabled promotion still have identical prepare/run Agent policy", () => {
    const f = preservedState();
    const { raw } = budgets(f);
    const policy = config(f).reasoning;
    expect(agentBudgetLimits(raw, policy, { requiredOutput: 1024 }))
      .toEqual(agentBudgetLimits(raw, policy, { requiredOutput: 1024,
        hasExposedAgentTools: true }));
    expect(agentBudgetLimits({ ...raw, maxOutput: 2048 }, policy)
      .outputReserve).toBe(2048);
    expect(agentBudgetLimits({ ...raw, outputReserve: 8192 }, policy)
      .outputReserve).toBeGreaterThanOrEqual(8192);
  });
});
