import { afterEach, expect, it, vi } from "vitest";
import {
  freshProviderModelEvidence,
  normalizeProviderModelEvidence,
  parseExactProviderModel,
  parseProviderContextCatalog,
  PROVIDER_METADATA_TTL,
} from "@/modules/ai/lib/providerModelEvidence";
import { createProviderContextResolver } from "@/modules/ai/lib/providerContext";
import {
  captureSavedProviderModelEvidence,
  createSavedProviderModel,
  getEnabledSavedProviderModelInfos,
  migrateSavedProviderModels,
  resolveModelTransportIdentity,
  savedProviderModelSelectionId,
} from "@/modules/ai/lib/savedProviderModels";
import { resolveContextBudget } from "@/modules/ai/lib/contextBudget";
import { resolveModelInputCapabilities } from "@/modules/ai/lib/modelCapabilities";
import {
  openrouterCatalogFixture,
  minimaxFreeCatalogRecord,
} from "@/modules/ai/lib/openrouterCatalog.fixture";

const id = minimaxFreeCatalogRecord.id;
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
const evidence = (now = Date.now()) => {
  const found = parseProviderContextCatalog(openrouterCatalogFixture, now).get(id);
  if (!found) throw new Error("Missing exact fixture evidence.");
  return found;
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("normalizes realistic catalog variants by ID, not canonical slug, preserving all bounded evidence", () => {
  const models = parseProviderContextCatalog(openrouterCatalogFixture);
  expect(models.get(id)).toMatchObject({
    version: 1,
    modelId: id,
    context: 1048576,
    output: 32768,
    lookup: "catalog",
    capabilities: {
      inputModalities: ["image", "text", "video"],
      outputModalities: ["text"],
      supportedParameters: expect.arrayContaining([
        "tools",
        "structured_outputs",
        "reasoning",
      ]),
      reasoning: {
        mandatory: false,
        defaultEnabled: true,
        supportedEfforts: ["high", "low"],
        defaultEffort: "high",
      },
    },
  });
  expect(models.get("minimax/minimax-m3")).toMatchObject({
    context: 524288,
    output: 512000,
  });
  expect(models.get("poolside/laguna-s-2.1:free")).toMatchObject({
    context: 262144,
    capabilities: { reasoning: { defaultEnabled: true } },
  });
  expect(models.has(minimaxFreeCatalogRecord.canonical_slug)).toBe(false);
});

it("keeps one exact evidence representation through normalization, picker, captured routing and B1", async () => {
  const original = evidence();
  const model = createSavedProviderModel(
    {
      providerId: "openrouter",
      transportModelId: id,
      providerEvidence: original,
    },
    "minimax",
  );
  original.capabilities?.supportedParameters?.push("not-retained");
  const stored = JSON.parse(JSON.stringify([model]));
  const migrated = migrateSavedProviderModels({
    stored,
    storedVersion: 1,
    legacyOpenrouterModelId: "",
  });
  expect(migrated.changed).toBe(false);
  const picker = getEnabledSavedProviderModelInfos(migrated.models)[0];
  const route = resolveModelTransportIdentity(picker.id, {
    savedProviderModels: migrated.models,
  });
  expect(route.providerEvidence).toEqual(picker.providerEvidence);
  const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetcher);
  const limits = await createProviderContextResolver()(
    route.transportModelId,
    route.providerId,
    false,
    route.providerEvidence,
  );
  expect(limits.reportedEvidence).toEqual(picker.providerEvidence);
  expect(resolveContextBudget(limits)).toMatchObject({
    source: "reported",
    ceiling: 1048576,
    output: 2048,
  });
  expect(limits.outputCap).toBe(32768);
  expect(
    resolveModelInputCapabilities(picker.id, undefined, null, {
      identity: route,
      evidence: limits.reportedEvidence,
    }),
  ).toMatchObject({
    image: "supported",
    tools: "supported",
    structuredOutputs: "supported",
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    route.providerEvidence?.capabilities?.supportedParameters,
  ).not.toContain("not-retained");
});

it("captures configured selection evidence through the existing resolver instead of another catalog", async () => {
  const fetcher = vi.fn(async () => json(openrouterCatalogFixture));
  vi.stubGlobal("fetch", fetcher);
  const selection = await captureSavedProviderModelEvidence(
    createSavedProviderModel({
      providerId: "openrouter",
      transportModelId: id,
    }),
  );
  if (!selection.providerEvidence) throw new Error("Expected configured model evidence.");
  expect(selection.providerEvidence).toEqual(evidence(selection.providerEvidence.observedAt));
  const renamed = await captureSavedProviderModelEvidence({
    ...selection,
    displayName: "Renamed",
  });
  expect(renamed.providerEvidence).toEqual(selection.providerEvidence);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([
  "404",
  "network",
])("valid saved catalog evidence survives a separate window's exact %s failure", async (failure) => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith("/models")) return json({ data: [] });
    if (failure === "network") throw new Error("offline");
    return new Response("missing", { status: 404 });
  });
  fetcher.mockResolvedValueOnce(json(openrouterCatalogFixture));
  vi.stubGlobal("fetch", fetcher);
  const firstWindow = await createProviderContextResolver()(id, "openrouter");
  const selected = normalizeProviderModelEvidence(
    JSON.parse(JSON.stringify(firstWindow.reportedEvidence)),
    "openrouter",
    id,
  );
  expect(selected).toBeDefined();
  const secondWindow = createProviderContextResolver();
  expect((await secondWindow(id, "openrouter")).reported).toBeUndefined();
  expect(
    (await secondWindow(id, "openrouter", false, selected)).reportedEvidence,
  ).toEqual(selected);
  expect((await secondWindow(id, "openrouter", true)).reported).toBe(1048576);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("uses the same normalized reasoning and modality evidence for exact fallback and equal-capability variants", () => {
  const models = parseProviderContextCatalog({
    data: [
      minimaxFreeCatalogRecord,
      { ...minimaxFreeCatalogRecord, id: "fixture/same-base" },
      { ...minimaxFreeCatalogRecord, id: "fixture/same-base:free" },
    ],
  });
  expect(models.get("fixture/same-base")?.capabilities).toEqual(
    models.get("fixture/same-base:free")?.capabilities,
  );
  expect(
    parseExactProviderModel({ data: minimaxFreeCatalogRecord }, id),
  ).toEqual({ ...models.get(id), lookup: "exact-model" });
});

it("does not let an in-flight failed lookup overwrite newly received catalog evidence", async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn((url: string) =>
    url.endsWith("/models")
      ? Promise.resolve(json({ data: [] }))
      : new Promise<Response>((r) => {
          finish = r;
        }),
  );
  vi.stubGlobal("fetch", fetcher);
  const resolve = createProviderContextResolver();
  const pending = resolve(id, "openrouter");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await resolve(id, "openrouter", true, evidence());
  finish(new Response("missing", { status: 404 }));
  expect((await pending).reported).toBe(1048576);
  expect((await resolve(id, "openrouter", true)).reported).toBe(1048576);
});

