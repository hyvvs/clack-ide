/** R5p acceptance-only pre-calibration Channel observer.
 * The collector sees fixed stage enums only, never response data or identifiers.
 */
import { Channel } from "@tauri-apps/api/core";

export const R5P_STAGES = [
  "collector-synthetic-ack", "channel-registered", "channel-headers",
  "channel-first-chunk", "channel-settled-completed", "channel-settled-failed",
  "channel-settled-cancelled", "native-command-ack", "response-body-closed",
  "response-cancelled", "response-body-eof", "response-body-error",
  "response-body-cancelled", "sdk-parser-terminal", "sdk-consume-start",
  "sdk-consume-end", "sdk-finish-end", "metadata-refresh-start",
  "metadata-refresh-end", "metadata-refresh-failed", "runtime-inspection-start",
  "runtime-inspection-end", "runtime-inspection-failed", "webview-heartbeat",
  "calibration-returned", "calibration-failed", "final-report-attempt",
] as const;
export type R5pStage = typeof R5P_STAGES[number];

export function installR5pCalibrationChannelAudit(emit: (stage: R5pStage) => void) {
  const descriptor = Object.getOwnPropertyDescriptor(Channel.prototype, "onmessage");
  if (!descriptor?.set || !descriptor.get) throw new Error("Native Channel audit property unavailable");
  const seen = new Set<string>();
  const send = (stage: R5pStage) => { try { emit(stage); } catch { /* reporting cannot affect inference */ } };
  Object.defineProperty(Channel.prototype, "onmessage", {
    ...descriptor,
    set(callback: (event: {requestId?: string; kind?: string; phase?: string}) => void) {
      if (typeof callback !== "function") return descriptor.set?.call(this, callback);
      const registered = seen.size === 0;
      const observer = (event: {requestId?: string; kind?: string; phase?: string}) => {
        if (typeof event?.requestId === "string" && /^inference-[1-9]\d*$/.test(event.requestId)) {
          const first = (tag: R5pStage) => {
            const key = `${event.requestId}:${tag}`;
            if (!seen.has(key)) { seen.add(key); send(tag); }
          };
          if (event.kind === "headers") first("channel-headers");
          if (event.kind === "chunk") first("channel-first-chunk");
          if (event.kind === "settled") first(
            event.phase === "completed" ? "channel-settled-completed"
              : event.phase === "cancelled" ? "channel-settled-cancelled" : "channel-settled-failed",
          );
        }
        callback.call(this, event);
      };
      descriptor.set?.call(this, observer);
      if (registered) send("channel-registered");
    },
  });
  return () => Object.defineProperty(Channel.prototype, "onmessage", descriptor);
}
