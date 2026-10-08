import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { generateText } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { buildLanguageModel } from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { calibrationFixture } from "@/modules/ai/lib/calibration.fixtures";
import { optimizeInferenceProfile } from "@/modules/ai/lib/calibrationOptimization";
import {
  appendCalibrationSamples,
  type ScopedCalibrationSample,
} from "@/modules/ai/lib/inferenceCalibration";
import {
  createSelfHostedPersistence,
  nativeSelfHostedStorage,
} from "@/modules/settings/selfHostedPersistence";
import {
  editSelfHostedEndpoint,
  profileEvidence,
  setProfileRecommendation,
  setProfileOverride,
  SELF_HOSTED_SETTINGS_KEY,
} from "@/modules/ai/lib/selfHostedProfiles";
import { createRequestPreflight } from "@/modules/ai/lib/requestPreflight";
import { modelBudgetLimits } from "@/modules/ai/lib/requestPreflight";
import { budgetIdentity } from "@/modules/ai/lib/contextBudgetProfile";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage = (_e: unknown) => {};
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    entries = async () => [];
  },
}));
let state = calibrationFixture();
let mode: "success" | "queued" | "unknown-usage" = "success";
const bodies: Record<string, unknown>[] = [];
const approvals = new Map<string, (approved: boolean) => void>();
beforeEach(() => {
  state = calibrationFixture();
  state.profiles[0].saved = { label: "Coder" };
  mode = "success";
  bodies.length = 0;
  approvals.clear();
  vi.clearAllMocks();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "self_hosted_profiles_snapshot")
      return [[SELF_HOSTED_SETTINGS_KEY, structuredClone(state)]];
    if (command === "self_hosted_profiles_compare_and_swap") {
      const a = args as { expected: unknown; value: typeof state };
      if (JSON.stringify(a.expected) !== JSON.stringify(state)) return false;
      state = structuredClone(a.value);
      return true;
    }
    if (command === "ai_http_open") return crypto.randomUUID();
    if (command === "ai_http_preflight") {
      const a = args as { requestId: string; approved: boolean };
      approvals.get(a.requestId)?.(a.approved);
      return;
    }
    if (command === "ai_http_cancel") return;
    if (command !== "ai_http_stream") return null;
    const a = args as {
      requestId: string;
      body: number[];
      admission: { endpointId: string; profileId: string; capacity: number };
      onEvent: { onmessage: (e: unknown) => void };
    };
    const event = (e: object) =>
      a.onEvent.onmessage({ requestId: a.requestId, ...e });
    const now = Date.now();
    const observation = {
      ...a.admission,
      queueEnteredAt: now - 50,
      admittedAt: mode === "queued" ? null : now,
      attemptStartedAt: mode === "queued" ? null : now,
      settledAt: null,
    };
    if (mode === "queued") {
      event({ kind: "admission", observation });
      event({
        kind: "settled",
        phase: "cancelled",
        error: { code: "cancelled" },
      });
      return;
    }
    const approved = await new Promise<boolean>((resolve) => {
      approvals.set(a.requestId, resolve);
      event({ kind: "preflight" });
    });
    approvals.delete(a.requestId);
    if (!approved) {
      event({
        kind: "settled",
        phase: "failed",
        error: { code: "context-preflight-rejected" },
      });
      return;
    }
    event({ kind: "admission", observation });
    const body = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(a.body)),
    ) as Record<string, unknown>;
    bodies.push(body);
    const usage =
      mode === "unknown-usage"
        ? undefined
        : { prompt_tokens: 20, completion_tokens: 40, total_tokens: 60 };
    const streaming = body.stream === true;
    const payload = streaming
      ? `data: ${JSON.stringify({ id: "r", model: "coder", created: 1, choices: [{ index: 0, delta: { content: "Test answer" }, finish_reason: "stop" }], usage })}\n\ndata: [DONE]\n\n`
      : JSON.stringify({
          id: "r",
          model: "coder",
          created: 1,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Test answer" },
              finish_reason: "stop",
            },
          ],
          usage,
        });
    event({
      kind: "headers",
      status: 200,
      headers: {
        "content-type": streaming ? "text/event-stream" : "application/json",
      },
    });
    event({ kind: "chunk", bytes: [...new TextEncoder().encode(payload)] });
    event({
      kind: "admission",
      observation: { ...observation, settledAt: Date.now() },
    });
    event({ kind: "settled", phase: "completed" });
  });
});
afterEach(() => vi.useRealTimers());
async function build(record: (sample: ScopedCalibrationSample) => void) {
  return (await buildLanguageModel(
    "openai-compatible",
    EMPTY_PROVIDER_KEYS,
    "coder",
    {
      selfHosted: true,
      selfHostedInference: structuredClone(state),
      openaiCompatibleBaseURL: "http://a/v1",
      admission: {
        endpointId: "a",
        profileId: state.profiles[0].id,
        capacity: 1,
      },
      calibration: { record },
    },
  )) as LanguageModelV3;
}
describe("E2 installed adapter, native admission and persistence integration", () => {
  it("does not interrupt a captured request for performance tuning, but preserves real B1 setting guards", async () => {
    const model = await build(() => {});
    const originalIdentity = budgetIdentity(state, state.profiles[0].id);
    for (const field of [
      "concurrentGenerations",
      "prefillTimeoutMs",
      "idleTimeoutMs",
    ] as const)
      state = setProfileRecommendation(
        state,
        state.profiles[0].id,
        field,
        profileEvidence(
          state,
          state.profiles[0].id,
          field,
          field === "concurrentGenerations" ? 2 : 108000,
          "recommendation",
        ),
      );
    expect(budgetIdentity(state, state.profiles[0].id)).toBe(originalIdentity);
    const result = await generateText({
      model,
      prompt: "Hi",
      maxOutputTokens: 128,
      maxRetries: 0,
    });
    expect(result.text).toBe("Test answer");
    state = setProfileOverride(
      state,
      state.profiles[0].id,
      "workingContext",
      1024,
    );
    expect(budgetIdentity(state, state.profiles[0].id)).not.toBe(
      originalIdentity,
    );
    await expect(
      generateText({
        model,
        prompt: "Hi",
        maxOutputTokens: 128,
        maxRetries: 0,
      }),
    ).rejects.toThrow("changed");
    expect(bodies).toHaveLength(1);
  });
  it("captures normal installed-adapter usage/timing and commits through existing CAS", async () => {
    const samples: ScopedCalibrationSample[] = [];
    const model = await build((s) => samples.push(s));
    const result = await model.doStream({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Private user request" }],
        },
      ],
      maxOutputTokens: 128,
    });
    const reader = result.stream.getReader();
    while (!(await reader.read()).done) {}
    expect(samples).toHaveLength(1);
    expect(samples[0].sample).toMatchObject({
      outcome: "success",
      inputTokens: 20,
      outputTokens: 40,
      queueMs: 50,
      concurrency: 1,
    });
    expect(JSON.stringify(samples)).not.toMatch(
      /Private user request|Test answer/,
    );
    const store = createSelfHostedPersistence(nativeSelfHostedStorage());
    await store.update((s) => appendCalibrationSamples(s, samples));
    expect((await store.load()).profiles[0].calibration?.samples).toEqual(
      samples.map((s) => s.sample),
    );
    const restarted = createSelfHostedPersistence(nativeSelfHostedStorage());
    expect((await restarted.load()).profiles[0].calibration).toEqual(
      state.profiles[0].calibration,
    );
    expect(bodies).toHaveLength(1);
    expect((await modelBudgetLimits(model)).workingTarget).toBeUndefined();
  });
  it("normalizes omitted usage to unknown in the real compatible adapter", async () => {
    mode = "unknown-usage";
    const samples: ScopedCalibrationSample[] = [];
    const result = await generateText({
      model: await build((s) => samples.push(s)),
      prompt: "Hello",
      maxOutputTokens: 128,
      maxRetries: 0,
    });
    expect(result.text).toBe("Test answer");
    expect(samples[0].sample.inputTokens).toBeNull();
    expect(samples[0].sample.outputTokens).toBeNull();
    expect(samples[0].sample.ttftMs).toBeNull();
  });
  it("rejects stale sample publication without removing pins or another window's edit", async () => {
    const samples: ScopedCalibrationSample[] = [];
    await generateText({
      model: await build((s) => samples.push(s)),
      prompt: "Hello",
      maxOutputTokens: 128,
      maxRetries: 0,
    });
    state = editSelfHostedEndpoint(state, "a", {
      baseURL: "http://changed/v1",
    });
    state = setProfileOverride(
      state,
      state.profiles[0].id,
      "concurrentGenerations",
      4,
    );
    const store = createSelfHostedPersistence(nativeSelfHostedStorage());
    await store.update((s) => appendCalibrationSamples(s, samples));
    expect(state.profiles[0].calibration).toBeUndefined();
    expect(
      state.profiles[0].overrides.concurrentGenerations?.evidence.value,
    ).toBe(4);
  });
  it("runs real synthetic generation through B1, E1, D1 and profile CAS", async () => {
    state = setProfileOverride(
      state,
      state.profiles[0].id,
      "concurrentGenerations",
      2,
    );
    const result = await optimizeInferenceProfile({
      state,
      profileId: state.profiles[0].id,
      signal: new AbortController().signal,
    });
    expect(result.completed).toBe(3);
    expect(bodies).toHaveLength(3);
    expect(bodies.every((b) => b.max_tokens === 170 && !b.tools)).toBe(true);
    expect(
      state.profiles[0].calibration?.samples.every(
        (s) => s.requestClass === "optimization",
      ),
    ).toBe(true);
    expect(
      state.profiles[0].overrides.concurrentGenerations?.evidence.value,
    ).toBe(2);
    expect(
      vi.mocked(invoke).mock.calls.filter(([c]) => c === "ai_http_preflight"),
    ).toHaveLength(3);
  });
  it("aborts a real queued optimization before sending request content", async () => {
    mode = "queued";
    await expect(
      optimizeInferenceProfile({
        state,
        profileId: state.profiles[0].id,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("capacity");
    expect(bodies).toEqual([]);
    expect(state.profiles[0].calibration).toBeUndefined();
  });
  it("refuses oversized synthetic wire input and output through B1", async () => {
    const preflight = createRequestPreflight({
      modelId: "coder",
      local: true,
      optimization: true,
    });
    await expect(
      preflight.prepare({
        messages: [{ role: "user", content: "x".repeat(9000) }],
        max_tokens: 170,
      }),
    ).rejects.toThrow();
    await expect(
      preflight.prepare({
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 171,
      }),
    ).rejects.toThrow();
    expect(bodies).toEqual([]);
  });
  it("merges independent window batches under existing CAS conflict handling", async () => {
    const samples: ScopedCalibrationSample[] = [];
    await generateText({
      model: await build((s) => samples.push(s)),
      prompt: "Hi",
      maxOutputTokens: 128,
      maxRetries: 0,
    });
    const a = createSelfHostedPersistence(nativeSelfHostedStorage()),
      b = createSelfHostedPersistence(nativeSelfHostedStorage());
    await Promise.all([
      a.update((s) => appendCalibrationSamples(s, samples)),
      b.update((s) =>
        editSelfHostedEndpoint(s, "b", { alias: "Other window" }),
      ),
    ]);
    expect(state.profiles[0].calibration?.samples).toHaveLength(1);
    expect(state.endpoints[1].alias).toBe("Other window");
    expect(await a.load()).toEqual(await b.load());
  });
});
