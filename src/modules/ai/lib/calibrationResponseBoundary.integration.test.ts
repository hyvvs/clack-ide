/** R5o: offline synthetic Ollama NDJSON, NOT a replay of R5n response bytes.
 * Exercise the same streamText().consumeStream() / Channel transport used by
 * production context calibration, including its abortable settlement wait.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamText } from "ai";
import { invoke } from "@tauri-apps/api/core";
import { createOllamaModel } from "./ollamaModel";
import { createProxyFetch } from "./proxyFetch";
import { waitForRecovery } from "./providerRetry";
import { sessionInference } from "./inferenceLifecycle";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class { onmessage: (event: unknown) => void = () => {}; },
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

type Channel = { onmessage: (event: unknown) => void };
type Attempt = { requestId: string; onEvent: Channel; done: ReturnType<typeof deferred> };
const requests: Attempt[] = [];
let nextId = 0;
const emit = (attempt: Attempt, event: object) =>
  attempt.onEvent.onmessage({ requestId: attempt.requestId, ...event });
const wire = (part: object) => `${JSON.stringify(part)}\n`;
const reply = wire({
  model: "synthetic-fixture", message: { role: "assistant", content: "OK" },
  done: false,
}) + wire({
  model: "synthetic-fixture", message: { role: "assistant", content: "" },
  done: true, done_reason: "stop", prompt_eval_count: 7, eval_count: 2,
});
const request = (signal: AbortSignal) => {
  const model = createOllamaModel({
    modelId: "synthetic-fixture", baseURL: "http://localhost:11435",
    fetch: createProxyFetch({
      selfHosted: true, allowPrivateNetwork: true,
      admission: { endpointId: "fixture-endpoint", profileId: "fixture-profile", capacity: 1 },
      scope: { sessionId: "fixture-calibration", runId: "one", isCurrent: () => !signal.aborted },
    }),
  });
  // This is precisely calibration's request consumption path, not generateText().
  const result = streamText({ model, prompt: "Reply with OK.", maxOutputTokens: 32, maxRetries: 0, abortSignal: signal });
  return { result, settle: () => waitForRecovery(result.consumeStream(), signal) };
};
const started = async () => {
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  return requests[0];
};

beforeEach(() => {
  requests.length = 0;
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation((command, args) => {
    if (command === "ai_http_open") return Promise.resolve(`synthetic-${++nextId}`) as never;
    if (command === "ai_http_stream") {
      const { requestId, onEvent } = args as { requestId: string; onEvent: Channel };
      const attempt = { requestId, onEvent, done: deferred() };
      requests.push(attempt);
      return attempt.done.promise as never;
    }
    if (command === "ai_http_cancel") {
      const requestId = (args as { requestId: string }).requestId;
      const attempt = requests.find(a => a.requestId === requestId);
      if (attempt) {
        emit(attempt, { kind: "settled", phase: "cancelled", error: { code: "cancelled" } });
        attempt.done.resolve();
      }
      return Promise.resolve() as never;
    }
    throw new Error(`Unexpected native command ${command}`);
  });
});
afterEach(() => {
  for (const attempt of requests) {
    emit(attempt, { kind: "settled", phase: "cancelled", error: { code: "cancelled" } });
    attempt.done.resolve();
  }
  vi.clearAllMocks();
});

describe("R5o original calibration streaming completion boundaries (synthetic offline)", () => {
  it("finishes only after valid split NDJSON, native terminal Channel event, and command acknowledgement", async () => {
    const { result, settle } = request(new AbortController().signal);
    const waiting = settle();
    const a = await started();
    const sent = JSON.parse(new TextDecoder().decode(Uint8Array.from(
      (vi.mocked(invoke).mock.calls.find(([name]) => name === "ai_http_stream")?.[1] as { body: number[] }).body,
    ))) as { stream: boolean; options: { num_predict: number } };
    expect(sent.stream).toBe(true);
    expect(sent.options.num_predict).toBe(32);
    emit(a, { kind: "headers", status: 200, headers: { "content-type": "application/x-ndjson" } });
    const bytes = new TextEncoder().encode(reply);
    for (let i = 0; i < bytes.length; i += 3)
      emit(a, { kind: "chunk", bytes: Array.from(bytes.slice(i, i + 3)) });
    // Channel settlement precedes native command acknowledgement.
    emit(a, { kind: "settled", phase: "completed" });
    let finished = false;
    void waiting.then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    a.done.resolve();
    await waiting;
    expect(await result.finishReason).toBe("stop");
    expect(sessionInference("fixture-calibration")).toBeNull();
  });

  it("missing final Ollama frame fails the SDK rather than treating HTTP close as verification", async () => {
    const { result } = request(new AbortController().signal);
    const errors: unknown[] = [];
    const waiting = waitForRecovery(result.consumeStream({ onError: (e) => { errors.push(e); } }), new AbortController().signal);
    const a = await started();
    emit(a, { kind: "headers", status: 200, headers: { "content-type": "application/x-ndjson" } });
    emit(a, { kind: "chunk", bytes: [...new TextEncoder().encode(wire({ message: { role: "assistant", content: "OK" }, done: false }))] });
    a.done.resolve();
    emit(a, { kind: "settled", phase: "completed" });
    await waiting.catch(() => {});
    expect(errors.length).toBeGreaterThan(0);
    expect(sessionInference("fixture-calibration")).toBeNull();
  });

  it("aborting an uncompleted Channel response rejects the calibration wait and cancels native ownership", async () => {
    const controller = new AbortController();
    const { settle } = request(controller.signal);
    const waiting = settle();
    const a = await started();
    emit(a, { kind: "headers", status: 200, headers: { "content-type": "application/x-ndjson" } });
    emit(a, { kind: "chunk", bytes: [...new TextEncoder().encode(wire({ message: { role: "assistant", content: "OK" }, done: false }))] });
    controller.abort(new Error("fixture request deadline"));
    await expect(waiting).rejects.toThrow("fixture request deadline");
    await vi.waitFor(() => expect(vi.mocked(invoke).mock.calls.some(([name]) => name === "ai_http_cancel")).toBe(true));
  });
});
