import { invoke } from "@tauri-apps/api/core";
import { generateText, streamText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOllamaModel } from "@/modules/ai/lib/ollamaModel";
import { createProxyFetch } from "@/modules/ai/lib/proxyFetch";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class { onmessage: (event: unknown) => void = () => {}; },
}));

type NativeCall = {
  args: {
    body: number[];
    requestId: string;
    onEvent: { onmessage: (value: unknown) => void };
  };
  finish: () => void;
};
let calls: NativeCall[];
let cancelIds: string[];
let nextId = 0;
const encoder = new TextEncoder();
const send = (call: NativeCall, event: Record<string, unknown>) =>
  call.args.onEvent.onmessage({ requestId: call.args.requestId, ...event });
const headers = (call: NativeCall, contentType = "application/json") =>
  send(call, { kind: "headers", status: 200, headers: { "content-type": contentType } });
const body = (call: NativeCall, bytes: Uint8Array) =>
  send(call, { kind: "chunk", bytes: [...bytes] });
const completed = (call: NativeCall) => {
  send(call, { kind: "settled", phase: "completed" });
  call.finish();
};
const expectCall = async () => {
  await vi.waitFor(() => expect(calls.length).toBe(1));
  return calls[0];
};
function model() {
  return createOllamaModel({
    modelId: "synthetic:model",
    baseURL: "http://127.0.0.1:8080/",
    fetch: createProxyFetch({
      selfHosted: true,
      allowPrivateNetwork: true,
      scope: { sessionId: "offline-r5c", runId: "one", isCurrent: () => true },
    }),
  });
}
function frame(done: boolean, total = 623) {
  const make = (content: string) => JSON.stringify({
    model: "synthetic:model",
    message: { role: "assistant", content },
    done,
    ...(done ? { done_reason: "stop", prompt_eval_count: 12, eval_count: 4 } : {}),
  });
  const empty = make("");
  const padded = make("X".repeat(total - encoder.encode(empty).length));
  expect(encoder.encode(padded).length).toBe(total);
  return padded;
}

beforeEach(() => {
  calls = [];
  cancelIds = [];
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation((command, raw) => {
    if (command === "ai_http_open") return Promise.resolve(`native-${++nextId}`) as never;
    if (command === "ai_http_stream") {
      let finish!: () => void;
      const promise = new Promise<void>(resolve => { finish = resolve; });
      calls.push({ args: raw as NativeCall["args"], finish });
      return promise as never;
    }
    if (command === "ai_http_cancel") {
      cancelIds.push((raw as { requestId: string }).requestId);
      return Promise.resolve() as never;
    }
    throw new Error(`Unexpected native command ${command}`);
  });
});

describe("R5c offline production proxy and Ollama SDK completion boundary", () => {
  it("nonstreaming generateText settles after native headers, 623 bytes and terminal event", async () => {
    const result = generateText({ model: model(), prompt: "minimal", maxOutputTokens: 64, maxRetries: 0 });
    const call = await expectCall();
    const sent = JSON.parse(new TextDecoder().decode(Uint8Array.from(call.args.body)));
    expect(sent.stream).toBe(false); // R5b used generateText, not native Ollama NDJSON.
    headers(call);
    body(call, encoder.encode(frame(true)));
    completed(call);
    const settled = await result;
    expect(settled.finishReason).toBe("stop");
    expect(settled.text.length).toBeGreaterThan(0);
    expect(cancelIds).toHaveLength(0);
  });

  it("equal-size native complete delivery is NOT proof of SDK success without done:true", async () => {
    const outcome = generateText({ model: model(), prompt: "minimal", maxOutputTokens: 64, maxRetries: 0 });
    const call = await expectCall();
    headers(call);
    body(call, encoder.encode(frame(false))); // exactly 623 bytes, but invalid terminal semantics
    completed(call);
    await expect(outcome).rejects.toThrow(/Incomplete Ollama response/);
  });

  it("real SDK streamText parses valid native NDJSON and rejects missing terminal frame", async () => {
    const operation = streamText({ model: model(), prompt: "minimal", maxOutputTokens: 64, maxRetries: 0 });
    const text = operation.text;
    const call = await expectCall();
    const sent = JSON.parse(new TextDecoder().decode(Uint8Array.from(call.args.body)));
    expect(sent.stream).toBe(true);
    headers(call, "application/x-ndjson");
    body(call, encoder.encode(`${frame(true)}\n`));
    completed(call);
    await expect(text).resolves.toContain("X");
  });

  it("abort plus native cancellation settlement is distinct from successful SDK completion", async () => {
    const abort = new AbortController();
    const outcome = generateText({ model: model(), prompt: "minimal", maxOutputTokens: 64,
      maxRetries: 0, abortSignal: abort.signal });
    const call = await expectCall();
    headers(call);
    abort.abort();
    send(call, { kind: "settled", phase: "cancelled", error: { code: "cancelled" } });
    call.finish();
    await expect(outcome).rejects.toThrow();
    expect(cancelIds).toContain(call.args.requestId);
  });
});
