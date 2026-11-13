import { APICallError } from "ai";
import type { AiErrorKind } from "@/modules/ai/lib/errors";

type StreamValidation = {
  error?: unknown;
  failure: AbortController;
  timer?: ReturnType<typeof setTimeout>;
};
const streamValidation = new WeakMap<AbortSignal, StreamValidation>();
export function streamValidationFailure(signal: AbortSignal | undefined): unknown {
  return signal ? streamValidation.get(signal)?.error : undefined;
}
export function beginStreamValidation(signal: AbortSignal) {
  const state: StreamValidation = { failure: new AbortController() };
  streamValidation.set(signal, state);
  return {
    reset: () => {
      clearTimeout(state.timer);
      state.error = undefined;
      state.failure = new AbortController();
    },
    failureSignal: () => state.failure.signal,
    error: () => state.error,
    dispose: () => {
      clearTimeout(state.timer);
      streamValidation.delete(signal);
    },
  };
}
export function deferStreamFailure(
  signal: AbortSignal | null | undefined,
  error: unknown,
): boolean {
  const state = signal && streamValidation.get(signal);
  if (!state) return false;
  if (state.error === undefined) {
    state.error = error;
    // Let already-decoded SDK parts drain before interrupting its next pending read.
    state.timer = setTimeout(() => state.failure.abort(error), 0);
  }
  return true;
}

export const INFERENCE_ERRORS: Record<
  string,
  { kind: AiErrorKind; message: string }
> = {
  "preflight-timeout": {
    kind: "timeout",
    message:
      "Request preflight did not finish before admission expired. No inference was sent.",
  },
  "context-preflight-rejected": {
    kind: "bad_request",
    message:
      "Request context/settings changed or no longer fit. No inference was sent.",
  },
  "invalid-capacity": {
    kind: "bad_request",
    message: "Inference capacity must be an integer from 1 to 8.",
  },
  "admission-limit": {
    kind: "internal",
    message: "The inference queue is full. Wait for a request to finish.",
  },
  "duplicate-admission": {
    kind: "internal",
    message: "This inference attempt is already registered.",
  },
  "connect-timeout": {
    kind: "timeout",
    message: "Timed out establishing the server connection (including DNS).",
  },
  "first-output-timeout": {
    kind: "timeout",
    message: "Timed out waiting for first response.",
  },
  "stream-idle-timeout": {
    kind: "timeout",
    message: "Timed out waiting for generation progress.",
  },
  "overall-deadline": {
    kind: "timeout",
    message: "The inference request exceeded its overall deadline.",
  },
  cancelled: {
    kind: "cancelled",
    message: "Request cancelled. Remote computation may continue.",
  },
  "remote-disconnect": {
    kind: "interrupted",
    message: "Connection interrupted before the response completed.",
  },
  "missing-final-event": {
    kind: "interrupted",
    message:
      "Response interrupted: the stream ended without its required final event. Partial output was preserved; no exact resume is available.",
  },
  "malformed-stream": {
    kind: "internal",
    message: "The server returned an invalid or oversized stream.",
  },
  "dns-failure": {
    kind: "network",
    message: "The inference server name could not be resolved.",
  },
  "tls-failure": {
    kind: "network",
    message: "The inference server's TLS connection could not be verified.",
  },
  "connection-failed": {
    kind: "network",
    message: "The inference server could not be reached.",
  },
  "provider-error": {
    kind: "provider_unavailable",
    message: "The inference server rejected the request.",
  },
  "unsafe-endpoint": {
    kind: "authorization",
    message: "The inference endpoint is not authorized.",
  },
  "request-limit": {
    kind: "internal",
    message: "Too many active native requests. Wait for a request to finish.",
  },
  "invalid-request": {
    kind: "bad_request",
    message: "The native inference request is invalid or unavailable.",
  },
  "native-transport": {
    kind: "internal",
    message: "The native inference transport did not settle successfully.",
  },
};
/** Bounded, body-free diagnosis of a rejected Tauri command invocation.
 * This is distinct from a native Settled event: rejection does not prove
 * that Rust reached reqwest, TCP, or even the command handler.
 */
export type NativeInvokeRejection = {
  phase: "acceptance-host-intercept" | "tauri-command-rejected" | "invoke-rejected";
  nativeCode: string;
  safeMessage: string;
};
const ACCEPTANCE_WIRE_REJECTION =
  "Acceptance stopped: serialized reasoning/output controls changed";
// Other safe, *static* Rust Failure codes that are returned directly by
// ai_http_stream before a Settled channel event. Keep this allowlist explicit.
const PRE_DISPATCH_NATIVE_ERRORS: Record<string, string> = {
  "remote-connection-unavailable": "The native remote connection is unavailable.",
  "fallback-consent-rejected": "The native fallback consent was rejected.",
  "diagnostic-run-invalid": "The native diagnostic run identifier was rejected.",
  "diagnostic-not-ready": "The native diagnostic capture is unavailable.",
  "diagnostic-permit-denied": "The native diagnostic permit was denied.",
  "diagnostic-request-denied": "The native diagnostic request was denied.",
  "diagnostic-run-unavailable": "The native diagnostic run is unavailable.",
};
export function inspectNativeInvokeRejection(error: unknown): NativeInvokeRejection {
  if (error === ACCEPTANCE_WIRE_REJECTION) {
    return {
      phase: "acceptance-host-intercept",
      nativeCode: "acceptance-wire-contract-rejected",
      safeMessage: ACCEPTANCE_WIRE_REJECTION,
    };
  }
  // The production Rust Failure serializer returns { code } only. Never
  // forward an arbitrary invoke string, exception message or nested object,
  // since these could contain endpoint credentials, headers or request text.
  const raw = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code : undefined;
  if (typeof raw === "string" && Object.prototype.hasOwnProperty.call(INFERENCE_ERRORS, raw)) {
    return {
      phase: "tauri-command-rejected",
      nativeCode: raw,
      safeMessage: INFERENCE_ERRORS[raw].message,
    };
  }
  if (typeof raw === "string" && Object.prototype.hasOwnProperty.call(PRE_DISPATCH_NATIVE_ERRORS, raw)) {
    return {
      phase: "tauri-command-rejected",
      nativeCode: raw,
      safeMessage: PRE_DISPATCH_NATIVE_ERRORS[raw],
    };
  }
  return {
    phase: "invoke-rejected",
    nativeCode: "native-transport",
    safeMessage: INFERENCE_ERRORS["native-transport"].message,
  };
}
export class InferenceTransportError extends APICallError {
  readonly inferenceTransport = true;
  readonly code: string;
  readonly requestId?: string;
  readonly nativeRejection?: NativeInvokeRejection;
  constructor(code: string, requestId?: string, nativeRejection?: NativeInvokeRejection) {
    const detail =
      INFERENCE_ERRORS[code] ?? INFERENCE_ERRORS["native-transport"];
    super({
      message: detail.message,
      url: "",
      requestBodyValues: undefined,
      isRetryable: false,
    });
    this.code = code in INFERENCE_ERRORS ? code : "native-transport";
    this.requestId = requestId;
    this.nativeRejection = nativeRejection;
  }
}
