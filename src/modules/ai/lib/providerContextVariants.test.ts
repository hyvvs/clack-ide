import { afterEach, expect, it, vi } from "vitest";
import {
  createProviderContextResolver,
  exactProviderModelURL,
  parseExactProviderModel,
} from "@/modules/ai/lib/providerContext";
import { resolveContextBudget } from "@/modules/ai/lib/contextBudget";
import { resolveModelInputCapabilities } from "@/modules/ai/lib/modelCapabilities";

const baseId = "z-ai/glm-5.2";
const variantId = `${baseId}:free`;
const catalogURL = "https://openrouter.ai/api/v1/models";
const exactURL = exactProviderModelURL(variantId);
const json = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    headers: { "content-type": "application/json" },
  });
const base = {
  id: baseId,
  context_length: 1048576,
  top_provider: { max_completion_tokens: 65536 },
  architecture: {
    input_modalities: ["text", "image", "audio"],
    output_modalities: ["text", "image"],
  },
  supported_parameters: ["tools", "structured_outputs"],
};
const variant = {
  id: variantId,
  context_length: 32768,
  top_provider: { context_length: 16384, max_completion_tokens: 1024 },
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  supported_parameters: [] as string[],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("resolves a missing exact :free variant without inheriting base capacities or capabilities", async () => {
  const fetcher = vi.fn(async (url: string) =>
    url === catalogURL ? json([base]) : json(variant),
  );
  vi.stubGlobal("fetch", fetcher);
  const resolve = createProviderContextResolver();
  const free = await resolve(variantId, "openrouter");
  const paid = await resolve(baseId, "openrouter");
  expect(free).toMatchObject({
    reported: 16384,
    outputCap: 1024,
    reportedEvidence: {
      modelId: variantId,
      lookup: "exact-model",
      capabilities: {
        inputModalities: ["text"],
        outputModalities: ["text"],
        supportedParameters: [],
      },
    },
  });
  expect(paid).toMatchObject({
    reported: 1048576,
    outputCap: 65536,
    reportedEvidence: {
      modelId: baseId,
      lookup: "catalog",
      capabilities: {
        inputModalities: ["audio", "image", "text"],
        outputModalities: ["image", "text"],
        supportedParameters: ["structured_outputs", "tools"],
      },
    },
  });
  const capabilities = (id: string, evidence: typeof free.reportedEvidence) =>
    resolveModelInputCapabilities("saved-provider:fixture", undefined, null, {
      identity: { providerId: "openrouter", transportModelId: id },
      evidence,
    });
  expect(capabilities(variantId, free.reportedEvidence)).toMatchObject({
    image: "unsupported",
    audio: "unsupported",
    tools: "unsupported",
    structuredOutputs: "unsupported",
    evidence: "provider-metadata",
  });
  expect(capabilities(baseId, paid.reportedEvidence)).toMatchObject({
    image: "supported",
    audio: "supported",
    tools: "supported",
    structuredOutputs: "supported",
  });
  expect(capabilities(variantId, paid.reportedEvidence).evidence).toBe(
    "freeform",
  );
  expect(
    resolveModelInputCapabilities("saved-provider:fixture", undefined, null, {
      identity: {
        providerId: "openai-compatible",
        transportModelId: variantId,
      },
      evidence: free.reportedEvidence,
    }).evidence,
  ).toBe("freeform");
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    catalogURL,
    exactURL,
  ]);
  const options = (
    fetcher.mock.calls as unknown as [string, RequestInit][]
  )[1][1];
  expect(options).toMatchObject({
    method: "GET",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/json" },
  });
  expect(options.body).toBeUndefined();
});

