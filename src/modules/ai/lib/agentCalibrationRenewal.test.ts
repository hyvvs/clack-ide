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
import {
  agentCalibrationRenewalDue, agentCalibrationPreparationHorizon,
  AGENT_CALIBRATION_PREPARATION_HORIZON_MS,
  AGENT_CALIBRATION_PROVIDER_HORIZON_MS,
  AGENT_CALIBRATION_EXTRACTION_ATTEMPT_HORIZON_MS,
  renewAgentCalibrationAtBoundary,
} from "@/modules/ai/lib/agentCalibrationRenewal";
import { createRequestPreflight, preflightFetch } from "@/modules/ai/lib/requestPreflight";
import { compactionFixture, disposeCompactionFixtures, textMessage } from "@/modules/ai/lib/conversationCompaction.fixture";
import { COMPACTION_POLICY } from "@/modules/ai/lib/compactionExtraction";
import { installPreparationObserver, type PreparationObservation } from "@/modules/ai/lib/preparationLifecycle";
import { eligibleAgentRequestFailure } from "@/modules/ai/lib/agentRequestRecovery";
import { normalizeAiError } from "@/modules/ai/lib/errors";
import { InferenceTransportError } from "@/modules/ai/lib/inferenceErrors";
import { captureAgentRequestCheckpoint, sameAgentRequestOwner } from "@/modules/ai/lib/agentRequestRecovery";
import type { SessionMeta, SessionRun } from "@/modules/ai/lib/sessions";
import type { UIMessage, LanguageModel } from "ai";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const NOW = 1_800_000_000_000;
const TIER = 49152;
const TIERS = [4096, 8192, 16384, 32768, 49152, 65536, 73728];

function fixture(selectedTier = TIER) {
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
  refreshEvidence(selectedTier, "original-loaded-allocation");
  const scope = toolScope(p, endpoint)!;
  const proof: ToolVerification = {
    version: 1, id: "retained-exact-tier", scope, status: "verified",
    outcome: "native-call", context: selectedTier, output: 512,
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
    owner: () => boolean = () => true, minimumRemainingMs?: number) =>
    renewAgentCalibrationAtBoundary(state, p.id, retained, signal, owner, deps,
      minimumRemainingMs);
  return {
    run, proof, deps, currentProfile, snapshot, state: () => state,
    refreshEvidence,
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
  disposeCompactionFixtures();
  forgetContextRuntime("server");
  vi.mocked(invoke).mockReset();
  vi.useRealTimers();
});

