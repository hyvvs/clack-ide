import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createRequestPreflight } from "@/modules/ai/lib/requestPreflight";
import { automaticAgentBatchContext, automaticAgentRecommendation } from "@/modules/ai/lib/agentConfiguration";
import { toolScope } from "@/modules/ai/lib/toolVerification";
import type { ToolVerification } from "@/modules/ai/lib/toolVerificationSchema";
import { ollamaEffortFixture } from "@/modules/ai/lib/reasoningEffort.fixture";
import { contextReasoningIdentity, forgetContextRuntime, rememberContextRuntime } from "@/modules/ai/lib/contextCalibrationTrust";
import { profileEvidence } from "@/modules/ai/lib/selfHostedProfiles";
import { readSelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { freshVerifiedContextTiers, minimumSafeContext } from "@/modules/ai/lib/minimumSafeContext";
import { measureRequest, type RequestCost } from "@/modules/ai/lib/contextBudget";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";
import { profileBudgetLimits } from "@/modules/ai/lib/contextBudgetProfile";
import { profileSnapshot } from "@/modules/ai/lib/modelOnboarding";
import { runToolVerification } from "@/modules/ai/lib/toolVerification";

const contexts = [4096, 8192, 16384, 32768, 49152, 65536];
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
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
beforeEach(() => vi.mocked(invoke).mockReset());

function tierProof(f: ReturnType<typeof fixture>, tier: number): ToolVerification {
  const scope = toolScope(f.profile, f.state.endpoints[0], f.now);
  if (!scope) throw new Error("Fixture's runtime trust was unavailable");
  return {
    version: 1, id: "tool-" + tier, scope, status: "verified", outcome: "native-call",
    context: tier, output: 512, attempts: [{ output: 512, outcome: "native-call",
      finish: "tool-calls", startedAt: f.now - 3, completedAt: f.now - 2 }],
    startedAt: f.now - 3, completedAt: f.now - 2,
    firstBodyAt: f.now - 2, callAt: f.now - 2, calls: 1,
    validArguments: true, textualIntent: false, textChars: 0,
    finish: "tool-calls", proof: { at: f.now - 2, expiresAt: f.now + 60000 },
    retryAfter: f.now + 60000,
  };
}

function tierPreflight(f: ReturnType<typeof fixture>, options: {
  verifyAgentTier?: (tier: number) => Promise<typeof f.state>;
  onAgentTierSelected?: (state: typeof f.state, proof: ToolVerification) => void;
  requiredRuntimeContext?: number;
  requiredContinuationProof?: ToolVerification;
} = {}) {
  let persisted = f.state;
  f.profile.toolVerification = tierProof(f, 65536);
  const original = structuredClone(f.state);
  const snapshot = () => ({ ...f.snapshot, observedAt: f.now, models: [{ ...f.snapshot.models[0],
    evidence: f.profile.evidence }] });
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === undefined) return null;
    if (command === "self_hosted_profiles_snapshot") return [["selfHostedInference", persisted]];
    if (command === "self_hosted_probe_cache" || command === "self_hosted_probe") return snapshot();
    throw new Error("Unexpected native command " + String(command) + " in tier preflight fixture");
  });
  const preflight = createRequestPreflight({
    state: original, local: true, providerId: "ollama",
    modelId: f.profile.transportModelId,
    admission: { endpointId: f.profile.endpointId, profileId: f.profile.id, capacity: 1 },
    ...options,
    verifyAgentTier: options.verifyAgentTier ? async (tier) => {
      const next = await options.verifyAgentTier!(tier);
      persisted = next;
      return next;
    } : undefined,
  });
  // Complete serialized source/previous effects/native schema. Its >16K input
  // estimate plus the full 8192 output allowance fits 32768 but not 16384.
  const body = () => ({
    model: f.profile.transportModelId, stream: true,
    options: { num_ctx: options.requiredRuntimeContext ?? 65536, num_predict: 8192 },
    messages: [
      { role: "system", content: "Project policy: never drop required source, history or tool effects." },
      { role: "assistant", content: "Summary: " + "retained-work ".repeat(2200) },
      { role: "tool", content: "Original completed tool result must not be dropped." },
      { role: "user", content: "Safely inspect the existing workspace; do not build an application." },
    ],
    tools: [{ type: "function", function: { name: "list_directory", description: "Read only.",
      parameters: { type: "object", properties: { path: { type: "string" } } } } }],
  });
  return { preflight, body, getPersisted: () => persisted, setPersisted: (value: typeof f.state) => { persisted = value; }, original };
}

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
          metric === "requestedContext" ? "measured" : "backend-reported", f.now,
          metric === "requestedContext" ? "observed" : "reported"),
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
  it("rejects unmeasured, stale, misordered or cross-identity lower-tier request receipts", () => {
    const f = fixture();
    const set = (metric: string, value: string | number, source: "measured" | "backend-reported",
      at = f.now, scope = {}) => {
      f.profile.evidence = [
        ...f.profile.evidence.filter(e => e.metric !== "probe." + metric),
        { ...profileEvidence(f.state, f.profile.id, "probe." + metric, value,
          source, at, source === "measured" ? "observed" : "reported"), scope: {
          ...f.profile.evidence[0].scope, ...scope,
        } },
      ];
      f.snapshot.models[0].evidence = f.profile.evidence;
    };
    set("loadedContext", 32768, "backend-reported");
    set("runtimeAllocation", "fresh-lower-allocation", "backend-reported");
    set("requestedContext", 32768, "backend-reported");
    expect(freshVerifiedContextTiers(f.state, f.profile, f.snapshot, f.now)).toEqual([]);
    set("requestedContext", 32768, "measured");
    expect(freshVerifiedContextTiers(f.state, f.profile, f.snapshot, f.now)).toEqual(contexts);
    set("requestedContext", 32768, "measured", f.now - 30_001);
    expect(freshVerifiedContextTiers(f.state, f.profile, f.snapshot, f.now)).toEqual([]);
    set("requestedContext", 32768, "measured", f.now, { modelRevision: "different-digest" });
    expect(freshVerifiedContextTiers(f.state, f.profile, f.snapshot, f.now)).toEqual([]);
    set("requestedContext", 32768, "measured", f.now);
    set("loadedContext", 32768, "backend-reported", f.now - 1);
    expect(freshVerifiedContextTiers(f.state, f.profile, f.snapshot, f.now)).toEqual([]);
  });
  it("persists 32K proof after genuine completed tool call and native-observed lower allocation, without inheriting 65K", async () => {
    const f = fixture(Date.now());
    let state = f.state;
    const profile = () => state.profiles[0];
    profile().toolVerification = tierProof(f, 65536);
    const originalProofId = profile().toolVerification?.id;
    const request = vi.fn(async () => {
      const receipt = (metric: string, value: number | string, measured = false) =>
        profileEvidence(state, profile().id, "probe." + metric, value,
          measured ? "measured" : "backend-reported", f.now,
          measured ? "observed" : "reported");
      profile().evidence = [
        ...profile().evidence.filter(e => !["probe.requestedContext", "probe.loadedContext", "probe.runtimeAllocation"].includes(e.metric)),
        receipt("requestedContext", 32768, true),
        receipt("loadedContext", 32768),
        receipt("runtimeAllocation", "genuine-32k-allocation"),
      ];
      return { calls: [{ name: "get_probe_value", input: { key: "clack-probe-v1", count: 1 } }],
        text: "", finish: "tool-calls", firstBodyAt: f.now, callAt: f.now };
    });
    const record = await runToolVerification({
      profileId: profile().id, tierContext: 32768, signal: new AbortController().signal,
    }, {
      refresh: async () => state,
      inspect: async () => rememberContextRuntime(f.state.endpoints[0].id, {
        epoch: "running-process", version: "0.40.11", at: f.now,
        configurationRevision: f.state.endpoints[0].configurationRevision,
      }),
      context: (s, p) => {
        const tiers = freshVerifiedContextTiers(s, p, profileSnapshot(s, p), f.now);
        if (!tiers.includes(32768)) throw new Error("Tool tier is not freshly calibrated under the current provider runtime");
        return 32768;
      },
      request,
      commit: async change => { state = readSelfHostedState(structuredClone(change(state))); return state; },
      clock: () => f.now,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(record).toMatchObject({ status: "verified", outcome: "native-call", context: 32768,
      calls: 1, validArguments: true });
    expect(profile().agentToolTierProofs?.[0]).toMatchObject({ context: 32768, status: "verified",
      proof: record && "proof" in record ? record.proof : null });
    expect(record && "proof" in record && record.proof).not.toBeNull();
    expect(profile().toolVerification?.id).toBe(originalProofId);
    expect(profile().toolVerification?.context).toBe(65536);
  });
});

