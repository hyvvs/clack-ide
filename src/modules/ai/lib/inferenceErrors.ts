import { APICallError } from "ai";
import type { AiErrorKind } from "@/modules/ai/lib/errors";

export const INFERENCE_ERRORS: Record<
  string,
  { kind: AiErrorKind; message: string }
> = {
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
