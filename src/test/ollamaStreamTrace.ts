import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";

const MAX_FRAME = 256 * 1024;
const MAX_EVENTS = 256;
type RecordValue = Record<string, unknown>;
type Stamp = { at: number; category: string; size?: number };
const object = (value: unknown): RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue : {};

export function ollamaDiagnosticMetrics(value: RecordValue) {
  return { done: value.done === true,
    done_reason: value.done_reason === "stop" || value.done_reason === "length" ? value.done_reason : "other",
    ...Object.fromEntries(["total_duration", "load_duration", "prompt_eval_count", "prompt_eval_cached_count",
      "prompt_eval_duration", "eval_count", "eval_duration"].flatMap(key => {
      const count = value[key];
      return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? [[key, count]] : [];
    })) };
}

// Acceptance-only observation. No content, tool arguments, URLs or credentials leave this collector.
export function createOllamaStreamTrace() {
  let line: number[] = [], oversized = false;
  let chunks = 0, bytes = 0, frames = 0, invalid = 0, droppedFrames = 0;
  let firstRawAt: number | null = null, lastRawAt: number | null = null;
  let firstFrameAt: number | null = null, lastFrameAt: number | null = null, lastMeaningfulAt: number | null = null;
  let maxRawGapMs = 0, maxFrameGapMs = 0, droppedEvents = 0;
  let final: { at: number; reason: string; inputTokens: number | null; outputTokens: number | null } | null = null;
  const events: Stamp[] = [];
  const categories: Record<string, number> = {};
  const categoryTimes: Record<string, { firstAt: number; lastAt: number }> = {};
  const sdk: Record<string, { count: number; lastAt: number }> = {};
  const record = (category: string, at: number, size?: number) => {
    categories[category] = (categories[category] ?? 0) + 1;
    categoryTimes[category] = { firstAt: categoryTimes[category]?.firstAt ?? at, lastAt: at };
    if (events.length === MAX_EVENTS) { events.shift(); droppedEvents++; }
    events.push({ at, category, ...(size === undefined ? {} : { size }) });
  };
  const inspect = (raw: number[], at: number) => {
    let frame: RecordValue;
    try {
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(raw)));
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
      frame = object(value);
    } catch { invalid++; record("invalid-frame", at); return; }
    frames++;
    firstFrameAt ??= at;
    if (lastFrameAt !== null) maxFrameGapMs = Math.max(maxFrameGapMs, at - lastFrameAt);
    lastFrameAt = at;
    const message = object(frame.message);
    let activity = false, meaningful = false;
    for (const [field, name] of [["content", "text"], ["thinking", "reasoning"]]) {
      const value = message[field];
      if (typeof value !== "string" || !value.length) continue;
      record(value.trim() ? name : `whitespace-${name}`, at, value.length);
      activity = true;
      meaningful ||= value.trim().length > 0;
    }
    if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
      record("tools", at, message.tool_calls.length);
      activity = meaningful = true;
    }
    if (meaningful) lastMeaningfulAt = at;
    if (frame.done === true) {
      const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
      final = { at, reason: frame.done_reason === "stop" || frame.done_reason === "length" ? frame.done_reason : "other",
        inputTokens: count(frame.prompt_eval_count), outputTokens: count(frame.eval_count) };
      record("final", at);
    } else if (typeof frame.error === "string") record("provider-error", at);
    else if (!activity) record("empty-or-metadata", at);
  };
  return {
    receive(chunk: readonly number[], at: number) {
      if (!chunk.length) return;
      chunks++; bytes += chunk.length;
      firstRawAt ??= at;
      if (lastRawAt !== null) maxRawGapMs = Math.max(maxRawGapMs, at - lastRawAt);
      lastRawAt = at;
      record("raw-chunk", at, chunk.length);
      for (const byte of chunk) {
        if (byte === 10) {
          if (!oversized && line.some(b => b !== 13 && b !== 32 && b !== 9)) inspect(line, at);
          line = []; oversized = false;
        } else if (!oversized && line.length < MAX_FRAME) line.push(byte);
        else if (!oversized) { oversized = true; line = []; droppedFrames++; record("oversized-frame", at); }
      }
    },
    sdkPart(type: string, at: number) {
      if (!["text-start", "text-delta", "reasoning-start", "reasoning-delta", "tool-input-start", "tool-input-delta", "tool-call", "finish", "error"].includes(type)) return;
      sdk[type] = { count: (sdk[type]?.count ?? 0) + 1, lastAt: at };
      record(`sdk-${type}`, at);
    },
    end(at: number) {
      if (!oversized && line.some(b => b !== 13 && b !== 32 && b !== 9)) inspect(line, at);
      line = []; oversized = false;
      record("stream-eof", at);
    },
    summary() {
      return { timestampLayer: "native IPC chunk delivery, not socket receive", chunks, bytes, frames, invalid,
        droppedFrames, pendingBytes: line.length, firstRawAt, lastRawAt, firstFrameAt, lastFrameAt, lastMeaningfulAt,
        maxRawGapMs, maxFrameGapMs, final, categories: { ...categories },
        categoryTimes: structuredClone(categoryTimes), sdk: structuredClone(sdk), events: events.slice(), droppedEvents };
    },
  };
}

export function ollamaReplayParams(body: RecordValue): LanguageModelV3CallOptions {
  if (!Array.isArray(body.messages) || !Array.isArray(body.tools)) throw new Error("Missing replay prompt/tools");
  const prompt: LanguageModelV3CallOptions["prompt"] = body.messages.map(value => {
    const m = object(value);
    if (typeof m.content !== "string") throw new Error("Unsupported replay content");
    if (m.role === "system") return { role: "system", content: m.content };
    if (m.role === "user") return { role: "user", content: [{ type: "text", text: m.content }] };
    if (m.role === "tool") {
      if (typeof m.tool_call_id !== "string" || typeof m.tool_name !== "string") throw new Error("Missing replay tool identity");
      return { role: "tool", content: [{ type: "tool-result", toolCallId: m.tool_call_id,
        toolName: m.tool_name, output: { type: "text", value: m.content } }] };
    }
    if (m.role !== "assistant") throw new Error("Unsupported replay role");
    const content: Extract<LanguageModelV3CallOptions["prompt"][number], { role: "assistant" }>["content"] = [];
    if (m.content) content.push({ type: "text", text: m.content });
    if (typeof m.thinking === "string" && m.thinking) content.push({ type: "reasoning", text: m.thinking });
    for (const value of Array.isArray(m.tool_calls) ? m.tool_calls : []) {
      const call = object(value), fn = object(call.function);
      if (typeof call.id !== "string" || typeof fn.name !== "string") throw new Error("Missing replay call identity");
      content.push({ type: "tool-call", toolCallId: call.id, toolName: fn.name, input: fn.arguments });
    }
    return { role: "assistant", content };
  });
  return { prompt, maxOutputTokens: 2048, providerOptions: { ollama: { numCtx: 32768, think: false } },
    tools: body.tools.map(value => {
      const fn = object(object(value).function);
      if (typeof fn.name !== "string" || typeof fn.description !== "string") throw new Error("Missing replay tool schema");
      return { type: "function", name: fn.name, description: fn.description,
        inputSchema: fn.parameters as Extract<NonNullable<LanguageModelV3CallOptions["tools"]>[number], { type: "function" }>["inputSchema"] };
    }) };
}
