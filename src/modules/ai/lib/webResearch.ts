import { invoke } from "@tauri-apps/api/core";
import { contextDigest } from "@/modules/ai/lib/targetContext";

/** The only remote fetch primitive is the native public-HTTPS GET command.
 * The URL and a bounded untrusted extract enter the transcript; no headers,
 * authentication, browser cookies, local-network access or redirects do. */
export type NativeResearchPage = {
  url: string;
  status: number;
  contentType: string;
  retrievedAt: number;
  body: string;
  excerptSha256: string;
  truncated: boolean;
};
export type WebResearchEvidence = {
  id: string;
  source: {
    url: string;
    title: string;
    retrievedAt: number;
    sourceType: "web-page";
    excerptSha256: string;
    confidence: "unverified";
    truncated: boolean;
  };
  content: string;
  consumedBy: {
    sessionId: string;
    runId: number | null;
    workspaceId: string | null;
  };
  status: "retrieved";
  untrusted: true;
};

const MAX_RESEARCH_CHARS = 12000;
const htmlEntities = (text: string) => text.replace(
  /&(?:amp|lt|gt|quot|apos|nbsp|#(?:x[0-9a-f]+|[0-9]+));/gi,
  entity => {
    const token = entity.slice(1, -1).toLowerCase();
    const named: Record<string, string> = {
      amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    };
    if (token in named) return named[token];
    const number = token.startsWith("#x")
      ? parseInt(token.slice(2), 16)
      : token.startsWith("#") ? parseInt(token.slice(1), 10) : NaN;
    return Number.isInteger(number) && number >= 32 && number <= 0x10ffff &&
      !(number >= 0xd800 && number <= 0xdfff)
      ? String.fromCodePoint(number) : " ";
  },
);

/** Extract a bounded text view. No HTML from the network reaches React or
 * the AI SDK as executable markup. Source instructions are explicitly data. */
export function researchText(page: NativeResearchPage): { title: string; excerpt: string } {
  const html = /html|xhtml/i.test(page.contentType);
  const titleMatch = html ? page.body.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i) : null;
  const title = htmlEntities((titleMatch?.[1] ?? new URL(page.url).hostname)
    .replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 200);
  const plain = html ? page.body
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<(script|style|template|svg|iframe|form|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|p|h[1-6]|li|tr|section|article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ") : page.body;
  return {
    title,
    excerpt: htmlEntities(plain).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
      .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n")
      .trim().slice(0, MAX_RESEARCH_CHARS),
  };
}

export async function researchFetchPage(
  url: string,
  owner: WebResearchEvidence["consumedBy"],
): Promise<WebResearchEvidence> {
  const page = await invoke<NativeResearchPage>("research_fetch_page", { url });
  if (!page || page.status < 200 || page.status >= 300 ||
      !Number.isSafeInteger(page.retrievedAt) ||
      page.retrievedAt < 1577836800000 ||
      page.retrievedAt > Date.now() + 60_000 ||
      typeof page.body !== "string" ||
      !/^[0-9a-f]{64}$/.test(page.excerptSha256) ||
      page.body.length > 65536 ||
      !/^text\/html|^text\/plain|^application\/(?:json|xhtml\+xml)/i.test(page.contentType) ||
      page.url !== new URL(url).toString() ||
      !page.url.startsWith("https://"))
    throw new Error("research-invalid-native-receipt");
  const text = researchText(page);
  if (!text.excerpt) throw new Error("research-empty-source");
  const digest = await contextDigest([
    "tf-research-evidence-v1", page.url,
    page.excerptSha256, page.retrievedAt,
  ]);
  return {
    id: `WEB-${digest.slice(0, 24)}`,
    source: {
      url: page.url, title: text.title,
      retrievedAt: page.retrievedAt,
      sourceType: "web-page",
      excerptSha256: page.excerptSha256,
      confidence: "unverified",
      truncated: page.truncated || page.body.length > MAX_RESEARCH_CHARS,
    },
    content: text.excerpt,
    consumedBy: owner,
    status: "retrieved", untrusted: true,
  };
}

export type ResearchFailure = "unavailable" | "unauthorized" |
  "invalid-arguments" | "timeout" | "remote-failure" |
  "schema-mismatch" | "cancelled";
export function researchFailure(error: unknown): ResearchFailure {
  const message = String(error);
  if (/private-host-denied|credential-url-denied|public-https-only|network-denied/i.test(message))
    return "unauthorized";
  if (/invalid-url|unsupported-content-type|non-utf8|empty-source/i.test(message))
    return "invalid-arguments";
  if (/timeout|timed.out|deadline/i.test(message)) return "timeout";
  if (/cancelled|aborted/i.test(message)) return "cancelled";
  if (/invalid-native-receipt/i.test(message)) return "schema-mismatch";
  if (/http-status|network-failed/i.test(message)) return "remote-failure";
  return "unavailable";
}
