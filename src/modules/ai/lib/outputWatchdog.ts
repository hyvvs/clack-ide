import { z } from "zod";
import {
  createRunLoopTracker,
  observeRunStep,
  type RunStepObservation,
} from "@/modules/ai/lib/runBudget";

export const WATCHDOG_LIMITS = {
  whitespace: 8192,
  window: 16384,
  checkEvery: 512,
  paragraphs: 8,
  paragraphCharacters: 48,
  words: 512,
  phraseWords: 8,
  phraseRepeats: 32,
  repeatedCharacters: 1024,
  toolSuccesses: 8,
  toolBytes: 16384,
  toolNodes: 1024,
  continuationRepeats: 2,
  suffix: 512,
  negligible: 32,
} as const;
export const watchdogSchema = z
  .object({
    version: z.literal(1),
    reason: z.enum([
      "excessive_whitespace",
      "repeated_output",
      "repeated_tool_call",
      "continuation_loop",
    ]),
    observedAt: z.number().int().nonnegative().safe(),
  })
  .strict();
export type WatchdogStop = z.infer<typeof watchdogSchema>;
export function watchdogInstruction(
  messages: readonly {
    role: string;
    parts?: readonly { type: string; text?: unknown }[];
    content?: string | readonly { type: string; text?: unknown }[];
  }[],
): string {
  let user: (typeof messages)[number] | undefined;
  for (let i = messages.length - 1; i >= 0; i--)
    if (messages[i].role === "user") {
      user = messages[i];
      break;
    }
  if (!user) return "";
  if (typeof user.content === "string") return user.content.slice(-4096);
  let text = "";
  for (const part of (user.parts ?? user.content ?? []).slice(-64))
    if (part.type === "text" && typeof part.text === "string")
      text = `${text} ${part.text.slice(-4096)}`.slice(-4096);
  return text;
}
export function describeWatchdog(reason: WatchdogStop["reason"]): string {
  switch (reason) {
    case "excessive_whitespace":
      return "Stopped excessive whitespace output. The partial answer is preserved.";
    case "repeated_output":
      return "Stopped repeated output without progress. The partial answer is preserved.";
    case "repeated_tool_call":
      return "Stopped identical tool calls with unchanged results. Completed effects were not replayed.";
    case "continuation_loop":
      return "Stopped continuation without meaningful progress. The partial answer is preserved.";
  }
}
export class OutputWatchdogError extends Error {
  readonly watchdog: WatchdogStop;
  constructor(reason: WatchdogStop["reason"]) {
    super(describeWatchdog(reason));
    this.name = "OutputWatchdogError";
    this.watchdog = { version: 1, reason, observedAt: Date.now() };
  }
}
export function readWatchdogError(error: unknown): WatchdogStop | null {
  if (!error || typeof error !== "object" || !("watchdog" in error))
    return null;
  const parsed = watchdogSchema.safeParse(error.watchdog);
  return parsed.success ? parsed.data : null;
}

