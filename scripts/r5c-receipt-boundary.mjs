/** R5b/R5c isolated acceptance-only HTTP receipt owner (no provider calls). */
import { appendFile } from "node:fs/promises";
import path from "node:path";

const fields = {
  "preflight-decision": new Set([
    "kind", "at", "modelMatches", "serializedContext", "trustedTarget", "admittedByRoute",
    "capturedStateRevision", "capturedConfigurationRevision", "snapshotConfigurationRevision",
    "snapshotAgeMs", "snapshotConnected", "snapshotDigestMatches", "calibrationStatus",
    "calibratedContext", "calibrationExpired", "runtimeObserved", "runtimeAgeMs",
    "runtimeEpochMatches", "runtimeVersionMatches", "loadedContextMatchesCalibration",
  ]),
  "request-started": new Set(["kind", "ordinal"]),
  "request-completed": new Set(["kind", "ordinal", "finishReason"]),
  "request-failed": new Set(["kind", "ordinal"]),
  "request-cancelled": new Set(["kind", "ordinal"]),
  "request-timed-out": new Set(["kind", "ordinal"]),
  "frontend-native-event": new Set(["kind", "ordinal", "phase", "bytes"]),
};

export function validateR5bEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event) || !Object.hasOwn(fields, event.kind))
    throw new Error("Unknown receipt event");
  if (Object.keys(event).some(key => !fields[event.kind].has(key)))
    throw new Error("Unredacted receipt field");
  if (event.kind === "preflight-decision") {
    for (const field of ["modelMatches", "admittedByRoute", "runtimeObserved"])
      if (typeof event[field] !== "boolean") throw new Error("Invalid preflight decision");
    for (const field of ["serializedContext", "trustedTarget"])
      if (event[field] != null && (!Number.isSafeInteger(event[field]) || event[field] <= 0))
        throw new Error("Invalid context observation");
  } else {
    if (event.ordinal !== 1 && event.ordinal !== 2)
      throw new Error("Unbounded receipt ordinal");
    if (event.kind === "frontend-native-event" && (
      !["headers", "chunk", "settled"].includes(event.phase) ||
      !Number.isSafeInteger(event.bytes) || event.bytes < 0 || event.bytes > 4 * 1024 * 1024
    )) throw new Error("Invalid frontend stream observation");
  }
  return event;
}

export async function readR5bBody(request, max = 4096) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > max) throw new Error("Receipt exceeded byte bound");
  }
  return JSON.parse(raw);
}

/** POST acknowledgement is given only *after* the redacted receipt is on disk. */
export function createR5bReceiptHandler({ root, configuration, onReport }) {
  let eventCount = 0;
  return async (request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("content-type", "application/json");
    try {
      // Vite and the native WebView use different local origins. JSON POSTs
      // trigger a browser OPTIONS preflight; without this response the browser
      // cannot deliver even a redacted receipt to the local collector.
      if (request.method === "OPTIONS" && ["/events", "/report"].includes(request.url)) {
        response.setHeader("access-control-allow-methods", "POST, OPTIONS");
        response.setHeader("access-control-allow-headers", "content-type");
        response.statusCode = 204;
        response.end();
      } else if (request.url === "/configuration" && request.method === "GET") {
        response.end(JSON.stringify(configuration()));
      } else if (request.url === "/events" && request.method === "POST") {
        const event = validateR5bEvent(await readR5bBody(request));
        if (++eventCount > 16) throw new Error("Receipt event limit reached");
        await appendFile(path.join(root, "redacted-preflight-events.jsonl"), `${JSON.stringify(event)}\n`);
        response.end('{"ok":true}');
      } else if (request.url === "/report" && request.method === "POST") {
        const value = await readR5bBody(request, 32_000);
        // An async acceptance-only reporter may persist before acknowledging.
        // R5b's synchronous reporter remains compatible.
        await onReport(value);
        response.end('{"ok":true}');
      } else {
        response.statusCode = 404;
        response.end('{"error":"unrecognized"}');
      }
    } catch {
      response.statusCode = 400;
      response.end('{"error":"Invalid receipt"}');
    }
  };
}
