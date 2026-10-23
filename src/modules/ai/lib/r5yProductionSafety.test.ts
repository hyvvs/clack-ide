import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { runAgentStream } from "@/modules/ai/lib/agent";
import { createRequestPreflight } from "@/modules/ai/lib/requestPreflight";
import { runContextCalibration } from "@/modules/ai/lib/contextCalibration";
import { runToolVerification } from "@/modules/ai/lib/toolVerification";
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

async function fixture(outputAllowance = 2048, alternative = false, ageMs = 194000) {
  let now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const f = ollamaEffortFixture([false, true], "r5w-review-only");
  let state = f.state;
  state.profiles[0].modelRevision = "review-digest";
  state.profiles[0].backend = "ollama";
  if (outputAllowance !== 2048) {
    state = setProfileOverride(state, state.profiles[0].id, "maxOutput", outputAllowance);
    state = setProfileOverride(state, state.profiles[0].id, "outputReserve", outputAllowance);
  }
  let loaded = 0;
  let requested = 0;
  let epoch = "review-process";
  let version = "1.2.3";
  const profile = () => state.profiles[0];
  const inspect = async () => rememberContextRuntime(f.endpoint.id, {
    epoch, version, configurationRevision: f.endpoint.configurationRevision, at: now,
  });
  const refresh = async () => {
    const p = profile();
    p.evidence = Object.entries({
      runtimeContext: "per-request", advertisedContext: 262144,
      thinking: true, thinkingControls: "[false,true]", thinkingDefault: true,
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
    if (!snapshot) throw new Error("Expected native provider snapshot");
    return { state, snapshot };
  };
  const commit = async (change: (value: typeof state) => typeof state) => {
    state = readSelfHostedState(structuredClone(change(state)));
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
    if (!snapshot) throw new Error("Expected fresh native provider snapshot");
    return snapshot;
  };
  const bodies: Record<string, unknown>[] = [];
  const decisions: boolean[] = [];
  const acknowledgments = new Map<string, (approved: boolean) => void>();
  let beforeAck: (() => void | Promise<void>) | undefined;
  let current = true;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "self_hosted_profiles_snapshot") return [["selfHostedInference", structuredClone(state)]];
    if (command === "self_hosted_context_runtime") return { epoch, version, configurationRevision: 1, at: now };
    if (command === "self_hosted_probe_cache" || command === "self_hosted_probe") {
      return structuredClone(liveSnapshot());
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
  const run = async (input = captured, retainedAutomaticRecordId?: string, retainedAutomaticVariant?: string) => {
    const result = await runAgentStream({ keys: EMPTY_PROVIDER_KEYS, modelId: selfHostedSelectionId(input.profiles[0]),
      selfHostedInference: input, logicalContinuation: true, abortSignal: controller.signal,
      retainedAutomaticRecordId, retainedAutomaticVariant,
      inferenceScope: { sessionId: "review-session", runId: "review-run", isCurrent: () => current },
      toolContext: { getCwd: () => "/review", getWorkspaceRoot: () => "/review",
        getSessionId: () => "review-session", getAgentId: () => "coder" } as ToolContext,
      uiMessages: [{ id: "review-user", role: "user", parts: [{ type: "text", text: "Read the fixture file." }] }],
    });
    const chunks = [];
    for await (const chunk of result.fullStream) chunks.push(chunk);
    return chunks;
  };
  return { captured, profile, state: () => state, run, bodies, decisions, controller,
    beforeAck: (callback: typeof beforeAck) => { beforeAck = callback; },
    changeLoaded: async (value: number) => { loaded = value; await refresh(); },
    changeEpoch: async () => { epoch = "other-process"; await inspect(); },
    changeVersion: async () => { version = "2.0.0"; await inspect(); },
    supersede: () => { current = false; },
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in R5w review"); }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { forgetContextRuntime("server"); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("R5y production Agent and final native-dispatch safety regressions", () => {
  it("preserves permitted conservative B1 dispatch without stale high-context evidence", async () => {
    // No self-hosted calibration or per-request runtime allocation was proven.
    // A small request may still use the conservative 4096-token B1 budget with
    // no asserted native num_ctx; no pinned continuation grant is invented.
    const preflight = createRequestPreflight({
      modelId: "conservative-route", providerId: "ollama", local: true,
    });
    const body = { model: "conservative-route", stream: true,
      messages: [{ role: "user", content: "Small request" }],
      options: { num_predict: 128 } };
    await expect((await preflight.prepare(body))()).resolves.toBeUndefined();
    expect(body.options).not.toHaveProperty("num_ctx");
  });
  it("admits aged 4096 projection with fresh matching 65536 runtime through real Agent/SDK/preflight", async () => {
    const f = await fixture();
    expect(modelOnboarding(f.captured, f.captured.profiles[0])?.context.recommended).toBe(4096);
    const chunks = await f.run();
    expect(chunks.filter((c) => c.type === "error")).toEqual([]);
    expect(f.decisions).toEqual([true]);
    expect(f.bodies).toHaveLength(1);
    expect(f.bodies[0]).toMatchObject({ model: "r5w-review-only", options: { num_ctx: 65536 } });
  });

  it.each(["expired-proof", "model", "digest", "endpoint", "reasoning", "endpoint-revision", "epoch", "version", "restart"])(
    "rejects %s at the real Agent admission boundary", async (kind) => {
      const f = await fixture();
      const p = f.captured.profiles[0];
      if (kind === "expired-proof") {
        if (!p.toolVerification?.proof) throw new Error("Expected native proof");
        p.toolVerification.proof.expiresAt = Date.now() - 1;
      }
      if (kind === "model") p.transportModelId = "other-model";
      if (kind === "digest") p.modelRevision = "other-digest";
      if (kind === "endpoint") p.endpointId = "other-endpoint";
      if (kind === "reasoning") {
        const current = p.evidence.find(e => e.metric === "probe.thinkingDefault");
        if (!current) throw new Error("Expected captured reasoning identity");
        current.value = false;
      }
      if (kind === "endpoint-revision") f.captured.endpoints[0].configurationRevision++;
      if (kind === "epoch") await f.changeEpoch();
      if (kind === "version") await f.changeVersion();
      if (kind === "restart") forgetContextRuntime("server");
      await expect(f.run()).rejects.toThrow();
      expect(f.bodies).toEqual([]);
    },
  );

  it.each([4096, 0])("rejects initially changed/unavailable loaded context %i", async (loaded) => {
    const f = await fixture();
    await f.changeLoaded(loaded);
    await expect(f.run()).rejects.toThrow(/working context changed/);
    expect(f.bodies).toEqual([]);
  });

  it("endpoint revision drift at native acknowledgement denies dispatch even with a small output", async () => {
    const f = await fixture(128);
    f.beforeAck(() => { f.state().endpoints[0].configurationRevision++; });
    const chunks = await f.run();
    expect(chunks.some((c) => c.type === "error")).toBe(true);
    expect(f.decisions).toEqual([false]);
    expect(f.bodies).toEqual([]);
  });

  it.each(["cancel", "supersede"])("does not dispatch a %s run", async (kind) => {
    const f = await fixture();
    if (kind === "cancel") f.controller.abort();
    else f.supersede();
    const chunks = await f.run();
    expect(chunks.some((c) => c.type === "error" || c.type === "abort")).toBe(true);
    expect(f.bodies).toEqual([]);
  });

  it.each([4096, 0])("2048-output budget independently denies native-ack drift to %i", async (loaded) => {
    const f = await fixture();
    f.beforeAck(() => f.changeLoaded(loaded));
    const chunks = await f.run();
    expect(chunks.some((c) => c.type === "error")).toBe(true);
    expect(f.decisions).toEqual([false]);
    expect(f.bodies).toEqual([]);
  });

  it.each([4096, 0])("rejects 128-output native-ack allocation drift to %i after initial Agent pin", async (loaded) => {
    const f = await fixture(128);
    f.beforeAck(() => f.changeLoaded(loaded));
    const chunks = await f.run();
    expect(chunks.some(c => c.type === "error")).toBe(true);
    expect(f.decisions).toEqual([false]);
    expect(f.bodies).toHaveLength(0);
  });

  it.each(["epoch", "version", "allocation-disappears", "allocation-replaced"]) (
    "rejects native-ack proof invalidation: %s", async (kind) => {
      const f = await fixture(128);
      f.beforeAck(async () => {
        if (kind === "epoch") await f.changeEpoch();
        else if (kind === "version") await f.changeVersion();
        else if (kind === "allocation-disappears") await f.changeLoaded(0);
        else await f.changeLoaded(4096);
      });
      const chunks = await f.run();
      expect(chunks.some(c => c.type === "error")).toBe(true);
      expect(f.decisions).toEqual([false]);
      expect(f.bodies).toEqual([]);
    },
  );

  it("accepts final native dispatch only with still-current calibrated allocation and scope", async () => {
    const f = await fixture(128);
    const chunks = await f.run();
    expect(chunks.some(c => c.type === "error")).toBe(false);
    expect(f.decisions).toEqual([true]);
    expect(f.bodies).toHaveLength(1);
    expect(f.bodies[0]).toMatchObject({ options: { num_ctx: 65536 } });
  });

  it("admits a freshly confirmed Automatic alternative before profile observations age", async () => {
    const f = await fixture(2048, true, 0);
    const chunks = await f.run();
    expect(chunks.filter((c) => c.type === "error")).toEqual([]);
    expect(f.bodies).toHaveLength(1);
    expect(f.bodies[0]).toMatchObject({ think: false, options: { num_ctx: 65536 } });
  });

  it("accepts aged confirmed Automatic alternative with separately valid live 65536 proof", async () => {
    const f = await fixture(2048, true);
    expect(f.captured.profiles[0].agentToolConfigurations?.[0]).toMatchObject({ context: 65536, status: "verified" });
    expect(modelOnboarding(f.captured, f.captured.profiles[0])?.context.recommended).toBe(4096);
    const chunks = await f.run();
    expect(chunks.some(c => c.type === "error")).toBe(false);
    expect(f.decisions).toEqual([true]);
    expect(f.bodies).toHaveLength(1);
    expect(f.bodies[0]).toMatchObject({ think: false, options: { num_ctx: 65536 } });
  });

  it.each(["confirmation", "tool-proof", "model", "endpoint", "epoch", "reasoning", "wrong-variant"]) (
    "rejects aged Automatic alternative whose %s evidence no longer matches", async kind => {
      const f = await fixture(2048, true);
      const p = f.captured.profiles[0];
      const record = p.agentToolConfigurations?.[0];
      if (!record) throw new Error("Expected confirmed alternative");
      if (kind === "confirmation") {
        if (!record.confirmation) throw new Error("Expected independent confirmation");
        record.confirmation.expiresAt = Date.now() - 1;
      }
      if (kind === "tool-proof") {
        if (!record.proof) throw new Error("Expected alternative native proof");
        record.proof.expiresAt = Date.now() - 1;
      }
      if (kind === "model") record.scope.digest = "other-digest";
      if (kind === "endpoint") record.scope.endpointId = "other-endpoint";
      if (kind === "epoch") record.scope.runtimeEpoch = "other-epoch";
      if (kind === "reasoning") record.scope.reasoning = "other-reasoning";
      if (kind === "wrong-variant") record.configuration = { choice: "none", wire: true };
      await expect(f.run()).rejects.toThrow();
      expect(f.bodies).toEqual([]);
    },
  );

  it("rejects a same-run Automatic alternative with another record or confirmed variant", async () => {
    const f = await fixture(2048, true);
    await expect(f.run(f.captured, "different-run-record")).rejects.toThrow(/proof selection changed/);
    const recorded = f.captured.profiles[0].agentToolConfigurations?.[0];
    if (!recorded) throw new Error("Expected confirmed alternative");
    await expect(f.run(f.captured, recorded.id,
      JSON.stringify({ choice: "on", wire: true }))).rejects.toThrow(/reasoning variant changed/);
    expect(f.bodies).toEqual([]);
  });
});
