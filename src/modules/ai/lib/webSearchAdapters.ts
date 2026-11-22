import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

/** Search listings are provider observations, not verified page contents.
 * Only a later, native-authorized fetch can produce fetched-page evidence. */
const bounded = (limit: number) => z.string().trim().min(1).max(limit);
/** Lexical preflight shared by direct fetch inputs and returned search URLs.
 * Rust repeats complete DNS/address classification at every actual request. */
export function isPublicWebUrl(value: string): boolean {
  if (!value || value.length > 2048 || value.trim() !== value ||
      /[\u0000-\u001f\u007f\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    if (!["http:","https:"].includes(url.protocol) || !url.hostname ||
        url.username || url.password || url.hash ||
        (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")))
      return false;
    const host=url.hostname.toLowerCase();
    if (host.endsWith(".") || !host.includes(".") && !host.startsWith("[") ||
        host === "localhost" || host === "[::1]" ||
        /\.(?:localhost|local|internal|lan|home\.arpa|invalid|test)$/.test(host))
      return false;
    const ipv4=host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const [a,b,c,d]=ipv4.slice(1).map(Number);
      if ([a,b,c,d].some(octet=>octet>255) ||
          a===0 || a===10 || a===127 || a>=224 ||
          a===169 && b===254 || a===172 && b>=16 && b<=31 ||
          a===192 && b===168 || a===100 && b>=64 && b<=127 ||
          a===192 && b===0 && c===0 ||
          a===192 && b===0 && c===2 ||
          a===198 && b===51 && c===100 ||
          a===203 && b===0 && c===113) return false;
    }
    if (host.startsWith("[") &&
        /^\[(?:::|fc|fd|fe[89ab])/i.test(host)) return false;
    for (const key of url.searchParams.keys()) {
      if (/(?:^|[_-])(key|token|secret|password|passwd|pwd|auth|authorization|session|sid|credential|credentials|signature|sig|cookie|code|jwt|access_token|refresh_token|api_key|apikey|client_secret|private_key)(?:$|[_-])/i.test(key))
        return false;
    }
    return true;
  } catch { return false; }
}
const publicAddress = z.string().max(2048).refine(isPublicWebUrl);

export const webSearchResultSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{48}$/i),
  title: bounded(300),
  url: publicAddress,
  snippet: z.string().max(2048),
  rank: z.number().int().min(1).max(1000),
  provider: z.literal("brave_web"),
  observedAt: z.number().int().min(1_577_836_800_000).max(4_102_444_800_000),
}).strict();

const providerStatusSchema = z.object({
  provider: z.literal("brave_web"),
  version: bounded(64),
  requiredCredentialReference: z.string().max(128).nullable(),
  features: z.array(bounded(64)).max(24),
  available: z.boolean(),
  reason: z.string().max(256).nullable(),
  rateStatus: z.string().trim().min(1).max(128),
}).strict();

const nativeProviderSchema = z.object({
  provider: z.literal("brave_web"),
  configured: z.boolean(),
  available: z.boolean(),
  reasonCode: z.string().max(256),
  credentialReference: z.literal("credential:brave-web-search"),
  isolation: z.unknown(),
}).strict();

export type WebSearchResult = z.infer<typeof webSearchResultSchema>;
export type WebSearchProviderStatus = z.infer<typeof providerStatusSchema>;
export type CanonicalWebSearch = WebSearchProviderStatus & {
  results: WebSearchResult[];
};
export type ProviderStatus = WebSearchProviderStatus;

// A cache entry is only authoritative after a successful, structurally valid
// native status query. A stale or failed refresh immediately revokes readiness.
let verifiedProviderStatus: WebSearchProviderStatus | null = null;
let statusGeneration = 0;

export function isTfWebSearchProviderAvailable(): boolean {
  return verifiedProviderStatus?.available === true;
}

export function invalidateTfWebSearchProviderStatus(): void {
  statusGeneration++;
  verifiedProviderStatus = null;
}

export async function refreshTfWebSearchProviderStatus(): Promise<ProviderStatus> {
  const generation = ++statusGeneration;
  verifiedProviderStatus = null;
  try {
    const raw = await invoke<unknown>("tf_web_provider_status");
    const status = normalizeWebProviderStatus(raw);
    if (generation === statusGeneration) verifiedProviderStatus = status;
    if (status) return status;
  } catch { /* Failed native status remains unavailable. */ }
  return {
    provider:"brave_web",version:"native-tf-web-v1",
    requiredCredentialReference:null,features:["web_search"],
    available:false,reason:"provider-status-unverified",rateStatus:"unknown",
  };
}

/** Normalize only the genuine supported Brave provider. An absent provider
 * or malformed native status must never become a fictional ready backend. */
export function normalizeWebProviderStatus(raw: unknown): WebSearchProviderStatus | null {
  const parsed = nativeProviderSchema.safeParse(raw);
  if (!parsed.success || (parsed.data.available && !parsed.data.configured)) return null;
  return providerStatusSchema.parse({
    provider: parsed.data.provider,
    version: "native-tf-web-v1",
    requiredCredentialReference: parsed.data.credentialReference,
    features: ["web_search"],
    available: parsed.data.configured && parsed.data.available,
    reason: parsed.data.reasonCode || null,
    rateStatus: "unknown",
  });
}

/** Preserve native opaque IDs as-is, enforce their uniqueness, and establish
 * deterministic ranks. Never synthesize an ID from an untrusted URL. */
export function normalizeWebSearchResults(raw: unknown): WebSearchResult[] | null {
  if (!Array.isArray(raw) || raw.length > 20) return null;
  const parsed = z.array(webSearchResultSchema).safeParse(raw);
  if (!parsed.success) return null;
  const ids = new Set<string>();
  const ranks = new Set<number>();
  for (const item of parsed.data) {
    if (ids.has(item.id) || ranks.has(item.rank)) return null;
    ids.add(item.id);
    ranks.add(item.rank);
  }
  return [...parsed.data].sort((a, b) => a.rank - b.rank);
}

export function normalizeWebSearchEnvelope(
  provider: unknown, results: unknown,
): CanonicalWebSearch | null {
  const canonical = providerStatusSchema.safeParse(provider);
  const status = canonical.success ? canonical.data : normalizeWebProviderStatus(provider);
  const normalized = normalizeWebSearchResults(results);
  if (!status || !normalized || (!status.available && normalized.length > 0)) return null;
  return {...status, results: normalized};
}
