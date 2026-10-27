/** Optional, failure-only Ollama stream diagnostics. No persistence or logging
 * by default; an explicitly installed acceptance observer owns any receipts.
 * Provider prompts and complete frames are never captured by this module. */
export type OllamaParserStage = "completion-scanner" | "native-adapter";

export type OllamaParserFailure = {
  stage: OllamaParserStage;
  requestId: string | null;
  at: number;
  exception: { name: string; message: string; stack: string | null };
  phase: string;
  chunkSequence: number;
  bytesRead: number;
  parsedFrames: number;
  pendingChars: number;
  pendingTail: string;
  activeFrameTail: string | null;
  lastParsedShape: Record<string, unknown> | null;
  decoder: { encoding: "utf-8"; incremental: true; fatal: boolean; flushed: boolean };
  recentRawByteHex: string;
};

type Observer = (record: OllamaParserFailure) => void;
const observers = new Set<Observer>();
const nativeIds = new WeakMap<Response, string>();

export function installOllamaParserFailureObserver(observer: Observer): () => void {
  observers.add(observer);
  return () => { observers.delete(observer); };
}
export function ollamaParserFailureObserved(): boolean { return observers.size > 0; }
export function associateNativeResponse(response: Response, id: string | undefined): void {
  if (id && /^inference-[1-9]\d*$/.test(id)) nativeIds.set(response, id);
}
export function copyNativeResponseAssociation(next: Response, previous: Response): void {
  associateNativeResponse(next, nativeIds.get(previous));
}
export function nativeResponseId(response: Response): string | null {
  return nativeIds.get(response) ?? null;
}

/** Frame metadata excludes contents, reasoning, tool argument values and
 * provider-side error text; it only describes the shape needed for triage. */
export function ollamaFrameShape(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return { type: Array.isArray(input) ? "array" : typeof input };
  const frame = input as Record<string, unknown>;
  const message = frame.message && typeof frame.message === "object" && !Array.isArray(frame.message)
    ? frame.message as Record<string, unknown> : null;
  const calls = message?.tool_calls;
  return {
    keys: Object.keys(frame).sort().slice(0, 32),
    done: typeof frame.done === "boolean" ? frame.done : typeof frame.done,
    hasError: Object.prototype.hasOwnProperty.call(frame, "error"),
    messageKeys: message ? Object.keys(message).sort().slice(0, 32) : null,
    contentType: typeof message?.content,
    contentChars: typeof message?.content === "string" ? message.content.length : null,
    thinkingType: typeof message?.thinking,
    thinkingChars: typeof message?.thinking === "string" ? message.thinking.length : null,
    toolCallsType: Array.isArray(calls) ? "array" : typeof calls,
    toolCallsCount: Array.isArray(calls) ? calls.length : null,
    toolArgumentsTypes: Array.isArray(calls) ? calls.slice(0, 8).map(call => {
      const fn = call && typeof call === "object" ? (call as { function?: unknown }).function : null;
      const arg = fn && typeof fn === "object" ? (fn as { arguments?: unknown }).arguments : undefined;
      return Array.isArray(arg) ? "array" : typeof arg;
    }) : [],
  };
}

export class OllamaParserFailureState {
  phase = "starting";
  chunkSequence = 0;
  bytesRead = 0;
  parsedFrames = 0;
  flushed = false;
  lastParsedShape: Record<string, unknown> | null = null;
  activeFrame: string | null = null;
  private rawTail: number[] = [];

  readingFrame(line: string): void {
    // Never retain another full frame, even during an opted-in diagnostic.
    this.activeFrame = ollamaParserFailureObserved() ? line.slice(-384) : null;
  }

  observeChunk(bytes: Uint8Array): void {
    this.chunkSequence++;
    this.bytesRead += bytes.byteLength;
    // Only hold a bounded tail while an acceptance observer is installed.
    if (!ollamaParserFailureObserved()) return;
    this.rawTail = [...this.rawTail, ...bytes.slice(-128)].slice(-128);
  }
  parsed(value: unknown): void {
    this.parsedFrames++;
    if (ollamaParserFailureObserved()) this.lastParsedShape = ollamaFrameShape(value);
    this.activeFrame = null;
  }
  failure(stage: OllamaParserStage, response: Response, error: unknown, pending: string, fatal: boolean): void {
    if (!ollamaParserFailureObserved()) return;
    try {
      const e = error instanceof Error ? error : new Error(typeof error === "string" ? error : "non-Error thrown");
      const record: OllamaParserFailure = {
        stage, requestId: nativeResponseId(response), at: Date.now(),
        exception: { name: String(e.name).slice(0, 128), message: String(e.message).slice(0, 512),
          stack: typeof e.stack === "string" ? e.stack.slice(0, 2048) : null },
        phase: this.phase.slice(0, 64), chunkSequence: this.chunkSequence,
        bytesRead: this.bytesRead, parsedFrames: this.parsedFrames,
        pendingChars: pending.length, pendingTail: pending.slice(-384),
        activeFrameTail: this.activeFrame?.slice(-384) ?? null,
        lastParsedShape: this.lastParsedShape,
        decoder: { encoding: "utf-8", incremental: true, fatal, flushed: this.flushed },
        recentRawByteHex: this.rawTail.map(b=>b.toString(16).padStart(2,"0")).join(""),
      };
      for (const listener of observers) { try { listener(record); } catch { /* diagnostics cannot affect parsing */ } }
    } catch { /* never replace the original parser exception */ }
  }
}
