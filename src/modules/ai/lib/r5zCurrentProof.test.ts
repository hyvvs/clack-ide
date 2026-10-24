import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { runAgentStream, type RunAgentOptions } from "@/modules/ai/lib/agent";
import { createRequestPreflight } from "@/modules/ai/lib/requestPreflight";
import { createProxyFetch } from "@/modules/ai/lib/proxyFetch";
import { runContextCalibration } from "@/modules/ai/lib/contextCalibration";
import { runToolVerification, toolVerificationState } from "@/modules/ai/lib/toolVerification";
import { toolEligibilityPredicates } from "@/modules/ai/lib/toolVerification";
import { agentContinuationReasoningMetadata, automaticAgentBatchContext, automaticAgentRecommendation } from "@/modules/ai/lib/agentConfiguration";
import { ollamaEffortFixture } from "@/modules/ai/lib/reasoningEffort.fixture";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { profileSnapshot, modelOnboarding } from "@/modules/ai/lib/modelOnboarding";
import { selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { profileEvidence, readSelfHostedState, setProfileOverride } from "@/modules/ai/lib/selfHostedProfiles";
import { forgetContextRuntime, rememberContextRuntime } from "@/modules/ai/lib/contextCalibrationTrust";
import type { ToolContext } from "@/modules/ai/tools/context";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class { onmessage = (_event: unknown) => {}; },
}));
vi.mock("@/modules/ai/tools/customExecution", async () => {
  const { tool } = await import("ai");
  const { z } = await import("zod");
  const read = tool({ description: "Read fixture", inputSchema: z.object({ path: z.string() }) });
  return { buildRuntimeTools: async () => ({ read_file: read }) };
});

// Minimal privacy-safe representative of R5x's saved native record/scope and
// measured 304441ms proof-to-continuation gap; never loads the ignored receipts.
const R5X_NATIVE = {
  digest: "e7a64ff15fb174c42b4f463e5c888c4f2c7b9cabf9e8d65a1c0874405426c1b2",
  epoch: "34568:1792797471822992400",
  version: "0.40.7",
  proofAt: 1792797523969,
  continuationAt: 1792797828410,
  thinkingControls: '[false,true,"medium"]',
} as const;

