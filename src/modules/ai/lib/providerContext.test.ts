import { afterEach, expect, it, vi } from "vitest";
import {
  createProviderContextResolver,
  parseProviderContextCatalog,
} from "@/modules/ai/lib/providerContext";
import { resolveContextBudget } from "@/modules/ai/lib/contextBudget";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const catalog = (data: unknown[]) =>
  new Response(JSON.stringify({ data }), {
    headers: { "content-type": "application/json" },
  });
const entry = (id = "vendor/test", context_length = 65536) => ({
  id,
  context_length,
});

it("uses exact provider/model metadata and the smaller top-provider bound", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      catalog([
        {
          ...entry(),
          top_provider: { context_length: 32768, max_completion_tokens: 1024 },
        },
      ]),
    )
    .mockResolvedValueOnce(new Response("missing", { status: 404 }));
  vi.stubGlobal("fetch", fetcher);
  const resolve = createProviderContextResolver();
  expect(
    resolveContextBudget(await resolve("vendor/test", "openrouter")),
  ).toMatchObject({
    source: "reported",
    ceiling: 32768,
    output: 1024,
    reportedEvidence: {
      providerId: "openrouter",
      modelId: "vendor/test",
      origin: "provider-metadata",
    },
  });
  expect(
    resolveContextBudget(await resolve("vendor/test:free", "openrouter")),
  ).toMatchObject({ source: "unknown-policy", ceiling: 4096 });
  expect(
    resolveContextBudget(await resolve("vendor/test", "openai-compatible")),
  ).toMatchObject({ source: "unknown-policy", ceiling: 4096 });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher).toHaveBeenCalledWith(
    "https://openrouter.ai/api/v1/models",
    expect.objectContaining({
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
    }),
  );
  expect(fetcher).toHaveBeenCalledWith(
    "https://openrouter.ai/api/v1/model/vendor/test%3Afree",
    expect.objectContaining({ method: "GET", credentials: "omit" }),
  );
});

it("keeps installed provider evidence offline without discovery", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const resolve = createProviderContextResolver();
  expect(await resolve("claude-sonnet-4-6", "anthropic")).toMatchObject({
    reported: 200000,
    reportedEvidence: { origin: "installed-registry" },
  });
  expect(await resolve("claude-sonnet-4-6", "openrouter", true)).toEqual({
    reported: undefined,
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  0,
  -1,
  1.5,
  "128000",
  Number.MAX_SAFE_INTEGER + 1,
  null,
])("rejects invalid context capacity %s", (value) => {
  expect(
    parseProviderContextCatalog({
      data: [{ ...entry(), context_length: value }],
    }).size,
  ).toBe(0);
});

it("rejects conflicting/duplicate identities and malformed top-provider bounds", () => {
  expect(
    parseProviderContextCatalog({ data: [entry(), entry(), entry()] }).size,
  ).toBe(0);
  expect(
    parseProviderContextCatalog({
      data: [
        { ...entry(), top_provider: { context_length: "65536" } },
        {
          ...entry("vendor/output"),
          top_provider: { max_completion_tokens: 999999 },
        },
        { ...entry("vendor/bad output"), context_length: 65536 },
      ],
    }).size,
  ).toBe(0);
  expect(() =>
    parseProviderContextCatalog({ data: new Array(4097) }),
  ).toThrow();
  expect(() => parseProviderContextCatalog({})).toThrow();
});

it("deduplicates simultaneous lookups without serializing unrelated installed providers", async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const resolve = createProviderContextResolver();
  const a = resolve("vendor/a", "openrouter");
  const b = resolve("vendor/b", "openrouter");
  expect((await resolve("gpt-5.4-mini", "openai")).reported).toBe(400000);
  finish(catalog([entry("vendor/a"), entry("vendor/b", 32768)]));
  expect((await a).reported).toBe(65536);
  expect((await b).reported).toBe(32768);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("expires metadata instead of retaining a stale large capacity", async () => {
  const time = vi.spyOn(Date, "now").mockReturnValue(1000);
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(catalog([entry()]))
    .mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetcher);
  const resolve = createProviderContextResolver();
  expect((await resolve("vendor/test", "openrouter")).reported).toBe(65536);
  time.mockReturnValue(901001);
  expect(
    (await resolve("vendor/test", "openrouter", true)).reported,
  ).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await resolve("vendor/test", "openrouter")).reported).toBeUndefined();
  await resolve("vendor/test", "openrouter");
  expect(fetcher).toHaveBeenCalledTimes(3);
  time.mockReturnValue(931002);
  fetcher.mockResolvedValue(catalog([entry("vendor/test", 4096)]));
  expect((await resolve("vendor/test", "openrouter")).reported).toBe(4096);
});

it.each([
  "oversized",
  "malformed",
  "wrong-type",
  "HTTP-error",
])("fails closed on %s catalog without trusting a capacity", async (failure) => {
  const response =
    failure === "oversized"
      ? new Response(" ".repeat(4 * 1024 * 1024 + 1), {
          headers: { "content-type": "application/json" },
        })
      : failure === "malformed"
        ? new Response("{broken", {
            headers: { "content-type": "application/json" },
          })
        : failure === "HTTP-error"
          ? new Response("denied", { status: 403 })
          : new Response('{"data":[]}', {
              headers: { "content-type": "text/html" },
            });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  expect(
    resolveContextBudget(
      await createProviderContextResolver()("vendor/test", "openrouter"),
    ),
  ).toMatchObject({ ceiling: 4096, source: "unknown-policy" });
});

it("bounds network waiting and retries failed metadata only after its backoff", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(
    (_url, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(new Error("timeout")),
          { once: true },
        );
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const resolve = createProviderContextResolver();
  const waiting = resolve("vendor/test", "openrouter");
  await vi.advanceTimersByTimeAsync(6000);
  expect((await waiting).reported).toBeUndefined();
  await resolve("vendor/test", "openrouter");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("times out a stalled response body and cancels its reader", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(body, { headers: { "content-type": "application/json" } }),
      ),
  );
  const waiting = createProviderContextResolver()("vendor/test", "openrouter");
  await vi.advanceTimersByTimeAsync(3000);
  expect((await waiting).reported).toBeUndefined();
  expect(cancel).toHaveBeenCalledTimes(1);
});