describe("combined long-horizon continuation authority: offline campaign-06 reproduction", () => {
  it("both ordinary and recovered Agent compaction reserve the whole bounded preparation horizon, then separately reserve native HTTP", () => {
    expect(agentCalibrationPreparationHorizon(true)).toBe(
      COMPACTION_POLICY.timeoutMs * COMPACTION_POLICY.maxModelAttemptsPerPreparation + 30_000,
    );
    expect(AGENT_CALIBRATION_PREPARATION_HORIZON_MS).toBe(630_000);
    expect(AGENT_CALIBRATION_PROVIDER_HORIZON_MS).toBe(630_000);
    expect(AGENT_CALIBRATION_EXTRACTION_ATTEMPT_HORIZON_MS).toBe(150_000);
    expect(agentCalibrationPreparationHorizon(false)).toBe(30_000);
    expect(AGENT_CALIBRATION_PROVIDER_HORIZON_MS).toBeLessThan(900_000);
    const ordinaryLease = NOW + 590_000;
    // The old 30-second lead would have begun a five-attempt compaction
    // despite the lease being unable to span a legal preparation window.
    expect(agentCalibrationRenewalDue(ordinaryLease, NOW, 30_000)).toBe(false);
    expect(agentCalibrationRenewalDue(ordinaryLease, NOW, agentCalibrationPreparationHorizon(true))).toBe(true);
    expect(agentCalibrationRenewalDue(ordinaryLease, NOW, AGENT_CALIBRATION_PROVIDER_HORIZON_MS)).toBe(true);
  });
  it.each([
    { renewBeforeCompaction: false, label: "original fail-closed expiry" },
    { renewBeforeCompaction: true, label: "same-epoch safe-boundary renewal" },
  ])("$label: 19 reconciled tools, one provider recovery and a 120s extraction timeout", async ({ renewBeforeCompaction }) => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const tier = 32768;
    const f = fixture(tier);
    const initial = await f.run();
    expect(initial.state.profiles.find(p => p.id === f.currentProfile().id)?.contextCalibration?.highest).toBe(tier);
    expect(initial.proof.context).toBe(tier);
    const expiry = f.currentProfile().contextCalibration!.expiresAt;
    const endpoint = f.state().endpoints.find(e => e.id === f.currentProfile().endpointId)!;
    const body = () => ({
      model: f.currentProfile().transportModelId, stream: false,
      options: { num_ctx: tier, num_predict: 1024 },
      messages: [{ role: "system", content: "Extract only bounded evidence" },
        { role: "user", content: "Synthetic, content-free test evidence" }],
    });
    vi.mocked(invoke).mockImplementation(async command => {
      if (command === "self_hosted_profiles_snapshot")
        return [["selfHostedInference", f.state()]];
      if (command === "self_hosted_probe_cache" || command === "self_hosted_probe") {
        // A real metadata re-observation may refresh allocation timestamps,
        // but can NEVER extend an expired native calibration lease.
        f.refreshEvidence(tier, f.currentProfile().contextCalibration!.allocation!);
        return f.snapshot();
      }
      if (command === "self_hosted_context_runtime") return {
        epoch: "same-native-runtime", version: "0.40.11",
        configurationRevision: endpoint.configurationRevision, at: Date.now(),
      };
      throw new Error("No live inference or native tool dispatch: " + command);
    });
    const earlier: SessionRun = {
      state: "running", agentId: "builtin:coder", modelId: "pinned-native-model",
      providerId: "ollama", transportModelId: f.currentProfile().transportModelId,
      startedAt: NOW, customTools: { revision: 1, versions: [], unavailable: false },
      budget: { phase: "running", totalSteps: 20, hardStepLimit: 240,
        continuationCount: 0, maxAutoContinuations: 9 } as SessionRun["budget"],
    };
    const failure = normalizeAiError(new InferenceTransportError("stream-idle-timeout"));
    const idleStartedAt = f.currentProfile().contextCalibration!.expiresAt - 241_500;
    vi.setSystemTime(idleStartedAt);
    expect(eligibleAgentRequestFailure(earlier, failure)).toBe(true);
    // The previous coding request yielded first progress, then crossed exactly
    // the native 180-second stream inactivity threshold.
    vi.setSystemTime(idleStartedAt + 180_000);
    earlier.agentRequestRecovery = {
      attempts: 1, phase: "preparing", consumedBy: "stream-idle-timeout", failures: [failure],
    };
    expect(eligibleAgentRequestFailure(earlier, failure)).toBe(false);
    const toolNames = [
      "list_directory", ...Array(3).fill("todo_write"),
      ...Array(4).fill("create_directory"), ...Array(11).fill("write_file"),
    ] as string[];
    const workingRoot = "C:/offline-reliability";
    earlier.workspaceRoot = workingRoot;
    earlier.workspaceId = "local:/offline-reliability";
    const materialized = new Map<string, string>();
    const directories = new Set<string>();
    const receipts = toolNames.map((name, index) => {
      const path = `${workingRoot}/file-${index}.ts`;
      const content = `export const completed = ${index};`;
      if (name === "write_file") materialized.set(path, content);
      if (name === "create_directory") directories.add(path);
      return {
        type: `tool-${name}` as `tool-${string}`,
        toolCallId: `completed-${index}`, state: "output-available" as const,
        input: name === "write_file" ? { path, content } :
          name === "create_directory" ? { path } : { entries: [] },
        output: name === "write_file"
          ? { path, ok: true, clackWorkspaceWrite: true, bytesWritten: content.length }
          : name === "create_directory" ? { path, ok: true, clackWorkspaceWrite: true }
            : { ok: true },
      };
    });
    // One logical run, many successful tool turns, then a genuine 180-second
    // stream-idle boundary and the accepted same-run provider recovery.
    const history: UIMessage[] = [
      textMessage("objective", "user", "Implement a local application without repeating completed work"),
      { id: "completed-steps", role: "assistant",
        parts: Array.from({ length: 19 }, (_, index) => [
          { type: "step-start" as const },
          { type: "text" as const, text: `Completed step ${index}. ${"Historical verification evidence. ".repeat(95)}` },
          receipts[index],
        ]).flat(),
      },
      textMessage("latest", "user", "Continue only unfinished work from the existing durable checkpoint"),
      { id: "pending", role: "assistant", parts: [] },
    ];
    const session: SessionMeta = {
      id: "same-run", title: "Offline long-horizon reliability",
      createdAt: NOW, updatedAt: NOW, run: earlier,
    };
    const checkpoint = await captureAgentRequestCheckpoint(session,
      history.slice(0, 2), {
        permissions: { mode: "same-original-authority" },
        todos: [], plan: {}, records: [], writeCheckpoint: null,
        workspaceRevision: "f".repeat(64),
        readFile: async path => {
          if (!materialized.has(path)) throw new Error("Missing completed native write");
          return materialized.get(path)!;
        },
        isDirectory: async path => directories.has(path),
      });
    expect(checkpoint.toolReceipts).toHaveLength(19);
    expect(checkpoint.workspaceReceipts).toHaveLength(15);
    expect(sameAgentRequestOwner(checkpoint, session)).toBe(true);
    earlier.agentRequestRecovery = {
      ...earlier.agentRequestRecovery, checkpoint, phase: "dispatched",
    };
    const originalBudget = structuredClone(earlier.budget);
    const fCompaction = compactionFixture(history);
    const phases: PreparationObservation[] = [];
    const unsubscribe = installPreparationObserver(event => phases.push(event));
    let freshProviderSegments = 0;
    const preflight = createRequestPreflight({
      state: f.state(), local: true, providerId: "ollama",
      modelId: f.currentProfile().transportModelId,
      requiredRuntimeContext: tier, requiredContinuationProof: initial.proof,
      admission: { endpointId: endpoint.id, profileId: f.currentProfile().id, capacity: 1 },
    });
    expect(Date.now()).toBe(expiry - 61_500);
    expect(agentCalibrationRenewalDue(expiry)).toBe(false); // 30-second ordinary lead
    f.refreshEvidence(tier, f.currentProfile().contextCalibration!.allocation!);
    rememberContextRuntime(endpoint.id, { epoch: "same-native-runtime", version: "0.40.11",
      configurationRevision: endpoint.configurationRevision, at: Date.now() });
    expect(freshVerifiedContextTiers(f.state(), f.currentProfile(), f.snapshot())).toContain(tier);
    const remainingLease = expiry - Date.now();
    const compactionHorizonMs = COMPACTION_POLICY.timeoutMs *
      COMPACTION_POLICY.maxModelAttemptsPerPreparation + 30_000;
    expect(remainingLease).toBe(61_500);
    expect(agentCalibrationRenewalDue(expiry, Date.now(), compactionHorizonMs)).toBe(true);
    if (renewBeforeCompaction) {
      const renewed = await f.run(initial.proof, new AbortController().signal,
        () => true, compactionHorizonMs);
      expect(renewed.proof.id).toBe(initial.proof.id);
      expect(renewed.proof.scope).toEqual(initial.proof.scope);
      expect(renewed.state.profiles.find(p => p.id === f.currentProfile().id)
        ?.contextCalibration?.expiresAt).toBeGreaterThan(expiry);
      preflight.updateAgentTrust(renewed.state, renewed.proof);
    }
    await expect((await preflight.prepare(body()))()).resolves.toBeUndefined();
    fCompaction.call.mockImplementation(async options => {
      if (fCompaction.call.mock.calls.length === 1)
        return new Promise((_, reject) => options.abortSignal.addEventListener("abort",
          () => reject(options.abortSignal.reason), { once: true }));
      await (await preflight.prepare(body()))();
      freshProviderSegments++;
      const sources = (JSON.parse(options.messages[1].content as string) as {
        sources: { id: string; passages: string[] }[];
      }).sources;
      // Short valid synthetic claims cite exact fragments of the unchanged
      // original step evidence, within the real extractor output allowance.
      return { text: JSON.stringify({ claims: sources.map(source => ({
        source: source.id, section: "decisions",
        text: "The completed step remains in the durable checkpoint",
        quote: source.passages[0].slice(0, 30), status: "unresolved",
        contradicts: [],
      })) }), usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0 } };
    });
    try {
      const c = await fCompaction.start({
        scope: { sessionId: "same-run", runId: "same-run:campaign-06", isCurrent: () => true },
        limits: async () => ({ deployed: 32768, workingTarget: 9000, maxOutput: 4096 }),
        extractionRoute: async () => ({ model: {} as LanguageModel,
          limits: async () => ({ deployed: 32768, maxOutput: 1024, outputReserve: 1024 }) }),
      });
      const pending = c.prepare();
      const terminal = renewBeforeCompaction
        ? expect(pending).resolves.toBeDefined()
        : expect(pending).rejects.toMatchObject({ code: "ollama-continuation-allocation-stale" });
      for (let n = 0; n < 150 && fCompaction.call.mock.calls.length < 1; n++)
        await vi.advanceTimersByTimeAsync(0);
      expect(fCompaction.call).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs);
      await terminal;
      if (renewBeforeCompaction) {
        expect(fCompaction.call.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(fCompaction.call.mock.calls.length).toBeLessThanOrEqual(
          COMPACTION_POLICY.maxModelAttemptsPerPreparation);
      } else expect(fCompaction.call).toHaveBeenCalledTimes(2);
      expect(freshProviderSegments).toBe(renewBeforeCompaction
        ? fCompaction.call.mock.calls.length - 1 : 0);
      if (renewBeforeCompaction) expect(fCompaction.memory.commit).toHaveBeenCalled();
      else expect(fCompaction.memory.commit).not.toHaveBeenCalled();
      expect(phases.filter(x => x.phase === "extraction-timeout-retry")).toHaveLength(1);
      expect(phases.filter(x => x.phase === "extraction-attempt-start")
        .map(x => x.attempt?.deadlineMs)).toEqual(
          fCompaction.call.mock.calls.map(() => 120_000));
      if (renewBeforeCompaction) {
        // Only after compaction commits is one fresh provider coding segment
        // authorized; this is the SAME run and consumes no second recovery.
        // In a long ordinary or recovered Agent step, separate post-compaction
        // bookkeeping can legally consume another bounded segment of time.
        // A lease that survived extraction need not span the next 600s native
        // request; the safe pre-dispatch renewal must run AGAIN, not extend it.
        await vi.advanceTimersByTimeAsync(180_000);
        const beforeNative = f.currentProfile().contextCalibration!.expiresAt;
        expect(beforeNative - Date.now()).toBeLessThan(AGENT_CALIBRATION_PROVIDER_HORIZON_MS);
        expect(beforeNative).toBeGreaterThan(Date.now());
        const renewedForRequest = await f.run(initial.proof,
          new AbortController().signal, () => true, AGENT_CALIBRATION_PROVIDER_HORIZON_MS);
        expect(renewedForRequest.proof.id).toBe(initial.proof.id);
        expect(renewedForRequest.proof.scope).toEqual(initial.proof.scope);
        expect(f.currentProfile().contextCalibration!.expiresAt).toBeGreaterThan(beforeNative);
        expect(f.currentProfile().contextCalibration!.expiresAt - Date.now())
          .toBeGreaterThan(AGENT_CALIBRATION_PROVIDER_HORIZON_MS);
        preflight.updateAgentTrust(renewedForRequest.state, renewedForRequest.proof);
        const codingBody = { ...body(), stream: true,
          options: { num_ctx: tier, num_predict: 4096 },
          tools: [{ type: "function", function: { name: "read_file", description: "read",
            parameters: { type: "object", properties: {} } } }] };
        await expect((await preflight.prepare(codingBody))()).resolves.toBeUndefined();
        let codingDispatches = 0;
        const offlineWire = preflightFetch(async (_url, request) => {
          codingDispatches++;
          const parsed = JSON.parse(String(request?.body)) as typeof codingBody;
          expect(parsed.options.num_ctx).toBe(32768);
          expect(parsed.options.num_predict).toBe(4096);
          expect(parsed.tools).toHaveLength(1);
          return new Response(null, { status: 204 });
        }, preflight);
        await offlineWire("http://offline-unreachable.invalid/api/chat", {
          method: "POST", body: JSON.stringify(codingBody),
        });
        expect(codingDispatches).toBe(1);
        expect(earlier.agentRequestRecovery?.attempts).toBe(1);
        expect(sameAgentRequestOwner(checkpoint, session)).toBe(true);
      }
      if (!renewBeforeCompaction)
        expect(f.currentProfile().contextCalibration?.expiresAt).toBe(expiry);
      expect(f.proof.proof?.expiresAt).toBeGreaterThan(Date.now());
      expect(earlier.budget).toEqual(originalBudget);
      expect(materialized.size).toBe(11);
      expect(directories.size).toBe(4);
    } finally {
      unsubscribe();
    }
  });

  it.each(["runtime-epoch", "digest", "cancelled", "proof-substitution",
    "missing-allocation", "renewal-horizon-invalid"] as const)(
    "fails closed when %s changes during a recovery-compaction safe-boundary requalification",
    async (change) => {
      const f = fixture(32768);
      const retained = structuredClone(f.proof);
      const horizon = COMPACTION_POLICY.timeoutMs *
        COMPACTION_POLICY.maxModelAttemptsPerPreparation + 30_000;
      const controller = new AbortController();
      if (change === "runtime-epoch") f.epoch("different-native-process");
      if (change === "digest") f.digestChange(true);
      if (change === "cancelled")
        controller.abort(new DOMException("Operator cancelled", "AbortError"));
      if (change === "proof-substitution")
        f.currentProfile().agentToolTierProofs![0].id = "replaced-native-proof";
      if (change === "missing-allocation") f.unload();
      const required = change === "renewal-horizon-invalid" ? 901_000 : horizon;
      await expect(f.run(retained, controller.signal, () => true, required))
        .rejects.toThrow();
      expect(f.verifications).toBe(0);
      expect(f.requests).toBeLessThanOrEqual(1);
      if (change !== "digest" && change !== "missing-allocation")
        expect(f.requests).toBe(0);
    },
  );

  it("does not accept a genuinely renewed lease if subsequent native checks exhaust the requested preparation horizon", async () => {
    const f = fixture(32768);
    const original = vi.mocked(f.deps.inspect).getMockImplementation()!;
    let inspections = 0;
    vi.mocked(f.deps.inspect).mockImplementation(async (...args) => {
      await original(...args);
      inspections++;
      if (inspections === 2) {
        // Calibration itself succeeded. Other work was slow, so a lease
        // checked only at the middle of renewal is no longer long enough.
        vi.setSystemTime(Date.now() + 270_001);
        f.refreshEvidence(32768, f.currentProfile().contextCalibration!.allocation!);
        const endpoint = f.state().endpoints[0];
        rememberContextRuntime(endpoint.id, { epoch: "same-native-runtime", version: "0.40.11",
          configurationRevision: endpoint.configurationRevision, at: Date.now() });
      }
    });
    await expect(f.run(f.proof, new AbortController().signal, () => true, 630_000))
      .rejects.toThrow(/renewed exact-tier lease cannot cover bounded preparation/);
    expect(f.requests).toBe(1);
    expect(f.verifications).toBe(0);
  });
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