async function fixture(outputAllowance = 2048, alternative = false, ageMs = 194000, r5xRepresentative = false) {
  let now = r5xRepresentative ? R5X_NATIVE.proofAt : 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const f = ollamaEffortFixture(r5xRepresentative ? [false, true, "medium"] : [false, true], "r5w-review-only");
  let state = f.state;
  state.profiles[0].modelRevision = r5xRepresentative ? R5X_NATIVE.digest : "review-digest";
  state.profiles[0].backend = "ollama";
  if (outputAllowance !== 2048) {
    state = setProfileOverride(state, state.profiles[0].id, "maxOutput", outputAllowance);
    state = setProfileOverride(state, state.profiles[0].id, "outputReserve", outputAllowance);
  }
  let loaded = 0;
  let requested = 0;
  let epoch = r5xRepresentative ? R5X_NATIVE.epoch : "review-process";
  let version = r5xRepresentative ? R5X_NATIVE.version : "1.2.3";
  const profile = () => state.profiles[0];
  const inspect = async () => rememberContextRuntime(f.endpoint.id, {
    epoch, version, configurationRevision: f.endpoint.configurationRevision, at: now,
  });
  const refresh = async () => {
    const p = profile();
    p.evidence = Object.entries({
      runtimeContext: "per-request", advertisedContext: r5xRepresentative ? 1048576 : 262144,
      thinking: true, thinkingControls: r5xRepresentative ? R5X_NATIVE.thinkingControls : "[false,true]", thinkingDefault: true,
      trainedForTools: true, loaded: loaded > 0,
      ...(requested ? { requestedContext: requested } : {}),
      ...(loaded ? { loadedContext: loaded, runtimeAllocation: JSON.stringify([p.modelRevision, loaded]) } : {}),
    }).map(([metric, value]) => profileEvidence(state, p.id, `probe.${metric}`, value,
      metric === "requestedContext" ? "measured" : "backend-reported", now,
      metric === "requestedContext" ? "observed" : "reported"));
    state.inventories = [{ endpointId: p.endpointId, configurationRevision: 1, observedAt: now,
      connected: true, backend: "ollama", models: [{ id: p.transportModelId, name: null,
        chat: "supported", digest: p.modelRevision }] }];
    const snapshot = profileSnapshot(state, p);
    if (!snapshot) throw new Error("Expected current profile snapshot");
    return { state, snapshot };
  };
  const commit = async (change: (value: typeof state) => typeof state) => {
    state = readSelfHostedState(structuredClone(change(state)));
    state.revision++;
    return state;
  };
  const controller = new AbortController();
  await runContextCalibration({ state, profileId: profile().id, signal: controller.signal, ceiling: 65536 }, {
    refresh, inspectRuntime: inspect, clock: () => now, commit,
    request: async (context) => { requested = context; loaded = context; now++; return { finish: "stop" }; },
  });
  const toolDeps = {
    refresh: async () => state, inspect, commit, context: () => loaded,
    request: async () => ({ calls: [{ name: "get_probe_value", input: { key: "clack-probe-v1", count: 1 } }],
      text: "", finish: "tool-calls", firstBodyAt: now, callAt: now }),
  };
  await runToolVerification({ profileId: profile().id, signal: controller.signal }, alternative ? {
    ...toolDeps, request: async () => ({ calls: [], text: "Unable to call tools", finish: "stop", firstBodyAt: now, callAt: null }),
  } : toolDeps);
  expect(profile().contextCalibration?.highest).toBe(65536);
  if (alternative) {
    for (const force of [false, true]) await runToolVerification({ profileId: profile().id,
      signal: controller.signal, configuration: { choice: "none", wire: false }, force }, toolDeps);
    expect(profile().agentToolConfigurations?.[0].confirmation).toBeDefined();
  } else expect(profile().toolVerification?.status).toBe("verified");
  const captured = structuredClone(state);
  now += ageMs;
  await inspect();
  await refresh();
  const liveSnapshot = () => {
    const snapshot = profileSnapshot(state, profile());
    if (!snapshot) throw new Error("Expected provider snapshot");
    return snapshot;
  };
  const bodies: Record<string, unknown>[] = [];
  const decisions: boolean[] = [];
  const acknowledgments = new Map<string, (approved: boolean) => void>();
  let beforeAck: (() => void | Promise<void>) | undefined;
  let snapshotTransform: ((snapshot: ReturnType<typeof liveSnapshot>) => ReturnType<typeof liveSnapshot>) | undefined;
  let current = true;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "self_hosted_profiles_snapshot") return [["selfHostedInference", structuredClone(state)]];
    if (command === "self_hosted_context_runtime") return { epoch, version, configurationRevision: 1, at: now };
    if (command === "self_hosted_probe_cache" || command === "self_hosted_probe") {
      const snapshot = structuredClone(liveSnapshot());
      return snapshotTransform ? snapshotTransform(snapshot) : snapshot;
    }
    if (command === "ai_http_open") return crypto.randomUUID();
    if (command === "ai_http_preflight") {
      const a = args as { requestId: string; approved: boolean };
      decisions.push(a.approved);
      acknowledgments.get(a.requestId)?.(a.approved);
      return;
    }
    if (command === "ai_http_cancel") return;
    if (command !== "ai_http_stream") throw new Error(`Unexpected IPC ${command}`);
    const a = args as { requestId: string; body: number[]; onEvent: { onmessage: (event: unknown) => void } };
    await beforeAck?.();
    const approved = await new Promise<boolean>((resolve) => {
      acknowledgments.set(a.requestId, resolve);
      a.onEvent.onmessage({ requestId: a.requestId, kind: "preflight" });
    });
    if (!approved) {
      a.onEvent.onmessage({ requestId: a.requestId, kind: "settled", phase: "failed", error: { code: "native-transport" } });
      return;
    }
    bodies.push(JSON.parse(new TextDecoder().decode(Uint8Array.from(a.body))));
    a.onEvent.onmessage({ requestId: a.requestId, kind: "headers", status: 200,
      headers: { "content-type": "application/x-ndjson" } });
    const data = { model: profile().transportModelId, created_at: "2026-10-23T12:00:00Z",
      message: { role: "assistant", content: "Review fixture complete." }, done: true,
      done_reason: "stop", prompt_eval_count: 10, eval_count: 4 };
    a.onEvent.onmessage({ requestId: a.requestId, kind: "chunk", bytes: [...new TextEncoder().encode(`${JSON.stringify(data)}\n`)] });
    a.onEvent.onmessage({ requestId: a.requestId, kind: "settled", phase: "completed" });
  });
  const run = async (settings: Partial<RunAgentOptions> = {}) => {
    const input = settings.selfHostedInference ?? captured;
    const result = await runAgentStream({ keys: EMPTY_PROVIDER_KEYS, modelId: selfHostedSelectionId(input.profiles[0]),
      selfHostedInference: input, logicalContinuation: true, abortSignal: controller.signal,
      inferenceScope: { sessionId: "review-session", runId: "review-run", isCurrent: () => current },
      toolContext: { getCwd: () => "/review", getWorkspaceRoot: () => "/review",
        getSessionId: () => "review-session", getAgentId: () => "coder" } as ToolContext,
      uiMessages: [{ id: "review-user", role: "user", parts: [{ type: "text", text: "Read the fixture file." }] }],
      ...settings,
    });
    const chunks = [];
    for await (const chunk of result.fullStream) chunks.push(chunk);
    return chunks;
  };
  return { captured, profile, state: () => state, run, bodies, decisions, controller,
    transformSnapshot: (callback: typeof snapshotTransform) => { snapshotTransform = callback; },
    beforeAck: (callback: typeof beforeAck) => { beforeAck = callback; },
    changeLoaded: async (value: number) => { loaded = value; await refresh(); },
    changeEpoch: async () => { epoch = "other-process"; await inspect(); },
    changeVersion: async () => { version = "2.0.0"; await inspect(); },
    advance: async (milliseconds: number) => { now += milliseconds; await inspect(); },
    revoke: async () => runToolVerification({ profileId: profile().id, signal: controller.signal, force: true,
      ...(alternative ? { configuration: { choice: "none", wire: false } } : {}),
    }, {
      ...toolDeps, request: async () => ({ calls: [], text: "No native call", finish: "stop", firstBodyAt: now, callAt: null }),
    }),
    renew: async () => runToolVerification({ profileId: profile().id, signal: controller.signal, force: true,
      ...(alternative ? { configuration: { choice: "none", wire: false } } : {}),
    }, toolDeps),
    supersede: () => { current = false; },
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in R5y review"); }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { forgetContextRuntime("server"); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("R5y independent production-path re-review", () => {
  it.each([false, true])("accepts aged same-run Automatic alternative=%s with exact record/wire binding", async (alternative) => {
    const f = await fixture(128, alternative);
    expect(modelOnboarding(f.captured, f.captured.profiles[0])?.context.recommended).toBe(4096);
    const record = alternative ? f.captured.profiles[0].agentToolConfigurations?.[0] : f.captured.profiles[0].toolVerification;
    if (!record) throw new Error("Expected original native proof");
    const chunks = await f.run({ retainedAutomaticRecordId: record.id,
      retainedAutomaticVariant: JSON.stringify(record.configuration ?? null) });
    expect(chunks.some(c => c.type === "error")).toBe(false);
    expect(f.decisions).toEqual([true]);
    expect(f.bodies).toHaveLength(1);
    expect(f.bodies[0]).toMatchObject({ options: { num_ctx: 65536 } });
    if (alternative) expect(f.bodies[0].think).toBe(false);
    else expect(f.bodies[0]).not.toHaveProperty("think");
  });

  it.each([0, 4096])("closes R5w: final allocation %i cannot inherit a 65536 continuation grant", async (loaded) => {
    const f = await fixture(128);
    f.beforeAck(() => f.changeLoaded(loaded));
    const chunks = await f.run();
    expect(chunks.some(c => c.type === "error")).toBe(true);
    expect(f.decisions).toEqual([false]);
    expect(f.bodies).toEqual([]);
  });

  it.each(["epoch", "version", "endpoint-revision", "stale-snapshot", "stale-evidence"])(
    "denies final dispatch after %s changes", async (kind) => {
      const f = await fixture(128);
      f.beforeAck(async () => {
        if (kind === "epoch") await f.changeEpoch();
        if (kind === "version") await f.changeVersion();
        if (kind === "endpoint-revision") f.state().endpoints[0].configurationRevision++;
        if (kind === "stale-snapshot") f.transformSnapshot(s => ({ ...s, stale: true }));
        if (kind === "stale-evidence") await f.advance(30000);
      });
      const chunks = await f.run();
      expect(chunks.some(c => c.type === "error")).toBe(true);
      expect(f.decisions).toEqual([false]);
      expect(f.bodies).toEqual([]);
    },
  );

  it("accepts still-fresh 29999ms provider metadata at the real native ACK", async () => {
    const f = await fixture(128);
    f.beforeAck(() => f.advance(29999));
    const chunks = await f.run();
    expect(chunks.some(c => c.type === "error")).toBe(false);
    expect(f.decisions).toEqual([true]);
    expect(f.bodies).toHaveLength(1);
  });

  it.each(["record", "variant", "expired-confirmation", "revoked-captured-proof", "reasoning"])(
    "rejects invalid confirmed alternative %s", async kind => {
      const f = await fixture(128, true);
      const record = f.captured.profiles[0].agentToolConfigurations?.[0];
      if (!record) throw new Error("Expected independently verified alternative");
      const options: Partial<RunAgentOptions> = { retainedAutomaticRecordId: record.id,
        retainedAutomaticVariant: JSON.stringify(record.configuration) };
      if (kind === "record") options.retainedAutomaticRecordId = "another-record";
      if (kind === "variant") options.retainedAutomaticVariant = JSON.stringify({ choice: "on", wire: true });
      if (kind === "expired-confirmation") {
        if (!record.confirmation) throw new Error("Expected alternative confirmation");
        record.confirmation.expiresAt = Date.now() - 1;
      }
      if (kind === "revoked-captured-proof") record.failure = { at: Date.now(), expiresAt: Date.now() + 60000, outcome: "text-only" };
      if (kind === "reasoning") record.scope.reasoning = "different-native-contract";
      await expect(f.run(options)).rejects.toThrow();
      expect(f.bodies).toEqual([]);
    },
  );

  it.each(["cancel", "supersede", "restart"])("does not dispatch a %s owner", async kind => {
    const f = await fixture(128);
    if (kind === "cancel") f.controller.abort();
    if (kind === "supersede") f.supersede();
    if (kind === "restart") {
      forgetContextRuntime("server");
      await expect(f.run()).rejects.toThrow();
    } else {
      const chunks = await f.run();
      expect(chunks.some(c => c.type === "error" || c.type === "abort")).toBe(true);
    }
    expect(f.bodies).toEqual([]);
  });

  it("preserves legitimate unpinned conservative B1 dispatch through production proxy/ACK", async () => {
    const f = await fixture(128);
    const preflight = createRequestPreflight({ modelId: "conservative", providerId: "ollama", local: true });
    const fetcher = createProxyFetch({ preflight,
      scope: { sessionId: "conservative-session", runId: "conservative-run", isCurrent: () => true } });
    const response = await fetcher("http://localhost:9999/api/chat", { method: "POST", body: JSON.stringify({
      model: "conservative", stream: true, messages: [{ role: "user", content: "Small request" }],
      options: { num_predict: 128 },
    }) });
    await response.text();
    expect(f.decisions).toEqual([true]);
    expect(f.bodies).toHaveLength(1);
    expect(f.bodies[0].options).not.toHaveProperty("num_ctx");
  });

  it.each([
    [false, "before-eligibility"], [false, "native-ack"],
    [true, "before-eligibility"], [true, "native-ack"],
  ] as const)("denies currently revoked native proof: alternative=%s at %s", async (alternative, stage) => {
    const f = await fixture(128, alternative);
    const record = alternative ? f.captured.profiles[0].agentToolConfigurations?.[0] : f.captured.profiles[0].toolVerification;
    if (!record) throw new Error("Expected original native proof");
    if (stage === "before-eligibility") await f.revoke();
    else f.beforeAck(async () => { await f.revoke(); });
    const chunks = await f.run({ retainedAutomaticRecordId: record.id,
      retainedAutomaticVariant: JSON.stringify(record.configuration ?? null) });
    const current = alternative ? f.profile().agentToolConfigurations?.[0] : f.profile().toolVerification;
    if (!current) throw new Error("Expected newer negative verification");
    expect(current.id).not.toBe(record.id);
    expect(current.failure?.outcome).toBe("text-only");
    expect(toolVerificationState(f.state(), { ...f.profile(), toolVerification: current }, Date.now(), 65536)).toBe("Needs attention");
    expect(chunks.some(c => c.type === "error")).toBe(true);
    expect(f.decisions).toEqual([false]);
    expect(f.bodies).toHaveLength(0);
  });

  it("denies proof expiry while queued at final ACK", async () => {
    const f = await fixture(128);
    const expiry = Date.now() + 1;
    for (const record of [f.captured.profiles[0].toolVerification, f.profile().toolVerification]) {
      if (!record) throw new Error("Expected captured and current native tool proof");
      record.proof = { at: expiry - 86400000, expiresAt: expiry };
      record.startedAt = record.completedAt = record.firstBodyAt = record.callAt = record.proof.at;
    }
    f.beforeAck(() => f.advance(2));
    const chunks = await f.run();
    expect(toolVerificationState(f.state(), f.profile(), Date.now(), 65536)).toBe("Stale");
    expect(chunks.some(c => c.type === "error")).toBe(true);
    expect(f.decisions).toEqual([false]);
    expect(f.bodies).toHaveLength(0);
  });

  it.each([false, true])("denies current missing and same-ID negative proof for alternative=%s", async alternative => {
    for (const change of ["missing", "negative"] as const) {
      const f = await fixture(128, alternative);
      const record = alternative ? f.captured.profiles[0].agentToolConfigurations?.[0] : f.captured.profiles[0].toolVerification;
      if (!record) throw new Error("Missing original eligible proof");
      f.beforeAck(() => {
        const profile = f.profile();
        if (change === "missing") {
          if (alternative) profile.agentToolConfigurations = [];
          else profile.toolVerification = undefined;
        } else {
          const current = alternative ? profile.agentToolConfigurations?.[0] : profile.toolVerification;
          if (!current) throw new Error("Missing current proof");
          current.failure = { at: Date.now(), expiresAt: Date.now() + 1000, outcome: "text-only" };
          current.status = "needs-attention";
        }
      });
      const chunks = await f.run({retainedAutomaticRecordId: record.id,
        retainedAutomaticVariant: JSON.stringify(record.configuration ?? null)});
      expect(chunks.some(c => c.type === "error")).toBe(true);
      expect(f.decisions).toEqual([false]);
      expect(f.bodies).toEqual([]);
    }
  });

  it("denies independent alternative confirmation that expires while queued", async () => {
    const f = await fixture(128, true);
    const accepted = f.captured.profiles[0].agentToolConfigurations?.[0];
    const current = f.profile().agentToolConfigurations?.[0];
    if (!accepted?.confirmation || !current?.confirmation) throw new Error("Expected confirmation");
    accepted.confirmation.expiresAt = Date.now() + 1;
    current.confirmation.expiresAt = Date.now() + 1;
    f.beforeAck(() => f.advance(2));
    const chunks = await f.run({retainedAutomaticRecordId: accepted.id,
      retainedAutomaticVariant: JSON.stringify(accepted.configuration)});
    expect(chunks.some(c => c.type === "error")).toBe(true);
    expect(f.decisions).toEqual([false]);
    expect(f.bodies).toEqual([]);
  });

  it.each([false, true])("requires renewed proof's own newly authorized run: alternative=%s", async alternative => {
    const f = await fixture(128, alternative);
    const original = alternative ? f.captured.profiles[0].agentToolConfigurations?.[0] : f.captured.profiles[0].toolVerification;
    if (!original) throw new Error("Missing original proof");
    await f.renew();
    const updated = alternative ? f.profile().agentToolConfigurations?.[0] : f.profile().toolVerification;
    if (!updated || updated.id === original.id) throw new Error("Renewal must produce a new record");
    const oldChunks = await f.run({retainedAutomaticRecordId: original.id,
      retainedAutomaticVariant: JSON.stringify(original.configuration ?? null)});
    expect(oldChunks.some(c => c.type === "error")).toBe(true);
    expect(f.decisions).toEqual([false]);
    expect(f.bodies).toHaveLength(0);
    // New captured state is independently selected under normal eligibility.
    const freshCaptured = structuredClone(f.state());
    const newChunks = await f.run({selfHostedInference: freshCaptured,
      retainedAutomaticRecordId: updated.id,
      retainedAutomaticVariant: JSON.stringify(updated.configuration ?? null)});
    expect(newChunks.some(c => c.type === "error")).toBe(false);
    expect(f.decisions).toEqual([false, true]);
    expect(f.bodies).toHaveLength(1);
  });

  // R5x frozen run: real tool proof at 1792797523969, natural failed batch at
  // 1792797828410 (+304441ms). The saved provider's reasoning contract was
  // unchanged and freshly observed at 1792797812125, but the PREPARED first-
  // batch settings capture had passed the 300000ms metadata age boundary.
  it.each([false, true])("R5x-aged Automatic continuation retains its own proof alternative=%s", async alternative => {
    const f = await fixture(2048, alternative, R5X_NATIVE.continuationAt - R5X_NATIVE.proofAt, true);
    const record = alternative ? f.captured.profiles[0].agentToolConfigurations?.[0] : f.captured.profiles[0].toolVerification;
    if (!record) throw new Error("Expected original verified R5x-shaped proof");
    const eligibility = toolEligibilityPredicates(f.captured, f.captured.profiles[0], record.configuration, Date.now(), 65536);
    expect(eligibility.proofFresh).toBe(true);
    expect(eligibility.runtimeFresh).toBe(true);
    expect(eligibility.expectedContextMatches).toBe(true);
    expect(eligibility.reasoningIdentityMatches).toBe(false);
    const view = modelOnboarding(f.captured, f.captured.profiles[0]);
    expect(automaticAgentBatchContext(f.captured, f.captured.profiles[0], view?.context, true).pinned).toBeUndefined();
    const live = agentContinuationReasoningMetadata(f.captured, f.captured.profiles[0], profileSnapshot(f.state(), f.profile()));
    expect(automaticAgentRecommendation(live, live.profiles[0], 65536)?.record.id).toBe(record.id);
    const chunks = await f.run({ retainedAutomaticRecordId: record.id,
      retainedAutomaticVariant: JSON.stringify(record.configuration ?? null) });
    expect(chunks.some(c => c.type === "error")).toBe(false);
    expect(f.decisions).toEqual([true]);
    expect(f.bodies).toHaveLength(1);
    expect(f.bodies[0]).toMatchObject({ options: { num_ctx: 65536 } });
    if (alternative) expect(f.bodies[0].think).toBe(false);
    else expect(f.bodies[0]).not.toHaveProperty("think");
  });

  it.each(["stale-current-metadata", "reasoning-changed", "epoch-changed", "captured-proof-expired"] as const)(
    "R5x-aged continuation must deny %s before native HTTP", async kind => {
      const f = await fixture(2048, false, R5X_NATIVE.continuationAt - R5X_NATIVE.proofAt, true);
      if (kind === "stale-current-metadata") f.transformSnapshot(s => ({ ...s, stale: true }));
      if (kind === "reasoning-changed") f.transformSnapshot(s => ({ ...s, models: s.models.map(m => ({
        ...m, evidence: m.evidence.map(e => e.metric === "probe.thinkingDefault" ? { ...e, value: false } : e),
      })) }));
      if (kind === "epoch-changed") await f.changeEpoch();
      if (kind === "captured-proof-expired") {
        const record = f.captured.profiles[0].toolVerification;
        if (!record?.proof) throw new Error("Expected native proof");
        record.proof.expiresAt = Date.now() - 1;
      }
      await expect(f.run()).rejects.toThrow();
      expect(f.decisions).toEqual([]);
      expect(f.bodies).toEqual([]);
    });

  it.each([false, true])("R5x-aged current revoked proof denies at ACK alternative=%s", async alternative => {
    const f = await fixture(2048, alternative, R5X_NATIVE.continuationAt - R5X_NATIVE.proofAt, true);
    const original = alternative ? f.captured.profiles[0].agentToolConfigurations?.[0] : f.captured.profiles[0].toolVerification;
    if (!original) throw new Error("Expected verified tool record");
    f.beforeAck(async () => { await f.revoke(); });
    const chunks = await f.run({ retainedAutomaticRecordId: original.id,
      retainedAutomaticVariant: JSON.stringify(original.configuration ?? null) });
    expect(chunks.some(c => c.type === "error")).toBe(true);
    expect(f.decisions).toEqual([false]);
    expect(f.bodies).toEqual([]);
  });
});
