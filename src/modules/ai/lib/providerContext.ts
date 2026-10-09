import {
  knownTransportContextLimit,
  type ProviderId,
} from "@/modules/ai/config";
import type { BudgetLimits } from "@/modules/ai/lib/contextBudget";
import {
  freshProviderModelEvidence,
  parseExactProviderModel,
  parseProviderContextCatalog,
  PROVIDER_METADATA_TTL as TTL,
  type ProviderModelEvidence,
} from "@/modules/ai/lib/providerModelEvidence";

export {
  parseExactProviderModel,
  parseProviderContextCatalog,
} from "@/modules/ai/lib/providerModelEvidence";

const CATALOG_URL = "https://openrouter.ai/api/v1/models";
const MAX_BYTES = 4 * 1024 * 1024;
const FAILURE_TTL = 30_000;
const MAX_EXACT_CACHE = 128;
const MAX_EXACT_PENDING = 8;
type Catalog = { models: Map<string, ProviderModelEvidence>; expires: number };
type ExactModel = { model: ProviderModelEvidence | null; expires: number };

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
    return cached &&
      cached.expires > Date.now() &&
      (!cached.model || cached.model.observedAt <= Date.now())
      ? cached
      : undefined;
  };
  const loadExact = async (id: string, url: string) => {
    const running = exactPending.get(id);
    if (running) return running;
    if (exactPending.size >= MAX_EXACT_PENDING) return undefined;
    const request = readMetadata(url, 64 * 1024)
      .then((value) => parseExactProviderModel(value, id))
      .catch(() => null)
      .then((model) => {
        const current = freshExact(id);
        if (
          current?.model &&
          (!model || current.model.observedAt > model.observedAt)
        ) {
          exactPending.delete(id);
          return current;
        }
        const result = {
          model,
          expires: model ? model.observedAt + TTL : Date.now() + FAILURE_TTL,
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
    selectedEvidence?: ProviderModelEvidence,
  ): Promise<BudgetLimits> => {
    const installed = knownTransportContextLimit(modelId, providerId);
    const selected = freshProviderModelEvidence(
      selectedEvidence,
      providerId ?? "",
      modelId,
    );
    const previous = freshExact(modelId)?.model;
    if (selected && (!previous || previous.observedAt < selected.observedAt)) {
      if (exact.size >= MAX_EXACT_CACHE && !exact.has(modelId)) {
        const oldest = exact.keys().next().value;
        if (oldest !== undefined) exact.delete(oldest);
      }
      exact.set(modelId, {
        model: selected,
        expires: selected.observedAt + TTL,
      });
    }
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
        .then((value) => parseProviderContextCatalog(value))
        .then(
          (models) => ({ models, expires: Date.now() + TTL }),
          () => ({
            models: new Map<string, ProviderModelEvidence>(),
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
    const catalogEntry =
      providerId === "openrouter" && catalog && catalog.expires > Date.now()
        ? catalog.models.get(modelId)
        : undefined;
    const catalogModel =
      catalogEntry &&
      catalogEntry.observedAt <= Date.now() &&
      catalogEntry.observedAt + TTL > Date.now()
        ? catalogEntry
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
    const candidates = [catalogModel, exactModel?.model].filter(
      (v): v is ProviderModelEvidence => Boolean(v),
    );
    const found = candidates.sort((a, b) => b.observedAt - a.observedAt)[0];
    const reported = found?.context ?? installed;
    return {
      reported,
      ...(found?.output ? { outputCap: found.output } : {}),
      ...(reported && providerId
        ? {
            reportedEvidence: found
              ? structuredClone(found)
              : {
                  providerId,
                  modelId,
                  origin: "installed-registry" as const,
                },
          }
        : {}),
    };
  };
}

export const resolveProviderContext = createProviderContextResolver();
