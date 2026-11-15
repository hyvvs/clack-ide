/** Offline, production-entrypoint regression for one long-lived Automatic Agent
 * run. Native transport, filesystem writes and extraction model are deterministic
 * fakes; calibration, tool eligibility, preflight, recovery admission, checkpoint
 * reconciliation, renewal and compaction orchestration use production code. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { LanguageModel, UIMessage } from "ai";
import { ollamaEffortFixture } from "@/modules/ai/lib/reasoningEffort.fixture";
import { profileEvidence, readSelfHostedState, type SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { rememberContextRuntime, forgetContextRuntime, contextReasoningIdentity } from "@/modules/ai/lib/contextCalibrationTrust";
import { profileSnapshot } from "@/modules/ai/lib/modelOnboarding";
import { automaticAgentRecommendation } from "@/modules/ai/lib/agentConfiguration";
import { freshVerifiedContextTiers } from "@/modules/ai/lib/minimumSafeContext";
import { toolScope } from "@/modules/ai/lib/toolVerification";
import type { ToolVerification } from "@/modules/ai/lib/toolVerificationSchema";
import { runContextCalibration } from "@/modules/ai/lib/contextCalibration";
import { createRequestPreflight, preflightFetch } from "@/modules/ai/lib/requestPreflight";
import { agentCalibrationPreparationHorizon, AGENT_CALIBRATION_PROVIDER_HORIZON_MS, AGENT_CALIBRATION_EXTRACTION_ATTEMPT_HORIZON_MS, agentCalibrationRenewalDue, renewAgentCalibrationAtBoundary } from "@/modules/ai/lib/agentCalibrationRenewal";
import { compactionFixture, disposeCompactionFixtures, textMessage } from "@/modules/ai/lib/conversationCompaction.fixture";
import { COMPACTION_POLICY } from "@/modules/ai/lib/compactionExtraction";
import { installPreparationObserver, type PreparationObservation } from "@/modules/ai/lib/preparationLifecycle";
import { captureAgentRequestCheckpoint, eligibleAgentRequestFailure, sameAgentRequestOwner } from "@/modules/ai/lib/agentRequestRecovery";
import { normalizeAiError } from "@/modules/ai/lib/errors";
import { InferenceTransportError } from "@/modules/ai/lib/inferenceErrors";
import { createRunBudget, recordRunBatch } from "@/modules/ai/lib/runBudget";
import type { SessionMeta, SessionRun } from "@/modules/ai/lib/sessions";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const NOW = 1_800_000_000_000;
const TIER = 32_768;
const EPOCH = "measured-process-epoch";
const VERSION = "0.40.11";
const CONTEXTS = [4096, 8192, 16384, TIER];
type Part = UIMessage["parts"][number];

function measuredRuntime() {
  const f = ollamaEffortFixture([false, true], "integration-long-horizon-model");
  let state: SelfHostedState = f.state;
  const endpoint = f.endpoint;
  const original = f.profile;
  original.modelRevision = "integration-measured-model-digest";
  original.backend = "ollama";
  let liveEpoch = EPOCH;
  let calibrations = 0;
  let nativeProofs = 0;
  let calibrationAvailable = true;
  const runtime = () => rememberContextRuntime(endpoint.id, {
    epoch: liveEpoch, version: VERSION,
    configurationRevision: endpoint.configurationRevision, at: Date.now(),
  });
  const profile = () => state.profiles.find(p => p.id === original.id)!;
  const loaded = (context: number, allocation: string) => {
    profile().evidence = ([
      ["runtimeContext", "per-request"], ["advertisedContext", 131072],
      ["thinking", true], ["thinkingControls", "[false,true]"],
      ["thinkingDefault", true], ["trainedForTools", true], ["loaded", true],
      ["loadedContext", context], ["runtimeAllocation", allocation],
      ["requestedContext", context],
    ] as [string, string | boolean | number][]).map(([metric, value]) =>
      profileEvidence(state, original.id, `probe.${metric}`, value,
        metric === "requestedContext" ? "measured" : "backend-reported",
        Date.now(), metric === "requestedContext" ? "observed" : "reported"));
    state.inventories = [{
      endpointId: endpoint.id, configurationRevision: endpoint.configurationRevision,
      observedAt: Date.now(), connected: true, backend: "ollama",
      models: [{ id: original.transportModelId, name: null, chat: "supported", digest: profile().modelRevision }],
    }];
  };
  runtime();
  loaded(TIER, "measured-initial-allocation");
  const scope = toolScope(original, endpoint)!;
  const proof: ToolVerification = {
    version: 1, id: "genuine-native-probe-receipt", scope,
    status: "verified", outcome: "native-call", context: TIER, output: 512,
    attempts: [{ output: 512, outcome: "native-call", finish: "tool-calls",
      startedAt: NOW - 5_000, completedAt: NOW - 4_900 }],
    startedAt: NOW - 5_100, completedAt: NOW - 4_900,
    firstBodyAt: NOW - 4_900, callAt: NOW - 4_900,
    calls: 1, validArguments: true, textualIntent: false, textChars: 0,
    finish: "tool-calls", proof: { at: NOW - 4_900, expiresAt: NOW + 86_400_000 },
    retryAfter: NOW + 86_400_000,
  };
  original.agentToolTierProofs = [proof];
  const calibratedAt = NOW - 300_000;
  original.contextCalibration = {
    version: 1, id: "actual-tier-measurements", status: "verified",
    highest: TIER, failedNext: null, failure: null,
    allocation: "measured-initial-allocation",
    startedAt: calibratedAt - 1_000, updatedAt: calibratedAt,
    expiresAt: calibratedAt + 900_000, retryAfter: calibratedAt + 900_000,
    scope: {
      endpointId: endpoint.id, configurationRevision: endpoint.configurationRevision,
      model: original.transportModelId, deployment: original.deploymentId,
      digest: original.modelRevision, backend: "ollama", runtimeEpoch: EPOCH,
      providerVersion: VERSION, reasoning: contextReasoningIdentity(original, endpoint),
    },
    attempts: CONTEXTS.map((context, index) => ({
      context, requested: context, loaded: context, at: calibratedAt + index,
      outcome: "success" as const, latencyMs: 15,
      thermal: "warm" as const, finish: "stop", think: "omitted" as const,
    })),
  };
  state = readSelfHostedState(state);
  const snapshot = () => profileSnapshot(state, profile())!;
  const dependencies: NonNullable<Parameters<typeof renewAgentCalibrationAtBoundary>[5]> = {
    read: async () => state,
    inspect: async () => { runtime(); },
    calibrate: async options => runContextCalibration(options, {
      refresh: async () => ({ state, snapshot: snapshot() }),
      inspectRuntime: async () => { runtime(); },
      request: async (context, _captured, signal) => {
        signal.throwIfAborted();
        if (!calibrationAvailable)
          throw new Error("The actual native calibration request produced no trusted result");
        calibrations++;
        loaded(context, "remeasured-after-native-calibration");
        return { finish: "stop" };
      },
      commit: async change => {
        state = readSelfHostedState(change(state));
        return state;
      },
    }),
    verify: async () => {
      nativeProofs++;
      throw new Error("A fresh native proof was unexpectedly required");
    },
    snapshot: (() => ({
      read: async () => snapshot(),
      refresh: async () => snapshot(),
    })) as unknown as NonNullable<Parameters<typeof renewAgentCalibrationAtBoundary>[5]>["snapshot"],
  };
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === "self_hosted_profiles_snapshot")
      return [["selfHostedInference", state]];
    if (command === "self_hosted_probe_cache" || command === "self_hosted_probe") {
      loaded(TIER, profile().contextCalibration!.allocation!);
      return snapshot();
    }
    if (command === "self_hosted_context_runtime") {
      runtime();
      return { epoch: liveEpoch, version: VERSION,
        configurationRevision: endpoint.configurationRevision, at: Date.now() };
    }
    throw new Error("Unexpected native operation in offline test: " + command);
  });
  const renew = (horizon: number, retained = proof) =>
    renewAgentCalibrationAtBoundary(state, original.id, retained,
      new AbortController().signal, () => true, dependencies, horizon);
  const body = (tools = true) => ({
    model: original.transportModelId, stream: true,
    options: { num_ctx: TIER, num_predict: 4096 },
    messages: [{ role: "system", content: "Preserve accepted project decisions" },
      { role: "user", content: "Complete only outstanding work" }],
    ...(tools ? { tools: [{ type: "function", function: {
      name: "write_file", description: "Write the next unfinished file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
    } }] } : {}),
  });
  const preflight = () => createRequestPreflight({
    state, local: true, providerId: "ollama", modelId: original.transportModelId,
    requiredRuntimeContext: TIER, requiredContinuationProof: structuredClone(proof),
    admission: { endpointId: endpoint.id, profileId: original.id, capacity: 1 },
  });
  return { endpoint, profile, proof, renew, body, preflight, snapshot, loaded, runtime,
    state: () => state, changeEpoch: (value: string) => { liveEpoch = value; },
    setCalibrationAvailable: (available: boolean) => { calibrationAvailable = available; },
    get calibrations() { return calibrations; }, get nativeProofs() { return nativeProofs; } };
}

function completedHistory() {
  const names = ["list_directory", "todo_write", ...Array(4).fill("create_directory"),
    ...Array(14).fill("write_file"), "todo_write"];
  const writes = new Map<string, string>();
  const directories = new Set<string>();
  const parts: Part[] = names.flatMap((name, index) => {
    const path = `C:/long-horizon/file-${index}.ts`;
    const content = `export const task${index} = true;`;
    if (name === "write_file") writes.set(path, content);
    if (name === "create_directory") directories.add(path);
    return [
      { type: "step-start" }, { type: "text",
        text: `Completed durable action ${index}. ${"Preserve source evidence. ".repeat(85)}` },
      { type: `tool-${name}`, toolCallId: `completed-${index}`,
        state: "output-available", input: { path, content },
        output: { path, ok: true, clackWorkspaceWrite: name === "write_file" || name === "create_directory",
          ...(name === "write_file" ? { bytesWritten: content.length } : {}) } },
    ] as Part[];
  });
  const history: UIMessage[] = [
    textMessage("objective", "user", "Build the app and preserve all earlier completed files"),
    { id: "durable-tools", role: "assistant", parts },
    textMessage("correction", "user", "Continue the remaining test and README without replaying existing writes"),
    { id: "next", role: "assistant", parts: [] },
  ];
  return { history, writes, directories, count: names.length };
}

async function waitForExtraction(call: ReturnType<typeof compactionFixture>["call"], count: number) {
  for (let index = 0; index < 150 && call.mock.calls.length < count; index++)
    await vi.advanceTimersByTimeAsync(0);
  expect(call.mock.calls.length).toBeGreaterThanOrEqual(count);
}

afterEach(() => {
  disposeCompactionFixtures();
  forgetContextRuntime("server");
  vi.mocked(invoke).mockReset();
  vi.useRealTimers();
});

describe("Automatic Agent long-horizon native runtime integration (offline)", () => {
  it("admits exact 32K proof, checkpoints many effects, renews, retries bounded extraction, resumes coding and follows up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const f = measuredRuntime();
    const recommended = automaticAgentRecommendation(f.state(), f.profile(), TIER);
    expect(recommended?.record.id).toBe(f.proof.id);
    expect(freshVerifiedContextTiers(f.state(), f.profile(), f.snapshot())).toEqual(CONTEXTS);
    const gate = f.preflight();
    await expect((await gate.prepare(f.body()))()).resolves.toBeUndefined();
    const { history, writes, directories, count } = completedHistory();
    const run: SessionRun = {
      state: "running", agentId: "builtin:coder", modelId: "captured-model",
      providerId: "ollama", transportModelId: f.profile().transportModelId,
      startedAt: NOW, workspaceId: "local:/long-horizon",
      workspaceRoot: "C:/long-horizon",
      customTools: { revision: 1, versions: [], unavailable: false },
      budget: { ...createRunBudget("trusted-workspace"), totalSteps: count },
    };
    const error = normalizeAiError(new InferenceTransportError("stream-idle-timeout"));
    expect(eligibleAgentRequestFailure(run, error)).toBe(true);
    const session: SessionMeta = { id: "long-horizon", title: "Offline native run",
      createdAt: NOW, updatedAt: NOW, run };
    const checkpoint = await captureAgentRequestCheckpoint(session, history.slice(0, 2), {
      permissions: { write_file: "workspace" }, todos: [], plan: {}, records: [],
      writeCheckpoint: null, workspaceRevision: "c".repeat(64),
      readFile: async path => {
        const value = writes.get(path);
        if (!value) throw new Error("Unverified write: " + path);
        return value;
      },
      isDirectory: async path => directories.has(path),
    });
    expect(checkpoint.toolReceipts).toHaveLength(count);
    expect(checkpoint.workspaceReceipts).toHaveLength(writes.size + directories.size);
    expect(sameAgentRequestOwner(checkpoint, session)).toBe(true);
    run.agentRequestRecovery = { attempts: 1, phase: "dispatched",
      consumedBy: "stream-idle-timeout", failures: [error], checkpoint };
    expect(eligibleAgentRequestFailure(run, error)).toBe(false);
    const capturedBudget = structuredClone(run.budget);
    // The original lease is still valid, but cannot span a legal 600s
    // compaction preparation plus the guard margin.
    vi.setSystemTime(f.profile().contextCalibration!.expiresAt - 61_500);
    f.loaded(TIER, f.profile().contextCalibration!.allocation!);
    f.runtime();
    const horizon = agentCalibrationPreparationHorizon(true);
    expect(horizon).toBe(COMPACTION_POLICY.timeoutMs *
      COMPACTION_POLICY.maxModelAttemptsPerPreparation + 30_000);
    expect(agentCalibrationRenewalDue(f.profile().contextCalibration!.expiresAt,
      Date.now(), horizon)).toBe(true);
    const firstRenewal = await f.renew(horizon);
    gate.updateAgentTrust(firstRenewal.state, firstRenewal.proof);
    expect(firstRenewal.proof.id).toBe(f.proof.id);
    expect(f.calibrations).toBe(1);
    const fixture = compactionFixture(history, {
      sessionId: "long-horizon", workspaceId: "local:/long-horizon",
    });
    const before = JSON.stringify(fixture.originals);
    const validExtract = async (options: Parameters<typeof fixture.call>[0]) => {
      const payload = JSON.parse(options.messages[1].content as string) as {
        sources: { sourceIndex: number; passages: string[] }[];
      };
      return { text: JSON.stringify({ claims: payload.sources.map(source => ({
        sourceIndex: source.sourceIndex, section: "decisions", text: "Completed effect is retained",
        quote: source.passages[0].slice(0, 30), status: "unresolved",
        contradicts: [],
      })) }), usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0 } };
    };
    const observations: PreparationObservation[] = [];
    const unsubscribe = installPreparationObserver(event => observations.push(event));
    fixture.call.mockImplementation(options =>
      fixture.call.mock.calls.length === 1
        ? new Promise((_, reject) => options.abortSignal.addEventListener("abort",
          () => reject(options.abortSignal.reason), { once: true }))
        : validExtract(options));
    try {
      const compactor = await fixture.start({
        scope: { sessionId: "long-horizon", runId: "long-horizon:recovery",
          isCurrent: () => true },
        beforeModelAttempt: async signal => {
          signal.throwIfAborted();
          const remaining = f.profile().contextCalibration!.expiresAt - Date.now();
          expect(remaining).toBeGreaterThan(AGENT_CALIBRATION_EXTRACTION_ATTEMPT_HORIZON_MS);
        },
        limits: async () => ({ deployed: TIER, workingTarget: 9000,
          maxOutput: 4096, outputReserve: 4096 }),
        extractionRoute: async () => ({ model: {} as LanguageModel,
          limits: async () => ({ deployed: TIER, maxOutput: 1024,
            outputReserve: 1024 }) }),
      });
      const pending = compactor.prepare();
      await waitForExtraction(fixture.call, 1);
      const originalSources = (JSON.parse(fixture.call.mock.calls[0][0].messages[1].content as string) as { sources: unknown[] }).sources;
      expect(originalSources.length).toBeGreaterThan(1);
      expect(fixture.view().revision).toBeNull();
      await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs);
      await waitForExtraction(fixture.call, 2);
      const retrySources = (JSON.parse(fixture.call.mock.calls[1][0].messages[1].content as string) as { sources: unknown[] }).sources;
      expect(retrySources.length).toBeGreaterThan(0);
      expect(retrySources.length).toBeLessThan(originalSources.length);
      const prepared = await pending;
      expect(JSON.stringify(prepared)).toContain("Continue the remaining test and README");
      expect(fixture.memory.commit).toHaveBeenCalled();
      expect(observations.filter(e => e.phase === "extraction-timeout-retry")).toHaveLength(1);
      const deadlines = observations.filter(e => e.phase === "extraction-attempt-start")
        .map(e => e.attempt?.deadlineMs);
      expect(deadlines.length).toBeGreaterThanOrEqual(2);
      expect(deadlines.length).toBeLessThanOrEqual(COMPACTION_POLICY.maxModelAttemptsPerPreparation);
      expect(deadlines).toEqual(deadlines.map(() => 120_000));
      expect(JSON.stringify(fixture.originals)).toBe(before);
      // A second bounded provider horizon is independent from the preparation
      // renewal, and cannot be silently borrowed from the prior lease.
      await vi.advanceTimersByTimeAsync(180_000);
      expect(f.profile().contextCalibration!.expiresAt - Date.now())
        .toBeLessThan(AGENT_CALIBRATION_PROVIDER_HORIZON_MS);
      // The provider's 300s metadata TTL is independent of the 15m lease.
      // Re-observe its loaded allocation before attempting real calibration.
      f.loaded(TIER, f.profile().contextCalibration!.allocation!);
      f.runtime();
      const secondRenewal = await f.renew(AGENT_CALIBRATION_PROVIDER_HORIZON_MS);
      gate.updateAgentTrust(secondRenewal.state, secondRenewal.proof);
      expect(secondRenewal.proof.id).toBe(f.proof.id);
      expect(f.calibrations).toBe(2);
      let codingDispatches = 0;
      const wire = preflightFetch(async (_url, request) => {
        codingDispatches++;
        const body = JSON.parse(String(request?.body)) as ReturnType<typeof f.body>;
        expect(body.options).toEqual({ num_ctx: TIER, num_predict: 4096 });
        expect(body.tools).toHaveLength(1);
        return new Response(null, { status: 204 });
      }, gate);
      await wire("http://no-network.invalid/api/chat", {
        method: "POST", body: JSON.stringify(f.body()),
      });
      expect(codingDispatches).toBe(1);
      expect(run.agentRequestRecovery.attempts).toBe(1);
      expect(run.budget).toEqual(capturedBudget);
      expect(sameAgentRequestOwner(checkpoint, session)).toBe(true);
      // A later batch sees its own new completed write, without replaying
      // immutable prior receipts, while preserving the sole recovery allowance.
      fixture.originals[3].parts.push({ type: "step-start" }, {
        type: "tool-write_file", toolCallId: "later-follow-up-write",
        state: "output-available", input: { path: "README.md", content: "done" },
        output: { ok: true, clackWorkspaceWrite: true },
      } as Part);
      const followup = await fixture.start();
      expect(JSON.stringify(await followup.prepare())).toContain("later-follow-up-write");
      // The subsequent prepared segment must also survive the pinned native
      // allocation/proof preflight. It is a second provider request in the
      // same logical mission, not another provider-recovery allowance.
      await wire("http://no-network.invalid/api/chat", {
        method: "POST", body: JSON.stringify(f.body()),
      });
      expect(codingDispatches).toBe(2);
      expect(run.agentRequestRecovery.attempts).toBe(1);
      run.budget = recordRunBatch(run.budget!, {
        steps: 1, hitSoftLimit: false, finishReason: "stop",
        unfinishedWork: false,
      }, "trusted-workspace");
      expect(run.budget.phase).toBe("complete");
      expect(run.budget.stopReason).toBeNull();
      expect(run.budget.totalSteps).toBe(count + 1);
      expect(run.budget.continuationCount).toBe(0);
      run.state = "completed";
      expect(eligibleAgentRequestFailure(run, error)).toBe(false);
      expect(f.nativeProofs).toBe(0);
    } finally { unsubscribe(); }
  });

  it("revalidates the safe native authority boundary before EVERY extraction call and does not publish on failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const history = completedHistory().history;
    const f = compactionFixture(history);
    const original = JSON.stringify(f.originals);
    let attempts = 0;
    f.call.mockImplementation(options => new Promise((_, reject) =>
      options.abortSignal.addEventListener("abort", () => reject(options.abortSignal.reason), { once: true })));
    const compactor = await f.start({
      scope: { sessionId: "long-horizon", runId: "lease-horizon-negative", isCurrent: () => true },
      limits: async () => ({ deployed: TIER, workingTarget: 9000,
        maxOutput: 4096, outputReserve: 4096 }),
      extractionRoute: async () => ({ model: {} as LanguageModel,
        limits: async () => ({ deployed: TIER, maxOutput: 1024, outputReserve: 1024 }) }),
      beforeModelAttempt: async signal => {
        signal.throwIfAborted();
        attempts++;
        if (attempts === 2)
          throw new Error("The later extraction has no fresh native calibration lease");
      },
    });
    const pending = compactor.prepare();
    const failure = expect(pending).rejects.toThrow(/no fresh native calibration lease/);
    await waitForExtraction(f.call, 1);
    await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs);
    await failure;
    expect(attempts).toBe(2);
    expect(f.call).toHaveBeenCalledTimes(1);
    expect(f.memory.commit).not.toHaveBeenCalled();
    expect(f.view().revision).toBeNull();
    expect(JSON.stringify(f.originals)).toBe(original);
  });

  it.each(["unresolved-tool", "changed-completed-write"] as const)(
    "rejects %s before an interrupted Agent can form its recovery checkpoint", async kind => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const { history, writes, directories } = completedHistory();
      if (kind === "unresolved-tool") {
        const part = history[1].parts.find(p => p.type === "tool-write_file");
        if (!part || !("state" in part)) throw new Error("Missing test tool");
        part.state = "input-available";
        delete (part as { output?: unknown }).output;
      }
      const run: SessionRun = {
        state: "running", agentId: "builtin:coder", modelId: "captured",
        providerId: "ollama", transportModelId: "example", startedAt: NOW,
        workspaceRoot: "C:/long-horizon", workspaceId: "local:/long-horizon",
        budget: { phase: "running", totalSteps: 21, hardStepLimit: 240,
          continuationCount: 0, maxAutoContinuations: 9 } as SessionRun["budget"],
      };
      const session: SessionMeta = { id: "long-horizon", title: "Captured",
        createdAt: NOW, updatedAt: NOW, run };
      await expect(captureAgentRequestCheckpoint(session, history.slice(0, 2), {
        permissions: {}, todos: [], plan: {}, records: [], writeCheckpoint: null,
        workspaceRevision: "f".repeat(64),
        readFile: async path => kind === "changed-completed-write"
          ? "different contents after write" : writes.get(path) ?? "",
        isDirectory: async path => directories.has(path),
      })).rejects.toThrow(
        kind === "unresolved-tool" ? /unresolved|incomplete/i : /changed after completed write/i,
      );
    },
  );

  it.each(["stale-memory-revision", "second-extraction-timeout", "cancelled"] as const)(
    "fails closed for %s without committing partial memory or extending the retry allowance",
    async kind => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const f = compactionFixture(completedHistory().history);
      const controller = new AbortController();
      const original = JSON.stringify(f.originals);
      f.call.mockImplementation(options => new Promise((_, reject) => {
        const abort = () => {
          if (kind === "stale-memory-revision") {
            const view = f.view();
            f.change({ preparation: { ...view.preparation,
              generation: view.preparation.generation + 1 } });
          }
          reject(options.abortSignal.reason);
        };
        options.abortSignal.addEventListener("abort", abort, { once: true });
        if (options.abortSignal.aborted) abort();
      }));
      const compactor = await f.start({
        signal: controller.signal,
        scope: { sessionId: "long-horizon", runId: "negative-" + kind, isCurrent: () => true },
        limits: async () => ({ deployed: TIER, workingTarget: 9000,
          maxOutput: 4096, outputReserve: 4096 }),
        extractionRoute: async () => ({ model: {} as LanguageModel,
          limits: async () => ({ deployed: TIER, maxOutput: 1024, outputReserve: 1024 }) }),
      });
      const pending = compactor.prepare();
      const failure = expect(pending).rejects.toMatchObject({
        ...(kind === "cancelled" ? { name: "AbortError" }
          : kind === "stale-memory-revision" ? { code: "compaction-stale" }
          : { code: "compaction-timeout" }),
      });
      await waitForExtraction(f.call, 1);
      if (kind === "cancelled")
        controller.abort(new DOMException("Cancelled", "AbortError"));
      else {
        await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs);
        if (kind === "second-extraction-timeout") {
          await waitForExtraction(f.call, 2);
          await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs);
        }
      }
      await failure;
      expect(f.call.mock.calls.length).toBe(kind === "second-extraction-timeout" ? 2 : 1);
      expect(f.memory.commit).not.toHaveBeenCalled();
      expect(f.view().revision).toBeNull();
      expect(JSON.stringify(f.originals)).toBe(original);
    },
  );

  it("rejects a changed runtime epoch and consumes no requalification inference", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const f = measuredRuntime();
    f.changeEpoch("another-ollama-process");
    await expect(f.renew(agentCalibrationPreparationHorizon(true)))
      .rejects.toThrow(/runtime or captured endpoint\/model identity changed/);
    expect(f.calibrations).toBe(0);
    expect(f.nativeProofs).toBe(0);
  });

  it("an expired calibration with no renewable native evidence cannot authorize any coding request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const f = measuredRuntime();
    const expiry = f.profile().contextCalibration!.expiresAt;
    f.profile().contextCalibration!.expiresAt = NOW - 1;
    f.setCalibrationAvailable(false);
    const gate = f.preflight();
    await expect(f.renew(agentCalibrationPreparationHorizon(true))).rejects.toThrow();
    expect(f.profile().contextCalibration!.expiresAt).not.toBeGreaterThan(expiry);
    expect(f.calibrations).toBe(0);
    expect(f.nativeProofs).toBe(0);
    const send = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(preflightFetch(send, gate)("http://no-network.invalid/api/chat", {
      method: "POST", body: JSON.stringify(f.body()),
    })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["model-digest", "native-proof-expiry", "native-proof-revoked"] as const)(
    "blocks a %s change before a continued coding request reaches native HTTP", async change => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const f = measuredRuntime();
      const preflight = f.preflight();
      const send = vi.fn(async () => new Response(null, { status: 204 }));
      if (change === "model-digest")
        f.profile().modelRevision = "unapproved-model-replacement";
      else if (change === "native-proof-expiry")
        f.profile().agentToolTierProofs![0].proof!.expiresAt = NOW - 1;
      else
        f.profile().agentToolTierProofs![0].failure = {
          at: NOW, expiresAt: NOW + 60_000, outcome: "text-only",
        };
      await expect(preflightFetch(send, preflight)("http://no-network.invalid/api/chat", {
        method: "POST", body: JSON.stringify(f.body()),
      })).rejects.toThrow();
      expect(send).not.toHaveBeenCalled();
      expect(f.calibrations).toBe(0);
      expect(f.nativeProofs).toBe(0);
    },
  );
});
