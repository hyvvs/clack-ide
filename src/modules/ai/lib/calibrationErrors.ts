import type { CalibrationSample } from "@/modules/ai/lib/calibrationSchema";
import { normalizeAiError } from "@/modules/ai/lib/errors";

export function calibrationOutcome(
  error: unknown,
): CalibrationSample["outcome"] {
  const e = normalizeAiError(error);
  if (
    e.kind === "cancelled" ||
    (error instanceof Error && error.name === "AbortError")
  )
    return "cancelled";
  if (e.kind === "authentication" || e.kind === "authorization") return "auth";
  if (e.kind === "quota") return "unknown";
  // Only explicit resource evidence, not generic 500/503 or network errors.
  if (
    /out[_ -]of[_ -]memory|cuda[^\n]{0,40}memory|gpu[^\n]{0,40}memory/i.test(
      `${e.errorCode ?? ""} ${e.message}`,
    )
  )
    return "resource";
  switch (e.kind) {
    case "timeout":
      return "timeout";
    case "network":
      return "offline";
    case "model_loading":
      return "loading";
    case "rate_limit":
      return "rate-limit";
    case "backend_restart":
    case "interrupted":
      return "interrupted";
    case "provider_unavailable":
      return "provider";
    case "internal":
      return "protocol";
    default:
      return "unknown";
  }
}
