import {
  knownTransportContextLimit,
  type ProviderId,
} from "@/modules/ai/config";
import type {
  BudgetLimits,
  ReportedContextEvidence,
} from "@/modules/ai/lib/contextBudget";

const CATALOG_URL = "https://openrouter.ai/api/v1/models";
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_MODELS = 4096;
const TTL = 15 * 60_000;
const FAILURE_TTL = 30_000;
const MAX_EXACT_CACHE = 128;
const MAX_EXACT_PENDING = 8;
type Capacity = {
  context: number;
  output?: number;
  capabilities?: ReportedContextEvidence["capabilities"];
};
type Catalog = { models: Map<string, Capacity>; expires: number };
type ExactModel = { model: Capacity | null; expires: number };

const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function stringSet(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > 32 ||
    value.some(
      (v) =>
        typeof v !== "string" ||
        !v ||
        v.length > 64 ||
        !/^[a-zA-Z0-9_.-]+$/.test(v),
    )
  )
    throw new Error("Invalid provider capability metadata.");
  return [...new Set(value as string[])].sort();
}

function capabilities(
  model: Record<string, unknown>,
): Capacity["capabilities"] {
  const architecture = record(model.architecture);
  if (model.architecture != null && !architecture)
    throw new Error("Invalid provider architecture metadata.");
  const inputModalities = stringSet(architecture?.input_modalities);
  const outputModalities = stringSet(architecture?.output_modalities);
  const supportedParameters = stringSet(model.supported_parameters);
  if (!inputModalities && !outputModalities && !supportedParameters)
    return undefined;
  return {
    ...(inputModalities ? { inputModalities } : {}),
    ...(outputModalities ? { outputModalities } : {}),
    ...(supportedParameters ? { supportedParameters } : {}),
  };
}

export function exactProviderModelURL(modelId: string): string | null {
  if (
    modelId.length > 256 ||
    /\s/.test(modelId) ||
    [...modelId].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    return null;
  const parts = modelId.split("/");
  if (parts.length !== 2 || parts.some((p) => !p || p === "." || p === ".."))
    return null;
  try {
    return `https://openrouter.ai/api/v1/model/${parts.map(encodeURIComponent).join("/")}`;
  } catch {
    return null;
  }
}

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
    if (model.top_provider != null && !top) continue;
    if (top?.context_length != null && !positive(top.context_length)) continue;
    const context = Math.min(
      model.context_length,
      (top?.context_length as number) ?? Infinity,
    );
    const output = top?.max_completion_tokens;
    if (output != null && (!positive(output) || output > context)) continue;
    try {
      const capabilityMetadata = capabilities(model);
      models.set(id, {
        context,
        ...(positive(output) ? { output } : {}),
        ...(capabilityMetadata ? { capabilities: capabilityMetadata } : {}),
      });
    } catch {
      /* Malformed capability data is not authoritative model evidence. */
    }
  }
  return models;
}

export function parseExactProviderModel(
  value: unknown,
  modelId: string,
): Capacity | null {
  const data = record(record(value)?.data);
  if (data?.id !== modelId) return null;
  return parseProviderContextCatalog({ data: [data] }).get(modelId) ?? null;
}

async function readMetadata(url: string, maxBytes: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => {
    void reader?.cancel().catch(() => undefined);
  };
  controller.signal.addEventListener("abort", cancel, { once: true });
  try {
    const response = await globalThis.fetch(url, {
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
      Number(response.headers.get("content-length")) > maxBytes ||
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
      if (bytes > maxBytes)
        throw new Error("Provider context catalog exceeds bounds.");
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return JSON.parse(chunks.join(""));
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", cancel);
    cancel();
    controller.abort();
  }
}

export function createProviderContextResolver() {
  let catalog: Catalog | undefined;
  let pending: Promise<Catalog> | undefined;
  const exact = new Map<string, ExactModel>();
  const exactPending = new Map<string, Promise<ExactModel>>();
  const freshExact = (id: string) => {
    const cached = exact.get(id);
    return cached && cached.expires > Date.now() ? cached : undefined;
  };
  const loadExact = async (id: string, url: string) => {
    const running = exactPending.get(id);
    if (running) return running;
    if (exactPending.size >= MAX_EXACT_PENDING) return undefined;
    const request = readMetadata(url, 64 * 1024)
      .then((value) => parseExactProviderModel(value, id))
      .catch(() => null)
      .then((model) => {
        const result = {
          model,
          expires: Date.now() + (model ? TTL : FAILURE_TTL),
        };
        for (const [key, value] of exact)
          if (value.expires <= Date.now()) exact.delete(key);
        if (exact.size >= MAX_EXACT_CACHE) {
          const oldest = exact.keys().next().value;
          if (oldest !== undefined) exact.delete(oldest);
        }
        exact.set(id, result);
        exactPending.delete(id);
        return result;
      });
    exactPending.set(id, request);
    return request;
  };
  return async (
    modelId: string,
    providerId?: ProviderId,
    cachedOnly = false,
  ): Promise<BudgetLimits> => {
    const installed = knownTransportContextLimit(modelId, providerId);
    const fresh = catalog && catalog.expires > Date.now() ? catalog : undefined;
    // Installed routes stay offline; catalog misses use isolated exact-ID evidence.
    if (
      providerId === "openrouter" &&
      !installed &&
      !fresh &&
      !freshExact(modelId) &&
      !cachedOnly
    ) {
      pending ??= readMetadata(CATALOG_URL, MAX_BYTES)
        .then(parseProviderContextCatalog)
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
    const catalogModel =
      providerId === "openrouter" && catalog && catalog.expires > Date.now()
        ? catalog.models.get(modelId)
        : undefined;
    let exactModel =
      providerId === "openrouter" ? freshExact(modelId) : undefined;
    if (
      providerId === "openrouter" &&
      !catalogModel &&
      !installed &&
      !exactModel &&
      !cachedOnly
    ) {
      const url = exactProviderModelURL(modelId);
      if (url) exactModel = await loadExact(modelId, url);
    }
    const found = catalogModel ?? exactModel?.model ?? undefined;
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
              ...(found
                ? {
                    lookup: catalogModel
                      ? ("catalog" as const)
                      : ("exact-model" as const),
                    ...(found.capabilities
                      ? { capabilities: structuredClone(found.capabilities) }
                      : {}),
                  }
                : {}),
            },
          }
        : {}),
    };
  };
}

export const resolveProviderContext = createProviderContextResolver();
