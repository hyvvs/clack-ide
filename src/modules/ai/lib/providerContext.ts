import {
  knownTransportContextLimit,
  type ProviderId,
} from "@/modules/ai/config";
import type { BudgetLimits } from "@/modules/ai/lib/contextBudget";

const CATALOG_URL = "https://openrouter.ai/api/v1/models";
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_MODELS = 4096;
const TTL = 15 * 60_000;
const FAILURE_TTL = 30_000;
type Capacity = { context: number; output?: number };
type Catalog = { models: Map<string, Capacity>; expires: number };

const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function parseProviderContextCatalog(
  value: unknown,
): Map<string, Capacity> {
  const data = record(value)?.data;
  if (!Array.isArray(data) || data.length > MAX_MODELS)
    throw new Error("Invalid provider context catalog.");
  const models = new Map<string, Capacity>();
  const seen = new Set<string>();
  for (const entry of data) {
    const model = record(entry);
    const id = model?.id;
    if (
      typeof id !== "string" ||
      !id ||
      id.length > 256 ||
      /\s/.test(id) ||
      [...id].some((c) => c.charCodeAt(0) < 32)
    )
      continue;
    if (seen.has(id)) {
      models.delete(id);
      continue;
    }
    seen.add(id);
    if (!positive(model?.context_length)) continue;
    const top = record(model.top_provider);
    if (top?.context_length != null && !positive(top.context_length)) continue;
    const context = Math.min(
      model.context_length,
      (top?.context_length as number) ?? Infinity,
    );
    const output = top?.max_completion_tokens;
    if (output != null && (!positive(output) || output > context)) continue;
    models.set(id, { context, ...(positive(output) ? { output } : {}) });
  }
  return models;
}

async function readCatalog(): Promise<Map<string, Capacity>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => {
    void reader?.cancel().catch(() => undefined);
  };
  controller.signal.addEventListener("abort", cancel, { once: true });
  try {
    const response = await globalThis.fetch(CATALOG_URL, {
      method: "GET",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("application/json")
    )
      throw new Error("Provider context metadata unavailable.");
    if (
      Number(response.headers.get("content-length")) > MAX_BYTES ||
      !response.body
    )
      throw new Error("Provider context catalog exceeds bounds.");
    reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const chunks: string[] = [];
    let bytes = 0;
    for (;;) {
      controller.signal.throwIfAborted();
      const { done, value } = await reader.read();
      controller.signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES)
        throw new Error("Provider context catalog exceeds bounds.");
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return parseProviderContextCatalog(JSON.parse(chunks.join("")));
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", cancel);
    cancel();
  }
}

export function createProviderContextResolver() {
  let catalog: Catalog | undefined;
  let pending: Promise<Catalog> | undefined;
  return async (
    modelId: string,
    providerId?: ProviderId,
    cachedOnly = false,
  ): Promise<BudgetLimits> => {
    const installed = knownTransportContextLimit(modelId, providerId);
    const fresh = catalog && catalog.expires > Date.now() ? catalog : undefined;
    // Installed routes need no discovery. Unknown gateway IDs share one bounded public lookup.
    if (providerId === "openrouter" && !installed && !fresh && !cachedOnly) {
      pending ??= readCatalog()
        .then(
          (models) => ({ models, expires: Date.now() + TTL }),
          () => ({
            models: new Map<string, Capacity>(),
            expires: Date.now() + FAILURE_TTL,
          }),
        )
        .then((result) => {
          catalog = result;
          pending = undefined;
          return result;
        });
      await pending;
    }
    const found =
      providerId === "openrouter" && catalog && catalog.expires > Date.now()
        ? catalog.models.get(modelId)
        : undefined;
    const reported = found?.context ?? installed;
    return {
      reported,
      ...(found?.output ? { outputCap: found.output } : {}),
      ...(reported && providerId
        ? {
            reportedEvidence: {
              providerId,
              modelId,
              origin: found
                ? ("provider-metadata" as const)
                : ("installed-registry" as const),
            },
          }
        : {}),
    };
  };
}

export const resolveProviderContext = createProviderContextResolver();
