import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: (event: unknown) => void = () => {};
  },
}));
import { invoke } from "@tauri-apps/api/core";
import { createProxyFetch } from "./proxyFetch";
import {
  cancelSessionInference,
  inferenceLabel,
  sessionInference,
  subscribeInference,
} from "./inferenceLifecycle";
import { INFERENCE_ERRORS, InferenceTransportError } from "./inferenceErrors";
import { normalizeAiError } from "./errors";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type NativeArgs = {
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: number[];
  timeoutPolicy: string;
  allowPrivateNetwork: boolean;
  onEvent: { onmessage: (e: unknown) => void };
};
type Attempt = {
  args: NativeArgs;
  done: ReturnType<typeof deferred<void>>;
  cancel: ReturnType<typeof deferred<void>>;
};
let sequence = 0;
const attempts: Attempt[] = [];
const scope = (sessionId = "a") => ({
  sessionId,
  runId: "logical-run",
  label: "Qwen · AI Server",
  isCurrent: () => true,
});
const fetchFor = (sessionId = "a") =>
  createProxyFetch({
    scope: scope(sessionId),
    selfHosted: true,
    allowPrivateNetwork: true,
  });
const event = (a: Attempt, payload: object, requestId = a.args.requestId) =>
  a.args.onEvent.onmessage({ requestId, ...payload });
const headers = (a: Attempt, status = 200) =>
  event(a, {
    kind: "headers",
    status,
    headers: { "content-type": "text/event-stream" },
  });
const chunk = (a: Attempt, text: string) =>
  event(a, { kind: "chunk", bytes: [...new TextEncoder().encode(text)] });
function terminal(a: Attempt, code?: string) {
  event(a, {
    kind: "settled",
    phase: code === "cancelled" ? "cancelled" : code ? "failed" : "completed",
    ...(code ? { error: { code } } : {}),
  });
}
const untilAttempt = async (index = 0) => {
  await vi.waitFor(() => expect(attempts.length).toBeGreaterThan(index));
  return attempts[index];
};
const cancels = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "ai_http_cancel");

function current(sessionId: string) {
  const snapshot = sessionInference(sessionId);
  if (!snapshot) throw new Error("Expected an active inference attempt");
  return snapshot;
}

beforeEach(() => {
  attempts.length = 0;
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation((command, args) => {
    if (command === "ai_http_open")
      return Promise.resolve(`native-${++sequence}`) as never;
    if (command === "ai_http_stream") {
      const a = {
        args: args as NativeArgs,
        done: deferred(),
        cancel: deferred(),
      };
      attempts.push(a);
      return a.done.promise as never;
    }
    if (command === "ai_http_cancel")
      return (attempts.find(
        (a) => a.args.requestId === (args as { requestId: string }).requestId,
      )?.cancel.promise ?? Promise.resolve()) as never;
    throw new Error(`Unexpected command ${command}`);
  });
});
afterEach(async () => {
  for (const a of attempts) {
    terminal(a, "cancelled");
    a.done.resolve();
    a.cancel.resolve();
  }
  await Promise.resolve();
  vi.useRealTimers();
});

