import { afterEach, describe, expect, it } from "vitest";
import { ollamaEffortFixture } from "@/modules/ai/lib/reasoningEffort.fixture";
import { contextReasoningIdentity, forgetContextRuntime, rememberContextRuntime } from "@/modules/ai/lib/contextCalibrationTrust";
import { profileEvidence } from "@/modules/ai/lib/selfHostedProfiles";
import { freshVerifiedContextTiers, minimumSafeContext } from "@/modules/ai/lib/minimumSafeContext";
import { measureRequest, type RequestCost } from "@/modules/ai/lib/contextBudget";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";
import { profileBudgetLimits } from "@/modules/ai/lib/contextBudgetProfile";

const contexts = [4096, 8192, 16384, 32768, 49152, 65536];
const limits = { runtimeTarget: 65536, advertised: 202752, outputReserve: 8192 };
const cost = (system: number, tools: number, conversation: number): RequestCost =>
  ({ system, tools, conversation, uncertainMedia: false });

function fixture(now = 1_000_000) {
  const { state, profile, endpoint } = ollamaEffortFixture([false, true], "context-generic");
  profile.modelRevision = "fresh-digest";
  const allocation = "exact-loaded-allocation";
  const entries: [string, string | number | boolean][] = [
    ["loaded", true], ["loadedContext", 65536], ["runtimeAllocation", allocation],
    ["runtimeContext", "per-request"], ["thinking", true],
    ["thinkingControls", "[false,true]"], ["thinkingDefault", true],
  ];
  profile.evidence = entries.map(([name, value]) =>
    profileEvidence(state, profile.id, "probe." + name, value, "backend-reported", now, "reported"));
  const snapshot: ProbeSnapshot = {
    endpointId: endpoint.id, configurationRevision: endpoint.configurationRevision,
    selectedModelId: profile.transportModelId, observedAt: now,
    connected: true, reachable: true, credentialUsed: false, stale: false,
    refreshing: false, inventoryTtlMs: 300000, instanceTtlMs: 30000,
    errors: [], backend: "ollama",
    models: [{
      id: profile.transportModelId, name: null, chat: "supported",
      digest: profile.modelRevision, evidence: profile.evidence,
    }],
  };
  rememberContextRuntime(endpoint.id, { epoch: "running-process", version: "0.40.11", at: now,
    configurationRevision: endpoint.configurationRevision });
  state.inventories = [{
    endpointId: endpoint.id, configurationRevision: endpoint.configurationRevision,
    connected: true, observedAt: now, backend: "ollama",
    models: [{ id: profile.transportModelId, name: null, chat: "supported", digest: profile.modelRevision }],
  }];
  profile.contextCalibration = {
    version: 1, id: "verified", status: "verified", highest: 65536,
    failedNext: null, failure: null, allocation,
    startedAt: now - 6000, updatedAt: now, expiresAt: now + 600_000, retryAfter: 0,
    scope: { endpointId: endpoint.id, configurationRevision: endpoint.configurationRevision,
      model: profile.transportModelId, deployment: profile.deploymentId,
      digest: profile.modelRevision, backend: "ollama", runtimeEpoch: "running-process",
      providerVersion: "0.40.11", reasoning: contextReasoningIdentity(profile, endpoint, now) },
    attempts: contexts.map((context) => ({
      context, requested: context, loaded: context, outcome: "success" as const,
      at: now - 6000 + context, latencyMs: 200, thermal: "warm" as const,
      finish: "stop", think: "omitted" as const,
    })),
  };
  // Timestamps for every attempt must precede 'now' in the trusted tier selector.
  profile.contextCalibration.attempts.forEach((a, i) => { a.at = now - 6 + i; });
  return { state, profile, snapshot, now };
}
afterEach(() => forgetContextRuntime("server"));

