/** Explicitly opted-in, content-free delivery observations. This is never
 * installed by normal Agent startup and never influences HTTP, SDK, or clocks. */
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export const LOCAL_DELIVERY_EVENT = "clack-local-delivery";
export const DELIVERY_BOUNDARIES = [
  "native-dispatch", "native-headers", "native-body-read",
  "native-semantic-progress", "native-ipc-forwarded", "native-ipc-rejected",
  "native-provider-done", "native-eof", "native-terminal",
  "native-collector-loss",
  "webview-headers-received", "webview-ipc-received",
  "webview-stream-enqueued", "webview-settled-received",
] as const;
export type DeliveryBoundary = (typeof DELIVERY_BOUNDARIES)[number];
export type DeliveryRow = Readonly<{
  schemaVersion: 1;
  host: "clack-native" | "clack-webview";
  requestId: string;
  boundary: DeliveryBoundary;
  atUnixMs: number;
  monoUs: number;
  sequence: number;
  bytes: number;
  dropped?: number;
  runId?: string;
}>;
type Sink = (row: DeliveryRow) => void;
type Consumer = { sink: Sink; runId?: string };
const consumers = new Set<Consumer>();
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const RUN_ID = /^[a-z0-9][a-z0-9-]{7,79}$/;
const boundaries = new Set<string>(DELIVERY_BOUNDARIES);
const allowed = new Set(["schemaVersion", "host", "requestId", "boundary",
  "atUnixMs", "monoUs", "sequence", "bytes", "dropped", "runId"]);
const count = (n: unknown): n is number => typeof n === "number" &&
  Number.isSafeInteger(n) && n >= 0;

/** Reject any surprise fields, including private provider payloads. */
export function validateDeliveryRow(value: unknown): DeliveryRow {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid delivery metadata");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !allowed.has(k)) || v.schemaVersion !== 1 ||
      !["clack-native", "clack-webview"].includes(String(v.host)) ||
      typeof v.requestId !== "string" || !ID.test(v.requestId) ||
      typeof v.boundary !== "string" || !boundaries.has(v.boundary) ||
      (v.runId !== undefined && (typeof v.runId !== "string" || !RUN_ID.test(v.runId))) ||
      ![v.atUnixMs, v.monoUs, v.sequence, v.bytes].every(count) ||
      (v.boundary === "native-semantic-progress" && v.bytes !== 0) ||
      (v.dropped !== undefined && (!count(v.dropped) || v.dropped === 0 ||
        v.boundary !== "native-collector-loss")) ||
      (v.host === "clack-native" && v.boundary.startsWith("webview-")) ||
      (v.host === "clack-webview" && v.boundary.startsWith("native-")))
    throw new Error("Unapproved delivery metadata");
  return Object.freeze({ schemaVersion: 1, host: v.host as DeliveryRow["host"],
    requestId: v.requestId, boundary: v.boundary as DeliveryBoundary,
    atUnixMs: v.atUnixMs as number, monoUs: v.monoUs as number,
    sequence: v.sequence as number, bytes: v.bytes as number,
    ...(v.dropped === undefined ? {} : { dropped: v.dropped as number }),
    ...(v.runId === undefined ? {} : { runId: v.runId as string }) });
}

// Producers do not know/receive diagnostic callbacks or Promise results.
function emit(row: DeliveryRow): void {
  for (const consumer of consumers) {
    try { consumer.sink(consumer.runId ? { ...row, runId: consumer.runId } : row); }
    catch { /* never affect inference */ }
  }
}

export function observeWebviewDelivery(
  requestId: string | undefined, boundary: Extract<DeliveryBoundary, `webview-${string}`>,
  sequence: number, bytes: number,
): void {
  if (!consumers.size || !requestId || !ID.test(requestId) ||
      !boundaries.has(boundary) || !boundary.startsWith("webview-") ||
      !count(sequence) || !count(bytes)) return;
  emit({ schemaVersion: 1, host: "clack-webview", requestId, boundary,
    atUnixMs: Date.now(), monoUs: Math.max(0, Math.floor(performance.now() * 1000)),
    sequence, bytes });
}

/** Install before a *separately authorized* diagnostic run. Persister ACKs
 * one allowlisted record; overflow or failure produces an explicitly partial
 * receipt, never a successful collection claim. Caller owns durable storage. */
export async function installLocalDeliveryCapture(
  persist: (row: DeliveryRow) => Promise<void>, maxRecords = 8192,
  runId?: string,
) {
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 65536)
    throw new Error("Invalid delivery journal bound");
  if (runId !== undefined && !RUN_ID.test(runId))
    throw new Error("Invalid diagnostic run ID");
  if ((runId !== undefined && consumers.size > 0) ||
      (runId === undefined && [...consumers].some(consumer => consumer.runId)))
    throw new Error("Conflicting delivery capture already registered");
  let emitted = 0, acknowledged = 0, overflow = 0, deliveryFailed = false, stopped = false;
  let sinkFailed = false;
  let pending: Promise<void> = Promise.resolve();
  const queue = (value: unknown) => {
    if (stopped) return;
    let row: DeliveryRow;
    try { row = validateDeliveryRow(value); }
    catch { deliveryFailed = true; return; }
    if (row.runId !== runId) { deliveryFailed = true; return; }
    if (row.boundary === "native-collector-loss") {
      overflow += row.dropped ?? 1;
      deliveryFailed = true;
    }
    if (emitted >= maxRecords) { overflow++; return; }
    emitted++;
    pending = pending.then(async () => {
      if (sinkFailed && row.boundary !== "native-collector-loss") return;
      try { await persist(row); acknowledged++; }
      catch { deliveryFailed = true; sinkFailed = true; }
    });
  };
  const consumer: Consumer = { sink: row => queue(row), runId };
  consumers.add(consumer);
  let unlisten: (() => void) | undefined;
  try {
    unlisten = await listen<unknown>(LOCAL_DELIVERY_EVENT, event => queue(event.payload));
    if (runId) {
      const ready = await invoke<{ runId: string; nativeReady: boolean }>(
        "ai_http_diagnostic_ready", { runId },
      );
      if (ready?.runId !== runId || ready.nativeReady !== true)
        throw new Error("Native diagnostic capture not registered");
    }
  } catch (error) {
    consumers.delete(consumer);
    unlisten?.();
    throw error;
  }
  // A bounded object only reports ACK and loss, not provider success.
  const snapshot = () => Object.freeze({ emitted, acknowledged, overflow,
    deliveryFailed, collectorCoverage: !deliveryFailed && !overflow && emitted === acknowledged
      ? "collector-flushed" as const : "partial-or-unsealed" as const });
  return {
    snapshot,
    ...(runId ? { readiness: Object.freeze({ runId, nativeReady: true as const,
      webviewReady: true as const }) } : {}),
    async flush() { await pending; return snapshot(); },
    async stop() { stopped = true; consumers.delete(consumer);
      unlisten?.(); await pending; return snapshot(); },
  };
}