it("expires persisted evidence and uses bounded refresh/backoff instead of retaining it forever", async () => {
  const time = vi.spyOn(Date, "now").mockReturnValue(1000);
  const selected = evidence();
  const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetcher);
  const resolve = createProviderContextResolver();
  expect((await resolve(id, "openrouter", false, selected)).reported).toBe(
    1048576,
  );
  time.mockReturnValue(1000 + PROVIDER_METADATA_TTL);
  expect(
    (await resolve(id, "openrouter", true, selected)).reported,
  ).toBeUndefined();
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    resolveContextBudget(await resolve(id, "openrouter", false, selected)),
  ).toMatchObject({ source: "unknown-policy", ceiling: 4096 });
  await resolve(id, "openrouter", false, selected);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("prefers newer successful evidence over a previous saved snapshot without allowing identity crossover", async () => {
  const time = vi.spyOn(Date, "now").mockReturnValue(1000);
  const saved = evidence();
  time.mockReturnValue(2000);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({
        data: [
          {
            ...minimaxFreeCatalogRecord,
            context_length: 65536,
            top_provider: {
              context_length: 65536,
              max_completion_tokens: 1024,
            },
          },
        ],
      }),
    ),
  );
  const resolve = createProviderContextResolver();
  expect((await resolve(id, "openrouter")).reported).toBe(65536);
  expect((await resolve(id, "openrouter", false, saved)).reported).toBe(65536);
  expect(
    (await resolve("minimax/minimax-m3", "openrouter", true, saved)).reported,
  ).toBeUndefined();
  expect((await resolve(id, "openai", true, saved)).reported).toBeUndefined();
});

it.each([
  { version: 2 },
  { modelId: "minimax/minimax-m3" },
  { providerId: "openai" },
  { lookup: "website" },
  { context: "1048576" },
  { output: 1048577 },
  { observedAt: -1 },
  { capabilities: { supportedParameters: new Array(33).fill("tools") } },
  { capabilities: { reasoning: { mandatory: "yes" } } },
  { capabilities: { reasoning: { defaultEffort: "x".repeat(65) } } },
])("rejects invalid or wrong-identity persisted evidence %j", (patch) => {
  expect(
    normalizeProviderModelEvidence(
      { ...evidence(), ...patch },
      "openrouter",
      id,
    ),
  ).toBeUndefined();
});

it("does not trust future timestamps, retain raw catalog fields, or carry old evidence into an edited ID", () => {
  expect(
    freshProviderModelEvidence(evidence(Date.now() + 1000), "openrouter", id),
  ).toBeUndefined();
  const selected = evidence();
  expect(JSON.stringify(selected)).not.toMatch(
    /pricing|description|hugging_face|canonical_slug/,
  );
  const model = createSavedProviderModel(
    {
      providerId: "openrouter",
      transportModelId: id,
      providerEvidence: selected,
    },
    "saved",
  );
  const edited = migrateSavedProviderModels({
    stored: [{ ...model, transportModelId: "minimax/minimax-m3" }],
    storedVersion: 1,
    legacyOpenrouterModelId: "",
  });
  expect(edited.models[0].providerEvidence).toBeUndefined();
  expect(savedProviderModelSelectionId(edited.models[0].id)).toBe(
    savedProviderModelSelectionId(model.id),
  );
});
