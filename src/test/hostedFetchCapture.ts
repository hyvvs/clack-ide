/** Acceptance-only OpenRouter cloud fetch observation. Never used by production.
 * Hosted Clack uses preflightFetch -> globalThis.fetch, NOT native ai_http_stream.
 */
export type HostedWireReceipt = {
  modelId: string;
  max_tokens: number;
  max_completion_tokens: number | null;
  outputFieldsPresent: Record<string, boolean>;
  toolsCount: number;
  serializedBytes: number;
  stage: "after-sdk-and-preflight";
};

export function diagnoseHostedHarnessFailure(error: unknown, milestone: string) {
  const e = error instanceof Error ? error : new Error("Non-Error thrown during harness initialization");
  const bounded = (value: string) => value.slice(0, 6000).replace(
    /(?:sk-or-v1-|sk-|Bearer\s+)[A-Za-z0-9._-]{12,}/gi, "[redacted]",
  );
  return {
    failureClass: e.name, failureMessage: bounded(e.message),
    failureStack: bounded(e.stack ?? "Stack unavailable"),
    lastMilestone: milestone.slice(0, 80),
  };
}

export function inspectHostedWireBody(raw: string, expectedModel: string): HostedWireReceipt {
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error("Hosted capture: invalid serialized JSON"); }
  const fields = ["max_tokens", "max_completion_tokens", "max_output_tokens",
    "reasoning_effort", "reasoning", "include_reasoning"];
  const outputFieldsPresent = Object.fromEntries(fields.map(field =>
    [field, Object.prototype.hasOwnProperty.call(body, field)]));
  if (body.model !== expectedModel)
    throw new Error("Hosted capture: saved provider/model identity mismatch");
  if (typeof body.max_tokens !== "number" ||
      !Number.isSafeInteger(body.max_tokens) || body.max_tokens < 1)
    throw new Error("Hosted capture: missing numeric max_tokens");
  if (["max_completion_tokens", "max_output_tokens", "reasoning_effort", "reasoning", "include_reasoning"]
      .some(field => outputFieldsPresent[field]))
    throw new Error("Hosted capture: unsupported completion or reasoning controls");
  return { modelId: expectedModel, max_tokens: body.max_tokens,
    max_completion_tokens: null, outputFieldsPresent,
    toolsCount: Array.isArray(body.tools) ? body.tools.length : 0,
    serializedBytes: new TextEncoder().encode(raw).length,
    stage: "after-sdk-and-preflight" };
}

export function installHostedFetchCapture(options: {
  modelId: string;
  offline: boolean;
  record: (receipt: HostedWireReceipt) => Promise<void>;
}): () => void {
  if (!options.modelId || !options.modelId.includes("/"))
    throw new Error("Hosted capture: missing exact saved provider/model ID");
  const original = globalThis.fetch;
  if (typeof original !== "function")
    throw new Error("Hosted capture: browser fetch is unavailable");
  const endpoint = "https://openrouter.ai/api/v1/chat/completions";
  const wrapper: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input
      : input instanceof URL ? input.toString() : input.url;
    if (url === endpoint) {
      if (typeof init?.body !== "string")
        return Promise.reject(new Error("Hosted capture: SDK body must be a string"));
      let receipt: HostedWireReceipt;
      try { receipt = inspectHostedWireBody(init.body, options.modelId); }
      catch (error) { return Promise.reject(error); }
      return Promise.resolve().then(() => options.record(receipt)).then(() => {
        if (options.offline)
          throw new Error("OFFLINE_DRY_RUN: hosted inference blocked before browser fetch");
        // Same args and this-binding, body untouched; no stream read/copy.
        return original.call(globalThis, input, init);
      });
    }
    if (options.offline) {
      // Strictly prohibit *all* non-local HTTP for dry runs, even if a future
      // provider chooses an alternate cloud endpoint. No fallback transport.
      let address: URL;
      try { address = new URL(url, "http://127.0.0.1"); }
      catch { return Promise.reject(new Error("OFFLINE_DRY_RUN: invalid fetch URL")); }
      if (!["127.0.0.1", "localhost"].includes(address.hostname))
        return Promise.reject(new Error("OFFLINE_DRY_RUN: external fetch blocked"));
    }
    return original.call(globalThis, input, init);
  };
  try {
    globalThis.fetch = wrapper;
    if (globalThis.fetch !== wrapper)
      throw new Error("Hosted capture: browser fetch is read-only");
  } catch (error) {
    throw new Error("Hosted capture: cannot install browser fetch observer" +
      (error instanceof Error ? ` (${error.name})` : ""));
  }
  return () => { if (globalThis.fetch === wrapper) globalThis.fetch = original; };
}
