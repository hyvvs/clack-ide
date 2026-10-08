import { APICallError } from "ai";
import type { AiErrorKind } from "@/modules/ai/lib/errors";

type StreamValidation = {
  error?: unknown;
  failure: AbortController;
  timer?: ReturnType<typeof setTimeout>;
};
const streamValidation = new WeakMap<AbortSignal, StreamValidation>();
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
export class InferenceTransportError extends APICallError {
  readonly inferenceTransport = true;
  readonly code: string;
  readonly requestId?: string;
  constructor(code: string, requestId?: string) {
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
  }
}