describe("native inference attempt transport", () => {
  it("captures native identity, actual routing and lifecycle, then releases before response consumption finishes", async () => {
    const notifications = vi.fn();
    const unsubscribe = subscribeInference(notifications);
    const pending = fetchFor()("http://100.64.1.2:8000/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: '{"model":"qwen"}',
    });
    const a = await untilAttempt();
    expect(a.args).toMatchObject({
      timeoutPolicy: "self-hosted",
      allowPrivateNetwork: true,
      method: "POST",
      url: "http://100.64.1.2:8000/v1/chat/completions",
    });
    expect(a.args.headers.authorization).toBe("Bearer secret");
    expect(new TextDecoder().decode(Uint8Array.from(a.args.body))).toContain(
      "qwen",
    );
    expect(sessionInference("a")?.nativeId).toBe(a.args.requestId);
    expect(sessionInference("a")?.id).not.toBe(a.args.requestId);
    expect(JSON.stringify(sessionInference("a"))).not.toContain("secret");
    event(a, { kind: "phase", phase: "waiting-first-output" });
    expect(inferenceLabel(current("a"))).toBe(
      "Waiting for Qwen · AI Server...",
    );
    headers(a);
    const response = await pending;
    event(a, { kind: "phase", phase: "generating" });
    expect(inferenceLabel(current("a"))).toBe("Generating...");
    chunk(a, "hello");
    terminal(a);
    a.done.resolve();
    expect(await response.text()).toBe("hello");
    expect(sessionInference("a")).toBeNull();
    expect(cancels()).toHaveLength(0);
    expect(notifications).toHaveBeenCalled();
    unsubscribe();
  });
  it.each([
    "headers",
    "body",
    "stream",
  ])("Stop during %s waits for native settlement and drops late chunks", async (phase) => {
    const signal = new AbortController();
    const pending = fetchFor()("http://localhost/v1", {
      signal: signal.signal,
    });
    const outcome = pending.then((r) => r.text()).catch((e) => e);
    const a = await untilAttempt();
    if (phase !== "headers") headers(a);
    if (phase === "stream") chunk(a, "prior text");
    signal.abort();
    const stopping = cancelSessionInference("a");
    expect(cancels()).toEqual([
      ["ai_http_cancel", { requestId: a.args.requestId }],
    ]);
    expect(sessionInference("a")?.phase).toBe("stopping");
    chunk(a, "must not append");
    event(a, { kind: "phase", phase: "generating" });
    expect(sessionInference("a")?.phase).toBe("stopping");
    terminal(a, "cancelled");
    let settled = false;
    void stopping.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    a.cancel.resolve();
    a.done.resolve();
    await stopping;
    expect(await outcome).toMatchObject({
      code: "cancelled",
      isRetryable: false,
    });
    expect(sessionInference("a")).toBeNull();
    event(a, { kind: "phase", phase: "generating" });
    expect(sessionInference("a")).toBeNull();
  });
  it("cancels a reservation arriving after abort without starting HTTP", async () => {
    const opened = deferred<string>();
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "ai_http_open") return opened.promise as never;
      if (command === "ai_http_cancel") return Promise.resolve() as never;
      throw new Error("HTTP must not start");
    });
    const abort = new AbortController();
    const outcome = fetchFor()("http://localhost/v1", {
      signal: abort.signal,
    }).catch((e) => e);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("ai_http_open"));
    abort.abort();
    expect(sessionInference("a")?.phase).toBe("stopping");
    opened.resolve("reserved");
    expect(await outcome).toMatchObject({ code: "cancelled" });
    expect(cancels()).toEqual([["ai_http_cancel", { requestId: "reserved" }]]);
    expect(sessionInference("a")).toBeNull();
  });
  it("pre-abort and superseded logical scopes cannot start another request", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      fetchFor()("http://localhost", { signal: abort.signal }),
    ).rejects.toMatchObject({ code: "cancelled" });
    await expect(
      createProxyFetch({ scope: { ...scope(), isCurrent: () => false } })(
        "http://localhost",
      ),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(invoke).not.toHaveBeenCalled();
  });
  it("keeps concurrent chats isolated and allocates new identities for later attempts", async () => {
    const first = fetchFor()("http://localhost").catch((e) => e);
    const a = await untilAttempt();
    const second = fetchFor("b")("http://localhost");
    const b = await untilAttempt(1);
    expect(a.args.requestId).not.toBe(b.args.requestId);
    const stopping = cancelSessionInference("a");
    expect(sessionInference("b")?.phase).toBe("connecting");
    event(b, { kind: "settled", phase: "cancelled" }, a.args.requestId);
    expect(sessionInference("b")).not.toBeNull();
    terminal(a, "cancelled");
    a.done.resolve();
    a.cancel.resolve();
    await stopping;
    await first;
    const next = fetchFor()("http://localhost");
    const c = await untilAttempt(2);
    expect(c.args.requestId).not.toBe(a.args.requestId);
    chunk(a, "old text");
    expect(sessionInference("a")?.nativeId).toBe(c.args.requestId);
    for (const request of [b, c]) {
      headers(request);
      chunk(request, "new");
      terminal(request);
      request.done.resolve();
    }
    expect(await (await second).text()).toBe("new");
    expect(await (await next).text()).toBe("new");
  });
  it("waits for channel delivery after command acknowledgement without dropping final data", async () => {
    const pending = fetchFor()("http://localhost");
    const a = await untilAttempt();
    headers(a);
    const body = (await pending).text();
    a.done.resolve();
    await Promise.resolve();
    expect(sessionInference("a")).not.toBeNull();
    chunk(a, "delayed");
    terminal(a);
    chunk(a, "after terminal");
    expect(await body).toBe("delayed");
    expect(sessionInference("a")).toBeNull();
  });
  it("ignores events following the terminal event even before command acknowledgement", async () => {
    const pending = fetchFor()("http://localhost");
    const a = await untilAttempt();
    headers(a);
    chunk(a, "kept");
    terminal(a);
    chunk(a, "late");
    a.done.resolve();
    expect(await (await pending).text()).toBe("kept");
  });
  it("native invocation failure drains cancellation before releasing the attempt", async () => {
    const outcome = fetchFor()("http://localhost")
      .then((r) => r.text())
      .catch((e) => e);
    const a = await untilAttempt();
    headers(a);
    a.done.reject(new Error("secret-bearing IPC failure"));
    await vi.waitFor(() => expect(cancels()).toHaveLength(1));
    expect(sessionInference("a")).not.toBeNull();
    a.cancel.resolve();
    expect(await outcome).toMatchObject({ code: "native-transport" });
    expect(sessionInference("a")).toBeNull();
  });
  it("stream consumer cancellation also sends native cancellation", async () => {
    const pending = fetchFor()("http://localhost");
    const a = await untilAttempt();
    headers(a);
    const response = await pending;
    if (!response.body) throw new Error("Expected response stream");
    const cancellation = response.body.cancel();
    expect(cancels()).toHaveLength(1);
    expect(sessionInference("a")?.phase).toBe("stopping");
    a.cancel.resolve();
    terminal(a, "cancelled");
    a.done.resolve();
    await cancellation;
    await Promise.resolve();
    expect(sessionInference("a")).toBeNull();
  });
  it("preserves non-2xx provider bodies for existing structured SDK diagnostics", async () => {
    const pending = createProxyFetch()("https://provider.test");
    const a = await untilAttempt();
    expect(a.args.timeoutPolicy).toBe("legacy");
    expect(a.args.allowPrivateNetwork).toBe(false);
    headers(a, 401);
    chunk(a, '{"error":{"message":"Invalid key"}}');
    terminal(a, "provider-error");
    a.done.resolve();
    const response = await pending;
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { message: "Invalid key" },
    });
  });
  it("cleans timers/listeners after success and cannot cancel completed requests", async () => {
    const abort = new AbortController();
    const remove = vi.spyOn(abort.signal, "removeEventListener");
    const pending = fetchFor()("http://localhost", { signal: abort.signal });
    const a = await untilAttempt();
    vi.useFakeTimers();
    a.done.resolve();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(1);
    headers(a);
    terminal(a);
    await (await pending).text();
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    abort.abort();
    await cancelSessionInference("a");
    await vi.advanceTimersByTimeAsync(600_000);
    expect(cancels()).toHaveLength(0);
  });
  it("bounds missing terminal delivery and returns a truthful transport error", async () => {
    const outcome = fetchFor()("http://localhost").catch((e) => e);
    const a = await untilAttempt();
    vi.useFakeTimers();
    a.done.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await outcome).toMatchObject({ code: "native-transport" });
    expect(sessionInference("a")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    "connect-timeout",
    "first-output-timeout",
    "stream-idle-timeout",
    "overall-deadline",
    "remote-disconnect",
    "dns-failure",
    "tls-failure",
  ])("preserves structured %s without provider retries or raw secret text", async (code) => {
    const outcome = fetchFor()("http://localhost")
      .then((r) => r.text())
      .catch((e) => e);
    const a = await untilAttempt();
    headers(a);
    terminal(a, code);
    a.done.resolve();
    const error = await outcome;
    expect(error).toBeInstanceOf(InferenceTransportError);
    expect(error.isRetryable).toBe(false);
    const normalized = normalizeAiError(
      Object.assign(new Error("outer secret"), { cause: error }),
    );
    expect(normalized).toMatchObject({
      errorCode: code,
      requestId: a.args.requestId,
      message: INFERENCE_ERRORS[code].message,
      retryable: false,
    });
    expect(JSON.stringify(normalized)).not.toContain("outer secret");
  });
});