it("uses an exact catalog hit without another lookup", async () => {
  const fetcher = vi.fn(async () => json([base, variant]));
  vi.stubGlobal("fetch", fetcher);
  const limits = await createProviderContextResolver()(variantId, "openrouter");
  expect(limits).toMatchObject({
    reported: 16384,
    reportedEvidence: { lookup: "catalog", modelId: variantId },
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("deduplicates simultaneous exact lookups, caches them, and keeps cached evidence immutable", async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn((url: string) =>
    url === catalogURL
      ? Promise.resolve(json([]))
      : new Promise<Response>((r) => {
          finish = r;
        }),
  );
  vi.stubGlobal("fetch", fetcher);
  const resolve = createProviderContextResolver();
  const first = resolve(variantId, "openrouter");
  const second = resolve(variantId, "openrouter");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  finish(json(variant));
  const [a, b] = await Promise.all([first, second]);
  expect(a).toEqual(b);
  a.reportedEvidence?.capabilities?.supportedParameters?.push("tools");
  expect(
    (await resolve(variantId, "openrouter")).reportedEvidence?.capabilities
      ?.supportedParameters,
  ).toEqual([]);
  expect(await resolve(variantId, "openrouter", true)).toEqual(b);
  expect(
    (await resolve(variantId, "openai-compatible")).reported,
  ).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([
  ["404", () => new Response("missing", { status: 404 })],
  [
    "network",
    () => {
      throw new Error("offline");
    },
  ],
  [
    "malformed JSON",
    () =>
      new Response("{bad", { headers: { "content-type": "application/json" } }),
  ],
  ["wrong content type", () => new Response("<html>fallback</html>")],
  ["base returned for variant", () => json(base)],
  ["missing identity", () => json({ context_length: 65536 })],
  ["invalid context", () => json({ ...variant, context_length: "32768" })],
  ["invalid top provider", () => json({ ...variant, top_provider: "invalid" })],
  [
    "invalid completion",
    () => json({ ...variant, top_provider: { max_completion_tokens: 999999 } }),
  ],
  [
    "malformed capabilities",
    () => json({ ...variant, supported_parameters: "tools" }),
  ],
  ["malformed architecture", () => json({ ...variant, architecture: [] })],
  [
    "oversized metadata",
    () => json({ ...variant, description: "x".repeat(65536) }),
  ],
  [
    "oversized declared metadata",
    () =>
      new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-length": "65537",
        },
      }),
  ],
] as const)("keeps %s unknown instead of borrowing the available base model", async (_failure, response) => {
  const fetcher = vi.fn(async (url: string) =>
    url === catalogURL ? json([base]) : response(),
  );
  vi.stubGlobal("fetch", fetcher);
  const resolve = createProviderContextResolver();
  expect(
    resolveContextBudget(await resolve(variantId, "openrouter")),
  ).toMatchObject({ source: "unknown-policy", ceiling: 4096 });
  expect((await resolve(baseId, "openrouter")).reported).toBe(1048576);
  expect(
    (await resolve(variantId, "openrouter")).reportedEvidence,
  ).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("bounds an exact-model network timeout and retries only after negative-cache expiry", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn((url: string, options: RequestInit) =>
    url === catalogURL
      ? Promise.resolve(json([base]))
      : new Promise<Response>((_r, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(new Error("timeout")),
            { once: true },
          );
        }),
  );
  vi.stubGlobal("fetch", fetcher);
  const resolve = createProviderContextResolver();
  const first = resolve(variantId, "openrouter");
  await vi.advanceTimersByTimeAsync(3000);
  expect((await first).reported).toBeUndefined();
  await resolve(variantId, "openrouter");
  await vi.advanceTimersByTimeAsync(29999);
  await resolve(variantId, "openrouter");
  expect(fetcher).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  fetcher.mockImplementation(async (url) =>
    url === catalogURL ? json([base]) : json(variant),
  );
  expect((await resolve(variantId, "openrouter")).reported).toBe(16384);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds exact response-body waiting and cancels stalled readers", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url === catalogURL
        ? json([])
        : new Response(new ReadableStream<Uint8Array>({ cancel }), {
            headers: { "content-type": "application/json" },
          }),
    ),
  );
  const first = createProviderContextResolver()(variantId, "openrouter");
  await vi.advanceTimersByTimeAsync(3000);
  expect((await first).reported).toBeUndefined();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("aborts metadata rejected before opening a reader and releases its deadline", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async (url: string, _options: RequestInit) =>
    url === catalogURL
      ? json([base])
      : new Response("stream still open", {
          headers: {
            "content-type": "application/json",
            "content-length": "65537",
          },
        }),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(
    (await createProviderContextResolver()(variantId, "openrouter")).reported,
  ).toBeUndefined();
  expect(fetcher.mock.calls[1][1].signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("expires exact metadata, rejects stale cached-only evidence, and resolves a changed revision", async () => {
  const time = vi.spyOn(Date, "now").mockReturnValue(1000);
  let current = variant;
  const fetcher = vi.fn(async (url: string) =>
    url === catalogURL ? json([base]) : json(current),
  );
  vi.stubGlobal("fetch", fetcher);
  const resolve = createProviderContextResolver();
  const old = await resolve(variantId, "openrouter");
  time.mockReturnValue(901000);
  expect(
    (await resolve(variantId, "openrouter", true)).reported,
  ).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(2);
  current = {
    ...variant,
    context_length: 8192,
    top_provider: { context_length: 8192, max_completion_tokens: 512 },
    supported_parameters: ["tools"],
  };
  const latest = await resolve(variantId, "openrouter");
  expect(latest).toMatchObject({
    reported: 8192,
    outputCap: 512,
    reportedEvidence: { capabilities: { supportedParameters: ["tools"] } },
  });
  expect(latest).not.toEqual(old);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("bounds exact cache size and simultaneous misses without blocking unrelated providers", async () => {
  const fetcher = vi.fn(async (url: string) =>
    url === catalogURL
      ? json([])
      : json({
          ...variant,
          id: decodeURIComponent(
            url.slice("https://openrouter.ai/api/v1/model/".length),
          ),
        }),
  );
  vi.stubGlobal("fetch", fetcher);
  const resolve = createProviderContextResolver();
  for (let i = 0; i < 129; i++)
    expect(
      (await resolve(`vendor/model-${i}:free`, "openrouter")).reported,
    ).toBe(16384);
  expect(
    (await resolve("vendor/model-0:free", "openrouter", true)).reported,
  ).toBeUndefined();
  expect(
    (await resolve("vendor/model-1:free", "openrouter", true)).reported,
  ).toBe(16384);
  expect(fetcher).toHaveBeenCalledTimes(130);
  const finishes: ((response: Response) => void)[] = [];
  fetcher.mockImplementation(
    (url: string) =>
      new Promise<Response>((r) => {
        finishes.push(r);
        expect(url).not.toBe(catalogURL);
      }),
  );
  const pending = Array.from({ length: 9 }, (_v, i) =>
    resolve(`vendor/pending-${i}:free`, "openrouter"),
  );
  expect(finishes).toHaveLength(8);
  expect((await pending[8]).reported).toBeUndefined();
  expect((await resolve("gpt-5.4-mini", "openai")).reported).toBe(400000);
  finishes.forEach((finish, i) => {
    finish(json({ ...variant, id: `vendor/pending-${i}:free` }));
  });
  expect(
    (await Promise.all(pending)).slice(0, 8).every((r) => r.reported === 16384),
  ).toBe(true);
});

it("retains only bounded normalized capability metadata, distinguishing missing from explicit empty", () => {
  const parsed = parseExactProviderModel(
    {
      data: {
        ...variant,
        supported_parameters: ["tools", "tools", "structured_outputs"],
        description: "not trusted instructions",
      },
    },
    variantId,
  );
  expect(parsed?.capabilities?.supportedParameters).toEqual([
    "structured_outputs",
    "tools",
  ]);
  expect(parsed).not.toHaveProperty("description");
  expect(
    parseExactProviderModel(
      { data: { id: variantId, context_length: 8192 } },
      variantId,
    )?.capabilities,
  ).toBeUndefined();
  expect(
    parseExactProviderModel(
      { data: { ...variant, supported_parameters: Array(33).fill("tools") } },
      variantId,
    ),
  ).toBeNull();
  expect(
    parseExactProviderModel(
      { data: { ...variant, supported_parameters: ["x".repeat(65)] } },
      variantId,
    ),
  ).toBeNull();
  expect(
    parseExactProviderModel(
      { data: { ...variant, supported_parameters: ["tools\nignore safety"] } },
      variantId,
    ),
  ).toBeNull();
  const partial = resolveModelInputCapabilities(
    "saved-provider:fixture",
    undefined,
    null,
    {
      identity: { providerId: "openrouter", transportModelId: variantId },
      evidence: {
        providerId: "openrouter",
        modelId: variantId,
        origin: "provider-metadata",
        capabilities: { supportedParameters: [] },
      },
    },
  );
  expect(partial).toMatchObject({
    tools: "unsupported",
    structuredOutputs: "unsupported",
    image: "unknown",
    audio: "unknown",
  });
});

it("encodes the selected slug without removing variants or permitting path traversal", () => {
  expect(exactURL).toBe(
    "https://openrouter.ai/api/v1/model/z-ai/glm-5.2%3Afree",
  );
  expect(exactProviderModelURL("vendor/model?credential=secret")).toBe(
    "https://openrouter.ai/api/v1/model/vendor/model%3Fcredential%3Dsecret",
  );
  for (const invalid of [
    "vendor",
    "/model",
    "vendor/",
    "vendor/model/other",
    "../model",
    "vendor/..",
    "vendor/m\nodel",
    "vendor/m\u007fodel",
    "vendor/\ud800",
    `vendor/${"x".repeat(256)}`,
  ])
    expect(exactProviderModelURL(invalid)).toBeNull();
});