describe("minimum-safe calibrated context", () => {
  it("selects the smallest actual verified allocation for a small complete request", () => {
    expect(minimumSafeContext(limits, cost(200, 300, 100), 8192, contexts)).toBe(16384);
  });
  it("selects 32K for the ~24K GLM input/output requirement and never underallocates", () => {
    expect(minimumSafeContext(limits, cost(2000, 2500, 11210), 8192, contexts)).toBe(32768);
    expect(minimumSafeContext(limits, cost(2000, 2500, 11210), 8192, [16384, 65536])).toBe(65536);
  });
  it("advances to next successful tier when the full cost exceeds 32K", () => {
    expect(minimumSafeContext(limits, cost(3000, 3000, 24100), 8192, contexts)).toBe(49152);
  });
  it("does not select absent, failed, unsafe or unverified smaller tiers", () => {
    expect(minimumSafeContext(limits, cost(200, 300, 100), 8192, [4096, 8192, 65536])).toBe(65536);
    expect(minimumSafeContext(limits, cost(200, 300, 100), 8192, [])).toBeUndefined();
    expect(minimumSafeContext(limits, cost(200, 300, 100), 8192, [32768], () => false)).toBeUndefined();
  });
  it("accounts for the *entire* serialized history, tool outputs and tool schemas without mutating them", () => {
    const wire = {
      model: "fixture", options: { num_ctx: 65536, num_predict: 8192 },
      messages: [
        { role: "system", content: "Critical instructions" },
        { role: "user", content: "Do not delete the original work" },
        { role: "assistant", content: [{ type: "tool-call", toolName: "write_file", toolCallId: "c", input: { path: "a.ts" } }] },
        { role: "tool", content: [{ type: "tool-result", toolName: "write_file", toolCallId: "c", output: { type: "text", value: "previous completed effect" } }] },
      ],
      tools: [{ type: "function", function: { name: "write_file", parameters: { type: "object", properties: { content: { type: "string" } } } } }],
    };
    const original = structuredClone(wire);
    const total = measureRequest(wire);
    const selected = minimumSafeContext(limits, total, 8192, contexts);
    expect(selected).toBe(16384);
    expect(wire).toEqual(original);
    expect(total.system).toBeGreaterThan(0);
    expect(total.tools).toBeGreaterThan(0);
    expect(total.conversation).toBeGreaterThan(0);
    const missing = minimumSafeContext(limits,
      { ...total, conversation: total.conversation + 25_000 }, 8192, contexts);
    expect(missing).toBeGreaterThan(selected!);
  });
  it("includes full output reserve, configured reserve and conservative input margin", () => {
    expect(minimumSafeContext(limits, cost(2000, 2000, 8000), 8192, contexts)).toBe(32768);
    expect(minimumSafeContext({ ...limits, outputReserve: 16384 }, cost(2000, 2000, 8000), 8192, contexts)).toBe(32768);
    expect(minimumSafeContext(limits, cost(2000, 2000, 8000), 16384, contexts)).toBe(32768);
    expect(minimumSafeContext(limits, cost(0, 0, 7000), 8192, contexts)).toBe(16384);
  });
  it("filters tier attempts by *fresh* digest, runtime epoch, loaded context and identity", () => {
    const f = fixture();
    expect(freshVerifiedContextTiers(f.state, f.profile, f.snapshot, f.now)).toEqual(contexts);
    f.profile.contextCalibration!.attempts[1].outcome = "timeout";
    expect(freshVerifiedContextTiers(f.state, f.profile, f.snapshot, f.now)).not.toContain(8192);
    f.profile.contextCalibration!.attempts[1].outcome = "success";
    expect(freshVerifiedContextTiers(f.state, f.profile, f.snapshot, f.now + 31_000)).toEqual([]);
    expect(freshVerifiedContextTiers(f.state, f.profile, { ...f.snapshot, stale: true }, f.now)).toEqual([]);
    expect(freshVerifiedContextTiers(f.state, f.profile, { ...f.snapshot,
      models: [{ ...f.snapshot.models[0], digest: "changed" }] }, f.now)).toEqual([]);
    f.profile.contextCalibration!.scope.runtimeEpoch = "another-process";
    expect(freshVerifiedContextTiers(f.state, f.profile, f.snapshot, f.now)).toEqual([]);
  });
  it("retains highest trusted ceiling after genuine smaller per-request loading, not arbitrary capacity drift", () => {
    const f = fixture();
    const set = (metric: string, value: string | number | boolean) => {
      f.profile.evidence = [
        ...f.profile.evidence.filter(item => item.metric !== "probe." + metric),
        profileEvidence(f.state, f.profile.id, "probe." + metric, value,
          "backend-reported", f.now, "reported"),
      ];
      f.snapshot.models[0].evidence = f.profile.evidence;
    };
    set("loadedContext", 32768);
    set("requestedContext", 32768);
    set("runtimeAllocation", "real-smaller-allocation");
    expect(freshVerifiedContextTiers(f.state, f.profile, f.snapshot, f.now)).toEqual(contexts);
    expect(profileBudgetLimits(f.state, f.profile.id, f.snapshot, f.now).runtimeTarget).toBe(65536);
    set("requestedContext", 16384); // provider response does not match the requested tier
    expect(freshVerifiedContextTiers(f.state, f.profile, f.snapshot, f.now)).toEqual([]);
    set("requestedContext", 32768);
    set("loadedContext", 30000); // a non-calibrated runtime capacity may not inherit proof
    expect(freshVerifiedContextTiers(f.state, f.profile, f.snapshot, f.now)).toEqual([]);
    set("loadedContext", 32768);
    set("runtimeAllocation", ""); // missing fresh allocation is not trusted
    expect(freshVerifiedContextTiers(f.state, f.profile, f.snapshot, f.now)).toEqual([]);
  });
});