describe("Agent exact-tier native proof admission", () => {
  it("requires 32K genuine verification when only 65K is proved, then serializes exactly 32K", async () => {
    const f = fixture(Date.now());
    const asked: number[] = [], selected: number[] = [];
    const p = tierPreflight(f, {
      verifyAgentTier: async tier => {
        asked.push(tier);
        expect(tier).toBe(32768);
        f.profile.agentToolTierProofs = [tierProof(f, tier)];
        return f.state;
      },
      onAgentTierSelected: (_state, proof) => selected.push(proof.context),
    });
    const request = p.body(), original = structuredClone(request);
    const gate = await p.preflight.prepare(request);
    expect(request.options).toEqual({ num_ctx: 32768, num_predict: 8192 });
    expect(request.messages).toEqual(original.messages);
    expect(request.tools).toEqual(original.tools);
    await gate();
    expect(asked).toEqual([32768]);
    expect(selected).toEqual([32768]);
    expect(f.profile.toolVerification?.context).toBe(65536);
    expect(automaticAgentRecommendation(p.getPersisted(), f.profile, 32768)?.record.context).toBe(32768);
    const next = p.body();
    await (await p.preflight.prepare(next))();
    expect(next.options.num_ctx).toBe(32768);
    expect(asked).toEqual([32768]); // no repeat probe while proof remains fresh
  });
  it("never dispatches a smaller unproven tier when verification fails or proof becomes stale", async () => {
    const f = fixture(Date.now());
    const p = tierPreflight(f, { verifyAgentTier: async () => { throw new Error("native probe failed"); } });
    await expect(p.preflight.prepare(p.body())).rejects.toThrow("native probe failed");
    const f2 = fixture(Date.now());
    const p2 = tierPreflight(f2, {
      verifyAgentTier: async tier => {
        const stale = tierProof(f2, tier);
        stale.proof!.expiresAt = f2.now - 1;
        f2.profile.agentToolTierProofs = [stale];
        return f2.state;
      },
    });
    await expect(p2.preflight.prepare(p2.body())).rejects.toMatchObject({ code: "agent-tier-tool-unverified" });
  });
  it("does not approve an existing exact-tier proof revoked after the request was prepared", async () => {
    const f = fixture(Date.now());
    f.profile.agentToolTierProofs = [tierProof(f, 32768)];
    const p = tierPreflight(f);
    const body = p.body();
    const finalGate = await p.preflight.prepare(body);
    expect(body.options.num_ctx).toBe(32768);
    const revoked = structuredClone(p.getPersisted());
    revoked.profiles[0].agentToolTierProofs = [];
    p.setPersisted(revoked);
    await expect(finalGate()).rejects.toMatchObject({ code: "agent-tier-tool-unverified" });
  });
  it("reverifies a stale lower-tier proof rather than borrowing fresh 65K proof", async () => {
    const f = fixture(Date.now());
    f.profile.agentToolTierProofs = [tierProof(f, 32768)];
    f.profile.agentToolTierProofs[0].proof!.expiresAt = f.now - 1;
    const requested: number[] = [];
    const p = tierPreflight(f, { verifyAgentTier: async tier => {
      requested.push(tier);
      f.profile.agentToolTierProofs = [tierProof(f, tier)];
      return f.state;
    } });
    const body = p.body();
    await (await p.preflight.prepare(body))();
    expect(requested).toEqual([32768]);
    expect(body.options.num_ctx).toBe(32768);
  });
  it("growth selects the next verified tier and cannot borrow 32K proof", async () => {
    const f = fixture(Date.now());
    f.profile.toolVerification = tierProof(f, 65536);
    f.profile.agentToolTierProofs = [tierProof(f, 32768)];
    const p = tierPreflight(f);
    const request = p.body();
    request.messages[1].content += "extra-work ".repeat(3300);
    const before = structuredClone(request.messages);
    // 32K is insufficient: it must choose a larger calibrated tier with
    // *matching* native tool proof, never silently drop the history.
    const gate = await p.preflight.prepare(request);
    await gate();
    expect(request.options.num_ctx).toBe(65536);
    expect(request.messages).toEqual(before);
  });
  it("uses next fitting 49K tier only with its own proof when the request grows", async () => {
    const f = fixture(Date.now());
    f.profile.agentToolTierProofs = [tierProof(f, 32768), tierProof(f, 49152)];
    const p = tierPreflight(f);
    const body = p.body();
    body.messages[1].content += "extra-work ".repeat(3300);
    await (await p.preflight.prepare(body))();
    expect(body.options.num_ctx).toBe(49152);
  });
  it("pins logical continuation to the exact retained tier-proof id", async () => {
    const f = fixture(Date.now());
    f.profile.toolVerification = tierProof(f, 65536);
    f.profile.agentToolTierProofs = [tierProof(f, 32768)];
    const choice = automaticAgentBatchContext(f.state, f.profile, { recommended: 65536 }, true, "tool-32768");
    expect(choice).toEqual({ expected: 32768, pinned: 32768 });
    const p = tierPreflight(f, { requiredRuntimeContext: 32768, requiredContinuationProof: tierProof(f, 32768) });
    const request = p.body();
    await (await p.preflight.prepare(request))();
    expect(request.options.num_ctx).toBe(32768);
    f.profile.agentToolTierProofs = []; // missing continuation proof is terminal
    await expect((await p.preflight.prepare(p.body()))()).rejects.toMatchObject({ code: "agent-tool-proof-stale" });
  });
  it("rejects lower tier when manual profile context is authoritative", async () => {
    const f = fixture(Date.now());
    f.profile.overrides.workingContext = {
      mode: "manual", evidence: profileEvidence(f.state, f.profile.id, "workingContext", 65536,
        "user-assertion", f.now, "unverified"),
    };
    f.profile.agentToolTierProofs = [tierProof(f, 32768)];
    const p = tierPreflight(f);
    const body = p.body();
    await (await p.preflight.prepare(body))();
    expect(body.options.num_ctx).toBe(65536);
  });
  it("blocks a continuation if a manual pin conflicts with its retained exact tier", async () => {
    const f = fixture(Date.now());
    f.profile.overrides.workingContext = {
      mode: "manual", evidence: profileEvidence(f.state, f.profile.id, "workingContext", 65536,
        "user-assertion", f.now, "unverified"),
    };
    f.profile.agentToolTierProofs = [tierProof(f, 32768)];
    const p = tierPreflight(f, { requiredRuntimeContext: 32768,
      requiredContinuationProof: tierProof(f, 32768) });
    await expect(p.preflight.prepare(p.body())).rejects.toMatchObject({ code: "ollama-context-tier-stale" });
  });
});
