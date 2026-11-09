import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  listen: vi.fn(),
  handler: null as null | ((event: { payload: unknown }) => void),
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: bridge.listen,
}));

import { installLocalDeliveryCapture, observeWebviewDelivery,
  validateDeliveryRow } from "./localDeliveryObserver";

const native = (boundary: string, sequence: number, bytes: number, extras = {}) => ({
  schemaVersion: 1, host: "clack-native", requestId: "inference-27",
  boundary, atUnixMs: 1794196108268, monoUs: 100000,
  sequence, bytes, ...extras,
});

beforeEach(() => {
  bridge.handler = null;
  bridge.listen.mockImplementation(async (_name: string, cb: (event: { payload: unknown }) => void) => {
    bridge.handler = cb;
    return bridge.unlisten;
  });
  bridge.unlisten.mockReset();
});
afterEach(() => { vi.clearAllMocks(); });

describe("real production WebView delivery opt-in", () => {
  it("never subscribes or records without an explicit installer", () => {
    observeWebviewDelivery("inference-27", "webview-ipc-received", 1, 149);
    expect(bridge.listen).not.toHaveBeenCalled();
  });

  it("records only bounded numeric metadata from native and WebView", async () => {
    const rows: unknown[] = [];
    const capture = await installLocalDeliveryCapture(async row => { rows.push(row); }, 6);
    bridge.handler?.({ payload: native("native-body-read", 1, 149) });
    bridge.handler?.({ payload: native("native-semantic-progress", 1, 0) });
    bridge.handler?.({ payload: native("native-ipc-forwarded", 1, 149) });
    observeWebviewDelivery("inference-27", "webview-ipc-received", 1, 149);
    observeWebviewDelivery("inference-27", "webview-stream-enqueued", 1, 149);
    bridge.handler?.({ payload: native("native-terminal", 1, 0) });
    const result = await capture.stop();
    expect(result).toMatchObject({ emitted: 6, acknowledged: 6, overflow: 0,
      deliveryFailed: false, collectorCoverage: "collector-flushed" });
    expect(rows.map(r => (r as { boundary: string }).boundary)).toEqual([
      "native-body-read", "native-semantic-progress", "native-ipc-forwarded",
      "webview-ipc-received", "webview-stream-enqueued", "native-terminal",
    ]);
    expect(JSON.stringify(rows)).not.toContain("content");
    expect(JSON.stringify(rows)).not.toContain("toolArguments");
    expect(bridge.unlisten).toHaveBeenCalledOnce();
    observeWebviewDelivery("inference-27", "webview-ipc-received", 2, 153);
    expect(rows).toHaveLength(6);
  });

  it("rejects hostile extra fields and a semantic-progress event with payload bytes", () => {
    expect(() => validateDeliveryRow({ ...native("native-body-read", 1, 149),
      responseBody: "PRIVATE_GENERATION" })).toThrow();
    expect(() => validateDeliveryRow({ ...native("native-body-read", 1, 149),
      authToken: "SECRET" })).toThrow();
    expect(() => validateDeliveryRow({ ...native("native-semantic-progress", 1, 149) })).toThrow();
    expect(() => validateDeliveryRow({ ...native("native-body-read", 1, 149),
      requestId: "bad:private" })).toThrow();
  });

  it("observer failures are isolated from the caller and fail collector coverage closed", async () => {
    const capture = await installLocalDeliveryCapture(async () => { throw new Error("fsync failure"); });
    expect(() => bridge.handler?.({ payload: native("native-body-read", 1, 149) })).not.toThrow();
    const status = await capture.stop();
    expect(status).toMatchObject({ emitted: 1, acknowledged: 0,
      deliveryFailed: true, collectorCoverage: "partial-or-unsealed" });
  });

  it("unrecognized native events do not persist; skipped/overflow records are acknowledged as loss", async () => {
    const captured: unknown[] = [];
    const capture = await installLocalDeliveryCapture(async row => { captured.push(row); }, 2);
    bridge.handler?.({ payload: native("native-body-read", 1, 149) });
    bridge.handler?.({ payload: native("native-body-read", 2, 153) });
    bridge.handler?.({ payload: native("native-body-read", 3, 100) });
    expect((await capture.stop())).toMatchObject({ emitted: 2, acknowledged: 2,
      overflow: 1, collectorCoverage: "partial-or-unsealed" });
    expect(captured).toHaveLength(2);
    const broken = await installLocalDeliveryCapture(async row => { captured.push(row); });
    bridge.handler?.({ payload: { ...native("native-body-read", 1, 149), secret: "DO_NOT_PERSIST" } });
    expect((await broken.stop())).toMatchObject({ deliveryFailed: true,
      collectorCoverage: "partial-or-unsealed" });
    expect(JSON.stringify(captured)).not.toContain("DO_NOT_PERSIST");
  });

  it("native bounded-queue loss never becomes a success receipt", async () => {
    const rows: unknown[] = [];
    const capture = await installLocalDeliveryCapture(async row => { rows.push(row); });
    bridge.handler?.({ payload: native("native-collector-loss", 0, 0, { dropped: 3 }) });
    expect((await capture.stop())).toMatchObject({ overflow: 3,
      deliveryFailed: true, collectorCoverage: "partial-or-unsealed" });
    expect(rows).toHaveLength(1);
  });

  it("never manufactures semantic progress or alters policy in production source", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/modules/ai/lib/proxyFetch.ts", "utf8");
    const nativeCode = readFileSync("src-tauri/src/modules/net/inference/mod.rs", "utf8");
    expect(source).toContain("observeWebviewDelivery(nativeId, \"webview-ipc-received\"");
    expect(source).toContain("controller?.enqueue(Uint8Array.from(event.bytes))");
    expect(source).toContain("observeWebviewDelivery(nativeId, \"webview-stream-enqueued\"");
    expect(nativeCode).toContain("Duration::from_secs(180)");
    expect(nativeCode).toContain("if progress.feed(&bytes)");
    expect(nativeCode).not.toContain("if delivery.feed(");
  });
});