// Incomplete/oversized structures are not comparable, never truncated into a match.
export function boundedToolFingerprint(value: unknown): string | null {
  let nodes = 0,
    size = 0;
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > WATCHDOG_LIMITS.toolNodes || depth > 16) throw new Error();
    if (typeof item === "string") {
      size += item.length;
      if (size > WATCHDOG_LIMITS.toolBytes) throw new Error();
    }
    if (
      item === undefined ||
      typeof item === "function" ||
      typeof item === "symbol" ||
      typeof item === "bigint"
    )
      throw new Error();
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error();
    if (!item || typeof item !== "object") return item;
    if (seen.has(item)) throw new Error();
    seen.add(item);
    if (Array.isArray(item)) {
      if (item.length > WATCHDOG_LIMITS.toolNodes) throw new Error();
      return item.map((v) => visit(v, depth + 1));
    }
    if (
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      throw new Error();
    const keys = Object.keys(item);
    if (keys.length > WATCHDOG_LIMITS.toolNodes) throw new Error();
    return Object.fromEntries(
      keys.sort().map((key) => {
        size += key.length;
        if (size > WATCHDOG_LIMITS.toolBytes) throw new Error();
        return [key, visit((item as Record<string, unknown>)[key], depth + 1)];
      }),
    );
  };
  try {
    const result = JSON.stringify(visit(value, 0));
    return new TextEncoder().encode(result).length <= WATCHDOG_LIMITS.toolBytes
      ? result
      : null;
  } catch {
    return null;
  }
}
function structured(text: string) {
  return (
    /[`{}[\]<>|=;:\d]/.test(text) ||
    (!/\n[ \t]*\n/.test(text) &&
      text.split("\n").filter((line) => line.trim()).length >= 3 &&
      text
        .split("\n")
        .filter((line) => line.trim())
        .slice(1, -1)
        .every((line) => line.includes(","))) ||
    /^\s*(?:[-*+#]|\/\/|\b(?:pass|return|break|continue|import|from|def|class|const|let|var|function)\b)/m.test(
      text,
    )
  );
}
function repeated(text: string) {
  if (structured(text)) return false;
  const paragraphs = text
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(-WATCHDOG_LIMITS.paragraphs);
  if (
    paragraphs.length === WATCHDOG_LIMITS.paragraphs &&
    paragraphs[0].length >= WATCHDOG_LIMITS.paragraphCharacters &&
    paragraphs.every((p) => p === paragraphs[0])
  )
    return true;
  const words = text.trim().split(/\s+/).slice(-WATCHDOG_LIMITS.words);
  for (let width = 1; width <= WATCHDOG_LIMITS.phraseWords; width++) {
    const count = width * WATCHDOG_LIMITS.phraseRepeats;
    const tail = words.slice(-Math.floor(words.length / width) * width);
    if (
      tail.length < count ||
      tail.join(" ").length < WATCHDOG_LIMITS.repeatedCharacters
    )
      continue;
    if (tail.every((word, i) => word === tail[i % width])) return true;
  }
  return false;
}

export function createOutputWatchdog(instruction = "") {
  const request = instruction
    .slice(-4096)
    .replace(
      /\b(?:do not|don't|never|avoid)\s+(?:repeat|repetition|repeated|repetitive|duplicate|duplicates)\b/gi,
      "",
    );
  const intentional =
    /\b(?:repeat|repetition|repeated|repetitive|duplicate|duplicates)\b/i.test(
      request,
    );
  const channels = {
    text: { tail: "", whitespace: 0, pending: 0 },
    reasoning: { tail: "", whitespace: 0, pending: 0 },
  };
  let failure = createRunLoopTracker();
  let toolKey: string | null = null,
    toolCount = 0;
  let suffix = "",
    same = 0,
    tiny = 0;
  let stopped: OutputWatchdogError | null = null;
  const stop = (reason: WatchdogStop["reason"]) =>
    (stopped ??= new OutputWatchdogError(reason));
  return {
    get error() {
      return stopped;
    },
    observe(delta: string, channel: "text" | "reasoning" = "text") {
      if (stopped) return stopped;
      const state = channels[channel];
      const part = delta.slice(-WATCHDOG_LIMITS.window);
      let trailing = 0;
      for (let i = part.length - 1; i >= 0 && /\s/.test(part[i]); i--)
        trailing++;
      state.whitespace =
        trailing === delta.length ? state.whitespace + trailing : trailing;
      if (state.whitespace >= WATCHDOG_LIMITS.whitespace)
        return stop("excessive_whitespace");
      state.tail = (state.tail + part).slice(-WATCHDOG_LIMITS.window);
      state.pending += delta.length;
      if (!intentional && state.pending >= WATCHDOG_LIMITS.checkEvery) {
        state.pending = 0;
        if (repeated(state.tail)) return stop("repeated_output");
      }
      return null;
    },
    tool(observation: RunStepObservation, identity: unknown = null) {
      if (stopped) return stopped;
      const key = boundedToolFingerprint({ ...observation, identity });
      if (!key) {
        toolKey = null;
        toolCount = 0;
        failure = createRunLoopTracker();
        return null;
      }
      failure = observeRunStep(failure, observation, key);
      toolCount = key === toolKey ? toolCount + 1 : 1;
      toolKey = key;
      if (
        failure.detected ||
        (!intentional &&
          !observation.failed &&
          toolCount >= WATCHDOG_LIMITS.toolSuccesses)
      )
        return stop("repeated_tool_call");
      return null;
    },
    segment(text: string, continuing: boolean) {
      if (stopped) return stopped;
      const current = text.slice(-WATCHDOG_LIMITS.suffix).trim();
      if (!continuing) {
        suffix = current;
        same = 0;
        tiny = 0;
        return null;
      }
      const comparable = text.length <= WATCHDOG_LIMITS.suffix;
      tiny =
        comparable && current.length < WATCHDOG_LIMITS.negligible
          ? tiny + 1
          : 0;
      same =
        comparable &&
        !intentional &&
        !structured(current) &&
        current.length >= WATCHDOG_LIMITS.negligible &&
        current === suffix
          ? same + 1
          : 0;
      suffix = current;
      if (
        !intentional &&
        (tiny >= WATCHDOG_LIMITS.continuationRepeats ||
          same >= WATCHDOG_LIMITS.continuationRepeats)
      )
        return stop("continuation_loop");
      return null;
    },
  };
}
export type OutputWatchdog = ReturnType<typeof createOutputWatchdog>;
