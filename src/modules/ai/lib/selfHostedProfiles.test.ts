import { describe, expect, it } from "vitest";
import { compatModelIdForEndpoint, resolveModel } from "@/modules/ai/config";
import { resolveModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import {
  addSelfHostedEndpoint,
  assertWritableSelfHostedState,
  createSelfHostedEndpoint,
  deleteSelfHostedEndpoint,
  editSelfHostedEndpoint,
  effectiveProfileValue,
  emptySelfHostedState,
  ensureSelfHostedProfile,
  normalizeEndpointUrl,
  profileEvidence,
  readSelfHostedState,
  resetProfileOverride,
  resolveSelfHostedSelection,
  setProfileOverride,
  setProfileRecommendation,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import { migrateSelfHostedProfiles } from "@/modules/ai/lib/selfHostedMigration";

function fixture() {
  const endpoint = createSelfHostedEndpoint(
    {
      alias: "Gaming PC",
      baseURL: "http://localhost:11434/v1",
      backendHint: "ollama",
    },
    "server-a",
    1,
  );
  return ensureSelfHostedProfile(
    addSelfHostedEndpoint(emptySelfHostedState(), endpoint),
    endpoint.id,
    "qwen",
    null,
    1,
  );
}

function recommend(state: SelfHostedState, profileId: string, value: number) {
  return setProfileRecommendation(
    state,
    profileId,
    "concurrentGenerations",
    profileEvidence(
      state,
      profileId,
      "concurrentGenerations",
      value,
      "recommendation",
      10,
    ),
    10,
  );
}

describe("self-hosted identity", () => {
  it("creates stable identity independent of alias", () => {
    const { state } = fixture();
    expect(state.endpoints[0]).toMatchObject({
      id: "server-a",
      alias: "Gaming PC",
      revision: 1,
    });
    const generated = createSelfHostedEndpoint({
      alias: "PC",
      baseURL: "http://localhost",
    });
    expect(generated.id).toMatch(/^sh-/);
  });

  it("renames without changing profiles or configuration revision", () => {
    const { state, profile } = fixture();
    const next = editSelfHostedEndpoint(
      state,
      "server-a",
      { alias: "AI Server" },
      2,
    );
    expect(next.endpoints[0]).toMatchObject({
      id: "server-a",
      alias: "AI Server",
      configurationRevision: 1,
      revision: 2,
    });
    expect(next.profiles[0]).toBe(profile);
    expect(state.endpoints[0]?.alias).toBe("Gaming PC");
  });

  it("edits the address without changing endpoint/profile identity", () => {
    const { state, profile } = fixture();
    const next = editSelfHostedEndpoint(
      state,
      "server-a",
      { baseURL: "https://AI-SERVER:443/proxy/v1" },
      2,
    );
    expect(next.endpoints[0]).toMatchObject({
      id: "server-a",
      baseURL: "https://ai-server/proxy/v1",
      configurationRevision: 2,
      transportSecurity: "https-unverified",
    });
    expect(next.profiles[0]?.id).toBe(profile.id);
  });

  it("keeps endpoints with the same alias distinct", () => {
    const { state } = fixture();
    const next = addSelfHostedEndpoint(
      state,
      createSelfHostedEndpoint(
        { alias: "Gaming PC", baseURL: "http://localhost:2222" },
        "server-b",
        1,
      ),
    );
    expect(next.endpoints.map((e) => e.id)).toEqual(["server-a", "server-b"]);
  });

  it("separates the same model on two endpoints", () => {
    const { state, profile } = fixture();
    const next = addSelfHostedEndpoint(
      state,
      createSelfHostedEndpoint(
        { alias: "PC", baseURL: "http://localhost:2222" },
        "server-b",
        1,
      ),
    );
    expect(
      ensureSelfHostedProfile(next, "server-b", "qwen").profile.id,
    ).not.toBe(profile.id);
  });

  it("separates models and deployments on one endpoint", () => {
    const { state, profile } = fixture();
    const second = ensureSelfHostedProfile(state, "server-a", "llama");
    const deployed = ensureSelfHostedProfile(
      second.state,
      "server-a",
      "qwen",
      "instance-2",
    );
    expect(new Set(deployed.state.profiles.map((p) => p.id)).size).toBe(3);
    expect(
      ensureSelfHostedProfile(deployed.state, "server-a", "qwen").profile.id,
    ).toBe(profile.id);
  });

  it("preserves identity across JSON restart", () => {
    const { state } = fixture();
    expect(readSelfHostedState(JSON.parse(JSON.stringify(state)))).toEqual(
      state,
    );
  });

  it("round-trips bounded identity strings even when tuple JSON expands them", () => {
    const endpoint = createSelfHostedEndpoint(
      { alias: "PC", baseURL: "http://localhost/v1" },
      "x".repeat(2048),
      1,
    );
    const { state } = ensureSelfHostedProfile(
      addSelfHostedEndpoint(emptySelfHostedState(), endpoint),
      endpoint.id,
      '"'.repeat(2048),
      '"'.repeat(2048),
      1,
    );
    expect(readSelfHostedState(JSON.parse(JSON.stringify(state)))).toEqual(
      state,
    );
    expect(() => assertWritableSelfHostedState(state)).not.toThrow();
  });

  it("does not identify proxy deployments solely by origin", () => {
    expect(normalizeEndpointUrl("https://HOST:443/first/v1/")).toBe(
      "https://host/first/v1/",
    );
    expect(normalizeEndpointUrl("https://host/second/v1/")).not.toBe(
      normalizeEndpointUrl("https://host/first/v1/"),
    );
  });

  it.each([
    "file:///tmp/key",
    "http://user:password@host/v1",
    "http://host/v1?api_key=secret",
    "https://host/#secret",
    "not a URL",
    "http://ho\nst/v1",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => normalizeEndpointUrl(url)).toThrow();
  });
});

describe("settings provenance and independent pins", () => {
  it("Automatic uses the recommendation", () => {
    const { state, profile } = fixture();
    expect(
      effectiveProfileValue(
        recommend(state, profile.id, 2),
        profile.id,
        "concurrentGenerations",
      ),
    ).toMatchObject({ mode: "automatic", value: 2, stale: false });
  });

  it("Manual wins without replacing the recommendation", () => {
    const { state, profile } = fixture();
    const next = setProfileOverride(
      recommend(state, profile.id, 2),
      profile.id,
      "concurrentGenerations",
      1,
      20,
    );
    expect(
      effectiveProfileValue(next, profile.id, "concurrentGenerations"),
    ).toMatchObject({ mode: "manual", value: 1 });
    expect(next.profiles[0]?.recommendations.concurrentGenerations?.value).toBe(
      2,
    );
  });

  it("Reset removes only one manual field", () => {
    const { state, profile } = fixture();
    let next = recommend(state, profile.id, 2);
    next = setProfileOverride(next, profile.id, "concurrentGenerations", 1);
    next = setProfileOverride(next, profile.id, "workingContext", 8192);
    next = resetProfileOverride(next, profile.id, "concurrentGenerations");
    expect(
      effectiveProfileValue(next, profile.id, "concurrentGenerations"),
    ).toMatchObject({ mode: "automatic", value: 2 });
    expect(
      effectiveProfileValue(next, profile.id, "workingContext"),
    ).toMatchObject({ mode: "manual", value: 8192 });
  });

  it("retains pins through recommendation updates and restart", () => {
    const { state, profile } = fixture();
    const pinned = setProfileOverride(
      state,
      profile.id,
      "concurrentGenerations",
      1,
    );
    const next = readSelfHostedState(
      JSON.parse(JSON.stringify(recommend(pinned, profile.id, 3))),
    );
    expect(
      effectiveProfileValue(next, profile.id, "concurrentGenerations").value,
    ).toBe(1);
    expect(next.profiles[0]?.recommendations.concurrentGenerations?.value).toBe(
      3,
    );
  });

  it("retains provenance time, source, metric and deployment scope", () => {
    const { state, profile } = fixture();
    const evidence = profileEvidence(
      state,
      profile.id,
      "latencyMs",
      0,
      "measured",
      123,
      "observed",
    );
    const next = readSelfHostedState({
      ...state,
      profiles: [{ ...profile, evidence: [evidence] }],
    });
    expect(next.profiles[0]?.evidence).toEqual([evidence]);
    expect(evidence.scope).toEqual({
      endpointId: "server-a",
      transportModelId: "qwen",
      deploymentId: null,
      configurationRevision: 1,
    });
  });

  it("distinguishes zero, false and missing", () => {
    const { state, profile } = fixture();
    let next = setProfileOverride(state, profile.id, "continuationCount", 0);
    next = setProfileOverride(next, profile.id, "autoContinuation", false);
    expect(
      effectiveProfileValue(next, profile.id, "continuationCount").value,
    ).toBe(0);
    expect(
      effectiveProfileValue(next, profile.id, "autoContinuation").value,
    ).toBe(false);
    expect(
      effectiveProfileValue(next, profile.id, "maxOutput").value,
    ).toBeUndefined();
  });

  it("invalidates stale recommendations on address changes but retains pins", () => {
    const { state, profile } = fixture();
    let next = recommend(state, profile.id, 2);
    next = setProfileOverride(next, profile.id, "workingContext", 8192);
    next = editSelfHostedEndpoint(next, "server-a", {
      baseURL: "http://server:11434/v1",
    });
    expect(
      effectiveProfileValue(next, profile.id, "concurrentGenerations"),
    ).toMatchObject({ value: undefined, stale: true });
    expect(
      effectiveProfileValue(next, profile.id, "workingContext"),
    ).toMatchObject({ value: 8192, mode: "manual", stale: true });
  });

  it("does not invalidate recommendations when renamed", () => {
    const { state, profile } = fixture();
    const next = editSelfHostedEndpoint(
      recommend(state, profile.id, 2),
      "server-a",
      { alias: "AI Server" },
    );
    expect(
      effectiveProfileValue(next, profile.id, "concurrentGenerations").value,
    ).toBe(2);
  });

  it.each([
    NaN,
    Infinity,
    -1,
    0,
    1.5,
  ])("rejects invalid concurrency %s", (value) => {
    const { state, profile } = fixture();
    expect(() =>
      setProfileOverride(state, profile.id, "concurrentGenerations", value),
    ).toThrow();
  });

  it("rejects cross-model or wrong-metric evidence", () => {
    const { state, profile } = fixture();
    const evidence = profileEvidence(
      state,
      profile.id,
      "workingContext",
      2,
      "backend-reported",
    );
    expect(() =>
      setProfileRecommendation(
        state,
        profile.id,
        "concurrentGenerations",
        evidence,
      ),
    ).toThrow();
    evidence.metric = "concurrentGenerations";
    evidence.scope.transportModelId = "other";
    expect(() =>
      setProfileRecommendation(
        state,
        profile.id,
        "concurrentGenerations",
        evidence,
      ),
    ).toThrow();
  });
});

describe("additive legacy migration", () => {
  it.each([
    "ollama",
    "lmstudio",
    "mlx",
  ])("migrates %s and repeats identically", (provider) => {
    const legacy = new Map<string, unknown>([
      [`${provider}BaseURL`, "http://server:1234/proxy/v1"],
      [`${provider}ModelId`, "qwen"],
    ]);
    const next = migrateSelfHostedProfiles(null, legacy, 1);
    expect(next.endpoints[0]).toMatchObject({
      id: `legacy:${provider}`,
      backendHint: provider,
      credentialRef: null,
    });
    expect(resolveSelfHostedSelection(next, `${provider}-local`).status).toBe(
      "available",
    );
    expect(
      migrateSelfHostedProfiles(JSON.parse(JSON.stringify(next)), legacy, 50),
    ).toEqual(next);
    expect(resolveModel(`${provider}-local`).id).toBe(`${provider}-local`);
  });

  const custom = {
    id: "existing-id",
    name: "AI Server",
    baseURL: "http://server/proxy/v1",
    modelId: "qwen",
    contextLimit: 32768,
  };
  const settings = () =>
    new Map<string, unknown>([["customEndpoints", [custom]]]);

  it("retains compatible identity, credentials reference and unverified context", () => {
    const state = migrateSelfHostedProfiles(null, settings(), 1);
    const resolved = resolveSelfHostedSelection(
      state,
      compatModelIdForEndpoint(custom.id),
    );
    expect(resolved.status).toBe("available");
    if (resolved.status !== "available") throw new Error("missing profile");
    expect(resolved.endpoint.id).toBe(custom.id);
    expect(resolved.endpoint.credentialRef).toEqual({
      kind: "custom-endpoint",
      endpointId: custom.id,
    });
    expect(
      effectiveProfileValue(state, resolved.profile.id, "configuredContext"),
    ).toMatchObject({
      mode: "manual",
      value: 32768,
      evidence: {
        source: "user-assertion",
        confidence: "unverified",
        observedAt: null,
      },
    });
    expect(resolved.profile.evidence).toEqual([]);
    expect(resolved.profile.recommendations).toEqual({});
  });

  it("keeps the oldest compatible provider credential reference", () => {
    const legacy = new Map<string, unknown>([
      ["openaiCompatibleBaseURL", custom.baseURL],
      ["openaiCompatibleModelId", "qwen"],
      ["openaiCompatibleContextLimit", 12345],
    ]);
    const state = migrateSelfHostedProfiles(null, legacy, 1);
    expect(state.endpoints[0]?.credentialRef).toEqual({
      kind: "provider",
      providerId: "openai-compatible",
    });
    expect(
      resolveSelfHostedSelection(state, "openai-compatible-custom").status,
    ).toBe("available");
  });

  it("does not import secrets or change cloud/OpenRouter settings", () => {
    const legacy = settings();
    legacy.set("defaultModelId", "gpt-5.4-mini");
    legacy.set("savedProviderModels", [
      { id: "saved-one", providerId: "openrouter", transportModelId: "qwen/a" },
    ]);
    legacy.set("apiKey", "SECRET_PROVIDER_KEY");
    legacy.set("customEndpoints", [
      { ...custom, apiKey: "SECRET_CUSTOM_KEY", password: "SECRET_PASSWORD" },
    ]);
    const original = JSON.stringify([...legacy]);
    const migrated = migrateSelfHostedProfiles(null, legacy, 1);
    expect(JSON.stringify(migrated)).not.toContain("SECRET_");
    expect(JSON.stringify([...legacy])).toBe(original);
    expect(resolveSelfHostedSelection(migrated, "gpt-5.4-mini").status).toBe(
      "not-managed",
    );
    expect(
      resolveSelfHostedSelection(migrated, "saved-provider:saved-one").status,
    ).toBe("not-managed");
  });

  it("strips unknown secrets from normalized profile JSON", () => {
    const { state, profile } = fixture();
    const normalized = readSelfHostedState({
      ...state,
      apiKey: "SECRET",
      endpoints: [{ ...state.endpoints[0], password: "SECRET" }],
      profiles: [{ ...profile, apiKey: "SECRET" }],
    });
    expect(JSON.stringify(normalized)).not.toContain("SECRET");
  });

  it("handles malformed partial legacy settings without writing them", () => {
    const legacy = new Map<string, unknown>([
      ["ollamaBaseURL", 42],
      ["mlxModelId", {}],
      [
        "customEndpoints",
        [
          null,
          5,
          { id: "bad", baseURL: "file:///etc" },
          { ...custom, modelId: null },
        ],
      ],
    ]);
    const original = JSON.stringify([...legacy]);
    const state = migrateSelfHostedProfiles(null, legacy, 1);
    expect(state.endpoints).toHaveLength(1);
    expect(resolveSelfHostedSelection(state, "compat-existing-id").status).toBe(
      "missing",
    );
    expect(JSON.stringify([...legacy])).toBe(original);
  });

  it("does not resurrect tombstones on another migration", () => {
    const state = deleteSelfHostedEndpoint(
      migrateSelfHostedProfiles(null, settings(), 1),
      custom.id,
      [],
      2,
    );
    const next = migrateSelfHostedProfiles(state, settings(), 3);
    expect(next).toEqual(state);
    expect(
      resolveSelfHostedSelection(next, "compat-existing-id"),
    ).toMatchObject({ status: "missing", endpointId: custom.id });
  });

  it("retains user pins and aliases through legacy URL edits", () => {
    let state = migrateSelfHostedProfiles(null, settings(), 1);
    const profileId = state.profiles[0]?.id;
    if (!profileId) throw new Error("missing migrated profile");
    state = editSelfHostedEndpoint(
      state,
      custom.id,
      { alias: "Personal alias" },
      2,
    );
    state = setProfileOverride(state, profileId, "configuredContext", 8192, 2);
    const next = migrateSelfHostedProfiles(
      state,
      new Map([
        [
          "customEndpoints",
          [{ ...custom, baseURL: "http://changed/v1", contextLimit: 64000 }],
        ],
      ]),
      3,
    );
    expect(next.endpoints[0]).toMatchObject({
      id: custom.id,
      alias: "Personal alias",
      baseURL: "http://changed/v1",
    });
    expect(
      effectiveProfileValue(next, profileId, "configuredContext").value,
    ).toBe(8192);
  });

  it("keeps Reset automatic through unrelated legacy edits", () => {
    let state = migrateSelfHostedProfiles(null, settings(), 1);
    const profileId = state.profiles[0]?.id;
    if (!profileId) throw new Error("missing migrated profile");
    state = resetProfileOverride(state, profileId, "configuredContext", 2);
    const next = migrateSelfHostedProfiles(
      state,
      new Map([["customEndpoints", [{ ...custom, name: "Renamed" }]]]),
      3,
    );
    expect(
      effectiveProfileValue(next, profileId, "configuredContext"),
    ).toMatchObject({ mode: "automatic", value: undefined });
  });

  it("retains old profiles when the legacy transport model changes", () => {
    const state = migrateSelfHostedProfiles(null, settings(), 1);
    const next = migrateSelfHostedProfiles(
      state,
      new Map([["customEndpoints", [{ ...custom, modelId: "other" }]]]),
      2,
    );
    expect(next.profiles).toHaveLength(2);
    const resolved = resolveSelfHostedSelection(next, "compat-existing-id");
    expect(
      resolved.status === "available" && resolved.profile.transportModelId,
    ).toBe("other");
  });

  it("keeps an existing binding when the profile registry is full", () => {
    const state = migrateSelfHostedProfiles(null, settings(), 1);
    const first = state.profiles[0];
    if (!first) throw new Error("missing migrated profile");
    state.profiles.push(
      ...Array.from({ length: 2047 }, (_, index) => ({
        ...first,
        id: `other-${index}`,
        transportModelId: `other-${index}`,
        overrides: {},
      })),
    );
    const next = migrateSelfHostedProfiles(
      state,
      new Map([["customEndpoints", [{ ...custom, name: "Renamed" }]]]),
      2,
    );
    expect(next.profiles).toHaveLength(2048);
    expect(resolveSelfHostedSelection(next, "compat-existing-id").status).toBe(
      "available",
    );
    expect(next.endpoints[0]?.legacy?.profileId).toBe(first.id);
  });

  it("deletion does not mutate a captured transport identity", () => {
    const state = migrateSelfHostedProfiles(null, settings(), 1);
    const capture = resolveModelTransportIdentity("compat-existing-id", {
      customEndpoints: [custom],
    });
    const original = structuredClone(capture);
    expect(() =>
      deleteSelfHostedEndpoint(state, custom.id, [custom.id]),
    ).toThrow("active run");
    deleteSelfHostedEndpoint(state, custom.id);
    expect(capture).toEqual(original);
    expect(capture).toMatchObject({
      customEndpointId: custom.id,
      transportModelId: "qwen",
      endpointBaseURL: custom.baseURL,
    });
  });

  it("does not overwrite future schema envelopes", () => {
    expect(() => assertWritableSelfHostedState({ version: 2 })).toThrow(
      "preserved",
    );
  });
});
