import { wrapLanguageModel, type LanguageModel } from "ai";
import type {
  LanguageModelV3Usage,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import type { AdmissionObservation } from "@/modules/ai/lib/inferenceAdmission";
import type { CalibrationSample } from "@/modules/ai/lib/calibrationSchema";
import type { ScopedCalibrationSample } from "@/modules/ai/lib/inferenceCalibration";
import { calibrationOutcome } from "@/modules/ai/lib/calibrationErrors";
import { streamValidationFailure } from "@/modules/ai/lib/inferenceErrors";

export type CalibrationCaptureOptions = {
  profileId: string;
  endpointId: string;
  configurationRevision: number;
  requestClass?: CalibrationSample["requestClass"];
  isCurrent?: () => boolean;
  thermal?: () => CalibrationSample["thermal"];
  record: (sample: ScopedCalibrationSample) => void;
  onQueued?: () => void;
};
type Capture = {
  options: CalibrationCaptureOptions;
  sample: CalibrationSample;
  signal?: AbortSignal;
  started: number | null;
  first: number | null;
  last: number | null;
  interval?: NativeInterval;
  ambiguous: boolean;
};
type NativeInterval = {
  endpointId: string;
  profileId: string;
  revision: number;
  start: number;
  end: number | null;
};
// Only confirmed native interval overlap counts. Event delivery order and unknown
// cross-window load cannot establish headroom; native E1 remains the owner.
const recent: NativeInterval[] = [];
function confirmedConcurrency(current: NativeInterval): number {
  if (current.end === null) return 1;
  const events: { at: number; delta: number }[] = [];
  for (const peer of recent) {
    if (
      peer.end === null ||
      peer.endpointId !== current.endpointId ||
      peer.profileId !== current.profileId ||
      peer.revision !== current.revision
    )
      continue;
    const start = Math.max(current.start, peer.start),
      end = Math.min(current.end, peer.end);
    if (end > start)
      events.push({ at: start, delta: 1 }, { at: end, delta: -1 });
  }
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let count = 0,
    peak = 1;
  for (let i = 0; i < events.length; i++) {
    count += events[i].delta;
    if (i + 1 < events.length && events[i + 1].at - events[i].at >= 250)
      peak = Math.max(peak, count);
  }
  return Math.min(8, peak);
}
function count(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 100_000_000
    ? value
    : null;
}
function duration(value: number): number | null {
  return Number.isFinite(value) && value >= 0 && value <= 3_600_000
    ? value
    : null;
}
function usage(c: Capture, value: LanguageModelV3Usage) {
  c.sample.inputTokens = count(value.inputTokens.total);
  c.sample.outputTokens = count(value.outputTokens.total);
}
function output(c: Capture, part: LanguageModelV3StreamPart) {
  const kind =
    part.type === "text-delta"
      ? "text"
      : part.type === "reasoning-delta"
        ? "reasoning"
        : ["tool-call", "tool-input-start", "tool-input-delta"].includes(
              part.type,
            )
          ? "tool"
          : null;
  if (
    !kind ||
    ((part.type === "text-delta" || part.type === "reasoning-delta") &&
      !part.delta)
  )
    return;
  const now = Date.now();
  c.first ??= now;
  if (c.last !== null)
    c.sample.maxGapMs = Math.max(
      c.sample.maxGapMs ?? 0,
      duration(now - c.last) ?? 0,
    );
  c.last = now;
  if (
    c.sample.outputKind !== "tool" &&
    (c.sample.outputKind === "none" || kind === "tool" || kind === "reasoning")
  )
    c.sample.outputKind = kind;
}

export function createCalibrationCapture(options: CalibrationCaptureOptions) {
  const calls = new Map<AbortSignal | undefined, Capture>();
  const open = (signal?: AbortSignal) => {
    const collision = calls.get(signal);
    if (collision) collision.ambiguous = true;
    const c: Capture = {
      options,
      signal,
      started: null,
      first: null,
      last: null,
      ambiguous: !!collision,
      sample: {
        id: crypto.randomUUID(),
        configurationRevision: options.configurationRevision,
        observedAt: Date.now(),
        requestClass: options.requestClass ?? "generation",
        outcome: "unknown",
        thermal: "unknown",
        queueMs: null,
        ttftMs: null,
        latencyMs: null,
        generationMs: null,
        maxGapMs: null,
        inputTokens: null,
        outputTokens: null,
        concurrency: null,
        outputKind: "none",
      },
    };
    calls.set(signal, c);
    return c;
  };
  const finish = (c: Capture, error?: unknown) => {
    if (calls.get(c.signal) === c) calls.delete(c.signal);
    const failure = streamValidationFailure(c.signal) ?? error;
    c.sample.outcome =
      failure !== undefined ? calibrationOutcome(failure) : "success";
    if (c.sample.outcome === "loading") c.sample.thermal = "cold";
    const now = Date.now();
    c.sample.observedAt = now;
    if (c.started !== null) {
      c.sample.latencyMs = duration(now - c.started);
      c.sample.ttftMs = c.first === null ? null : duration(c.first - c.started);
    }
    c.sample.generationMs =
      c.first === null || c.last === null ? null : duration(c.last - c.first);
    if (
      !c.ambiguous &&
      c.started !== null &&
      (options.isCurrent?.() !== false || c.sample.outcome === "cancelled")
    )
      try {
        options.record({ profileId: options.profileId, sample: c.sample });
      } catch {
        /* Optional metadata cannot fail the inference it describes. */
      }
  };
  return {
    observe(
      signal: AbortSignal | null | undefined,
      observation: AdmissionObservation,
    ) {
      const c = calls.get(signal ?? undefined);
      if (
        !c ||
        observation.endpointId !== options.endpointId ||
        observation.profileId !== options.profileId
      )
        return;
      if (observation.admittedAt === null) options.onQueued?.();
      if (observation.admittedAt !== null)
        c.sample.queueMs = duration(
          observation.admittedAt - observation.queueEnteredAt,
        );
      if (observation.attemptStartedAt !== null) {
        c.started = observation.attemptStartedAt;
        if (!c.interval) {
          c.sample.thermal = options.thermal?.() ?? "unknown";
          c.interval = {
            endpointId: options.endpointId,
            profileId: options.profileId,
            revision: options.configurationRevision,
            start: observation.attemptStartedAt,
            end: null,
          };
          recent.push(c.interval);
          while (
            recent.length > 128 ||
            (recent[0] && recent[0].start < Date.now() - 3_600_000)
          )
            recent.shift();
          c.sample.concurrency = 1;
        }
        if (
          observation.settledAt !== null &&
          observation.settledAt >= c.interval.start &&
          c.interval.end === null
        ) {
          c.interval.end = observation.settledAt;
          c.sample.concurrency = confirmedConcurrency(c.interval);
        }
      }
    },
    wrap(model: LanguageModel): LanguageModel {
      if (typeof model === "string" || model.specificationVersion !== "v3")
        return model;
      return wrapLanguageModel({
        model,
        middleware: {
          specificationVersion: "v3",
          async wrapGenerate({ params, doGenerate }) {
            const c = open(params.abortSignal);
            try {
              const result = await doGenerate();
              usage(c, result.usage);
              c.sample.outputKind = result.content.some(
                (p) => p.type === "tool-call",
              )
                ? "tool"
                : "text";
              finish(
                c,
                ["error", "unknown"].includes(result.finishReason.unified)
                  ? new Error("Unverified model result")
                  : undefined,
              );
              return result;
            } catch (error) {
              finish(c, error);
              throw error;
            }
          },
          async wrapStream({ params, doStream }) {
            const c = open(params.abortSignal);
            try {
              const result = await doStream();
              const reader = result.stream.getReader();
              let ended = false;
              let verified = false;
              let failure: unknown;
              const settle = (error?: unknown) => {
                if (ended) return;
                ended = true;
                finish(
                  c,
                  error ??
                    failure ??
                    (!verified ? new Error("Unverified stream") : undefined),
                );
              };
              return {
                ...result,
                stream: new ReadableStream<LanguageModelV3StreamPart>({
                  async pull(controller) {
                    try {
                      const part = await reader.read();
                      if (part.done) {
                        settle();
                        controller.close();
                        reader.releaseLock();
                        return;
                      }
                      output(c, part.value);
                      if (part.value.type === "error")
                        failure = part.value.error;
                      if (part.value.type === "finish") {
                        verified = !["error", "unknown"].includes(
                          part.value.finishReason.unified,
                        );
                        usage(c, part.value.usage);
                      }
                      controller.enqueue(part.value);
                    } catch (error) {
                      settle(error);
                      controller.error(error);
                      reader.releaseLock();
                    }
                  },
                  async cancel(reason) {
                    failure = new DOMException("Cancelled", "AbortError");
                    try {
                      await reader.cancel(reason);
                    } finally {
                      settle(failure);
                      reader.releaseLock();
                    }
                  },
                }),
              };
            } catch (error) {
              finish(c, error);
              throw error;
            }
          },
        },
      });
    },
  };
}
